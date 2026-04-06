"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserController = void 0;
const app_error_1 = require("../models/app-error");
const user_service_1 = require("../services/user.service");
class UserController {
    userService;
    constructor(userService = new user_service_1.UserService()) {
        this.userService = userService;
    }
    list = (_req, res) => {
        res.json({
            ok: true,
            users: this.userService.list()
        });
    };
    getById = (req, res) => {
        const userId = String(req.params.id);
        res.json({
            ok: true,
            user: this.userService.getById(userId)
        });
    };
    create = (req, res, next) => {
        try {
            const { name, email, role } = req.body ?? {};
            if (!name || !email) {
                throw new app_error_1.AppError('name and email are required', 400, 'MISSING_USER_FIELDS');
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
        }
        catch (error) {
            next(error);
        }
    };
}
exports.UserController = UserController;
