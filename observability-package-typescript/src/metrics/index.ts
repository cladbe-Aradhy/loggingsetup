'use strict';

function createMetricsRuntime(config: any, meterProvider: any, state: any) {
  const meter = meterProvider.getMeter(config.serviceName, config.serviceVersion);

  const standardRequestDuration = meter.createHistogram('http.server.request.duration', {
    description: 'Duration of inbound HTTP server requests.',
    unit: 's'
  });
  const standardRequestCount = meter.createCounter('http.server.request.count', {
    description: 'Total number of completed inbound HTTP server requests.',
    unit: '1'
  });
  const standardRequestErrors = meter.createCounter('http.server.request.errors', {
    description: 'Total number of completed inbound HTTP server requests that ended with error status codes.',
    unit: '1'
  });

  const requestCount = meter.createCounter('app_http_server_request_count', {
    description: 'Total number of completed HTTP requests.'
  });
  const requestErrorCount = meter.createCounter('app_http_server_request_error_count', {
    description: 'Total number of completed HTTP requests with error status codes.'
  });
  const requestDuration = meter.createHistogram('app_http_server_request_duration_ms', {
    description: 'Duration of completed HTTP requests in milliseconds.',
    unit: 'ms'
  });

  const customCounters = new Map();
  const customHistograms = new Map();
  const customGauges = new Map();

  const memoryRssGauge = meter.createObservableGauge('app_runtime_memory_rss_bytes', {
    description: 'Resident memory usage in bytes.'
  });
  const heapUsedGauge = meter.createObservableGauge('app_runtime_heap_used_bytes', {
    description: 'Heap used in bytes.'
  });
  const eventLoopLagGauge = meter.createObservableGauge('app_runtime_event_loop_lag_ms', {
    description: 'Observed event loop lag in milliseconds.'
  });
  const uptimeGauge = meter.createObservableGauge('app_runtime_uptime_seconds', {
    description: 'Node.js process uptime in seconds.'
  });

  let eventLoopLagMs = 0;
  let lastCheck = process.hrtime.bigint();
  const interval = Math.max(1000, Math.min(config.metricsInterval, 60000));
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const diffMs = Number(now - lastCheck) / 1e6;
    eventLoopLagMs = Math.max(0, diffMs - interval);
    lastCheck = now;
  }, interval);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  meter.addBatchObservableCallback((observableResult) => {
    const memoryUsage = process.memoryUsage();

    observableResult.observe(memoryRssGauge, memoryUsage.rss);
    observableResult.observe(heapUsedGauge, memoryUsage.heapUsed);
    observableResult.observe(eventLoopLagGauge, eventLoopLagMs);
    observableResult.observe(uptimeGauge, process.uptime());

  }, [memoryRssGauge, heapUsedGauge, eventLoopLagGauge, uptimeGauge]);

  function getOrCreateCounter(name) {
    if (!customCounters.has(name)) {
      customCounters.set(name, meter.createCounter(name));
    }

    return customCounters.get(name);
  }

  function getOrCreateHistogram(name) {
    if (!customHistograms.has(name)) {
      customHistograms.set(name, meter.createHistogram(name));
    }

    return customHistograms.get(name);
  }

  function getOrCreateGauge(name) {
    if (!customGauges.has(name)) {
      const entry: any = {
        value: 0,
        attributes: {}
      };

      entry.instrument = meter.createObservableGauge(name, {
        description: 'Custom observable gauge created by the observability package.'
      });
      entry.instrument.addCallback((observableResult) => {
        observableResult.observe(entry.value, entry.attributes || {});
      });

      customGauges.set(name, entry);
    }

    return customGauges.get(name);
  }

  state.metricTools = {
    meter,
    requestCount,
    requestErrorCount,
    requestDuration,
    standardRequestCount,
    standardRequestErrors,
    standardRequestDuration,
    customCounters,
    customHistograms,
    customGauges,
    cleanup() {
      clearInterval(timer);
    },
    incrementCounter(name, value, attributes) {
      getOrCreateCounter(name).add(value === undefined ? 1 : value, attributes || {});
    },
    recordHistogram(name, value, attributes) {
      getOrCreateHistogram(name).record(value, attributes || {});
    },
    setGauge(name, value, attributes) {
      const gaugeEntry = getOrCreateGauge(name);
      gaugeEntry.value = value;
      gaugeEntry.attributes = attributes || {};
    }
  };

  return state.metricTools;
}

module.exports = {
  createMetricsRuntime
};
