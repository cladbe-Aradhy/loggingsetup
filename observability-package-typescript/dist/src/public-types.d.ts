import type { Span, SpanOptions } from '@opentelemetry/api';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { DestinationStream, Logger as PinoLogger } from 'pino';
import type winston = require('winston');
import type TransportStream = require('winston-transport');
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogFields = Record<string, unknown>;
export type SpanExecutionCallback<T = unknown> = (span: Span) => T | Promise<T>;
export interface LoggerEmitOptions {
    lockLevel?: boolean;
}
export interface AppLogger {
    child(bindings?: LogFields): AppLogger;
    debug(message: unknown, fields?: LogFields): void;
    info(message: unknown, fields?: LogFields): void;
    warn(message: unknown, fields?: LogFields): void;
    error(message: unknown, fields?: LogFields): void;
    fatal(message: unknown, fields?: LogFields): void;
    emitWithArgs(level: LogLevel, message: unknown, fields?: LogFields, args?: unknown[], options?: LoggerEmitOptions): void;
}
export interface InitObservabilityOptions {
    serviceName?: string;
    serviceVersion?: string;
    environment?: string;
    otlpEndpoint?: string;
    otlpProtocol?: string;
    headers?: Record<string, string>;
    logLevel?: LogLevel | string;
    enableConsoleCapture?: boolean;
    enableConsoleMirror?: boolean;
    redactKeys?: string[];
    disableAutoInstrumentations?: string[];
    metricsInterval?: number;
    captureUncaught?: boolean;
    captureUnhandledRejection?: boolean;
    emitOnlyWarnErrorFatal?: boolean;
    smartSeverityDetection?: boolean;
    debug?: boolean;
    logDedupeEnabled?: boolean;
    logDedupeWindowMs?: number;
    logDedupeLevels?: string[];
    logExportMaxQueueSize?: number;
    logExportMaxBatchSize?: number;
    logExportScheduledDelayMillis?: number;
    logExportTimeoutMillis?: number;
    failFast?: boolean;
    extraResourceAttributes?: Record<string, string>;
    loggerName?: string;
    consoleMirrorInDevelopmentOnly?: boolean;
    shutdownTimeoutMillis?: number;
}
export interface StartSpanFunction {
    (name: string, options?: SpanOptions): Span;
    <T>(name: string, options: SpanOptions | undefined, fn: SpanExecutionCallback<T>): Promise<T>;
}
export interface ExpressApi {
    requestContextMiddleware: RequestHandler;
    requestLoggingMiddleware: RequestHandler;
    errorMiddleware: ErrorRequestHandler;
}
export interface PinoAdaptersApi {
    createPinoStreamAdapter(bindings?: LogFields): DestinationStream;
    instrumentPinoLogger<TLogger extends PinoLogger>(logger: TLogger, bindings?: LogFields): TLogger;
}
export interface WinstonInstrumentResult<TLogger extends winston.Logger = winston.Logger> {
    logger: TLogger;
    transport: TransportStream;
}
export interface WinstonAdaptersApi {
    createWinstonTransport(bindings?: LogFields): TransportStream;
    instrumentWinstonLogger<TLogger extends winston.Logger>(logger: TLogger, bindings?: LogFields): WinstonInstrumentResult<TLogger>;
}
export interface ObservabilityAdaptersApi {
    pino: PinoAdaptersApi;
    winston: WinstonAdaptersApi;
}
export interface ObservabilityApi {
    initObservability(options?: InitObservabilityOptions): Promise<ObservabilityApi>;
    shutdownObservability(): Promise<void>;
    getLogger(): AppLogger;
    createChildLogger(bindings?: LogFields): AppLogger;
    startSpan: StartSpanFunction;
    recordException(error: unknown, options?: Record<string, unknown>): void;
    incrementCounter(name: string, value?: number, attributes?: LogFields): void;
    recordHistogram(name: string, value: number, attributes?: LogFields): void;
    setGauge(name: string, value: number, attributes?: LogFields): void;
    express: ExpressApi;
    adapters: ObservabilityAdaptersApi;
}
