/**
 * The landing hero voice is the live tutor's voice, played at natural pace,
 * with timings that line up with the spoken script.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAYBACK_SPEED, SEGMENTS } from "../../src/components/hero-lesson/lessonScript.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

assert.equal(
  PLAYBACK_SPEED,
  1,
  "hero audio must play at the tutor's natural pace — HTML playbackRate > 1 shifts pitch",
);

const timings = JSON.parse(read("public/hero/lesson-timings.json")) as {
  starts: number[];
  total: number;
};
assert.equal(
  timings.starts.length,
  SEGMENTS.length,
  "lesson-timings.json must have one start per spoken segment",
);
assert.ok(timings.starts[0] === 0, "the voiceover must start at t=0");
for (let i = 1; i < timings.starts.length; i++) {
  assert.ok(
    timings.starts[i] > timings.starts[i - 1],
    `segment ${i} must start after segment ${i - 1}`,
  );
}
assert.ok(
  timings.total > timings.starts[timings.starts.length - 1],
  "total duration must extend past the last segment start",
);
assert.ok(timings.total > 20 && timings.total < 60, "hero voiceover should be a ~half-minute take");

const mp3 = statSync(resolve(root, "public/hero/lesson.mp3"));
assert.ok(mp3.size > 200_000, "lesson.mp3 is missing or too small to be a real voiceover");

const generator = read("scripts/generate-hero-voice.mjs");
assert.match(generator, /style:\s*0\.35/, "generator must use the live tutor's style dial");
assert.match(generator, /speed:\s*0\.88/, "generator must use generation speed, not playbackRate");
assert.doesNotMatch(generator, /mp3_44100_96/, "hero voiceover should not be the old 96 kbps take");

for (const segment of SEGMENTS) {
  assert.ok(
    generator.includes(segment.speech),
    `generator is out of sync with lessonScript: missing "${segment.speech}"`,
  );
}

const hook = read("src/components/hero-lesson/useLessonSimulation.ts");
assert.match(hook, /preservesPitch/, "HTML playback must not shift pitch if rate ever changes");
assert.match(hook, /playsinline/, "iOS must be allowed to play the voiceover inline");

console.log(
  `verify-hero-voice: ${SEGMENTS.length} segments, ${timings.total.toFixed(1)}s natural-pace voiceover`,
);
