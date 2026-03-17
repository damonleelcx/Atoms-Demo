#!/usr/bin/env bash
# Build backend and frontend with a unique tag, load into Minikube, and deploy.
# Run from repo root. Set NEXT_PUBLIC_API_URL in the script or pass as env (default below).
# When run with sudo, minikube/kubectl use the invoking user's env (so the cluster is found).

set -e
cd "$(dirname "$0")/.."

# When running as root (e.g. sudo), use the invoking user's HOME so minikube/kubectl find the cluster
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
  export HOME="$(eval echo ~$SUDO_USER)"
  export MINIKUBE_HOME="$HOME/.minikube"
  export KUBECONFIG="$HOME/.kube/config"
fi

# Unique tag per build: build-YYYYMMDD-HHMMSS-RANDOM
TAG="build-$(date +%Y%m%d-%H%M%S)-$RANDOM"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://ec2-18-118-6-21.us-east-2.compute.amazonaws.com:30212}"

echo "Tag: $TAG"
echo "Building backend..."
docker build --no-cache -t "atoms-backend:$TAG" ./backend
echo "Building frontend (NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL)..."
docker build --no-cache -t "atoms-frontend:$TAG" --build-arg "NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL" ./frontend
echo "Loading images into Minikube..."
DRIVER="$(minikube config get driver 2>/dev/null | tr -d '\r\n' || true)"
if [ "$DRIVER" = "none" ]; then
  # driver=none: node is the host, use containerd directly (no minikube ssh)
  echo "Using containerd import (driver=none)..."
  docker save "atoms-backend:$TAG" "atoms-frontend:$TAG" | sudo ctr -n k8s.io image import -
else
  # Try minikube cp + ssh (fails when driver=none; then fall back to ctr)
  TAR="atoms-images-$TAG.tar"
  docker save -o "$TAR" "atoms-backend:$TAG" "atoms-frontend:$TAG"
  if minikube cp "$TAR" "/tmp/$TAR" 2>/dev/null && minikube ssh "docker load -i /tmp/$TAR; rm -f /tmp/$TAR || true" 2>/dev/null; then
    :
  else
    echo "Minikube cp/ssh not available (e.g. driver=none). Using containerd import..."
    docker save "atoms-backend:$TAG" "atoms-frontend:$TAG" | sudo ctr -n k8s.io image import -
  fi
  rm -f "$TAR"
fi
echo "Updating deployments to use $TAG..."
kubectl set image deployment/backend backend="atoms-backend:$TAG" -n atoms-demo
kubectl set image deployment/frontend frontend="atoms-frontend:$TAG" -n atoms-demo
echo "Waiting for rollout..."
kubectl rollout status deployment/backend -n atoms-demo
kubectl rollout status deployment/frontend -n atoms-demo
echo "Done. Backend and frontend now use tag: $TAG"
