#!/usr/bin/env sh
set -eu

REGISTRY="${REGISTRY:-registry.cn-hangzhou.aliyuncs.com}"
NAMESPACE="${NAMESPACE:-your-namespace}"
REPO="${REPO:-kml-viewer}"
TAG="${TAG:-v1.0.12}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "${ROOT}/config.js" ]; then
  cp "${ROOT}/config.example.js" "${ROOT}/config.js"
  echo "[warn] config.js created from config.example.js; fill the Tianditu tk to enable labels"
fi

IMAGE="${REGISTRY}/${NAMESPACE}/${REPO}:${TAG}"

echo "[build] ${IMAGE}"
docker build -f "${ROOT}/deploy/Dockerfile" -t "${IMAGE}" "${ROOT}"
docker tag "${IMAGE}" "${REGISTRY}/${NAMESPACE}/${REPO}:latest"
echo "[ok] built: ${IMAGE} (also tagged latest)"