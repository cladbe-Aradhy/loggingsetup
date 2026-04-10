import * as grpc from '@grpc/grpc-js';
import { MAX_FORWARD_ATTEMPTS } from '../constants';
import {
  ENABLE_SIGNOZ_FORWARD,
  MAX_DEAD_QUEUE_SIZE,
  SIGNOZ_FORWARD_TIMEOUT_MS,
  SIGNOZ_OTLP_GRPC_TARGET
} from '../config';
import { upstreamLogsClient } from '../grpc/upstream-client';
import {
  markPayloadAsForwarded,
  markPayloadAttemptFailed,
  notePendingPayload,
  trimDeadQueue,
  type StoredPayload
} from '../storage/local-store';
import type { ForwardResult } from '../types/gateway-types';
import { buildGrpcUpstreamPayload } from '../utils/payload-utils';

// Stored payload ids that are currently being forwarded.
const processingPayloadIds = new Set<number>();

export async function tryForwardStoredPayload(item: StoredPayload) {
  if (item.queueName === 'dead') {
    return {
      attempted: false,
      forwarded: false,
      target: SIGNOZ_OTLP_GRPC_TARGET,
      reason: 'payload is already in dead queue'
    };
  }

  if (processingPayloadIds.has(item.id)) {
    return {
      attempted: false,
      forwarded: false,
      target: SIGNOZ_OTLP_GRPC_TARGET,
      reason: 'payload is already being processed'
    };
  }

  processingPayloadIds.add(item.id);

  try {
    if (!ENABLE_SIGNOZ_FORWARD) {
      const forwardResult = {
        attempted: false,
        forwarded: false,
        target: SIGNOZ_OTLP_GRPC_TARGET,
        reason: 'forwarding disabled by config'
      };

      notePendingPayload(item, forwardResult.reason, null);
      return forwardResult;
    }

    const grpcPayload = buildGrpcUpstreamPayload(item);

    if (!grpcPayload.ok) {
      const forwardResult = {
        attempted: true,
        forwarded: false,
        target: SIGNOZ_OTLP_GRPC_TARGET,
        error: grpcPayload.error,
        grpcCode: grpcPayload.grpcCode
      };

      markPayloadAttemptFailed(
        item,
        forwardResult.error || null,
        forwardResult.grpcCode || null,
        MAX_FORWARD_ATTEMPTS
      );
      trimDeadQueue(MAX_DEAD_QUEUE_SIZE);
      return forwardResult;
    }

    const forwardResult = await new Promise<ForwardResult>((resolve) => {
      upstreamLogsClient.Export(
        grpcPayload.requestPayload,
        {
          deadline: Date.now() + SIGNOZ_FORWARD_TIMEOUT_MS
        },
        (error: grpc.ServiceError | null) => {
          if (error) {
            resolve({
              attempted: true,
              forwarded: false,
              target: SIGNOZ_OTLP_GRPC_TARGET,
              error: error.message,
              grpcCode: error.code
            });
            return;
          }

          resolve({
            attempted: true,
            forwarded: true,
            target: SIGNOZ_OTLP_GRPC_TARGET
          });
        }
      );
    });

    if (forwardResult.forwarded) {
      markPayloadAsForwarded(item);
      return forwardResult;
    }

    if (!forwardResult.attempted) {
      notePendingPayload(
        item,
        forwardResult.reason || forwardResult.error || null,
        forwardResult.grpcCode || null
      );
      return forwardResult;
    }

    markPayloadAttemptFailed(
      item,
      forwardResult.error || forwardResult.reason || null,
      forwardResult.grpcCode || null,
      MAX_FORWARD_ATTEMPTS
    );
    trimDeadQueue(MAX_DEAD_QUEUE_SIZE);
    return forwardResult;
  } finally {
    processingPayloadIds.delete(item.id);
  }
}
