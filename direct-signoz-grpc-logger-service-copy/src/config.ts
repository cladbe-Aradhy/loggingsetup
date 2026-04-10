export const config = {
  port: Number(process.env.PORT || 3097),
  nodeEnv: process.env.NODE_ENV || 'development',
  serviceName: process.env.SERVICE_NAME || 'direct-signoz-grpc-logger-service',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  signozLogsGrpcUrl: process.env.SIGNOZ_LOGS_GRPC_URL || 'http://127.0.0.1:4317',
  enableConsoleMirror: process.env.ENABLE_CONSOLE_MIRROR !== 'false'
};
