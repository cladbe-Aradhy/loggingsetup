import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import {
  ENABLE_SIGNOZ_FORWARD,
  GRPC_PORT,
  MAX_DEAD_QUEUE_SIZE,
  MAX_LIVE_QUEUE_SIZE,
  PORT,
  QUEUE_PROCESSING_CONCURRENCY,
  QUEUE_RETRY_INTERVAL_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  SIGNOZ_FORWARD_TIMEOUT_MS,
  SIGNOZ_OTLP_GRPC_TARGET
} from './config';
import {
  clearStore,
  deadQueue,
  deadQueueOverflow,
  freshQueue,
  getAllStoredPayloads,
  getLivePayloadCount,
  getQueueCounts,
  markPayloadAsDead,
  markPayloadAsForwarded,
  markPayloadForRetry,
  noteUnattemptedPayload,
  retryQueue,
  saveJsonPayload,
  saveRawPayload,
  trimDeadQueue,
  type FailureType,
  type StoredPayload
} from './storage/local-store';

const app = new Hono();

type GrpcExportCallback = (error: grpc.ServiceError | null, response?: {}) => void;

type ForwardResult = {
  attempted: boolean;
  forwarded: boolean;
  target: string;
  reason?: string;
  error?: string;
  failureType?: FailureType;
  grpcCode?: number;
  responsePreview?: string;
  retryAfterMs?: number;
};

type FailureDecision = {
  retryable: boolean;
  failureType: FailureType;
};

type GrpcUpstreamPayloadResult =
  | {
      ok: true;
      requestPayload: unknown;
    }
  | {
      ok: false;
      failureType: FailureType;
      error: string;
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
        failureType: 'invalid_payload',
        error: 'stored gRPC payload is missing a valid request body'
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
      failureType: 'unsupported_media_type',
      error: `HTTP logs must arrive as OTLP JSON so they can be forwarded upstream over gRPC (got ${item.contentType})`
    };
  }

  if (!isObjectPayload(item.bodyJson)) {
    return {
      ok: false,
      failureType: 'invalid_payload',
      error: 'HTTP log payload is not valid JSON and cannot be forwarded upstream over gRPC'
    };
  }

  return {
    ok: true,
    requestPayload: item.bodyJson
  };
}

function looksLikeTimeout(result: ForwardResult) {
  if (result.grpcCode === grpc.status.DEADLINE_EXCEEDED) {
    return true;
  }

  const value = `${result.error || ''}`.toLowerCase();
  return value.includes('timeout') || value.includes('deadline') || value.includes('aborted');
}

function looksLikeNetworkError(result: ForwardResult) {
  const value = `${result.error || ''}`.toLowerCase();
  return (
    value.includes('econnrefused') ||
    value.includes('econnreset') ||
    value.includes('socket hang up') ||
    value.includes('enotfound') ||
    value.includes('ehostunreach') ||
    value.includes('network')
  );
}

function looksLikeSchemaError(result: ForwardResult) {
  const value = `${result.responsePreview || ''} ${result.error || ''}`.toLowerCase();
  return value.includes('schema') || value.includes('field') || value.includes('invalid');
}

function createGrpcServiceError(message: string, code: grpc.status) {
  const error = new Error(message) as grpc.ServiceError;
  error.code = code;
  error.details = message;
  error.metadata = new grpc.Metadata();
  return error;
}

function buildGrpcRetryMessage(item: StoredPayload, forwardResult: ForwardResult) {
  const failureReason =
    item.failureType || forwardResult.reason || forwardResult.error || 'retryable failure';

  return `gateway accepted the log payload but queued it for retry (${failureReason})`;
}

function buildGrpcDeadMessage(item: StoredPayload, forwardResult: ForwardResult) {
  const failureReason =
    item.failureType || forwardResult.reason || forwardResult.error || 'non-retryable failure';

  return `gateway rejected the log payload and moved it to dead queue (${failureReason})`;
}

