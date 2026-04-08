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
const node_server_1 = require("@hono/node-server");
const hono_1 = require("hono");
const config_1 = require("./config");
const local_store_1 = require("./storage/local-store");
const app = new hono_1.Hono();
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
const processingPayloadIds = new Set();
let isShuttingDown = false;
let isQueueScanRunning = false;
async function readBodyBuffer(request) {
    return Buffer.from(await request.arrayBuffer());
}
function isObjectPayload(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function buildGrpcUpstreamPayload(item) {
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
function looksLikeTimeout(result) {
    if (result.grpcCode === grpc.status.DEADLINE_EXCEEDED) {
        return true;
    }
    const value = `${result.error || ''}`.toLowerCase();
    return value.includes('timeout') || value.includes('deadline') || value.includes('aborted');
}
function looksLikeNetworkError(result) {
    const value = `${result.error || ''}`.toLowerCase();
    return (value.includes('econnrefused') ||
        value.includes('econnreset') ||
        value.includes('socket hang up') ||
        value.includes('enotfound') ||
        value.includes('ehostunreach') ||
        value.includes('network'));
}
function looksLikeSchemaError(result) {
    const value = `${result.responsePreview || ''} ${result.error || ''}`.toLowerCase();
    return value.includes('schema') || value.includes('field') || value.includes('invalid');
}
function createGrpcServiceError(message, code) {
    const error = new Error(message);
    error.code = code;
    error.details = message;
    error.metadata = new grpc.Metadata();
    return error;
}
function buildGrpcRetryMessage(item, forwardResult) {
    const failureReason = item.failureType || forwardResult.reason || forwardResult.error || 'retryable failure';
    return `gateway accepted the log payload but queued it for retry (${failureReason})`;
}
function buildGrpcDeadMessage(item, forwardResult) {
    const failureReason = item.failureType || forwardResult.reason || forwardResult.error || 'non-retryable failure';
    return `gateway rejected the log payload and moved it to dead queue (${failureReason})`;
}
function buildIngestRetryMessage(item, forwardResult) {
    const failureReason = item.failureType || forwardResult.reason || forwardResult.error || 'retryable failure';
    return `logs payload accepted and kept in retry queue for upstream gRPC forwarding (${failureReason})`;
}
function buildIngestDeadMessage(item, forwardResult) {
    const failureReason = item.failureType || forwardResult.reason || forwardResult.error || 'non-retryable failure';
    return `logs payload rejected for upstream gRPC forwarding and moved to dead queue (${failureReason})`;
}
function parseRetryAfterHeader(value) {
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
function parseGrpcRetryPushbackMs(error) {
    if (!error?.metadata) {
        return undefined;
    }
    const metadataMap = error.metadata.getMap();
    const pushbackValue = metadataMap['grpc-retry-pushback-ms'] || metadataMap['retry-after-ms'];
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
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
function calculateRetryDelayMs(nextAttemptCount) {
    const exponentialDelay = Math.min(config_1.RETRY_BASE_DELAY_MS * 2 ** Math.max(nextAttemptCount - 1, 0), config_1.RETRY_MAX_DELAY_MS);
    const jitterMultiplier = 0.8 + Math.random() * 0.4;
    return Math.max(500, Math.floor(exponentialDelay * jitterMultiplier));
}
function classifyFailureType(failureType) {
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
function classifyGrpcFailure(result) {
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
    return !isShuttingDown && (0, local_store_1.getLivePayloadCount)() < config_1.MAX_LIVE_QUEUE_SIZE;
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
                    error: error.message,
                    grpcCode: error.code,
                    retryAfterMs: parseGrpcRetryPushbackMs(error)
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
async function forwardStoredPayload(item) {
    const grpcPayload = buildGrpcUpstreamPayload(item);
    if (!grpcPayload.ok) {
        return {
            attempted: true,
            forwarded: false,
            target: config_1.SIGNOZ_OTLP_GRPC_TARGET,
            error: grpcPayload.error,
            grpcCode: grpc.status.INVALID_ARGUMENT,
            failureType: grpcPayload.failureType,
            responsePreview: grpcPayload.error
        };
    }
    return forwardGrpcLogsToSigNoz(grpcPayload.requestPayload);
}
async function tryForwardStoredPayload(item) {
    if (processingPayloadIds.has(item.id)) {
        return {
            attempted: false,
            forwarded: false,
            target: config_1.SIGNOZ_OTLP_GRPC_TARGET,
            reason: 'payload is already being processed'
        };
    }
    processingPayloadIds.add(item.id);
    try {
        const forwardResult = await forwardStoredPayload(item);
        if (forwardResult.forwarded) {
            (0, local_store_1.markPayloadAsForwarded)(item);
            return forwardResult;
        }
        const failureDecision = classifyGrpcFailure(forwardResult);
        if (!forwardResult.attempted) {
            (0, local_store_1.noteUnattemptedPayload)(item, failureDecision.failureType, forwardResult.reason || forwardResult.error || null);
            return forwardResult;
        }
        if (failureDecision.retryable) {
            (0, local_store_1.markPayloadForRetry)(item, failureDecision.failureType, forwardResult.error || forwardResult.reason || null, forwardResult.retryAfterMs ?? calculateRetryDelayMs(item.attemptCount + 1), forwardResult.grpcCode || null);
            return forwardResult;
        }
        (0, local_store_1.markPayloadAsDead)(item, failureDecision.failureType, forwardResult.error || forwardResult.reason || null, forwardResult.grpcCode || null);
        (0, local_store_1.trimDeadQueue)(config_1.MAX_DEAD_QUEUE_SIZE);
        return forwardResult;
    }
    finally {
        processingPayloadIds.delete(item.id);
    }
}
async function safelyProcessStoredPayload(item) {
    try {
        await tryForwardStoredPayload(item);
    }
    catch (error) {
        (0, local_store_1.markPayloadForRetry)(item, 'unknown', error instanceof Error ? error.message : String(error), calculateRetryDelayMs(item.attemptCount + 1));
    }
}
async function processPayloadBatch(items, concurrencyLimit) {
    const activeTasks = new Set();
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
    if (!config_1.ENABLE_SIGNOZ_FORWARD || isQueueScanRunning) {
        return;
    }
    isQueueScanRunning = true;
    try {
        await processPayloadBatch([...local_store_1.freshQueue], Math.max(1, config_1.QUEUE_PROCESSING_CONCURRENCY));
        const now = Date.now();
        const dueRetryItems = [...local_store_1.retryQueue].filter((item) => {
            return !item.nextRetryAt || Date.parse(item.nextRetryAt) <= now;
        });
        await processPayloadBatch(dueRetryItems, Math.max(1, config_1.QUEUE_PROCESSING_CONCURRENCY));
        (0, local_store_1.trimDeadQueue)(config_1.MAX_DEAD_QUEUE_SIZE);
    }
    finally {
        isQueueScanRunning = false;
    }
}
async function handleHttpLogs(c) {
    if (isShuttingDown) {
        return c.json({
            ok: false,
            message: 'gateway is shutting down and not accepting new logs'
        }, 503);
    }
    if ((0, local_store_1.getLivePayloadCount)() >= config_1.MAX_LIVE_QUEUE_SIZE) {
        return c.json({
            ok: false,
            message: 'live in-memory queue is full',
            queueCounts: (0, local_store_1.getQueueCounts)()
        }, 503);
    }
    const contentType = c.req.header('content-type') || 'application/octet-stream';
    const rawBody = await readBodyBuffer(c.req.raw);
    const { item: stored, isDuplicate } = (0, local_store_1.saveRawPayload)('logs', 'http', contentType, rawBody);
    if (isDuplicate) {
        return c.json({
            ok: true,
            message: 'logs payload already exists in active in-memory queue',
            item: stored,
            queueCounts: (0, local_store_1.getQueueCounts)(),
            duplicate: true
        }, 202);
    }
    try {
        const forwardResult = await tryForwardStoredPayload(stored);
        if (forwardResult.forwarded) {
            return c.json({
                ok: true,
                message: 'logs payload forwarded to SigNoz',
                item: stored,
                queueCounts: (0, local_store_1.getQueueCounts)(),
                forward: forwardResult
            });
        }
        if (stored.state === 'dead') {
            return c.json({
                ok: false,
                message: buildIngestDeadMessage(stored, forwardResult),
                item: stored,
                queueCounts: (0, local_store_1.getQueueCounts)(),
                forward: forwardResult
            }, 422);
        }
        return c.json({
            ok: true,
            message: buildIngestRetryMessage(stored, forwardResult),
            item: stored,
            queueCounts: (0, local_store_1.getQueueCounts)(),
            forward: forwardResult
        }, 202);
    }
    catch (error) {
        return c.json({
            ok: true,
            message: 'logs payload accepted and kept in memory after an unexpected forwarding error',
            item: stored,
            queueCounts: (0, local_store_1.getQueueCounts)(),
            forward: {
                attempted: true,
                forwarded: false,
                target: config_1.SIGNOZ_OTLP_GRPC_TARGET,
                error: error instanceof Error ? error.message : String(error)
            }
        }, 202);
    }
}
async function handleGrpcLogsExport(call, callback) {
    if (isShuttingDown) {
        callback(createGrpcServiceError('gateway is shutting down and not accepting new logs', grpc.status.UNAVAILABLE));
        return;
    }
    if (!canAcceptNewPayload()) {
        callback(createGrpcServiceError('live in-memory queue is full', grpc.status.RESOURCE_EXHAUSTED));
        return;
    }
    try {
        const { item: stored, isDuplicate } = (0, local_store_1.saveJsonPayload)('logs', 'grpc', 'application/grpc+proto', call.request);
        if (isDuplicate) {
            callback(createGrpcServiceError('gateway already has the same log payload in active in-memory queue', grpc.status.ALREADY_EXISTS));
            return;
        }
        const forwardResult = await tryForwardStoredPayload(stored);
        if (forwardResult.forwarded) {
            callback(null, {});
            return;
        }
        if (stored.state === 'dead') {
            callback(createGrpcServiceError(buildGrpcDeadMessage(stored, forwardResult), stored.lastGrpcCode ?? grpc.status.INVALID_ARGUMENT));
            return;
        }
        callback(createGrpcServiceError(buildGrpcRetryMessage(stored, forwardResult), grpc.status.UNAVAILABLE));
    }
    catch (error) {
        callback(createGrpcServiceError(error instanceof Error ? error.message : String(error), grpc.status.INTERNAL));
    }
}
async function drainQueuesBeforeShutdown() {
    const deadline = Date.now() + config_1.SHUTDOWN_DRAIN_TIMEOUT_MS;
    while ((0, local_store_1.getLivePayloadCount)() > 0 && Date.now() < deadline) {
        await processStoredPayloadQueue();
        if ((0, local_store_1.getLivePayloadCount)() === 0) {
            return;
        }
        await sleep(250);
    }
}
async function closeHttpServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
async function closeGrpcServer(server) {
    return new Promise((resolve) => {
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
            enabled: config_1.ENABLE_SIGNOZ_FORWARD,
            upstreamProtocol: 'grpc',
            grpcTarget: config_1.SIGNOZ_OTLP_GRPC_TARGET
        },
        queueCounts: (0, local_store_1.getQueueCounts)(),
        endpoints: [
            'POST /v1/logs',
            `OTLP gRPC logs on :${config_1.GRPC_PORT} -> LogsService/Export`,
            'GET /health',
            'GET /debug/store',
            'DELETE /debug/store'
        ]
    });
});
app.get('/health', (c) => {
    const statusCode = isShuttingDown ? 503 : 200;
    return c.json({
        ok: !isShuttingDown,
        service: 'custom-gateway',
        shuttingDown: isShuttingDown,
        acceptingTraffic: !isShuttingDown,
        queueCounts: (0, local_store_1.getQueueCounts)(),
        deadQueueOverflow: local_store_1.deadQueueOverflow,
        httpPort: config_1.PORT,
        grpcPort: config_1.GRPC_PORT,
        signozForwardEnabled: config_1.ENABLE_SIGNOZ_FORWARD,
        signozForwardProtocol: 'grpc',
        signozOtlpGrpcTarget: config_1.SIGNOZ_OTLP_GRPC_TARGET
    }, statusCode);
});
app.post('/v1/logs', async (c) => {
    return handleHttpLogs(c);
});
app.get('/debug/store', (c) => {
    return c.json({
        ok: true,
        shuttingDown: isShuttingDown,
        queueCounts: (0, local_store_1.getQueueCounts)(),
        deadQueueOverflow: local_store_1.deadQueueOverflow,
        freshQueue: local_store_1.freshQueue,
        retryQueue: local_store_1.retryQueue,
        deadQueue: local_store_1.deadQueue,
        allStoredPayloads: (0, local_store_1.getAllStoredPayloads)()
    });
});
app.delete('/debug/store', (c) => {
    (0, local_store_1.clearStore)();
    return c.json({
        ok: true,
        message: 'memory store cleared',
        queueCounts: (0, local_store_1.getQueueCounts)()
    });
});
////////////////////////////////////////////////////////////////////
const grpcServer = new grpc.Server();
grpcServer.addService(LogsService.service, {
    Export(call, callback) {
        void handleGrpcLogsExport(call, callback);
    }
});
const retryInterval = setInterval(() => {
    void processStoredPayloadQueue();
}, config_1.QUEUE_RETRY_INTERVAL_MS);
const httpServer = (0, node_server_1.serve)({
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
async function startGracefulShutdown(signal) {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;
    clearInterval(retryInterval);
    process.stdout.write(`received ${signal}, stopping new traffic and draining in-memory queues\n`);
    await Promise.allSettled([
        closeHttpServer(httpServer),
        closeGrpcServer(grpcServer)
    ]);
    await drainQueuesBeforeShutdown();
    const remainingLivePayloads = (0, local_store_1.getLivePayloadCount)();
    if (remainingLivePayloads > 0) {
        process.stdout.write(`shutdown finished with ${remainingLivePayloads} live payloads still in memory\n`);
    }
    else {
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
