"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUEUE_PROCESSING_CONCURRENCY = exports.SHUTDOWN_DRAIN_TIMEOUT_MS = exports.MAX_DEAD_QUEUE_SIZE = exports.MAX_LIVE_QUEUE_SIZE = exports.RETRY_MAX_DELAY_MS = exports.RETRY_BASE_DELAY_MS = exports.QUEUE_RETRY_INTERVAL_MS = exports.SIGNOZ_FORWARD_TIMEOUT_MS = exports.ENABLE_SIGNOZ_FORWARD = exports.SIGNOZ_OTLP_GRPC_TARGET = exports.GRPC_PORT = exports.PORT = void 0;
// Port where the custom Hono gateway will listen for HTTP OTLP traffic.
exports.PORT = Number(process.env.PORT || 4322);
// Port where the custom gateway will listen for OTLP gRPC logs.
exports.GRPC_PORT = Number(process.env.GRPC_PORT || 14317);
// Upstream SigNoz OTLP gRPC target.
// Example: http://127.0.0.1:4317
exports.SIGNOZ_OTLP_GRPC_TARGET = process.env.SIGNOZ_OTLP_GRPC_TARGET || 'http://127.0.0.1:4317';
// This flag lets us turn forwarding off while still keeping local in-memory storage.
exports.ENABLE_SIGNOZ_FORWARD = process.env.ENABLE_SIGNOZ_FORWARD !== 'false';
// Small timeout so the gateway does not hang forever while forwarding upstream.
exports.SIGNOZ_FORWARD_TIMEOUT_MS = Number(process.env.SIGNOZ_FORWARD_TIMEOUT_MS || 10000);
// How often the retry queue is scanned for due payloads.
exports.QUEUE_RETRY_INTERVAL_MS = Number(process.env.QUEUE_RETRY_INTERVAL_MS || 2000);
// Base retry delay for retryable failures.
exports.RETRY_BASE_DELAY_MS = Number(process.env.RETRY_BASE_DELAY_MS || 2000);
// Retry delay is capped so retries stay bounded.
exports.RETRY_MAX_DELAY_MS = Number(process.env.RETRY_MAX_DELAY_MS || 30000);
// In-memory safety limit for fresh + retry payloads.
exports.MAX_LIVE_QUEUE_SIZE = Number(process.env.MAX_LIVE_QUEUE_SIZE || 5000);
// Dead queue is only for inspection, so we keep it bounded.
exports.MAX_DEAD_QUEUE_SIZE = Number(process.env.MAX_DEAD_QUEUE_SIZE || 1000);
// How long shutdown should wait while draining memory queues.
exports.SHUTDOWN_DRAIN_TIMEOUT_MS = Number(process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || 60000);
// How many payloads can be processed in parallel during queue scans.
exports.QUEUE_PROCESSING_CONCURRENCY = Number(process.env.QUEUE_PROCESSING_CONCURRENCY || 5);
