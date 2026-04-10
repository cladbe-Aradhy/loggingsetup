**Direct Logger Service**
This service does not use the shared observability package.

Instead it has its own local `logger.ts` that:
- accepts `logger.info/warn/error(...)`
- builds OTLP logs JSON
- sends logs directly to SigNoz over HTTP

**Run**
```bash
cd /Users/cladbe/Desktop/loggingPackage/direct-signoz-logger-service
npm install
npm run build
npm start
```

**Default target**
```text
http://127.0.0.1:4318/v1/logs
```

**Routes**
- `GET /health`
- `GET /logs/info`
- `GET /logs/error`
- `POST /orders`

**Quick test**
```bash
curl http://127.0.0.1:3095/logs/info
curl http://127.0.0.1:3095/logs/error
curl -X POST http://127.0.0.1:3095/orders -H 'content-type: application/json' -d '{"item":"Keyboard","amount":7999}'
```
