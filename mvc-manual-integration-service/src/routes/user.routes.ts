import { Router } from 'express';
import { UserController } from '../controllers/user.controller';

const router = Router();
const userController = new UserController();

router.get('/', userController.list);
router.get('/:id', userController.getById);
router.post('/', userController.create);

export { router as userRoutes };
