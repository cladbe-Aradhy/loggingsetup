import { randomUUID } from 'node:crypto';
import { AppError } from '../models/app-error';
import { CreateOrderInput, Order } from '../models/order';
import { UserService } from './user.service';

const orders = new Map<string, Order>();

const seedOrders: Order[] = [
  {
    id: 'order-1',
    userId: 'user-1',
    item: 'Keyboard',
    amount: 4500,
    status: 'paid'
  },
  {
    id: 'order-2',
    userId: 'user-2',
    item: 'Mouse',
    amount: 1200,
    status: 'pending'
  }
];

seedOrders.forEach((order) => {
  orders.set(order.id, order);
});

export class OrderService {
  constructor(private readonly userService = new UserService()) {}

  list() {
    return Array.from(orders.values());
  }

  getById(id: string) {
    const order = orders.get(id);

    if (!order) {
      throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    return order;
  }

  create(input: CreateOrderInput) {
    if (input.amount <= 0) {
      throw new AppError('Amount must be greater than zero', 400, 'INVALID_ORDER_AMOUNT');
    }

    this.userService.getById(input.userId);

    const order: Order = {
      id: randomUUID(),
      userId: input.userId,
      item: input.item.trim(),
      amount: input.amount,
      status: 'pending'
    };

    orders.set(order.id, order);
    return order;
  }

  markAsPaid(id: string) {
    const order = this.getById(id);
    const updatedOrder: Order = {
      ...order,
      status: 'paid'
    };

    orders.set(id, updatedOrder);
    return updatedOrder;
  }
}
