export const config = {
  port: Number(process.env.PORT || 3095),
  nodeEnv: process.env.NODE_ENV || 'development',
  serviceName: process.env.SERVICE_NAME || 'direct-signoz-logger-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  signozLogsUrl: process.env.SIGNOZ_LOGS_URL || 'http://127.0.0.1:4322/v1/logs',
  enableConsoleMirror: process.env.ENABLE_CONSOLE_MIRROR !== 'false',
  logLevel: process.env.LOG_LEVEL || 'info'
};

