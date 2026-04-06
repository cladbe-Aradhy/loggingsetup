"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.observabilityRoutes = void 0;
const express_1 = require("express");
const observability_node_ts_1 = require("@my-org/observability-node-ts");
const router = (0, express_1.Router)();
exports.observabilityRoutes = router;
const DEMO_COMPONENT = 'mvc-package-demo';
function getRequestLogger(req) {
    return req.log || (0, observability_node_ts_1.getLogger)();
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function writeChunk(stream, chunk) {
    return new Promise((resolve, reject) => {
        stream.write(chunk, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
function createFakePinoLogger() {
    const calls = [];
    const createLevelHandler = (level) => (...args) => {
        calls.push({ level, args });
    };
    return {
        calls,
        debug: createLevelHandler('debug'),
        info: createLevelHandler('info'),
        warn: createLevelHandler('warn'),
        error: createLevelHandler('error'),
        fatal: createLevelHandler('fatal')
    };
}
function createFakeWinstonLogger() {
    const transports = [];
    function emit(level, message, fields) {
        const info = {
            level,
            message,
            ...(fields || {})
        };
        transports.forEach((transport) => {
            transport.log(info, () => undefined);
        });
    }
    return {
        transports,
        add(transport) {
            transports.push(transport);
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
router.get('/logger-tools', (req, res) => {
    const baseLogger = (0, observability_node_ts_1.getLogger)();
    const childLogger = (0, observability_node_ts_1.createChildLogger)({
        component: DEMO_COMPONENT,
        feature: 'logger-tools'
    });
    baseLogger.info('mvc package base logger route', {
        route: '/package/logger-tools'
    });
    childLogger.info('mvc package child logger route', {
        route: '/package/logger-tools'
    });
    getRequestLogger(req).info('mvc package request logger route', {
        route: '/package/logger-tools'
    });
    res.json({
        ok: true,
        usedExports: ['getLogger', 'createChildLogger']
    });
});
router.get('/span-metrics', async (req, res, next) => {
    try {
        const logger = (0, observability_node_ts_1.createChildLogger)({
            component: DEMO_COMPONENT,
            feature: 'span-metrics'
        });
        const manualSpan = (0, observability_node_ts_1.startSpan)('mvc.package.manual-span');
        manualSpan.setAttribute('mvc.package.route', '/package/span-metrics');
        manualSpan.end();
        const callbackResult = await (0, observability_node_ts_1.startSpan)('mvc.package.callback-span', {}, async (activeSpan) => {
            activeSpan.setAttribute('mvc.package.route', '/package/span-metrics');
            (0, observability_node_ts_1.incrementCounter)('mvc_package_demo_counter_total', 1, {
                route: '/package/span-metrics'
            });
            (0, observability_node_ts_1.recordHistogram)('mvc_package_demo_duration_ms', 42, {
                route: '/package/span-metrics'
            });
            (0, observability_node_ts_1.setGauge)('mvc_package_demo_last_value', 42, {
                route: '/package/span-metrics'
            });
            logger.info('mvc package span metrics route', {
                route: '/package/span-metrics'
            });
            await sleep(25);
            return 42;
        });
        res.json({
            ok: true,
            callbackResult,
            manualSpanEnded: true,
            usedExports: ['startSpan', 'incrementCounter', 'recordHistogram', 'setGauge']
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/record-exception', (req, res) => {
    const cause = new Error('Recorded exception root cause');
    const error = new Error('Manual package route exception');
    error.cause = cause;
    error.code = 'PACKAGE_RECORDED_EXCEPTION';
    error.statusCode = 499;
    (0, observability_node_ts_1.recordException)(error, {
        route: '/package/record-exception'
    });
    getRequestLogger(req).warn('mvc manual exception recorded', {
        route: '/package/record-exception',
        error
    });
    res.status(202).json({
        ok: true,
        code: error.code,
        usedExports: ['recordException']
    });
});
router.get('/pino-stream', async (_req, res, next) => {
    try {
        const stream = observability_node_ts_1.adapters.pino.createPinoStreamAdapter({
            component: DEMO_COMPONENT,
            route: '/package/pino-stream'
        });
        await writeChunk(stream, Buffer.from(JSON.stringify({
            level: 50,
            route: '/package/pino-stream',
            err: {
                message: 'mvc fake pino stream error',
                code: 'MVC_PINO_STREAM'
            }
        })));
        res.json({
            ok: true,
            forwarded: true,
            usedExports: ['adapters.pino.createPinoStreamAdapter']
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/pino-instrument', (req, res) => {
    const fakePinoLogger = createFakePinoLogger();
    const instrumented = observability_node_ts_1.adapters.pino.instrumentPinoLogger(fakePinoLogger, {
        component: DEMO_COMPONENT,
        route: '/package/pino-instrument'
    });
    const second = observability_node_ts_1.adapters.pino.instrumentPinoLogger(fakePinoLogger, {
        component: DEMO_COMPONENT,
        route: '/package/pino-instrument'
    });
    const error = new Error('mvc fake pino instrument error');
    error.code = 'MVC_PINO_INSTRUMENT';
    instrumented.error(error);
    getRequestLogger(req).info('mvc fake pino instrument route completed', {
        route: '/package/pino-instrument'
    });
    res.json({
        ok: true,
        originalLogCalls: fakePinoLogger.calls.length,
        sameLogger: instrumented === second,
        usedExports: ['adapters.pino.instrumentPinoLogger']
    });
});
router.get('/winston-transport', async (_req, res, next) => {
    try {
        const transport = observability_node_ts_1.adapters.winston.createWinstonTransport({
            component: DEMO_COMPONENT,
            route: '/package/winston-transport'
        });
        await new Promise((resolve) => {
            transport.log({
                level: 'warn',
                message: 'mvc fake winston transport log',
                route: '/package/winston-transport'
            }, resolve);
        });
        res.json({
            ok: true,
            forwarded: true,
            usedExports: ['adapters.winston.createWinstonTransport']
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/winston-instrument', (req, res) => {
    const fakeWinstonLogger = createFakeWinstonLogger();
    const first = observability_node_ts_1.adapters.winston.instrumentWinstonLogger(fakeWinstonLogger, {
        component: DEMO_COMPONENT,
        route: '/package/winston-instrument'
    });
    const second = observability_node_ts_1.adapters.winston.instrumentWinstonLogger(fakeWinstonLogger, {
        component: DEMO_COMPONENT,
        route: '/package/winston-instrument'
    });
    fakeWinstonLogger.warn('mvc fake winston instrument log', {
        route: '/package/winston-instrument'
    });
    getRequestLogger(req).info('mvc fake winston instrument route completed', {
        route: '/package/winston-instrument'
    });
    res.json({
        ok: true,
        addedTransportCount: fakeWinstonLogger.transports.length,
        reusedTransport: first.transport === second.transport,
        usedExports: ['adapters.winston.instrumentWinstonLogger']
    });
});
router.get('/express-error', (_req, _res, next) => {
    const error = new Error('Package express error middleware demo');
    error.code = 'PACKAGE_EXPRESS_ERROR';
    error.expose = true;
    error.statusCode = 418;
    next(error);
});
router.use(observability_node_ts_1.express.errorMiddleware);
