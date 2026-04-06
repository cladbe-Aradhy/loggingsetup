'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
async function main() {
    const express = require('express');
    const pino = require('pino');
    const { initObservability, shutdownObservability, startSpan, incrementCounter, recordHistogram, setGauge, adapters, express: observabilityExpress } = require('../..');
    const { sleep } = require('../../src/runtime');
    await initObservability({
        serviceName: 'pino-express-app',
        serviceVersion: '1.0.0',
        logLevel: 'debug'
    });
    const app = express();
    const stream = adapters.pino.createPinoStreamAdapter({
        component: 'pino-example'
    });
    const pinoLogger = pino({
        level: 'debug',
        base: {
            service: 'pino-express-app'
        }
    }, stream);
    app.use(express.json());
    app.use(observabilityExpress.requestContextMiddleware);
    app.use(observabilityExpress.requestLoggingMiddleware);
    app.get('/health', (req, res) => {
        pinoLogger.info({ route: '/health' }, 'health route');
        res.json({ ok: true });
    });
    app.get('/success', (req, res) => {
        pinoLogger.info({ route: '/success', userId: 'demo-user' }, 'success route');
        incrementCounter('example_pino_success_total', 1, {
            route: '/success'
        });
        res.json({ ok: true, logger: 'pino' });
    });
    app.get('/error', (req, res, next) => {
        pinoLogger.error({ route: '/error' }, 'intentional error route');
        next(new Error('Pino example intentional error'));
    });
    app.get('/slow', async (req, res) => {
        const delay = 900;
        await sleep(delay);
        recordHistogram('example_pino_slow_delay_ms', delay, {
            route: '/slow'
        });
        setGauge('example_pino_last_delay_ms', delay, {
            route: '/slow'
        });
        pinoLogger.warn({ delay }, 'slow route finished');
        res.json({ ok: true, delay });
    });
    app.get('/nested', async (req, res, next) => {
        try {
            const response = await startSpan('pino.nested.root', {}, async () => {
                pinoLogger.debug('nested route root span started');
                return startSpan('pino.nested.worker', {}, async () => {
                    await sleep(100);
                    incrementCounter('example_pino_nested_total', 1, {
                        route: '/nested'
                    });
                    pinoLogger.info({ route: '/nested' }, 'nested worker done');
                    return { ok: true, nested: true };
                });
            });
            res.json(response);
        }
        catch (error) {
            next(error);
        }
    });
    app.use(observabilityExpress.errorMiddleware);
    const port = Number(process.env.PORT || 3002);
    const server = app.listen(port, () => {
        pinoLogger.info({ port }, 'pino express example listening');
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
