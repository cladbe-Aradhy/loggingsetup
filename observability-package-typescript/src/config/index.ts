'use strict';

const defaults = require('./defaults');
const {
  parseBoolean,
  parseCsv,
  parseNumber,
  parseResourceAttributes
} = require('./env');

function resolveConfig(options) {
  const env = process.env;

  const environment = options.environment || env.NODE_ENV || defaults.environment;
  const otlpEndpoint = options.otlpEndpoint || env.OTEL_EXPORTER_OTLP_ENDPOINT || defaults.otlpEndpoint;
  const otlpProtocol = options.otlpProtocol || env.OTEL_EXPORTER_OTLP_PROTOCOL || defaults.otlpProtocol;

  return {
    serviceName: options.serviceName || env.OTEL_SERVICE_NAME || defaults.serviceName,
    serviceVersion: options.serviceVersion || env.SERVICE_VERSION || defaults.serviceVersion,
    environment,
    otlpEndpoint,
    otlpProtocol,
    headers: {
      ...parseResourceAttributes(env.OTEL_EXPORTER_OTLP_HEADERS),
      ...(options.headers || {})
    },
    logLevel: options.logLevel || env.OBSERVABILITY_LOG_LEVEL || defaults.logLevel,
    enableConsoleCapture: parseBoolean(
      options.enableConsoleCapture,
      parseBoolean(env.OBSERVABILITY_ENABLE_CONSOLE_CAPTURE, defaults.enableConsoleCapture)
    ),
    enableConsoleMirror: parseBoolean(
      options.enableConsoleMirror,
      parseBoolean(env.OBSERVABILITY_ENABLE_CONSOLE_MIRROR, defaults.enableConsoleMirror)
    ),
    redactKeys: Array.isArray(options.redactKeys)
      ? options.redactKeys
      : parseCsv(env.OBSERVABILITY_REDACT_KEYS).length
        ? parseCsv(env.OBSERVABILITY_REDACT_KEYS)
        : defaults.redactKeys,
    disableAutoInstrumentations: Array.isArray(options.disableAutoInstrumentations)
      ? options.disableAutoInstrumentations
      : parseCsv(env.OBSERVABILITY_DISABLE_AUTO_INSTRUMENTATIONS),
    metricsInterval: parseNumber(
      options.metricsInterval,
      parseNumber(env.OBSERVABILITY_METRICS_INTERVAL, defaults.metricsInterval)
    ),
    captureUncaught: parseBoolean(
      options.captureUncaught,
      parseBoolean(env.OBSERVABILITY_CAPTURE_UNCAUGHT, defaults.captureUncaught)
    ),
    captureUnhandledRejection: parseBoolean(
      options.captureUnhandledRejection,
      parseBoolean(env.OBSERVABILITY_CAPTURE_UNHANDLED_REJECTION, defaults.captureUnhandledRejection)
    ),
    emitOnlyWarnErrorFatal: parseBoolean(
      options.emitOnlyWarnErrorFatal,
      parseBoolean(env.OBSERVABILITY_EMIT_ONLY_WARN_ERROR_FATAL, defaults.emitOnlyWarnErrorFatal)
    ),
    smartSeverityDetection: parseBoolean(
      options.smartSeverityDetection,
      parseBoolean(env.OBSERVABILITY_SMART_SEVERITY_DETECTION, defaults.smartSeverityDetection)
    ),
    debug: parseBoolean(options.debug, parseBoolean(env.OBSERVABILITY_DEBUG, defaults.debug)),
    logDedupeEnabled: parseBoolean(
      options.logDedupeEnabled,
      parseBoolean(env.OBSERVABILITY_LOG_DEDUPE_ENABLED, defaults.logDedupeEnabled)
    ),
    logDedupeWindowMs: parseNumber(
      options.logDedupeWindowMs,
      parseNumber(env.OBSERVABILITY_LOG_DEDUPE_WINDOW_MS, defaults.logDedupeWindowMs)
    ),
    logDedupeLevels: Array.isArray(options.logDedupeLevels)
      ? options.logDedupeLevels
      : parseCsv(env.OBSERVABILITY_LOG_DEDUPE_LEVELS).length
        ? parseCsv(env.OBSERVABILITY_LOG_DEDUPE_LEVELS)
        : defaults.logDedupeLevels,
    logExportMaxQueueSize: parseNumber(
      options.logExportMaxQueueSize,
      parseNumber(env.OBSERVABILITY_LOG_EXPORT_MAX_QUEUE_SIZE, defaults.logExportMaxQueueSize)
    ),
    logExportMaxBatchSize: parseNumber(
      options.logExportMaxBatchSize,
      parseNumber(env.OBSERVABILITY_LOG_EXPORT_MAX_BATCH_SIZE, defaults.logExportMaxBatchSize)
    ),
    logExportScheduledDelayMillis: parseNumber(
      options.logExportScheduledDelayMillis,
      parseNumber(env.OBSERVABILITY_LOG_EXPORT_SCHEDULE_DELAY_MS, defaults.logExportScheduledDelayMillis)
    ),
    logExportTimeoutMillis: parseNumber(
      options.logExportTimeoutMillis,
      parseNumber(env.OBSERVABILITY_LOG_EXPORT_TIMEOUT_MS, defaults.logExportTimeoutMillis)
    ),
    failFast: parseBoolean(
      options.failFast,
      parseBoolean(env.OBSERVABILITY_FAIL_FAST, defaults.failFast)
    ),
    extraResourceAttributes: {
      ...parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES),
      ...(options.extraResourceAttributes || {})
    },
    loggerName: options.loggerName || env.OBSERVABILITY_LOGGER_NAME || defaults.loggerName,
    consoleMirrorInDevelopmentOnly: parseBoolean(
      options.consoleMirrorInDevelopmentOnly,
      parseBoolean(
        env.OBSERVABILITY_CONSOLE_MIRROR_IN_DEVELOPMENT_ONLY,
        defaults.consoleMirrorInDevelopmentOnly
      )
    ),
    shutdownTimeoutMillis: parseNumber(
      options.shutdownTimeoutMillis,
      parseNumber(env.OBSERVABILITY_SHUTDOWN_TIMEOUT_MS, defaults.shutdownTimeoutMillis)
    )
  };
}

module.exports = {
  resolveConfig
};
