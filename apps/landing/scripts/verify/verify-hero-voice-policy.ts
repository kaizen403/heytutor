/**
 * The landing hero must not speak until the visitor hits the tab speaker.
 *
 * A play() issued on load comes out of the speakers on localhost (Chrome
 * media-engagement index). Restarting the dev server reloads the tab and
 * the lesson starts talking with nobody having asked for sound.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  heroSoundAfterAssetsLoad,
  initialHeroSectionVisible,
  shouldAttemptHeroPlayback,
  shouldStartHeroVoiceOnPageGesture,
} from "../../src/components/hero-lesson/heroVoicePolicy.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

assert.equal(
  heroSoundAfterAssetsLoad({ reducedMotion: false, timingsOk: true }),
  "off",
  "ready timings must leave the hero muted; autoplay is the speaker-on-boot bug",
);
assert.equal(
  heroSoundAfterAssetsLoad({ reducedMotion: true, timingsOk: true }),
  "unavailable",
  "reduced motion must not load or play the lesson voice",
);
assert.equal(
  heroSoundAfterAssetsLoad({ reducedMotion: false, timingsOk: false }),
  "unavailable",
  "missing timings must not pretend sound is available",
);

assert.equal(
  shouldStartHeroVoiceOnPageGesture(),
  false,
  "a click or key anywhere on the page must not start the lesson voice",
);

assert.equal(
  initialHeroSectionVisible(),
  false,
  "the mockup is off-screen until IntersectionObserver says otherwise",
);

assert.equal(
  shouldAttemptHeroPlayback({
    soundOn: true,
    sectionVisible: false,
    documentVisible: true,
  }),
  false,
  "below-the-fold must not play even if sound was left on",
);
assert.equal(
  shouldAttemptHeroPlayback({
    soundOn: false,
    sectionVisible: true,
    documentVisible: true,
  }),
  false,
  "a visible mockup stays silent until the speaker is pressed",
);
assert.equal(
  shouldAttemptHeroPlayback({
    soundOn: true,
    sectionVisible: true,
    documentVisible: true,
  }),
  true,
  "the speaker-on, on-screen path is the only one that may play()",
);

const hook = read("src/components/hero-lesson/useLessonSimulation.ts");
assert.match(
  hook,
  /heroSoundAfterAssetsLoad/,
  "the simulation must take its load-time sound state from the policy",
);
assert.match(
  hook,
  /shouldAttemptHeroPlayback/,
  "the simulation must gate play() on the policy, not a bare soundOn flag",
);
assert.match(
  hook,
  /initialHeroSectionVisible/,
  "the simulation must not assume the mockup is on-screen before observe()",
);
assert.doesNotMatch(
  hook,
  /Voice-first/,
  "the load path must not enable sound the moment the MP3 is ready",
);
assert.doesNotMatch(
  hook,
  /window\.addEventListener\('click', unlock\)/,
  "a page click must not start the lesson voice; only the tab speaker may",
);
assert.doesNotMatch(
  hook,
  /window\.addEventListener\('keydown', unlock\)/,
  "a keydown must not start the lesson voice; only the tab speaker may",
);

const loadPath = hook.slice(
  hook.indexOf("st.audio = audio"),
  hook.indexOf("} catch"),
);
assert.doesNotMatch(
  loadPath,
  /soundOn\s*=\s*true/,
  "asset load must not flip soundOn; that is what plays through the speakers on boot",
);
assert.doesNotMatch(
  loadPath,
  /setSound\('on'\)/,
  "asset load must not report sound as on",
);

console.log(
  "verify-hero-voice-policy: landing hero stays silent until the tab speaker is pressed",
);
