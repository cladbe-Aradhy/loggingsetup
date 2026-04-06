import { NextFunction, Request, Response } from 'express';
import { AppError } from '../models/app-error';
import { OrderService } from '../services/order.service';
import { getLogger, type AppLogger } from '@my-org/observability-node-ts';


export class OrderController {
  constructor(private readonly orderService = new OrderService()) {}

  list = (_req: Request, res: Response) => {
    res.json({
      ok: true,
      orders: this.orderService.list()
    });
  };

  getById = (req: Request, res: Response) => {
    const orderId = String(req.params.id);

    res.json({
      ok: true,
      order: this.orderService.getById(orderId)
    });
  };

  create = (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, item, amount } = req.body ?? {};

      if (!userId || !item || amount === undefined) {
       // throw new AppError('userId, item, and amount are required', 400, 'MISSING_ORDER_FIELDS');
        //push this log to signoz
      }

      const order = this.orderService.create({
        userId,
        item,
        amount: Number(amount)
      });

    //getLogger().info('order created', { order });


      res.status(201).json({
        ok: true,
        order
      });
    } catch (error) {
      next(error);
    }
  };

  markAsPaid = (req: Request, res: Response) => {
    const orderId = String(req.params.id);

    res.json({
      ok: true,
      order: this.orderService.markAsPaid(orderId)
    });
  };
}
