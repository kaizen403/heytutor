#!/usr/bin/env python3
"""Atomic tutor builds (deploy/aws/tutor-release.sh) against a fake `next build`.

Production, 28 Oct 2026: the in-place build left the live page's own chunks
returning 400 for the whole build, and pre-deploy tabs stuck after it. These
cases prove the live build is never written while it serves, a failed build
or a failed switch leaves the old build serving, the previous builds' static
files stay reachable, and the release directories alternate.
"""
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
RELEASE = HERE / "tutor-release.sh"

# Stands in for `pnpm exec next build`. It checks the live build is untouched
# while it runs and, like Next's type check, fails on another release's
# types/validator.ts (it imports that build's routes). Then it writes a
# BUILD_ID, types, and chunks named after the build.
FAKE_PNPM = r"""#!/usr/bin/env bash
set -euo pipefail
[ "$1 $2 $3" = "exec next build" ] || { echo "unexpected pnpm $*" >&2; exit 9; }
dist="$NEXT_DIST_DIR"
if [ -e .next ]; then
  [ "$(cat .next/BUILD_ID)" = "$EXPECT_LIVE" ] || { echo "live build changed during build" >&2; exit 8; }
fi
for other in .next .next-a .next-b; do
  [ "$other" = "$dist" ] && continue
  if [ -e "$other/types/validator.ts" ]; then echo "TS2307: $other/types/validator.ts imports a deleted route" >&2; exit 7; fi
done
[ "${FAIL_BUILD:-0}" = "1" ] && { mkdir -p "$dist/static/chunks"; echo partial > "$dist/static/chunks/partial.js"; exit 3; }
[ "${EMPTY_BUILD:-0}" = "1" ] && { mkdir -p "$dist/static"; exit 0; }
mkdir -p "$dist/static/chunks" "$dist/types"
echo "$NEW_BUILD" > "$dist/BUILD_ID"
echo "import '../../app/$NEW_BUILD/page'" > "$dist/types/validator.ts"
echo "new $NEW_BUILD" > "$dist/static/chunks/$NEW_BUILD.js"
echo "new shared" > "$dist/static/chunks/shared.js"
# A build output that keeps an old source time (as a copied font might).
mkdir -p "$dist/static/media"
echo font > "$dist/static/media/font-$NEW_BUILD.woff2"
touch -t 202001010000 "$dist/static/media/font-$NEW_BUILD.woff2"
"""

# Records each `sudo systemctl ...` with the build .next pointed at right then.
FAKE_SUDO = r"""#!/usr/bin/env bash
link="$(readlink "$TUTOR/.next" 2>/dev/null || echo "real:$(cat "$TUTOR/.next/BUILD_ID" 2>/dev/null)")"
echo "$* @ $link" >> "$SUDO_LOG"
"""

# Fails `ln -sfn <FAIL_LINK_TO> <link>` after removing the link, the worst
# case of a non-atomic `ln -sfn`. Every other call is the real ln.
FAKE_LN = r"""#!/usr/bin/env bash
if [ "$1" = "-sfn" ] && [ "$2" = "${FAIL_LINK_TO:-}" ]; then rm -f "$3"; exit 1; fi
exec /bin/ln "$@"
"""


