# gatewayService

This folder contains a production-minded OpenTelemetry Collector gateway setup that matches the current `@my-org/observability-node` package design.

## What This Gateway Does

This gateway is the central control layer between your services and SigNoz.

Flow:

```text
frontend packages or frontend-ingest services -> OTLP HTTP  -> gateway frontend pipeline
backend packages                              -> OTLP gRPC  -> gateway backend pipeline
gateway                                       -> OTLP gRPC  -> SigNoz
```

Responsibilities:

- receive OTLP over HTTP and gRPC
- require authenticated OTLP ingest in Kubernetes production
- keep frontend and backend ingestion logically separated inside one gateway
- normalize resource and signal attributes
- clean sensitive keys
- reduce metric-cardinality risk
- classify health routes
- capture all signals by default
- batch outgoing exports
- retry downstream export failures
- queue outgoing telemetry

This folder now contains two deployment layers:

- local Docker Compose for development and end-to-end testing
- Kubernetes manifests for high-availability production deployment

For local verification, the Docker-mode collector configs also export to the built-in `debug` exporter so you can confirm what default vs low-noise mode is actually forwarding by reading container logs.

## Files

- `.env.example`
  Gateway runtime environment variables
- `docker-compose.yml`
  Local containerized gateway runner
- `otel-collector-config.yaml`
  Collector receivers, processors, exporters, and pipelines
- `k8s/base`
  Production Kubernetes gateway base manifests
- `k8s/prod`
  Production overlay with higher replica and resource settings
- `k8s/overlays/monitoring`
  Optional ServiceMonitor overlay for Prometheus Operator environments
- `k8s/overlays/loadbalancer`
  Optional LoadBalancer exposure overlay for prod
- `k8s/overlays/low-noise`
  Base low-noise Kubernetes overlay
- `k8s/overlays/prod-monitoring`
  Prod plus ServiceMonitor
- `k8s/overlays/prod-loadbalancer-monitoring`
  Prod plus LoadBalancer plus ServiceMonitor
- `k8s/overlays/prod-low-noise`
  Prod low-noise deployment
- `k8s/overlays/prod-low-noise-monitoring`
  Prod low-noise plus ServiceMonitor
- `k8s/overlays/prod-low-noise-loadbalancer-monitoring`
  Prod low-noise plus LoadBalancer plus ServiceMonitor
- `scripts/render-k8s.sh`
  Renders the Kubernetes manifests with `kubectl kustomize`
- `scripts/create-prod-secrets.sh`
  Creates the required Kubernetes secrets for exporter settings and ingest auth

## Important Design Choices

### Ingress

Both protocols are enabled:

- OTLP HTTP inside container on `4318`
- OTLP gRPC inside container on `4317`

This lets:

- frontend/browser-friendly emitters send HTTP
- backend services send gRPC
- both flows land on the same protected internal gateway
- each flow gets its own receiver and pipeline policy

In production Kubernetes, the gateway service exposes both:

- `otel-gateway.observability.svc.cluster.local:4318` for OTLP HTTP
- `otel-gateway.observability.svc.cluster.local:4317` for OTLP gRPC

There is also a frontend-dedicated service:

- `otel-gateway-frontend.observability.svc.cluster.local:4318` for browser/frontend HTTP OTLP traffic

Admin-only ports stay on a separate internal service:

- `otel-gateway-admin.observability.svc.cluster.local:13133` for health
- `otel-gateway-admin.observability.svc.cluster.local:8888` for metrics

Collector internal metrics are explicitly exposed on `0.0.0.0:8888` so Prometheus scraping works through the admin service.

When running locally, the Docker host ports are intentionally different by default so the gateway can sit in front of an existing local SigNoz setup:

- host `14318` -> gateway container `4318`
- host `14317` -> gateway container `4317`
- host `18888` -> gateway container `8888` for internal collector metrics

Production Kubernetes ingress is hardened with:

- separate bearer-token OTLP ingest auth for frontend and backend paths
- frontend OTLP CORS allowlist with multiple origins
- namespace-based network policy for OTLP clients
- bounded HTTP body size and timeouts
- bounded gRPC message size and concurrent streams
- keepalive enforcement to make slow-connection abuse harder

