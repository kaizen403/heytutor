import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSentryRelease } from "./set-sentry-release.mjs";

function assertBefore(source, first, later) {
  const firstIndex = source.indexOf(first);
  assert.ok(firstIndex >= 0 && firstIndex < source.indexOf(later), `${first} must precede ${later}`);
}

const root = mkdtempSync(join(tmpdir(), "heytutor-release-"));
try {
  const file = join(root, "env"); const release = "a".repeat(40);
  const secretFixture = "SENTRY_DSN=synthetic-private-value\nDATABASE_URL=synthetic-private-value\n";
  writeFileSync(file, secretFixture, { mode: 0o640 });
  setSentryRelease(file, release);
  assert.equal(readFileSync(file, "utf8"), `${secretFixture}SENTRY_RELEASE=${release}\nSENTRY_ENVIRONMENT=production\n`);
  assert.equal(statSync(file).mode & 0o777, 0o640);
  const inode = statSync(file).ino;
  setSentryRelease(file, release);
  assert.equal(statSync(file).ino, inode, "idempotent update must not replace the file");
  writeFileSync(file, `${secretFixture}export SENTRY_RELEASE="old"\nSENTRY_RELEASE=duplicate\n`);
  setSentryRelease(file, release);
  assert.equal(readFileSync(file, "utf8").match(/^SENTRY_RELEASE=/gm)?.length, 1);
  assert.ok(readFileSync(file, "utf8").startsWith(secretFixture));
  assert.throws(() => setSentryRelease(file, "invalid"));
  const link = join(root, "link"); symlinkSync(file, link);
  assert.throws(() => setSentryRelease(link, release));
  const script = readFileSync(new URL("./deploy.sh", import.meta.url), "utf8");
  assertBefore(script, 'export SENTRY_RELEASE', 'pnpm turbo run build');
  assertBefore(script, 'export SENTRY_ENVIRONMENT=production', 'pnpm turbo run build');
  assertBefore(script, 'set-sentry-release.mjs', 'sudo systemctl restart heytutor');
  assert.ok(script.includes('sudo node "$ROOT/deploy/aws/set-sentry-release.mjs"'), "release stamping preserves privileged env ownership on manual deployments");
  const setup = readFileSync(new URL("./setup-vm.sh", import.meta.url), "utf8");
  assertBefore(setup, 'export SENTRY_RELEASE', 'pnpm turbo run build');
  assertBefore(setup, 'export SENTRY_ENVIRONMENT=production', 'pnpm turbo run build');
  assertBefore(setup, 'set-sentry-release.mjs', 'systemctl restart heytutor');
  assert.ok(setup.includes('node "$APP_DIR/deploy/aws/set-sentry-release.mjs" "$ENV_FILE" "$SENTRY_RELEASE"'), "first setup stamps the environment file before the service starts");
  console.log("Sentry release deployment regression passed");
} finally { rmSync(root, { recursive: true, force: true }); }