class TutorRelease(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.tutor = self.root / "apps/tutor"
        self.tutor.mkdir(parents=True)
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        for name, body in [("pnpm", FAKE_PNPM), ("sudo", FAKE_SUDO)]:
            path = bin_dir / name
            path.write_text(body)
            path.chmod(0o755)
        self.ln_dir = self.root / "ln-bin"
        self.ln_dir.mkdir()
        fake_ln = self.ln_dir / "ln"
        fake_ln.write_text(FAKE_LN)
        fake_ln.chmod(0o755)
        self.sudo_log = self.root / "sudo.log"
        self.env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "TUTOR": str(self.tutor),
                    "SUDO_LOG": str(self.sudo_log)}

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

    def run_switch(self, release, fail_link_to=""):
        # As deploy.sh calls it: under `set -e`, nothing after a failed switch runs.
        script = f"""set -euo pipefail
source "{RELEASE}"
tutor_switch_release "{self.tutor}" "{release}"
echo "deploy went on"
"""
        env = {**self.env, "PATH": f"{self.ln_dir}:{self.env['PATH']}", "FAIL_LINK_TO": fail_link_to}
        return subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True)

    def sudo_calls(self):
        return self.sudo_log.read_text().splitlines() if self.sudo_log.exists() else []

    def live(self):
        return (self.tutor / ".next/BUILD_ID").read_text().strip()

    def legacy_build(self, build="old", chunk="old.js"):
        static = self.tutor / ".next/static/chunks"
        static.mkdir(parents=True)
        (self.tutor / ".next/BUILD_ID").write_text(build)
        (static / chunk).write_text("old chunk")
        (static / "shared.js").write_text("old shared")
        types = self.tutor / ".next/types"
        types.mkdir()
        (types / "validator.ts").write_text("import '../../app/deleted/page'")

    def age(self, path, days):
        stamp = time.time() - days * 86400
        for file in [path] if path.is_file() else [p for p in path.rglob("*") if p.is_file()]:
            os.utime(file, (stamp, stamp))

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

    def test_the_live_releases_route_types_never_fail_the_next_build(self):
        # Every build here runs with another release's types/validator.ts on
        # disk before it starts: the legacy build's, then b1's, then b2's.
        self.legacy_build()
        for build, live in [("b1", "old"), ("b2", "b1"), ("b3", "b2")]:
            result = self.run_release(build, expect_live=live)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.tutor / ".next/types/validator.ts").exists(), "the new build keeps its own types")

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

    def test_first_deploy_keeps_every_file_of_the_in_place_build(self):
        # The in-place build has no file list; all of its files are its own.
        self.legacy_build(chunk="ancient.js")
        self.age(self.tutor / ".next/static", 5)
        result = self.run_release("b1", expect_live="old")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.tutor / ".next/static/chunks/ancient.js").exists())

    def test_a_quiet_week_never_prunes_the_live_builds_own_files(self):
        self.legacy_build()
        self.assertEqual(self.run_release("b1", expect_live="old").returncode, 0)
        # No deploy for 5 days: every file the live build serves is now old.
        self.age(self.tutor / ".next-a/static", 5)
        result = self.run_release("b2", expect_live="b1")
        self.assertEqual(result.returncode, 0, result.stderr)
        chunks = self.tutor / ".next/static/chunks"
        self.assertTrue((chunks / "b1.js").exists(), "open tabs on the live build still load its chunks")
        self.assertTrue((self.tutor / ".next/static/media/font-b1.woff2").exists())
        self.assertFalse((chunks / "old.js").exists(), "a file carried from an older build expires")

    def test_old_carried_files_are_pruned_and_the_cache_kept(self):
        self.legacy_build(chunk="ancient.js")
        self.assertEqual(self.run_release("b1", expect_live="old").returncode, 0)
        self.age(self.tutor / ".next-a/static/chunks/ancient.js", 5)
        cache = self.tutor / ".next-b/cache/webpack"
        cache.mkdir(parents=True)
        (cache / "pack").write_text("cache")
        result = self.run_release("b2", expect_live="b1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.tutor / ".next/static/chunks/ancient.js").exists(), "carried files older than the keep window are pruned")
        self.assertTrue((self.tutor / ".next/static/chunks/b1.js").exists())
        self.assertTrue((self.tutor / ".next-b/cache/webpack/pack").exists(), "the webpack cache survives the rebuild")
        self.assertTrue((self.tutor / ".next/static/media/font-b2.woff2").exists(), "a file this build wrote is never pruned, however old its time")
        self.assertIn("./chunks/b2.js", (self.tutor / ".next/static-files.txt").read_text().splitlines())

    def test_switch_stops_on_the_old_build_and_starts_on_the_new(self):
        self.legacy_build()
        self.assertEqual(self.run_release("b1", expect_live="old").returncode, 0)
        self.assertEqual(self.run_release("b2", expect_live="b1").returncode, 0)
        # Point back at .next-a so the switch has somewhere to go.
        os.remove(self.tutor / ".next")
        os.symlink(".next-a", self.tutor / ".next")
        result = self.run_switch(".next-b")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.sudo_calls(), ["systemctl stop heytutor @ .next-a", "systemctl start heytutor @ .next-b"])

    def test_failed_switch_starts_the_old_build_and_fails_the_deploy(self):
        self.legacy_build()
        self.assertEqual(self.run_release("b1", expect_live="old").returncode, 0)
        # A release with no build: activation refuses before touching the link.
        (self.tutor / ".next-b").mkdir()
        refused = self.run_switch(".next-b")
        self.assertNotEqual(refused.returncode, 0)
        self.assertNotIn("deploy went on", refused.stdout)
        self.assertEqual(self.sudo_calls(), ["systemctl stop heytutor @ .next-a", "systemctl start heytutor @ .next-a"])

    def test_a_link_that_never_lands_restores_the_previous_build(self):
        self.legacy_build()
        self.assertEqual(self.run_release("b1", expect_live="old").returncode, 0)
        self.assertEqual(self.run_release("b2", expect_live="b1").returncode, 0)
        os.remove(self.tutor / ".next")
        os.symlink(".next-a", self.tutor / ".next")
        broken = self.run_switch(".next-b", fail_link_to=".next-b")
        self.assertNotEqual(broken.returncode, 0)
        self.assertNotIn("deploy went on", broken.stdout)
        self.assertEqual(os.readlink(self.tutor / ".next"), ".next-a")
        self.assertEqual(self.sudo_calls()[-1], "systemctl start heytutor @ .next-a")

    def test_a_first_link_that_never_lands_restores_the_in_place_build(self):
        self.legacy_build()
        (self.tutor / ".next-a").mkdir()
        (self.tutor / ".next-a/BUILD_ID").write_text("b1")
        broken = self.run_switch(".next-a", fail_link_to=".next-a")
        self.assertNotEqual(broken.returncode, 0)
        self.assertFalse((self.tutor / ".next").is_symlink())
        self.assertEqual(self.live(), "old")
        self.assertEqual(self.sudo_calls()[-1], "systemctl start heytutor @ real:old")

    def test_refuses_unknown_releases_and_empty_builds(self):
        script = f"""source "{RELEASE}"
tutor_build_release "{self.tutor}" ".next" && exit 10
tutor_activate_release "{self.tutor}" ".next-b" && exit 11
exit 0"""
        result = subprocess.run(["bash", "-c", script], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.tutor / ".next").exists())

    def test_the_live_link_and_releases_are_ignored_by_git(self):
        # In a scratch repo with this .gitignore: a `.next/` pattern matches
        # directories only and would list the symlink as untracked.
        repo = self.root / "repo"
        tutor = repo / "apps/tutor"
        (tutor / ".next-a/static").mkdir(parents=True)
        (tutor / ".next-a/static/x.js").write_text("x")
        (tutor / ".next-legacy").mkdir()
        (tutor / ".next-legacy/BUILD_ID").write_text("old")
        os.symlink(".next-a", tutor / ".next")
        (repo / ".gitignore").write_text((REPO / ".gitignore").read_text())
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        status = subprocess.run(["git", "-C", str(repo), "status", "--porcelain", "--untracked-files=all"],
                                capture_output=True, text=True, check=True).stdout
        self.assertEqual([line for line in status.splitlines() if "apps/tutor" in line], [])

    def test_deploy_builds_then_switches(self):
        deploy = (HERE / "deploy.sh").read_text()
        build = deploy.index('tutor_build_release "$TUTOR_DIR" "$TUTOR_RELEASE"')
        migrate = deploy.index('echo "==> migrate"')
        switch = deploy.index('tutor_switch_release "$TUTOR_DIR" "$TUTOR_RELEASE"')
        self.assertTrue(build < migrate < switch, "build, migrate, then drain the old server, switch, start")
        self.assertNotIn("systemctl restart heytutor", deploy)
        self.assertNotIn("systemctl stop heytutor", deploy, "only tutor_switch_release stops the service")
        self.assertIn("pnpm turbo run build --filter=@heytutor/tutor^...", deploy, "turbo builds only the tutor's packages")
        self.assertNotIn("pnpm turbo run build --filter=@heytutor/tutor...\n", deploy)
        # Turbo's strict env mode drops SENTRY_RELEASE; the tutor build must see it.
        self.assertLess(deploy.index("export SENTRY_RELEASE"), build, "the tutor build sees this deploy's release")
        self.assertNotIn("turbo run", RELEASE.read_text(), "the tutor itself never builds through turbo")


if __name__ == "__main__":
    unittest.main(verbosity=2)
