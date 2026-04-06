'use strict';

const { diag, DiagConsoleLogger, DiagLogLevel, SpanStatusCode, trace, metrics } = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { OTLPTraceExporter: OTLPTraceExporterHttp } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPTraceExporter: OTLPTraceExporterGrpc } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { OTLPMetricExporter: OTLPMetricExporterHttp } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPMetricExporter: OTLPMetricExporterGrpc } = require('@opentelemetry/exporter-metrics-otlp-grpc');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { DnsInstrumentation } = require('@opentelemetry/instrumentation-dns');
const { Metadata } = require('@grpc/grpc-js');

function normalizeGrpcEndpoint(endpoint) {
  const value = String(endpoint || '').trim();

  if (!value) {
    return value;
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
    return value;
  }

  return 'http://' + value;
}

function buildGrpcMetadata(headers) {
  const metadata = new Metadata();

  Object.entries(headers || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    metadata.set(key, String(value));
  });

  return metadata;
}

function buildResource(config) {
  return new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion,
    'deployment.environment.name': config.environment,
    ...config.extraResourceAttributes
  });
}

function buildAutoInstrumentations(config) {
  const disabled = new Set((config.disableAutoInstrumentations || []).map((name) => String(name).trim()));

  return [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: !disabled.has('fs') },
      '@opentelemetry/instrumentation-http': {
        enabled: !disabled.has('http'),
        ignoreIncomingRequestHook: () => false
      },
      '@opentelemetry/instrumentation-express': { enabled: !disabled.has('express') },
      '@opentelemetry/instrumentation-net': { enabled: !disabled.has('net') },
      '@opentelemetry/instrumentation-runtime-node': { enabled: !disabled.has('runtime-node') }
    }),
    new DnsInstrumentation({
      enabled: !disabled.has('dns')
    })
  ];
}

function buildExporterOptions(config, signalPath) {
  const protocol = String(config.otlpProtocol || 'grpc').toLowerCase();
  const baseEndpoint = String(config.otlpEndpoint || '').replace(/\/$/, '');

  if (protocol === 'grpc') {
    return {
      protocol,
      options: {
        url: normalizeGrpcEndpoint(baseEndpoint),
        metadata: buildGrpcMetadata(config.headers)
      }
    };
  }

  return {
    protocol,
    options: {
      url: baseEndpoint.endsWith(signalPath) ? baseEndpoint : baseEndpoint + signalPath,
      headers: config.headers
    }
  };
}

function buildTraceExporter(config) {
  const exporterConfig = buildExporterOptions(config, '/v1/traces');
  return exporterConfig.protocol === 'grpc'
    ? new OTLPTraceExporterGrpc(exporterConfig.options)
    : new OTLPTraceExporterHttp(exporterConfig.options);
}

function buildMetricExporter(config) {
  const exporterConfig = buildExporterOptions(config, '/v1/metrics');
  return exporterConfig.protocol === 'grpc'
    ? new OTLPMetricExporterGrpc(exporterConfig.options)
    : new OTLPMetricExporterHttp(exporterConfig.options);
}

async function createTracingRuntime(config) {
  if (config.debug) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const resource = buildResource(config);
  const traceExporter = buildTraceExporter(config);
  const metricExporter = buildMetricExporter(config);
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: config.metricsInterval
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations: buildAutoInstrumentations(config)
  });

  await sdk.start();

  return {
    sdk,
    resource,
    tracer: trace.getTracer(config.serviceName, config.serviceVersion),
    meterProvider: metrics.getMeterProvider()
  };
}

function markSpanError(span, error) {
  if (!span || !error) {
    return;
  }

  span.recordException(error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message || String(error)
  });
}

module.exports = {
  createTracingRuntime,
  markSpanError,
  buildResource,
  buildExporterOptions,
  normalizeGrpcEndpoint,
  buildGrpcMetadata
};
