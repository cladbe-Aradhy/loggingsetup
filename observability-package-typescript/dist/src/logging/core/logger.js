'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { context, trace, SpanStatusCode } = require('@opentelemetry/api');
const { SeverityNumber } = require('@opentelemetry/api-logs');
const { getTraceContext } = require('./context');
const { normalizeSeverity, resolveSeverity } = require('./severity');
const { registerLogForDedupe, flushPendingLogDedupe } = require('./dedupe');
const { redactObject } = require('../../utils/redact');
const { serializeError } = require('../../utils/serialize-error');
const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    fatal: 50
};
const OTEL_SEVERITY_NUMBERS = {
    debug: SeverityNumber.DEBUG,
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
    fatal: SeverityNumber.FATAL
};
function shouldMirror(config) {
    if (!config.enableConsoleMirror) {
        return false;
    }
    if (!config.consoleMirrorInDevelopmentOnly) {
        return true;
    }
    return config.environment !== 'production';
}
function writeJsonLine(level, payload) {
    const line = JSON.stringify(payload) + '\n';
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(line);
}
function toOtelAttributes(record) {
    return Object.keys(record).reduce((attributes, key) => {
        const value = record[key];
        if (value === undefined) {
            return attributes;
        }
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
            attributes[key] = value;
            return attributes;
        }
        if (Array.isArray(value)) {
            attributes[key] = value.map((item) => {
                if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
                    return item;
                }
                return JSON.stringify(item);
            });
            return attributes;
        }
        attributes[key] = JSON.stringify(value);
        return attributes;
    }, {});
}
function annotateActiveSpan(level, message, errorValue) {
    const span = trace.getSpan(context.active());
    if (!span || !['warn', 'error', 'fatal'].includes(level)) {
        return;
    }
    span.setAttribute('app.log.severity', level);
    span.setAttribute('app.log.message', String(message || '').slice(0, 200));
    if (level === 'warn') {
        return;
    }
    span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(message || 'application error').slice(0, 200)
    });
    if (errorValue) {
        span.recordException(errorValue);
    }
}
function writeRecordToOutputs(state, config, level, record) {
    writeJsonLine(level, record);
    if (state.otelLogger) {
        try {
            state.otelLogger.emit({
                severityNumber: OTEL_SEVERITY_NUMBERS[level] || SeverityNumber.INFO,
                severityText: level.toUpperCase(),
                body: record.message,
                attributes: toOtelAttributes(record)
            });
        }
        catch (error) {
            if (config.debug && shouldMirror(config)) {
                process.stderr.write('observability log export failed: ' + error.message + '\n');
            }
        }
    }
}
function createLogger(config, state, bindings) {
    const baseBindings = bindings || {};
    const configuredLevel = normalizeSeverity(config.logLevel);
    function flushDedupeSummaries() {
        flushPendingLogDedupe(state, (summaryLevel, summaryRecord) => {
            writeRecordToOutputs(state, config, summaryLevel, summaryRecord);
        });
    }
    state.flushPendingLogDedupe = flushDedupeSummaries;
    function emit(level, message, fields, meta) {
        const resolvedLevel = meta && meta.lockLevel
            ? normalizeSeverity(level)
            : resolveSeverity({
                fallbackLevel: level,
                message,
                fields,
                args: meta && meta.args,
                smartSeverityDetection: config.smartSeverityDetection
            });
        if (config.emitOnlyWarnErrorFatal && !['warn', 'error', 'fatal'].includes(resolvedLevel)) {
            return;
        }
        if (LEVELS[resolvedLevel] < LEVELS[configuredLevel]) {
            return;
        }
        const safeFields = redactObject(fields || {}, config.redactKeys);
        const safeError = safeFields.err || safeFields.error;
        const traceContext = getTraceContext();
        const record = {
            timestamp: new Date().toISOString(),
            level: resolvedLevel,
            message,
            service: {
                name: config.serviceName,
                version: config.serviceVersion,
                environment: config.environment
            },
            ...traceContext,
            ...baseBindings,
            ...safeFields
        };
        if (safeError) {
            record.error = serializeError(safeError);
            delete record.err;
        }
        annotateActiveSpan(resolvedLevel, message, safeError);
        if (registerLogForDedupe(state, config, resolvedLevel, record, (summaryLevel, summaryRecord) => {
            writeRecordToOutputs(state, config, summaryLevel, summaryRecord);
        })) {
            return;
        }
        writeRecordToOutputs(state, config, resolvedLevel, record);
    }
    return {
        child(extraBindings) {
            return createLogger(config, state, {
                ...baseBindings,
                ...(extraBindings || {})
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
        },
        fatal(message, fields) {
            emit('fatal', message, fields);
        },
        emitWithArgs(level, message, fields, args, options) {
            emit(level, message, fields, {
                args,
                lockLevel: options && options.lockLevel
            });
        }
    };
}
module.exports = {
    createLogger,
    LEVELS,
    normalizeLevel: normalizeSeverity
};
