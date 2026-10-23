/** The cache-order guard needs main even in a depth-two dev/manual checkout. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../../../..");
const workflow = readFileSync(process.env.EXPORT_CACHE_WORKFLOW_TEST_SOURCE ?? path.join(root, ".github/workflows/deploy-tutor.yml"), "utf8");
const security = workflow.slice(workflow.indexOf("  security:"), workflow.indexOf("  deploy-dev:"));
const fetch = /- name: Fetch main for cache-order comparison\s+run: (git fetch[^\n]+)/.exec(security);
assert(fetch, "security must explicitly fetch the cache comparison base on dev and manual runs");
assert.equal(fetch[1], "git fetch --no-tags --depth=1 origin main:refs/remotes/origin/main");
assert.match(security.slice(0, fetch.index), /- name: Checkout[\s\S]*fetch-depth: 2/,
  "retain the PR merge parents as well as fetching the non-PR main comparison ref");
assert(fetch.index < security.indexOf("- name: Setup pnpm"), "fetch main immediately after the shallow checkout, before any gates");
const git = (cwd: string, ...args: string[]) => execFileSync("git", [
  "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args,
], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fixture = mkdtempSync(path.join(tmpdir(), "heytutor-cache-fetch-"));
try {
  git(fixture, "init", "--quiet", "--initial-branch=main", "seed");
  const seed = path.join(fixture, "seed");
  git(seed, "config", "user.name", git(root, "log", "-1", "--format=%an"));
  git(seed, "config", "user.email", git(root, "log", "-1", "--format=%ae"));
  const commit = (message: string) => {
    writeFileSync(path.join(seed, "fixture.txt"), message);
    git(seed, "add", "fixture.txt");
    git(seed, "commit", "--quiet", "-m", message);
    return git(seed, "rev-parse", "HEAD");
  };
  commit("Synthetic parent");
  const main = commit("Synthetic main");
  git(seed, "switch", "--quiet", "-c", "dev");
  commit("Synthetic dev trigger");
  const remote = path.join(fixture, "remote.git");
  git(fixture, "clone", "--quiet", "--bare", seed, remote);
  for (const [event, branch] of [["push-dev", "dev"], ["manual-dev", "dev"], ["push-main", "main"]] as const) {
    const checkout = path.join(fixture, event);
    git(fixture, "clone", "--quiet", "--depth=2", "--single-branch", "--branch", branch, pathToFileURL(remote).href, checkout);
    assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "true");
    if (branch === "dev") assert.throws(() => git(checkout, "rev-parse", "--verify", "origin/main^{commit}"),
      `${event}: checkout alone must reproduce the missing comparison ref`);
    // Execute the real workflow's argv against the local file:// remote only.
    git(checkout, ...fetch[1]!.split(" ").slice(1));
    assert.equal(git(checkout, "rev-parse", "--verify", "origin/main^{commit}"), main,
      `${event}: the exact workflow fetch makes the deployed base available`);
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log("verify-export-cache-workflow: shallow dev/manual/main comparison refs available; local Git only, no providers");
