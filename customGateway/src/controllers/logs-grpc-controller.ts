import * as grpc from '@grpc/grpc-js';
import { saveJsonPayload } from '../storage/local-store';
import { otlpLogsPayloadSchema } from '../validation/otlp-logs-schema';
import { tryForwardStoredPayload } from '../services/log-forwarder';
import { canAcceptNewPayload } from '../services/traffic';
import { isGatewayShuttingDown } from '../state/gateway-state';
import type { GrpcExportCallback } from '../types/gateway-types';
import { buildFreshQueueMessage } from '../utils/forward-messages';
import { createGrpcServiceError } from '../utils/grpc-utils';

export async function handleGrpcLogsExport(
  call: { request: unknown },
  callback: GrpcExportCallback
) {
  if (isGatewayShuttingDown()) {
    callback(
      createGrpcServiceError(
        'gateway is shutting down and not accepting new logs',
        grpc.status.UNAVAILABLE
      )
    );
    return;
  }

  if (!canAcceptNewPayload()) {
    callback(
      createGrpcServiceError(
        'fresh in-memory queue is full',
        grpc.status.RESOURCE_EXHAUSTED
      )
    );
    return;
  }

  try {
    const validationResult = otlpLogsPayloadSchema.validate(call.request);

    if (validationResult.error) {
      callback(
        createGrpcServiceError(
          validationResult.error.details[0]?.message || 'gRPC logs payload is invalid',
          grpc.status.INVALID_ARGUMENT
        )
      );
      return;
    }

    const stored = saveJsonPayload('logs', 'grpc', 'application/grpc+proto', call.request);
    const forwardResult = await tryForwardStoredPayload(stored);

    if (forwardResult.forwarded) {
      callback(null, {});
      return;
    }

    callback(
      createGrpcServiceError(
        buildFreshQueueMessage(stored, forwardResult),
        grpc.status.UNAVAILABLE
      )
    );
  } catch (error) {
    callback(
      createGrpcServiceError(
        error instanceof Error ? error.message : String(error),
        grpc.status.INTERNAL
      )
    );
  }
}
