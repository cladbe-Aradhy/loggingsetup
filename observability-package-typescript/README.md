# @my-org/observability-node-ts

`@my-org/observability-node-ts` is a backend-only Node.js observability package for Express and general Node services. It provides:

- OpenTelemetry traces exported with OTLP
- OpenTelemetry metrics exported with OTLP
- Structured JSON logs with trace and span correlation
- Broad log compatibility helpers for `console`, `pino`, and `winston`
- Error capture for Express and process-level failures
- Manual span and custom metrics helpers
- Graceful shutdown flushing

The package is designed from day one for a central OpenTelemetry Collector or Gateway architecture. Services send telemetry to an OTLP endpoint. Today that endpoint can be a vendor backend or local collector. Later it can be a central collector or gateway. In normal service code, the main change should only be configuration.

## Why central collector-ready design matters

If every service is already emitting OTLP, you can move from:

- service -> backend

to:

- service -> central OTel collector/gateway -> backend(s)

without rewriting each service. That keeps your instrumentation package stable and makes vendor routing, filtering, enrichment, retry, batching, and policy changes easier later.

## Installation

```bash
npm install @my-org/observability-node-ts
```

Works for both:

- CommonJS services using `require(...)`
- ESM / TypeScript services using `import ... from ...`

For the examples in this repository:

```bash
npm install
```

## Quick Start

Initialize as early as possible in your service startup, before loading most instrumented libraries.

```js
const {
  initObservability,
  getLogger,
  express: observabilityExpress
} = require('@my-org/observability-node-ts');

async function main() {
  await initObservability({
    serviceName: 'order-service',
    serviceVersion: '1.0.0'
  });

  const express = require('express');
  const app = express();
  const logger = getLogger();

  app.use(observabilityExpress.requestContextMiddleware);
  app.use(observabilityExpress.requestLoggingMiddleware);

  app.get('/health', (req, res) => {
    logger.info('health check called');
    res.json({ ok: true });
  });

  app.use(observabilityExpress.errorMiddleware);
  app.listen(3000);
}

main().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exit(1);
});
```

## ESM / TypeScript Quick Start

```ts
import {
  express as observabilityExpress,
  initObservability
} from '@my-org/observability-node-ts';

async function main() {
  await initObservability({
    serviceName: 'order-service',
    serviceVersion: '1.0.0'
  });

  const express = await import('express');
  const app = express.default();

  app.use(express.json());
  app.use(observabilityExpress.requestContextMiddleware);
  app.use(observabilityExpress.requestLoggingMiddleware);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(observabilityExpress.errorMiddleware);
  app.listen(3000);
}

void main();
```

If you do not `await` initialization, the package still tries to start safely, but you can miss some early auto-instrumentation coverage. For best tracing coverage, initialize early and await it during bootstrap.

Important:
- initialize before `require('express')`, `require('http')`, database clients, or other instrumented libraries
- if instrumented modules are loaded first, logs and metrics can still work while trace coverage becomes partial or missing

## Real Service Integration

For a typical Express service, the integration can stay small.

```js
const {
  initObservability,
  shutdownObservability,
  express: observabilityExpress
} = require('@my-org/observability-node-ts');

async function main() {
  await initObservability({
    serviceName: process.env.OTEL_SERVICE_NAME || 'order-service',
    serviceVersion: process.env.SERVICE_VERSION || '1.0.0'
  });

  const express = require('express');
  const app = express();

  app.use(express.json());
  app.use(observabilityExpress.requestContextMiddleware);
  app.use(observabilityExpress.requestLoggingMiddleware);

  app.get('/health', (req, res) => {
    req.log.info('health route hit');
    res.json({ ok: true });
  });

  app.use(observabilityExpress.errorMiddleware);

  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port);

  async function stop() {
    server.close(async () => {
      await shutdownObservability();
      process.exit(0);
    });
  }

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exit(1);
});
```

## Express Integration

Recommended middleware order:

```js
app.use(express.json());
app.use(observabilityExpress.requestContextMiddleware);
app.use(observabilityExpress.requestLoggingMiddleware);
// routes
app.use(observabilityExpress.errorMiddleware);
```

What this gives you:

- request-scoped logger on `req.log`
- `x-request-id` response header
- request start and completion logs
- request count, error count, and duration metrics
- error recording on the active span
- JSON error responses if your app has not already sent headers