### Normalize Layer

The normalize path in this gateway does the following:

1. Resource detection:
   Adds environment and system context when possible.

2. Resource normalization:
   Normalizes environment attributes into `deployment.environment.name`.

3. Common attribute cleanup:
   Deletes common sensitive keys like `authorization`, `cookie`, `password`, and `token`.

4. Metrics cardinality cleanup:
   Removes dangerous metric labels like `request_id`, `user.id`, and `session.id`.

5. Signal transforms:
   Converts `prod` to `production`, `stage` to `staging`, and tags `/health` traffic with `app.route.class=health`.

6. Optional trace noise control:
   If you switch to the low-noise config, the gateway tail-samples traces and keeps only traces that match meaningful conditions:
   - `warn`, `error`, or `fatal` log severity on the active span
   - `4xx` HTTP request status
   - `5xx` HTTP request status
   - OpenTelemetry span status `ERROR`

### Export

The gateway exports downstream using OTLP gRPC, with:

- sending queue enabled
- persistent file-backed queue enabled
- retry enabled
- batching enabled
- tunable queue consumers and queue size

This is a better place for retry and batching than individual services because it centralizes control and reduces downstream load.

### Trace Retention Strategy

By default, the main collector config captures all traces.

If you want the earlier low-noise mode, switch:

```env
GATEWAY_COLLECTOR_CONFIG=otel-collector-config.low-noise.yaml
```

That low-noise mode keeps traces only when the request looks important from an operational point of view:

- warn-level request outcome
- error-level request outcome
- fatal/error-level logs recorded inside the active request span
- HTTP `4xx`
- HTTP `5xx`
- spans marked with OTel status `ERROR`

For logs, low-noise mode keeps only:

- `warn`
- `error`
- `fatal`

This works with the package's smart severity classification, so error-like `console.log(...)` misuse that gets promoted to `error` is still kept in low-noise mode.

### Kubernetes Mode Switching

For Kubernetes, the gateway now mounts both collector configs and chooses one through a single variable:

```env
GATEWAY_COLLECTOR_CONFIG=otel-collector-gateway.yaml
```

or:

```env
GATEWAY_COLLECTOR_CONFIG=otel-collector-gateway-low-noise.yaml
```

That means you no longer need separate deployment paths just to switch modes.

Default mode in a live cluster:

```bash
kubectl -n observability set env statefulset/otel-gateway GATEWAY_COLLECTOR_CONFIG=otel-collector-gateway.yaml
```

Low-noise mode in a live cluster:

```bash
kubectl -n observability set env statefulset/otel-gateway GATEWAY_COLLECTOR_CONFIG=otel-collector-gateway-low-noise.yaml
```

Or use the helper script:

```bash
sh gatewayService/scripts/set-k8s-mode.sh observability default
sh gatewayService/scripts/set-k8s-mode.sh observability low-noise
```

## Recommended Service Settings

### Frontend-style packages

Use:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-gateway-frontend.observability.svc.cluster.local:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer CHANGE_ME_FRONTEND_OTLP_TOKEN
```

Browser readiness notes:

- frontend HTTP OTLP now has explicit CORS support
- set `GATEWAY_FRONTEND_CORS_ALLOWED_ORIGIN` and additional `..._2`, `..._3`, `..._4` values to your real frontend origins before production rollout
- direct browser-to-collector OTLP is feasible with this setup, but a protected frontend-ingest edge is still the safer internet-facing architecture

### Backend packages

Use:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-gateway.observability.svc.cluster.local:4317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer CHANGE_ME_BACKEND_OTLP_TOKEN
```

Important:

- the Kubernetes gateway requires separate frontend and backend OTLP bearer tokens by default
- rotate both generated tokens before production rollout
- local Docker Compose is intentionally simpler and should not be internet-exposed
- direct public browser-to-collector OTLP is still not the best DDoS posture; prefer a protected frontend-ingest edge if traffic is internet-facing

## Production Kubernetes Deployment

The production deployment is in:

