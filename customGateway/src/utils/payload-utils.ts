import * as grpc from '@grpc/grpc-js';
import type { StoredPayload } from '../storage/local-store';
import type { GrpcUpstreamPayloadResult } from '../types/gateway-types';

function isObjectPayload(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildGrpcUpstreamPayload(
  item: StoredPayload
): GrpcUpstreamPayloadResult {
  if (item.transport === 'grpc') {
    if (!isObjectPayload(item.bodyJson)) {
      return {
        ok: false,
        error: 'stored gRPC payload is missing a valid request body',
        grpcCode: grpc.status.INVALID_ARGUMENT
      };
    }

    return {
      ok: true,
      requestPayload: item.bodyJson
    };
  }

  if (!item.contentType.toLowerCase().includes('json')) {
    return {
      ok: false,
      error: `HTTP logs must arrive as OTLP JSON (got ${item.contentType})`,
      grpcCode: grpc.status.INVALID_ARGUMENT
    };
  }

  if (!isObjectPayload(item.bodyJson)) {
    return {
      ok: false,
      error: 'HTTP log payload is not valid JSON',
      grpcCode: grpc.status.INVALID_ARGUMENT
    };
  }

  return {
    ok: true,
    requestPayload: item.bodyJson
  };
}
