import assert from "node:assert/strict";
import {
  createPauseAwareSpeechClock,
  SPEECH_AUDIO_IN_TRANSIT_GRACE_MS,
  SPEECH_STARTUP_DEADLINE_MS,
  speakWithStartupRecovery,
} from "../../features/tutor-session/lib/turn/speechStartup";

/**
 * Audio the relay already holds must not be swapped for the browser voice.
 *
 * 6 Nov 2026, Gauss law lesson: sentence 1 was complete at the relay 0.3 s
 * before the runner asked for it, then spent ~6.4 s on a ~155 KB/s link behind
 * sentence 2. The 6.5 s startup budget gave the sentence to the robotic
 * browser voice. The relay now announces `audio-in-transit`; this gate holds
 * the runner's side of that: the notice extends the budget, bounded, and a
 * missing or late notice changes nothing. Virtual clock; no network or media.
 */
async function main() {
  let now = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((run: () => void, delay = 0) => {
    const id = ++sequence;
    timers.set(id, { at: now + delay, run });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const advance = async (target: number) => {
    await flush();
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].run();
      await flush();
    }
    now = target;
    await flush();
  };

  /** One startup attempt; returns hooks into the fake provider and the outcome. */
  const attempt = () => {
    const origin = now;
    const clock = createPauseAwareSpeechClock(() => now);
    const state = { recoveredAt: null as number | null, audible: false, accepted: false };
    let inTransit!: () => void;
    let start!: () => void;
    let finish!: () => void;
    const run = speakWithStartupRecovery({
      primary: (onStart, _onReady, onAudioInTransit) => {
        inTransit = onAudioInTransit;
        start = () => { state.audible = true; state.accepted = onStart(); };
        return new Promise<void>((resolve) => { finish = resolve; });
      },
      fallback: async () => { state.recoveredAt = now - origin; },
      abandonPrimary: () => {},
      hasStarted: () => state.audible,
      canFallback: () => true,
      clock,
    });
    return { origin, clock, state, run, inTransit: () => inTransit(), start: () => start(), finish: () => finish() };
  };

  try {
    // The production timeline: notice at 1.2 s, audio audible at 6.6 s.
    const live = attempt();
    await advance(live.origin + 1_200);
    live.inTransit();
    await advance(live.origin + 6_600);
    assert.equal(live.state.recoveredAt, null, "audio on its way must keep the provider voice past the 6.5 s budget");
    live.start();
    assert.equal(live.state.accepted, true, "the late provider start is accepted");
    live.finish();
    await advance(now + 50);
    await live.run;

    // Bounded: a notice is not a promise forever.
    const stuck = attempt();
    await advance(stuck.origin + 1_200);
    stuck.inTransit();
    await advance(stuck.origin + 1_200 + SPEECH_AUDIO_IN_TRANSIT_GRACE_MS + 50);
    assert(stuck.state.recoveredAt !== null, "audio that never lands still falls back");
    assert(Math.abs(stuck.state.recoveredAt - (1_200 + SPEECH_AUDIO_IN_TRANSIT_GRACE_MS)) <= 50,
      `fallback at notice + grace, got ${stuck.state.recoveredAt}`);

    // Pause does not spend the extension.
    const paused = attempt();
    await advance(paused.origin + 1_000);
    paused.inTransit();
    paused.clock.pause();
    await advance(paused.origin + 60_000);
    assert.equal(paused.state.recoveredAt, null, "pause holds the in-transit budget");
    paused.clock.resume();
    await advance(paused.origin + 60_000 + SPEECH_AUDIO_IN_TRANSIT_GRACE_MS - 500);
    assert.equal(paused.state.recoveredAt, null);
    paused.start();
    paused.finish();
    await advance(now + 50);
    await paused.run;

    // No notice: unchanged.
    const silent = attempt();
    await advance(silent.origin + SPEECH_STARTUP_DEADLINE_MS + 50);
    assert(silent.state.recoveredAt !== null && Math.abs(silent.state.recoveredAt - SPEECH_STARTUP_DEADLINE_MS) <= 50,
      "without a notice the 6.5 s budget still holds");

    // A notice after the browser voice took over cannot reopen the provider.
    const late = attempt();
    await advance(late.origin + SPEECH_STARTUP_DEADLINE_MS + 50);
    assert(late.state.recoveredAt !== null);
    late.inTransit();
    late.start();
    assert.equal(late.state.accepted, false, "a start after the cutoff is refused");
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
  console.log("verify-speech-audio-in-transit: ok");
}

main().catch((error) => { console.error(error); process.exit(1); });
