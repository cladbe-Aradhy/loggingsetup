// Port where the custom Hono gateway will listen for HTTP OTLP traffic.
export const PORT = Number(process.env.PORT || 4322);

// Port where the custom gateway will listen for OTLP gRPC logs.
export const GRPC_PORT = Number(process.env.GRPC_PORT || 14317);

// Base URL of the SigNoz OTLP HTTP ingest endpoint.
// Example: http://127.0.0.1:4318
export const SIGNOZ_OTLP_HTTP_BASE_URL =
  process.env.SIGNOZ_OTLP_HTTP_BASE_URL || 'http://127.0.0.1:4318';

// Upstream SigNoz OTLP gRPC target.
// Example: http://127.0.0.1:4317
export const SIGNOZ_OTLP_GRPC_TARGET =
  process.env.SIGNOZ_OTLP_GRPC_TARGET || 'http://127.0.0.1:4317';

// This flag lets us turn forwarding off while still keeping local in-memory storage.
export const ENABLE_SIGNOZ_FORWARD = process.env.ENABLE_SIGNOZ_FORWARD !== 'false';

// Small timeout so the gateway does not hang forever while forwarding upstream.
export const SIGNOZ_FORWARD_TIMEOUT_MS = Number(
  process.env.SIGNOZ_FORWARD_TIMEOUT_MS || 10000
);
