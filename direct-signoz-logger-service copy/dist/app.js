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
    const requestLogger = logger_1.logger.child({
        request_id: requestId,
        method: req.method,
        path: req.originalUrl || req.url
    });
    req.requestId = requestId;
    req.log = requestLogger;
    res.setHeader('x-request-id', requestId);
    requestLogger.info('request started');
    next();
});
app.get('/health', (req, res) => {
    req.log?.info('health route hit', {
        route: '/health'
    });
    res.json({
        ok: true,
        service: 'direct-signoz-logger-service'
    });
});
app.get('/logs/info', (req, res) => {
    req.log?.info('manual info route', {
        route: '/logs/info',
        feature: 'direct-logger'
    });
    res.json({
        ok: true,
        level: 'info'
    });
});
app.get('/logs/error', (req, res) => {
    req.log?.error('manual error route', {
        route: '/logs/error',
        code: 'DIRECT_LOGGER_ROUTE_ERROR'
    });
    res.status(500).json({
        ok: false,
        code: 'DIRECT_LOGGER_ROUTE_ERROR',
        message: 'manual error route'
    });
});
app.post('/orders', (req, res) => {
    const requestLogger = req.log || logger_1.logger;
    const { item, amount } = req.body ?? {};
    if (!item || amount === undefined) {
        requestLogger.error('order validation failed', {
            route: '/orders',
            code: 'MISSING_ORDER_FIELDS'
        });
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
    requestLogger.info('order created', {
        route: '/orders',
        order_id: order.id,
        amount: order.amount,
        status: order.status
    });
    res.status(201).json({
        ok: true,
        order
    });
});
