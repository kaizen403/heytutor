import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";

assert.match(lecturePageCacheKey([]), /@render-[a-f0-9]{64}$/,
  "answer-timing exports use automatic rendering-source identity, never released video10 keys");
// Exercise actual persistent-cache migration, pruning, read/write and failure semantics.
const result = spawnSync(process.execPath, ["--import", "tsx",
  fileURLToPath(new URL("./verify-lecture-cache-revisions.ts", import.meta.url)), "10"], {
  stdio: "inherit", env: process.env,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, "the prior deployed cache prunes obsolete answer-timing exports without a schema downgrade");
console.log("verify-answer-export-cache: automatic render fingerprint and persistent database migration pass; no providers");
