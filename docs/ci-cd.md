# Deploy

HeyTutor has **no CI**: the GitHub Actions workflows were removed and `main`
has no required status checks. Validate locally before pushing:

```bash
pnpm install --frozen-lockfile
pnpm check    # typecheck + lint + build
```

## Architecture

| Target | Platform | Trigger |
|--------|----------|---------|
| Tutor frontend (Next.js) | [Vercel](https://vercel.com) | Push to `main` / PR previews (Vercel Git integration) |
| Tutor API + WebSocket + TTS relay | Azure VM | Manual deploy (below) |
| Landing site | Vercel | Same as tutor (separate Vercel project, root `apps/landing`) |

## Backend deploy (manual, on VM)

```bash
cd /opt/heytutor
git pull origin main
./deploy/azure/deploy.sh
```

`deploy.sh`:

- Starts Postgres via Docker Compose on `127.0.0.1:5433`, with container credentials loaded from `apps/tutor/.env.production` (or derived from its `DATABASE_URL`)
- Installs deps, builds the tutor monorepo slice
- Runs `prisma migrate deploy`
- Restarts `heytutor.service`

## One-time setup

### 1. Azure VM (first time)

```bash
sudo ./deploy/azure/setup-vm.sh <PUBLIC_IP> https://github.com/kaizen403/heytutor.git
```

Copy `apps/tutor/.env.example` → `apps/tutor/.env.production` on the VM and fill in production keys before the first successful backend deploy. `setup-vm.sh` and `deploy.sh` now require that file so they can inject the Postgres container credentials instead of falling back to repository-known defaults.

Because both scripts `source` `.env.production`, keep it shell-compatible: quote values that contain `#`, spaces, or other shell-significant characters. A quoted `DATABASE_URL` is supported and its username/password/database pieces are decoded before being passed into Docker Compose.

Ensure the VM can `git pull` from GitHub (deploy key or public clone).

### 2. Vercel (frontend)

Connect the GitHub repo in Vercel with:

| Project | Root Directory | Build Command |
|---------|----------------|---------------|
| tutor | `apps/tutor` | (uses `vercel.json`) |
| landing | `apps/landing` | default Vite build |

Set production env vars in Vercel:

- Tutor project: see `apps/tutor/.env.example`. Point `BACKEND_ORIGIN` / `NEXT_PUBLIC_*` at your Azure API URL.
- Landing project: set `VITE_TUTOR_ORIGIN` to the public tutor deployment URL if you are not using the default `https://heytutor.vercel.app` domain.

Vercel deploys automatically on push; no GitHub deploy workflow required for the frontend.
