'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactObject } = require('../src/utils/redact');
test('redactObject preserves useful Error metadata while redacting sensitive fields', () => {
    const cause = new Error('db timeout');
    cause.code = 'DB_TIMEOUT';
    cause.status = 504;
    cause.authorization = 'Bearer secret-cause';
    const error = new Error('request failed');
    error.code = 'ORDER_LOOKUP_FAILED';
    error.status = 500;
    error.statusCode = 502;
    error.authorization = 'Bearer secret-parent';
    error.cause = cause;
    const result = redactObject({
        error
    }, ['authorization']);
    assert.equal(result.error.message, 'request failed');
    assert.equal(result.error.code, 'ORDER_LOOKUP_FAILED');
    assert.equal(result.error.status, 500);
    assert.equal(result.error.statusCode, 502);
    assert.equal(result.error.authorization, '[REDACTED]');
    assert.equal(result.error.cause.message, 'db timeout');
    assert.equal(result.error.cause.code, 'DB_TIMEOUT');
    assert.equal(result.error.cause.status, 504);
    assert.equal(result.error.cause.authorization, '[REDACTED]');
});
