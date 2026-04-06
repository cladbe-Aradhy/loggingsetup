'use strict';

module.exports = {
  initialized: false,
  initPromise: null,
  config: null,
  sdk: null,
  tracer: null,
  meterProvider: null,
  metricTools: null,
  loggerProvider: null,
  startupError: null,
  appLogger: null,
  consoleRestore: null,
  errorRestore: null,
  gaugeValues: new Map(),
  logDedupeEntries: new Map(),
  flushPendingLogDedupe: null,
  preloadedModules: []
};
