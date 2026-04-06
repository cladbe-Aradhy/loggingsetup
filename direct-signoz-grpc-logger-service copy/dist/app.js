"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = __importDefault(require("express"));
const logger_1 = require("./logger");
const app = (0, express_1.default)();
exports.app = app;
app.use(express_1.default.json());
app.use((req, res, next) => {
    const requestId = String(req.header('x-request-id') || node_crypto_1.default.randomUUID());
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    logger_1.logger.info('request started', {
        request_id: requestId,
        method: req.method,
        path: req.originalUrl || req.url
    });
    next();
});
function requestFields(req, res, extraFields = {}) {
    return {
        request_id: res.locals.requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        ...extraFields
    };
}
app.get('/health', (req, res) => {
    logger_1.logger.info('health route hit', requestFields(req, res, { route: '/health' }));
    res.json({
        ok: true,
        service: 'direct-signoz-grpc-logger-service'
    });
});
app.get('/logs/info', (req, res) => {
    logger_1.logger.info('manual info route', requestFields(req, res, {
        route: '/logs/info',
        feature: 'direct-grpc-logger'
    }));
    res.json({
        ok: true,
        level: 'info'
    });
});
app.get('/logs/error', (req, res) => {
    logger_1.logger.error('manual error route', requestFields(req, res, {
        route: '/logs/error',
        code: 'DIRECT_GRPC_LOGGER_ROUTE_ERROR'
    }));
    res.status(500).json({
        ok: false,
        code: 'DIRECT_GRPC_LOGGER_ROUTE_ERROR',
        message: 'manual error route'
    });
});
app.post('/orders', (req, res) => {
    const { item, amount } = req.body ?? {};
    if (!item || amount === undefined) {
        logger_1.logger.error('order validation failed', requestFields(req, res, {
            route: '/orders',
            code: 'MISSING_ORDER_FIELDS'
        }));
        res.status(400).json({
            ok: false,
            code: 'MISSING_ORDER_FIELDS',
            message: 'item and amount are required'
        });
        return;
    }
    const order = {
        id: node_crypto_1.default.randomUUID(),
        item: String(item).trim(),
        amount: Number(amount),
        status: 'created'
    };
    logger_1.logger.info('order created', requestFields(req, res, {
        route: '/orders',
        order_id: order.id,
        amount: order.amount,
        status: order.status
    }));
    res.status(201).json({
        ok: true,
        order
    });
});
