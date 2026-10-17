"""Exercise the deployment boundary without cloud or service access.

The SSM contract uses fake commands in a disposable directory. To additionally
exercise Git's real ownership check in an isolated, offline container, pass
--ownership-container-image IMAGE (a local image with bash, git, sudo, useradd).
The container is never pulled, has no network and mounts no host directories.
"""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import unittest


class DeploymentBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="heytutor-ssm-verify-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.events = self.root / "events.jsonl"
        script = Path(__file__).with_name("ssm-deploy.sh").read_text()
        assert script.count("cd /opt/heytutor\n") == 1
        self.script = self.root / "entrypoint.sh"
        self.script.write_text(script.replace("cd /opt/heytutor\n", f'cd "{self.root}"\n'))
        self.sha = "a" * 40
        self.env = {
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "EVENTS": str(self.events),
            "SSM_Commit": self.sha,
            "MAIN_SHA": self.sha,
            "DEV_SHA": "b" * 40,
            "ORIGIN": "https://github.com/kaizen403/heytutor.git",
        }
        common = "import os, sys, json\nwith open(os.environ['EVENTS'], 'a') as f: f.write(json.dumps([os.path.basename(sys.argv[0]), *sys.argv[1:]]) + '\\n')\n"
        self.executable("sudo", common + "assert sys.argv[1:4] == ['-H', '-u', 'ubuntu']\nos.execvp(sys.argv[4], sys.argv[4:])\n")
        self.executable("git", common + """
assert sys.argv[1:3] == ['-C', '/opt/heytutor']
args = sys.argv[3:]
if args[:2] == ['remote', 'get-url']: print(os.environ['ORIGIN'])
elif args[0] == 'fetch': sys.exit(int(os.environ.get('FETCH_FAIL', '0')))
elif args[0] == 'rev-parse': print(os.environ['MAIN_SHA' if args[1].endswith('/main') else 'DEV_SHA'])
elif args[:2] == ['reset', '--hard']: pass
else: raise AssertionError(args)
""")
        self.executable("curl", common + "sys.exit(1) if os.environ.get('HEALTH_FAIL') else print('{\"ok\":true}')\n")
        self.executable("sleep", common)
        deploy = self.root / "deploy/aws/deploy.sh"
        deploy.parent.mkdir(parents=True)
        deploy.write_text(f"#!{sys.executable}\n" + common)
        deploy.chmod(0o700)

    def executable(self, name, body):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + body)
        path.chmod(0o700)

    def run_deploy(self, **overrides):
        result = subprocess.run(
            ["/bin/bash", str(self.script)], env={**self.env, **overrides},
            capture_output=True, text=True, timeout=10,
        )
        events = [json.loads(line) for line in self.events.read_text().splitlines()] if self.events.exists() else []
        return result, events

    def test_invalid_parameter_stops_before_git(self):
        result, events = self.run_deploy(SSM_Commit="a" * 40 + "; arbitrary-command")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(events, [])

    def test_foreign_origin_cannot_fetch_or_deploy(self):
        result, events = self.run_deploy(ORIGIN="https://token-secret@untrusted.invalid/repo.git")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("token-secret", result.stdout + result.stderr)
        self.assertFalse(any("fetch" in event or "reset" in event for event in events))

    def test_stale_commit_cannot_reset_or_deploy(self):
        result, events = self.run_deploy(SSM_Commit="c" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("reset" in event or event[0] == "deploy.sh" for event in events))

    def test_failed_fetch_cannot_reset(self):
        result, events = self.run_deploy(FETCH_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("reset" in event for event in events))

    def test_current_main_and_dev_heads_deploy(self):
        for commit in [self.env["MAIN_SHA"], self.env["DEV_SHA"]]:
            with self.subTest(commit=commit):
                self.events.unlink(missing_ok=True)
                result, events = self.run_deploy(SSM_Commit=commit)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(any("reset" in event and commit in event for event in events))
                self.assertEqual(sum(event[0] == "deploy.sh" for event in events), 1)
                self.assertEqual(sum(event[0] == "curl" for event in events), 1)

    def test_unhealthy_deploy_has_a_bounded_loopback_wait(self):
        result, events = self.run_deploy(HEALTH_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        health = [event for event in events if event[0] == "curl"]
        self.assertEqual(len(health), 24)
        self.assertTrue(all("http://127.0.0.1:3000/api/health" in event for event in health))


class GitCheckoutOwnership(unittest.TestCase):
    def test_release_reads_use_the_checkout_owner(self):
        for name, variable in [("deploy.sh", "ROOT"), ("setup-vm.sh", "APP_DIR")]:
            with self.subTest(script=name):
                source = Path(__file__).with_name(name).read_text()
                release = re.findall(r"^SENTRY_RELEASE=.*$", source, flags=re.MULTILINE)
                self.assertEqual(len(release), 1)
                self.assertIn('sudo -H -u ubuntu env GIT_TERMINAL_PROMPT=0 git -C', release[0])
                self.assertIn(f'"${variable}" rev-parse HEAD', release[0])

    def test_root_can_stamp_an_ubuntu_checkout_without_safe_directory(self):
        image = os.environ.get("SENTRY_GIT_OWNERSHIP_IMAGE")
        if not image:
            self.skipTest("use --ownership-container-image for the real root/ubuntu Git gate")
        subprocess.run(["docker", "image", "inspect", image], check=True, capture_output=True, timeout=10)
        assignments = []
        for name in ["deploy.sh", "setup-vm.sh"]:
            source_path = os.environ.get("SENTRY_DEPLOY_SOURCE") if name == "deploy.sh" else None
            source = (Path(source_path) if source_path else Path(__file__).with_name(name)).read_text()
            release = re.findall(r"^SENTRY_RELEASE=.*$", source, flags=re.MULTILINE)
            self.assertEqual(len(release), 1)
            check = release[0] + '; test "$SENTRY_RELEASE" = "$EXPECTED_RELEASE"'
            assignments.append(f"bash -c {shlex.quote(check)}")
        proof = """set -euo pipefail
useradd --create-home --uid 1000 --shell /bin/bash ubuntu
mkdir -p /opt/heytutor
chown ubuntu:ubuntu /opt/heytutor
sudo -H -u ubuntu git -C /opt/heytutor init --quiet
sudo -H -u ubuntu git -C /opt/heytutor -c user.name=Fixture -c user.email=fixture@example.invalid commit --quiet --allow-empty -m fixture
export EXPECTED_RELEASE="$(sudo -H -u ubuntu git -C /opt/heytutor rev-parse HEAD)"
if git -C /opt/heytutor rev-parse HEAD >/tmp/root-output 2>/tmp/root-error; then
  echo 'Fixture did not reproduce the unsafe root read' >&2
  exit 1
fi
grep -q 'dubious ownership' /tmp/root-error
export ROOT=/opt/heytutor APP_DIR=/opt/heytutor
cd /opt/heytutor
""" + "\n".join(assignments) + "\necho 'Real Git root/ubuntu release ownership passed'\n"
        result = subprocess.run(
            ["docker", "run", "--rm", "--pull=never", "--network=none", "--user=0",
             "--entrypoint=/bin/bash", "-i", image],
            input=proof, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Real Git root/ubuntu release ownership passed", result.stdout)


if __name__ == "__main__":
    if "--ownership-container-image" in sys.argv:
        position = sys.argv.index("--ownership-container-image")
        if position + 1 >= len(sys.argv):
            raise SystemExit("--ownership-container-image requires a cached image name")
        os.environ["SENTRY_GIT_OWNERSHIP_IMAGE"] = sys.argv[position + 1]
        del sys.argv[position:position + 2]
    unittest.main()
