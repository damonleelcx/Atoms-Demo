# Atoms Demo

Multi-agent app builder: describe an app you want, and agents (requirement → design → implementation → feedback) produce documentation, UI design, and code. Feedback loops until you're satisfied.

# Demo

![0306-ezgif com-video-to-gif-converter](https://github.com/user-attachments/assets/e4d177b7-1ab1-4503-86ff-2c79e25039a2)

## Stack

- **Backend**: Go (Gin), Postgres (user questions), MongoDB (agent responses), Redis (rate limit), Kafka (agent pipeline), OpenAI (requirement/design/implementation agents)
- **Frontend**: Next.js 14, React 18
- **Infra**: Docker, Kubernetes

API keys: set `OPENAI_API_KEY` for real LLM output; in K8s use a Secret from `k8s/.env` (see Kubernetes section).

**Login:** The app is gated by a username/password screen. Use **Sign up** to create an account, then sign in (credentials are stored in Postgres; auth uses JWT).

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

   Edit `.env`:
   - `OPENAI_API_KEY=sk-...` — for real agent output (optional; leave empty for mock).
   - `NEXT_PUBLIC_API_URL` — leave **empty** or omit. Compose passes `${NEXT_PUBLIC_API_URL:-}` as the frontend build arg: if set in `.env` it uses that value, otherwise the `:-` gives an empty string. When the build arg is empty, the app uses relative URLs (e.g. `/api/questions`), the browser hits the frontend, and Next.js rewrites those to the backend container.

3. **Start all services**

   ```bash
   docker-compose up -d
   ```

4. **Open the app**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8080

**Summary:** One `.env` at **repo root**. Frontend and backend run on the same host; frontend calls `/api`, which is proxied to the backend by Next.js.

**Rebuild and restart after code changes (frontend + backend):**

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

**Force refresh so code changes appear (e.g. new UI like the header emoji):**  
The cluster must use a **new image tag** each time so it doesn’t reuse a cached image. Use the scripts (they generate a unique tag per run) or run the manual commands with a versioned tag.

**Recommended — run the script from repo root:**

- **Bash (Git Bash / WSL):**  
  `./scripts/build-and-deploy.sh`  
  Optionally set the API URL: `NEXT_PUBLIC_API_URL=https://api.your-domain.com ./scripts/build-and-deploy.sh`

- **Windows (Command Prompt):**  
  `scripts\build-and-deploy.cmd`  
  Optionally set the API URL first: `set NEXT_PUBLIC_API_URL=https://api.your-domain.com` then run the script.

Each run builds both backend and frontend with a tag like `build-YYYYMMDD-HHMMSS-RANDOM`, loads them into Minikube (via `docker save` → `minikube cp` → `minikube ssh docker load`, so it works when Docker Desktop and Minikube use different daemons), and updates the deployments to that tag. Then hard-refresh the browser (Ctrl+Shift+R) or clear site data.

**If rollout is stuck** (e.g. you saw "image was not found" and then "Waiting for deployment ... rollout to finish" forever): the new image never made it into Minikube. Roll back so the app works again: `kubectl rollout undo deployment/backend -n atoms-demo` and `kubectl rollout undo deployment/frontend -n atoms-demo`. Then run the script again; the updated script loads images via a tar file so Minikube gets them.

**Verify the pod is serving the new build** (run this; if you see a line with `data-app-header`, the image is new):

```bash
kubectl exec -n atoms-demo deployment/frontend -- grep -r "data-app-header" /app/.next 2>/dev/null || echo "Not found - image may be old"
```

If the command prints "Not found", the cluster is still using an old image. Use **`scripts/build-and-deploy.sh`** or **`scripts/build-and-deploy.cmd`** (they use a unique tag every time). If it finds a match but the browser still shows the old header, open the site in an **Incognito/Private window** or clear the site's cache (F12 → Application → Storage → Clear site data).

Frontend and backend use **separate domains**: frontend at `your-domain.com`, backend at `api.your-domain.com`. Build the frontend with `NEXT_PUBLIC_API_URL=http://api.your-domain.com` (or `https://api.your-domain.com` if using HTTPS).

**Response streaming:** For agent output to stream incrementally (not appear all at once), the frontend must call the **API domain** for the stream. Build with `NEXT_PUBLIC_API_URL=https://api.your-domain.com` (or `http://...` if no TLS) so the EventSource connects to `api.your-domain.com/.../stream`. If the stream URL is `your-domain.com`, it goes through the frontend and will typically buffer or fail (e.g. `ERR_HTTP2_PROTOCOL_ERROR`).

**Where to set `.env`:**

- **Repo root `.env`** — for building the frontend image and for reference.
- **`k8s/.env`** — used by Kustomize to generate the Kubernetes Secret. Must exist before `kubectl apply -k k8s`.

**Steps from scratch:**

1. **Start Minikube and enable Ingress**

   ```bash
   minikube start
   minikube addons enable ingress
   ```

2. **Create repo root `.env`**

   ```bash
   cp .env.example .env
   ```

   Edit `.env`: set `OPENAI_API_KEY=sk-...` (optional). Do **not** set `NEXT_PUBLIC_API_URL` here for the build below; it is set in the build command.

3. **Copy `.env` into `k8s/`**

   ```bash
   cp .env k8s/.env
   ```

4. **Build images, load into Minikube, and deploy**

   Both backend and frontend should use a **unique tag per build** so the cluster doesn’t reuse an old cached image. Easiest: run the script from repo root.

   **Recommended — script (generates a new tag each run):**

   ```bash
   # Bash (Git Bash / WSL)
   ./scripts/build-and-deploy.sh
   ```

   ```cmd
   REM Windows (Command Prompt)
   scripts\build-and-deploy.cmd
   ```

   The script builds with a tag like `build-20260306-123456-12345`, loads both images into Minikube, and runs `kubectl set image` so both deployments use that tag.

   **Manual (same idea — use one unique tag for both):**

   ```bash
   TAG=build-$(date +%Y%m%d-%H%M%S)-$RANDOM
   docker build --no-cache -t "atoms-backend:$TAG" ./backend
   docker build --no-cache -t "atoms-frontend:$TAG" --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com ./frontend
   minikube image load "atoms-backend:$TAG"
   minikube image load "atoms-frontend:$TAG"
   kubectl set image deployment/backend backend="atoms-backend:$TAG" -n atoms-demo
   kubectl set image deployment/frontend frontend="atoms-frontend:$TAG" -n atoms-demo
   kubectl rollout status deployment/backend -n atoms-demo
   kubectl rollout status deployment/frontend -n atoms-demo
   ```

   ```cmd
   set TAG=build-%date:~10,4%%date:~4,2%%date:~7,2%-%time:~0,2%%time:~3,2%%time:~6,2%-%RANDOM%
   set TAG=%TAG: =0%
   set TAG=%TAG::=-%
   docker build --no-cache -t atoms-backend:%TAG% ./backend
   docker build --no-cache -t atoms-frontend:%TAG% --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com ./frontend
   minikube image load atoms-backend:%TAG%
   minikube image load atoms-frontend:%TAG%
   kubectl set image deployment/backend backend=atoms-backend:%TAG% -n atoms-demo
   kubectl set image deployment/frontend frontend=atoms-frontend:%TAG% -n atoms-demo
   kubectl rollout status deployment/backend -n atoms-demo
   kubectl rollout status deployment/frontend -n atoms-demo
   ```

   (Windows `%date%` format may vary by locale; if the tag is invalid, use `scripts\build-and-deploy.cmd` instead.)

   To follow logs:

   ```bash
   kubectl logs deployment/backend -f -n atoms-demo
   kubectl logs deployment/frontend -f -n atoms-demo
   ```

   **Response still not streaming (output appears all at once)?**
   - **Gzip:** If the stream response has **`content-encoding: gzip`** in the browser, the ingress is compressing the stream and buffering it. Disable gzip in the ingress-nginx controller: `kubectl edit configmap -n ingress-nginx ingress-nginx-controller` and set `data.use-gzip: "false"` (or create the key if missing). Snippet annotations are often disabled by cluster policy, so per-path gzip off is not used in this repo.
   - Backend image must include the stream broker and handler. Rebuild without cache:  
     `docker build --no-cache -t atoms-backend:latest ./backend`  
     then `minikube image load atoms-backend:latest` and `kubectl rollout restart deployment/backend -n atoms-demo`.
   - After submitting a new question, backend logs should show **`[stream] client subscribed run_id=...`**. If you never see that line, the running backend is an old image.
   - Build the frontend with **`NEXT_PUBLIC_API_URL=https://api.your-domain.com`** so the browser opens the stream to the API host (no proxy). Use HTTPS if the app is on HTTPS to avoid mixed content.

   **If `minikube image load atoms-frontend:latest` fails** (e.g. "image was not found"), load via a tar file from the repo root:

   ```bash
   docker build --no-cache -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com ./frontend
   docker save atoms-frontend:latest -o atoms-frontend-latest.tar
   minikube image load atoms-frontend-latest.tar
   kubectl set image deployment/frontend frontend=atoms-frontend:latest -n atoms-demo
   kubectl rollout status deployment/frontend -n atoms-demo
   ```

5. **Apply Kubernetes**

   ```bash
   kubectl apply -k k8s
   ```

6. **Expose and access the app**
   - Get the ingress EXTERNAL-IP: `kubectl get svc -n ingress-nginx ingress-nginx-controller`
   - Add **both** domains to your hosts file (same IP): e.g. `<EXTERNAL-IP> your-domain.com` and `<EXTERNAL-IP> api.your-domain.com`
   - Open **http://your-domain.com** for the frontend (frontend calls **http://api.your-domain.com** for the API).

7. **Optional: Run on HTTPS locally** (e.g. for Sandpack live preview, which prefers HTTPS)
   - **Install [mkcert](https://github.com/FiloSottile/mkcert)** and create a local CA (once per machine):

     ```bash
     # macOS: brew install mkcert && mkcert -install
     # Windows: choco install mkcert; mkcert -install
     ```

   - **Generate certs** for your two hosts (run from repo root or any dir):

     ```bash
     mkcert your-domain.com api.your-domain.com
     ```

     This creates `your-domain.com+1.pem` (cert) and `your-domain.com+1-key.pem` (key). Use the same filenames below if mkcert names them differently (e.g. `cert.pem` / `key.pem`).

   - **Tell minikube’s ingress to use that cert as the default TLS certificate:**

     ```bash
     kubectl -n kube-system create secret tls mkcert --cert your-domain.com+1.pem --key your-domain.com+1-key.pem
     minikube addons configure ingress
     # When prompted, enter: kube-system/mkcert
     minikube addons disable ingress
     minikube addons enable ingress
     ```

   - **Enable TLS on the Ingresses** so the controller serves HTTPS for your hosts. From repo root:

     ```bash
     kubectl apply -k k8s
     ```

     (The `k8s` manifests include optional `tls` sections for `your-domain.com` and `api.your-domain.com`; the controller will use the default cert you configured above.)

   - **Build the frontend for HTTPS** and load into minikube:

     ```bash
     docker build --no-cache -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com ./frontend
     minikube image load atoms-frontend:latest
     kubectl rollout restart deployment/frontend -n atoms-demo
     ```

   - **Expose and open:** Use the same ingress IP as in step 6, add to hosts (same IP): `your-domain.com` and `api.your-domain.com`, then open **https://your-domain.com** (accept the browser warning if you didn’t install mkcert’s CA, or use `mkcert -install` so the cert is trusted).

**Summary:** Frontend and backend each have their own Ingress (frontend: `your-domain.com`, backend: `api.your-domain.com`). Build frontend with `NEXT_PUBLIC_API_URL=http://api.your-domain.com` (or `https://...` for local HTTPS). Point both hosts to the same ingress IP.

**Why does my request URL contain `/$NEXT_PUBLIC_API_URL/`?**  
Next.js bakes `NEXT_PUBLIC_API_URL` into the frontend JavaScript **at build time**. If the frontend image was built without the build-arg (or with a wrong value), the bundle can end up requesting that literal path. **Fix:** Rebuild the frontend image with the correct build-arg and restart the frontend deployment (see build commands above). Ingress/middleware can rewrite the path as a workaround, but the only permanent fix is rebuilding the frontend.

---

### Option C: Minikube + Docker on a server (deployment)

Same two-domain setup as Option B: frontend at `your-domain.com`, backend at `api.your-domain.com`. Build the frontend with `NEXT_PUBLIC_API_URL=https://api.your-domain.com` (or `http://` if not using TLS).

**Where to set `.env`:**

- **On the server (or in CI):** **Repo root `.env`** for building images.
- **On the server:** **`k8s/.env`** for Kustomize Secret (backend keys). Do not commit real keys; copy from a secure source or inject via CI/CD.

**Steps from scratch:**

1. **On the server:** Clone repo and create env files

   ```bash
   cd /path/to/Atoms-Demo
   cp .env.example .env
   ```

   Edit **repo root `.env`**: set `OPENAI_API_KEY=sk-...` (for backend). Do not set `NEXT_PUBLIC_API_URL` in `.env` for the build below; set it in the build command to match your API domain.

2. **Copy to `k8s/.env`**

   ```bash
   cp .env k8s/.env
   ```

   Ensure `k8s/.env` is in `.gitignore` and never committed. On a server you may create `k8s/.env` from a secrets store or CI/CD.

3. **Build images** (on the server or in CI; tag for your registry if you push)

   Build the **frontend** with the backend API base URL (use the domain and scheme users will use: e.g. `https://api.your-domain.com`).

   **Bash (Git Bash / WSL):**

   ```bash
   docker build --no-cache -t atoms-backend:latest ./backend
   [ -f k8s/.env ] && set -a && . ./k8s/.env && set +a
   docker build --no-cache -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com ./frontend
   ```

   **Windows (Command Prompt):**

   ```cmd
   docker build --no-cache -t atoms-backend:latest ./backend
   for /f "tokens=*" %i in ('minikube docker-env --shell cmd') do %i
   if exist k8s\.env for /f "usebackq eol=# tokens=1* delims==" %a in ("k8s\.env") do set "%~a=%~b"
   docker build --no-cache -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=https://api.your-domain.com ./frontend
   ```

   If you use a registry, tag and push, then point your K8s manifests to the registry image.

4. **Start Minikube (or use an existing cluster) and load/pull images**

   ```bash
   minikube start
   minikube addons enable ingress
   minikube image load atoms-backend:latest
   minikube image load atoms-frontend:latest
   ```

   Or use image pull from your registry if deployment is remote.

5. **Apply Kubernetes**

   ```bash
   kubectl apply -k k8s
   ```

6. **Expose the app**
   - Ensure Ingress hosts in `k8s/frontend.yaml` and `k8s/backend-ingress.yaml` match your domains. For **AWS EC2**, use **Minikube with driver=none** (see **"Minikube on AWS EC2 (driver=none)"** below)—no tunnel or port-forward. For other servers or local Minikube, point DNS (or hosts) to your ingress and use your cloud LoadBalancer or local ingress access as needed.

#### Minikube on AWS EC2 (driver=none)

On AWS Linux EC2, run Minikube with **`--driver=none`** and **containerd** so the node is the host. NodePort then binds directly on the EC2 instance; no tunnel or port-forward is required.

**1. Install dependencies** (Amazon Linux 2023; adjust for your distro)

```bash
sudo yum install -y conntrack socat containerd
sudo systemctl enable containerd && sudo systemctl start containerd
```

**crictl** (required by Minikube for driver=none):

```bash
CRICTL_VERSION="v1.30.0"
sudo curl -sL "https://github.com/kubernetes-sigs/cri-tools/releases/download/${CRICTL_VERSION}/crictl-${CRICTL_VERSION}-linux-amd64.tar.gz" | sudo tar -C /usr/local/bin -xz
sudo chmod +x /usr/local/bin/crictl
sudo crictl --version
```

**CNI plugins** (required for Kubernetes 1.24+ with driver=none):

```bash
sudo mkdir -p /opt/cni/bin
CNI_VERSION="v1.4.0"
sudo curl -sL "https://github.com/containernetworking/plugins/releases/download/${CNI_VERSION}/cni-plugins-linux-amd64-${CNI_VERSION}.tgz" | sudo tar -C /opt/cni/bin -xz
ls /opt/cni/bin
```

**2. Start Minikube with driver=none and containerd**

```bash
minikube stop
minikube delete
minikube start --driver=none --container-runtime=containerd
```

If Minikube reports no suitable external IP, set the API server to the instance private IP:

```bash
MINIKUBE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)
minikube start --driver=none --container-runtime=containerd --apiserver-ips="$MINIKUBE_IP"
```

Then fix kubectl config ownership:

```bash
sudo chown -R $USER $HOME/.kube $HOME/.minikube
```

**3. Enable Ingress and deploy the app**

```bash
minikube addons enable ingress
kubectl apply -k k8s
```

If you see an admission webhook timeout, wait for ingress-nginx pods to be Ready, then retry. Optionally remove the webhook temporarily: `kubectl delete validatingwebhookconfiguration ingress-nginx-admission 2>/dev/null || true`, then `kubectl apply -k k8s` again.

**4. Use NodePort for the ingress controller**

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
# If TYPE is LoadBalancer, switch to NodePort:
kubectl patch svc ingress-nginx-controller -n ingress-nginx -p '{"spec":{"type":"NodePort"}}'
kubectl get svc -n ingress-nginx ingress-nginx-controller
```

Note the **actual NodePorts** (e.g. **80:30944/TCP**, **443:30212/TCP** → HTTP **30944**, HTTPS **30212**). Ports can vary per cluster; use the values from `kubectl get svc`.

**5. Confirm NodePort is bound on the host**

```bash
# Replace with your actual HTTP and HTTPS NodePorts from step 4
sudo ss -tlnp | grep -E '30944|30212'
```

**6. Open the EC2 security group**

Inbound **TCP** for the HTTP NodePort and HTTPS NodePort (e.g. **30944** and **30212**) from `0.0.0.0/0` (or your IP range).

**7. Build images and load into the cluster**

If Docker reports permission denied on `~/.docker/buildx/`:

```bash
sudo chown -R $USER:$USER $HOME/.docker
```

Then build and import into containerd (driver=none uses host containerd):

```bash
docker build -t atoms-backend:latest ./backend
docker build -t atoms-frontend:latest ./frontend
docker save atoms-backend:latest  | sudo ctr -n k8s.io image import -
docker save atoms-frontend:latest | sudo ctr -n k8s.io image import -
```

**8. Build frontend with API URL using the HTTPS NodePort**

Replace the hostname and port with your EC2 public DNS and the **HTTPS** NodePort from step 4 (e.g. **30212**):

```bash
docker build --no-cache -t atoms-frontend:latest \
  --build-arg NEXT_PUBLIC_API_URL=https://ec2-18-118-6-21.us-east-2.compute.amazonaws.com:30212 \
  ./frontend
docker save atoms-frontend:latest | sudo ctr -n k8s.io image import -
kubectl rollout restart deployment/frontend -n atoms-demo
```

**9. Access the app**

Open **https://ec2-18-118-6-21.us-east-2.compute.amazonaws.com:30212** (use your EC2 hostname and HTTPS NodePort). Accept the self-signed certificate warning. No tunnel or port-forward process is required.

---

**Summary:** Same as Option B: two Ingress hosts (frontend + backend). Build frontend with `NEXT_PUBLIC_API_URL` set to your API domain. Use **repo root `.env`** for building and **`k8s/.env`** for the K8s Secret; handle secrets securely in production.

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
docker build --no-cache -t atoms-backend:latest ./backend
```

**Frontend** (Next.js bakes `NEXT_PUBLIC_API_URL` in at build time)

- **K8s two-domain (Option B/C):** use `http://api.your-domain.com` (or `https://api.your-domain.com` with TLS) — frontend at `your-domain.com`, backend at `api.your-domain.com` (see Option B/C in Quick start).
- **Docker Compose (Option A):** use **empty** — Next.js rewrites `/api` to the backend on the same host.
- **Local dev (frontend/backend on host):** use `http://localhost:8080` — frontend at localhost:3000, backend at localhost:8080.

- **Bash (Linux/macOS/Git Bash):** set the variable, then build:

  ```bash
  export NEXT_PUBLIC_API_URL=
  docker build --no-cache -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" ./frontend
  ```

  Or in one line with a value:

  ```bash
  docker build --no-cache -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080 ./frontend
  ```

- **Command Prompt (Windows):** set the variable, then build:
  ```cmd
  set NEXT_PUBLIC_API_URL=
  docker build --no-cache -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=%NEXT_PUBLIC_API_URL% ./frontend
  ```
  Or in one line with a value:
  ```cmd
  docker build --no-cache -t atoms-frontend:latest --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080 ./frontend
  ```

If you use a `.env` file, load it first (e.g. in bash: `set -a && source .env && set +a` then run the `docker build`; in Windows you'd set variables manually or use a tool that reads `.env`).

## Kubernetes (reference)

- **Secrets:** Kustomize `secretGenerator` reads **`k8s/.env`** and creates Secret `atoms-demo-secrets`. Ensure `k8s/.env` exists (e.g. `cp .env k8s/.env` or `make k8s-env`).
- **Apply:** `kubectl apply -k k8s` (or `make k8s-apply`).

- **After apply, if frontend calls wrong API:** rebuild the frontend with the correct `NEXT_PUBLIC_API_URL` (e.g. `http://api.your-domain.com`), load the image, and restart: `kubectl rollout restart deployment/frontend -n atoms-demo`.  
  **Runtime override:** Ensure `NEXT_PUBLIC_API_URL` is in the Secret so the server can inject it. In **`k8s/.env`** add `NEXT_PUBLIC_API_URL=http://api.your-domain.com`, then re-apply and restart frontend:
  ```bash
  kubectl apply -k k8s
  kubectl rollout restart deployment/frontend -n atoms-demo
  ```
  Check that the pod has the var: `kubectl exec -n atoms-demo deployment/frontend -- sh -c "env | grep NEXT_PUBLIC"` (use `sh -c "..."` on Windows so grep runs inside the container).

**Port-forward:**

```bash
kubectl port-forward -n atoms-demo svc/frontend 3000:3000
kubectl port-forward -n atoms-demo svc/backend 8080:8080
```

Then open http://localhost:3000.

**Ingress (nginx):** Two Ingresses: frontend at `your-domain.com` (`k8s/frontend.yaml`) and backend at `api.your-domain.com` (`k8s/backend-ingress.yaml`). Build frontend with `NEXT_PUBLIC_API_URL=http://api.your-domain.com`.

- **Minikube / local:** Get EXTERNAL-IP with `kubectl get svc -n ingress-nginx ingress-nginx-controller`, add to hosts: `<EXTERNAL-IP> your-domain.com` and `<EXTERNAL-IP> api.your-domain.com`, then open http://your-domain.com (see Option B step 6).

- **Minikube on AWS EC2:** Use **driver=none** so NodePort binds on the host (see **Option C → Minikube on AWS EC2 (driver=none)**). Open the security group for the HTTP/HTTPS NodePorts from `kubectl get svc -n ingress-nginx ingress-nginx-controller`; build frontend with `NEXT_PUBLIC_API_URL` set to your EC2 hostname and HTTPS NodePort (e.g. `https://ec2-....compute.amazonaws.com:30212`).

- **Production (managed K8s):** Set Ingress hosts in `k8s/frontend.yaml` and `k8s/backend-ingress.yaml` to your domains. Point DNS for both to the ingress LoadBalancer. Add TLS (e.g. cert-manager) and use `NEXT_PUBLIC_API_URL=https://api.your-domain.com` when building the frontend.

## Troubleshooting

**Live preview (implementation stage):** This repo uses **react-live** only (Sandpack removed). Preview works on HTTP and HTTPS. If you still see an old "Sandpack" or iframe error, do a **hard refresh** (Ctrl+Shift+R) or **clear site data**; rebuild the frontend with `docker build --no-cache ...` so the new bundle is in the image.

**SSE streaming (agent output appears all at once):** The frontend opens an EventSource to `/api/questions/:id/responses/stream?run_id=...`. When using **same-origin** (your-domain.com), that request goes through the Next.js proxy; the custom route `app/api/questions/[id]/responses/stream/route.ts` streams from the backend. If the response still appears in one chunk, try building the frontend with **`NEXT_PUBLIC_API_URL=http://api.your-domain.com`** so the browser connects **directly** to the backend for the stream (no proxy), which avoids any buffering.

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

Without `OPENAI_API_KEY`, agents return fallback mock content. App is gated by demo login (see top). Rate limiting is per-IP via Redis.

---

## 简要说明文档

### 实现思路与关键取舍

- **流水线设计**  
  采用「需求 → 设计 → 实现 → 反馈」四阶段流水线：需求阶段产出 Markdown 文档，设计阶段产出线框图 JSON，实现阶段产出完整 React 单文件代码，反馈阶段写入「等待用户反馈」并可由用户提交反馈后重新从需求阶段跑起。

- **双轨执行**  
  - **首轮**：用户提交问题后，前端连接 SSE 流时后端在**进程内同步**执行 `RunPipelineSync`（requirement → design → implementation），不经过 Kafka，结果通过内存 Broker 实时推给当前连接的客户端，并写入 MongoDB。  
  - **反馈轮**：用户提交反馈后，后端将消息写入 Kafka `requirement-stage`，由四个 Kafka 消费者（Requirement → Design → Implementation → Feedback）依次处理；同一进程内消费者会向同一 Broker 发送事件，前端对新 `run_id` 打开流即可收到流式输出。  
  取舍：首轮优先保证「连上即看」的体验与实现简单；反馈轮用 Kafka 解耦，便于日后拆成多实例或独立服务。

- **存储与缓存**  
  Postgres 存用户问题（含 session_id）；MongoDB 存各阶段产出（含 run_id、stage、content、payload）；Redis 用于限流与列表/响应缓存。未做真实用户表与多租户隔离。

- **前端**  
  Next.js 14 + React 18，登录为硬编码演示账号（见上文 Login）。实现阶段用 **react-live** 做内联预览；对 LLM 常见手误（如标识符中多空格）做了前端修复（`fixAgentCodeTypo`），以提升预览可运行率。

- **其它取舍**  
  无注册/找回密码、无 OAuth；无持久化会话（仅内存 token）；错误重试以 agent 内有限重试 + Kafka 重试为主，无全局重试队列或死信处理。

### 当前完成程度

| 类别     | 已做 | 未做 / 部分做 |
|----------|------|----------------|
| 流水线   | 需求 / 设计 / 实现三阶段 LLM 调用；反馈提交后经 Kafka 重跑需求 | 同步流水线未在结束时写入「awaiting feedback」到 Mongo（仅 Kafka 路径有 stage 4） |
| 流式输出 | SSE 按 stage 分块推送；Broker 缓冲并在订阅时回放 | 反馈轮依赖前端对新 run_id 打开流，否则仅能从列表拉已存结果 |
| 前端 UI  | 问题列表、run 切换、需求/设计/实现三栏展示、线框图与代码展示、react-live 预览、反馈输入（文本+音频） | 无多 run 对比视图、无导出/分享 |
| 音频     | 问题与反馈支持语音输入，Whisper 转写（需 `OPENAI_API_KEY`） | 无语音播报、无多语言 UI |
| 认证与限流 | 演示登录门控、按 IP 的 Redis 限流 | 无注册、无数据库用户、无 RBAC |
| 部署     | Docker Compose、K8s（Minikube/EC2 等）、双域/单域 Ingress、HTTPS 可选 | 无 CI/CD 示例、无监控/告警 |
| 测试     | — | 无后端单元/集成测试、无 E2E |

### 若继续投入时间的扩展建议与优先级

- **P0（一致性 + 体验）**  
  - 在 `RunPipelineSync` 结束后向 MongoDB 写入 stage 4「awaiting feedback」，使首轮与反馈轮在数据模型上一致，便于前端统一展示「可填写反馈」状态。  
  - 统一错误提示与重试：流中断、Kafka 不可用时的用户可见提示与可选「重试」按钮。

- **P1（功能）**  
  - 简单用户系统：注册/登录/会话持久化（可仍用 Postgres），问题与 run 按用户隔离。  
  - 多 run 对比：同一问题下多 run 的并排或切换视图，便于比较不同反馈后的结果。

- **P2（质量与可配置）**  
  - 后端单元测试（handlers、agents、stream broker）、集成测试（带 Mock LLM/Kafka）。  
  - E2E（Playwright/Cypress）：登录 → 提问题 → 看流式结果 → 提交反馈 → 看新 run。  
  - 可配置 LLM 模型/API（如通过 config 或 env 切换模型、max_tokens 等）。

- **P3（运维与扩展）**  
  - 多租户或团队维度隔离（tenant_id / team_id）。  
  - 审计日志与基础监控（请求量、阶段耗时、失败率）。  
  - 可选 Sandpack 等沙箱预览（当前以 react-live 为主，README 已说明 Sandpack 已移除）。
