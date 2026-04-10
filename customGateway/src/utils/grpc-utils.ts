import * as grpc from '@grpc/grpc-js';

export function usesTls(target: string) {
  return target.startsWith('https://') || target.startsWith('grpcs://');
}

export function normalizeGrpcTarget(target: string) {
  return target.replace(/^[a-z]+:\/\//i, '');
}

export function createGrpcServiceError(message: string, code: grpc.status) {
  const error = new Error(message) as grpc.ServiceError;
  error.code = code;
  error.details = message;
  error.metadata = new grpc.Metadata();
  return error;
}
