import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { otlpLogsPayloadSchema } from './validation/otlp-logs-schema';
import {
  ENABLE_SIGNOZ_FORWARD,
  GRPC_PORT,
  MAX_DEAD_QUEUE_SIZE,
  MAX_LIVE_QUEUE_SIZE,
  PORT,
  QUEUE_RETRY_INTERVAL_MS,
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  SIGNOZ_FORWARD_TIMEOUT_MS,
  SIGNOZ_OTLP_GRPC_TARGET
} from './config';
import {
  clearStore,
  deadQueue,
  freshQueue,
  getAllStoredPayloads,
  getLivePayloadCount,
  getQueueCounts,
  markPayloadAsForwarded,
  markPayloadAttemptFailed,
  notePendingPayload,
  saveJsonPayload,
  saveRawPayload,
  trimDeadQueue,
  type StoredPayload
} from './storage/local-store';

const app = new Hono();
const MAX_FORWARD_ATTEMPTS = 3;
// this is type of grpc export handler callback and this callback not return anything if error then error object if success then nul, second parameter is optional responce object 
type GrpcExportCallback = (error: grpc.ServiceError | null, response?: {}) => void;

// saved temparary for build response mesage that comes from signoz after forwording atttenpt
type ForwardResult = {
  attempted: boolean;
  forwarded: boolean;
  target: string;
  reason?: string;
  error?: string;
  grpcCode?: number;
};

//tells stored payload is valid for forvading bye grpc or not
type GrpcUpstreamPayloadResult =
  | {
      ok: true;
      requestPayload: unknown;
    }
  | {
      ok: false;
      error: string;
      grpcCode: number;
    };

const protoRoot = path.resolve(__dirname, '../proto');
const logsServiceProtoPath = path.join(
  protoRoot,
  'opentelemetry/proto/collector/logs/v1/logs_service.proto'
);

const packageDefinition = protoLoader.loadSync(logsServiceProtoPath, {
  longs: String,
  defaults: true,
  enums: Number,
  oneofs: true,
  includeDirs: [protoRoot]
});

const loadedDefinition = grpc.loadPackageDefinition(packageDefinition) as any;
const LogsService = loadedDefinition.opentelemetry.proto.collector.logs.v1.LogsService;

function usesTls(target: string) {
  return target.startsWith('https://') || target.startsWith('grpcs://');
}

