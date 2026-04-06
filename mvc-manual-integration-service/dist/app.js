"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const error_handler_1 = require("./middlewares/error-handler");
const not_found_1 = require("./middlewares/not-found");
const observability_routes_1 = require("./routes/observability.routes");
const order_routes_1 = require("./routes/order.routes");
const user_routes_1 = require("./routes/user.routes");
const observability_node_ts_1 = require("@my-org/observability-node-ts");
const DEDUPE_WINDOW_MS = 3000;
const DEFAULT_DEDUPE_BURST_COUNT = 5;
const DEFAULT_DEDUPE_WAIT_MS = DEDUPE_WINDOW_MS + 200;
const MAX_DEDUPE_BURST_COUNT = 25;
const MAX_DEDUPE_WAIT_MS = 10000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizePositiveInt(value, fallback, min, max) {
    const normalized = Number(value);
    if (!Number.isInteger(normalized)) {
        return fallback;
    }
    if (normalized < min) {
        return min;
    }
    if (normalized > max) {
        return max;
    }
    return normalized;
}
const app = (0, express_1.default)();
exports.app = app;
app.use(express_1.default.json());
app.use(observability_node_ts_1.express.requestContextMiddleware);
app.use(observability_node_ts_1.express.requestLoggingMiddleware);
//some fuynctiion call
console.log("data");
app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'mvc-manual-integration-service'
    });
});
app.get('/coverage', (_req, res) => {
    res.json({
        ok: true,
        routes: [
            'GET /health',
            'GET /coverage',
            'GET /dedupe/error-burst',
            'GET /package/logger-tools',
            'GET /package/span-metrics',
            'GET /package/record-exception',
            'GET /package/pino-stream',
            'GET /package/pino-instrument',
            'GET /package/winston-transport',
            'GET /package/winston-instrument',
            'GET /package/express-error',
            'GET /users',
            'GET /users/:id',
            'POST /users',
            'GET /orders',
            'GET /orders/:id',
            'POST /orders',
            'PATCH /orders/:id/pay'
        ]
    });
});
app.get('/dedupe/error-burst', async (req, res) => {
    const logger = req.log || (0, observability_node_ts_1.getLogger)();
    const count = normalizePositiveInt(req.query.count, DEFAULT_DEDUPE_BURST_COUNT, 1, MAX_DEDUPE_BURST_COUNT);
    const waitMs = normalizePositiveInt(req.query.waitMs, DEFAULT_DEDUPE_WAIT_MS, 0, MAX_DEDUPE_WAIT_MS);
    const errorMeta = {
        name: 'DemoDatabaseError',
        message: 'DB failed',
        code: 'MVC_DEDUPE_DEMO'
    };
    for (let index = 0; index < count; index += 1) {
        logger.error('mvc dedupe demo: DB failed', {
            error: errorMeta,
            dedupe_demo: true,
            http_method: req.method,
            http_route: '/dedupe/error-burst'
        });
    }
    if (waitMs > 0) {
        await sleep(waitMs);
    }
    res.json({
        ok: true,
        emitted_count: count,
        wait_ms: waitMs,
        dedupe_window_ms: DEDUPE_WINDOW_MS,
        expected_raw_logs: 1,
        expected_summary_logs: count > 1 ? 1 : 0
    });
});
app.use('/package', observability_routes_1.observabilityRoutes);
app.use('/users', user_routes_1.userRoutes);
app.use('/orders', order_routes_1.orderRoutes);
app.use(not_found_1.notFoundHandler);
app.use(error_handler_1.errorHandler);