- [k8s/base](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/base)
- [k8s/prod](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/prod)
- [k8s/overlays/monitoring](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/overlays/monitoring)
- [k8s/overlays/loadbalancer](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/overlays/loadbalancer)
- [k8s/overlays/low-noise](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/overlays/low-noise)
- [k8s/overlays/prod-monitoring](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/overlays/prod-monitoring)
- [k8s/overlays/prod-loadbalancer-monitoring](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/overlays/prod-loadbalancer-monitoring)
- [k8s/overlays/prod-low-noise](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/overlays/prod-low-noise)
- [k8s/overlays/prod-low-noise-monitoring](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/overlays/prod-low-noise-monitoring)
- [k8s/overlays/prod-low-noise-loadbalancer-monitoring](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/overlays/prod-low-noise-loadbalancer-monitoring)

What the production setup includes:

- `StatefulSet` for stable pod identity and persistent queue volumes
- `5` replicas in the prod overlay
- `HorizontalPodAutoscaler` with `5 -> 20` range
- `PodDisruptionBudget` with `minAvailable: 2`
- headless service for stable network identity
- client-facing ClusterIP service
- separate frontend HTTP ClusterIP service
- separate admin ClusterIP service for health and metrics
- `k8sattributes` enrichment
- non-root runtime with `fsGroup`
- topology spread constraints across nodes and zones
- required pod anti-affinity
- persistent `file_storage` queue for traces, logs, and metrics
- readiness, liveness, and startup probes
- RBAC needed for Kubernetes metadata enrichment
- network policy to limit ingress to labeled client namespaces
- admin ingress allowed only from observability or metrics-scraper labeled namespaces
- bounded receiver request sizes, gRPC stream concurrency, and timeouts
- separate frontend and backend ingest auth
- secret-backed downstream exporter settings
- runtime-default seccomp profile
- optional monitoring overlay
- optional LoadBalancer exposure overlay

Render manifests:

```bash
kubectl kustomize gatewayService/k8s/prod
```

Apply manifests:

```bash
kubectl apply -k gatewayService/k8s/prod
```

Recommended deployment choices:

- in-cluster only clients:
  `kubectl apply -k gatewayService/k8s/prod`
- in-cluster clients plus Prometheus Operator:
  `kubectl apply -k gatewayService/k8s/overlays/prod-monitoring`
- clients outside the cluster or across VPC boundaries:
  `kubectl apply -k gatewayService/k8s/overlays/loadbalancer`
- prod with monitoring and LoadBalancer:
  `kubectl apply -k gatewayService/k8s/overlays/prod-loadbalancer-monitoring`

Preferred production flow:

1. deploy the normal prod path once
2. keep the same gateway service and workload names
3. switch `GATEWAY_COLLECTOR_CONFIG` when you want `default` or `low-noise`

For example:

```bash
kubectl apply -k gatewayService/k8s/overlays/prod-monitoring
sh gatewayService/scripts/set-k8s-mode.sh observability low-noise
```

The older dedicated low-noise overlays still render and still work, but they are no longer the simplest way to switch modes:

- `gatewayService/k8s/overlays/prod-low-noise`
- `gatewayService/k8s/overlays/prod-low-noise-monitoring`
- `gatewayService/k8s/overlays/prod-low-noise-loadbalancer-monitoring`

LoadBalancer note:

- prefer an internal load balancer if your emitters are inside private networks
- if you must expose a public load balancer, add cloud DDoS protection, source-range allowlists, and upstream rate-limiting at the edge
- the provided LoadBalancer overlay now targets the frontend HTTP service, not the backend gRPC service
- it already restricts source ranges to common RFC1918 private ranges; adjust them to match your network

Important namespace label requirement:

- client namespaces that should send OTLP traffic must be labeled:

```bash
kubectl label namespace your-app-namespace observability.my-org/otlp-client=true
```

If Prometheus runs outside the `observability` namespace, label its namespace too:

```bash
kubectl label namespace your-monitoring-namespace observability.my-org/metrics-scraper=true
```

Important OTLP client auth requirement:

- create the Kubernetes secrets before applying the workload manifests
- `otel-gateway-backend-ingest-auth` contains the backend OTLP ingest token
- `otel-gateway-frontend-ingest-auth` contains the frontend OTLP ingest token
- `otel-gateway-exporter` contains the downstream SigNoz exporter settings
- backend services should send:

