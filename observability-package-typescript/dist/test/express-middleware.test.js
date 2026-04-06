'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const test = require('node:test');
const assert = require('node:assert/strict');
const { createErrorMiddleware, normalizeErrorStatusCode, normalizeRequestIdHeaderValue } = require('../src/express');
test('normalizeRequestIdHeaderValue uses first non-empty header value', () => {
    assert.equal(normalizeRequestIdHeaderValue(['', 'req-123', 'req-456']), 'req-123');
    assert.equal(normalizeRequestIdHeaderValue('req-789'), 'req-789');
});
test('normalizeErrorStatusCode accepts numeric strings and falls back safely', () => {
    assert.equal(normalizeErrorStatusCode({ statusCode: '404' }), 404);
    assert.equal(normalizeErrorStatusCode({ status: 429 }), 429);
    assert.equal(normalizeErrorStatusCode({ statusCode: 'oops' }), 500);
    assert.equal(normalizeErrorStatusCode({ statusCode: 200 }), 500);
});
test('error middleware normalizes status code and preserves request id in response', () => {
    const captured = [];
    const logger = {
        error(message, fields) {
            captured.push({ message, fields });
        }
    };
    const middleware = createErrorMiddleware(() => logger);
    const req = {
        method: 'GET',
        originalUrl: '/orders/42',
        requestId: 'req-123'
    };
    const res = {
        headersSent: false,
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
    const error = {
        message: 'Order not found',
        expose: true,
        statusCode: '404'
    };
    middleware(error, req, res, () => { });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, {
        ok: false,
        message: 'Order not found',
        requestId: 'req-123'
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].fields.http_status_code, 404);
});
