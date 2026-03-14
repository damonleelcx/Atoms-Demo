#!/usr/bin/env bash
# Build backend and frontend with a unique tag, load into Minikube, and deploy.
# Run from repo root. Set NEXT_PUBLIC_API_URL in the script or pass as env (default below).

set -e
cd "$(dirname "$0")/.."

# Unique tag per build: build-YYYYMMDD-HHMMSS-RANDOM
TAG="build-$(date +%Y%m%d-%H%M%S)-$RANDOM"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://ec2-18-118-6-21.us-east-2.compute.amazonaws.com}"

echo "Tag: $TAG"
echo "Building backend..."
docker build --no-cache -t "atoms-backend:$TAG" ./backend
echo "Building frontend (NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL)..."
docker build --no-cache -t "atoms-frontend:$TAG" --build-arg "NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL" ./frontend
echo "Loading images into Minikube (save to tar then load in cluster; works when Docker and Minikube use different daemons)..."
TAR="atoms-images-$TAG.tar"
docker save -o "$TAR" "atoms-backend:$TAG" "atoms-frontend:$TAG"
minikube cp "$TAR" "/tmp/$TAR"
minikube ssh "docker load -i /tmp/$TAR && rm -f /tmp/$TAR"
rm -f "$TAR"
echo "Updating deployments to use $TAG..."
kubectl set image deployment/backend backend="atoms-backend:$TAG" -n atoms-demo
kubectl set image deployment/frontend frontend="atoms-frontend:$TAG" -n atoms-demo
echo "Waiting for rollout..."
kubectl rollout status deployment/backend -n atoms-demo
kubectl rollout status deployment/frontend -n atoms-demo
echo "Done. Backend and frontend now use tag: $TAG"
