import { app } from './app';
import { config } from './config';
import { logger, shutdownLogger } from './logger';

const server = app.listen(config.port, () => {
  logger.info('direct signoz grpc logger service listening', {
    port: config.port,
    signoz_logs_grpc_url: config.signozLogsGrpcUrl
  });
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  server.close(async () => {
    await shutdownLogger();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
