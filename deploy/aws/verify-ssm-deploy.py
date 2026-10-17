"""Offline integration of trusted Git boundary and immutable release activation.

Runs the actual shell drivers, Git archive, filesystem operations and artifact
verifier. Fakes package builds, service manager and health transport only.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

AWS = Path(__file__).resolve().parent


class DeploymentBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="heytutor-deploy-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.source = self.base / "source"
        self.releases = self.base / "releases"
        self.current = self.base / "current"
        self.unit = self.base / "heytutor.service"
        self.unit.write_text("legacy service\n")
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.events = self.base / "events.jsonl"
        self.source.mkdir()
        (self.base / "meminfo").write_text("MemTotal: 4194304 kB\nMemAvailable: 3145728 kB\n")
        self.real_git = shutil.which("git")
        self.real_node = shutil.which("node")
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "EVENTS": str(self.events), "FIXTURE": str(self.base),
                    "ORIGIN": "https://github.com/kaizen403/heytutor.git",
                    "REAL_GIT": self.real_git, "REAL_NODE": self.real_node}
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Fixture")
        dest = self.source / "deploy/aws"
        dest.mkdir(parents=True)
        replacements = {"/opt/heytutor-releases": str(self.releases),
                        "/opt/heytutor-current": str(self.current),
                        "/opt/heytutor": str(self.source),
                        "/etc/systemd/system/heytutor.service": str(self.unit),
                        "/var/lock/heytutor-deploy.lock": str(self.base / "lock"),
                        "/var/lib/heytutor": str(self.base / "home"),
                        "/usr/bin/bash": "/bin/bash",
                        "/proc/meminfo": str(self.base / "meminfo")}
        for name in ["deploy.sh", "ssm-deploy.sh", "build-release.sh", "verify-release.mjs"]:
            text = (AWS / name).read_text()
            for old, new in replacements.items():
                text = text.replace(old, new)
            (dest / name).write_text(text)
        tutor = self.source / "apps/tutor"
        (tutor / ".next").mkdir(parents=True)
        (tutor / ".next/BUILD_ID").write_text("legacy-build")
        (tutor / "server.ts").write_text("legacy-server")
        (tutor / ".env.production").write_text("DATABASE_URL=fixture\nSENTRY_RELEASE=stale\nSENTRY_ENVIRONMENT=development\n")
        (self.source / ".gitignore").write_text(".env.production\n.next\n")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.sha = self.git("rev-parse", "HEAD").strip()
        self.env.update(SSM_Commit=self.sha, MAIN_SHA=self.sha, DEV_SHA="b" * 40)
        self.common = "import os, sys, json\nwith open(os.environ['EVENTS'], 'a') as f: f.write(json.dumps([os.path.basename(sys.argv[0]), *sys.argv[1:]]) + '\\n')\n"
        self.exe("sudo", "assert sys.argv[1:4] == ['-H', '-u', 'ubuntu']\nos.execvp(sys.argv[4], sys.argv[4:])\n")
        self.exe("git", """
args = sys.argv[3:]
if args[:2] == ['remote', 'get-url']: print(os.environ['ORIGIN'])
elif args[0] == 'fetch': sys.exit(int(os.environ.get('FETCH_FAIL', '0')))
elif args[0] == 'rev-parse' and 'refs/remotes/' in args[1]: print(os.environ['MAIN_SHA' if args[1].endswith('/main') else 'DEV_SHA'])
else: os.execv(os.environ['REAL_GIT'], ['git', *sys.argv[1:]])
""")
        for name in ["ffmpeg", "ffprobe", "corepack", "chown", "chgrp", "useradd"]:
            self.exe(name, "")
        self.exe("id", "print('0') if '-u' in sys.argv else None\n")
        self.exe("flock", "sys.exit(1 if os.environ.get('LOCK_FAIL') else 0)\n")
        self.exe("systemd-run", "i=sys.argv.index('/bin/bash'); os.execv('/bin/bash', sys.argv[i:])\n")
        self.exe("systemctl", "sys.exit(1 if os.environ.get('RESTART_FAIL') and sys.argv[1:]==['restart','heytutor'] else 0)\n")
        # macOS mv has no -T. Emulate GNU atomic replacement without dereference.
        self.exe("mv", "os.replace(sys.argv[-2], sys.argv[-1])\n")
        self.exe("pnpm", """
from pathlib import Path
if 'build' in sys.argv:
    out=Path('apps/tutor/.next'); out.mkdir(parents=True,exist_ok=True)
    (out/'BUILD_ID').write_text('new-build')
    if os.environ.get('BUILD_FAIL'): sys.exit(137)
    for p in ['required-server-files.json','server/app-paths-manifest.json','build-manifest.json']:
        f=out/p; f.parent.mkdir(parents=True,exist_ok=True); f.write_text('{}')
    (out/'static').mkdir(exist_ok=True)
if 'scripts/live/deploy-migrations.ts' in sys.argv and os.environ.get('MIGRATE_FAIL'): sys.exit(1)
""")
        self.exe("node", """
if sys.argv[1] == '-p': print(24)
elif len(sys.argv)>3:
    sys.exit(1 if os.environ.get('HEALTH_FAIL') else 0)
