#!/usr/bin/env bash
# Make Caddy hold requests while heytutor restarts, instead of answering 502.
# Usage (as root): caddy-hold-restarts.sh [Caddyfile]   (default /etc/caddy/Caddyfile)
#
# Production, 28 Oct 2026: every deploy answered 502 for about 65 s. The old
# server closes its listener on SIGTERM and drains for up to 60 s
# (lib/http/gracefulShutdown.ts), then the new one boots. Every page load,
# lesson start and speech socket in that window failed at once.
#
# With lb_try_duration, Caddy keeps retrying the connection until the new
# server is up. A refused connection never reached the server, so a retry is
# always safe, POST bodies included. Measured with Caddy 2.11.4 and the real
# shutdown code: GET, 2 MiB and 300 KiB POSTs (bodies intact) and a WebSocket
# all went from 502 to 200 on the new server.
#
# setup-vm.sh writes the same block on a new box. The live Caddyfile has
# box-only edits (host names, matchers), so this changes only the bare
# reverse_proxy line, validates, and reloads Caddy gracefully. Any failure
# puts the old file back and leaves the deploy going: the hold is a
# convenience, not a dependency. Once applied, it does nothing.
set -euo pipefail

CADDYFILE="${1:-/etc/caddy/Caddyfile}"
UPSTREAM="127.0.0.1:3000"

warn() { echo "WARNING: caddy-hold-restarts: $*; Caddy left unchanged." >&2; }

if ! command -v caddy >/dev/null || [ ! -f "$CADDYFILE" ]; then
  echo "==> caddy: no Caddy or no $CADDYFILE; skipping the restart hold"
  exit 0
fi
if grep -q "lb_try_duration" "$CADDYFILE"; then
  echo "==> caddy: already holds requests across restarts"
  exit 0
fi
bare="^[[:space:]]*reverse_proxy[[:space:]]+${UPSTREAM//./\\.}[[:space:]]*$"
count="$(grep -Ec "$bare" "$CADDYFILE" || true)"
if [ "$count" != "1" ]; then
  warn "expected one bare 'reverse_proxy $UPSTREAM' line, found $count"
  exit 0
fi

candidate="$(mktemp)"
trap 'rm -f "$candidate"' EXIT
# The pattern goes through the environment: awk would unescape it from -v.
UPSTREAM="$UPSTREAM" BARE="$bare" awk '
  $0 ~ ENVIRON["BARE"] {
    upstream = ENVIRON["UPSTREAM"]
    indent = $0; sub(/[^[:space:]].*$/, "", indent)
    print indent "reverse_proxy " upstream " {"
    print indent "  # A deploy stops the old server (it drains for up to 60 s with its"
    print indent "  # listener closed) before the new one starts. Hold requests until it"
    print indent "  # is up instead of answering 502. A refused connection is always safe"
    print indent "  # to retry. (deploy/aws/caddy-hold-restarts.sh)"
    print indent "  lb_try_duration 90s"
    print indent "  lb_try_interval 250ms"
    print indent "}"
    next
  }
  { print }
' "$CADDYFILE" > "$candidate"

if ! caddy validate --config "$candidate" --adapter caddyfile >/dev/null 2>&1; then
  warn "the edited Caddyfile does not validate"
  exit 0
fi
backup="$CADDYFILE.before-hold-restarts"
cp -p "$CADDYFILE" "$backup"
# Write in place so the file keeps its owner and mode.
cat "$candidate" > "$CADDYFILE"
if ! systemctl reload caddy; then
  cat "$backup" > "$CADDYFILE"
  systemctl reload caddy || true
  warn "systemctl reload caddy failed; restored $backup"
  exit 0
fi
echo "==> caddy: holds requests across restarts (previous config in $backup)"
