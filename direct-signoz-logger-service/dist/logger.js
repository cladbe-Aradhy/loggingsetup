"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const axiosClient = axios_1.default.create({
    timeout: 10000
});
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
function toOtlpAttributes(fields) {
    return Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({
        key,
        value: {
            stringValue: typeof value === 'string' ? value : JSON.stringify(value)
        }
    }));
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
async function sendToSigNoz(level, message, fields) {
    const payload = {
        resourceLogs: [
            {
                resource: {
                    attributes: [
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
                    ]
                },
                scopeLogs: [
                    {
                        scope: {
                            name: 'direct-signoz-logger',
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
                                attributes: toOtlpAttributes(fields)
                            }
                        ]
                    }
                ]
            }
        ]
    };
    try {
        await axiosClient.post(config_1.config.signozLogsUrl, payload, {
            headers: {
                'content-type': 'application/json'
            }
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error({
            level: 'error',
            message: 'failed to send log to signoz',
            signozLogsUrl: config_1.config.signozLogsUrl,
            originalMessage: message,
            sendError: errorMessage
        });
    }
}
function createLogger(bindings = {}) {
    function emit(level, message, fields = {}) {
        const mergedFields = {
            ...bindings,
            ...fields
        };
        consoleMirror(level, message, mergedFields);
        void sendToSigNoz(level, message, mergedFields);
    }
    return {
        child(childBindings = {}) {
            return createLogger({
                ...bindings,
                ...childBindings
            });
        },
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
}
exports.logger = createLogger();
