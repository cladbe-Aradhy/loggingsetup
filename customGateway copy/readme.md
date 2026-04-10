Current model

- Hono + TypeScript custom gateway
- accepts OTLP logs over:
  - HTTP `POST /v1/logs`
  - gRPC `LogsService/Export`
- keeps logs in memory only
- receives logs over HTTP or gRPC
- forwards logs to SigNoz over gRPC only
- uses only 2 in-memory queues:
  - `freshQueue`
  - `deadQueue`
- graceful shutdown drains `freshQueue` before exit

Simple queue rule

- every new payload starts in `freshQueue`
- gateway tries to forward it immediately
- if forwarding fails, payload stays in `freshQueue`
- gateway keeps trying from `freshQueue`
- after `3` failed tries, payload moves to `deadQueue`
- no duplicate detection
- no retry queue

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
  - how often `freshQueue` is scanned again
  - default: `2000`
- `MAX_LIVE_QUEUE_SIZE`
  - fresh queue safety cap
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

Mental model

```text
client sends logs to custom gateway
-> gateway saves payload in freshQueue
-> gateway tries to forward it to SigNoz over gRPC
-> success => payload removed from memory
-> fail => payload stays in freshQueue
-> after 3 failed tries => move to deadQueue
```
