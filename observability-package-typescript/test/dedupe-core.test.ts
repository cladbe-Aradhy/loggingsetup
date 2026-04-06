'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSummaryMessage,
  buildDedupeKey,
  flushPendingLogDedupe,
  registerLogForDedupe,
  shouldDedupeLog
} = require('../src/logging/core/dedupe');

function createConfig(overrides = {}) {
  return {
    logDedupeEnabled: true,
    logDedupeWindowMs: 3000,
    logDedupeLevels: ['warn', 'error', 'fatal'],
    ...overrides
  };
}

function createRecord(overrides = {}) {
  return {
    message: 'DB failed',
    logger_type: 'console',
    service: {
      name: 'orders-service'
    },
    error: {
      name: 'DbError',
      message: 'DB failed',
      code: 'DB_CONN_REFUSED'
    },
    http_method: 'GET',
    http_route: '/orders',
    http_status_code: 500,
    ...overrides
  };
}

test('buildDedupeKey separates records by method, status code, and error code', () => {
  const base = createRecord();

  const getKey = buildDedupeKey(base, 'error');
  const postKey = buildDedupeKey(createRecord({ http_method: 'POST' }), 'error');
  const notFoundKey = buildDedupeKey(createRecord({ http_status_code: 404 }), 'error');
  const timeoutKey = buildDedupeKey(createRecord({
    error: {
      name: 'DbError',
      message: 'DB failed',
      code: 'DB_TIMEOUT'
    }
  }), 'error');

  assert.notEqual(getKey, postKey);
  assert.notEqual(getKey, notFoundKey);
  assert.notEqual(getKey, timeoutKey);
});

test('buildSummaryMessage creates a UI-friendly summary body', () => {
  assert.equal(
    buildSummaryMessage('DB failed', 4, 5),
    'DB failed (repeated 4 times, total 5)'
  );
  assert.equal(
    buildSummaryMessage('', 1, 2),
    'repeated log (repeated 1 time, total 2)'
  );
});

test('shouldDedupeLog respects config flags and skipDedupe meta', () => {
  const config = createConfig();

  assert.equal(shouldDedupeLog(config, 'error'), true);
  assert.equal(shouldDedupeLog(config, 'info'), false);
  assert.equal(shouldDedupeLog(createConfig({ logDedupeEnabled: false }), 'error'), false);
  assert.equal(shouldDedupeLog(createConfig({ logDedupeWindowMs: 0 }), 'error'), false);
  assert.equal(shouldDedupeLog(config, 'error', { skipDedupe: true }), false);
});

test('flushPendingLogDedupe emits one summary with sample trace ids for duplicates', () => {
  const state = {
    logDedupeEntries: new Map()
  };
  const config = createConfig({ logDedupeWindowMs: 1000, logDedupeLevels: ['error'] });
  const record = createRecord({
    trace_id: 'trace-123',
    span_id: 'span-456'
  });
  const emitted = [];

  assert.equal(registerLogForDedupe(state, config, 'error', record, () => {}), false);
  assert.equal(registerLogForDedupe(state, config, 'error', record, () => {}), true);

  flushPendingLogDedupe(state, (level, summaryRecord) => {
    emitted.push({
      level,
      summaryRecord
    });
  });

  assert.equal(state.logDedupeEntries.size, 0);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].level, 'error');
  assert.equal(emitted[0].summaryRecord.message, 'DB failed (repeated 1 time, total 2)');
  assert.equal(emitted[0].summaryRecord.dedupe_summary, true);
  assert.equal(emitted[0].summaryRecord.dedupe_repeat_count, 1);
  assert.equal(emitted[0].summaryRecord.dedupe_total_count, 2);
  assert.equal(emitted[0].summaryRecord.dedupe_original_message, 'DB failed');
  assert.equal(emitted[0].summaryRecord.sample_trace_id, 'trace-123');
  assert.equal(emitted[0].summaryRecord.sample_span_id, 'span-456');
  assert.equal(emitted[0].summaryRecord.trace_id, undefined);
  assert.equal(emitted[0].summaryRecord.span_id, undefined);
});
