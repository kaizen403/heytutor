"""Exercise the deployment boundary using fake Git, sudo, health and deploy.

No cloud credentials, network requests, service changes or real checkout are
used. Only the fixed cd is redirected to a disposable fixture directory.
"""
import json
import os
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
