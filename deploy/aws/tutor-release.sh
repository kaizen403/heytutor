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
#      a pre-deploy tab's lazy chunks still resolve after the switch. Carried
#      files older than TUTOR_STATIC_KEEP_DAYS are pruned; the live build's
#      own files never are.
#   2. tutor_switch_release: stop the service (which drains the old server on
#      its own build), point the symlink at the new release, start it. So no
#      server ever serves a build it did not start on. A failed switch starts
#      the service again on the build it had and fails the deploy.
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
  # Next type checks every types/ directory tsconfig includes. The live
  # release's types/validator.ts imports the old build's routes, so a commit
  # that deletes a page would fail this and every later build. Nothing reads
  # types/ at runtime.
  rm -rf "$tutor/.next/types" "$tutor/.next-a/types" "$tutor/.next-b/types"
  ( cd "$tutor" && NEXT_DIST_DIR="$release" pnpm exec next build )
  if [ ! -s "$tutor/$release/BUILD_ID" ]; then
    echo "The tutor build left no BUILD_ID in $release; the live build is unchanged." >&2
    return 1
  fi
  # This build's own static files, listed beside static/ (never served) so the
  # next deploy can tell them from the ones carried forward.
  local dest="$tutor/$release/static" list="$tutor/$release/static-files.txt"
  local live_list="$tutor/$release/.live-static-files" file
  mkdir -p "$dest"
  (cd "$dest" && find . -type f | LC_ALL=C sort) > "$list"
  # Keep the live build's static files (and the ones it carried) beside the
  # new ones. Never overwrite a file the new build wrote.
  # (No `cp -n`: newer coreutils exit nonzero when it skips a file.)
  : > "$live_list"
  if [ -d "$tutor/.next/static" ]; then
    local kept="$tutor/.next/static"
    while IFS= read -r -d '' file; do
      if [ ! -e "$dest/$file" ]; then
        mkdir -p "$(dirname "$dest/$file")"
        cp -p "$kept/$file" "$dest/$file"
      fi
    done < <(cd "$kept" && find . -type f -print0)
    # The live build's own files are what open tabs load next, however long
    # ago it was built. A live build with no list (the first run's in-place
    # build) keeps all of its files.
    if [ -f "$tutor/.next/static-files.txt" ]; then
      cp "$tutor/.next/static-files.txt" "$live_list"
    else
      (cd "$kept" && find . -type f | LC_ALL=C sort) > "$live_list"
    fi
  fi
  # Prune only carried files from older builds (they keep their original
  # times), never this build's or the live build's own.
  (cd "$dest" && find . -type f -mtime +"$TUTOR_STATIC_KEEP_DAYS" | LC_ALL=C sort) |
    LC_ALL=C comm -23 - "$list" |
    LC_ALL=C comm -23 - "$live_list" |
    while IFS= read -r file; do rm -f "$dest/$file"; done
  rm -f "$live_list"
}

# Point .next at the release, or put the previous build back and fail.
# Usage: tutor_activate_release <tutor dir> <release>
# Callers may run this as a condition, where `set -e` does not apply, so every
# step checks itself.
tutor_activate_release() {
  local tutor="$1" release="$2" previous=""
  [ -s "$tutor/$release/BUILD_ID" ] || { echo "Refusing to activate $release without a BUILD_ID." >&2; return 1; }
  if [ -L "$tutor/.next" ]; then previous="$(readlink "$tutor/.next")"; fi
  if [ -e "$tutor/.next" ] && [ ! -L "$tutor/.next" ]; then
    # First atomic deploy: the old in-place build becomes .next-legacy.
    rm -rf "$tutor/.next-legacy" || return 1
    mv "$tutor/.next" "$tutor/.next-legacy" || return 1
  fi
  # The service is stopped during the switch, so replacing the link in place
  # is enough; nothing serves from it at this moment.
  if ln -sfn "$release" "$tutor/.next" && [ "$(readlink "$tutor/.next")" = "$release" ]; then
    return 0
  fi
  echo "Could not point .next at $release; restoring the previous build." >&2
  if [ ! -e "$tutor/.next" ]; then
    if [ -n "$previous" ]; then
      rm -f "$tutor/.next"
      ln -s "$previous" "$tutor/.next"
    elif [ -d "$tutor/.next-legacy" ]; then
      rm -f "$tutor/.next"
      mv "$tutor/.next-legacy" "$tutor/.next"
    fi
  fi
  return 1
}

# Stop heytutor, switch .next to the release, start heytutor. If the switch
# fails the service starts again on the build it had, and the deploy fails.
# Usage: tutor_switch_release <tutor dir> <release>
tutor_switch_release() {
  local tutor="$1" release="$2"
  sudo systemctl stop heytutor
  if ! tutor_activate_release "$tutor" "$release"; then
    sudo systemctl start heytutor
    echo "The switch to $release failed; heytutor started again on the previous build." >&2
    return 1
  fi
  sudo systemctl start heytutor
}
