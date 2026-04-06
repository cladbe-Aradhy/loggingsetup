'use strict';

function firstNonEmpty(...values: unknown[]) {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === undefined || value === null) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function buildSummaryMessage(message: any, repeatCount: number, totalCount: number) {
  const baseMessage = firstNonEmpty(message, 'repeated log');
  const repeatLabel = repeatCount === 1 ? 'time' : 'times';

  return `${baseMessage} (repeated ${repeatCount} ${repeatLabel}, total ${totalCount})`;
}

function normalizeLevelList(levels: any) {
  return Array.isArray(levels)
    ? levels.map((level) => String(level || '').trim().toLowerCase()).filter(Boolean)
    : [];
}

function shouldDedupeLog(config: any, level: any, meta?: any) {
  if (meta && meta.skipDedupe) {
    return false;
  }

  if (!config.logDedupeEnabled) {
    return false;
  }

  if (!(config.logDedupeWindowMs > 0)) {
    return false;
  }

  return normalizeLevelList(config.logDedupeLevels).includes(String(level || '').toLowerCase());
}

function buildDedupeKey(record: any, level: any) {
  const error = record.error || {};
  const service = record.service || {};

  return [
    firstNonEmpty(service.name),
    firstNonEmpty(record.logger_type),
    firstNonEmpty(level),
    firstNonEmpty(record.message),
    firstNonEmpty(error.name),
    firstNonEmpty(error.message),
    firstNonEmpty(error.code, record.error_code, record.code),
    firstNonEmpty(record.http_method, record.method, record['http.request.method']),
    firstNonEmpty(record.http_route, record.path, record.http_target, record['http.route'], record['url.path']),
    firstNonEmpty(record.http_status_code, record.status_code, record['http.response.status_code'])
  ].join('|');
}

function scheduleFlush(state: any, key: string, windowMs: number, emitSummary: (level: string, record: any) => void) {
  const entry = state.logDedupeEntries.get(key);

  if (!entry) {
    return;
  }

  if (entry.timer) {
    clearTimeout(entry.timer);
  }

  entry.timer = setTimeout(() => {
    flushEntry(state, key, emitSummary);
  }, windowMs);

  if (typeof entry.timer.unref === 'function') {
    entry.timer.unref();
  }
}

function flushEntry(state: any, key: string, emitSummary: (level: string, record: any) => void) {
  const entry = state.logDedupeEntries.get(key);

  if (!entry) {
    return;
  }

  if (entry.timer) {
    clearTimeout(entry.timer);
  }

  state.logDedupeEntries.delete(key);

  if (entry.repeatCount <= 0) {
    return;
  }

  const totalCount = entry.repeatCount + 1;
  const summaryRecord: Record<string, any> = {
    ...entry.sampleRecord,
    timestamp: new Date().toISOString(),
    message: buildSummaryMessage(entry.sampleRecord.message, entry.repeatCount, totalCount),
    dedupe_summary: true,
    dedupe_repeat_count: entry.repeatCount,
    dedupe_total_count: totalCount,
    dedupe_original_message: entry.sampleRecord.message,
    dedupe_first_seen: new Date(entry.firstSeenAt).toISOString(),
    dedupe_last_seen: new Date(entry.lastSeenAt).toISOString(),
    dedupe_window_ms: entry.windowMs
  };

  if (summaryRecord.trace_id) {
    summaryRecord.sample_trace_id = summaryRecord.trace_id;
    delete summaryRecord.trace_id;
  }

  if (summaryRecord.span_id) {
    summaryRecord.sample_span_id = summaryRecord.span_id;
    delete summaryRecord.span_id;
  }

  emitSummary(entry.level, summaryRecord);
}

function registerLogForDedupe(
  state: any,
  config: any,
  level: string,
  record: any,
  emitSummary: (level: string, record: any) => void
) {
  if (!shouldDedupeLog(config, level)) {
    return false;
  }

  const key = buildDedupeKey(record, level);
  const now = Date.now();
  const existing = state.logDedupeEntries.get(key);

  if (!existing) {
    state.logDedupeEntries.set(key, {
      key,
      level,
      repeatCount: 0,
      firstSeenAt: now,
      lastSeenAt: now,
      sampleRecord: {
        ...record
      },
      windowMs: config.logDedupeWindowMs,
      timer: null
    });
    scheduleFlush(state, key, config.logDedupeWindowMs, emitSummary);
    return false;
  }

  existing.repeatCount += 1;
  existing.lastSeenAt = now;
  scheduleFlush(state, key, config.logDedupeWindowMs, emitSummary);
  return true;
}

function flushPendingLogDedupe(state: any, emitSummary: (level: string, record: any) => void) {
  Array.from((state.logDedupeEntries || new Map()).keys()).forEach((key) => {
    flushEntry(state, String(key), emitSummary);
  });
}

module.exports = {
  buildSummaryMessage,
  buildDedupeKey,
  flushPendingLogDedupe,
  registerLogForDedupe,
  shouldDedupeLog
};
