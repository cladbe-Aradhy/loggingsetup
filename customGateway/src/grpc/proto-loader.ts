import path from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const protoRoot = path.resolve(__dirname, '../../proto');
const logsServiceProtoPath = path.join(
  protoRoot,
  'opentelemetry/proto/collector/logs/v1/logs_service.proto'
);

const packageDefinition = protoLoader.loadSync(logsServiceProtoPath, {
  longs: String,
  defaults: true,
  enums: Number,
  oneofs: true,
  includeDirs: [protoRoot]
});

const loadedDefinition = grpc.loadPackageDefinition(packageDefinition) as any;

export const LogsService =
  loadedDefinition.opentelemetry.proto.collector.logs.v1.LogsService;
