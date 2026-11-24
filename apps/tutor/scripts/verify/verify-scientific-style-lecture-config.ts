import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { resolveScientificStyleLecture, scientificStyleLectureIdentity } from "../../lib/scene/scientificStyleLecture.server";

async function main() {
const directory = mkdtempSync(join(tmpdir(), "heytutor-scientific-style-"));
try {
  const path = join(directory, "sample.png");
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#0b4a48" } }).png().toBuffer();
  writeFileSync(path, png);
  assert.equal(await resolveScientificStyleLecture({ SCIENTIFIC_STYLE_SAMPLE_PATH: path }), null, "mode defaults off");
  const env = { SCIENTIFIC_STYLE_LECTURES: "on", SCIENTIFIC_STYLE_SAMPLE_PATH: path };
  const identity = scientificStyleLectureIdentity(env);
  assert.equal(identity.sampleHash, createHash("sha256").update(png).digest("hex"));
  assert.deepEqual(await resolveScientificStyleLecture(env), {
    schema: "scientific-style-lecture/v1", paletteId: "teal", sampleHash: identity.sampleHash,
  }, "a validated existing sample must enable native lecture styling without generation");
  const previousHash = identity.sampleHash;
  writeFileSync(path, Buffer.from("this is not a valid PNG"));
  assert.notEqual(scientificStyleLectureIdentity(env).sampleHash, previousHash, "a changed sample changes execution identity");
  assert.equal(await resolveScientificStyleLecture(env), null, "invalid current bytes cannot reuse a previously valid cache");
  assert.equal(await resolveScientificStyleLecture({ ...env, SCIENTIFIC_STYLE_SAMPLE_PATH: join(directory, "missing") }), null);
  assert.equal(scientificStyleLectureIdentity({ SCIENTIFIC_STYLE_LECTURES: "off", SCIENTIFIC_STYLE_SAMPLE_PATH: path }).sampleHash, null);
  console.log("scientific style config: default off, complete sample validation, content identity and invalidation pass");
} finally { rmSync(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
