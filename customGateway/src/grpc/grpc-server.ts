import * as grpc from '@grpc/grpc-js';
import { GRPC_PORT } from '../config';
import { handleGrpcLogsExport } from '../controllers/logs-grpc-controller';
import type { GrpcExportCallback } from '../types/gateway-types';
import { LogsService } from './proto-loader';

export function createGrpcLogsServer() {
  const grpcServer = new grpc.Server();

  grpcServer.addService(LogsService.service, {
    Export(call: { request: unknown }, callback: GrpcExportCallback) {
      void handleGrpcLogsExport(call, callback);
    }
  });

  return grpcServer;
}

export function startGrpcLogsServer(grpcServer: grpc.Server) {
  grpcServer.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        throw error;
      }

      grpcServer.start();
      process.stdout.write(`custom-gateway gRPC listening on 127.0.0.1:${port}\n`);
    }
  );
}
