# CI/CD

HeyTutor uses **GitHub Actions** for validation and deployment.

## Architecture

| Target | Platform | Trigger |
|--------|----------|---------|
| Tutor frontend (Next.js) | [Vercel](https://vercel.com) | Push to `main` / PR previews (Vercel Git integration) |
| Tutor API + WebSocket + TTS relay | Azure VM | Push to `main` (paths below) or manual workflow |
| Landing site | Vercel | Same as tutor (separate Vercel project, root `apps/landing`) |

## Workflows

### `CI` (`.github/workflows/ci.yml`)

Runs on every push and pull request to `main`:

1. `pnpm install --frozen-lockfile`
2. `prisma validate`
3. `pnpm typecheck`
4. `pnpm lint`
5. `pnpm build`
6. Docker image build smoke test (`deploy/azure/Dockerfile`)

### `Deploy Backend (Azure)` (`.github/workflows/deploy-backend.yml`)

Runs when backend-related paths change on `main`, or manually from **Actions → Deploy Backend (Azure) → Run workflow**.

On the VM it runs `deploy/azure/deploy.sh`:

- Starts Postgres via Docker Compose
- Installs deps, builds the tutor monorepo slice
- Runs `prisma migrate deploy`
- Restarts `heytutor.service`

## One-time setup

### 1. GitHub secrets (Settings → Secrets and variables → Actions)

| Secret | Description |
|--------|-------------|
| `AZURE_DEPLOY_HOST` | VM public IP or hostname |
| `AZURE_DEPLOY_USER` | SSH user (e.g. `azureuser` or `root`) |
| `AZURE_DEPLOY_SSH_KEY` | Private key (PEM) for that user |

The repo is expected at `/opt/heytutor` on the VM (see `deploy/azure/setup-vm.sh`).

### 2. GitHub environment

Create an environment named **`production`** (Settings → Environments) and optionally require approval before backend deploys.

### 3. Azure VM (first time)

```bash
sudo ./deploy/azure/setup-vm.sh <PUBLIC_IP> https://github.com/kaizen403/heytutor.git
```

Copy `apps/tutor/.env.example` → `apps/tutor/.env.production` on the VM and fill in production keys.

Ensure the VM can `git pull` from GitHub (deploy key or public clone).

### 4. Vercel (frontend)

Connect the GitHub repo in Vercel with:

| Project | Root Directory | Build Command |
|---------|----------------|---------------|
| tutor | `apps/tutor` | (uses `vercel.json`) |
| landing | `apps/landing` | default Vite build |

Set production env vars in Vercel (see `apps/tutor/.env.example`). Point `BACKEND_ORIGIN` / `NEXT_PUBLIC_*` at your Azure API URL.

Vercel deploys automatically on push; no GitHub deploy workflow required for the frontend.

## Local commands (same as CI)

```bash
pnpm install --frozen-lockfile
pnpm check    # typecheck + lint + build (same gates as CI)
```

## Manual backend deploy (on VM)

```bash
cd /opt/heytutor
git pull origin main
./deploy/azure/deploy.sh
```

## Branch protection (recommended)

On `main`:

- Require **CI / Lint, typecheck, build** to pass before merge
- Optionally require **CI / Build backend Docker image**
