# Deploy

Landing production stays on Vercel (`accelute.co`). Every GitHub deploy
goes through Cloudflare Pages **dev** first (`dev.accelute.co` /
`dev.accelute.pages.dev`), then promotes the same commit to `main`.
The tutor (Next.js UI + API + WebSocket TTS relay) runs as one long-lived
Node process on AWS EC2. There is no split `BACKEND_ORIGIN` proxy.

GitHub requires typecheck, lint, security and payment regressions, disposable
Postgres concurrency tests, and a dependency audit before the dev deploy.
Use the same checks locally before pushing:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm rebuild @prisma/client @prisma/engines esbuild prisma
pnpm --filter @heytutor/tutor exec prisma generate
pnpm check    # typecheck + lint + build
pnpm verify:security
pnpm audit --audit-level low
```

## Architecture

| Target | Platform | Trigger |
|--------|----------|---------|
| Landing staging | Cloudflare Pages project `accelute`, branch `dev`, domain `dev.accelute.co` | First job on every push to `dev` or `main` (and manual `workflow_dispatch`) |
| Landing production | [Vercel](https://vercel.com), domain `accelute.co` | Push to `main` (Vercel Git integration). Cloudflare also publishes the same commit to `accelute.pages.dev` after `dev` succeeds |
| Tutor UI + API + WebSocket | EC2 (`tsx server.ts`) | After the `dev` stage succeeds, GitHub OIDC assumes the restricted AWS deployment role and invokes `AcceluteDeploy` through Systems Manager. Fallback: `./deploy/aws/deploy.sh` on the box |
| Postgres | Hosted (RDS or other). `DATABASE_URL` in `.env.production` | Not on the app box |
| Lecture audio + question photos | Private S3 bucket | See [s3-setup.md](s3-setup.md) |

Do not put Cloudflare’s orange-cloud proxy in front of the tutor: planner SSE
can outlive the ~100s timeout. Grey-cloud DNS (`app.accelute.co` A record to
the Elastic IP) and Caddy on the box for TLS. `dev.accelute.co` is the
exception: that hostname is a Cloudflare Pages alias (orange cloud) for
the landing **dev** stage only.

## Pipeline

Push to `dev` or `main`. The workflow always does this in order:

1. **Security checks** — Node 24 LTS, frozen dependency install with reviewed
   native build scripts, shared package builds, typecheck, lint, security and
   Razorpay checks, isolated loopback Postgres 17 tests, and zero known audit
   advisories. The security database is disposable and never uses production
   credentials. Its empty schema uses `prisma db push` because historical
   migration names do not sort in their original application order. Production
   continues to use `prisma migrate deploy` against its existing history.
2. **Cloudflare Pages (dev)** — build `@heytutor/landing` and
   `wrangler pages deploy --branch=dev`.
3. **Keep `dev` and `main` in sync** — fast-forward both long-lived
   branches to the commit that just passed `dev`. `GITHUB_TOKEN` pushes
   do not re-trigger Actions, so this cannot loop.
4. **Production** — publish the same landing dist to Cloudflare Pages
   `main`, then invoke the restricted `AcceluteDeploy` SSM document with the
   tested 40-character commit SHA. That document fetches the commit, updates
   `/opt/heytutor`, runs `deploy/aws/deploy.sh`, and verifies local health.
   Execution is limited to 40 minutes; Actions polls for at most 250 attempts
   and the whole production job is limited to 50 minutes. Production command
   output stays in AWS Systems Manager rather than Actions logs.

Work on `dev`. Direct pushes to `main` still go through the `dev` Cloudflare
stage before the box is updated. Prefer `dev` so Vercel production is not
racing the staging deploy.

Deploys queue (`cancel-in-progress: false`) so two pushes cannot stomp a
live build. Use **Actions → Deploy → Run workflow** from `dev` or `main`
to deploy without a new commit.

Actions are pinned to reviewed commit SHAs and Wrangler is pinned to the
published `4.146.0` release. Review those pins when applying upstream security
updates. Vercel's Git integration is a separate deployment path: require the
`Security checks` status on `main` and prevent direct pushes that bypass it.

## Backend deploy (on the EC2 box)

```bash
cd /opt/heytutor
git fetch origin main
git reset --hard origin/main
./deploy/aws/deploy.sh
```

`deploy.sh`:

- Requires Node 24 LTS and ffmpeg/ffprobe; install them with the updated setup
  script before upgrading an older host
- Installs deps with scripts disabled, runs the reviewed Prisma/esbuild scripts,
  explicitly generates Prisma, and builds the tutor monorepo slice
- Uses checked-in interface fonts with `next/font/local`; build availability
  does not depend on Google Fonts responses. Sources and licenses are recorded
  in `apps/tutor/public/fonts/variable-fonts.md`.
- Runs `prisma migrate deploy` against `DATABASE_URL`
- Restarts `heytutor.service`; service startup does not run schema migrations

Postgres is not started on this machine.

## One-time setup

### 1. EC2 (first time)

Ubuntu 24.04, `t3.medium` (2 vCPU / 4 GB) in `ap-south-2` (Hyderabad), 40 GB disk, Elastic
IP, security group: `80`/`443` from the world. Systems Manager deployment
requires no inbound SSH. If emergency SSH is retained, restrict port `22` to
the operator's current IP/CIDR. Attach an instance role with Systems Manager
managed-instance access and the S3 policy in [s3-setup.md](s3-setup.md). Point the RDS
security group at this instance, not at `0.0.0.0/0`.

Copy `apps/tutor/.env.example` → `apps/tutor/.env.production` on the box and
fill in production keys **before** the first start. Required:

- `DATABASE_URL` (hosted Postgres)
- `S3_BUCKET` / `AWS_REGION`
- `FIREWORKS_API_KEY`, `ELEVENLABS_API_KEY`
- `AUTH_SECRET`
- Google OAuth: follow [google-oauth.md](google-oauth.md), then set
  `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. Login is on in production even
  if `AUTH_REQUIRED` is unset; do not set `AUTH_DISABLED`.
