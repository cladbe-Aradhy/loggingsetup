import * as grpc from '@grpc/grpc-js';
import { SIGNOZ_OTLP_GRPC_TARGET } from '../config';
import { normalizeGrpcTarget, usesTls } from '../utils/grpc-utils';
import { LogsService } from './proto-loader';

export const upstreamLogsClient = new LogsService(
  normalizeGrpcTarget(SIGNOZ_OTLP_GRPC_TARGET),
  usesTls(SIGNOZ_OTLP_GRPC_TARGET)
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure()
);
