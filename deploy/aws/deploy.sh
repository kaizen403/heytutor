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

if sudo systemctl is-active --quiet heytutor 2>/dev/null; then
  echo "==> restart heytutor.service"
  sudo systemctl restart heytutor
else
  echo "==> heytutor.service not installed — start manually or run setup-vm.sh"
fi

echo "==> deploy complete"
