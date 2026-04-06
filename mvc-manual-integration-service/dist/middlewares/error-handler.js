"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const observability_node_ts_1 = require("@my-org/observability-node-ts");
const app_error_1 = require("../models/app-error");
function errorHandler(error, req, res, _next) {
    const requestLogger = req.log || (0, observability_node_ts_1.getLogger)();
    (0, observability_node_ts_1.recordException)(error);
    requestLogger.error('mvc request failed', {
        error,
        http_method: req.method,
        http_target: req.originalUrl || req.url
    });
    if (error instanceof app_error_1.AppError) {
        res.status(error.statusCode).json({
            ok: false,
            code: error.code,
            message: error.message
        });
        return;
    }
    if (error instanceof Error) {
        res.status(500).json({
            ok: false,
            code: 'INTERNAL_ERROR',
            message: error.message
        });
        return;
    }
    res.status(500).json({
        ok: false,
        code: 'UNKNOWN_ERROR',
        message: 'Something went wrong'
    });
}
