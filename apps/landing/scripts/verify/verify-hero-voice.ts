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
assert.ok(timings.total > 60 && timings.total < 180, "the complete worked lesson should run at a natural teaching pace");

const mp3 = statSync(resolve(root, "public/hero/lesson.mp3"));
assert.ok(mp3.size > 200_000, "lesson.mp3 is missing or too small to be a real voiceover");

const generator = read("scripts/generate-hero-voice.mjs");
assert.match(generator, /generateLandingVoice/, "voice generation must use the current tutor provider");
const speechGenerator = read("../tutor/scripts/lecture-lab/generateLandingVoice.ts");
assert.match(speechGenerator, /voiceSettingsForDelivery/, "reuse the live delivery settings");
assert.match(speechGenerator, /requestTts/, "reuse the live provider adapter");
assert.match(speechGenerator, /lessonAsset.json/, "speech and ink must share one captured lesson");
const asset = JSON.parse(read("src/components/hero-lesson/lessonAsset.json"));
assert.equal(asset.voice.provider, "cartesia");
assert.equal(asset.voice.model, "sonic-3.6");
for (const [index, segment] of asset.segments.entries()) {
  assert.equal(SEGMENTS[index].speech, segment.narration);
  assert.ok(Math.abs(segment.timings.totalDuration - ((timings.starts[index + 1] ?? timings.total) - timings.starts[index])) < 0.001, `duration ${index}`);
}

const hook = read("src/components/hero-lesson/useLessonSimulation.ts");
assert.match(hook, /createHeroAudioEngine/, "hero voiceover plays through the audio engine, not a raw HTMLAudioElement");
assert.match(hook, /decideHeroAudioTick/, "rAF must not seek or re-play(); start/stop come from the clock policy");

const engine = read("src/components/hero-lesson/heroAudioEngine.ts");
assert.match(engine, /preservesPitch|decodeAudioData/, "playback must not shift pitch — decode the take, don't speed the element");
assert.match(engine, /playsinline/, "HTML fallback must play the voiceover inline on iOS");
assert.match(engine, /AudioContext/, "Web Audio keeps the unlock so a loop wrap does not need a new tap");

console.log(
  `verify-hero-voice: ${SEGMENTS.length} segments, ${timings.total.toFixed(1)}s natural-pace voiceover`,
);
