#!/usr/bin/env sh

set -eu

NAMESPACE="${1:-observability}"
EXPORT_ENDPOINT="${GATEWAY_EXPORT_OTLP_GRPC_ENDPOINT:-signoz-otel-collector.observability.svc.cluster.local:4317}"
EXPORT_INSECURE="${GATEWAY_EXPORT_OTLP_INSECURE:-false}"
EXPORT_INSECURE_SKIP_VERIFY="${GATEWAY_EXPORT_OTLP_INSECURE_SKIP_VERIFY:-false}"
BACKEND_TOKEN="${BACKEND_OTLP_TOKEN:-}"
FRONTEND_TOKEN="${FRONTEND_OTLP_TOKEN:-}"

if [ -z "${BACKEND_TOKEN}" ] || [ -z "${FRONTEND_TOKEN}" ]; then
  echo "Set BACKEND_OTLP_TOKEN and FRONTEND_OTLP_TOKEN before running this script." >&2
  exit 1
fi

kubectl create secret generic otel-gateway-exporter \
  --namespace "${NAMESPACE}" \
  --from-literal=GATEWAY_EXPORT_OTLP_GRPC_ENDPOINT="${EXPORT_ENDPOINT}" \
  --from-literal=GATEWAY_EXPORT_OTLP_INSECURE="${EXPORT_INSECURE}" \
  --from-literal=GATEWAY_EXPORT_OTLP_INSECURE_SKIP_VERIFY="${EXPORT_INSECURE_SKIP_VERIFY}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic otel-gateway-backend-ingest-auth \
  --namespace "${NAMESPACE}" \
  --from-literal=token="${BACKEND_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic otel-gateway-frontend-ingest-auth \
  --namespace "${NAMESPACE}" \
  --from-literal=token="${FRONTEND_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Gateway secrets applied in namespace ${NAMESPACE}."