function buildIngestRetryMessage(item: StoredPayload, forwardResult: ForwardResult) {
  const failureReason =
    item.failureType || forwardResult.reason || forwardResult.error || 'retryable failure';

  return `logs payload accepted and kept in retry queue for upstream gRPC forwarding (${failureReason})`;
}

function buildIngestDeadMessage(item: StoredPayload, forwardResult: ForwardResult) {
  const failureReason =
    item.failureType || forwardResult.reason || forwardResult.error || 'non-retryable failure';

  return `logs payload rejected for upstream gRPC forwarding and moved to dead queue (${failureReason})`;
}

function parseRetryAfterHeader(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const trimmedValue = value.trim();
  const seconds = Number(trimmedValue);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const absoluteTimeMs = Date.parse(trimmedValue);

  if (Number.isNaN(absoluteTimeMs)) {
    return undefined;
  }

  return Math.max(0, absoluteTimeMs - Date.now());
}

function parseGrpcRetryPushbackMs(error: grpc.ServiceError | null) {
  if (!error?.metadata) {
    return undefined;
  }

  const metadataMap = error.metadata.getMap();
  const pushbackValue =
    metadataMap['grpc-retry-pushback-ms'] || metadataMap['retry-after-ms'];

  if (typeof pushbackValue === 'number') {
    return Math.max(0, pushbackValue);
  }

  if (Buffer.isBuffer(pushbackValue)) {
    const milliseconds = Number(pushbackValue.toString('utf8').trim());
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
  }

  if (typeof pushbackValue === 'string' && pushbackValue.trim()) {
    const milliseconds = Number(pushbackValue.trim());
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
  }

  const rawValue = metadataMap['retry-after'];

  if (typeof rawValue === 'number') {
    return Math.max(0, rawValue);
  }

  if (Buffer.isBuffer(rawValue)) {
    return parseRetryAfterHeader(rawValue.toString('utf8'));
  }

  return parseRetryAfterHeader(rawValue);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function calculateRetryDelayMs(nextAttemptCount: number) {
  const exponentialDelay = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** Math.max(nextAttemptCount - 1, 0),
    RETRY_MAX_DELAY_MS
  );

  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.max(500, Math.floor(exponentialDelay * jitterMultiplier));
}

function classifyFailureType(failureType: FailureType): FailureDecision {
  switch (failureType) {
    case 'forwarding_disabled':
    case 'timeout':
    case 'network_error':
    case 'rate_limited':
    case 'upstream_5xx':
    case 'upstream_unavailable':
    case 'unknown':
      return {
        retryable: true,
        failureType
      };
    case 'bad_request':
    case 'invalid_payload':
    case 'invalid_schema':
    case 'unsupported_media_type':
    case 'unprocessable_entity':
    case 'auth_or_config_error':
      return {
        retryable: false,
        failureType
      };
  }
}

function classifyGrpcFailure(result: ForwardResult): FailureDecision {
  if (result.failureType) {
    return classifyFailureType(result.failureType);
  }

  if (!result.attempted) {
    return {
      retryable: true,
      failureType: 'forwarding_disabled'
    };
  }

  switch (result.grpcCode) {
    case grpc.status.INVALID_ARGUMENT:
      return {
        retryable: false,
        failureType: looksLikeSchemaError(result) ? 'invalid_schema' : 'invalid_payload'
      };
    case grpc.status.DEADLINE_EXCEEDED:
      return {
        retryable: true,
        failureType: 'timeout'
      };
    case grpc.status.RESOURCE_EXHAUSTED:
      return {
        retryable: true,
        failureType: 'rate_limited'
      };
    case grpc.status.UNAVAILABLE:
      return {
        retryable: true,
        failureType: 'upstream_unavailable'
      };
    case grpc.status.UNAUTHENTICATED:
    case grpc.status.PERMISSION_DENIED:
    case grpc.status.NOT_FOUND:
      return {
        retryable: false,
        failureType: 'auth_or_config_error'
      };
    default:
      if (looksLikeTimeout(result)) {
        return {
          retryable: true,
          failureType: 'timeout'
        };
      }

      if (looksLikeNetworkError(result)) {
        return {
          retryable: true,
          failureType: 'network_error'
        };
      }

      return {
        retryable: true,
        failureType: 'unknown'
      };
  }
}

