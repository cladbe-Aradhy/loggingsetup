'use strict';

const { trace } = require('@opentelemetry/api');
const state = require('./state');
const { resolveConfig } = require('../config');

function getTracingModule() {
  return require('../tracing');
}

function getMetricsModule() {
  return require('../metrics');
}

function getLogProviderModule() {
  return require('../logging/core/provider');
}

function getLoggerModule() {
  return require('../logging/core/logger');
}

function getConsoleAdapterModule() {
  return require('../logging/adapters/console');
}

function getPinoAdapterModule() {
  return require('../logging/adapters/pino');
}

function getWinstonAdapterModule() {
  return require('../logging/adapters/winston');
}

function getErrorsModule() {
  return require('../errors');
}

function getExpressModule() {
  return require('../express');
}

function detectPreloadedInstrumentedModules() {
  const loaded = [];
  const cachedModules = Object.keys(require.cache || {});
  const moduleLoadList = (process.moduleLoadList || []) as string[];

  if (cachedModules.some((key) => /[/\\]express[/\\]/.test(key))) {
    loaded.push('express');
  }

  ['http', 'https', 'dns', 'net'].forEach((name) => {
    if (moduleLoadList.includes('NativeModule ' + name)) {
      loaded.push(name);
    }
  });

  return Array.from(new Set(loaded));
}

async function performInit(options) {
  const config = resolveConfig(options || {});
  state.config = config;
  state.startupError = null;
  state.preloadedModules = detectPreloadedInstrumentedModules();

  if (state.preloadedModules.length > 0) {
    process.stderr.write(
      'observability startup warning: some instrumented modules were loaded before initObservability: ' +
      state.preloadedModules.join(', ') +
      '. Auto-instrumentation coverage may be partial.\n'
    );
  }

  try {
    const { createTracingRuntime } = getTracingModule();
    const { createLogProvider } = getLogProviderModule();
    const tracingRuntime = await createTracingRuntime(config);
    const logRuntime = createLogProvider(config, tracingRuntime.resource);

    state.sdk = tracingRuntime.sdk;
    state.tracer = tracingRuntime.tracer;
    state.meterProvider = tracingRuntime.meterProvider;
    state.loggerProvider = logRuntime.provider;
    state.otelLogger = logRuntime.otelLogger;
  } catch (error) {
    state.startupError = error;
    process.stderr.write('observability startup error: ' + error.message + '\n');

    if (config.failFast) {
      throw error;
    }
  }

  state.metricTools = state.meterProvider
    ? getMetricsModule().createMetricsRuntime(config, state.meterProvider, state)
    : null;

  state.appLogger = getLoggerModule().createLogger(config, state);

  if (config.enableConsoleCapture) {
    state.consoleRestore = getConsoleAdapterModule().createConsoleCapture(state.appLogger, config);
  }

  state.errorRestore = getErrorsModule().installProcessErrorHandlers(
    config,
    state.appLogger,
    shutdownObservability
  );
  state.initialized = true;

  state.appLogger.info('observability initialized', {
    otlp_endpoint: config.otlpEndpoint,
    otlp_protocol: config.otlpProtocol,
    startup_degraded: Boolean(state.startupError),
    early_loaded_modules: state.preloadedModules
  });

  if (state.startupError) {
    state.appLogger.warn('observability running in degraded mode', {
      error: state.startupError
    });
  }

  return buildPublicApi();
}

async function initObservability(options) {
  if (state.initialized) {
    return buildPublicApi();
  }

  if (state.initPromise) {
    return state.initPromise;
  }

  const initPromise = performInit(options);
  state.initPromise = initPromise;

  try {
    return await initPromise;
  } finally {
    if (state.initPromise === initPromise) {
      state.initPromise = null;
    }
  }
}

async function shutdownObservability() {
  const cleanupTasks = [];

  if (state.metricTools && typeof state.metricTools.cleanup === 'function') {
    state.metricTools.cleanup();
  }

  if (typeof state.consoleRestore === 'function') {
    state.consoleRestore();
    state.consoleRestore = null;
  }

  if (typeof state.errorRestore === 'function') {
    state.errorRestore();
    state.errorRestore = null;
  }

  if (typeof state.flushPendingLogDedupe === 'function') {
    state.flushPendingLogDedupe();
    state.flushPendingLogDedupe = null;
  }

  if (state.loggerProvider) {
    cleanupTasks.push(state.loggerProvider.shutdown().catch(() => undefined));
  }

  if (state.sdk) {
    cleanupTasks.push(state.sdk.shutdown().catch(() => undefined));
  }

  await Promise.all(cleanupTasks);
  state.config = null;
  state.sdk = null;
  state.tracer = null;
  state.meterProvider = null;
  state.metricTools = null;
  state.loggerProvider = null;
  state.otelLogger = null;
  state.startupError = null;
  state.logDedupeEntries.clear();
  state.preloadedModules = [];
  state.appLogger = null;
  state.initPromise = null;
  state.initialized = false;
}

