/**
 * The landing "Hear this lesson" voice must not cut off on phones, and the
 * pen must follow it. These cases are the production failure: a rAF loop
 * re-issued play() / currentTime seeks, IntersectionObserver flickered, and
 * the sentence died in the middle.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  audioContextNeedsResume,
  decideHeroAudioTick,
  HERO_SILENT_UNLOCK_SRC,
  HERO_VISIBILITY_PAUSE_MS,
  isUnlockBlockingError,
  lessonOffsetSec,
  shouldPauseHeroLesson,
  snapToNarrationIfDeadAir,
  startTimeMsToMatchAudio,
  type HeroAudioTickInput,
} from "../../src/components/hero-lesson/heroAudioClock.ts";
import {
  fallbackTiming,
  loopDuration,
  teachStart,
} from "../../src/components/hero-lesson/lessonScript.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const timing = fallbackTiming();
const teach = teachStart();

const playing: HeroAudioTickInput = {
  soundOn: true,
  lessonOffsetSec: 4,
  totalSec: timing.total,
  playing: true,
  startInFlight: false,
  unlocked: true,
  ready: true,
  ioVisible: true,
  docVisible: true,
  hiddenForMs: 0,
};

function tick(over: Partial<HeroAudioTickInput>) {
  return decideHeroAudioTick({ ...playing, ...over });
}

// ── overlapping play() is what aborts iOS ─────────────────────────────────
{
  const d = tick({ playing: false, startInFlight: true });
  assert.equal(d.startOffsetSec, null, "must not issue a second start() while one is in flight");
  assert.equal(d.stop, false);
}

{
  const d = tick({ playing: false, startInFlight: false });
  assert.equal(d.startOffsetSec, 4, "the first start in a narration window is allowed");
}

{
  const d = tick({ playing: true, startInFlight: false });
  assert.equal(d.startOffsetSec, null, "must not restart a voice that is already speaking");
  assert.equal(d.slaveClock, true, "the lesson clock follows the voice, never the other way around");
  assert.equal(d.stop, false);
}

// ── no seek action exists ─────────────────────────────────────────────────
{
  const d = tick({ playing: true });
  assert.equal("seek" in d, false, "seeking the media element is not a legal tick action");
  assert.deepEqual(Object.keys(d).sort(), ["slaveClock", "startOffsetSec", "stop"]);
}

// ── loop wrap: stop at the end, start at the next narration, no gesture ───
{
  const d = tick({ lessonOffsetSec: timing.total + 0.05, playing: true });
  assert.equal(d.stop, true, "speech stops for hold/clear; silence is not a seek to 0");
  assert.equal(d.startOffsetSec, null);
}

{
  const d = tick({ lessonOffsetSec: 0, playing: false });
  assert.equal(d.startOffsetSec, 0, "after wrap, start at 0 on the already-unlocked context");
}

{
  const d = tick({ lessonOffsetSec: 0, playing: false, unlocked: false });
  assert.equal(d.startOffsetSec, null, "a tick must not start before the Hear-this-lesson gesture");
}

{
  const d = tick({ playing: false, ready: false });
  assert.equal(d.startOffsetSec, null, "do not start before the buffer is decoded");
}

{
  const d = tick({ soundOn: false, playing: true });
  assert.equal(d.stop, true);
  assert.equal(d.startOffsetSec, null);
  assert.equal(d.slaveClock, false);
}

// ── visibility flicker must not pause (iOS URL bar / 3D window) ───────────
assert.equal(
  shouldPauseHeroLesson({ ioVisible: false, docVisible: true, hiddenForMs: 40 }),
  false,
  "a 40ms IntersectionObserver dip is not off-screen",
);
assert.equal(
  shouldPauseHeroLesson({ ioVisible: false, docVisible: true, hiddenForMs: HERO_VISIBILITY_PAUSE_MS }),
  true,
  "a held hide may pause",
);
assert.equal(
  shouldPauseHeroLesson({ ioVisible: true, docVisible: false, hiddenForMs: HERO_VISIBILITY_PAUSE_MS }),
  true,
  "a real tab hide may pause",
);
assert.equal(
  shouldPauseHeroLesson({ ioVisible: true, docVisible: true, hiddenForMs: 50_000 }),
  false,
  "on-screen stays running regardless of the hidden timer",
);

{
  const d = tick({ ioVisible: false, hiddenForMs: 40, playing: true });
  assert.equal(d.stop, false, "flicker must keep the voice running");
  assert.equal(d.slaveClock, true);
}

{
  const d = tick({ ioVisible: false, hiddenForMs: HERO_VISIBILITY_PAUSE_MS, playing: true });
  assert.equal(d.stop, true, "once the hide has held, stop the voice");
  assert.equal(d.slaveClock, false);
}

// ── dead-air tap jumps to narration so the gesture's start() speaks ───────
{
  const snapped = snapToNarrationIfDeadAir(0.2, timing);
  assert.equal(snapped.lessonOffsetSec, 0);
  assert.ok(Math.abs(snapped.tSeconds - teach) < 1e-9);
}

{
  const t = teach + 5.5;
  const snapped = snapToNarrationIfDeadAir(t, timing);
  assert.equal(snapped.tSeconds, t);
  assert.ok(Math.abs(snapped.lessonOffsetSec - 5.5) < 1e-9);
}

{
  const holdT = teach + timing.total + 0.4;
  const snapped = snapToNarrationIfDeadAir(holdT, timing);
  assert.equal(snapped.lessonOffsetSec, 0);
  assert.ok(Math.abs(snapped.tSeconds - (loopDuration(timing) + teach)) < 1e-6);
}

{
  const t = teach + 1.25;
  assert.ok(Math.abs(lessonOffsetSec(t, timing) - 1.25) < 1e-9);
}

// ── wall clock slaves to audio, not the reverse ───────────────────────────
{
  const startMs = startTimeMsToMatchAudio({
    nowMs: 20_000,
    pausedAccumMs: 500,
    audioPositionSec: 3,
  });
  const tSec = (20_000 - 500 - startMs) / 1000;
  assert.ok(Math.abs(lessonOffsetSec(tSec, timing) - 3) < 1e-9);
}

// ── only NotAllowedError turns the speaker off ────────────────────────────
assert.equal(isUnlockBlockingError({ name: "NotAllowedError" }), true);
assert.equal(isUnlockBlockingError({ name: "AbortError" }), false, "overlapping play() rejects with AbortError — ignore it");
assert.equal(isUnlockBlockingError({ name: "NotSupportedError" }), false);
assert.equal(isUnlockBlockingError(null), false);

// ── the hook must actually use this policy, and must not seek in rAF ──────
const hook = read("src/components/hero-lesson/useLessonSimulation.ts");
assert.match(hook, /decideHeroAudioTick/, "the simulation must take start/stop from the clock policy");
assert.match(hook, /createHeroAudioEngine/, "the simulation must play through the Web Audio engine");
assert.match(hook, /startTimeMsToMatchAudio/, "the wall clock must slave to audio while speaking");
assert.doesNotMatch(
  hook,
  /audio\.currentTime\s*=/,
  "the rAF loop must not seek HTMLAudioElement.currentTime (that abort is the cutoff)",
);
assert.doesNotMatch(
  hook,
  /HAVE_FUTURE_DATA/,
  "the HAVE_FUTURE_DATA drift-seek path is the mobile cutoff; it must stay gone",
);

const engine = read("src/components/hero-lesson/heroAudioEngine.ts");
assert.match(engine, /decodeAudioData/, "the voiceover must be decoded into an AudioBuffer");
assert.match(engine, /AudioContext/, "playback is Web Audio so a later loop wrap does not need a new gesture");
assert.match(engine, /isUnlockBlockingError/, "AbortError from a raced play() must not mute the lesson");
assert.match(engine, /audioContextNeedsResume/, "iOS interrupted contexts must resume, not only suspended");
assert.match(engine, /HERO_SILENT_UNLOCK_SRC/, "the tap must unlock HTMLMediaElement so iOS uses the media route");
assert.match(
  engine,
  /state !== ['"]running['"]/,
  "BufferSource.start must wait until the context is running",
);

assert.equal(audioContextNeedsResume("suspended"), true);
assert.equal(
  audioContextNeedsResume("interrupted"),
  true,
  "WebKit interrupted is why a Hear-this-lesson tap is silent on iPhone",
);
assert.equal(audioContextNeedsResume("running"), false);
assert.equal(audioContextNeedsResume("closed"), false);
assert.ok(HERO_SILENT_UNLOCK_SRC.startsWith("data:audio/wav"));

const hookAfter = read("src/components/hero-lesson/useLessonSimulation.ts");
assert.match(
  hookAfter,
  /ioVisible = true/,
  "the Hear-this-lesson tap must mark the mockup on-screen so rAF does not stop() the voice",
);

console.log("verify-hero-audio-clock: no overlapping start, no seek, audio is master, flicker does not pause");