else: os.execv(os.environ['REAL_NODE'], ['node', *sys.argv[1:]])
""")

    def git(self, *args):
        return subprocess.check_output([self.real_git, "-C", str(self.source), *args], text=True)

    def exe(self, name, body):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + self.common + body)
        path.chmod(0o700)

    def run_deploy(self, **overrides):
        result = subprocess.run(["/bin/bash", str(self.source / "deploy/aws/ssm-deploy.sh")],
                                env={**self.env, **overrides}, capture_output=True, text=True, timeout=15)
        events = [json.loads(line) for line in self.events.read_text().splitlines()] if self.events.exists() else []
        self.assertEqual((self.source / "apps/tutor/.next/BUILD_ID").read_text(), "legacy-build")
        self.assertEqual((self.source / "apps/tutor/server.ts").read_text(), "legacy-server")
        self.assertFalse(any("reset" in event for event in events))
        return result, events

    def test_release_identity_crosses_turbo_build_environment(self):
        config = json.loads((AWS.parent.parent / "turbo.json").read_text())
        self.assertTrue({"SENTRY_ENVIRONMENT", "SENTRY_RELEASE", "NEXT_PUBLIC_SENTRY_ENVIRONMENT", "NEXT_PUBLIC_SENTRY_RELEASE"}.issubset(config["tasks"]["build"]["env"]))

    def test_invalid_parameter_stops_before_git(self):
        result, events = self.run_deploy(SSM_Commit="a" * 40 + "; command")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(events, [])

    def test_foreign_origin_cannot_fetch(self):
        result, events = self.run_deploy(ORIGIN="https://token-secret@untrusted.invalid/repo.git")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("token-secret", result.stdout + result.stderr)
        self.assertFalse(any("fetch" in event for event in events))

    def test_stale_commit_cannot_deploy(self):
        result, events = self.run_deploy(SSM_Commit="c" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("archive" in event for event in events))

    def test_failed_fetch_cannot_deploy(self):
        result, events = self.run_deploy(FETCH_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("archive" in event for event in events))

    def test_build_oom_preserves_live_artifacts_and_service(self):
        result, events = self.run_deploy(BUILD_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.unit.read_text(), "legacy service\n")
        self.assertFalse(self.current.exists())
        self.assertFalse(any(event[0] == "systemctl" or 'scripts/live/deploy-migrations.ts' in event for event in events))

    def test_migration_failure_prevents_activation(self):
        result, events = self.run_deploy(MIGRATE_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.unit.read_text(), "legacy service\n")
        self.assertFalse(any(event[0] == "systemctl" for event in events))

    def test_health_failure_restores_legacy_unit(self):
        result, events = self.run_deploy(HEALTH_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.unit.read_text(), "legacy service\n")
        self.assertFalse(self.current.exists())
        self.assertEqual(events.count(["systemctl", "restart", "heytutor"]), 2)

    def test_success_sets_release_identity_and_link(self):
        result, events = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.current.is_symlink())
        release = self.current.resolve()
        self.assertEqual((release / 'apps/tutor/.next/BUILD_ID').read_text(), "new-build")
        self.assertIn(f'SENTRY_RELEASE={self.sha}', (release / 'runtime.env').read_text())
        self.assertIn('SENTRY_ENVIRONMENT=production', (release / 'runtime.env').read_text())
        self.assertIn(f'EnvironmentFile={self.current}/runtime.env', self.unit.read_text())
        self.assertTrue(any('-p' in event and 'MemoryMax=2576979968' in event for event in events))

    def test_health_failure_restores_previous_release(self):
        previous = self.base / "previous"
        previous.mkdir()
        self.current.symlink_to(previous)
        result, _ = self.run_deploy(HEALTH_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.current.resolve(), previous)
        self.assertEqual(self.unit.read_text(), "legacy service\n")

    def test_fresh_install_creates_service(self):
        self.unit.unlink()
        result, _ = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.unit.exists())

    def test_fresh_install_failure_removes_service(self):
        self.unit.unlink()
        result, events = self.run_deploy(HEALTH_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.unit.exists())
        self.assertIn(["systemctl", "stop", "heytutor"], events)

    def test_running_node_keeps_old_release_for_lazy_imports(self):
        old = self.base / "old-release"
        new = self.base / "new-release"
        for directory, value in [(old, "old"), (new, "new")]:
            directory.mkdir()
            (directory / "lazy.mjs").write_text(f'export default "{value}";')
        self.current.symlink_to(old)
        code = "console.log('ready'); process.stdin.once('data', async () => { const p = require('node:path').resolve('lazy.mjs'); console.log((await import(require('node:url').pathToFileURL(p).href)).default); });"
        child = subprocess.Popen([self.real_node, "-e", code], cwd=self.current,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(child.stdout.readline().strip(), "ready")
        temporary = self.base / "next-link"
        temporary.symlink_to(new)
        os.replace(temporary, self.current)
        output, errors = child.communicate("continue\n", timeout=5)
        self.assertEqual(child.returncode, 0, errors)
        self.assertEqual(output.strip(), "old", "old process must not lazy-load the next release")

    def test_low_memory_refuses_before_build_or_activation(self):
        (self.base / "meminfo").write_text("MemTotal: 2097152 kB\nMemAvailable: 900000 kB\n")
        result, events = self.run_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Insufficient free build memory", result.stderr)
        self.assertFalse(any(event[0] == "systemd-run" or event[0] == "systemctl" for event in events))

    def test_lock_rejects_concurrent_deploy(self):
        result, events = self.run_deploy(LOCK_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("archive" in event for event in events))

if __name__ == "__main__":
    unittest.main()
