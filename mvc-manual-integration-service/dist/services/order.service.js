"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderService = void 0;
const node_crypto_1 = require("node:crypto");
const app_error_1 = require("../models/app-error");
const user_service_1 = require("./user.service");
const orders = new Map();
const seedOrders = [
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
class OrderService {
    userService;
    constructor(userService = new user_service_1.UserService()) {
        this.userService = userService;
    }
    list() {
        return Array.from(orders.values());
    }
    getById(id) {
        const order = orders.get(id);
        if (!order) {
            throw new app_error_1.AppError('Order not found', 404, 'ORDER_NOT_FOUND');
        }
        return order;
    }
    create(input) {
        if (input.amount <= 0) {
            throw new app_error_1.AppError('Amount must be greater than zero', 400, 'INVALID_ORDER_AMOUNT');
        }
        this.userService.getById(input.userId);
        const order = {
            id: (0, node_crypto_1.randomUUID)(),
            userId: input.userId,
            item: input.item.trim(),
            amount: input.amount,
            status: 'pending'
        };
        orders.set(order.id, order);
        return order;
    }
    markAsPaid(id) {
        const order = this.getById(id);
        const updatedOrder = {
            ...order,
            status: 'paid'
        };
        orders.set(id, updatedOrder);
        return updatedOrder;
    }
}
exports.OrderService = OrderService;
