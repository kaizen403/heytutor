# Deploy

Landing production stays on Vercel (`accelute.co`). Every GitHub deploy
goes through Cloudflare Pages **dev** first (`dev.accelute.co` /
`dev.accelute.pages.dev`), then promotes the same commit to `main`.
The tutor (Next.js UI + API + WebSocket TTS relay) runs as one long-lived
Node process on AWS EC2. There is no split `BACKEND_ORIGIN` proxy.

GitHub does not run typecheck, lint, or tests. Validate locally if you want
those checks before pushing:

```bash
pnpm install --frozen-lockfile
pnpm check    # typecheck + lint + build
```

## Architecture

| Target | Platform | Trigger |
|--------|----------|---------|
| Landing staging | Cloudflare Pages project `accelute`, branch `dev`, domain `dev.accelute.co` | First job on every push to `dev` or `main` (and manual `workflow_dispatch`) |
| Landing production | [Vercel](https://vercel.com), domain `accelute.co` | Push to `main` (Vercel Git integration). Cloudflare also publishes the same commit to `accelute.pages.dev` after `dev` succeeds |
| Tutor UI + API + WebSocket | EC2 (`tsx server.ts`) | After the `dev` stage succeeds, `.github/workflows/deploy-tutor.yml` SSHs to the box. Fallback: `./deploy/aws/deploy.sh` on the box |
| Postgres | Hosted (RDS or other). `DATABASE_URL` in `.env.production` | Not on the app box |
| Lecture audio + question photos | Private S3 bucket | See [s3-setup.md](s3-setup.md) |

Do not put Cloudflare’s orange-cloud proxy in front of the tutor: planner SSE
can outlive the ~100s timeout. Grey-cloud DNS (`app.accelute.co` A record to
the Elastic IP) and Caddy on the box for TLS. `dev.accelute.co` is the
exception: that hostname is a Cloudflare Pages alias (orange cloud) for
the landing **dev** stage only.

## Pipeline

Push to `dev` or `main`. The workflow always does this in order:

1. **Cloudflare Pages (dev)** — build `@heytutor/landing` and
   `wrangler pages deploy --branch=dev`.
2. **Keep `dev` and `main` in sync** — fast-forward both long-lived
   branches to the commit that just passed `dev`. `GITHUB_TOKEN` pushes
   do not re-trigger Actions, so this cannot loop.
3. **Production** — publish the same landing dist to Cloudflare Pages
   `main`, then SSH to `/opt/heytutor`, `git reset --hard` that SHA, and
   run `deploy.sh`. The job waits until `http://127.0.0.1:3000/api/health`
   returns `"ok":true`.

Work on `dev`. Direct pushes to `main` still go through the `dev` Cloudflare
stage before the box is updated. Prefer `dev` so Vercel production is not
racing the staging deploy.

Deploys queue (`cancel-in-progress: false`) so two pushes cannot stomp a
live build. Use **Actions → Deploy → Run workflow** from `dev` or `main`
to deploy without a new commit.

## Why deploys failed before

| Failure | Cause | Fix |
|---------|--------|-----|
| `TUTOR_DEPLOY_* is not set` | The workflow required new secret names that were not on the repo yet | `TUTOR_DEPLOY_HOST` / `USER` / `SSH_KEY` are set. The job no longer falls back to `AZURE_DEPLOY_*` (that host timed out on port 22) |
| `dial tcp *:22: i/o timeout` | Azure fallback SSHed to a dead host | Require `TUTOR_DEPLOY_*` only; SSH connect timeout is 60s |
| `@heytutor/tutor#build` ESLint `set-state-in-effect` | `next build` on the box ran lint and exited 1 | The hook was rewritten; `next.config.ts` also ignores ESLint during production builds so a lint rule cannot block a restart |

## Backend deploy (on the EC2 box)

```bash
cd /opt/heytutor
git fetch origin main
git reset --hard origin/main
./deploy/aws/deploy.sh
```

`deploy.sh`:

- Installs deps and builds the tutor monorepo slice
- Runs `prisma migrate deploy` against `DATABASE_URL`
- Restarts `heytutor.service`

Postgres is not started on this machine.

## One-time setup

### 1. EC2 (first time)

Ubuntu 24.04, `t3.medium` (2 vCPU / 4 GB) in `ap-south-2` (Hyderabad), 40 GB disk, Elastic
IP, security group: `22` key-only (GitHub-hosted runners must be able to connect;
`0.0.0.0/0` is the simple option), `80`/`443` from the world. Attach an
instance role with the S3 policy in [s3-setup.md](s3-setup.md). Point the RDS
security group at this instance, not at `0.0.0.0/0`.

Copy `apps/tutor/.env.example` → `apps/tutor/.env.production` on the box and
fill in production keys **before** the first start. Required:

- `DATABASE_URL` (hosted Postgres)
- `S3_BUCKET` / `AWS_REGION`
- `FIREWORKS_API_KEY`, `ELEVENLABS_API_KEY`
- `AUTH_SECRET`
- Google OAuth: follow [google-oauth.md](google-oauth.md), then set
  `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. Keep `AUTH_REQUIRED` off until
  those are on the box.
- `NEXT_PUBLIC_SITE_URL=https://app.accelute.co`
- `NEXT_PUBLIC_LANDING_URL=https://accelute.co`
- `AUTH_URL=https://app.accelute.co`
- `WS_TICKET_SECRET`

Leave `BACKEND_ORIGIN`, `NEXT_PUBLIC_API_ORIGIN`, and `NEXT_PUBLIC_WS_ORIGIN`
unset. Do not set `AUTH_DEV_LOGIN`.

Because `setup-vm.sh` and `deploy.sh` `source` `.env.production`, keep it
shell-compatible: quote values that contain `#`, spaces, or other
shell-significant characters.

```bash
sudo ./deploy/aws/setup-vm.sh app.accelute.co https://github.com/kaizen403/heytutor.git
```

`setup-vm.sh` installs Node 20, pnpm, Caddy, AWS CLI, and `postgresql-client`
(for nightly dumps). It does not install Docker and does not start Postgres.

DNS: Cloudflare A record for `app.accelute.co`, **DNS only** (grey cloud), to
the Elastic IP. Caddy then issues Let’s Encrypt.

Health: `https://app.accelute.co/api/health` must return `{ "ok": true, "db": true }`.

### 2. Vercel (landing production)

The landing project root is `apps/landing`. After the tutor hostname resolves,
set `VITE_TUTOR_ORIGIN=https://app.accelute.co` on that Vercel project (the
repo default is already `https://app.accelute.co`). `/app` redirects go to
the same origin.

The Vercel tutor project at `heytutor.vercel.app` is not the production app.
Pause it or redirect it once `app.accelute.co` is live.

### 3. Cloudflare Pages (landing dev)

Project name: `accelute`. Production branch in the Pages project is `main`.
The GitHub job always publishes `dev` first.

- Preview alias: `https://dev.accelute.pages.dev`
- Custom domain: `https://dev.accelute.co` (CNAME to `dev.accelute.pages.dev`,
  **proxied** so the branch alias works)

Do not point `accelute.co` at this Pages project while Vercel still serves
production.

### 4. GitHub deploy

Repo secrets (the job **fails** if any are missing):

| Secret | Value |
|--------|--------|
| `CLOUDFLARE_API_TOKEN` | Account token with **Cloudflare Pages:Edit** (and **Zone DNS:Edit** on `accelute.co` if CI should manage the `dev` hostname) |
| `TUTOR_DEPLOY_HOST` | Elastic IP or `app.accelute.co` |
| `TUTOR_DEPLOY_USER` | SSH user (`ubuntu` or `root`) |
| `TUTOR_DEPLOY_SSH_KEY` | Dedicated passphrase-less private key that can `git reset` and run `deploy.sh` in `/opt/heytutor` |

Repo variable:

| Variable | Value |
|----------|--------|
| `CLOUDFLARE_ACCOUNT_ID` | `37fe66534312238914af0ff34d128ac3` |

The box must already be able to `git fetch` `main` and `dev` (deploy key or
HTTPS token if the repo is private). `.env.production` stays on disk; do not
put it in GitHub secrets. Emergency fallback: SSH in and run
`./deploy/aws/deploy.sh`.
