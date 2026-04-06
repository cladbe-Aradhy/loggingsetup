"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const node_crypto_1 = require("node:crypto");
const app_error_1 = require("../models/app-error");
const users = new Map();
const seedUsers = [
    {
        id: 'user-1',
        name: 'Aarav Sharma',
        email: 'aarav@example.com',
        role: 'admin'
    },
    {
        id: 'user-2',
        name: 'Diya Singh',
        email: 'diya@example.com',
        role: 'member'
    }
];
seedUsers.forEach((user) => {
    users.set(user.id, user);
});
class UserService {
    list() {
        return Array.from(users.values());
    }
    getById(id) {
        const user = users.get(id);
        if (!user) {
            throw new app_error_1.AppError('User not found', 404, 'USER_NOT_FOUND');
        }
        return user;
    }
    create(input) {
        const normalizedEmail = input.email.trim().toLowerCase();
        const exists = Array.from(users.values()).some((user) => user.email === normalizedEmail);
        if (exists) {
            throw new app_error_1.AppError('Email already exists', 409, 'USER_EMAIL_CONFLICT');
        }
        const user = {
            id: (0, node_crypto_1.randomUUID)(),
            name: input.name.trim(),
            email: normalizedEmail,
            role: input.role || 'member'
        };
        users.set(user.id, user);
        return user;
    }
}
exports.UserService = UserService;
