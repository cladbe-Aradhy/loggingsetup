'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeErrorLike } = require('../src/errors');
test('normalizeErrorLike preserves object rejection metadata', () => {
    const error = normalizeErrorLike({
        name: 'UpstreamFailure',
        message: 'database timed out',
        code: 'DB_TIMEOUT',
        status: 503,
        statusCode: 504,
        cause: {
            message: 'socket hang up',
            code: 'ECONNRESET'
        }
    });
    assert.equal(error instanceof Error, true);
    assert.equal(error.name, 'UpstreamFailure');
    assert.equal(error.message, 'database timed out');
    assert.equal(error.code, 'DB_TIMEOUT');
    assert.equal(error.status, 503);
    assert.equal(error.statusCode, 504);
    assert.deepEqual(error.cause, {
        message: 'socket hang up',
        code: 'ECONNRESET'
    });
});
