# Atoms Demo

Multi-agent app builder: describe an app you want, and agents (requirement → design → implementation → feedback) produce documentation, UI design, and code. Feedback loops until you're satisfied.

## Stack

- **Backend**: Go (Gin), Postgres (user questions), MongoDB (agent responses), Redis (rate limit), Kafka (agent pipeline), OpenAI (requirement/design/implementation agents)
- **Frontend**: Next.js 14, React 18
- **Infra**: Docker, Kubernetes

API keys: set `OPENAI_API_KEY` for real LLM output; in K8s use a Secret from `k8s/.env` (see Kubernetes section).

---

## Quick start: pick your setup

Choose one of the three flows below. Each has **exact steps** and **where to set `.env`**.

---

### Option A: Docker only (run everything locally in Docker)

**Where to set `.env`:** **Repo root** — one `.env` file at the project root. Docker Compose and the frontend build read it.

**Steps from scratch:**

1. **Clone and go to repo root**

   ```bash
   cd /path/to/Atoms-Demo
   ```

2. **Create `.env` at repo root** (required; compose uses it)

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set at least:
   - `OPENAI_API_KEY=sk-...` — for real agent output (optional; leave empty for mock).
   - `NEXT_PUBLIC_API_URL=` — leave **empty** for same-origin (frontend talks to backend on same host). Or set `http://localhost:8080` if you need it explicit.
     If `.env` is missing, create an empty file: `touch .env` (or `type nul > .env` on Windows) so `docker-compose` does not fail.

3. **Start all services**

   ```bash
   docker-compose up -d
   ```

4. **Open the app**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8080

**Summary:** One `.env` at **repo root**. Compose passes it to backend/frontend; frontend bakes `NEXT_PUBLIC_API_URL` at build time via compose build-args.

**Rebuild and restart after code changes (frontend + backend):**

From repo root, rebuild images and restart the app and backend services:

```bash
docker compose up -d --build frontend backend
```

To rebuild and restart everything (including dependencies):

```bash
docker compose up -d --build
docker compose logs -f backend
```

---

### Option B: Minikube + Docker (local K8s, images built on your machine)

**Where to set `.env`:**

- **Repo root `.env`** — for building the frontend image (`NEXT_PUBLIC_API_URL`) and for reference.
- **`k8s/.env`** — used by Kustomize to generate the Kubernetes Secret. Must exist before `kubectl apply -k k8s`.

**Steps from scratch:**

1. **Start Minikube**

   ```bash
   minikube start
   ```

2. **Create repo root `.env`** (for build and for copying into k8s)

   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   - `OPENAI_API_KEY=sk-...` (optional).
   - `NEXT_PUBLIC_API_URL=` — leave **empty** for same-origin in the cluster (frontend → backend via service name), or set `http://backend:8080` or the URL you will use to reach the backend from the browser (e.g. `http://localhost:8080` if you port-forward).

3. **Copy `.env` into `k8s/`** (Kustomize reads `k8s/.env` to create the Secret)

   ```bash
   cp .env k8s/.env
   ```

   (Or run `make k8s-env` if your Makefile has a target that does this.)

4. **Build images and load into Minikube**

   ```bash
   docker build -t atoms-backend:latest ./backend
   export NEXT_PUBLIC_API_URL=   # or set to your backend URL
   docker build -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" ./frontend
   minikube image load atoms-backend:latest
   minikube image load atoms-frontend:latest
   ```

5. **Apply Kubernetes resources** (Secret is generated from `k8s/.env`)

   ```bash
   kubectl apply -k k8s
   ```

6. **Access the app**
   - Port-forward:
     ```bash
     kubectl port-forward -n atoms-demo svc/frontend 3000:3000
     kubectl port-forward -n atoms-demo svc/backend 8080:8080
     ```
     Open http://localhost:3000
   - Or enable Ingress and use Minikube IP (see Ingress section below).

**Summary:** **Repo root `.env`** for builds and as source; **`k8s/.env`** for K8s Secret. Keep them in sync (e.g. after changing keys, run `cp .env k8s/.env` then re-apply).

---

### Option C: Minikube + Docker on a server (deployment)

**Where to set `.env`:**

- **On the server (or in CI):** **Repo root `.env`** for building images (especially `NEXT_PUBLIC_API_URL`).
- **On the server:** **`k8s/.env`** for Kustomize Secret (backend keys + optional frontend env). Do not commit real keys; copy from a secure source or inject via CI/CD.

**Steps from scratch:**

1. **On the server:** Clone repo and create env files

   ```bash
   cd /path/to/Atoms-Demo
   cp .env.example .env
   ```

   Edit **repo root `.env`**:
   - `OPENAI_API_KEY=sk-...` (for backend).
   - `NEXT_PUBLIC_API_URL=https://api.yourdomain.com` (or your backend URL as seen by the browser in production).

2. **Copy to `k8s/.env`** (Kustomize will generate the Secret from this)

   ```bash
   cp .env k8s/.env
   ```

   Ensure `k8s/.env` is in `.gitignore` and never committed with real keys. On a server you may instead create `k8s/.env` from a secrets store or CI/CD.

3. **Build images** (on the server or in CI; tag for your registry if you push)

   ```bash
   docker build -t atoms-backend:latest ./backend
   docker build -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" ./frontend
   ```

   If you use a registry, tag and push, then point your K8s manifests to the registry image.

4. **Start Minikube (or use an existing cluster) and load/pull images**

   ```bash
   minikube start
   minikube image load atoms-backend:latest
   minikube image load atoms-frontend:latest
   ```

   Or use image pull from your registry if deployment is remote.

