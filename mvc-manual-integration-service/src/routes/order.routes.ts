import { Router } from 'express';
import { OrderController } from '../controllers/order.controller';

const router = Router();
const orderController = new OrderController();

router.get('/', orderController.list);
router.get('/:id', orderController.getById);
router.post('/', orderController.create);
router.patch('/:id/pay', orderController.markAsPaid);

export { router as orderRoutes };
