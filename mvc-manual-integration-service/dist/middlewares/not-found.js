"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = notFoundHandler;
function notFoundHandler(req, res) {
    res.status(404).json({
        ok: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
}
