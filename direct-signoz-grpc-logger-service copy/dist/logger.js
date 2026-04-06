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
exports.logger = void 0;
exports.shutdownLogger = shutdownLogger;
const node_path_1 = __importDefault(require("node:path"));
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
const config_1 = require("./config");
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
const LogsServiceClient = loadedDefinition.opentelemetry.proto.collector.logs.v1.LogsService;
function usesTls(target) {
    return target.startsWith('https://') || target.startsWith('grpcs://');
}
function normalizeGrpcTarget(target) {
    return target.replace(/^[a-z]+:\/\//i, '');
}
const client = new LogsServiceClient(normalizeGrpcTarget(config_1.config.signozLogsGrpcUrl), usesTls(config_1.config.signozLogsGrpcUrl)
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure());
const pendingExports = new Set();
const resourceAttributes = [
    {
        key: 'service.name',
        value: {
            stringValue: config_1.config.serviceName
        }
    },
    {
        key: 'service.version',
        value: {
            stringValue: config_1.config.serviceVersion
        }
    },
    {
        key: 'deployment.environment.name',
        value: {
            stringValue: config_1.config.nodeEnv
        }
    }
];
function toSeverityNumber(level) {
    if (level === 'error') {
        return 17;
    }
    if (level === 'warn') {
        return 13;
    }
    if (level === 'debug') {
        return 5;
    }
    return 9;
}
function consoleMirror(level, message, fields) {
    if (!config_1.config.enableConsoleMirror) {
        return;
    }
    const payload = {
        level,
        message,
        ...fields
    };
    if (level === 'error') {
        console.error(payload);
        return;
    }
    if (level === 'warn') {
        console.warn(payload);
        return;
    }
    console.log(payload);
}
// Convert normal JS values into OTLP AnyValue shapes.
function toAnyValue(value) {
    if (typeof value === 'string' ||
        value === null ||
        value === undefined) {
        return {
            stringValue: value == null ? 'null' : value
        };
    }
    if (typeof value === 'boolean') {
        return {
            boolValue: value
        };
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return {
                intValue: String(value)
            };
        }
        return {
            doubleValue: value
        };
    }
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
        return {
            bytesValue: Buffer.from(value)
        };
    }
    if (Array.isArray(value)) {
        return {
            arrayValue: {
                values: value.map((item) => toAnyValue(item))
            }
        };
    }
    if (value instanceof Error) {
        return {
            kvlistValue: {
                values: [
                    {
                        key: 'name',
                        value: {
                            stringValue: value.name
                        }
                    },
                    {
                        key: 'message',
                        value: {
                            stringValue: value.message
                        }
                    },
                    {
                        key: 'stack',
                        value: {
                            stringValue: value.stack || ''
                        }
                    }
                ]
            }
        };
    }
    if (typeof value === 'object') {
        return {
            kvlistValue: {
                values: Object.entries(value).map(([key, nestedValue]) => ({
                    key,
                    value: toAnyValue(nestedValue)
                }))
            }
        };
    }
    return {
        stringValue: String(value)
    };
}
function toKeyValues(fields) {
    return Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({
        key,
        value: toAnyValue(value)
    }));
}
function sendToSigNoz(level, message, fields) {
    const requestPayload = {
        resourceLogs: [
            {
                resource: {
                    attributes: resourceAttributes
                },
                scopeLogs: [
                    {
                        scope: {
                            name: 'direct-signoz-grpc-logger',
                            version: '1.0.0'
                        },
                        logRecords: [
                            {
                                timeUnixNano: String(Date.now() * 1_000_000),
                                severityNumber: toSeverityNumber(level),
                                severityText: level.toUpperCase(),
                                body: {
                                    stringValue: message
                                },
                                attributes: toKeyValues(fields)
                            }
                        ]
                    }
                ]
            }
        ]
    };
    const exportPromise = new Promise((resolve) => {
        client.Export(requestPayload, (error) => {
            if (error) {
                console.error({
                    level: 'error',
                    message: 'failed to send log to signoz over grpc',
                    signozLogsGrpcUrl: config_1.config.signozLogsGrpcUrl,
                    originalMessage: message,
                    sendError: error.message
                });
            }
            resolve();
        });
    });
    pendingExports.add(exportPromise);
    void exportPromise.finally(() => {
        pendingExports.delete(exportPromise);
    });
}
function emit(level, message, fields = {}) {
    consoleMirror(level, message, fields);
    sendToSigNoz(level, message, fields);
}
async function shutdownLogger() {
    await Promise.allSettled([...pendingExports]);
    await new Promise((resolve) => {
        client.close();
        resolve();
    });
}
exports.logger = {
    debug(message, fields) {
        emit('debug', message, fields);
    },
    info(message, fields) {
        emit('info', message, fields);
    },
    warn(message, fields) {
        emit('warn', message, fields);
    },
    error(message, fields) {
        emit('error', message, fields);
    }
};