## Pino Integration

There are two practical paths.

1. Use a package-provided writable stream so pino logs also flow into the package log pipeline.
2. Patch an existing pino logger so calls are mirrored into the package logger.

Example:

```js
const pino = require('pino');
const { adapters } = require('@my-org/observability-node-ts');

const stream = adapters.pino.createPinoStreamAdapter({
  component: 'api'
});

const logger = pino({ level: 'info' }, stream);

adapters.pino.instrumentPinoLogger(logger, {
  source: 'existing-pino'
});
```

## Winston Integration

Add a transport that forwards winston records into the package logger.

```js
const winston = require('winston');
const { adapters } = require('@my-org/observability-node-ts');

const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    adapters.winston.createWinstonTransport({
      component: 'api'
    })
  ]
});
```

You can also call `adapters.winston.instrumentWinstonLogger(logger, bindings)` to attach the transport to an existing logger instance.

## Console Capture Behavior

If `OBSERVABILITY_ENABLE_CONSOLE_CAPTURE=true`, the package patches:

- `console.log`
- `console.info`
- `console.warn`
- `console.error`
- `console.debug`

Captured console logs are emitted as structured package logs and include trace and span IDs when an active OpenTelemetry context exists.

Console mirroring is controlled by `OBSERVABILITY_ENABLE_CONSOLE_MIRROR`. By default this is useful in development so developers still see local logs in the terminal.

## Supported Environment Variables

The package supports both env-based and code-based configuration. Init options win over env values.

| Variable | Purpose |
| --- | --- |
| `OTEL_SERVICE_NAME` | Value for `service.name` |
| `SERVICE_VERSION` | Value for `service.version` |
| `NODE_ENV` | Used as deployment environment |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` or `http/protobuf` |
| `OTEL_EXPORTER_OTLP_HEADERS` | OTLP headers like `authorization=Bearer ...` |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes as comma-separated `key=value` |
| `OBSERVABILITY_LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `fatal` |
| `OBSERVABILITY_ENABLE_CONSOLE_CAPTURE` | Enable console patching |
| `OBSERVABILITY_ENABLE_CONSOLE_MIRROR` | Mirror captured console output locally |
| `OBSERVABILITY_CONSOLE_MIRROR_IN_DEVELOPMENT_ONLY` | Keep console mirroring only outside production by default |
| `OBSERVABILITY_REDACT_KEYS` | Comma-separated sensitive field keys |
| `OBSERVABILITY_DISABLE_AUTO_INSTRUMENTATIONS` | Comma-separated list like `dns,express,http` |
| `OBSERVABILITY_METRICS_INTERVAL` | OTLP metrics export interval in ms |
| `OBSERVABILITY_CAPTURE_UNCAUGHT` | Capture `uncaughtException` |
| `OBSERVABILITY_CAPTURE_UNHANDLED_REJECTION` | Capture `unhandledRejection` |
| `OBSERVABILITY_EMIT_ONLY_WARN_ERROR_FATAL` | Drop `debug/info` logs from package output |
| `OBSERVABILITY_SMART_SEVERITY_DETECTION` | Enable severity inference from messages and error-like fields |
| `OBSERVABILITY_LOG_DEDUPE_ENABLED` | Enable safe log dedupe summaries |
| `OBSERVABILITY_LOG_DEDUPE_WINDOW_MS` | Dedupe window in milliseconds |
| `OBSERVABILITY_LOG_DEDUPE_LEVELS` | Comma-separated levels to dedupe, default `warn,error,fatal` |
| `OBSERVABILITY_LOG_EXPORT_MAX_QUEUE_SIZE` | Max buffered OTLP log records before export |
| `OBSERVABILITY_LOG_EXPORT_MAX_BATCH_SIZE` | Max OTLP log records per export batch |
| `OBSERVABILITY_LOG_EXPORT_SCHEDULE_DELAY_MS` | Log export flush cadence in milliseconds |
| `OBSERVABILITY_LOG_EXPORT_TIMEOUT_MS` | OTLP log export timeout in milliseconds |
| `OBSERVABILITY_LOGGER_NAME` | Internal OTEL logger name used for log export |
| `OBSERVABILITY_DEBUG` | Enable OTel diagnostic logging |
| `OBSERVABILITY_FAIL_FAST` | Throw startup errors instead of degraded startup |
| `OBSERVABILITY_SHUTDOWN_TIMEOUT_MS` | Force-exit timeout for fatal process handlers |

