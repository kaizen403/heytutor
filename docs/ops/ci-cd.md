# Deploy

Landing stays on Vercel. The tutor (Next.js UI + API + WebSocket TTS relay)
runs as one long-lived Node process on AWS EC2. There is no split
`BACKEND_ORIGIN` proxy.

Validate locally before pushing:

```bash
pnpm install --frozen-lockfile
pnpm check    # typecheck + lint + build
```

## Architecture

| Target | Platform | Trigger |
|--------|----------|---------|
| Landing site | [Vercel](https://vercel.com), domain `accelute.co` | Push to `main` (Vercel Git integration) |
| Tutor UI + API + WebSocket | EC2 (`tsx server.ts`) | Push to `main` via `.github/workflows/deploy-tutor.yml`, or `./deploy/aws/deploy.sh` on the box |
| Postgres | Hosted (RDS or other). `DATABASE_URL` in `.env.production` | Not on the app box |
| Lecture audio + question photos | Private S3 bucket | See [s3-setup.md](s3-setup.md) |

Do not put Cloudflare’s orange-cloud proxy in front of the tutor: planner SSE
can outlive the ~100s timeout. Grey-cloud DNS (`app.accelute.co` A record to
the Elastic IP) and Caddy on the box for TLS.

## Backend deploy (on the EC2 box)

```bash
cd /opt/heytutor
git pull origin main
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
IP, security group: `22` from your IP, `80`/`443` from the world. Attach an
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

### 2. Vercel (landing only)

The landing project root is `apps/landing`. After the tutor hostname resolves,
set `VITE_TUTOR_ORIGIN=https://app.accelute.co` on that Vercel project (the
repo default is already `https://app.accelute.co`). `/app` redirects go to the
same origin.

The Vercel tutor project at `heytutor.vercel.app` is not the production app.
Pause it or redirect it once `app.accelute.co` is live.

### 3. GitHub deploy

Repo secrets for `.github/workflows/deploy-tutor.yml`:

| Secret | Value |
|--------|--------|
| `TUTOR_DEPLOY_HOST` | Elastic IP or `app.accelute.co` |
| `TUTOR_DEPLOY_USER` | SSH user (`ubuntu` or `root`) |
| `TUTOR_DEPLOY_SSH_KEY` | Private key that can `git reset` and run `deploy.sh` in `/opt/heytutor` |

The workflow is a no-op until `TUTOR_DEPLOY_HOST` is set.
