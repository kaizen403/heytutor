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

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required in $ENV_FILE." >&2
  exit 1
fi

echo "==> heytutor deploy @ $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "==> install"
export CI=true
corepack enable
corepack prepare pnpm@10.32.0 --activate
pnpm install --frozen-lockfile

echo "==> build tutor stack"
pnpm turbo run build --filter=@heytutor/tutor...

echo "==> migrate"
cd apps/tutor
pnpm exec prisma migrate deploy
cd "$ROOT"

if ! sudo id heytutor >/dev/null 2>&1 && ! id heytutor >/dev/null 2>&1; then
  echo "==> create system user heytutor"
  sudo useradd --system --home-dir /var/lib/heytutor --create-home --shell /usr/sbin/nologin heytutor
fi
sudo mkdir -p /var/lib/heytutor
sudo chown heytutor:heytutor /var/lib/heytutor
sudo chgrp heytutor "$ENV_FILE"
sudo chmod 640 "$ENV_FILE"
sudo mkdir -p "$ROOT/apps/tutor/.next/cache"
sudo chgrp -R heytutor "$ROOT/apps/tutor/.next"
sudo chmod -R g+rwX "$ROOT/apps/tutor/.next"

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
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/bash -lc 'cd apps/tutor && pnpm exec prisma migrate deploy && NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 pnpm exec tsx server.ts'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
fi

if sudo systemctl is-active --quiet heytutor 2>/dev/null; then
  echo "==> restart heytutor.service"
  sudo systemctl restart heytutor
else
  echo "==> heytutor.service not installed — start manually or run setup-vm.sh"
fi

echo "==> deploy complete"
