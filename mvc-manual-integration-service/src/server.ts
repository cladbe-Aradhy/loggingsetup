import type { Server } from 'node:http';
import { initObservability, shutdownObservability } from '@my-org/observability-node-ts';
import { env } from './config/env';

let server: Server | null = null;

async function main() {
  await initObservability({
    serviceName: process.env.OTEL_SERVICE_NAME || 'mvc-manual-integration-service',
    serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || env.nodeEnv,
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4317',
    otlpProtocol: process.env.OTEL_EXPORTER_OTLP_PROTOCOL || 'grpc'
  });

  const { app } = await import('./app');

  server = app.listen(env.port, () => {
    process.stdout.write(
      `mvc-manual-integration-service listening on http://127.0.0.1:${env.port}\n`
    );
  });
}

async function shutdown() {
  if (!server) {
    await shutdownObservability();
    process.exit(0);
    return;
  }

  server.close(async () => {
    await shutdownObservability();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
  process.exit(1);
});
