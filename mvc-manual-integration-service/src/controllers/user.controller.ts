import { NextFunction, Request, Response } from 'express';
import { AppError } from '../models/app-error';
import { UserService } from '../services/user.service';

export class UserController {
  constructor(private readonly userService = new UserService()) {}

  list = (_req: Request, res: Response) => {
    res.json({
      ok: true,
      users: this.userService.list()
    });
  };

  getById = (req: Request, res: Response) => {
    const userId = String(req.params.id);

    res.json({
      ok: true,
      user: this.userService.getById(userId)
    });
  };

  create = (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email, role } = req.body ?? {};

      if (!name || !email) {
        throw new AppError('name and email are required', 400, 'MISSING_USER_FIELDS');
      }

      const user = this.userService.create({
        name,
        email,
        role
      });

      res.status(201).json({
        ok: true,
        user
      });
    } catch (error) {
      next(error);
    }
  };
}
