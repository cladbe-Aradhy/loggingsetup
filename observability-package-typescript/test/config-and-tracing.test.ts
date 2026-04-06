'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveConfig } = require('../src/config');
const {
  buildExporterOptions,
  normalizeGrpcEndpoint,
  buildGrpcMetadata
} = require('../src/tracing');

test('resolveConfig defaults to gRPC OTLP export', () => {
  const config = resolveConfig({});

  assert.equal(config.otlpProtocol, 'grpc');
  assert.equal(config.otlpEndpoint, 'http://localhost:4317');
});

test('normalizeGrpcEndpoint preserves schemes and prefixes bare hosts', () => {
  assert.equal(normalizeGrpcEndpoint('127.0.0.1:4317'), 'http://127.0.0.1:4317');
  assert.equal(normalizeGrpcEndpoint('http://127.0.0.1:4317'), 'http://127.0.0.1:4317');
  assert.equal(normalizeGrpcEndpoint('https://collector.internal:4317'), 'https://collector.internal:4317');
});

test('buildGrpcMetadata converts headers into grpc metadata', () => {
  const metadata = buildGrpcMetadata({
    authorization: 'Bearer demo-token',
    'x-tenant': 'my-org'
  });

  assert.deepEqual(metadata.get('authorization'), ['Bearer demo-token']);
  assert.deepEqual(metadata.get('x-tenant'), ['my-org']);
});

test('buildExporterOptions uses gRPC url and metadata for grpc protocol', () => {
  const exporterConfig = buildExporterOptions({
    otlpProtocol: 'grpc',
    otlpEndpoint: '127.0.0.1:14317',
    headers: {
      authorization: 'Bearer demo-token'
    }
  }, '/v1/traces');

  assert.equal(exporterConfig.protocol, 'grpc');
  assert.equal(exporterConfig.options.url, 'http://127.0.0.1:14317');
  assert.deepEqual(exporterConfig.options.metadata.get('authorization'), ['Bearer demo-token']);
});

test('buildExporterOptions appends signal paths for http exporters', () => {
  const exporterConfig = buildExporterOptions({
    otlpProtocol: 'http/protobuf',
    otlpEndpoint: 'http://127.0.0.1:14318',
    headers: {
      authorization: 'Bearer demo-token'
    }
  }, '/v1/logs');

  assert.equal(exporterConfig.protocol, 'http/protobuf');
  assert.equal(exporterConfig.options.url, 'http://127.0.0.1:14318/v1/logs');
  assert.deepEqual(exporterConfig.options.headers, {
    authorization: 'Bearer demo-token'
  });
});
