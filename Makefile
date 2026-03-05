.PHONY: docker-backend docker-frontend k8s-infra k8s-app k8s-all k8s-env k8s-apply k8s-build

docker-backend:
	docker build -t atoms-backend:latest ./backend

# Build frontend (optionally with NEXT_PUBLIC_API_URL from .env: make docker-frontend or source .env && make docker-frontend)
docker-frontend:
	docker build -t atoms-frontend:latest \
		--build-arg NEXT_PUBLIC_API_URL=$${NEXT_PUBLIC_API_URL} \
		./frontend

# Copy .env to k8s/.env so Kustomize secretGenerator can load it (required for k8s-apply)
k8s-env:
	@./scripts/ensure-k8s-env.sh

# Build manifests (verify secretGenerator has k8s/.env)
k8s-build: k8s-env
	kubectl kustomize k8s

# Apply all resources with Kustomize (secretGenerator loads backend + frontend secrets from k8s/.env)
k8s-apply: k8s-env
	kubectl apply -k k8s

k8s-infra:
	kubectl apply -f k8s/namespace.yaml
	kubectl apply -f k8s/postgres.yaml
	kubectl apply -f k8s/mongodb.yaml
	kubectl apply -f k8s/redis.yaml
	kubectl apply -f k8s/zookeeper.yaml
	kubectl apply -f k8s/kafka.yaml

k8s-app: docker-backend docker-frontend
	kubectl apply -f k8s/backend.yaml
	kubectl apply -f k8s/frontend.yaml

k8s-all: k8s-infra
	@echo "Waiting 30s for Kafka..."
	@sleep 30
	$(MAKE) k8s-app
