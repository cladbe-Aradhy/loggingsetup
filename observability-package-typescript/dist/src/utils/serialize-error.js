'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
function serializeError(error) {
    return serializeErrorValue(error);
}
function serializeErrorValue(error) {
    if (!error) {
        return null;
    }
    if (error instanceof Error) {
        const serialized = {
            name: error.name,
            message: error.message,
            stack: error.stack
        };
        if (error.code !== undefined) {
            serialized.code = error.code;
        }
        if (error.status !== undefined) {
            serialized.status = error.status;
        }
        if (error.statusCode !== undefined) {
            serialized.statusCode = error.statusCode;
        }
        if (error.cause !== undefined) {
            serialized.cause = serializeErrorValue(error.cause);
        }
        return serialized;
    }
    if (typeof error === 'object') {
        const serialized = {
            ...error
        };
        if (serialized.cause !== undefined) {
            serialized.cause = serializeErrorValue(serialized.cause);
        }
        return serialized;
    }
    return {
        message: String(error)
    };
}
module.exports = {
    serializeError
};
