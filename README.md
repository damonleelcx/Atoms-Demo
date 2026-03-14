# Atoms Demo

Multi-agent app builder: describe an app you want, and agents (requirement → design → implementation → feedback) produce documentation, UI design, and code. Feedback loops until you're satisfied.

# Demo
![0306-ezgif com-video-to-gif-converter](https://github.com/user-attachments/assets/e4d177b7-1ab1-4503-86ff-2c79e25039a2)

## Stack

- **Backend**: Go (Gin), Postgres (user questions), MongoDB (agent responses), Redis (rate limit), Kafka (agent pipeline), OpenAI (requirement/design/implementation agents)
- **Frontend**: Next.js 14, React 18
- **Infra**: Docker, Kubernetes

API keys: set `OPENAI_API_KEY` for real LLM output; in K8s use a Secret from `k8s/.env` (see Kubernetes section).

**Login:** The app is gated by a username/password screen. Demo credentials (hardcoded, no database): **username `user123`, password `password123`.**

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
   - Run **minikube tunnel** (leave the terminal open). Note the EXTERNAL-IP for the ingress controller:  
     `kubectl get svc -n ingress-nginx ingress-nginx-controller`
   - Add **both** domains to your hosts file (same IP), for example:
     - `127.0.0.1 your-domain.com`
     - `127.0.0.1 api.your-domain.com`
       (Use the actual EXTERNAL-IP from tunnel if different.)
   - Open **http://your-domain.com** for the frontend. The frontend will call **http://api.your-domain.com** for the API.

   **Alternative (port-forward instead of tunnel):** add `127.0.0.1 your-domain.com` and `127.0.0.1 api.your-domain.com` to hosts, then:

   ```bash
   kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 80:80
   ```

   Open http://your-domain.com.

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

   - **Expose and open:** Run `minikube tunnel`, add to hosts (same IP): `your-domain.com` and `api.your-domain.com`, then open **https://your-domain.com** (accept the browser warning if you didn’t install mkcert’s CA, or use `mkcert -install` so the cert is trusted).

**Summary:** Frontend and backend each have their own Ingress (frontend: `your-domain.com`, backend: `api.your-domain.com`). Build frontend with `NEXT_PUBLIC_API_URL=http://api.your-domain.com` (or `https://...` for local HTTPS). Point both hosts to the same ingress IP (tunnel or port-forward).

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
   - Ensure Ingress hosts in `k8s/frontend.yaml` and `k8s/backend-ingress.yaml` match your domains (`your-domain.com` and `api.your-domain.com`). For production, configure TLS (e.g. cert-manager) and use `https` in `NEXT_PUBLIC_API_URL`.
   - Run **minikube tunnel** (or use your cloud LoadBalancer). Point DNS (or hosts) for both domains to the ingress EXTERNAL-IP. Users open **https://your-domain.com**; the frontend calls **https://api.your-domain.com**.

#### Exposing on AWS EC2 with NodePort (no tunnel)

When the ingress controller is **NodePort** (e.g. `kubectl get svc -n ingress-nginx ingress-nginx-controller` shows `TYPE NodePort` and `<none>` for EXTERNAL-IP), you do **not** need `minikube tunnel` **only if** the NodePort is bound on the EC2 host (see below).

**Important (Minikube on EC2):** If minikube uses the **Docker** driver, the node runs inside a container. NodePorts (31379, 31466) then listen only inside that container, **not** on the EC2 host. From the host run `sudo ss -tlnp | grep 31466`; if you see no output, NodePort is not reachable from the internet. Use either:

- **Option 1 (recommended):** Switch to LoadBalancer + `minikube tunnel` so traffic uses standard ports 80/443. See **"Option 1: LoadBalancer + tunnel (EC2)"** below.
- **Option 2:** Recreate minikube with `minikube start --driver=none` so the node is the EC2 host; then NodePort will bind on the host and the steps in this section apply.

**Option 1: LoadBalancer + minikube tunnel (EC2, Docker driver)**

1. Change the ingress controller to LoadBalancer and run the tunnel (on the EC2 host). **On Linux you must run the tunnel with `sudo`** so it can bind to ports 80 and 443. If you use `sudo minikube tunnel`, root must see the same minikube profile as your user — use the same HOME and KUBECONFIG:
   ```bash
   kubectl patch svc ingress-nginx-controller -n ingress-nginx -p '{"spec":{"type":"LoadBalancer"}}'
   sudo env HOME=/home/ec2-user MINIKUBE_HOME=/home/ec2-user/.minikube KUBECONFIG=/home/ec2-user/.kube/config minikube tunnel
   ```
   (Replace `/home/ec2-user` with your actual `$HOME` if different.) If EXTERNAL-IP stays a private range (e.g. `10.110.206.146`) and `curl -k https://127.0.0.1` fails with "Connection refused", the tunnel did not bind to the host — use the `sudo env ... minikube tunnel` form above.

**Run tunnel in the background (AWS Linux / headless server):** You can't keep a terminal open; run the tunnel detached so it keeps running after you disconnect.

- **Option A — nohup (one-off, may need passwordless sudo):**
  ```bash
  nohup sudo env HOME=/home/ec2-user MINIKUBE_HOME=/home/ec2-user/.minikube KUBECONFIG=/home/ec2-user/.kube/config minikube tunnel >> /tmp/minikube-tunnel.log 2>&1 </dev/null &
  ```
  Replace `/home/ec2-user` with your `$HOME`. Check with `tail -f /tmp/minikube-tunnel.log` and `kubectl get svc -n ingress-nginx ingress-nginx-controller`. If sudo prompts for a password, use Option B or C.

- **Option B — screen (recommended):** Start a detached session, then attach when you need to check logs:
  ```bash
  screen -dmS tunnel sudo env HOME=/home/ec2-user MINIKUBE_HOME=/home/ec2-user/.minikube KUBECONFIG=/home/ec2-user/.kube/config minikube tunnel
  ```
  To view output later: `screen -r tunnel` (detach with Ctrl+A then D). To install screen: `sudo yum install -y screen` (Amazon Linux).

- **Option C — kubectl port-forward (no tunnel):** If tunnel in background is unreliable, use port-forward instead (see "Alternative: HTTPS without minikube tunnel" below). Run in background with nohup:
  ```bash
  nohup sudo env KUBECONFIG=/home/ec2-user/.kube/config kubectl port-forward --address 0.0.0.0 -n ingress-nginx svc/ingress-nginx-controller 80:80 443:443 >> /tmp/pf.log 2>&1 </dev/null &
  ```

2. Get the EXTERNAL-IP:
   ```bash
   kubectl get svc -n ingress-nginx ingress-nginx-controller
   ```
   On EC2, the EXTERNAL-IP is usually the instance's public or private IP.

3. Open **TCP 80** and **TCP 443** in the EC2 security group (inbound from `0.0.0.0/0` or your IP range). You can remove 31379/31466 if you no longer use NodePort.

4. Use the EC2 public hostname over **HTTPS** (no port in URL; TLS is enabled in the Ingress):
   - **Frontend:** `https://ec2-18-118-6-21.us-east-2.compute.amazonaws.com`
   - **API:** On the **same host** at path `/api` (see step 5). The hostname `api.ec2-18-118-6-21.us-east-2.compute.amazonaws.com` **does not resolve** in DNS (AWS does not create it), so the frontend ingress routes `/api` to the backend on the same host. Use **the same URL as the frontend** for `NEXT_PUBLIC_API_URL` (no `api.` subdomain).
   If you use the EC2 hostname, the ingress will serve the default/self-signed certificate — accept the browser warning once, or add a real certificate (e.g. cert-manager with Let's Encrypt) and a TLS secret referenced in `k8s/frontend.yaml` and `k8s/backend-ingress.yaml`.

5. Apply the ingress that routes `/api` to the backend on the same host, then build the frontend with the **same host** as the API URL (so the app calls `https://ec2-.../api/...`, no separate `api.` hostname):
   ```bash
   kubectl apply -k k8s
   docker build --no-cache -t atoms-frontend:latest \
     --build-arg NEXT_PUBLIC_API_URL=https://ec2-18-118-6-21.us-east-2.compute.amazonaws.com \
     ./frontend
   minikube image load atoms-frontend:latest
   kubectl rollout restart deployment/frontend -n atoms-demo
   ```

**If you see ERR_CONNECTION_TIMED_OUT on HTTPS:**

- **Security group:** Inbound rules for the EC2 instance must allow **TCP 443** (and **TCP 80**) from `0.0.0.0/0`. If 443 is missing or restricted, the browser will time out.
- **minikube tunnel must be running:** The tunnel is what routes traffic from the host into the cluster. If it’s not running, nothing on the host will answer on 80/443. On Linux you must run it with **`sudo minikube tunnel`** so it can bind to ports 80/443; otherwise EXTERNAL-IP stays a private address and `curl -k https://127.0.0.1` will get "Connection refused".
- **Check from the EC2 host:** SSH into the instance and run:
  ```bash
  kubectl get svc -n ingress-nginx ingress-nginx-controller   # EXTERNAL-IP should be the host IP, not 10.x
  curl -k -v --connect-timeout 5 https://127.0.0.1
  ```
  If EXTERNAL-IP is a private range (e.g. 10.110.x.x) and `curl` gets "Connection refused", restart the tunnel with **`sudo minikube tunnel`**. If `curl` works locally but the browser times out, the issue is almost certainly the **security group** (443 not allowed from the internet).
- **Try HTTP first:** Open `http://ec2-18-118-6-21.us-east-2.compute.amazonaws.com` (port 80). If HTTP works but HTTPS times out, add or fix the **TCP 443** rule in the security group.

**Alternative: HTTPS without minikube tunnel (kubectl port-forward)**  
If `sudo minikube tunnel` is not an option (e.g. profile not found under root), you can expose the ingress using port-forward. The ingress controller stays **NodePort**; on the EC2 host run (binding to 80/443 requires root):
  ```bash
  sudo env KUBECONFIG=/home/ec2-user/.kube/config kubectl port-forward --address 0.0.0.0 -n ingress-nginx svc/ingress-nginx-controller 80:80 443:443
  ```
  **Use `KUBECONFIG` with sudo** so root can reach the cluster (e.g. `sudo env KUBECONFIG=/home/ec2-user/.kube/config kubectl ...`). Use `--address 0.0.0.0` so the forward is reachable from the internet. Keep it running in the background (e.g. `nohup sudo env KUBECONFIG=/home/ec2-user/.kube/config kubectl port-forward --address 0.0.0.0 -n ingress-nginx svc/ingress-nginx-controller 80:80 443:443 >> /tmp/pf.log 2>&1 </dev/null &`). If the process exits immediately, check `cat /tmp/pf.log` for errors (often "Unable to connect to the server" when KUBECONFIG is not passed to sudo). Then open **https://ec2-18-118-6-21.us-east-2.compute.amazonaws.com** (ensure security group allows TCP 80 and 443). Build frontend with **same host** for API so `/api` is used on the same origin: `NEXT_PUBLIC_API_URL=https://ec2-18-118-6-21.us-east-2.compute.amazonaws.com` (no `api.` subdomain; see step 5 above and `k8s/frontend.yaml` which routes `/api` to the backend).

**Exact steps (when NodePort is on the host, e.g. driver=none):**

1. **Confirm NodePorts** (from repo root on the server):
   ```bash
   kubectl get svc -n ingress-nginx ingress-nginx-controller
   ```
   Note the ports, e.g. **80:31379/TCP** and **443:31466/TCP** → HTTP is **31379**, HTTPS is **31466**.

2. **Set Ingress hosts** in `k8s/frontend.yaml` and `k8s/backend-ingress.yaml` to your EC2 hostname and API hostname (same base, e.g. `ec2-18-118-6-21.us-east-2.compute.amazonaws.com` and `api.ec2-18-118-6-21.us-east-2.compute.amazonaws.com`). Re-apply:
   ```bash
   kubectl apply -k k8s
   ```

3. **Build frontend with API URL including the NodePort** (HTTPS on 31466, or HTTP on 31379). Example for HTTPS API:
   ```bash
   docker build --no-cache -t atoms-frontend:latest \
     --build-arg NEXT_PUBLIC_API_URL=https://api.ec2-18-118-6-21.us-east-2.compute.amazonaws.com:31466 \
     ./frontend
   ```
   For HTTP API use port 31379:
   ```bash
   docker build --no-cache -t atoms-frontend:latest \
     --build-arg NEXT_PUBLIC_API_URL=http://api.ec2-18-118-6-21.us-east-2.compute.amazonaws.com:31379 \
     ./frontend
   ```
   Load and restart:
   ```bash
   minikube image load atoms-frontend:latest
   kubectl rollout restart deployment/frontend -n atoms-demo
   ```

4. **Open AWS security group** for the EC2 instance:
   - Inbound **TCP 31379** (HTTP) from `0.0.0.0/0` (or your IP range).
   - Inbound **TCP 31466** (HTTPS) from `0.0.0.0/0` if using HTTPS.

5. **Access the app** (no DNS required if using the EC2 hostname):
   - **Frontend (HTTP):** `http://ec2-18-118-6-21.us-east-2.compute.amazonaws.com:31379`
   - **Frontend (HTTPS):** `https://ec2-18-118-6-21.us-east-2.compute.amazonaws.com:31466`
   - **API:** same host with `api.` prefix and same port, e.g. `https://api.ec2-18-118-6-21.us-east-2.compute.amazonaws.com:31466`

   If you use a custom domain, point it to the EC2 public IP and include the port in the URL (e.g. `http://your-domain.com:31379`, `https://api.your-domain.com:31466`).

**Summary:** NodePort exposes the ingress on fixed ports; open those ports in the security group and use `<hostname>:31379` (HTTP) or `:31466` (HTTPS). Build the frontend with `NEXT_PUBLIC_API_URL` set to the API hostname **including the same port**.

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
- **Port-forward or local dev:** use `http://localhost:8080` — frontend at localhost:3000, backend at localhost:8080.

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

- **Minikube / local:** Use either:
  1. **minikube tunnel** – Run `minikube tunnel`, get EXTERNAL-IP: `kubectl get svc -n ingress-nginx ingress-nginx-controller`. Add to hosts: `<EXTERNAL-IP> your-domain.com` and `<EXTERNAL-IP> api.your-domain.com`. Open http://your-domain.com.
  2. **Port-forward** – Add `127.0.0.1 your-domain.com` and `127.0.0.1 api.your-domain.com` to hosts, then run `kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 80:80`. Open http://your-domain.com.

- **Minikube on AWS EC2 (NodePort):** If the ingress controller is NodePort (no EXTERNAL-IP), no tunnel needed. Open security group for **31379** (HTTP) and **31466** (HTTPS). Build frontend with `NEXT_PUBLIC_API_URL` including the port (e.g. `https://api.ec2-18-118-6-21.us-east-2.compute.amazonaws.com:31466`). See **Option C → Exposing on AWS EC2 with NodePort** above for exact steps.

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

Without `OPENAI_API_KEY`, agents return fallback mock content. No authentication. Rate limiting is per-IP via Redis.
