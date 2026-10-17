#!/usr/bin/env bash
# Build a new release without changing the checkout or artifacts serving traffic.
# Called by the trusted Commit-only SSM entry point (or setup-vm.sh).
set -euo pipefail

SOURCE=/opt/heytutor
RELEASES=/opt/heytutor-releases
CURRENT=/opt/heytutor-current
UNIT=/etc/systemd/system/heytutor.service
ENV_FILE="$SOURCE/apps/tutor/.env.production"
COMMIT="${1:-}"
if [ "$#" -ne 1 ] || [[ ! "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'deploy.sh requires one trusted full commit SHA.' >&2; exit 1
fi
[ "$(id -u)" = 0 ] || { echo 'Deploy must run as root.' >&2; exit 1; }
# Local and SSM deploys share this lock; never overlap activation or migrations.
exec 9>/var/lock/heytutor-deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo 'Missing production environment file.' >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
[ -n "${DATABASE_URL:-}" ] || { echo 'DATABASE_URL is required.' >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || { echo 'Node 24 is required.' >&2; exit 1; }
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
command -v systemd-run >/dev/null
# Deployment identity overrides stale values in the shared environment file.
export SENTRY_ENVIRONMENT=production SENTRY_RELEASE="$COMMIT" HEYTUTOR_RELEASE="$COMMIT"
export NEXT_PUBLIC_SENTRY_ENVIRONMENT=production NEXT_PUBLIC_SENTRY_RELEASE="$COMMIT"
export CI=true
# Preserve current serving capacity, not merely a percentage of total RAM.
MEMORY_MAX="$(awk '/^MemTotal:/{total=$2} /^MemAvailable:/{available=$2} END {
  limit=int(total*0.6); headroom=available-524288;
  if (headroom<limit) limit=headroom;
  printf "%.0f", limit*1024;
}' /proc/meminfo)"
if [ "$MEMORY_MAX" -lt 805306368 ]; then
  echo 'Insufficient free build memory while preserving the live service; use a larger build host or CI artifact.' >&2
  exit 1
fi

mkdir -p "$RELEASES"
chmod 755 "$RELEASES"
RELEASE="$(mktemp -d "$RELEASES/$COMMIT.XXXXXXXX")"
# Git credentials remain with the fixed checkout owner; archive never resets it.
sudo -H -u ubuntu env GIT_TERMINAL_PROMPT=0 git -C "$SOURCE" archive "$COMMIT" | tar -x -C "$RELEASE"
# Keep runtime secrets outside immutable code. Next's build loads this same file.
ln -s "$ENV_FILE" "$RELEASE/apps/tutor/.env.production"
cd "$RELEASE"
corepack enable
corepack prepare pnpm@10.32.0 --activate
# Bound the entire build cgroup (including native workers) so a cgroup OOM
# remains inside the build group. Failure leaves the current release untouched.
systemd-run --quiet --scope --unit="heytutor-build-$$" \
  -p "MemoryMax=$MEMORY_MAX" -p MemorySwapMax=1G -p OOMPolicy=kill \
  /usr/bin/bash "$RELEASE/deploy/aws/build-release.sh"
node "$RELEASE/deploy/aws/verify-release.mjs" "$RELEASE"

# Expand-only/backward-compatible migrations run after a valid build and before
# activation. Application rollback does not undo a committed database migration.
(cd apps/tutor && pnpm exec tsx scripts/live/deploy-migrations.ts)
if ! id heytutor >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/heytutor --create-home --shell /usr/sbin/nologin heytutor
fi
mkdir -p /var/lib/heytutor
chown heytutor:heytutor /var/lib/heytutor
chgrp -R heytutor "$RELEASE"
chmod -R g+rX "$RELEASE"
chmod 750 "$RELEASE"
chgrp heytutor "$ENV_FILE"
chmod 640 "$ENV_FILE"
mkdir -p "$RELEASE/apps/tutor/.next/cache"
chgrp -R heytutor "$RELEASE/apps/tutor/.next"
chmod -R g+rwX "$RELEASE/apps/tutor/.next"
# The legacy source tree is also the parent of the shared environment file.
chmod g+x "$SOURCE" "$SOURCE/apps" "$SOURCE/apps/tutor"
chgrp heytutor "$SOURCE" "$SOURCE/apps" "$SOURCE/apps/tutor"

PREVIOUS="$(readlink "$CURRENT" 2>/dev/null || true)"
UNIT_BACKUP="$RELEASE/previous.service"
HAD_UNIT=false
if [ -f "$UNIT" ]; then cp "$UNIT" "$UNIT_BACKUP"; HAD_UNIT=true; fi
ACTIVATING=false
rollback() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$ACTIVATING" = true ]; then
    echo 'Activation failed; restoring the previous service and release.' >&2
    if [ -n "$PREVIOUS" ]; then
      ln -s "$PREVIOUS" "$CURRENT.rollback.$$"
      mv -Tf "$CURRENT.rollback.$$" "$CURRENT"
    else
      rm -f "$CURRENT"
    fi
    if [ "$HAD_UNIT" = true ]; then
      cp "$UNIT_BACKUP" "$UNIT"
      systemctl daemon-reload
      systemctl restart heytutor || echo 'Rollback restart failed; inspect protected service logs.' >&2
    else
      systemctl stop heytutor || true
      rm -f "$UNIT"
      systemctl daemon-reload
    fi
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ACTIVATING=true
ln -s "$RELEASE" "$CURRENT.next.$$"
mv -Tf "$CURRENT.next.$$" "$CURRENT"
# Identity lives in each release, loaded after the shared env so it cannot drift.
printf 'SENTRY_ENVIRONMENT=production\nSENTRY_RELEASE=%s\nHEYTUTOR_RELEASE=%s\n' "$COMMIT" "$COMMIT" > "$RELEASE/runtime.env"
chmod 640 "$RELEASE/runtime.env"
chgrp heytutor "$RELEASE/runtime.env"
cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=HeyTutor API server
After=network.target

[Service]
Type=simple
User=heytutor
Group=heytutor
NoNewPrivileges=true
WorkingDirectory=${CURRENT}
Environment=HOME=/var/lib/heytutor
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=${ENV_FILE}
EnvironmentFile=${CURRENT}/runtime.env
ExecStart=/usr/bin/bash -lc 'cd apps/tutor && NODE_ENV=production HOSTNAME=app.accelute.co LISTEN_HOST=127.0.0.1 PORT=3000 pnpm exec tsx server.ts'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT_EOF
systemctl daemon-reload
systemctl reset-failed heytutor || true
systemctl restart heytutor
node "$RELEASE/deploy/aws/verify-release.mjs" "$RELEASE" "$COMMIT" http://127.0.0.1:3000
systemctl enable heytutor
ACTIVATING=false
trap - EXIT INT TERM
echo "Tutor release $COMMIT activated and verified."
