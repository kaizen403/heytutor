import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { verifyBracesApi } from "./bracesDepth.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const LEVELS = ["info", "low", "moderate", "high", "critical"];
const BRACES_FILES = ["LICENSE", "index.js", "package.json", "lib/compile.js", "lib/constants.js", "lib/expand.js", "lib/parse.js", "lib/stringify.js", "lib/utils.js"];
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

export function validateException(exception) {
  assert.equal(exception.schemaVersion, 1);
  assert.equal(exception.advisory, "GHSA-vfj7-8cjw-p6xm");
  assert.equal(exception.package, "braces");
  assert.equal(exception.version, "3.0.3");
  assert.equal(exception.patch, "patches/braces@3.0.3.patch");
  assert.match(exception.patchSha256, /^[a-f0-9]{64}$/);
  assert.match(exception.expiresAt, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  assert(Number.isFinite(Date.parse(exception.expiresAt)), "invalid exception expiry");
  assert.equal(new Date(Date.parse(exception.expiresAt)).toISOString(), exception.expiresAt, "exception expiry must be a real UTC date");
  assert.deepEqual(Object.keys(exception.sourceSha256).sort(), [...BRACES_FILES].sort(), "every runtime file must be fingerprinted");
  for (const hash of Object.values(exception.sourceSha256)) assert.match(hash, /^[a-f0-9]{64}$/);
}

export function collectBracesDirectories(tree) {
  assert(Array.isArray(tree), "pnpm list must return a workspace array");
  const pending = [...tree];
  const directories = new Set();
  while (pending.length > 0) {
    const item = pending.pop();
    assert(item && typeof item === "object", "invalid dependency tree item");
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, dependency] of Object.entries(item[group] ?? {})) {
        assert(dependency && typeof dependency === "object", "invalid dependency entry");
        if (name === "braces" || dependency.from === "braces" || dependency.name === "braces" || /[/\\]braces$/.test(dependency.path ?? "")) {
          assert.equal(typeof dependency.path, "string", "braces resolution needs an installed path");
          directories.add(realpathSync(dependency.path));
        }
        pending.push(dependency);
      }
    }
  }
  return [...directories].sort();
}

export function verifyBracesDirectory(directory, exception) {
  validateException(exception);
  const manifest = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
  assert.equal(manifest.name, exception.package, "a renamed package is not remediation");
  assert.equal(manifest.version, exception.version, "the exception applies only to braces 3.0.3");
  for (const [file, expected] of Object.entries(exception.sourceSha256)) {
    assert.equal(sha256(resolve(directory, file)), expected, `installed braces source differs from reviewed evidence: ${file}`);
  }
  const requirePackage = createRequire(resolve(directory, "package.json"));
  verifyBracesApi(requirePackage(directory));
}

export function verifyReviewedPatch(root, exception) {
  validateException(exception);
  assert.equal(sha256(resolve(root, exception.patch)), exception.patchSha256, "the reviewed patch is missing or changed");
}

export function classifyAudit(report, exception, verified, now = Date.now()) {
  validateException(exception);
  assert(!Object.hasOwn(report ?? {}, "error"), "audit response contains an error; no exception can be applied");
  assert(report && typeof report.advisories === "object" && !Array.isArray(report.advisories), "audit response is missing advisories");
  assert(report.advisories !== null, "audit response is missing advisories");
  assert(Array.isArray(report.muted) && report.muted.length === 0, "audit ignore configuration must not suppress advisories");
  const counts = Object.fromEntries(LEVELS.map((level) => [level, 0]));
  const unmitigated = [];
  const mitigated = [];
  for (const advisory of Object.values(report.advisories)) {
    assert(advisory && LEVELS.includes(advisory.severity), "audit response has an unknown severity");
    counts[advisory.severity]++;
    const covered = verified === true && now < Date.parse(exception.expiresAt) &&
      advisory.github_advisory_id === exception.advisory && advisory.module_name === exception.package &&
      Array.isArray(advisory.findings) && advisory.findings.length > 0 &&
      advisory.findings.every((finding) => finding.version === exception.version &&
        Array.isArray(finding.paths) && finding.paths.length > 0 &&
        finding.paths.every((path) => typeof path === "string" && path.length > 0));
    (covered ? mitigated : unmitigated).push(advisory);
  }
  for (const level of LEVELS) {
    assert.equal(report.metadata?.vulnerabilities?.[level], counts[level], `audit counts disagree for ${level}`);
  }
  return { mitigated, unmitigated };
}

function readPnpmJson(args) {
  const result = spawnSync("pnpm", args, { cwd: ROOT, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  assert(!result.error && result.signal === null && (result.status === 0 || (args[0] === "audit" && result.status === 1)), "pnpm dependency inspection could not complete");
  try {
    const report = JSON.parse(result.stdout);
    if (args[0] === "audit" && result.status === 1 && Object.keys(report.advisories ?? {}).length === 0) {
      throw new Error("failed audit without a vulnerability report");
    }
    return report;
  } catch {
    throw new Error("pnpm dependency inspection returned malformed JSON; no exception was applied");
  }
}

export function auditDependencies() {
  const exception = JSON.parse(readFileSync(resolve(ROOT, "tools/security/bracesException.json"), "utf8"));
  verifyReviewedPatch(ROOT, exception);
  const directories = collectBracesDirectories(readPnpmJson(["list", "-r", "braces", "--depth", "Infinity", "--json"]));
  assert(directories.length > 0, "braces is no longer installed; retire the temporary exception");
  for (const directory of directories) verifyBracesDirectory(directory, exception);
  console.log(`Verified the reviewed patch and exploit regressions for ${directories.length} active braces@3.0.3 installation(s).`);
  const report = readPnpmJson(["audit", "--audit-level", "low", "--json"]);
  const result = classifyAudit(report, exception, true);
  for (const advisory of result.mitigated) {
    console.log(`MITIGATED ${advisory.severity}: ${advisory.github_advisory_id} (${advisory.module_name}@${exception.version}); reviewed depth guard verified; exception expires ${exception.expiresAt}.`);
  }
  for (const advisory of result.unmitigated) {
    console.error(`UNMITIGATED ${advisory.severity}: ${advisory.github_advisory_id ?? advisory.id} (${advisory.module_name}).`);
  }
  console.log(`Dependency audit: ${result.mitigated.length} verified temporary exception(s), ${result.unmitigated.length} unmitigated advisories.`);
  return result.unmitigated.length === 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (!auditDependencies()) process.exitCode = 1;
  } catch (error) {
    console.error(`Dependency security verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
