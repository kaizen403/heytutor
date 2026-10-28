#!/usr/bin/env python3
"""Atomic tutor builds (deploy/aws/tutor-release.sh) against a fake `next build`.

Production, 28 Oct 2026: the in-place build left the live page's own chunks
returning 400 for the whole build, and pre-deploy tabs stuck after it. These
cases prove the live build is never written while it serves, a failed build
changes nothing live, the previous builds' static files stay reachable, and
the release directories alternate.
"""
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELEASE = HERE / "tutor-release.sh"

# Stands in for `pnpm exec next build`: checks the live build is untouched while
# it runs, then writes a BUILD_ID and one chunk named after the build.
FAKE_PNPM = r"""#!/usr/bin/env bash
set -euo pipefail
[ "$1 $2 $3" = "exec next build" ] || { echo "unexpected pnpm $*" >&2; exit 9; }
dist="$NEXT_DIST_DIR"
if [ -e .next ]; then
  [ "$(cat .next/BUILD_ID)" = "$EXPECT_LIVE" ] || { echo "live build changed during build" >&2; exit 8; }
fi
[ "${FAIL_BUILD:-0}" = "1" ] && { mkdir -p "$dist/static/chunks"; echo partial > "$dist/static/chunks/partial.js"; exit 3; }
[ "${EMPTY_BUILD:-0}" = "1" ] && { mkdir -p "$dist/static"; exit 0; }
mkdir -p "$dist/static/chunks"
echo "$NEW_BUILD" > "$dist/BUILD_ID"
echo "new $NEW_BUILD" > "$dist/static/chunks/$NEW_BUILD.js"
echo "new shared" > "$dist/static/chunks/shared.js"
# A build output that keeps an old source time (as a copied font might).
mkdir -p "$dist/static/media"
echo font > "$dist/static/media/font-$NEW_BUILD.woff2"
touch -t 202001010000 "$dist/static/media/font-$NEW_BUILD.woff2"
"""