## Log Dedupe

The package now supports safe log dedupe for repeated noisy logs.

Default behavior:

- first log event is emitted immediately
- repeated matching logs inside a short window are suppressed
- a summary log is emitted later with:
  - a human-readable summary message in the log body
  - `dedupe_repeat_count`
  - `dedupe_total_count`
  - `dedupe_original_message`
  - `dedupe_first_seen`
  - `dedupe_last_seen`
  - `dedupe_window_ms`

Default dedupe key includes:

- `service.name`
- `logger_type`
- `level`
- `message`
- `error.name`
- `error.message`
- `error.code`
- `http.method`
- `http.route`
- `http.status_code`

By default, only `warn`, `error`, and `fatal` logs are deduped. Traces are not deduped.

## Repo Validation

Inside this repository you can run:

```bash
npm run test:unit
npm run test:smoke:gateway-grpc
```

The smoke test verifies the backend package -> gateway gRPC path in both default and low-noise gateway modes.

## Public API

### `await initObservability(options)`

Starts tracing, metrics, OTLP log export, logger wiring, optional console capture, and process error handlers.

### `await shutdownObservability()`

Flushes and shuts down OpenTelemetry SDK components and restores patched handlers.

### `getLogger()`

Returns the package root logger.

### `createChildLogger(bindings)`

Returns a child logger with extra contextual fields.

### `startSpan(name, options, fn?)`

Starts a manual span.

- If `fn` is omitted, returns a span.
- If `fn` is provided, runs it in an active span context.
- Exceptions are recorded on the span and status is set to error automatically.

### `recordException(error, options)`

Records an exception on the current active span or an explicitly provided span.

### `incrementCounter(name, value, attributes)`

Records a custom counter increment.

### `recordHistogram(name, value, attributes)`

Records a custom histogram value.

### `setGauge(name, value, attributes)`

Stores the latest value for a custom observable gauge.

### `express`

Contains:

- `requestContextMiddleware`
- `requestLoggingMiddleware`
- `errorMiddleware`

### `adapters`

Contains:

- `adapters.pino.createPinoStreamAdapter(bindings)`
- `adapters.pino.instrumentPinoLogger(logger, bindings)`
- `adapters.winston.createWinstonTransport(bindings)`
- `adapters.winston.instrumentWinstonLogger(logger, bindings)`

## How Traces Work

The package uses OpenTelemetry Node auto-instrumentation plus manual helpers.

Default trace coverage aims to include:

- inbound HTTP requests
- outbound HTTP requests
- Express routes
- DNS spans
- common Node backend libraries covered by OpenTelemetry auto-instrumentation

Manual tracing is available for business logic, nested work, repository calls, and custom operation boundaries using `startSpan`.

Resource attributes include:

- `service.name`
- `service.version`
- `deployment.environment.name`
- any values passed via `OTEL_RESOURCE_ATTRIBUTES` or `extraResourceAttributes`

## How Metrics Work

The package exports metrics using OTLP and provides:

- request count
- request error count
- request duration histogram
- standard HTTP server request metrics for backend dashboards
- runtime memory gauges
- heap used gauge
- process uptime gauge
- event loop lag gauge

It also provides custom metrics helpers for:

- counters
- histograms
- gauges

Route-level metrics are recorded by the Express request logging middleware using the resolved route path where practical.

In the current package version, useful default HTTP metric names include:

- `http.server.request.duration`
- `http.server.request.count`
- `http.server.request.errors`
- `app_http_server_request_count`
- `app_http_server_request_error_count`
- `app_http_server_request_duration_ms`

## How Logs Work

The package logger writes structured JSON lines and also attempts to export logs with OTLP. Log records include:

- timestamp
- level
- message
- service metadata
- trace ID
- span ID
- custom fields

Supported levels:

- `debug`
- `info`
- `warn`
- `error`
- `fatal`

The logger supports:

- child loggers
- redaction of sensitive keys
- optional console mirroring

## Trace-Log Correlation

