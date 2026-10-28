#!/usr/bin/env bash
# Idempotent production deploy for the AWS EC2 tutor.
# Run on the server from the repo root: ./deploy/aws/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/apps/tutor/.env.production"
cd "$ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy apps/tutor/.env.example into place before deploying." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Stamp both build-time artifacts and the service's EnvironmentFile with the
# deployed commit. Do not reuse a release left behind by an earlier deploy.
# SSM runs this script as root, but Git trusts the ubuntu-owned checkout only
# when read as its owner. Keep Git credentials and ownership checks in that lane.
SENTRY_RELEASE="$(sudo -H -u ubuntu env GIT_TERMINAL_PROMPT=0 git -C "$ROOT" rev-parse HEAD)"
export SENTRY_RELEASE
# Explicit production-only opt-in. Local and lab servers leave this unset.
export SENTRY_ENVIRONMENT=production
export NEXT_PUBLIC_SENTRY_ENVIRONMENT=production

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required in $ENV_FILE." >&2
  exit 1
fi

echo "==> heytutor deploy @ ${SENTRY_RELEASE:0:7}"

if [ "$(node -p 'process.versions.node.split(".")[0]')" != "24" ]; then
  echo "Node 24 LTS is required. Run the updated deploy/aws/setup-vm.sh before deployment." >&2
  exit 1
fi
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null

echo "==> install"
export CI=true
corepack enable
corepack prepare pnpm@10.32.0 --activate
pnpm install --frozen-lockfile --ignore-scripts
pnpm rebuild @prisma/client @prisma/engines esbuild prisma
# Generate before typechecking/building against newly added schema models.
pnpm --filter @heytutor/tutor exec prisma generate

echo "==> build tutor stack"
# Shared packages through turbo. The tutor itself is built outside turbo, into
# the release directory that is not live (deploy/aws/tutor-release.sh), so the
# live .next is never written while it serves. Outside turbo it also sees the
# SENTRY_RELEASE exported above: turbo 2's strict env mode drops it, and
# next build then took the previous deploy's stamp from .env.production
# (/api/version and the stale tab check ran one deploy behind).
pnpm turbo run build --filter=@heytutor/tutor^...
# shellcheck source=deploy/aws/tutor-release.sh
source "$ROOT/deploy/aws/tutor-release.sh"
TUTOR_DIR="$ROOT/apps/tutor"
TUTOR_RELEASE="$(tutor_inactive_release "$TUTOR_DIR")"
echo "==> build tutor into $TUTOR_RELEASE (live build untouched)"
tutor_build_release "$TUTOR_DIR" "$TUTOR_RELEASE"

echo "==> migrate"
cd apps/tutor
pnpm exec tsx scripts/live/deploy-migrations.ts
cd "$ROOT"

if ! sudo id heytutor >/dev/null 2>&1 && ! id heytutor >/dev/null 2>&1; then
  echo "==> create system user heytutor"
  sudo useradd --system --home-dir /var/lib/heytutor --create-home --shell /usr/sbin/nologin heytutor
fi
sudo mkdir -p /var/lib/heytutor
sudo chown heytutor:heytutor /var/lib/heytutor
sudo chgrp -R heytutor "$ROOT"
sudo chmod -R g+rX "$ROOT"
sudo chmod 750 "$ROOT"
sudo chgrp heytutor "$ENV_FILE"
sudo chmod 640 "$ENV_FILE"
sudo mkdir -p "$TUTOR_DIR/$TUTOR_RELEASE/cache"
sudo chgrp -R heytutor "$TUTOR_DIR/$TUTOR_RELEASE"
sudo chmod -R g+rwX "$TUTOR_DIR/$TUTOR_RELEASE"

if [ -f /etc/systemd/system/heytutor.service ]; then
  echo "==> run heytutor.service as heytutor"
  sudo tee /etc/systemd/system/heytutor.service >/dev/null <<EOF
[Unit]
Description=HeyTutor API server
After=network.target

[Service]
Type=simple
User=heytutor
Group=heytutor
NoNewPrivileges=true
WorkingDirectory=${ROOT}
Environment=HOME=/var/lib/heytutor
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/bash -lc 'cd apps/tutor && NODE_ENV=production HOSTNAME=app.accelute.co LISTEN_HOST=127.0.0.1 PORT=3000 exec node --import tsx server.ts'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
fi

# Before the switch, so requests during this deploy's stop and start wait for
# the new server instead of failing. Does nothing once applied.
sudo bash "$ROOT/deploy/aws/caddy-hold-restarts.sh" ||
  echo "WARNING: caddy-hold-restarts.sh failed; requests during this restart may see 502." >&2

if [ -f /etc/systemd/system/heytutor.service ]; then
  echo "==> switch heytutor.service to $TUTOR_RELEASE"
  sudo node "$ROOT/deploy/aws/set-sentry-release.mjs" "$ENV_FILE" "$SENTRY_RELEASE"
  sudo systemctl reset-failed heytutor || true
  # Stop drains the old server on its own build (up to 60 s), then the live
  # link moves and the new server starts on the new build. A failed switch
  # starts the old build again and fails the deploy.
  tutor_switch_release "$TUTOR_DIR" "$TUTOR_RELEASE"
else
  tutor_activate_release "$TUTOR_DIR" "$TUTOR_RELEASE"
  echo "==> heytutor.service not installed; start manually or run setup-vm.sh"
fi

echo "==> deploy complete"
