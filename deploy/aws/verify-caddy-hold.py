#!/usr/bin/env python3
"""Caddy holds requests across heytutor restarts (deploy/aws/caddy-hold-restarts.sh).

Production, 28 Oct 2026: every deploy answered 502 for about 65 s while the
old server drained with its listener closed and the new one booted. These
cases prove the live Caddyfile gains the hold and nothing else, a second run
does nothing, an edit that does not validate or reload is never left in
place, setup-vm.sh writes the same block, the hold outlasts the server's
drain, and deploy.sh applies it before the switch without ever failing on it.

Set REAL_CADDY=/path/to/caddy to also adapt the results with real Caddy.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SCRIPT = HERE / "caddy-hold-restarts.sh"
REAL_CADDY = os.environ.get("REAL_CADDY") or shutil.which("caddy")

# The live file's shape: box-only host names and matchers around a bare line.
BOX = """app.example.test, box.example.test {
  header {
    X-Content-Type-Options nosniff
  }
    @turn_upload path /api/boards/*/turns /api/boards/*/turns/*
  @small_body not path /api/boards/*/turns /api/boards/*/turns/*
  request_body @turn_upload {
    max_size 36MiB
  }
  request_body @small_body {
    max_size 512KiB
  }
  reverse_proxy 127.0.0.1:3000
}
"""

HOLD = """  reverse_proxy 127.0.0.1:3000 {
    # A deploy stops the old server (it drains for up to 60 s with its
    # listener closed) before the new one starts. Hold requests until it
    # is up instead of answering 502. Caddy retries a refused connection
    # for any method and a GET after other transport errors; a POST that
    # reached a server is never replayed. (deploy/aws/caddy-hold-restarts.sh)
    lb_try_duration 90s
    lb_try_interval 250ms
    # A config reload leaves open speech sockets up to 5 min to finish.
    stream_close_delay 5m
  }
"""

# Greptile, PR #361: an unrelated lb_try_duration must not read as applied.
UNRELATED = BOX.replace("app.example.test, box.example.test {", """# lb_try_duration was tried here once
other.example.test {
  reverse_proxy 127.0.0.1:4000 {
    lb_try_duration 5s
  }
}

app.example.test, box.example.test {""")

FAKE_CADDY = r"""#!/usr/bin/env bash
if [ "$1" = "validate" ]; then
  [ "${CADDY_FAIL_VALIDATE:-0}" = "1" ] && exit 1
  if [ -n "${REAL_CADDY:-}" ]; then exec "$REAL_CADDY" adapt --config "$3" --adapter caddyfile >/dev/null; fi
  exit 0
fi
echo "unexpected caddy $*" >&2; exit 9
"""

# Fails the rename that swaps the new Caddyfile in, as a full disk might.
FAKE_MV = r"""#!/usr/bin/env bash
[ "${FAIL_MV:-0}" = "1" ] && exit 1
exec /bin/mv "$@"
"""

FAKE_SYSTEMCTL = r"""#!/usr/bin/env bash
echo "$*" >> "$SYSTEMCTL_LOG"
[ "$1" = "reload" ] && [ "${RELOAD_FAIL:-0}" = "1" ] && exit 1
exit 0
"""


class CaddyHold(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name, body in [("caddy", FAKE_CADDY), ("systemctl", FAKE_SYSTEMCTL), ("mv", FAKE_MV)]:
            (self.bin / name).write_text(body)
            (self.bin / name).chmod(0o755)
        self.caddyfile = self.root / "Caddyfile"
        self.log = self.root / "systemctl.log"

    def tearDown(self):
        self.tmp.cleanup()

    def run_hold(self, text=BOX, with_caddy=True, **env):
        if text is not None:
            self.caddyfile.write_text(text)
        path = (f"{self.bin}:" if with_caddy else "") + "/usr/bin:/bin"
        if not with_caddy:
            (self.root / "nocaddy").mkdir(exist_ok=True)
            shutil.copy(self.bin / "systemctl", self.root / "nocaddy/systemctl")
            shutil.copy(self.bin / "mv", self.root / "nocaddy/mv")
            path = f"{self.root / 'nocaddy'}:/usr/bin:/bin"
        full_env = {"PATH": path, "SYSTEMCTL_LOG": str(self.log), "REAL_CADDY": REAL_CADDY or "", **env}
        return subprocess.run(["bash", str(SCRIPT), str(self.caddyfile)], env=full_env, capture_output=True, text=True)

    def reloads(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_the_live_file_gains_the_hold_and_nothing_else(self):
        result = self.run_hold()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.caddyfile.read_text(), BOX.replace("  reverse_proxy 127.0.0.1:3000\n", HOLD))
        self.assertEqual(Path(f"{self.caddyfile}.before-hold-restarts").read_text(), BOX)
        self.assertEqual(self.reloads(), ["reload caddy"])

    def test_a_second_run_does_nothing(self):
        self.assertEqual(self.run_hold().returncode, 0)
        applied = self.caddyfile.read_text()
        again = self.run_hold(text=None)
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("already holds", again.stdout)
        self.assertEqual(self.caddyfile.read_text(), applied)
        self.assertEqual(self.reloads(), ["reload caddy"], "no second reload")

    def test_another_lb_try_duration_does_not_count_as_applied(self):
        result = self.run_hold(text=UNRELATED)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("already holds", result.stdout)
        self.assertEqual(self.caddyfile.read_text(), UNRELATED.replace("  reverse_proxy 127.0.0.1:3000\n", HOLD))
        self.assertEqual(self.reloads(), ["reload caddy"])

    def test_a_failed_swap_leaves_the_old_file_whole(self):
        result = self.run_hold(FAIL_MV="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("could not write", result.stderr)
        self.assertEqual(self.caddyfile.read_text(), BOX)
        self.assertEqual([p.name for p in self.root.iterdir() if ".next-" in p.name], [], "no half-written file left behind")
        self.assertEqual(self.reloads(), [])

    @unittest.skipIf(os.geteuid() == 0, "root writes through a read-only directory")
    def test_a_directory_it_cannot_write_changes_nothing(self):
        self.caddyfile.write_text(BOX)
        self.root.chmod(0o555)
        try:
            result = self.run_hold(text=None)
        finally:
            self.root.chmod(0o755)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("left unchanged", result.stderr)
        self.assertEqual(self.caddyfile.read_text(), BOX)
        self.assertEqual(self.reloads(), [])

    def test_unexpected_shapes_are_left_alone(self):
        for text in [BOX.replace("127.0.0.1:3000", "127.0.0.1:4000"),
                     BOX.replace("  reverse_proxy 127.0.0.1:3000\n", "  reverse_proxy 127.0.0.1:3000 {\n  }\n"),
                     BOX.replace("  reverse_proxy 127.0.0.1:3000\n", "  reverse_proxy 127.0.0.1:3000\n  reverse_proxy 127.0.0.1:3000\n")]:
            result = self.run_hold(text=text)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("left unchanged", result.stderr)
            self.assertEqual(self.caddyfile.read_text(), text)
        self.assertEqual(self.reloads(), [])

    def test_an_edit_that_does_not_validate_is_never_written(self):
        result = self.run_hold(CADDY_FAIL_VALIDATE="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("does not validate", result.stderr)
        self.assertEqual(self.caddyfile.read_text(), BOX)
        self.assertFalse(Path(f"{self.caddyfile}.before-hold-restarts").exists())
        self.assertEqual(self.reloads(), [])

    def test_a_failed_reload_puts_the_old_file_back(self):
        result = self.run_hold(RELOAD_FAIL="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("restored", result.stderr)
        self.assertEqual(self.caddyfile.read_text(), BOX)

    def test_no_caddy_or_no_file_skips(self):
        self.assertIn("skipping", self.run_hold(with_caddy=False).stdout)
        self.assertEqual(self.caddyfile.read_text(), BOX)
        self.caddyfile.unlink()
        missing = self.run_hold(text=None)
        self.assertEqual(missing.returncode, 0)
        self.assertIn("skipping", missing.stdout)

    def setup_vm_caddyfile(self):
        setup = (HERE / "setup-vm.sh").read_text()
        start = setup.index("cat > /etc/caddy/Caddyfile <<EOF\n") + len("cat > /etc/caddy/Caddyfile <<EOF\n")
        end = setup.index("\nEOF\n", start)
        return setup[start:end + 1].replace("${HOSTNAME_FQDN}", "app.example.test")

    def test_setup_vm_writes_the_same_block(self):
        self.assertIn(HOLD, self.setup_vm_caddyfile())
        self.assertIn("@turn_upload path /api/boards/*/turns /api/boards/*/turns/*", self.setup_vm_caddyfile(),
                      "setup-vm.sh matches the live upload limits")

    def test_the_hold_outlasts_the_drain(self):
        shutdown = (REPO / "apps/tutor/lib/http/gracefulShutdown.ts").read_text()
        cap = lambda name: int(re.search(rf"export const {name} = ([\d_]+);", shutdown).group(1).replace("_", ""))
        hold_ms = int(re.search(r"lb_try_duration (\d+)s", HOLD).group(1)) * 1000
        boot_margin_ms = 15_000
        self.assertGreaterEqual(hold_ms, cap("SHUTDOWN_DRAIN_CAP_MS") + cap("SHUTDOWN_FLUSH_CAP_MS") + boot_margin_ms)
        self.assertIn("lb_try_duration 90s", SCRIPT.read_text())

    def test_deploy_applies_it_before_the_switch_and_never_fails_on_it(self):
        deploy = (HERE / "deploy.sh").read_text()
        call = 'sudo bash "$ROOT/deploy/aws/caddy-hold-restarts.sh" ||'
        self.assertIn(call, deploy, "a failure warns instead of stopping the deploy")
        self.assertLess(deploy.index(call), deploy.index('tutor_switch_release "$TUTOR_DIR" "$TUTOR_RELEASE"'))

    @unittest.skipUnless(REAL_CADDY, "set REAL_CADDY to adapt with real Caddy")
    def test_real_caddy_reads_the_hold(self):
        for name, text in [("edited live file", None), ("setup-vm.sh", self.setup_vm_caddyfile())]:
            if text is None:
                self.assertEqual(self.run_hold().returncode, 0)
            else:
                self.caddyfile.write_text(text)
            adapted = subprocess.run([REAL_CADDY, "adapt", "--config", str(self.caddyfile), "--adapter", "caddyfile"],
                                     capture_output=True, text=True, check=True).stdout
            found = re.findall(r'"load_balancing":\{[^{}]*\}', adapted)
            self.assertEqual(len(found), 1, name)
            lb = json.loads("{" + found[0] + "}")["load_balancing"]
            self.assertEqual((lb.get("try_duration"), lb.get("try_interval")), (90_000_000_000, 250_000_000), name)
            self.assertIn('"stream_close_delay":300000000000', adapted, name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
