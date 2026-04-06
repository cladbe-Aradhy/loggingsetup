'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
async function main() {
    const express = require('express');
    const { initObservability, shutdownObservability, getLogger, startSpan, incrementCounter, recordHistogram, express: observabilityExpress } = require('../..');
    const { sleep } = require('../../src/runtime');
    await initObservability({
        serviceName: 'basic-express-app',
        serviceVersion: '1.0.0',
        enableConsoleCapture: true,
        enableConsoleMirror: true,
        extraResourceAttributes: {
            'app.role': 'example'
        }
    });
    const app = express();
    const logger = getLogger();
    app.use(express.json());
    app.use(observabilityExpress.requestContextMiddleware);
    app.use(observabilityExpress.requestLoggingMiddleware);
    app.get('/health', (req, res) => {
        req.log.info('health check route hit');
        res.json({ ok: true });
    });
    app.get('/success', (req, res) => {
        logger.info('success route called', {
            source: 'basic-example'
        });
        res.json({ ok: true, message: 'success' });
    });
    app.get('/error', (req, res, next) => {
        const error = new Error('Intentional example error');
        error.statusCode = 500;
        next(error);
    });
    app.get('/slow', async (req, res) => {
        await sleep(1200);
        recordHistogram('example_slow_route_delay_ms', 1200, {
            route: '/slow'
        });
        res.json({ ok: true, delayedMs: 1200 });
    });
    app.get('/nested', async (req, res, next) => {
        try {
            const result = await startSpan('nested.controller', {}, async () => {
                req.log.info('nested route started');
                const serviceResult = await startSpan('nested.service', {}, async () => {
                    incrementCounter('example_nested_calls_total', 1, {
                        route: '/nested'
                    });
                    return startSpan('nested.repository', {}, async () => {
                        await sleep(150);
                        recordHistogram('example_nested_repository_duration_ms', 150, {
                            route: '/nested'
                        });
                        return { items: ['a', 'b', 'c'] };
                    });
                });
                return {
                    ok: true,
                    serviceResult
                };
            });
            res.json(result);
        }
        catch (error) {
            next(error);
        }
    });
    app.use(observabilityExpress.errorMiddleware);
    const port = Number(process.env.PORT || 3001);
    const server = app.listen(port, () => {
        logger.info('basic express example listening', {
            port
        });
    });
    async function stop() {
        server.close(async () => {
            await shutdownObservability();
            process.exit(0);
        });
    }
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
main().catch((error) => {
    process.stderr.write(error.stack + '\n');
    process.exit(1);
});
