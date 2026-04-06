'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { Writable } = require('stream');
const { resolveSeverity } = require('../../core/severity');
const PINO_INSTRUMENTED_SYMBOL = Symbol.for('observability.pino.instrumented');
function toFields(chunk) {
    if (!chunk) {
        return {};
    }
    if (Buffer.isBuffer(chunk)) {
        return toFields(chunk.toString('utf8'));
    }
    if (typeof chunk === 'object') {
        return chunk;
    }
    try {
        return JSON.parse(String(chunk));
    }
    catch (error) {
        return { raw: String(chunk).trim() };
    }
}
function resolvePinoMessage(record, fallbackMessage) {
    if (typeof record.msg === 'string' && record.msg.trim()) {
        return record.msg;
    }
    if (typeof record.message === 'string' && record.message.trim()) {
        return record.message;
    }
    if (record.err && typeof record.err.message === 'string' && record.err.message.trim()) {
        return record.err.message;
    }
    if (record.error && typeof record.error.message === 'string' && record.error.message.trim()) {
        return record.error.message;
    }
    return fallbackMessage;
}
function mapLevel(level) {
    const stringLevel = String(level || '').toLowerCase();
    if (stringLevel.includes('fatal') || stringLevel === '60') {
        return 'fatal';
    }
    if (stringLevel.includes('debug')) {
        return 'debug';
    }
    if (stringLevel.includes('warn')) {
        return 'warn';
    }
    if (stringLevel.includes('error') || stringLevel === '50' || stringLevel === '60') {
        return 'error';
    }
    return 'info';
}
function createPinoStreamAdapter(logger, bindings) {
    return new Writable({
        write(chunk, encoding, callback) {
            try {
                const record = toFields(chunk);
                const level = mapLevel(record.level);
                const message = resolvePinoMessage(record, 'pino log');
                const forwardedRecord = {
                    ...record
                };
                delete forwardedRecord.level;
                delete forwardedRecord.msg;
                delete forwardedRecord.message;
                delete forwardedRecord.service;
                delete forwardedRecord.timestamp;
                delete forwardedRecord.trace_id;
                delete forwardedRecord.span_id;
                const resolvedLevel = resolveSeverity({
                    fallbackLevel: level,
                    message,
                    fields: forwardedRecord
                });
                logger[resolvedLevel] ? logger[resolvedLevel](message, {
                    logger_type: 'pino',
                    ...(bindings || {}),
                    pino_level: record.level,
                    ...forwardedRecord
                }) : logger.error(message, {
                    logger_type: 'pino',
                    ...(bindings || {}),
                    pino_level: record.level,
                    ...forwardedRecord
                });
                callback();
            }
            catch (error) {
                callback(error);
            }
        }
    });
}
function instrumentPinoLogger(pinoLogger, packageLogger, bindings) {
    if (pinoLogger[PINO_INSTRUMENTED_SYMBOL]) {
        return pinoLogger;
    }
    pinoLogger[PINO_INSTRUMENTED_SYMBOL] = true;
    ['debug', 'info', 'warn', 'error', 'fatal'].forEach((level) => {
        if (typeof pinoLogger[level] !== 'function') {
            return;
        }
        const original = pinoLogger[level].bind(pinoLogger);
        pinoLogger[level] = function patchedPinoLogger() {
            const args = Array.from(arguments);
            const [first, second] = args;
            let fields = {};
            let message = level + ' log';
            if (typeof first === 'object' && first !== null) {
                fields = first;
                if (typeof second === 'string') {
                    message = second;
                }
                else if (typeof first.message === 'string' && first.message.trim()) {
                    message = first.message;
                }
            }
            else if (typeof first === 'string') {
                message = first;
                if (typeof second === 'object' && second !== null) {
                    fields = second;
                }
            }
            const resolvedLevel = resolveSeverity({
                fallbackLevel: level,
                message,
                fields
            });
            packageLogger[resolvedLevel] ? packageLogger[resolvedLevel](message, {
                logger_type: 'pino',
                ...(bindings || {}),
                ...fields
            }) : packageLogger.error(message, {
                logger_type: 'pino',
                ...(bindings || {}),
                ...fields
            });
            return original.apply(pinoLogger, args);
        };
    });
    return pinoLogger;
}
module.exports = {
    createPinoStreamAdapter,
    instrumentPinoLogger,
    resolvePinoMessage
};
