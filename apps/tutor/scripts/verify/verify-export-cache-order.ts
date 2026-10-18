/** A normal PR merge must not reuse exports made by a different behavior. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";

const root = path.resolve(import.meta.dirname, "../../../..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const revisionFile = "apps/tutor/lib/lecture-export/canExportLectureMp4.ts";
function revision(source: string): number {
  const match = /export const LECTURE_PAGE_CACHE_REVISION\s*=\s*["']video(\d+)["']/.exec(source);
  const value = Number(match?.[1]);
  assert(Number.isSafeInteger(value) && value > 0, "the actual cache constant must be a positive video revision");
  return value;
}
const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : undefined;
const eventBase: unknown = event?.pull_request?.base?.sha;
if (eventBase !== undefined) assert(typeof eventBase === "string" && /^[a-f0-9]{40}$/i.test(eventBase), "pull_request base.sha must be a full commit SHA");
const base = typeof eventBase === "string" ? eventBase : "origin/main";
git("rev-parse", "--verify", `${base}^{commit}`);
const previous = revision(git("show", `${base}:${revisionFile}`));
const current = revision(readFileSync(path.join(root, revisionFile), "utf8"));
assert.equal(Number(/@video(\d+)$/.exec(lecturePageCacheKey([]))?.[1]), current, "the real page key must include the current numeric revision");
const productPaths = [
  "apps/tutor/lib/lecture-export", "apps/tutor/lib/code-lesson/persistedCodeLesson.ts",
  "apps/tutor/features/tutor-session/lib/replay", "apps/tutor/features/tutor-session/lib/scene/answerLabelReveal.ts",
  "packages/whiteboard/src",
];
const changed = [git("diff", "--name-only", base, "--", ...productPaths),
  git("ls-files", "--others", "--exclude-standard", "--", ...productPaths)]
  .join("\n").split("\n").some((file) => file && !/(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
assert(current >= previous && (!changed || current > previous),
  `cache order: video${current} cannot follow base video${previous}${changed ? " with changed cached-export behavior; advance the revision" : " backwards"}`);
if (current > previous) {
  // Test the real IndexedDB open/upgrade/cursor using this exact deployed base.
  const result = spawnSync(process.execPath, ["--import", "tsx",
    fileURLToPath(new URL("./verify-lecture-cache-revisions.ts", import.meta.url)), String(previous)], {
    cwd: path.join(root, "apps/tutor"), stdio: "inherit", env: process.env,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `the real cache must upgrade and prune from video${previous}`);
}
console.log(`verify-export-cache-order: video${previous} -> video${current}; ${changed ? "product changed" : "unchanged product"}; no providers`);