- `NEXT_PUBLIC_SITE_URL=https://app.accelute.co`
- `NEXT_PUBLIC_LANDING_URL=https://accelute.co`
- `AUTH_URL=https://app.accelute.co`
- `WS_TICKET_SECRET`

Leave `BACKEND_ORIGIN`, `NEXT_PUBLIC_API_ORIGIN`, and `NEXT_PUBLIC_WS_ORIGIN`
unset. Do not set `AUTH_DEV_LOGIN`.

Sentry project `personal-9bo/heytutor` receives crashes and logs. Set
`NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` in `.env.production` before the
build. The public DSN is baked into the browser bundle, so changing it needs
a rebuild. Warn, error, and `[http]` access lines are logs. Lines starting
with `[tutor:` stay on the machine because they include the question. Source
maps upload when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are
set. A missing token does not fail the build. `SENTRY_ENABLED=0` stops the
server SDK on the next process start.

Because `setup-vm.sh` and `deploy.sh` `source` `.env.production`, keep it
shell-compatible: quote values that contain `#`, spaces, or other
shell-significant characters.

```bash
sudo ./deploy/aws/setup-vm.sh app.accelute.co https://github.com/kaizen403/heytutor.git
```

`setup-vm.sh` installs Node 24 LTS, pnpm, Caddy 2.10 or newer, AWS CLI,
ffmpeg (including ffprobe), and `postgresql-client`
(for nightly dumps). It does not install Docker and does not start Postgres.

DNS: Cloudflare A record for `app.accelute.co`, **DNS only** (grey cloud), to
the Elastic IP. Caddy then issues Let’s Encrypt.

Health: `https://app.accelute.co/api/health` must return `{ "ok": true, "db": true }`.

The tutor systemd service runs as `heytutor` with `LISTEN_HOST=127.0.0.1` and
`HOSTNAME=app.accelute.co`; only Caddy accepts public connections. Caddy retains
HSTS, nosniff, referrer and permissions headers and forwards the application's
per-response nonce CSP unchanged. Its request-body limits are 512 KiB by
default, 36 MiB for `/api/boards/*/turns`, 11 MiB for `/api/stt`, and 12 MiB for
`/api/extract-question`. App validation still enforces the tighter content,
duration and storage limits. Validate Caddy before reload. Re-run setup to
apply the updated proxy policy to an existing machine; updating the checkout
alone does not replace `/etc/caddy/Caddyfile`.

Node 20 reached end of life on 30 April 2026. Node 24 is the supported LTS
deployment line. See the [official release schedule](https://github.com/nodejs/Release#release-schedule)
and [Caddy request_body documentation](https://caddyserver.com/docs/caddyfile/directives/request_body).

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

Repository or `production` environment variables:

| Variable | Value |
|----------|--------|
| `CLOUDFLARE_ACCOUNT_ID` | `37fe66534312238914af0ff34d128ac3` |
| `AWS_DEPLOY_ROLE_ARN` | Restricted GitHub production OIDC deployment role |
| `AWS_TUTOR_INSTANCE_ID` | The one production EC2 managed-instance ID |

Before enabling the production workflow, provision and verify:

- GitHub OIDC trust with audience `sts.amazonaws.com` and exact subject
  `repo:kaizen403/heytutor:environment:production`. Restrict the production
  environment to the `dev` and `main` branches.
- The deployment role may send commands only to `AcceluteDeploy` on the one
  production instance, and may read that command's status. It must not update
  the document or invoke `AWS-RunShellScript`.
- `AcceluteDeploy` accepts only a `Commit` parameter with the allowed pattern
  `^[0-9a-f]{40}$`. Use SSM's environment-variable parameter interpolation,
  a fixed deployment script, and a 2400-second execution timeout. Do not
  accept arbitrary shell commands or paths.
- The EC2 Systems Manager agent and instance role work before removing broad
  SSH access. Verify an operator recovery session first.

The checked-in document is [ssm-deploy-document.json](../../deploy/aws/ssm-deploy-document.json);
its fixed entry point is [ssm-deploy.sh](../../deploy/aws/ssm-deploy.sh).
The entry point rejects positional arguments, invalid SHA values, an unexpected
Git origin, and commits that are not the current `origin/main` or `origin/dev`
head. Git runs as the fixed `ubuntu` checkout owner so its credential helper
and repository ownership checks remain intact. An older commit needs a
separately reviewed rollback procedure.

See the [official OIDC action guidance](https://github.com/aws-actions/configure-aws-credentials#oidc)
and [SSM parameter interpolation guidance](https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-command-ssm-plugin-reference.html).
These repository templates do not provision IAM, GitHub environment rules,
the SSM document, or the security-group change by themselves.

The box must already be able to `git fetch` `main` and `dev` (deploy key or
HTTPS token if the repo is private). `.env.production` stays on disk; do not
put it in GitHub secrets. Emergency fallback: use a Systems Manager session
or operator-only SSH and run
`./deploy/aws/deploy.sh`.