function normalizeGrpcTarget(target: string) {
  return target.replace(/^[a-z]+:\/\//i, '');
}

const upstreamLogsClient = new LogsService(
  normalizeGrpcTarget(SIGNOZ_OTLP_GRPC_TARGET),
  usesTls(SIGNOZ_OTLP_GRPC_TARGET)
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure()
);

// stored payload ids that in prosecss of being forwarded, to avoid multiple concurrent forwarding attempts for the same payload
const processingPayloadIds = new Set<number>();

let isShuttingDown = false;
let isQueueScanRunning = false;

async function readBodyBuffer(request: Request) {
  return Buffer.from(await request.arrayBuffer());
}

function isObjectPayload(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildGrpcUpstreamPayload(item: StoredPayload): GrpcUpstreamPayloadResult {
  if (item.transport === 'grpc') {
    if (!isObjectPayload(item.bodyJson)) {
      return {
        ok: false,
        error: 'stored gRPC payload is missing a valid request body',
        grpcCode: grpc.status.INVALID_ARGUMENT
      };
    }

    return {
      ok: true,
      requestPayload: item.bodyJson
    };
  }

  if (!item.contentType.toLowerCase().includes('json')) {
    return {
      ok: false,
      error: `HTTP logs must arrive as OTLP JSON (got ${item.contentType})`,
      grpcCode: grpc.status.INVALID_ARGUMENT
    };
  }

  if (!isObjectPayload(item.bodyJson)) {
    return {
      ok: false,
      error: 'HTTP log payload is not valid JSON',
      grpcCode: grpc.status.INVALID_ARGUMENT
    };
  }

  return {
    ok: true,
    requestPayload: item.bodyJson
  };
}

function createGrpcServiceError(message: string, code: grpc.status) {
  const error = new Error(message) as grpc.ServiceError;
  error.code = code;
  error.details = message;
  error.metadata = new grpc.Metadata();
  return error;
}

function buildFreshQueueMessage(item: StoredPayload, forwardResult: ForwardResult) {
  const reason = forwardResult.reason || forwardResult.error || 'forward failed';
  return `payload kept in fresh queue (${reason}); attempts ${item.attemptCount}/${MAX_FORWARD_ATTEMPTS}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function canAcceptNewPayload() {
  return !isShuttingDown && getLivePayloadCount() < MAX_LIVE_QUEUE_SIZE;
}

async function tryForwardStoredPayload(item: StoredPayload) {
  if (item.queueName === 'dead') {
    return {
      attempted: false,
      forwarded: false,
      target: SIGNOZ_OTLP_GRPC_TARGET,
      reason: 'payload is already in dead queue'
    };
  }

  if (processingPayloadIds.has(item.id)) {
    return {
      attempted: false,
      forwarded: false,
      target: SIGNOZ_OTLP_GRPC_TARGET,
      reason: 'payload is already being processed'
    };
  }

  processingPayloadIds.add(item.id);

  try {
    if (!ENABLE_SIGNOZ_FORWARD) {
      const forwardResult = {
        attempted: false,
        forwarded: false,
        target: SIGNOZ_OTLP_GRPC_TARGET,
        reason: 'forwarding disabled by config'
      };

      notePendingPayload(item, forwardResult.reason, null);
      return forwardResult;
    }

    const grpcPayload = buildGrpcUpstreamPayload(item);

    if (!grpcPayload.ok) {
      const forwardResult = {
        attempted: true,
        forwarded: false,
        target: SIGNOZ_OTLP_GRPC_TARGET,
        error: grpcPayload.error,
        grpcCode: grpcPayload.grpcCode
      };

      markPayloadAttemptFailed(
        item,
        forwardResult.error || null,
        forwardResult.grpcCode || null,
        MAX_FORWARD_ATTEMPTS
      );
      trimDeadQueue(MAX_DEAD_QUEUE_SIZE);
      return forwardResult;
    }

    const forwardResult = await new Promise<ForwardResult>((resolve) => {
      upstreamLogsClient.Export(
        grpcPayload.requestPayload,
        {
          deadline: Date.now() + SIGNOZ_FORWARD_TIMEOUT_MS
        },
        (error: grpc.ServiceError | null) => {
          if (error) {
            resolve({
              attempted: true,
              forwarded: false,
              target: SIGNOZ_OTLP_GRPC_TARGET,
              error: error.message,
              grpcCode: error.code
            });
            return;
          }

          resolve({
            attempted: true,
            forwarded: true,
            target: SIGNOZ_OTLP_GRPC_TARGET
          });
        }
      );
    });

    if (forwardResult.forwarded) {
      markPayloadAsForwarded(item);
      return forwardResult;
    }

    if (!forwardResult.attempted) {
      notePendingPayload(
        item,
        forwardResult.reason || forwardResult.error || null,
        forwardResult.grpcCode || null
      );
      return forwardResult;
    }

    markPayloadAttemptFailed(
      item,
      forwardResult.error || forwardResult.reason || null,
      forwardResult.grpcCode || null,
      MAX_FORWARD_ATTEMPTS
    );
    trimDeadQueue(MAX_DEAD_QUEUE_SIZE);
    return forwardResult;
  } finally {
    processingPayloadIds.delete(item.id);
  }
}

async function processStoredPayloadQueue() {
  if (!ENABLE_SIGNOZ_FORWARD || isQueueScanRunning) {
    return;
  }

  isQueueScanRunning = true;

  try {
    for (const item of [...freshQueue]) {
      try {
        await tryForwardStoredPayload(item);
      } catch (error) {
        markPayloadAttemptFailed(
          item,
          error instanceof Error ? error.message : String(error),
          grpc.status.INTERNAL,
          MAX_FORWARD_ATTEMPTS
        );
      }
    }

    trimDeadQueue(MAX_DEAD_QUEUE_SIZE);
  } finally {
    isQueueScanRunning = false;
  }
}

async function handleHttpLogs(c: Context) {
  if (isShuttingDown) {
    return c.json(
      {
        ok: false,
        message: 'gateway is shutting down and not accepting new logs'
      },
      503
    );
  }

  if (!canAcceptNewPayload()) {
    return c.json(
      {
        ok: false,
        message: 'fresh in-memory queue is full',
        queueCounts: getQueueCounts()
      },
      503
    );
  }

  const contentType = c.req.header('content-type') || 'application/octet-stream';
  const rawBody = await readBodyBuffer(c.req.raw);

  if (!contentType.toLowerCase().includes('json')) {
    return c.json(
      {
        ok: false,
        message: `HTTP logs must use JSON content-type (got ${contentType})`
      },
      422
    );
  }

  const bodyText = rawBody.toString('utf8');

  if (!bodyText.trim()) {
    return c.json(
      {
        ok: false,
        message: 'HTTP logs payload is empty'
      },
      400
    );
  }

  let bodyJson: any;

  try {
    bodyJson = JSON.parse(bodyText);
  } catch (_error) {
    return c.json(
      {
        ok: false,
        message: 'HTTP logs payload is not valid JSON'
      },
      400
    );
  }

  const validationResult = otlpLogsPayloadSchema.validate(bodyJson);

  if (validationResult.error) {
    return c.json(
      {
        ok: false,
        message: validationResult.error.details[0]?.message || 'HTTP logs payload is invalid'
      },
      422
    );
  }

  const stored = saveRawPayload('logs', 'http', contentType, rawBody);

  try {
    const forwardResult = await tryForwardStoredPayload(stored);

    if (forwardResult.forwarded) {
      return c.json({
        ok: true,
        message: 'logs payload forwarded to SigNoz',
        item: stored,
        queueCounts: getQueueCounts(),
        forward: forwardResult
      });
    }

    return c.json(
      {
        ok: true,
        message: buildFreshQueueMessage(stored, forwardResult),
        item: stored,
        queueCounts: getQueueCounts(),
        forward: forwardResult
      },
      202
    );
  } catch (error) {
    notePendingPayload(stored, error instanceof Error ? error.message : String(error));

    return c.json(
      {
        ok: true,
        message: buildFreshQueueMessage(stored, {
          attempted: false,
          forwarded: false,
          target: SIGNOZ_OTLP_GRPC_TARGET,
          error: stored.lastError || 'unexpected forwarding error'
        }),
        item: stored,
        queueCounts: getQueueCounts()
      },
      202
    );
  }
}

async function handleGrpcLogsExport(call: { request: unknown }, callback: GrpcExportCallback) {
  if (isShuttingDown) {
    callback(
      createGrpcServiceError(
        'gateway is shutting down and not accepting new logs',
        grpc.status.UNAVAILABLE
      )
    );
    return;
  }

  if (!canAcceptNewPayload()) {
    callback(
      createGrpcServiceError(
        'fresh in-memory queue is full',
        grpc.status.RESOURCE_EXHAUSTED
      )
    );
    return;
  }

  try {
    const validationResult = otlpLogsPayloadSchema.validate(call.request);

    if (validationResult.error) {
      callback(
        createGrpcServiceError(
          validationResult.error.details[0]?.message || 'gRPC logs payload is invalid',
          grpc.status.INVALID_ARGUMENT
        )
      );
      return;
    }

    const stored = saveJsonPayload('logs', 'grpc', 'application/grpc+proto', call.request);
    const forwardResult = await tryForwardStoredPayload(stored);

    if (forwardResult.forwarded) {
      callback(null, {});
      return;
    }

    callback(
      createGrpcServiceError(
        buildFreshQueueMessage(stored, forwardResult),
        grpc.status.UNAVAILABLE
      )
    );
  } catch (error) {
    callback(
      createGrpcServiceError(
        error instanceof Error ? error.message : String(error),
        grpc.status.INTERNAL
      )
    );
  }
}

async function drainQueuesBeforeShutdown() {
  const deadline = Date.now() + SHUTDOWN_DRAIN_TIMEOUT_MS;

  while (getLivePayloadCount() > 0 && Date.now() < deadline) {
    await processStoredPayloadQueue();

    if (getLivePayloadCount() === 0) {
      return;
    }

    await sleep(250);
  }
}

async function closeHttpServer(server: { close: (callback: (error?: Error) => void) => void }) {
  return new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeGrpcServer(server: grpc.Server) {
  return new Promise<void>((resolve) => {
    server.tryShutdown(() => {
      resolve();
    });
  });
}


//////////////////////////////////////////////////////////////////////////////////////

app.get('/', (c) => {
  return c.json({
    ok: true,
    message: 'custom gateway is running',
    shuttingDown: isShuttingDown,
    maxForwardAttempts: MAX_FORWARD_ATTEMPTS,
    signozForward: {
      enabled: ENABLE_SIGNOZ_FORWARD,
      upstreamProtocol: 'grpc',
      grpcTarget: SIGNOZ_OTLP_GRPC_TARGET
    },
    queueCounts: getQueueCounts(),
    endpoints: [
      'POST /v1/logs',
      `OTLP gRPC logs on :${GRPC_PORT} -> LogsService/Export`,
      'GET /health',
      'GET /debug/store',
      'DELETE /debug/store'
    ]
  });
});

app.get('/health', (c) => {
  const statusCode = isShuttingDown ? 503 : 200;

  return c.json(
    {
      ok: !isShuttingDown,
      service: 'custom-gateway',
      shuttingDown: isShuttingDown,
      acceptingTraffic: !isShuttingDown,
      maxForwardAttempts: MAX_FORWARD_ATTEMPTS,
      queueCounts: getQueueCounts(),
      httpPort: PORT,
      grpcPort: GRPC_PORT,
      signozForwardEnabled: ENABLE_SIGNOZ_FORWARD,
      signozForwardProtocol: 'grpc',
      signozOtlpGrpcTarget: SIGNOZ_OTLP_GRPC_TARGET
    },
    statusCode
  );
});

app.post('/v1/logs', async (c) => {
  return handleHttpLogs(c);
});

app.get('/debug/store', (c) => {
  return c.json({
    ok: true,
    shuttingDown: isShuttingDown,
    maxForwardAttempts: MAX_FORWARD_ATTEMPTS,
    queueCounts: getQueueCounts(),
    freshQueue,
    deadQueue,
    allStoredPayloads: getAllStoredPayloads()
  });
});

app.delete('/debug/store', (c) => {
  clearStore();

  return c.json({
    ok: true,
    message: 'memory store cleared',
    queueCounts: getQueueCounts()
  });
});






////////////////////////////////////////////////////////////////////


// cannect the loservice export methed to handleGrpcLogsExport function, so that when the gateway receives gRPC logs export calls, it will be processed by handleGrpcLogsExport which will save the payload and attempt forwarding to SigNoz, similar to how HTTP logs are handled.
const grpcServer = new grpc.Server();

grpcServer.addService(LogsService.service, {
  Export(call: { request: unknown }, callback: GrpcExportCallback) {
    void handleGrpcLogsExport(call, callback);
  }
});

//////////////////////////////////////////////////////////////////

const retryInterval = setInterval(() => {
  void processStoredPayloadQueue();
}, QUEUE_RETRY_INTERVAL_MS);


const httpServer = serve(
  {
    fetch: app.fetch,
    port: PORT
  },
  (info) => {
    process.stdout.write(
      `custom-gateway HTTP listening on http://127.0.0.1:${info.port}\n`
    );
  }
);

grpcServer.bindAsync(
  `0.0.0.0:${GRPC_PORT}`,
  grpc.ServerCredentials.createInsecure(),
  (error, port) => {
    if (error) {
      throw error;
    }

    grpcServer.start();
    process.stdout.write(`custom-gateway gRPC listening on 127.0.0.1:${port}\n`);
  }
);

async function startGracefulShutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  clearInterval(retryInterval);

  process.stdout.write(
    `received ${signal}, stopping new traffic and draining in-memory queues\n`
  );

  await Promise.allSettled([
    closeHttpServer(httpServer),
    closeGrpcServer(grpcServer)
  ]);

  await drainQueuesBeforeShutdown();

  const remainingLivePayloads = getLivePayloadCount();

  if (remainingLivePayloads > 0) {
    process.stdout.write(
      `shutdown finished with ${remainingLivePayloads} fresh payloads still in memory\n`
    );
  } else {
    process.stdout.write('shutdown drained all fresh in-memory payloads\n');
  }

  upstreamLogsClient.close();
  process.exit(remainingLivePayloads === 0 ? 0 : 1);
}

process.on('SIGTERM', () => {
  void startGracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void startGracefulShutdown('SIGINT');
});
