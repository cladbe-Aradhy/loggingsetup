'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { context, trace, SpanStatusCode } = require('@opentelemetry/api');
const { serializeError } = require('../utils/serialize-error');
function normalizeErrorLike(errorLike) {
    if (errorLike instanceof Error) {
        return errorLike;
    }
    if (errorLike && typeof errorLike === 'object') {
        const message = typeof errorLike.message === 'string' && errorLike.message.trim()
            ? errorLike.message
            : 'Non-Error rejection';
        const error = new Error(message);
        if (typeof errorLike.name === 'string' && errorLike.name.trim()) {
            error.name = errorLike.name;
        }
        Object.keys(errorLike).forEach((key) => {
            if (key === 'name' || key === 'message') {
                return;
            }
            error[key] = errorLike[key];
        });
        return error;
    }
    return new Error(String(errorLike));
}
function recordException(error, options) {
    const activeSpan = (options && options.span) || trace.getSpan(context.active());
    if (activeSpan && error) {
        activeSpan.recordException(error);
        activeSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message || String(error)
        });
    }
}
function installProcessErrorHandlers(config, logger, shutdownObservability) {
    const listeners = [];
    async function handleFatal(eventName, errorLike) {
        const error = normalizeErrorLike(errorLike);
        recordException(error);
        logger.error(eventName + ' captured', {
            error: serializeError(error),
            fatal: true
        });
        const forceExitTimer = setTimeout(() => {
            process.exit(1);
        }, config.shutdownTimeoutMillis || 5000);
        if (typeof forceExitTimer.unref === 'function') {
            forceExitTimer.unref();
        }
        try {
            await shutdownObservability({
                reason: eventName
            });
        }
        catch (shutdownError) {
            process.stderr.write('observability shutdown error during ' + eventName + ': ' + shutdownError.message + '\n');
        }
        finally {
            process.exit(1);
        }
    }
    function addListener(eventName, handler) {
        process.on(eventName, handler);
        listeners.push({ eventName, handler });
    }
    if (config.captureUncaught) {
        addListener('uncaughtException', async (error) => {
            await handleFatal('uncaughtException', error);
        });
    }
    if (config.captureUnhandledRejection) {
        addListener('unhandledRejection', async (reason) => {
            await handleFatal('unhandledRejection', reason);
        });
    }
    return function removeListeners() {
        listeners.forEach(({ eventName, handler }) => {
            process.removeListener(eventName, handler);
        });
    };
}
module.exports = {
    recordException,
    installProcessErrorHandlers,
    normalizeErrorLike
};
