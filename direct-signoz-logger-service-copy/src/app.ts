import crypto from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import { logger, type AppLogger } from './logger';

type RequestWithLogger = Request & {
  requestId?: string;
  log?: AppLogger;
};

const app = express();

app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = String(req.header('x-request-id') || crypto.randomUUID());
  const requestLogger = logger.child({
    request_id: requestId,
    method: req.method,
    path: req.originalUrl || req.url
  });

  (req as RequestWithLogger).requestId = requestId;
  (req as RequestWithLogger).log = requestLogger;
  res.setHeader('x-request-id', requestId);

  requestLogger.info('request started');
  next();
});

app.get('/health', (req: Request, res: Response) => {
  (req as RequestWithLogger).log?.info('health route hit', {
    route: '/health'
  });

  res.json({
    ok: true,
    service: 'direct-signoz-logger-service'
  });
});

app.get('/logs/info', (req: Request, res: Response) => {
  (req as RequestWithLogger).log?.info('manual info route', {
    route: '/logs/info',
    feature: 'direct-logger'
  });

  res.json({
    ok: true,
    level: 'info'
  });
});

app.get('/logs/error', (req: Request, res: Response) => {
  (req as RequestWithLogger).log?.error('manual error route', {
    route: '/logs/error',
    code: 'DIRECT_LOGGER_ROUTE_ERROR'
  });

  res.status(500).json({
    ok: false,
    code: 'DIRECT_LOGGER_ROUTE_ERROR',
    message: 'manual error route'
  });
});

app.post('/orders', (req: Request, res: Response) => {
  const requestLogger = (req as RequestWithLogger).log || logger;
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
    id: crypto.randomUUID(),
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

export { app };
