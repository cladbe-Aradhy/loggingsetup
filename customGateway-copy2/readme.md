Current chunk

- Hono + TypeScript custom gateway
- accepts OTLP logs over:
  - HTTP `POST /v1/logs`
  - gRPC `LogsService/Export`
- keeps logs in memory only
- uses 3 in-memory queues:
  - `freshQueue`
  - `retryQueue`
  - `deadQueue`
- receives logs over HTTP or gRPC
- forwards logs to SigNoz over gRPC only
- graceful shutdown drains fresh + retry queues before exit

Queue model

- `freshQueue`
  - new accepted payloads
- `retryQueue`
  - retryable failures
  - timeout, network error, rate limited, upstream unavailable
- `deadQueue`
  - definitely invalid payloads only
  - bad request, invalid payload, invalid schema, unsupported media type

Environment

- `PORT`
  - custom gateway HTTP listen port
  - default: `4322`
- `GRPC_PORT`
  - custom gateway gRPC listen port
  - default: `14317`
- `SIGNOZ_OTLP_GRPC_TARGET`
  - SigNoz OTLP gRPC target
  - default: `http://127.0.0.1:4317`
- `ENABLE_SIGNOZ_FORWARD`
  - set `false` to keep payloads only in memory
- `SIGNOZ_FORWARD_TIMEOUT_MS`
  - upstream forward timeout
  - default: `10000`
- `QUEUE_RETRY_INTERVAL_MS`
  - retry queue scan interval
  - default: `2000`
- `RETRY_BASE_DELAY_MS`
  - exponential retry base delay
  - default: `2000`
- `RETRY_MAX_DELAY_MS`
  - retry delay cap
  - default: `30000`
- `MAX_LIVE_QUEUE_SIZE`
  - fresh + retry queue safety cap
  - default: `5000`
- `MAX_DEAD_QUEUE_SIZE`
  - dead queue safety cap
  - default: `1000`
- `SHUTDOWN_DRAIN_TIMEOUT_MS`
  - graceful shutdown drain timeout
  - default: `60000`

How to run

```bash
cd customGateway
npm install
npm run build
npm start
```

Example run with explicit env

```bash
PORT=4322 \
GRPC_PORT=14317 \
SIGNOZ_OTLP_GRPC_TARGET=http://127.0.0.1:4317 \
QUEUE_RETRY_INTERVAL_MS=2000 \
RETRY_BASE_DELAY_MS=2000 \
RETRY_MAX_DELAY_MS=30000 \
MAX_LIVE_QUEUE_SIZE=5000 \
MAX_DEAD_QUEUE_SIZE=1000 \
SHUTDOWN_DRAIN_TIMEOUT_MS=60000 \
npm start
```

Servers start on

```text
HTTP:  http://127.0.0.1:4322
gRPC:  127.0.0.1:14317
```

Endpoints

- `GET /`
- `GET /health`
- `POST /v1/logs`
- `LogsService/Export` on gRPC port
- `GET /debug/store`
- `DELETE /debug/store`

Simple test

1. Send an OTLP JSON logs payload:

```bash
curl -X POST http://127.0.0.1:4322/v1/logs \
  -H 'content-type: application/json' \
  -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"demo-http-client"}}],"droppedAttributesCount":0},"schemaUrl":"","scopeLogs":[{"scope":{"name":"demo-scope","version":"1.0.0","attributes":[],"droppedAttributesCount":0},"schemaUrl":"","logRecords":[{"timeUnixNano":"1730000000000000000","observedTimeUnixNano":"0","severityNumber":9,"severityText":"INFO","body":{"stringValue":"hello from http"},"attributes":[],"droppedAttributesCount":0,"flags":0,"traceId":"","spanId":""}]}]}]}'
```

2. See queue state:

```bash
curl http://127.0.0.1:4322/debug/store
```

3. Clear memory store:

```bash
curl -X DELETE http://127.0.0.1:4322/debug/store
```

Mental model

```text
client sends logs to custom gateway
-> gateway saves payload in freshQueue
-> HTTP payload must be OTLP JSON so gateway can bridge it to upstream gRPC
-> immediate upstream gRPC forward attempt happens
-> success => payload removed from memory
-> retryable failure => move to retryQueue with nextRetryAt
-> invalid failure => move to deadQueue
-> retry timer keeps retrying retryQueue
```
