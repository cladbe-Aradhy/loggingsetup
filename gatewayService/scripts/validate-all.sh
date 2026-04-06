#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT_DIR"

echo "validating docker compose rendering with local gateway profile"
GATEWAY_ENV_FILE=.env.local.example docker compose -f gatewayService/docker-compose.yml config >/dev/null

for profile in \
  gatewayService/k8s/prod \
  gatewayService/k8s/overlays/prod-monitoring \
  gatewayService/k8s/overlays/prod-loadbalancer-monitoring \
  gatewayService/k8s/overlays/prod-low-noise \
  gatewayService/k8s/overlays/prod-low-noise-monitoring \
  gatewayService/k8s/overlays/prod-low-noise-loadbalancer-monitoring
do
  echo "validating ${profile}"
  kubectl kustomize "$profile" >/dev/null
done

echo "all gateway validation checks passed"
