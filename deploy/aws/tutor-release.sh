#!/usr/bin/env bash
# Atomic tutor builds for deploy.sh (sourced, not run).
#
# Production, 28 Oct 2026: `next build` rewrote apps/tutor/.next under the
# running server. For the whole build the live page's own chunks returned
# 400, so it never hydrated and sat on "loading the board", and every tab
# opened before the deploy was stuck after it on chunk names the build had
# deleted. A build that died (17 Oct, out of memory) left no live build at all.
#
# Now the tutor builds into one of two release directories, never the live
# one, and `.next` is a symlink to the live release:
#   1. tutor_build_release: build into the inactive directory (.next-a or
#      .next-b), keeping its webpack cache. A failed build exits and the live
#      build is untouched. The previous builds' static files are copied in, so
#      a pre-deploy tab's lazy chunks still resolve after the switch; static
#      files older than TUTOR_STATIC_KEEP_DAYS are pruned.
#   2. tutor_activate_release: point the symlink at it. deploy.sh calls it between
#      `systemctl stop` (which drains the old server on its own build) and
#      `systemctl start`, so no server ever serves a build it did not start on.
# The first run converts an existing real .next directory into .next-legacy.

TUTOR_STATIC_KEEP_DAYS="${TUTOR_STATIC_KEEP_DAYS:-3}"

# Echo the release directory to build into: the one that is not live.
tutor_inactive_release() {
  local tutor="$1" live=""
  if [ -L "$tutor/.next" ]; then live="$(basename "$(readlink "$tutor/.next")")"; fi
  if [ "$live" = ".next-a" ]; then echo ".next-b"; else echo ".next-a"; fi
}

# Build the tutor into the inactive release directory. Usage: tutor_build_release <tutor dir> <release>
tutor_build_release() {
  local tutor="$1" release="$2"
  case "$release" in .next-a|.next-b) ;; *) echo "Refusing to build into $release." >&2; return 1 ;; esac
  # Clear the inactive release except its webpack cache, which only speeds the build.
  mkdir -p "$tutor/$release"
  find "$tutor/$release" -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} +
  ( cd "$tutor" && NEXT_DIST_DIR="$release" pnpm exec next build )
  if [ ! -s "$tutor/$release/BUILD_ID" ]; then
    echo "The tutor build left no BUILD_ID in $release; the live build is unchanged." >&2
    return 1
  fi
  # Keep the live build's static files (and the ones it kept) beside the new
  # ones. Never overwrite a file the new build wrote.
  # (No `cp -n`: newer coreutils exit nonzero when it skips a file.)
  local dest="$tutor/$release/static" fresh="$tutor/$release/.fresh-static" file
  mkdir -p "$dest"
  (cd "$dest" && find . -type f | LC_ALL=C sort) > "$fresh"
  if [ -d "$tutor/.next/static" ]; then
    local kept="$tutor/.next/static"
    while IFS= read -r -d '' file; do
      if [ ! -e "$dest/$file" ]; then
        mkdir -p "$(dirname "$dest/$file")"
        cp -p "$kept/$file" "$dest/$file"
      fi
    done < <(cd "$kept" && find . -type f -print0)
  fi
  # Prune only kept files (they keep their original times), never one this
  # build wrote, whatever its time.
  (cd "$dest" && find . -type f -mtime +"$TUTOR_STATIC_KEEP_DAYS" | LC_ALL=C sort) |
    LC_ALL=C comm -23 - "$fresh" |
    while IFS= read -r file; do rm -f "$dest/$file"; done
  rm -f "$fresh"
}

# Point .next at the release. Usage: tutor_activate_release <tutor dir> <release>
tutor_activate_release() {
  local tutor="$1" release="$2"
  [ -s "$tutor/$release/BUILD_ID" ] || { echo "Refusing to activate $release without a BUILD_ID." >&2; return 1; }
  if [ -e "$tutor/.next" ] && [ ! -L "$tutor/.next" ]; then
    # First atomic deploy: the old in-place build becomes .next-legacy.
    rm -rf "$tutor/.next-legacy"
    mv "$tutor/.next" "$tutor/.next-legacy"
  fi
  # deploy.sh switches while the service is stopped, so replacing the link in
  # place is enough; nothing serves from it at this moment.
  ln -sfn "$release" "$tutor/.next"
}
