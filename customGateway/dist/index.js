"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
const axios_1 = __importDefault(require("axios"));
const node_server_1 = require("@hono/node-server");
const hono_1 = require("hono");
const config_1 = require("./config");
const local_store_1 = require("./storage/local-store");
const app = new hono_1.Hono();
const OTEL_SIGNAL_TYPES = ['logs', 'traces', 'metrics'];
const protoRoot = node_path_1.default.resolve(__dirname, '../proto');
const logsServiceProtoPath = node_path_1.default.join(protoRoot, 'opentelemetry/proto/collector/logs/v1/logs_service.proto');
const packageDefinition = protoLoader.loadSync(logsServiceProtoPath, {
    longs: String,
    defaults: true,
    enums: Number,
    oneofs: true,
    includeDirs: [protoRoot]
});
const loadedDefinition = grpc.loadPackageDefinition(packageDefinition);
const LogsService = loadedDefinition.opentelemetry.proto.collector.logs.v1.LogsService;
function usesTls(target) {
    return target.startsWith('https://') || target.startsWith('grpcs://');
}
function normalizeGrpcTarget(target) {
    return target.replace(/^[a-z]+:\/\//i, '');
}
const upstreamLogsClient = new LogsService(normalizeGrpcTarget(config_1.SIGNOZ_OTLP_GRPC_TARGET), usesTls(config_1.SIGNOZ_OTLP_GRPC_TARGET)
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure());
function buildUpstreamHttpUrl(signalType) {
    const normalizedBaseUrl = config_1.SIGNOZ_OTLP_HTTP_BASE_URL.replace(/\/+$/, '');
    return `${normalizedBaseUrl}/v1/${signalType}`;
}
// We read the body as raw bytes so OTLP HTTP/protobuf payloads stay untouched.
async function readBodyBuffer(request) {
    return Buffer.from(await request.arrayBuffer());
}
// Only the important upstream headers are forwarded.
function buildForwardHeaders(request, contentType) {
    const headers = {
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
async function forwardHttpToSigNoz(signalType, request, rawBody, contentType) {
    if (!config_1.ENABLE_SIGNOZ_FORWARD) {
        return {
            attempted: false,
            forwarded: false,
            target: buildUpstreamHttpUrl(signalType),
            reason: 'forwarding disabled by config'
        };
    }
    try {
        const response = await axios_1.default.post(buildUpstreamHttpUrl(signalType), new Uint8Array(rawBody), {
            headers: buildForwardHeaders(request, contentType),
            timeout: config_1.SIGNOZ_FORWARD_TIMEOUT_MS,
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
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
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
function forwardGrpcLogsToSigNoz(requestPayload) {
    if (!config_1.ENABLE_SIGNOZ_FORWARD) {
        return Promise.resolve({
            attempted: false,
            forwarded: false,
            target: config_1.SIGNOZ_OTLP_GRPC_TARGET,
            reason: 'forwarding disabled by config'
        });
    }
    return new Promise((resolve) => {
        upstreamLogsClient.Export(requestPayload, {
            deadline: Date.now() + config_1.SIGNOZ_FORWARD_TIMEOUT_MS
        }, (error) => {
            if (error) {
                resolve({
                    attempted: true,
                    forwarded: false,
                    target: config_1.SIGNOZ_OTLP_GRPC_TARGET,
                    error: error.message
                });
                return;
            }
            resolve({
                attempted: true,
                forwarded: true,
                target: config_1.SIGNOZ_OTLP_GRPC_TARGET
            });
        });
    });
}
// One reusable handler keeps the three OTLP HTTP routes simple.
async function handleOtelHttpSignal(c, signalType) {
    const contentType = c.req.header('content-type') || 'application/octet-stream';
    const rawBody = await readBodyBuffer(c.req.raw);
    const stored = (0, local_store_1.saveRawPayload)(signalType, 'http', contentType, rawBody);
    try {
        const forwardResult = await forwardHttpToSigNoz(signalType, c.req.raw, rawBody, contentType);
        return c.json({
            ok: true,
            message: `${signalType} payload stored in memory and processed for SigNoz forwarding`,
            item: stored,
            total: local_store_1.storedPayloads.length,
            forward: forwardResult
        });
    }
    catch (error) {
        return c.json({
            ok: false,
            message: `${signalType} payload stored in memory but upstream forwarding failed`,
            item: stored,
            total: local_store_1.storedPayloads.length,
            forward: {
                attempted: true,
                forwarded: false,
                target: buildUpstreamHttpUrl(signalType),
                error: error instanceof Error ? error.message : String(error)
            }
        }, 502);
    }
}
async function handleGrpcLogsExport(call, callback) {
    const stored = (0, local_store_1.saveJsonPayload)('logs', 'grpc', 'application/grpc+proto', call.request);
    const forwardResult = await forwardGrpcLogsToSigNoz(call.request);
    if (forwardResult.forwarded || !forwardResult.attempted) {
        callback(null, {});
        return;
    }
    callback({
        code: grpc.status.UNAVAILABLE,
        name: 'UpstreamForwardFailed',
        message: forwardResult.error || 'failed to forward gRPC logs to SigNoz'
    });
    process.stderr.write(`custom-gateway gRPC forward failed for stored payload ${stored.id}: ${forwardResult.error || 'unknown error'}\n`);
}
app.get('/', (c) => {
    return c.json({
        ok: true,
        message: 'custom gateway is running',
        signozForward: {
            enabled: config_1.ENABLE_SIGNOZ_FORWARD,
            httpBaseUrl: config_1.SIGNOZ_OTLP_HTTP_BASE_URL,
            grpcTarget: config_1.SIGNOZ_OTLP_GRPC_TARGET
        },
        endpoints: [
            'POST /v1/logs',
            'POST /v1/traces',
            'POST /v1/metrics',
            `OTLP gRPC logs on :${config_1.GRPC_PORT} -> LogsService/Export`,
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
        storedPayloadCount: local_store_1.storedPayloads.length,
        httpPort: config_1.PORT,
        grpcPort: config_1.GRPC_PORT,
        signozForwardEnabled: config_1.ENABLE_SIGNOZ_FORWARD,
        signozOtlpHttpBaseUrl: config_1.SIGNOZ_OTLP_HTTP_BASE_URL,
        signozOtlpGrpcTarget: config_1.SIGNOZ_OTLP_GRPC_TARGET
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
        total: local_store_1.storedPayloads.length,
        storedPayloads: local_store_1.storedPayloads
    });
});
app.delete('/debug/store', (c) => {
    (0, local_store_1.clearStore)();
    return c.json({
        ok: true,
        message: 'memory store cleared',
        storedPayloadCount: 0
    });
});
const grpcServer = new grpc.Server();
grpcServer.addService(LogsService.service, {
    Export(call, callback) {
        void handleGrpcLogsExport(call, callback);
    }
});
(0, node_server_1.serve)({
    fetch: app.fetch,
    port: config_1.PORT
}, (info) => {
    process.stdout.write(`custom-gateway HTTP listening on http://127.0.0.1:${info.port}\n`);
});
grpcServer.bindAsync(`0.0.0.0:${config_1.GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (error, port) => {
    if (error) {
        throw error;
    }
    grpcServer.start();
    process.stdout.write(`custom-gateway gRPC listening on 127.0.0.1:${port}\n`);
});
