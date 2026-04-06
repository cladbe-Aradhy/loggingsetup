'use strict';

async function main() {
  const express = require('express');
  const winston = require('winston');
  const {
    initObservability,
    shutdownObservability,
    startSpan,
    createChildLogger,
    incrementCounter,
    adapters,
    express: observabilityExpress
  } = require('../..');
  const { sleep } = require('../../src/runtime');

  await initObservability({
    serviceName: 'winston-express-app',
    serviceVersion: '1.0.0',
    logLevel: 'info',
    redactKeys: ['authorization', 'password', 'token']
  });

  const app = express();
  const winstonLogger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
      new winston.transports.Console()
    ]
  });

  adapters.winston.instrumentWinstonLogger(winstonLogger, {
    component: 'winston-example'
  });

  const packageChildLogger = createChildLogger({
    feature: 'winston-routes'
  });

  app.use(express.json());
  app.use(observabilityExpress.requestContextMiddleware);
  app.use(observabilityExpress.requestLoggingMiddleware);

  app.get('/health', (req, res) => {
    winstonLogger.info('health route', {
      route: '/health'
    });
    res.json({ ok: true });
  });

  app.get('/success', (req, res) => {
    packageChildLogger.info('winston example success route', {
      route: '/success'
    });
    res.json({ ok: true, logger: 'winston' });
  });

  app.get('/error', (req, res, next) => {
    const error = new Error('Winston example intentional error');
    error.statusCode = 500;
    next(error);
  });

  app.get('/slow', async (req, res) => {
    await sleep(1100);
    winstonLogger.warn('slow route', {
      route: '/slow',
      delayMs: 1100
    });
    res.json({ ok: true, delayedMs: 1100 });
  });

  app.get('/nested', async (req, res, next) => {
    try {
      const data = await startSpan('winston.nested.controller', {}, async () => {
        winstonLogger.info('nested controller span started', {
          route: '/nested'
        });

        return startSpan('winston.nested.service', {}, async () => {
          incrementCounter('example_winston_nested_total', 1, {
            route: '/nested'
          });

          return startSpan('winston.nested.repository', {}, async () => {
            await sleep(180);
            winstonLogger.info('nested repository work complete', {
              route: '/nested'
            });
            return { ok: true, source: 'repository' };
          });
        });
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  app.use(observabilityExpress.errorMiddleware);

  const port = Number(process.env.PORT || 3003);
  const server = app.listen(port, () => {
    winstonLogger.info('winston express example listening', {
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
