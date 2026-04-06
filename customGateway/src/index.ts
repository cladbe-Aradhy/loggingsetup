import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import axios from 'axios';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import {
  ENABLE_SIGNOZ_FORWARD,
  GRPC_PORT,
  PORT,
  SIGNOZ_FORWARD_TIMEOUT_MS,
  SIGNOZ_OTLP_GRPC_TARGET,
  SIGNOZ_OTLP_HTTP_BASE_URL
} from './config';
import {
  clearStore,
  saveJsonPayload,
  saveRawPayload,
  storedPayloads
} from './storage/local-store';

const app = new Hono();
const OTEL_SIGNAL_TYPES = ['logs', 'traces', 'metrics'] as const;

type OTelSignalType = (typeof OTEL_SIGNAL_TYPES)[number];
type GrpcExportCallback = (error: grpc.ServiceError | null, response?: {}) => void;
type ForwardResult = {
  attempted: boolean;
  forwarded: boolean;
  target: string;
  reason?: string;
  error?: string;
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

function buildUpstreamHttpUrl(signalType: OTelSignalType) {
  const normalizedBaseUrl = SIGNOZ_OTLP_HTTP_BASE_URL.replace(/\/+$/, '');
  return `${normalizedBaseUrl}/v1/${signalType}`;
}

// We read the body as raw bytes so OTLP HTTP/protobuf payloads stay untouched.
async function readBodyBuffer(request: Request) {
  return Buffer.from(await request.arrayBuffer());
}

// Only the important upstream headers are forwarded.
function buildForwardHeaders(request: Request, contentType: string) {
  const headers: Record<string, string> = {
    'content-type': contentType
  };

  const authorization = request.headers.get('authorization');
  const contentEncoding = request.headers.get('content-encoding');

  if (authorization) {
    headers.authorization = authorization;
  }

  if (contentEncoding) {
    headers['content-encoding'] = contentEncoding;
  }

  return headers;
}

async function forwardHttpToSigNoz(
  signalType: OTelSignalType,
  request: Request,
  rawBody: Buffer,
  contentType: string
) {
  if (!ENABLE_SIGNOZ_FORWARD) {
    return {
      attempted: false,
      forwarded: false,
      target: buildUpstreamHttpUrl(signalType),
      reason: 'forwarding disabled by config'
    };
  }

  try {
    const response = await axios.post(buildUpstreamHttpUrl(signalType), new Uint8Array(rawBody), {
      headers: buildForwardHeaders(request, contentType),
      timeout: SIGNOZ_FORWARD_TIMEOUT_MS,
      responseType: 'text',
      validateStatus: () => true
    });

    return {
      attempted: true,
      forwarded: response.status >= 200 && response.status < 300,
      target: buildUpstreamHttpUrl(signalType),
      status: response.status,
      statusText: response.statusText,
      responsePreview: String(response.data || '').slice(0, 200)
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return {
        attempted: true,
        forwarded: false,
        target: buildUpstreamHttpUrl(signalType),
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responsePreview: String(error.response?.data || '').slice(0, 200)
      };
    }

    throw error;
  }
}

function forwardGrpcLogsToSigNoz(requestPayload: unknown) {
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
      (error: Error | null) => {
        if (error) {
          resolve({
            attempted: true,
            forwarded: false,
            target: SIGNOZ_OTLP_GRPC_TARGET,
            error: error.message
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

// One reusable handler keeps the three OTLP HTTP routes simple.
async function handleOtelHttpSignal(c: Context, signalType: OTelSignalType) {
  const contentType = c.req.header('content-type') || 'application/octet-stream';
  const rawBody = await readBodyBuffer(c.req.raw);
  const stored = saveRawPayload(signalType, 'http', contentType, rawBody);

  try {
    const forwardResult = await forwardHttpToSigNoz(signalType, c.req.raw, rawBody, contentType);

    return c.json({
      ok: true,
      message: `${signalType} payload stored in memory and processed for SigNoz forwarding`,
      item: stored,
      total: storedPayloads.length,
      forward: forwardResult
    });
  } catch (error) {
    return c.json({
      ok: false,
      message: `${signalType} payload stored in memory but upstream forwarding failed`,
      item: stored,
      total: storedPayloads.length,
      forward: {
        attempted: true,
        forwarded: false,
        target: buildUpstreamHttpUrl(signalType),
        error: error instanceof Error ? error.message : String(error)
      }
    }, 502);
  }
}

async function handleGrpcLogsExport(call: { request: unknown }, callback: GrpcExportCallback) {
  const stored = saveJsonPayload('logs', 'grpc', 'application/grpc+proto', call.request);
  const forwardResult = await forwardGrpcLogsToSigNoz(call.request);

  if (forwardResult.forwarded || !forwardResult.attempted) {
    callback(null, {});
    return;
  }

  callback({
    code: grpc.status.UNAVAILABLE,
    name: 'UpstreamForwardFailed',
    message: forwardResult.error || 'failed to forward gRPC logs to SigNoz'
  } as grpc.ServiceError);

  process.stderr.write(
    `custom-gateway gRPC forward failed for stored payload ${stored.id}: ${
      forwardResult.error || 'unknown error'
    }\n`
  );
}

//////////////////////////////////////////////////////////////

app.get('/', (c) => {
  return c.json({
    ok: true,
    message: 'custom gateway is running',
    signozForward: {
      enabled: ENABLE_SIGNOZ_FORWARD,
      httpBaseUrl: SIGNOZ_OTLP_HTTP_BASE_URL,
      grpcTarget: SIGNOZ_OTLP_GRPC_TARGET
    },
    endpoints: [
      'POST /v1/logs',
      'POST /v1/traces',
      'POST /v1/metrics',
      `OTLP gRPC logs on :${GRPC_PORT} -> LogsService/Export`,
      'GET /health',
      'GET /debug/store',
      'DELETE /debug/store'
    ]
  });
});

app.get('/health', (c) => {
  return c.json({
    ok: true,
    service: 'custom-gateway',
    storedPayloadCount: storedPayloads.length,
    httpPort: PORT,
    grpcPort: GRPC_PORT,
    signozForwardEnabled: ENABLE_SIGNOZ_FORWARD,
    signozOtlpHttpBaseUrl: SIGNOZ_OTLP_HTTP_BASE_URL,
    signozOtlpGrpcTarget: SIGNOZ_OTLP_GRPC_TARGET
  });
});

app.post('/v1/logs', async (c) => {
  return handleOtelHttpSignal(c, 'logs');
});

app.post('/v1/traces', async (c) => {
  return handleOtelHttpSignal(c, 'traces');
});

app.post('/v1/metrics', async (c) => {
  return handleOtelHttpSignal(c, 'metrics');
});

app.get('/debug/store', (c) => {
  return c.json({
    ok: true,
    total: storedPayloads.length,
    storedPayloads
  });
});

app.delete('/debug/store', (c) => {
  clearStore();

  return c.json({
    ok: true,
    message: 'memory store cleared',
    storedPayloadCount: 0
  });
});



//////////////////////////////////////////////////////////////////////////////////////////////





const grpcServer = new grpc.Server();

grpcServer.addService(LogsService.service, {
  Export(call: { request: unknown }, callback: GrpcExportCallback) {
    void handleGrpcLogsExport(call, callback);
  }
});

serve(
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