5. **Apply Kubernetes**

   ```bash
   kubectl apply -k k8s
   ```

6. **Expose the app** (Ingress / LoadBalancer / port-forward as needed). For production, set the Ingress host in `k8s/frontend.yaml` to your domain and configure TLS.

**Summary:** **Repo root `.env`** for building (and as source of truth); **`k8s/.env`** for the K8s Secret on the server. Use secure handling for `k8s/.env` in production (no commit, use secrets manager or CI/CD).

---

## Local development (backend + frontend on host, dependencies in Docker)

If you prefer to run backend and frontend locally (not in Docker) and only run dependencies in Docker:

1. Start dependencies:

   ```bash
   docker-compose up -d postgres mongodb redis zookeeper kafka
   ```

2. **(Optional)** Copy `.env.example` to **repo root** `.env` and set `OPENAI_API_KEY` for real agent output.

3. Run backend (needs Go 1.23+):

   ```bash
   cd backend
   go mod tidy
   go run ./cmd/server
   ```

4. Run frontend (needs Node 20):

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   Set `NEXT_PUBLIC_API_URL=http://localhost:8080` in **repo root** or **frontend** `.env` if the frontend must call the backend by URL.

5. Open http://localhost:3000.

---

## Building Docker images (reference)

From the **repo root**:

**Backend**

```bash
docker build -t atoms-backend:latest ./backend
```

**Frontend** (Next.js bakes `NEXT_PUBLIC_API_URL` in at build time; use empty for same-origin or your API base URL)

- **Bash (Linux/macOS/Git Bash):** set the variable, then build:

  ```bash
  export NEXT_PUBLIC_API_URL=
  docker build -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" ./frontend
  ```

  Or in one line with a value:

  ```bash
  docker build -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080 ./frontend
  ```

- **Command Prompt (Windows):** set the variable, then build:
  ```cmd
  set NEXT_PUBLIC_API_URL=
  docker build -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=%NEXT_PUBLIC_API_URL% ./frontend
  ```
  Or in one line with a value:
  ```cmd
  docker build -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080 ./frontend
  ```

If you use a `.env` file, load it first (e.g. in bash: `set -a && source .env && set +a` then run the `docker build`; in Windows you’d set variables manually or use a tool that reads `.env`).

## Kubernetes (reference)

- **Secrets:** Kustomize `secretGenerator` reads **`k8s/.env`** and creates Secret `atoms-demo-secrets`. Ensure `k8s/.env` exists (e.g. `cp .env k8s/.env` or `make k8s-env`).
- **Apply:** `kubectl apply -k k8s` (or `make k8s-apply`).

**Port-forward:**

```bash
kubectl port-forward -n atoms-demo svc/frontend 3000:3000
kubectl port-forward -n atoms-demo svc/backend 8080:8080
```

Then open http://localhost:3000.

**Ingress (nginx):** The Ingress in `k8s/frontend.yaml` has two rules.

- **Minikube / local (no custom host):** Use the rule with no `host`. Enable ingress and open the app:

  ```bash
  minikube addons enable ingress
  # Open app at http://$(minikube ip)  (e.g. http://192.168.49.2)
  ```

- **Minikube / local with your-domain.com:** Use either:
  1. **minikube tunnel** – Run `minikube tunnel` (leave it running). Get the ingress IP with `kubectl get ingress -n atoms-demo`, then add `<that-IP> your-domain.com` to your hosts file. Open http://your-domain.com.
  2. **127.0.0.1 + port-forward** – Add `127.0.0.1 your-domain.com` to your hosts file, then run `kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 80:80`. Open http://your-domain.com.

- **Production (domain):** In `k8s/frontend.yaml`, set the first rule's `host` to your real domain (e.g. `app.example.com`). Point DNS to the ingress LoadBalancer. Add a `spec.tls` block and use cert-manager or your provider's TLS for HTTPS.

## API (backend)

- `POST /api/questions` – submit question `{ "content": "...", "session_id": "?" }`
- `GET /api/questions` – list previous questions
- `GET /api/questions/:id` – get one question
- `POST /api/questions/audio` – submit question as audio (body: raw audio; transcribed via Whisper when `OPENAI_API_KEY` is set; header `X-Session-ID` optional)
- `GET /api/questions/:questionId/responses?run_id=` – get agent responses for a question
- `GET /api/questions/:questionId/runs` – list run IDs for a question
- `POST /api/questions/:questionId/feedback` – submit feedback `{ "feedback": "...", "run_id": "?", "session_id": "?" }`
- `POST /api/questions/:questionId/feedback/audio` – submit feedback as audio (body: raw audio; transcribed via Whisper when `OPENAI_API_KEY` is set; headers `X-Run-ID`, `X-Session-ID` optional)

## Pipeline (Kafka)

1. **Requirement** – consumes `requirement-stage`, calls OpenAI for requirements/architecture doc, saves to MongoDB, produces to `design-stage`
2. **Design** – consumes `design-stage`, calls OpenAI for React UI component, saves to MongoDB, produces to `implementation-stage`
3. **Implementation** – consumes `implementation-stage`, calls OpenAI for full React app code, saves to MongoDB, produces to `feedback-stage`
4. **Feedback** – consumes `feedback-stage`, writes “awaiting feedback” to MongoDB; user submits feedback via API, which produces back to `requirement-stage` to loop

Without `OPENAI_API_KEY`, agents return fallback mock content. No authentication. Rate limiting is per-IP via Redis.