function getLogger() {
  if (!state.appLogger) {
    const config = resolveConfig({});
    state.appLogger = getLoggerModule().createLogger(config, state);
  }

  return state.appLogger;
}

function createChildLogger(bindings) {
  return getLogger().child(bindings);
}

function startSpan(name, options, fn) {
  const tracer = state.tracer || trace.getTracer('default');
  const spanOptions = options || {};

  if (typeof fn !== 'function') {
    return tracer.startSpan(name, spanOptions);
  }

  return tracer.startActiveSpan(name, spanOptions, async (span) => {
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (error) {
      getTracingModule().markSpanError(span, error);
      span.end();
      throw error;
    }
  });
}

function incrementCounter(name, value, attributes) {
  if (state.metricTools) {
    state.metricTools.incrementCounter(name, value, attributes);
  }
}

function recordHistogram(name, value, attributes) {
  if (state.metricTools) {
    state.metricTools.recordHistogram(name, value, attributes);
  }
}

function setGauge(name, value, attributes) {
  if (state.metricTools) {
    state.metricTools.setGauge(name, value, attributes);
  }
}

function recordException(error, options) {
  return getErrorsModule().recordException(error, options);
}

function buildExpressApi() {
  const {
    createRequestContextMiddleware,
    createRequestLoggingMiddleware,
    createErrorMiddleware
  } = getExpressModule();

  return {
    requestContextMiddleware: createRequestContextMiddleware(getLogger),
    requestLoggingMiddleware: state.metricTools
      ? createRequestLoggingMiddleware(state.metricTools)
      : function noopRequestLogging(req, res, next) { next(); },
    errorMiddleware: createErrorMiddleware(getLogger)
  };
}

function buildAdaptersApi() {
  return {
    pino: {
      createPinoStreamAdapter(bindings) {
        return getPinoAdapterModule().createPinoStreamAdapter(getLogger(), bindings);
      },
      instrumentPinoLogger(logger, bindings) {
        return getPinoAdapterModule().instrumentPinoLogger(logger, getLogger(), bindings);
      }
    },
    winston: {
      createWinstonTransport(bindings) {
        return getWinstonAdapterModule().createWinstonTransport(getLogger(), bindings);
      },
      instrumentWinstonLogger(logger, bindings) {
        return getWinstonAdapterModule().instrumentWinstonLogger(logger, getLogger(), bindings);
      }
    }
  };
}

function buildPublicApi() {
  return {
    initObservability,
    shutdownObservability,
    getLogger,
    createChildLogger,
    startSpan,
    recordException,
    incrementCounter,
    recordHistogram,
    setGauge,
    express: buildExpressApi(),
    adapters: buildAdaptersApi()
  };
}

module.exports = {
  initObservability,
  shutdownObservability,
  getLogger,
  createChildLogger,
  startSpan,
  recordException,
  incrementCounter,
  recordHistogram,
  setGauge,
  express: {
    get requestContextMiddleware() {
      return getExpressModule().createRequestContextMiddleware(getLogger);
    },
    get requestLoggingMiddleware() {
      return state.metricTools
        ? getExpressModule().createRequestLoggingMiddleware(state.metricTools)
        : function noopRequestLogging(req, res, next) { next(); };
    },
    get errorMiddleware() {
      return getExpressModule().createErrorMiddleware(getLogger);
    }
  },
  adapters: {
    pino: {
      createPinoStreamAdapter(bindings) {
        return getPinoAdapterModule().createPinoStreamAdapter(getLogger(), bindings);
      },
      instrumentPinoLogger(logger, bindings) {
        return getPinoAdapterModule().instrumentPinoLogger(logger, getLogger(), bindings);
      }
    },
    winston: {
      createWinstonTransport(bindings) {
        return getWinstonAdapterModule().createWinstonTransport(getLogger(), bindings);
      },
      instrumentWinstonLogger(logger, bindings) {
        return getWinstonAdapterModule().instrumentWinstonLogger(logger, getLogger(), bindings);
      }
    }
  }
};
