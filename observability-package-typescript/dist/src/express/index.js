'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require('crypto');
const { context, trace } = require('@opentelemetry/api');
const { recordException } = require('../errors');
const { getLevelFromStatus } = require('../utils/http-status');
function normalizeRequestIdHeaderValue(value) {
    if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === 'string' && item.trim());
        return first || crypto.randomUUID();
    }
    if (typeof value === 'string' && value.trim()) {
        return value;
    }
    return crypto.randomUUID();
}
function normalizeErrorStatusCode(error) {
    const rawStatusCode = error && (error.statusCode ?? error.status);
    const normalized = typeof rawStatusCode === 'string'
        ? Number(rawStatusCode)
        : rawStatusCode;
    if (Number.isInteger(normalized) && normalized >= 400 && normalized <= 599) {
        return normalized;
    }
    return 500;
}
function captureErrorResponsePreview(res) {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    function assignPreview(body) {
        if (body === null || body === undefined) {
            return;
        }
        if (typeof body === 'object') {
            res.locals = res.locals || {};
            res.locals.observability_response_preview = {
                error: body.error,
                message: body.message,
                code: body.code,
                status: body.status,
                statusCode: body.statusCode
            };
            return;
        }
        if (typeof body === 'string') {
            res.locals = res.locals || {};
            res.locals.observability_response_preview = {
                message: body.slice(0, 200)
            };
        }
    }
    res.json = function patchedJson(body) {
        assignPreview(body);
        return originalJson(body);
    };
    res.send = function patchedSend(body) {
        assignPreview(body);
        return originalSend(body);
    };
}
function getRoutePattern(req) {
    if (req.route && req.route.path) {
        return req.baseUrl ? req.baseUrl + req.route.path : req.route.path;
    }
    return req.path || req.originalUrl || req.url || 'unknown';
}
function createRequestContextMiddleware(getLogger) {
    return function requestContextMiddleware(req, res, next) {
        const requestId = normalizeRequestIdHeaderValue(req.headers['x-request-id']);
        req.requestId = requestId;
        req.log = getLogger().child({
            request_id: requestId,
            method: req.method,
            path: req.originalUrl || req.url
        });
        res.setHeader('x-request-id', requestId);
        next();
    };
}
function createRequestLoggingMiddleware(metricsRuntime) {
    return function requestLoggingMiddleware(req, res, next) {
        const startedAt = process.hrtime.bigint();
        const logger = req.log;
        captureErrorResponsePreview(res);
        if (logger) {
            logger.info('request started', {
                http_method: req.method,
                http_target: req.originalUrl || req.url
            });
        }
        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            const route = getRoutePattern(req);
            const attributes = {
                http_method: req.method,
                http_route: route,
                http_status_code: res.statusCode
            };
            const standardAttributes = {
                'http.request.method': req.method,
                'http.response.status_code': res.statusCode,
                'http.route': route,
                'url.scheme': req.protocol || 'http',
                'server.address': req.hostname || 'localhost'
            };
            metricsRuntime.requestCount.add(1, attributes);
            metricsRuntime.requestDuration.record(durationMs, attributes);
            metricsRuntime.standardRequestCount.add(1, standardAttributes);
            metricsRuntime.standardRequestDuration.record(durationMs / 1000, standardAttributes);
            if (res.statusCode >= 400) {
                metricsRuntime.requestErrorCount.add(1, attributes);
                metricsRuntime.standardRequestErrors.add(1, standardAttributes);
            }
            if (logger) {
                const completionFields = {
                    ...attributes,
                    duration_ms: Number(durationMs.toFixed(2)),
                    response_preview: res.locals && res.locals.observability_response_preview
                };
                const level = getLevelFromStatus(res.statusCode);
                if (level === 'error') {
                    logger.emitWithArgs('error', 'request completed with server error', completionFields, [], {
                        lockLevel: true
                    });
                    return;
                }
                if (level === 'warn') {
                    logger.emitWithArgs('warn', 'request completed with client warning', completionFields, [], {
                        lockLevel: true
                    });
                    return;
                }
                logger.info('request completed', completionFields);
            }
        });
        next();
    };
}
function createErrorMiddleware(getLogger) {
    return function observabilityErrorMiddleware(error, req, res, next) {
        recordException(error);
        const statusCode = normalizeErrorStatusCode(error);
        const activeSpan = trace.getSpan(context.active());
        if (activeSpan && req) {
            activeSpan.setAttribute('app.error', true);
        }
        const logger = req && req.log ? req.log : getLogger();
        logger.error('express request failed', {
            error,
            http_status_code: statusCode,
            http_method: req && req.method,
            http_target: req && (req.originalUrl || req.url)
        });
        if (res.headersSent) {
            return next(error);
        }
        res.status(statusCode).json({
            ok: false,
            message: error.expose ? error.message : 'Internal Server Error',
            requestId: req && req.requestId
        });
    };
}
module.exports = {
    createRequestContextMiddleware,
    createRequestLoggingMiddleware,
    createErrorMiddleware,
    normalizeErrorStatusCode,
    normalizeRequestIdHeaderValue
};
