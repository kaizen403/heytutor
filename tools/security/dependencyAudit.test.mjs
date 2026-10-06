import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { classifyAudit, collectBracesDirectories, validateException, verifyBracesDirectory, verifyReviewedPatch } from "./dependencyAudit.mjs";

const exception = JSON.parse(readFileSync(new URL("./bracesException.json", import.meta.url), "utf8"));
const BEFORE_EXPIRY = Date.parse("2026-10-03T00:00:00.000Z");
const base = { github_advisory_id: exception.advisory, module_name: "braces", severity: "high", findings: [{ version: "3.0.3", paths: ["landing>tailwindcss>chokidar>braces"] }] };
function report(advisories) {
  const vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const entry of advisories) vulnerabilities[entry.severity]++;
  return { advisories: Object.fromEntries(advisories.map((entry, index) => [index, entry])), muted: [], metadata: { vulnerabilities } };
}

test("only the verified advisory and exact version are excepted", () => {
  assert.equal(classifyAudit(report([base]), exception, true, BEFORE_EXPIRY).mitigated.length, 1);
  for (const changed of [
    { ...base, github_advisory_id: "GHSA-aaaa-bbbb-cccc" },
    { ...base, github_advisory_id: undefined },
    { ...base, module_name: "another-package" },
    { ...base, findings: [{ version: "3.0.2" }] },
    { ...base, findings: [{ version: "3.0.3" }, { version: "2.3.2" }] },
    { ...base, findings: [] },
    { ...base, findings: [{ version: "3.0.3", paths: [] }] },
  ]) {
    assert.equal(classifyAudit(report([changed]), exception, true, BEFORE_EXPIRY).unmitigated.length, 1);
  }
});

test("all other severities and advisories still fail the gate", () => {
  for (const severity of ["info", "low", "moderate", "high", "critical"]) {
    const extra = { ...base, github_advisory_id: "GHSA-1111-2222-3333", severity };
    const result = classifyAudit(report([base, extra]), exception, true, BEFORE_EXPIRY);
    assert.equal(result.mitigated.length, 1);
    assert.equal(result.unmitigated.length, 1);
  }
});

test("missing verification and expiry cannot waive the vulnerability", () => {
  assert.equal(classifyAudit(report([base]), exception, false, BEFORE_EXPIRY).unmitigated.length, 1);
  assert.equal(classifyAudit(report([base]), exception, {}, BEFORE_EXPIRY).unmitigated.length, 1);
  assert.equal(classifyAudit(report([base]), exception, true, Date.parse(exception.expiresAt)).unmitigated.length, 1);
  assert.equal(classifyAudit(report([base]), exception, true, Date.parse(exception.expiresAt) + 1).unmitigated.length, 1);
});

test("malformed, muted and inconsistent audit responses fail closed", () => {
  for (const invalid of [
    {}, { advisories: null }, { advisories: [] },
    { ...report([]), error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE" } },
    { ...report([base]), muted: [base] },
    { ...report([base]), metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } },
    report([{ ...base, severity: "unknown" }]),
  ]) assert.throws(() => classifyAudit(invalid, exception, true, BEFORE_EXPIRY));
});

test("exception cannot lose runtime fingerprints or expand to another advisory", () => {
  for (const invalid of [
    { ...exception, advisory: "GHSA-other-advisory" },
    { ...exception, version: "3.0.4" },
    { ...exception, patch: "patches/unreviewed.patch" },
    { ...exception, patchSha256: "" },
    { ...exception, expiresAt: "never" },
    { ...exception, expiresAt: "2026-02-31T00:00:00.000Z" },
    { ...exception, expiresAt: "2026-11-03T00:00:00.000Z" },
    { ...exception, sourceSha256: { "lib/parse.js": exception.sourceSha256["lib/parse.js"] } },
  ]) assert.throws(() => validateException(invalid));
});

test("all dependency groups and physical copies are inspected", () => {
  const requireLanding = createRequire(resolve("apps/landing/package.json"));
  const requireTailwind = createRequire(requireLanding.resolve("tailwindcss/package.json"));
  const requireChokidar = createRequire(requireTailwind.resolve("chokidar/package.json"));
  const actual = dirname(requireChokidar.resolve("braces/package.json"));
  const temporary = mkdtempSync(resolve(tmpdir(), "heytutor-braces-policy-"));
  try {
    cpSync(actual, temporary, { recursive: true });
    const tree = [{ dependencies: { tool: { optionalDependencies: { braces: { path: actual } } } }, devDependencies: { braces: { path: temporary } } }];
    const copies = collectBracesDirectories(tree);
    assert.equal(copies.length, 2);
    verifyBracesDirectory(actual, exception);
    writeFileSync(resolve(temporary, "lib/parse.js"), readFileSync(resolve(temporary, "lib/parse.js"), "utf8") + "\n");
    assert.throws(() => verifyBracesDirectory(temporary, exception), /source differs from reviewed evidence/);
    const manifest = JSON.parse(readFileSync(resolve(temporary, "package.json"), "utf8"));
    writeFileSync(resolve(temporary, "package.json"), JSON.stringify({ ...manifest, name: "renamed-braces" }));
    assert.throws(() => verifyBracesDirectory(temporary, exception), /renamed package is not remediation/);
    writeFileSync(resolve(temporary, "package.json"), JSON.stringify({ ...manifest, version: "3.0.4" }));
    assert.throws(() => verifyBracesDirectory(temporary, exception), /only to braces 3.0.3/);
    assert.throws(() => collectBracesDirectories([{ dependencies: { braces: {} } }]), /installed path/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("missing or tampered patch evidence cannot enable the exception", () => {
  const temporary = mkdtempSync(resolve(tmpdir(), "heytutor-braces-patch-"));
  try {
    mkdirSync(resolve(temporary, "patches"));
    const patch = resolve(temporary, exception.patch);
    assert.throws(() => verifyReviewedPatch(temporary, exception), /ENOENT/);
    cpSync(resolve(exception.patch), patch);
    verifyReviewedPatch(temporary, exception);
    writeFileSync(patch, readFileSync(patch, "utf8") + "\n");
    assert.throws(() => verifyReviewedPatch(temporary, exception), /missing or changed/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
