#!/usr/bin/env sh
set -eu

NAMESPACE="${1:-observability}"
MODE="${2:-}"
WORKLOAD="${3:-statefulset/otel-gateway}"

if [ -z "$MODE" ]; then
  echo "usage: $0 <namespace> <default|low-noise> [statefulset/otel-gateway]" >&2
  exit 1
fi

case "$MODE" in
  default)
    CONFIG_FILE="otel-collector-gateway.yaml"
    ;;
  low-noise)
    CONFIG_FILE="otel-collector-gateway-low-noise.yaml"
    ;;
  *)
    echo "invalid mode: $MODE" >&2
    echo "expected: default or low-noise" >&2
    exit 1
    ;;
esac

kubectl -n "$NAMESPACE" set env "$WORKLOAD" GATEWAY_COLLECTOR_CONFIG="$CONFIG_FILE"
kubectl -n "$NAMESPACE" rollout status "$WORKLOAD"

echo "gateway mode switched to $MODE using $CONFIG_FILE"