class TutorRelease(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.tutor = self.root / "apps/tutor"
        self.tutor.mkdir(parents=True)
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        pnpm = bin_dir / "pnpm"
        pnpm.write_text(FAKE_PNPM)
        pnpm.chmod(0o755)
        self.env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}

    def tearDown(self):
        self.tmp.cleanup()

    def run_release(self, new_build, expect_live="", fail=False, empty=False):
        script = f"""set -euo pipefail
source "{RELEASE}"
release="$(tutor_inactive_release "{self.tutor}")"
tutor_build_release "{self.tutor}" "$release"
tutor_activate_release "{self.tutor}" "$release"
echo "$release"
"""
        env = {**self.env, "NEW_BUILD": new_build, "EXPECT_LIVE": expect_live, "FAIL_BUILD": "1" if fail else "0",
               "EMPTY_BUILD": "1" if empty else "0"}
        return subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True)

    def live(self):
        return (self.tutor / ".next/BUILD_ID").read_text().strip()

    def legacy_build(self, build="old", chunk="old.js"):
        static = self.tutor / ".next/static/chunks"
        static.mkdir(parents=True)
        (self.tutor / ".next/BUILD_ID").write_text(build)
        (static / chunk).write_text("old chunk")
        (static / "shared.js").write_text("old shared")

    def test_first_deploy_builds_beside_a_real_next_and_keeps_its_chunks(self):
        self.legacy_build()
        result = self.run_release("b1", expect_live="old")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip().splitlines()[-1], ".next-a")
        self.assertTrue((self.tutor / ".next").is_symlink())
        self.assertEqual(os.readlink(self.tutor / ".next"), ".next-a")
        self.assertEqual(self.live(), "b1")
        self.assertEqual((self.tutor / ".next-legacy/BUILD_ID").read_text(), "old")
        chunks = self.tutor / ".next/static/chunks"
        self.assertTrue((chunks / "old.js").exists(), "a pre-deploy tab's chunk still resolves")
        self.assertTrue((chunks / "b1.js").exists())
        self.assertEqual((chunks / "shared.js").read_text().strip(), "new shared", "a retained file never overwrites the new build's")

    def test_releases_alternate_and_carry_previous_chunks(self):
        self.legacy_build()
        self.assertEqual(self.run_release("b1", expect_live="old").returncode, 0)
        second = self.run_release("b2", expect_live="b1")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(os.readlink(self.tutor / ".next"), ".next-b")
        chunks = self.tutor / ".next/static/chunks"
        for name in ["old.js", "b1.js", "b2.js"]:
            self.assertTrue((chunks / name).exists(), name)
        third = self.run_release("b3", expect_live="b2")
        self.assertEqual(third.returncode, 0, third.stderr)
        self.assertEqual(os.readlink(self.tutor / ".next"), ".next-a")
        self.assertEqual(self.live(), "b3")

    def test_failed_build_leaves_the_live_build_serving(self):
        self.legacy_build()
        self.assertEqual(self.run_release("b1", expect_live="old").returncode, 0)
        failed = self.run_release("b2", expect_live="b1", fail=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(os.readlink(self.tutor / ".next"), ".next-a", "the live link never moves on a failed build")
        self.assertEqual(self.live(), "b1")
        self.assertFalse((self.tutor / ".next-b/BUILD_ID").exists())

    def test_a_build_that_exits_cleanly_without_output_is_never_activated(self):
        self.legacy_build()
        self.assertEqual(self.run_release("b1", expect_live="old").returncode, 0)
        empty = self.run_release("b2", expect_live="b1", empty=True)
        self.assertNotEqual(empty.returncode, 0)
        self.assertEqual(os.readlink(self.tutor / ".next"), ".next-a")
        self.assertEqual(self.live(), "b1")

    def test_old_static_files_are_pruned_and_the_cache_kept(self):
        self.legacy_build(chunk="ancient.js")
        stale = self.tutor / ".next/static/chunks/ancient.js"
        old_time = time.time() - 5 * 86400
        os.utime(stale, (old_time, old_time))
        cache = self.tutor / ".next-a/cache/webpack"
        cache.mkdir(parents=True)
        (cache / "pack").write_text("cache")
        result = self.run_release("b1", expect_live="old")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.tutor / ".next/static/chunks/ancient.js").exists(), "static files older than the keep window are pruned")
        self.assertTrue((self.tutor / ".next-a/cache/webpack/pack").exists(), "the webpack cache survives the rebuild")
        self.assertTrue((self.tutor / ".next/static/media/font-b1.woff2").exists(), "a file this build wrote is never pruned, however old its time")

    def test_refuses_unknown_releases_and_empty_builds(self):
        script = f"""source "{RELEASE}"
tutor_build_release "{self.tutor}" ".next" && exit 10
tutor_activate_release "{self.tutor}" ".next-b" && exit 11
exit 0"""
        result = subprocess.run(["bash", "-c", script], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.tutor / ".next").exists())

    def test_deploy_stops_then_switches_then_starts(self):
        deploy = (HERE / "deploy.sh").read_text()
        build = deploy.index('tutor_build_release "$TUTOR_DIR" "$TUTOR_RELEASE"')
        stop = deploy.index("sudo systemctl stop heytutor")
        switch = deploy.index('tutor_activate_release "$TUTOR_DIR" "$TUTOR_RELEASE"', stop)
        start = deploy.index("sudo systemctl start heytutor")
        self.assertTrue(build < stop < switch < start, "build, then drain the old server, switch, start")
        self.assertNotIn("sudo systemctl restart heytutor", deploy)
        self.assertIn("pnpm turbo run build --filter=@heytutor/tutor^...", deploy, "turbo builds only the tutor's packages")
        self.assertNotIn("pnpm turbo run build --filter=@heytutor/tutor...\n", deploy)
        # Turbo's strict env mode drops SENTRY_RELEASE; the tutor build must see it.
        self.assertLess(deploy.index("export SENTRY_RELEASE"), build, "the tutor build sees this deploy's release")
        self.assertNotIn("turbo run", RELEASE.read_text(), "the tutor itself never builds through turbo")


if __name__ == "__main__":
    unittest.main(verbosity=2)
