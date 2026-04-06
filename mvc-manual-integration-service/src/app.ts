import express, { Request } from 'express';
import { errorHandler } from './middlewares/error-handler';
import { notFoundHandler } from './middlewares/not-found';
import { observabilityRoutes } from './routes/observability.routes';
import { orderRoutes } from './routes/order.routes';
import { userRoutes } from './routes/user.routes';
import { express as observabilityExpress, getLogger, type AppLogger } from '@my-org/observability-node-ts';

const DEDUPE_WINDOW_MS = 3000;
const DEFAULT_DEDUPE_BURST_COUNT = 5;
const DEFAULT_DEDUPE_WAIT_MS = DEDUPE_WINDOW_MS + 200;
const MAX_DEDUPE_BURST_COUNT = 25;
const MAX_DEDUPE_WAIT_MS = 10000;

type RequestWithLogger = Request & {
  log?: AppLogger;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePositiveInt(value: unknown, fallback: number, min: number, max: number) {
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

const app = express();

app.use(express.json());
app.use(observabilityExpress.requestContextMiddleware);
app.use(observabilityExpress.requestLoggingMiddleware);
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
  const logger = (req as RequestWithLogger).log || getLogger();
  const count = normalizePositiveInt(
    req.query.count,
    DEFAULT_DEDUPE_BURST_COUNT,
    1,
    MAX_DEDUPE_BURST_COUNT
  );
  const waitMs = normalizePositiveInt(
    req.query.waitMs,
    DEFAULT_DEDUPE_WAIT_MS,
    0,
    MAX_DEDUPE_WAIT_MS
  );
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

app.use('/package', observabilityRoutes);
app.use('/users', userRoutes);
app.use('/orders', orderRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
