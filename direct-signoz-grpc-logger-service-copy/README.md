# direct-signoz-grpc-logger-service

Minimal TypeScript service that sends logs directly to SigNoz over OTLP gRPC using a custom gRPC client, without using the shared observability package or `@opentelemetry` packages.

## Run

```bash
cd /Users/cladbe/Desktop/loggingPackage/direct-signoz-grpc-logger-service
npm install
npm run build
npm start
```

## Environment

- `PORT` default `3097`
- `SIGNOZ_LOGS_GRPC_URL` default `http://127.0.0.1:4317`
- `SERVICE_NAME` default `direct-signoz-grpc-logger-service`

## Routes

- `GET /health`
- `GET /logs/info`
- `GET /logs/error`
- `POST /orders`
