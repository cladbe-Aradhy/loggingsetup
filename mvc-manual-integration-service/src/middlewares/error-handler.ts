import { getLogger, recordException, type AppLogger } from '@my-org/observability-node-ts';
import { NextFunction, Request, Response } from 'express';
import { AppError } from '../models/app-error';

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestLogger = (req as Request & { log?: AppLogger }).log || getLogger();

  recordException(error);
  requestLogger.error('mvc request failed', {
    error,
    http_method: req.method,
    http_target: req.originalUrl || req.url
  });

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      ok: false,
      code: error.code,
      message: error.message
    });
    return;
  }

  if (error instanceof Error) {
    res.status(500).json({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: error.message
    });
    return;
  }

  res.status(500).json({
    ok: false,
    code: 'UNKNOWN_ERROR',
    message: 'Something went wrong'
  });
}
