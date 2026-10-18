import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";

const revision = /@video(\d+)$/.exec(lecturePageCacheKey([]));
assert(revision && Number(revision[1]) >= 11,
  "exports with early answer labels must not reuse the released video10 caches");
// Reuse the real IndexedDB upgrade/cursor controls, with the versions that can
// precede this PR. MP4/WebM old blobs are freed; current/future/unknown survive.
const result = spawnSync(process.execPath, ["--import", "tsx",
  fileURLToPath(new URL("./verify-lecture-cache-revisions.ts", import.meta.url)), "10"], {
  stdio: "inherit", env: process.env,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, "the prior deployed cache upgrades and prunes obsolete answer-timing exports");
console.log("verify-answer-export-cache: video11 minimum and real database upgrade from video10 pass; no providers");
