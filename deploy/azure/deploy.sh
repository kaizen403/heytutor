#!/usr/bin/env bash
# Idempotent production deploy for the Azure VM backend.
# Run on the server from the repo root: ./deploy/azure/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> heytutor deploy @ $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "==> postgres"
docker compose up -d postgres

echo "==> install"
corepack enable
corepack prepare pnpm@10.32.0 --activate
pnpm install --frozen-lockfile

echo "==> build tutor stack"
pnpm turbo run build --filter=@heytutor/tutor...

echo "==> migrate"
cd apps/tutor
pnpm exec prisma migrate deploy
cd "$ROOT"

if systemctl is-active --quiet heytutor 2>/dev/null; then
  echo "==> restart heytutor.service"
  systemctl restart heytutor
else
  echo "==> heytutor.service not installed — start manually or run setup-vm.sh"
fi

echo "==> deploy complete"
