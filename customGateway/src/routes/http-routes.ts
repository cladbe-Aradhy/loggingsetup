import type { Hono } from 'hono';
import { MAX_FORWARD_ATTEMPTS } from '../constants';
import {
  ENABLE_SIGNOZ_FORWARD,
  GRPC_PORT,
  PORT,
  SIGNOZ_OTLP_GRPC_TARGET
} from '../config';
import { handleHttpLogs } from '../controllers/logs-http-controller';
import {
  clearStore,
  deadQueue,
  freshQueue,
  getAllStoredPayloads,
  getQueueCounts
} from '../storage/local-store';
import { isGatewayShuttingDown } from '../state/gateway-state';

export function registerHttpRoutes(app: Hono) {
  app.get('/', (c) => {
    return c.json({
      ok: true,
      message: 'custom gateway is running',
      shuttingDown: isGatewayShuttingDown(),
      maxForwardAttempts: MAX_FORWARD_ATTEMPTS,
      signozForward: {
        enabled: ENABLE_SIGNOZ_FORWARD,
        upstreamProtocol: 'grpc',
        grpcTarget: SIGNOZ_OTLP_GRPC_TARGET
      },
      queueCounts: getQueueCounts(),
      endpoints: [
        'POST /v1/logs',
        `OTLP gRPC logs on :${GRPC_PORT} -> LogsService/Export`,
        'GET /health',
        'GET /debug/store',
        'DELETE /debug/store'
      ]
    });
  });

  app.get('/health', (c) => {
    const statusCode = isGatewayShuttingDown() ? 503 : 200;

    return c.json(
      {
        ok: !isGatewayShuttingDown(),
        service: 'custom-gateway',
        shuttingDown: isGatewayShuttingDown(),
        acceptingTraffic: !isGatewayShuttingDown(),
        maxForwardAttempts: MAX_FORWARD_ATTEMPTS,
        queueCounts: getQueueCounts(),
        httpPort: PORT,
        grpcPort: GRPC_PORT,
        signozForwardEnabled: ENABLE_SIGNOZ_FORWARD,
        signozForwardProtocol: 'grpc',
        signozOtlpGrpcTarget: SIGNOZ_OTLP_GRPC_TARGET
      },
      statusCode
    );
  });

  app.post('/v1/logs', async (c) => {
    return handleHttpLogs(c);
  });

  app.get('/debug/store', (c) => {
    return c.json({
      ok: true,
      shuttingDown: isGatewayShuttingDown(),
      maxForwardAttempts: MAX_FORWARD_ATTEMPTS,
      queueCounts: getQueueCounts(),
      freshQueue,
      deadQueue,
      allStoredPayloads: getAllStoredPayloads()
    });
  });

  app.delete('/debug/store', (c) => {
    clearStore();

    return c.json({
      ok: true,
      message: 'memory store cleared',
      queueCounts: getQueueCounts()
    });
  });
}
