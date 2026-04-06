'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeError } = require('../src/utils/serialize-error');

test('serializeError includes code, status, and statusCode for Error instances', () => {
  const cause = new Error('database timed out');
  cause.code = 'DB_TIMEOUT';
  cause.status = 504;

  const error = new Error('request failed');
  error.code = 'ORDER_LOOKUP_FAILED';
  error.status = 500;
  error.statusCode = 502;
  error.cause = cause;

  const serialized = serializeError(error);

  assert.equal(serialized.name, 'Error');
  assert.equal(serialized.message, 'request failed');
  assert.equal(serialized.code, 'ORDER_LOOKUP_FAILED');
  assert.equal(serialized.status, 500);
  assert.equal(serialized.statusCode, 502);
  assert.equal(serialized.cause.message, 'database timed out');
  assert.equal(serialized.cause.code, 'DB_TIMEOUT');
  assert.equal(serialized.cause.status, 504);
});

test('serializeError preserves plain-object error metadata and nested cause', () => {
  const serialized = serializeError({
    name: 'HttpError',
    message: 'bad request',
    code: 'BAD_REQUEST',
    status: 400,
    statusCode: 400,
    cause: {
      name: 'ValidationError',
      message: 'email is required',
      code: 'VALIDATION_FAILED',
      statusCode: 422
    }
  });

  assert.deepEqual(serialized, {
    name: 'HttpError',
    message: 'bad request',
    code: 'BAD_REQUEST',
    status: 400,
    statusCode: 400,
    cause: {
      name: 'ValidationError',
      message: 'email is required',
      code: 'VALIDATION_FAILED',
      statusCode: 422
    }
  });
});
