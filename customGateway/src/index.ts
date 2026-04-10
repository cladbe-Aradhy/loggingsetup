import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { PORT, QUEUE_RETRY_INTERVAL_MS } from './config';
import { createGrpcLogsServer, startGrpcLogsServer } from './grpc/grpc-server';
import { registerHttpRoutes } from './routes/http-routes';
import { processStoredPayloadQueue } from './services/queue-processor';
import { startGracefulShutdown } from './services/shutdown-service';

const app = new Hono();
registerHttpRoutes(app);

const grpcServer = createGrpcLogsServer();

const retryInterval = setInterval(() => {
  void processStoredPayloadQueue();
}, QUEUE_RETRY_INTERVAL_MS);

const httpServer = serve(
  {
    fetch: app.fetch,
    port: PORT
  },
  (info) => {
    process.stdout.write(
      `custom-gateway HTTP listening on http://127.0.0.1:${info.port}\n`
    );
  }
);

startGrpcLogsServer(grpcServer);

process.on('SIGTERM', () => {
  void startGracefulShutdown('SIGTERM', retryInterval, httpServer, grpcServer);
});

process.on('SIGINT', () => {
  void startGracefulShutdown('SIGINT', retryInterval, httpServer, grpcServer);
});
