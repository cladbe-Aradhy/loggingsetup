"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderController = void 0;
const order_service_1 = require("../services/order.service");
class OrderController {
    orderService;
    constructor(orderService = new order_service_1.OrderService()) {
        this.orderService = orderService;
    }
    list = (_req, res) => {
        res.json({
            ok: true,
            orders: this.orderService.list()
        });
    };
    getById = (req, res) => {
        const orderId = String(req.params.id);
        res.json({
            ok: true,
            order: this.orderService.getById(orderId)
        });
    };
    create = (req, res, next) => {
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
        }
        catch (error) {
            next(error);
        }
    };
    markAsPaid = (req, res) => {
        const orderId = String(req.params.id);
        res.json({
            ok: true,
            order: this.orderService.markAsPaid(orderId)
        });
    };
}
exports.OrderController = OrderController;
