import * as grpc from '@grpc/grpc-js';

export type GrpcExportCallback = (
  error: grpc.ServiceError | null,
  response?: {}
) => void;

export type ForwardResult = {
  attempted: boolean;
  forwarded: boolean;
  target: string;
  reason?: string;
  error?: string;
  grpcCode?: number;
};

export type GrpcUpstreamPayloadResult =
  | {
      ok: true;
      requestPayload: unknown;
    }
  | {
      ok: false;
      error: string;
      grpcCode: number;
    };
