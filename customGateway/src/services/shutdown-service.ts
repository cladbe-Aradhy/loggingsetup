import * as grpc from '@grpc/grpc-js';
import { SHUTDOWN_DRAIN_TIMEOUT_MS } from '../config';
import { upstreamLogsClient } from '../grpc/upstream-client';
import { getLivePayloadCount } from '../storage/local-store';
import { isGatewayShuttingDown, markGatewayShuttingDown } from '../state/gateway-state';
import { sleep } from '../utils/async-utils';
import { processStoredPayloadQueue } from './queue-processor';

type HttpServer = {
  close: (callback: (error?: Error) => void) => void;
};

async function drainQueuesBeforeShutdown() {
  const deadline = Date.now() + SHUTDOWN_DRAIN_TIMEOUT_MS;

  while (getLivePayloadCount() > 0 && Date.now() < deadline) {
    await processStoredPayloadQueue();

    if (getLivePayloadCount() === 0) {
      return;
    }

    await sleep(250);
  }
}

async function closeHttpServer(server: HttpServer) {
  return new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function closeGrpcServer(server: grpc.Server) {
  return new Promise<void>((resolve) => {
    server.tryShutdown(() => {
      resolve();
    });
  });
}

export async function startGracefulShutdown(
  signal: string,
  retryInterval: NodeJS.Timeout,
  httpServer: HttpServer,
  grpcServer: grpc.Server
) {
  if (isGatewayShuttingDown()) {
    return;
  }

  markGatewayShuttingDown();
  clearInterval(retryInterval);

  process.stdout.write(
    `received ${signal}, stopping new traffic and draining in-memory queues\n`
  );

  await Promise.allSettled([
    closeHttpServer(httpServer),
    closeGrpcServer(grpcServer)
  ]);

  await drainQueuesBeforeShutdown();

  const remainingLivePayloads = getLivePayloadCount();

  if (remainingLivePayloads > 0) {
    process.stdout.write(
      `shutdown finished with ${remainingLivePayloads} fresh payloads still in memory\n`
    );
  } else {
    process.stdout.write('shutdown drained all fresh in-memory payloads\n');
  }

  upstreamLogsClient.close();
  process.exit(remainingLivePayloads === 0 ? 0 : 1);
}
