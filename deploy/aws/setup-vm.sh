#!/usr/bin/env bash
set -euo pipefail

# Run on Ubuntu 24.04 EC2 as root (or with sudo).
# Usage: sudo ./setup-vm.sh <hostname> [git-repo-url]
# Example: sudo ./setup-vm.sh app.accelute.co https://github.com/kaizen403/heytutor.git
#
# Postgres is NOT started here. Put DATABASE_URL (RDS or other hosted
# Postgres) in apps/tutor/.env.production before the first successful start.

HOSTNAME_FQDN="${1:?hostname required (e.g. app.accelute.co)}"
REPO_URL="${2:-https://github.com/kaizen403/heytutor.git}"
APP_DIR="/opt/heytutor"
ENV_FILE="${APP_DIR}/apps/tutor/.env.production"

require_database_url() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing ${ENV_FILE}. Copy apps/tutor/.env.example there, set DATABASE_URL, then rerun setup-vm.sh." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required in ${ENV_FILE}." >&2
    exit 1
  fi
}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gnupg postgresql-client unzip ffmpeg
ffmpeg -version >/dev/null
ffprobe -version >/dev/null

if ! command -v aws >/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi

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
  chown ubuntu:ubuntu "$APP_DIR"
  sudo -H -u ubuntu env GIT_TERMINAL_PROMPT=0 git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
sudo -H -u ubuntu env GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" pull --ff-only

require_database_url

if ! id heytutor >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/heytutor --create-home --shell /usr/sbin/nologin heytutor
fi
mkdir -p /var/lib/heytutor
chown heytutor:heytutor /var/lib/heytutor
# The service can read its checkout without making private env files public.
chgrp -R heytutor "$APP_DIR"
chmod -R g+rX "$APP_DIR"
chmod 750 "$APP_DIR"
if [ -f "$ENV_FILE" ]; then
  chgrp heytutor "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi

cat > /etc/caddy/Caddyfile <<EOF
${HOSTNAME_FQDN} {
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
After=network.target

[Service]
Type=simple
User=heytutor
Group=heytutor
NoNewPrivileges=true
WorkingDirectory=${APP_DIR}
Environment=HOME=/var/lib/heytutor
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=${APP_DIR}/apps/tutor/.env.production
ExecStart=/usr/bin/bash -lc 'cd apps/tutor && NODE_ENV=production HOSTNAME=${HOSTNAME_FQDN} LISTEN_HOST=127.0.0.1 PORT=3000 pnpm exec tsx server.ts'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/cron.d/heytutor-backup <<EOF
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * heytutor ${APP_DIR}/deploy/aws/backup-postgres.sh >> /var/log/heytutor-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/heytutor-backup
touch /var/log/heytutor-backup.log
chown heytutor:heytutor /var/log/heytutor-backup.log

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

echo "Tutor URL: https://${HOSTNAME_FQDN}"
echo "Health:    https://${HOSTNAME_FQDN}/api/health"
