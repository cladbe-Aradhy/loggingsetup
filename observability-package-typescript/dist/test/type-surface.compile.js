"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pino_1 = __importDefault(require("pino"));
const winston = require("winston");
const index_1 = require("../index");
const apiPromise = (0, index_1.initObservability)();
void apiPromise;
const logger = (0, index_1.getLogger)();
const childLogger = (0, index_1.createChildLogger)({
    component: 'type-surface'
});
logger.info('logger works');
childLogger.warn('child logger works');
const expressApi = index_1.express;
void expressApi.requestContextMiddleware;
void expressApi.requestLoggingMiddleware;
void expressApi.errorMiddleware;
const adaptersApi = index_1.adapters;
const pinoStream = adaptersApi.pino.createPinoStreamAdapter({
    component: 'typed-pino'
});
const pinoLogger = (0, pino_1.default)({}, pinoStream);
const instrumentedPino = adaptersApi.pino.instrumentPinoLogger(pinoLogger, {
    component: 'typed-pino'
});
instrumentedPino.info('typed pino logger works');
const winstonTransport = adaptersApi.winston.createWinstonTransport({
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
(0, index_1.incrementCounter)('type_surface_counter_total', 1, {
    source: 'type-surface'
});
(0, index_1.recordHistogram)('type_surface_histogram_ms', 12, {
    source: 'type-surface'
});
(0, index_1.setGauge)('type_surface_last_value', 12, {
    source: 'type-surface'
});
const span = (0, index_1.startSpan)('type-surface-span');
span.end();
const spanResult = (0, index_1.startSpan)('type-surface-span-callback', {}, async (activeSpan) => {
    const typedSpan = activeSpan;
    typedSpan.end();
    return 42;
});
void spanResult;
