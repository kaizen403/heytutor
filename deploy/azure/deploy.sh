#!/usr/bin/env bash
# Idempotent production deploy for the Azure VM backend.
# Run on the server from the repo root: ./deploy/azure/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/apps/tutor/.env.production"
cd "$ROOT"

load_postgres_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE. Copy apps/tutor/.env.example into place before deploying." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  if [ -n "${POSTGRES_USER:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ] && [ -n "${POSTGRES_DB:-}" ]; then
    export POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
    return
  fi

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required in $ENV_FILE." >&2
    exit 1
  fi

  IFS=$'\t' read -r POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB < <(
    DATABASE_URL="$DATABASE_URL" node <<'EOF'
const raw = process.env.DATABASE_URL;
if (!raw) process.exit(1);
const url = new URL(raw.replace(/^postgresql:/, "postgres:"));
process.stdout.write(
  [
    decodeURIComponent(url.username),
    decodeURIComponent(url.password),
    decodeURIComponent(url.pathname.replace(/^\/+/, "")),
  ].join("\t") + "\n",
);
EOF
  )

  export POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
}

echo "==> heytutor deploy @ $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "==> postgres"
load_postgres_env
if docker compose version >/dev/null 2>&1; then
  docker compose up -d postgres
else
  docker-compose up -d postgres
fi

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
