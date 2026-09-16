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
apt-get install -y ca-certificates curl git gnupg postgresql-client unzip

if ! command -v aws >/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi

if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

corepack enable
corepack prepare pnpm@10.32.0 --activate

if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
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

require_database_url

cat > /etc/caddy/Caddyfile <<EOF
${HOSTNAME_FQDN} {
  reverse_proxy 127.0.0.1:3000
}
EOF

systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

cat > /etc/systemd/system/heytutor.service <<EOF
[Unit]
Description=HeyTutor API server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/apps/tutor/.env.production
ExecStart=/usr/bin/bash -lc 'cd apps/tutor && pnpm exec prisma migrate deploy && NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 pnpm exec tsx server.ts'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/cron.d/heytutor-backup <<EOF
0 3 * * * root ${APP_DIR}/deploy/aws/backup-postgres.sh >> /var/log/heytutor-backup.log 2>&1
EOF

pnpm install --frozen-lockfile
pnpm turbo run build --filter=@heytutor/tutor...

systemctl daemon-reload
systemctl enable heytutor
systemctl restart heytutor

echo "Tutor URL: https://${HOSTNAME_FQDN}"
echo "Health:    https://${HOSTNAME_FQDN}/api/health"
