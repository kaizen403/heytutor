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
# server is up. It retries a refused connection for any method (it never
# reached a server, and the body is untouched), and a GET after other
# transport errors too; a POST, PUT or PATCH that reached a server is never
# replayed. Measured with Caddy 2.11.4 and the real shutdown code: GET, 2 MiB
# and 300 KiB POSTs (bodies intact) and a WebSocket all went from 502 to 200
# on the new server. stream_close_delay keeps open speech sockets through a
# later config reload instead of cutting them.
#
# setup-vm.sh writes the same block on a new box. The live Caddyfile has
# box-only edits (host names, matchers), so this changes only the bare
# reverse_proxy line, validates, swaps the file in by rename (a failed write
# leaves the old file whole), and reloads Caddy gracefully. Any failure puts
# the old file back and leaves the deploy going: the hold is a convenience,
# not a dependency. Once applied (its marker is in the file), it does nothing.
set -euo pipefail

CADDYFILE="${1:-/etc/caddy/Caddyfile}"
UPSTREAM="127.0.0.1:3000"
# Written into the block, so a rerun knows its own hold from any other
# lb_try_duration in the file.
MARKER="(deploy/aws/caddy-hold-restarts.sh)"

warn() { echo "WARNING: caddy-hold-restarts: $*; Caddy left unchanged." >&2; }

# Swap $1 in as the Caddyfile by rename. A failed write (a full disk) leaves
# the old file whole instead of truncated. The copy keeps owner and mode.
replace_caddyfile() {
  local next="$CADDYFILE.next-$$"
  if cp -p "$CADDYFILE" "$next" && cat "$1" > "$next" && mv -f "$next" "$CADDYFILE"; then return 0; fi
  rm -f "$next"
  return 1
}

if ! command -v caddy >/dev/null || [ ! -f "$CADDYFILE" ]; then
  echo "==> caddy: no Caddy or no $CADDYFILE; skipping the restart hold"
  exit 0
fi
if grep -qF "$MARKER" "$CADDYFILE"; then
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
UPSTREAM="$UPSTREAM" BARE="$bare" MARKER="$MARKER" awk '
  $0 ~ ENVIRON["BARE"] {
    upstream = ENVIRON["UPSTREAM"]
    indent = $0; sub(/[^[:space:]].*$/, "", indent)
    print indent "reverse_proxy " upstream " {"
    print indent "  # A deploy stops the old server (it drains for up to 60 s with its"
    print indent "  # listener closed) before the new one starts. Hold requests until it"
    print indent "  # is up instead of answering 502. Caddy retries a refused connection"
    print indent "  # for any method and a GET after other transport errors; a POST that"
    print indent "  # reached a server is never replayed. " ENVIRON["MARKER"]
    print indent "  lb_try_duration 90s"
    print indent "  lb_try_interval 250ms"
    print indent "  # A config reload leaves open speech sockets up to 5 min to finish."
    print indent "  stream_close_delay 5m"
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
if ! cp -p "$CADDYFILE" "$backup"; then
  warn "could not write $backup"
  exit 0
fi
if ! replace_caddyfile "$candidate"; then
  warn "could not write $CADDYFILE"
  exit 0
fi
if ! systemctl reload caddy; then
  replace_caddyfile "$backup" || cp -p "$backup" "$CADDYFILE" || true
  systemctl reload caddy || true
  warn "systemctl reload caddy failed; restored $backup"
  exit 0
fi
echo "==> caddy: holds requests across restarts (previous config in $backup)"
