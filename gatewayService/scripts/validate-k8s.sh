#!/usr/bin/env sh
set -eu

PROFILE="${1:-prod}"
kubectl kustomize "gatewayService/k8s/${PROFILE}" >/dev/null
echo "kustomize render passed for ${PROFILE}"

