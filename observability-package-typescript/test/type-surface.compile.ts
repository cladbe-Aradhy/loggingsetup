import type { Span } from '@opentelemetry/api';
import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';
import winston = require('winston');
import type TransportStream = require('winston-transport');

import {
  adapters,
  createChildLogger,
  express as observabilityExpress,
  getLogger,
  incrementCounter,
  initObservability,
  recordHistogram,
  setGauge,
  startSpan
} from '../index';
import type {
  AppLogger,
  ExpressApi,
  ObservabilityAdaptersApi,
  ObservabilityApi
} from '../index';

const apiPromise: Promise<ObservabilityApi> = initObservability();
void apiPromise;

const logger: AppLogger = getLogger();
const childLogger: AppLogger = createChildLogger({
  component: 'type-surface'
});

logger.info('logger works');
childLogger.warn('child logger works');

const expressApi: ExpressApi = observabilityExpress;
void expressApi.requestContextMiddleware;
void expressApi.requestLoggingMiddleware;
void expressApi.errorMiddleware;

const adaptersApi: ObservabilityAdaptersApi = adapters;
const pinoStream: DestinationStream = adaptersApi.pino.createPinoStreamAdapter({
  component: 'typed-pino'
});
const pinoLogger: PinoLogger = pino({}, pinoStream);
const instrumentedPino: PinoLogger = adaptersApi.pino.instrumentPinoLogger(pinoLogger, {
  component: 'typed-pino'
});
instrumentedPino.info('typed pino logger works');

const winstonTransport: TransportStream = adaptersApi.winston.createWinstonTransport({
  component: 'typed-winston'
});
const winstonLogger = winston.createLogger({
  transports: [new winston.transports.Console()]
});
const instrumentedWinston = adaptersApi.winston.instrumentWinstonLogger(winstonLogger, {
  component: 'typed-winston'
});

instrumentedWinston.logger.add(winstonTransport);
instrumentedWinston.transport;

incrementCounter('type_surface_counter_total', 1, {
  source: 'type-surface'
});
recordHistogram('type_surface_histogram_ms', 12, {
  source: 'type-surface'
});
setGauge('type_surface_last_value', 12, {
  source: 'type-surface'
});

const span: Span = startSpan('type-surface-span');
span.end();

const spanResult: Promise<number> = startSpan('type-surface-span-callback', {}, async (activeSpan) => {
  const typedSpan: Span = activeSpan;
  typedSpan.end();
  return 42;
});

void spanResult;
