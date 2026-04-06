import { Request, Response } from 'express';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    ok: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
}
