import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./dist/index.js');

export const initObservability = pkg.initObservability;
export const shutdownObservability = pkg.shutdownObservability;
export const getLogger = pkg.getLogger;
export const createChildLogger = pkg.createChildLogger;
export const startSpan = pkg.startSpan;
export const recordException = pkg.recordException;
export const incrementCounter = pkg.incrementCounter;
export const recordHistogram = pkg.recordHistogram;
export const setGauge = pkg.setGauge;
export const express = pkg.express;
export const adapters = pkg.adapters;

export default pkg;
