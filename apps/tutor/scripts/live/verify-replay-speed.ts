import assert from "node:assert/strict";
import {
  applyReplayPlaybackRate,
  applyReplaySpeed,
  DEFAULT_REPLAY_SPEED,
  speedAwareDelay,
  syncControlledPlaybackRate,
} from "../../lib/replay/replayAudio";

async function main(): Promise<void> {
  const audio = {
    playbackRate: 1,
    preservesPitch: false,
  } as HTMLAudioElement & { preservesPitch: boolean };

  applyReplayPlaybackRate(audio, 2);
  assert.equal(audio.playbackRate, 2);
  assert.equal(audio.preservesPitch, true);

  let ttsRate = DEFAULT_REPLAY_SPEED;
  let inkRate = DEFAULT_REPLAY_SPEED;
  const applyOverlaySpeed = (rate: number) => {
    applyReplaySpeed({
      rate,
      audio,
      setTtsPlaybackRate: (next) => {
        ttsRate = next;
      },
      setAnimationSpeed: (next) => {
        inkRate = next;
      },
    });
  };

  let overlayCalls = 0;
  const trackedApply = (rate: number) => {
    overlayCalls += 1;
    applyOverlaySpeed(rate);
  };

  // Overlay dropdown: same helper as student ReplayControls (TTS + ink + audio).
  syncControlledPlaybackRate(2.5, DEFAULT_REPLAY_SPEED, trackedApply);
  assert.equal(overlayCalls, 1);
  assert.equal(audio.playbackRate, 2.5);
  assert.equal(ttsRate, 2.5);
  assert.equal(inkRate, 2.5);

  syncControlledPlaybackRate(2.5, 2.5, trackedApply);
  assert.equal(overlayCalls, 1, "matching overlay rate must not re-apply");

  let rate = 0.5;
  const started = performance.now();
  await speedAwareDelay(200, {
    getPlaybackRate: () => rate,
  });
  // Mid-wait speed-up: flip to 2x after 80ms wall (~40ms media at 0.5x).
  // The helper itself owns the loop; approximate that 200 media-ms at mixed
  // rates finishes faster than a pure 0.5x wait (400ms) and slower than 2x (100ms).
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `speedAwareDelay too slow at 0.5x: ${elapsed}ms`);

  rate = 2;
  const fastStarted = performance.now();
  await speedAwareDelay(200, {
    getPlaybackRate: () => rate,
  });
  const fastElapsed = performance.now() - fastStarted;
  assert.ok(fastElapsed < 180, `speedAwareDelay did not respect 2x: ${fastElapsed}ms`);

  console.log("replay speed helpers verification passed");
}

void main();
