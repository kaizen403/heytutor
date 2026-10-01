import assert from "node:assert/strict";
import { createPauseAwareSpeechClock, speakWithStartupRecovery, waitForSpeechStartup } from "../../features/tutor-session/lib/turn/speechStartup";

/** Virtual active-time boundary test; no network, React, or media required. */
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
  try {
    const clock = createPauseAwareSpeechClock(() => now);
    let ready!: () => void;
    let start!: () => void;
    let finish!: () => void;
    let audible = false;
    let abandoned = 0;
    let recovered = 0;
    const run = speakWithStartupRecovery({
      primary: (onStart, onReady) => {
        ready = onReady ?? (() => {});
        start = () => { audible = true; onStart(); };
        return new Promise<void>((resolve) => { finish = resolve; });
      },
      fallback: async () => { recovered++; },
      abandonPrimary: () => { abandoned++; },
      hasStarted: () => audible,
      canFallback: () => true,
      clock,
    });
    await advance(6_480);
    ready();
    await advance(6_525);
    assert.equal(recovered, 0, "complete provider bytes just before the deadline must retain the provider voice");
    clock.pause();
    await advance(30_000);
    assert.equal(recovered, 0, "pause must not consume media-ready grace");
    clock.resume();
    await advance(30_400);
    start();
    finish();
    await advance(now + 25);
    await run;
    assert.equal(abandoned, 0);

    const boundedClock = createPauseAwareSpeechClock(() => now);
    const boundedOrigin = now;
    audible = false;
    const bounded = speakWithStartupRecovery({
      primary: (_onStart, onReady) => { ready = onReady ?? (() => {}); return new Promise<void>(() => {}); },
      fallback: async () => { recovered++; },
      abandonPrimary: () => { abandoned++; },
      hasStarted: () => audible,
      canFallback: () => true,
      clock: boundedClock,
    });
    await advance(boundedOrigin + 6_480);
    ready();
    await advance(boundedOrigin + 8_955);
    ready(); // Repeated final packets cannot renew the allowance.
    await advance(boundedOrigin + 9_000);
    await bounded;
    assert.equal(recovered, 1, "grace must end 2500 active ms after FIRST readiness");
    ready(); // Late/stale readiness cannot restart the abandoned transport.
    await advance(49_000);
    assert.equal(recovered, 1);

    const noBytesClock = createPauseAwareSpeechClock(() => now);
    const noBytes = speakWithStartupRecovery({
      primary: () => new Promise<void>(() => {}),
      fallback: async () => { recovered++; },
      abandonPrimary: () => { abandoned++; },
      hasStarted: () => false,
      canFallback: () => true,
      clock: noBytesClock,
    });
    await advance(55_475);
    assert.equal(recovered, 1, "no bytes must keep the existing 6500ms guard");
    await advance(55_500);
    await noBytes;
    assert.equal(recovered, 2);
    // A start between the grace deadline and the next 25ms poll cannot win.
    // Conversely a start just BEFORE expiry must survive that same late poll.
    for (const startAtMs of [8_984, 8_985, 8_995]) {
      const origin = now;
      const boundaryClock = createPauseAwareSpeechClock(() => now);
      const started = new Promise<void>((resolve) => setTimeout(resolve, startAtMs));
      const result = waitForSpeechStartup(started, new Promise<void>(() => {}), 8_985, boundaryClock);
      await advance(origin + 9_000);
      assert.equal(await result, startAtMs < 8_985 ? "started" : "timeout",
        `startup at ${startAtMs}ms must be judged at arrival, not the next polling tick`);
    }
    for (const startAtMs of [8_984, 8_985, 8_995]) {
      const origin = now;
      const boundaryClock = createPauseAwareSpeechClock(() => now);
      let recoveries = 0;
      let stops = 0;
      let accepted: unknown;
      let readyAgain!: () => void;
      let startAgain!: () => unknown;
      const boundary = speakWithStartupRecovery({
        primary: (onStart, onReady) => new Promise<void>((resolve) => {
          readyAgain = onReady;
          startAgain = onStart;
          setTimeout(onReady, 6_485);
          setTimeout(() => { accepted = onStart(); resolve(); }, startAtMs);
        }),
        fallback: async () => { recoveries++; },
        abandonPrimary: () => { stops++; },
        // A transport/app side-effect must not override an expired outcome.
        hasStarted: () => true,
        canFallback: () => true,
        clock: boundaryClock,
      });
      await advance(origin + 9_000);
      await boundary;
      const withinGrace = startAtMs < 8_985;
      assert.equal(recoveries, withinGrace ? 0 : 1, `primary acceptance must share the strict ${startAtMs}ms boundary`);
      assert.equal(stops, withinGrace ? 0 : 1);
      assert.equal(accepted, withinGrace, "app onStart must be gated by the helper's acceptance result");
      readyAgain();
      assert.equal(startAgain(), false, "settled or abandoned ownership cannot accept stale onStart");
    }
    // App/native onStart work may cross the deadline before promise observers
    // run. The synchronous accepted event remains the authoritative outcome.
    let synchronousAcceptance: unknown;
    let synchronousRecoveries = 0;
    const synchronousClock = createPauseAwareSpeechClock(() => now);
    const synchronous = speakWithStartupRecovery({
      primary: async (onStart, onReady) => {
        now += 6_485;
        onReady();
        now += 2_499;
        synchronousAcceptance = onStart();
        now += 50;
      },
      fallback: async () => { synchronousRecoveries++; },
      abandonPrimary: () => {},
      hasStarted: () => false,
      canFallback: () => true,
      clock: synchronousClock,
    });
    await synchronous;
    assert.equal(synchronousAcceptance, true);
    assert.equal(synchronousRecoveries, 0, "accepted start cannot become a timeout merely because app callback work crosses the deadline");

    const lateReadyOrigin = now;
    let lateRecoveries = 0;
    const lateReady = speakWithStartupRecovery({
      primary: (_onStart, onReady) => {
        setTimeout(onReady, 6_501);
        return new Promise<void>(() => {});
      },
      fallback: async () => { lateRecoveries++; },
      abandonPrimary: () => {},
      hasStarted: () => false,
      canFallback: () => true,
      clock: createPauseAwareSpeechClock(() => now),
    });
    await advance(lateReadyOrigin + 6_525);
    await lateReady;
    assert.equal(lateRecoveries, 1, "late readiness between deadline and poll cannot renew an expired no-bytes attempt");
    console.log("verified bounded pause-aware first readiness, strict start-arrival boundaries, and stale callback rejection");
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