```env
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer CHANGE_ME_BACKEND_OTLP_TOKEN
```

- frontend OTLP clients or frontend-ingest services should send:

```env
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer CHANGE_ME_FRONTEND_OTLP_TOKEN
```

- create the required secrets:

```bash
BACKEND_OTLP_TOKEN='replace-with-a-long-random-secret-for-backend' \
FRONTEND_OTLP_TOKEN='replace-with-a-long-random-secret-for-frontend' \
GATEWAY_EXPORT_OTLP_GRPC_ENDPOINT='signoz-otel-collector.observability.svc.cluster.local:4317' \
sh ./gatewayService/scripts/create-prod-secrets.sh observability
```

This gateway is strong against accidental spikes and common abuse patterns, but it is still not a literal replacement for cloud DDoS protection, WAFs, or upstream rate-limiting at the load balancer edge.

## Best-Practical Shared-Gateway Model

This repo now uses one shared gateway with two ingestion lanes:

- backend lane: gRPC on `4317`
- frontend lane: HTTP on `4318`

This is the best practical middle ground when you want one platform but do not want frontend and backend telemetry fully mixed at ingress time.

## Production Prerequisites

Before production rollout, set these explicitly:

- real backend OTLP token
- real frontend OTLP token
- real frontend CORS origins
- downstream SigNoz OTLP endpoint secret
- a real replicated `storageClassName` in [statefulset-prod-patch.yaml](/Users/cladbe/Desktop/loggingPackage/gatewayService/k8s/prod/statefulset-prod-patch.yaml)
- load balancer source ranges or internal-LB settings that match your network

Important downstream config:

- update the generated `otel-gateway-env` ConfigMap values if your SigNoz collector service DNS name is different from:
  `signoz-otel-collector.observability.svc.cluster.local:4317`

This is the strongest deployment path in this repo. The local Docker Compose setup is only for development and validation.

## Local Run

1. Create a local env file:

```bash
cd gatewayService
cp .env.local.example .env
```

2. Point downstream export to your SigNoz OTLP gRPC endpoint in `.env`.

Local example:

```env
GATEWAY_EXPORT_OTLP_GRPC_ENDPOINT=host.docker.internal:4317
```

Production-oriented baseline values now live in:
- [gatewayService/.env](/Users/cladbe/Desktop/loggingPackage/gatewayService/.env)
- [gatewayService/.env.example](/Users/cladbe/Desktop/loggingPackage/gatewayService/.env.example)

Local Docker convenience values live in:
- [gatewayService/.env.local.example](/Users/cladbe/Desktop/loggingPackage/gatewayService/.env.local.example)

3. Start the gateway:

```bash
docker compose up -d
```

Default behavior:

- captures all logs, traces, and metrics
- still applies smart normalization and smart severity classification

Low-noise optional mode:

```env
GATEWAY_COLLECTOR_CONFIG=otel-collector-config.low-noise.yaml
```

4. Check gateway health:

```bash
curl http://127.0.0.1:13133/
```

5. For local testing from your laptop, point services to:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

or:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14317
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
```

## Deploying Multiple Gateway Instances

For high availability, run multiple identical gateway instances behind an internal load balancer.

Recommended pattern:

```text
services
  -> internal load balancer
  -> gateway-1
  -> gateway-2
  -> gateway-3
  -> SigNoz
```

Keep the gateway stateless and keep the same config on every instance.

For Kubernetes in this repo, that recommendation is implemented with:

- a `StatefulSet`
- a ClusterIP service
- pod anti-affinity
- topology spread constraints
- HPA
- PDB
- persistent exporter queues

## Notes

- This gateway intentionally does not perform aggressive dedupe yet.
- Health traffic is classified, not dropped, so you can decide later whether to keep, sample, or filter it.
- Exact log-driven trace retention is best-effort. It works when warn/error/fatal logs happen inside an active span context.
- If you later need stronger buffering, Kafka can be added between the gateway and the downstream collector path.
- No gateway setup can honestly guarantee literal zero-loss in every disaster scenario. This repo now provides a strong production baseline, but final resilience still depends on your cluster, storage class, downstream SigNoz availability, DNS, and network design.
