// Port where the custom Hono gateway will listen for HTTP OTLP traffic.
export const PORT = Number(process.env.PORT || 4322);

// Port where the custom gateway will listen for OTLP gRPC logs.
export const GRPC_PORT = Number(process.env.GRPC_PORT || 14317);

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

// How often the fresh queue is scanned for another forwarding try.
export const QUEUE_RETRY_INTERVAL_MS = Number(
  process.env.QUEUE_RETRY_INTERVAL_MS || 2000
);

// In-memory safety limit for the fresh queue.
export const MAX_LIVE_QUEUE_SIZE = Number(process.env.MAX_LIVE_QUEUE_SIZE || 5000);

// Dead queue is only for inspection, so we keep it bounded.
export const MAX_DEAD_QUEUE_SIZE = Number(process.env.MAX_DEAD_QUEUE_SIZE || 1000);

// How long shutdown should wait while draining memory queues.
export const SHUTDOWN_DRAIN_TIMEOUT_MS = Number(
  process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || 60000
);
