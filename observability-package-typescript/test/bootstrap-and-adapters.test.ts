'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  createPinoStreamAdapter,
  instrumentPinoLogger
} = require('../src/logging/adapters/pino');
const { instrumentWinstonLogger } = require('../src/logging/adapters/winston');

const bootstrapWarningFixture = path.join(__dirname, 'fixtures', 'bootstrap-warning-check.js');

function createPackageLoggerSink(entries) {
  return {
    debug(message, fields) {
      entries.push({ level: 'debug', message, fields });
    },
    info(message, fields) {
      entries.push({ level: 'info', message, fields });
    },
    warn(message, fields) {
      entries.push({ level: 'warn', message, fields });
    },
    error(message, fields) {
      entries.push({ level: 'error', message, fields });
    },
    fatal(message, fields) {
      entries.push({ level: 'fatal', message, fields });
    }
  };
}

function runBootstrapWarningScenario(name) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [bootstrapWarningFixture, name], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error('bootstrap warning scenario failed: ' + name + '\n' + stdout + '\n' + stderr));
        return;
      }

      resolve({
        stdout,
        stderr
      });
    });
  });
}

test('createPinoStreamAdapter derives message from nested error payloads', async () => {
  const entries = [];
  const stream = createPinoStreamAdapter(createPackageLoggerSink(entries), {
    component: 'api'
  });

  await new Promise<void>((resolve, reject) => {
    stream.write(Buffer.from(JSON.stringify({
      level: 50,
      err: {
        message: 'database timed out',
        code: 'DB_TIMEOUT'
      }
    })), (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'database timed out');
  assert.equal(entries[0].fields.err.code, 'DB_TIMEOUT');
});

test('instrumentPinoLogger is idempotent and preserves Error-first messages', () => {
  const entries = [];
  const packageLogger = createPackageLoggerSink(entries);
  const pinoLogger = {
    debug() {},
    info() {},
    warn() {},
    error(_value?: unknown) {},
    fatal() {}
  };

  instrumentPinoLogger(pinoLogger, packageLogger, {
    component: 'orders'
  });
  instrumentPinoLogger(pinoLogger, packageLogger, {
    component: 'orders'
  });

  const error = new Error('order lookup failed');
  error.code = 'ORDER_LOOKUP_FAILED';
  pinoLogger.error(error);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'order lookup failed');
  assert.equal(entries[0].fields.logger_type, 'pino');
  assert.equal(entries[0].fields.code, 'ORDER_LOOKUP_FAILED');
});

test('instrumentWinstonLogger only adds one transport per logger', () => {
  const entries = [];
  const packageLogger = createPackageLoggerSink(entries);
  const added = [];
  const winstonLogger = {
    add(transport) {
      added.push(transport);
    }
  };

  const first = instrumentWinstonLogger(winstonLogger, packageLogger, {
    component: 'payments'
  });
  const second = instrumentWinstonLogger(winstonLogger, packageLogger, {
    component: 'payments'
  });

  assert.equal(added.length, 1);
  assert.equal(first.transport, second.transport);
});

test('initObservability reuses the same in-flight startup promise', async () => {
  const bootstrapPath = require.resolve('../src/bootstrap');
  const tracingPath = require.resolve('../src/tracing');
  const providerPath = require.resolve('../src/logging/core/provider');
  const statePath = require.resolve('../src/bootstrap/state');

  const tracingModule = require(tracingPath);
  const providerModule = require(providerPath);
  const state = require(statePath);
  const originalCreateTracingRuntime = tracingModule.createTracingRuntime;
  const originalCreateLogProvider = providerModule.createLogProvider;
  let tracingCalls = 0;
  let providerCalls = 0;

  tracingModule.createTracingRuntime = async () => {
    tracingCalls += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    return {
      sdk: {
        shutdown: async () => {}
      },
      tracer: {},
      meterProvider: null,
      resource: {}
    };
  };

  providerModule.createLogProvider = () => {
    providerCalls += 1;
    return {
      provider: {
        shutdown: async () => {}
      },
      otelLogger: null
    };
  };

  delete require.cache[bootstrapPath];
  const bootstrap = require('../src/bootstrap');

  try {
    await Promise.all([
      bootstrap.initObservability({
        logLevel: 'fatal',
        enableConsoleCapture: false,
        captureUncaught: false,
        captureUnhandledRejection: false
      }),
      bootstrap.initObservability({
        logLevel: 'fatal',
        enableConsoleCapture: false,
        captureUncaught: false,
        captureUnhandledRejection: false
      })
    ]);

    assert.equal(tracingCalls, 1);
    assert.equal(providerCalls, 1);
  } finally {
    await bootstrap.shutdownObservability().catch(() => undefined);
    tracingModule.createTracingRuntime = originalCreateTracingRuntime;
    providerModule.createLogProvider = originalCreateLogProvider;
    state.initialized = false;
    state.initPromise = null;
    state.config = null;
    state.sdk = null;
    state.tracer = null;
    state.meterProvider = null;
    state.metricTools = null;
    state.loggerProvider = null;
    state.startupError = null;
    state.appLogger = null;
    state.consoleRestore = null;
    state.errorRestore = null;
    state.logDedupeEntries.clear();
    state.preloadedModules = [];
    delete require.cache[bootstrapPath];
  }
});

test('fresh bootstrap init does not emit a preloaded module warning', async () => {
  const result = await runBootstrapWarningScenario('fresh-init');

  assert.equal(result.stderr.includes('observability startup warning:'), false);
});

test('bootstrap warns when express is preloaded before init', async () => {
  const result = await runBootstrapWarningScenario('preload-express');

  assert.equal(result.stderr.includes('observability startup warning:'), true);
  assert.equal(result.stderr.includes('express'), true);
});
