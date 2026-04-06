Current chunk

- Hono + TypeScript custom gateway
- accepts OTLP HTTP style requests on:
  - `POST /v1/logs`
  - `POST /v1/traces`
  - `POST /v1/metrics`
- stores each incoming payload in memory
- forwards the same raw HTTP body to SigNoz OTLP HTTP using `axios`
- no gRPC
- no database

Environment

- `PORT`
  - custom gateway listen port
  - default: `4322`
- `SIGNOZ_OTLP_HTTP_BASE_URL`
  - SigNoz OTLP HTTP base URL
  - default: `http://127.0.0.1:4318`
- `ENABLE_SIGNOZ_FORWARD`
  - set `false` to store locally only
- `SIGNOZ_FORWARD_TIMEOUT_MS`
  - upstream forward timeout
  - default: `10000`

How to run

```bash
cd customGateway
npm install
npm run build
npm start
```

Example run with explicit env:

```bash
PORT=4322 \
SIGNOZ_OTLP_HTTP_BASE_URL=http://127.0.0.1:4318 \
npm start
```

Server starts on:

```text
http://127.0.0.1:4322
```

Endpoints

- `GET /`
- `GET /health`
- `POST /v1/logs`
- `POST /v1/traces`
- `POST /v1/metrics`
- `GET /debug/store`
- `DELETE /debug/store`

Simple test

1. Send a logs payload:

```bash
curl -X POST http://127.0.0.1:4322/v1/logs \
  -H 'content-type: application/json' \
  -d '{"hello":"world"}'
```

2. See what got stored:

```bash
curl http://127.0.0.1:4322/debug/store
```

3. Clear memory store:

```bash
curl -X DELETE http://127.0.0.1:4322/debug/store
```

What is stored

Text/JSON requests are stored like:

```json
{
  "id": 1,
  "type": "logs",
  "receivedAt": "2026-04-04T08:00:00.000Z",
  "contentType": "application/json",
  "sizeBytes": 17,
  "bodyText": "{\"hello\":\"world\"}",
  "bodyBase64": null,
  "bodyJson": {
    "hello": "world"
  }
}
```

Binary OTLP/protobuf requests are stored with:

- `bodyText = null`
- `bodyBase64 = "<base64 string>"`

Fast mental model

```text
client sends OTLP HTTP payload
-> custom gateway stores it in memory
-> custom gateway forwards same raw body to SigNoz OTLP HTTP
```
