'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { OTLPLogExporter: OTLPLogExporterHttp } = require('@opentelemetry/exporter-logs-otlp-http');
const { OTLPLogExporter: OTLPLogExporterGrpc } = require('@opentelemetry/exporter-logs-otlp-grpc');
const { logs } = require('@opentelemetry/api-logs');
const { buildExporterOptions } = require('../../tracing');
function createExporter(config) {
    const exporterConfig = buildExporterOptions(config, '/v1/logs');
    return exporterConfig.protocol === 'grpc'
        ? new OTLPLogExporterGrpc(exporterConfig.options)
        : new OTLPLogExporterHttp(exporterConfig.options);
}
function createLogProvider(config, resource) {
    const provider = new LoggerProvider({
        resource
    });
    provider.addLogRecordProcessor(new BatchLogRecordProcessor(createExporter(config), {
        maxQueueSize: config.logExportMaxQueueSize,
        maxExportBatchSize: config.logExportMaxBatchSize,
        scheduledDelayMillis: config.logExportScheduledDelayMillis,
        exportTimeoutMillis: config.logExportTimeoutMillis
    }));
    logs.setGlobalLoggerProvider(provider);
    return {
        provider,
        otelLogger: logs.getLogger(config.loggerName)
    };
}
module.exports = {
    createLogProvider
};
