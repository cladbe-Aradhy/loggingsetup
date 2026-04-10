import { app } from './app';
import { config } from './config';
import { logger } from './logger';

const server = app.listen(config.port, () => {
  logger.info('direct signoz logger service listening', {
    port: config.port,
    signoz_logs_url: config.signozLogsUrl
  });
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
