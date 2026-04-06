"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
exports.env = {
    port: Number(process.env.PORT || 3080),
    nodeEnv: process.env.NODE_ENV || 'development'
};
