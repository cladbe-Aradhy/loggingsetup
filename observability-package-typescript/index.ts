'use strict';

import type {
  ExpressApi,
  ObservabilityAdaptersApi,
  AppLogger,
  InitObservabilityOptions,
  LogFields,
  ObservabilityApi,
  StartSpanFunction
} from './src/public-types';

const bootstrap = require('./src/bootstrap') as ObservabilityApi;

export type {
  ExpressApi,
  ObservabilityAdaptersApi,
  AppLogger,
  InitObservabilityOptions,
  LogFields,
  ObservabilityApi,
  StartSpanFunction
} from './src/public-types';

export const initObservability = (options?: InitObservabilityOptions) => bootstrap.initObservability(options);
export const shutdownObservability = () => bootstrap.shutdownObservability();
export const getLogger = (): AppLogger => bootstrap.getLogger();
export const createChildLogger = (bindings?: LogFields): AppLogger => bootstrap.createChildLogger(bindings);
export const startSpan = ((name, options, fn) => bootstrap.startSpan(name, options, fn)) as StartSpanFunction;
export const recordException = bootstrap.recordException;
export const incrementCounter = bootstrap.incrementCounter;
export const recordHistogram = bootstrap.recordHistogram;
export const setGauge = bootstrap.setGauge;
export const express: ExpressApi = bootstrap.express;
export const adapters: ObservabilityAdaptersApi = bootstrap.adapters;