function canAcceptNewPayload() {
  return !isShuttingDown && getLivePayloadCount() < MAX_LIVE_QUEUE_SIZE;
}

function forwardGrpcLogsToSigNoz(requestPayload: unknown): Promise<ForwardResult> {
  if (!ENABLE_SIGNOZ_FORWARD) {
    return Promise.resolve<ForwardResult>({
      attempted: false,
      forwarded: false,
      target: SIGNOZ_OTLP_GRPC_TARGET,
      reason: 'forwarding disabled by config'
    });
  }
  return new Promise<ForwardResult>((resolve) => {
    upstreamLogsClient.Export(
      requestPayload,
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
            grpcCode: error.code,
            retryAfterMs: parseGrpcRetryPushbackMs(error)
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
}

async function forwardStoredPayload(item: StoredPayload) {
  const grpcPayload = buildGrpcUpstreamPayload(item);

  if (!grpcPayload.ok) {
    return {
      attempted: true,
      forwarded: false,
      target: SIGNOZ_OTLP_GRPC_TARGET,
      error: grpcPayload.error,
      grpcCode: grpc.status.INVALID_ARGUMENT,
      failureType: grpcPayload.failureType,
      responsePreview: grpcPayload.error
    };
  }

  return forwardGrpcLogsToSigNoz(grpcPayload.requestPayload);
}

async function tryForwardStoredPayload(item: StoredPayload) {
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
    const forwardResult = await forwardStoredPayload(item);

    if (forwardResult.forwarded) {
      markPayloadAsForwarded(item);
      return forwardResult;
    }

    const failureDecision = classifyGrpcFailure(forwardResult);

    if (!forwardResult.attempted) {
      noteUnattemptedPayload(
        item,
        failureDecision.failureType,
        forwardResult.reason || forwardResult.error || null
      );
      return forwardResult;
    }

    if (failureDecision.retryable) {
      markPayloadForRetry(
        item,
        failureDecision.failureType,
        forwardResult.error || forwardResult.reason || null,
        forwardResult.retryAfterMs ?? calculateRetryDelayMs(item.attemptCount + 1),
        forwardResult.grpcCode || null
      );
      return forwardResult;
    }

    markPayloadAsDead(
      item,
      failureDecision.failureType,
      forwardResult.error || forwardResult.reason || null,
      forwardResult.grpcCode || null
    );
    trimDeadQueue(MAX_DEAD_QUEUE_SIZE);
    return forwardResult;
  } finally {
    processingPayloadIds.delete(item.id);
  }
}

async function safelyProcessStoredPayload(item: StoredPayload) {
  try {
    await tryForwardStoredPayload(item);
  } catch (error) {
    markPayloadForRetry(
      item,
      'unknown',
      error instanceof Error ? error.message : String(error),
      calculateRetryDelayMs(item.attemptCount + 1)
    );
  }
}

async function processPayloadBatch(items: StoredPayload[], concurrencyLimit: number) {
  const activeTasks = new Set<Promise<void>>();

  for (const item of items) {
    const task = safelyProcessStoredPayload(item);
    activeTasks.add(task);

    void task.finally(() => {
      activeTasks.delete(task);
    });

    if (activeTasks.size >= concurrencyLimit) {
      await Promise.race(activeTasks);
    }
  }

  await Promise.allSettled([...activeTasks]);
}

async function processStoredPayloadQueue() {
  if (!ENABLE_SIGNOZ_FORWARD || isQueueScanRunning) {
    return;
  }

  isQueueScanRunning = true;

  try {
    await processPayloadBatch(
      [...freshQueue],
      Math.max(1, QUEUE_PROCESSING_CONCURRENCY)
    );

    const now = Date.now();
    const dueRetryItems = [...retryQueue].filter((item) => {
      return !item.nextRetryAt || Date.parse(item.nextRetryAt) <= now;
    });

    await processPayloadBatch(
      dueRetryItems,
      Math.max(1, QUEUE_PROCESSING_CONCURRENCY)
    );

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

  if (getLivePayloadCount() >= MAX_LIVE_QUEUE_SIZE) {
    return c.json(
      {
        ok: false,
        message: 'live in-memory queue is full',
        queueCounts: getQueueCounts()
      },
      503
    );
  }

  const contentType = c.req.header('content-type') || 'application/octet-stream';
  const rawBody = await readBodyBuffer(c.req.raw);
  const { item: stored, isDuplicate } = saveRawPayload(
    'logs',
    'http',
    contentType,
    rawBody
  );

  if (isDuplicate) {
    return c.json(
      {
        ok: true,
        message: 'logs payload already exists in active in-memory queue',
        item: stored,
        queueCounts: getQueueCounts(),
        duplicate: true
      },
      202
    );
  }

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

    if (stored.state === 'dead') {
      return c.json(
        {
          ok: false,
          message: buildIngestDeadMessage(stored, forwardResult),
          item: stored,
          queueCounts: getQueueCounts(),
          forward: forwardResult
        },
        422
      );
    }

    return c.json(
      {
        ok: true,
        message: buildIngestRetryMessage(stored, forwardResult),
        item: stored,
        queueCounts: getQueueCounts(),
        forward: forwardResult
      },
      202
    );
  } catch (error) {
    return c.json(
      {
        ok: true,
        message: 'logs payload accepted and kept in memory after an unexpected forwarding error',
        item: stored,
        queueCounts: getQueueCounts(),
        forward: {
          attempted: true,
          forwarded: false,
          target: SIGNOZ_OTLP_GRPC_TARGET,
          error: error instanceof Error ? error.message : String(error)
        }
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
        'live in-memory queue is full',
        grpc.status.RESOURCE_EXHAUSTED
      )
    );
    return;
  }

  try {
    const { item: stored, isDuplicate } = saveJsonPayload(
      'logs',
      'grpc',
      'application/grpc+proto',
      call.request
    );

    if (isDuplicate) {
      callback(
        createGrpcServiceError(
          'gateway already has the same log payload in active in-memory queue',
          grpc.status.ALREADY_EXISTS
        )
      );
      return;
    }

    const forwardResult = await tryForwardStoredPayload(stored);

    if (forwardResult.forwarded) {
      callback(null, {});
      return;
    }

    if (stored.state === 'dead') {
      callback(
        createGrpcServiceError(
          buildGrpcDeadMessage(stored, forwardResult),
          stored.lastGrpcCode ?? grpc.status.INVALID_ARGUMENT
        )
      );
      return;
    }

    callback(
      createGrpcServiceError(
        buildGrpcRetryMessage(stored, forwardResult),
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


////////////////////////////////////////////////////////////////////////////

app.get('/', (c) => {
  return c.json({
    ok: true,
    message: 'custom gateway is running',
    shuttingDown: isShuttingDown,
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
      queueCounts: getQueueCounts(),
      deadQueueOverflow,
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
    queueCounts: getQueueCounts(),
    deadQueueOverflow,
    freshQueue,
    retryQueue,
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

const grpcServer = new grpc.Server();

grpcServer.addService(LogsService.service, {
  Export(call: { request: unknown }, callback: GrpcExportCallback) {
    void handleGrpcLogsExport(call, callback);
  }
});

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
      `shutdown finished with ${remainingLivePayloads} live payloads still in memory\n`
    );
  } else {
    process.stdout.write('shutdown drained all live in-memory payloads\n');
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
