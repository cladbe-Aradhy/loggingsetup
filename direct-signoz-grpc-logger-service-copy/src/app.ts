import crypto from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import { logger } from './logger';

const app = express();

app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = String(req.header('x-request-id') || crypto.randomUUID());
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  logger.info('request started', {
    request_id: requestId,
    method: req.method,
    path: req.originalUrl || req.url
  });
  next();
});

function requestFields(req: Request, res: Response, extraFields: Record<string, unknown> = {}) {
  return {
    request_id: res.locals.requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    ...extraFields
  };
}

app.get('/health', (req: Request, res: Response) => {
  logger.info('health route hit', requestFields(req, res, { route: '/health' }));

  res.json({
    ok: true,
    service: 'direct-signoz-grpc-logger-service'
  });
});

app.get('/logs/info', (req: Request, res: Response) => {
  logger.info('manual info route', requestFields(req, res, {
    route: '/logs/info',
    feature: 'direct-grpc-logger'
  }));

  res.json({
    ok: true,
    level: 'info'
  });
});

app.get('/logs/error', (req: Request, res: Response) => {
  logger.error('manual error route', requestFields(req, res, {
    route: '/logs/error',
    code: 'DIRECT_GRPC_LOGGER_ROUTE_ERROR'
  }));

  res.status(500).json({
    ok: false,
    code: 'DIRECT_GRPC_LOGGER_ROUTE_ERROR',
    message: 'manual error route'
  });
});

app.post('/orders', (req: Request, res: Response) => {
  const { item, amount } = req.body ?? {};

  if (!item || amount === undefined) {
    logger.error('order validation failed', requestFields(req, res, {
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
    id: crypto.randomUUID(),
    item: String(item).trim(),
    amount: Number(amount),
    status: 'created'
  };

  logger.info('order created', requestFields(req, res, {
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

export { app };