Whenever a log is written while an OpenTelemetry span context is active, the log includes:

- `trace_id`
- `span_id`

That makes it easier to pivot from a trace to the logs emitted during that request or operation.

## Error Handling Behavior

The package supports:

- Express error middleware
- `uncaughtException` capture
- `unhandledRejection` capture
- exception recording on the active span
- marking span status as error
- structured error logging with stack traces
- shutdown flushing on fatal paths when possible

Fatal process handling tries to flush telemetry, but in a true crash scenario no JavaScript package can guarantee perfect delivery.

## Known Limitations

This package is built for broad practical coverage, not unrealistic guarantees.

- It cannot guarantee zero-loss interception for every unknown custom logger or wrapper.
- If a service initializes instrumented libraries before observability startup, some early auto-instrumentation can be missed.
- Patching `console` only captures calls that still go through the global console methods.
- Existing pino and winston integrations are practical adapters, not deep framework-specific magic.
- OTLP log support in the Node ecosystem is improving, but backend support varies by collector and vendor pipeline.
- Fatal process exits can reduce flush success even though the package tries to shut down cleanly.

## Switching Later To A Central OTel Collector Or Gateway

The design goal is that service code stays almost the same.

### Direct To SigNoz Today

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://signoz-or-local-ingest:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

Flow:

```text
service -> observability package -> OTLP endpoint -> SigNoz
```

### Central Collector Later

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://central-otel-gateway.internal:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

Flow:

```text
service -> observability package -> central OTel collector/gateway -> SigNoz
```

Today you might use:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://vendor-or-local-collector:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

Later you can move to:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://central-otel-gateway.internal:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

In the normal case, that endpoint and protocol change is enough. Service code should not need major changes.

In other words, the normal migration is:

- keep `initObservability()` usage the same
- change `OTEL_EXPORTER_OTLP_ENDPOINT`
- optionally change `OTEL_EXPORTER_OTLP_PROTOCOL`
- optionally update auth headers if your gateway requires them

## Local Testing Instructions

1. Install dependencies:

```bash
npm install
```

2. Set an OTLP endpoint. For local testing, a local collector is recommended:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

3. Run an example:

```bash
npm run example:basic
npm run example:pino
npm run example:winston
```

4. Exercise the routes:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/success
curl http://localhost:3001/error
curl http://localhost:3001/slow
curl http://localhost:3001/nested
```

The pino and winston examples run on ports `3002` and `3003`.

## Production Recommendations

- Initialize observability before requiring most application libraries.
- Prefer an OpenTelemetry Collector between services and vendors when you are ready.
- Keep redaction rules up to date for your data model.
- Start with sensible instrumentations and disable noisy ones with `OBSERVABILITY_DISABLE_AUTO_INSTRUMENTATIONS` if needed.
- Keep console capture optional in production if your services already use structured loggers consistently.
- Test shutdown behavior in real deployment conditions.

## Publish Checklist

Before publishing this package to an internal or public registry, verify:

- package name and scope are correct in [package.json](/Users/cladbe/Desktop/loggingPackage/package.json)
- version is updated
- `README.md` matches the actual exported API
- default OTLP endpoint and env examples match your platform defaults
- example apps still start and send telemetry
- sensitive field redaction keys match your organization needs
- collector endpoint, auth, and protocol choices are documented for service teams
- package is tested with the logging styles you care about most
- you are comfortable with the current known limitations section

Useful publish steps:

```bash
npm install
npm pack
```

If you publish to a private registry, also verify your `.npmrc`, registry URL, and scope mapping before release.

## Noise And Performance Tradeoffs

Observability always has overhead. This package aims for safe defaults, but you should still tune it for your workload.

- Auto-instrumentation increases coverage but can add noise.
- Request logging adds useful context but may be too verbose for very high-volume paths.
- Console capture is convenient but can duplicate logs if a service already mirrors through another logger.
- Metrics export interval changes freshness versus export overhead.

## Repository Layout

```text
package.json
index.js
src/
  bootstrap/
  config/
  tracing/
  metrics/
  logging/
    core/
    adapters/
      console/
      pino/
      winston/
  express/
  errors/
  runtime/
  utils/
.env.example
README.md
examples/
  basic-express-app/
  pino-express-app/
  winston-express-app/
```
