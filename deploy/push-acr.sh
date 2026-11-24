#!/usr/bin/env sh
set -eu

REGISTRY="${REGISTRY:-registry.cn-hangzhou.aliyuncs.com}"
NAMESPACE="${NAMESPACE:-your-namespace}"
REPO="${REPO:-kml-viewer}"
TAG="${TAG:-v1.0.12}"

echo "[login] ${REGISTRY} (ACR 密码为控制台设置的固定密码)"
docker login "${REGISTRY}"

echo "[push] ${REGISTRY}/${NAMESPACE}/${REPO}:${TAG}"
docker push "${REGISTRY}/${NAMESPACE}/${REPO}:${TAG}"
docker push "${REGISTRY}/${NAMESPACE}/${REPO}:latest"
echo "[ok] pushed ${TAG} and latest"