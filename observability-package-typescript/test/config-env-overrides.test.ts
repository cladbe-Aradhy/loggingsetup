'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveConfig } = require('../src/config');

function withEnv(overrides, fn) {
  const previous = {};

  Object.keys(overrides).forEach((key) => {
    previous[key] = process.env[key];

    if (overrides[key] === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = overrides[key];
  });

  try {
    return fn();
  } finally {
    Object.keys(overrides).forEach((key) => {
      if (previous[key] === undefined) {
        delete process.env[key];
        return;
      }

      process.env[key] = previous[key];
    });
  }
}

test('resolveConfig reads OTLP headers and dedupe env overrides', () => {
  withEnv({
    OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer demo-token,x-tenant=my-org',
    OBSERVABILITY_LOG_DEDUPE_ENABLED: 'false',
    OBSERVABILITY_LOG_DEDUPE_WINDOW_MS: '4500',
    OBSERVABILITY_LOG_DEDUPE_LEVELS: 'error,fatal',
    OBSERVABILITY_LOG_EXPORT_MAX_QUEUE_SIZE: '4096',
    OBSERVABILITY_CONSOLE_MIRROR_IN_DEVELOPMENT_ONLY: 'false',
    OBSERVABILITY_LOGGER_NAME: 'gateway-app',
    OBSERVABILITY_SHUTDOWN_TIMEOUT_MS: '9000'
  }, () => {
    const config = resolveConfig({});

    assert.deepEqual(config.headers, {
      authorization: 'Bearer demo-token',
      'x-tenant': 'my-org'
    });
    assert.equal(config.logDedupeEnabled, false);
    assert.equal(config.logDedupeWindowMs, 4500);
    assert.deepEqual(config.logDedupeLevels, ['error', 'fatal']);
    assert.equal(config.logExportMaxQueueSize, 4096);
    assert.equal(config.consoleMirrorInDevelopmentOnly, false);
    assert.equal(config.loggerName, 'gateway-app');
    assert.equal(config.shutdownTimeoutMillis, 9000);
  });
});

test('resolveConfig lets explicit options override env configuration', () => {
  withEnv({
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OBSERVABILITY_LOG_DEDUPE_WINDOW_MS: '9999',
    OBSERVABILITY_LOG_DEDUPE_LEVELS: 'error'
  }, () => {
    const config = resolveConfig({
      otlpProtocol: 'grpc',
      logDedupeWindowMs: 1200,
      logDedupeLevels: ['warn', 'error', 'fatal']
    });

    assert.equal(config.otlpProtocol, 'grpc');
    assert.equal(config.logDedupeWindowMs, 1200);
    assert.deepEqual(config.logDedupeLevels, ['warn', 'error', 'fatal']);
  });
});
