#!/usr/bin/env bash
set -euo pipefail

# Run on Ubuntu 24.04 Azure VM as root (or with sudo).
# Usage: sudo ./setup-vm.sh <public-ip> <git-repo-url>

PUBLIC_IP="${1:?public IP required}"
REPO_URL="${2:-https://github.com/kaizen403/heytutor.git}"
APP_DIR="/opt/heytutor"
SSLIP_HOST="${PUBLIC_IP//./-}.sslip.io"
ENV_FILE="${APP_DIR}/apps/tutor/.env.production"

load_postgres_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing ${ENV_FILE}. Copy apps/tutor/.env.example there, set DATABASE_URL, then rerun setup-vm.sh." >&2
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
    echo "DATABASE_URL is required in ${ENV_FILE}." >&2
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

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gnupg docker.io docker-compose-plugin ffmpeg
ffmpeg -version >/dev/null
ffprobe -version >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

corepack enable
corepack prepare pnpm@10.32.0 --activate

if ! command -v caddy >/dev/null || ! dpkg --compare-versions "$(caddy version | awk '{print $1}' | sed 's/^v//')" ge 2.10.0; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

mkdir -p "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git pull --ff-only

load_postgres_env
docker compose up -d postgres

if ! id heytutor >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/heytutor --create-home --shell /usr/sbin/nologin heytutor
fi
mkdir -p /var/lib/heytutor
chown heytutor:heytutor /var/lib/heytutor
chgrp -R heytutor "$APP_DIR"
chmod -R g+rX "$APP_DIR"
chmod 750 "$APP_DIR"
if [ -f "$ENV_FILE" ]; then
  chgrp heytutor "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi

cat > /etc/caddy/Caddyfile <<EOF
${SSLIP_HOST} {
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    Permissions-Policy "camera=(), geolocation=(), microphone=(self), payment=(), usb=()"
  }
  # Next.js owns the per-response nonce CSP. Do not replace it in the proxy.
  @turn_upload path /api/boards/*/turns
  @speech_upload path /api/stt
  @question_upload path /api/extract-question
  @small_body not path /api/boards/*/turns /api/stt /api/extract-question
  request_body @turn_upload {
    max_size 36MiB
  }
  request_body @speech_upload {
    max_size 11MiB
  }
  request_body @question_upload {
    max_size 12MiB
  }
  request_body @small_body {
    max_size 512KiB
  }
  reverse_proxy 127.0.0.1:3000
}
EOF

caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

cat > /etc/systemd/system/heytutor.service <<EOF
[Unit]
Description=HeyTutor API server
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=heytutor
Group=heytutor
NoNewPrivileges=true
WorkingDirectory=${APP_DIR}
Environment=HOME=/var/lib/heytutor
EnvironmentFile=${APP_DIR}/apps/tutor/.env.production
ExecStart=/usr/bin/bash -lc 'cd apps/tutor && NODE_ENV=production HOSTNAME=${SSLIP_HOST} LISTEN_HOST=127.0.0.1 PORT=3000 pnpm exec tsx server.ts'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

pnpm install --frozen-lockfile --ignore-scripts
pnpm rebuild @prisma/client @prisma/engines esbuild prisma
pnpm --filter @heytutor/tutor exec prisma generate
pnpm turbo run build --filter=@heytutor/tutor...
pnpm --filter @heytutor/tutor exec prisma migrate deploy
mkdir -p "${APP_DIR}/apps/tutor/.next/cache"
chgrp -R heytutor "${APP_DIR}/apps/tutor/.next"
chmod -R g+rwX "${APP_DIR}/apps/tutor/.next"

systemctl daemon-reload
systemctl enable heytutor
systemctl restart heytutor

echo "Backend URL: https://${SSLIP_HOST}"
