import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createScheduledWriteClock } from "@heytutor/tutor-core";
import { createAccumulatingMediaClock, playReplayAudio, waitForReplayMediaTime, waitUntilDrawClock } from "../../lib/replay/replayAudio";

class Clock {
  now = 0;
  private nextId = 0;
  private jobs = new Map<number, { at: number; every?: number; callback: () => void }>();

  setTimeout = (callback: () => void, delay = 0): number => this.schedule(callback, delay);
  setInterval = (callback: () => void, delay = 0): number => this.schedule(callback, delay, delay);
  clear = (id: number): void => { this.jobs.delete(id); };
  get pending(): number { return this.jobs.size; }

  private schedule(callback: () => void, delay: number, every?: number): number {
    const id = ++this.nextId;
    this.jobs.set(id, { at: this.now + delay, every, callback });
    return id;
  }

  advance(ms: number): void {
    const until = this.now + ms;
    while (true) {
      const entry = [...this.jobs].filter(([, job]) => job.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!entry) break;
      const [id, job] = entry;
      this.now = job.at;
      if (job.every !== undefined) job.at += job.every;
      else this.jobs.delete(id);
      job.callback();
    }
    this.now = until;
  }

  /** Backgrounded tabs can receive no timer callbacks during the pause. */
  suspend(ms: number): void {
    this.now += ms;
    for (const job of this.jobs.values()) job.at = this.now;
  }
}

class FakeAudio {
  currentTime = 0;
  duration = 4;
  readyState = 0;
  playbackRate = 1;
  preload = "";
  paused = true;
  pauseCount = 0;
  unloadCount = 0;
  playCount = 0;
  delayPauseEvent = false;
  holdPauseEvent = false;
  onpause: (() => void) | null = null;
  onplay: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private pendingPlayReject: ((error: Error) => void) | null = null;
  private firstPlayPending = false;

  constructor(readonly url: string, pendingFirstPlay = false) {
    this.firstPlayPending = pendingFirstPlay;
  }
  play(): Promise<void> {
    this.playCount++;
    this.paused = false;
    this.onplay?.();
    if (this.firstPlayPending) {
      this.firstPlayPending = false;
      return new Promise((_, reject) => { this.pendingPlayReject = reject; });
    }
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCount++;
    this.paused = true;
    if (this.holdPauseEvent) { /* dispatch manually after the load timer */ }
    else if (this.delayPauseEvent) globalThis.setTimeout(() => this.onpause?.(), 0);
    else this.onpause?.();
    const interrupted = new Error("play interrupted by pause");
    interrupted.name = "AbortError";
    this.pendingPlayReject?.(interrupted);
    this.pendingPlayReject = null;
  }
  removeAttribute(name: string): void {
    assert.equal(name, "src");
    this.unloadCount++;
  }
  load(): void {}
}

const clock = new Clock();
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const name of ["window", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"]) {
  saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
}
Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: clock.setTimeout });
Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: clock.clear });
Object.defineProperty(globalThis, "setInterval", { configurable: true, value: clock.setInterval });
Object.defineProperty(globalThis, "clearInterval", { configurable: true, value: clock.clear });
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });

async function verify(): Promise<void> {
try {
  // A paused, audible clip must not time out and skip to the next cue.
  const audio = new FakeAudio("clip.mp3");
  const playback = playReplayAudio("clip.mp3", { audio: audio as unknown as HTMLAudioElement });
  let outcome = "pending";
  void playback.done.then(() => { outcome = "done"; }, () => { outcome = "failed"; });
  audio.onplaying?.();
  audio.pause();
  clock.advance(20_000);
  await Promise.resolve();
  assert.equal(outcome, "pending", "pause must suspend playback watchdog");
  void audio.play();
  audio.onplaying?.();
  audio.onended?.();
  await playback.done;
  assert.equal(outcome, "done");
  assert.equal(clock.pending, 0, "completed audio must release timers");

  const stalledResume = new FakeAudio("stalled-resume.mp3");
  const resumePlayback = playReplayAudio("stalled-resume.mp3", {
    audio: stalledResume as unknown as HTMLAudioElement,
  });
  let resumeOutcome = "pending";
  void resumePlayback.done.then(() => { resumeOutcome = "done"; }, () => { resumeOutcome = "failed"; });
  stalledResume.onplaying?.();
  stalledResume.pause();
  clock.advance(20_000);
  assert.equal(resumeOutcome, "pending");
  void stalledResume.play(); // resumed, but buffering never reaches `playing`
  clock.advance(6_001);
  await Promise.resolve();
  assert.equal(resumeOutcome, "failed", "resumed buffering must remain bounded");
  assert.equal(stalledResume.unloadCount, 1);
  assert.equal(clock.pending, 0);

  // The control discards a rejected resume play(). With no play/playing/error
  // event, both watchdogs were cleared by pause and the cue used to hang.
  let rejectedResumePaused = false;
  const rejectedResumeAudio = new FakeAudio("rejected-resume.mp3");
  const rejectedResume = playReplayAudio("rejected-resume.mp3", {
    audio: rejectedResumeAudio as unknown as HTMLAudioElement,
    isPaused: () => rejectedResumePaused,
  });
  let rejectedResumeError = "pending";
  void rejectedResume.done.catch((error: unknown) => {
    rejectedResumeError = error instanceof Error ? error.message : String(error);
  });
  rejectedResumeAudio.onplaying?.();
  rejectedResumePaused = true;
  rejectedResumeAudio.pause();
  clock.advance(20_000);
  await Promise.resolve();
  assert.equal(rejectedResumeError, "pending", "pause cannot fail the cue");
  rejectedResumePaused = false;
  rejectedResumeAudio.play = () => Promise.reject(new Error("resume blocked"));
  void rejectedResumeAudio.play().catch(() => undefined); // the real control discards this rejection
  clock.advance(6_201);
  await Promise.resolve();
  assert.equal(rejectedResumeError, "Replay audio load timeout: rejected-resume.mp3",
    "rejected resume must settle, not strand the cue");
  assert.equal(rejectedResumeAudio.unloadCount, 1, "failed resume must unload before fallback");
  assert.equal(clock.pending, 0);

  // The first pending play rejection may arrive after a rapid resume.
  const buffering = new FakeAudio("buffering.mp3", true);
  const resumed = playReplayAudio("buffering.mp3", { audio: buffering as unknown as HTMLAudioElement });
  let resumedOutcome = "pending";
  void resumed.done.then(() => { resumedOutcome = "done"; }, () => { resumedOutcome = "failed"; });
  buffering.pause();
  void buffering.play();
  buffering.onplaying?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resumedOutcome, "pending", "late pause rejection must not end resumed clip");
  buffering.onended?.();
  await resumed.done;
  assert.equal(resumedOutcome, "done");

  // Real pause events may be queued behind the play() rejection microtask.
  let userPaused = false;
  const delayedPause = new FakeAudio("delayed-pause.mp3", true);
  delayedPause.delayPauseEvent = true;
  const delayedPlayback = playReplayAudio("delayed-pause.mp3", {
    audio: delayedPause as unknown as HTMLAudioElement,
    isPaused: () => userPaused,
  });
  let delayedOutcome = "pending";
  void delayedPlayback.done.then(() => { delayedOutcome = "done"; }, () => { delayedOutcome = "failed"; });
  userPaused = true;
  delayedPause.pause();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(delayedOutcome, "pending", "pause rejection before pause event must not start fallback");
  clock.advance(0);
  userPaused = false;
  void delayedPause.play();
  delayedPause.onplaying?.();
  delayedPause.onended?.();
  await delayedPlayback.done;

  userPaused = false;
  const rapid = new FakeAudio("rapid.mp3", true);
  rapid.delayPauseEvent = true;
  const rapidPlayback = playReplayAudio("rapid.mp3", {
    audio: rapid as unknown as HTMLAudioElement,
    isPaused: () => userPaused,
  });
  let rapidOutcome = "pending";
  void rapidPlayback.done.then(() => { rapidOutcome = "done"; }, () => { rapidOutcome = "failed"; });
  userPaused = true;
  rapid.pause();
  userPaused = false;
  void rapid.play();
  rapid.onplaying?.();
  await Promise.resolve();
  await Promise.resolve();
  clock.advance(0); // stale pause event must not clear the resumed watchdog
  assert.equal(rapidOutcome, "pending", "rapid resume must retain the original cue");
  assert.ok(rapid.onended, "rapid resume must retain the ended handler");
  rapid.onended?.();
  await rapidPlayback.done;

  // Playback watchdog can fire before the browser delivers the pause event.
  let playbackPaused = false;
  const latePause = new FakeAudio("late-playback-pause.mp3");
  latePause.holdPauseEvent = true;
  const latePlayback = playReplayAudio("late-playback-pause.mp3", {
    audio: latePause as unknown as HTMLAudioElement,
    isPaused: () => playbackPaused,
  });
  let lateOutcome = "pending";
  void latePlayback.done.then(() => { lateOutcome = "done"; }, () => { lateOutcome = "failed"; });
  latePause.onplaying?.();
  playbackPaused = true;
  latePause.pause();
  clock.advance(20_000);
  await Promise.resolve();
  assert.equal(lateOutcome, "pending", "queued pause event cannot turn a paused playback timeout into fallback");
  assert.equal(latePause.unloadCount, 0);
  playbackPaused = false;
  void latePause.play();
  latePause.onplaying?.();
  latePause.onpause?.(); // a stale pause event after resume must preserve the new watchdog
  latePause.onended?.();
  await latePlayback.done;
  assert.equal(clock.pending, 0);

  const actuallyStalled = new FakeAudio("playback-stall.mp3");
  const actualStall = playReplayAudio("playback-stall.mp3", {
    audio: actuallyStalled as unknown as HTMLAudioElement,
  });
  actuallyStalled.onplaying?.();
  clock.advance(20_000);
  await assert.rejects(actualStall.done, /playback timeout/,
    "an unpaused, genuinely stalled recording must still fail and unload");
  assert.equal(actuallyStalled.unloadCount, 1);
  assert.equal(clock.pending, 0);

  const loading = new FakeAudio("loading.mp3", true);
  const loadingPlayback = playReplayAudio("loading.mp3", { audio: loading as unknown as HTMLAudioElement });
  let loadingOutcome = "pending";
  void loadingPlayback.done.then(() => { loadingOutcome = "done"; }, () => { loadingOutcome = "failed"; });
  loading.pause();
  clock.advance(9_000);
  await Promise.resolve();
  assert.equal(loadingOutcome, "pending", "a paused load must not start fallback TTS");
  void loading.play();
  loading.onplaying?.();
  loading.onended?.();
  await loadingPlayback.done;

  // The load timer can beat the queued pause event even though the caller
  // already marked the clip paused. Resuming must still have a bounded wait.
  let timerPaused = false;
  const pendingPause = new FakeAudio("pending-pause.mp3", true);
  pendingPause.holdPauseEvent = true;
  const pendingPausePlayback = playReplayAudio("pending-pause.mp3", {
    audio: pendingPause as unknown as HTMLAudioElement,
    isPaused: () => timerPaused,
  });
  let pendingPauseOutcome = "pending";
  void pendingPausePlayback.done.then(
    () => { pendingPauseOutcome = "done"; },
    () => { pendingPauseOutcome = "failed"; },
  );
  timerPaused = true;
  pendingPause.pause();
  clock.advance(6_001); // load deadline fires before the queued pause event
  await Promise.resolve();
  assert.equal(pendingPauseOutcome, "pending", "load timeout must honor synchronous pause state");
  assert.equal(pendingPause.unloadCount, 0);
  timerPaused = false;
  void pendingPause.play(); // buffers forever after resume
  clock.advance(6_001);
  await Promise.resolve();
  assert.equal(pendingPauseOutcome, "failed", "resumed load must still time out");
  assert.equal(pendingPause.unloadCount, 1);
  assert.equal(clock.pending, 0);

  // A queued `play` event may arrive after pause and must not re-arm a
  // buffering timeout while the student is still paused.
  let eventPaused = false;
  const queuedPlay = new FakeAudio("queued-play.mp3", true);
  const queuedPlayback = playReplayAudio("queued-play.mp3", {
    audio: queuedPlay as unknown as HTMLAudioElement,
    isPaused: () => eventPaused,
  });
  let queuedOutcome = "pending";
  void queuedPlayback.done.then(() => { queuedOutcome = "done"; }, () => { queuedOutcome = "failed"; });
  eventPaused = true;
  queuedPlay.pause();
  queuedPlay.onplay?.();
  clock.advance(6_001);
  await Promise.resolve();
  assert.equal(queuedOutcome, "pending", "a queued play event cannot time out a paused clip");
  eventPaused = false;
  void queuedPlay.play();
  queuedPlay.onplaying?.();
  queuedPlay.onended?.();
  await queuedPlayback.done;

  // A timed-out load must be unloaded before live TTS can begin.
  const stalled = new FakeAudio("stalled.mp3", true);
  const timed = playReplayAudio("stalled.mp3", { audio: stalled as unknown as HTMLAudioElement });
  clock.advance(6_001);
  await assert.rejects(timed.done, /load timeout/);
  assert.ok(stalled.pauseCount > 0, "timeout must pause pending media");
  assert.equal(stalled.unloadCount, 1, "timeout must discard late-loading source");
  assert.equal(stalled.onplaying, null, "timeout must detach old playback callbacks");
  assert.equal(clock.pending, 0, "timeout must release timers");

  const blocked = new FakeAudio("blocked.mp3");
  blocked.play = () => Promise.reject(new Error("autoplay blocked"));
  const rejected = playReplayAudio("blocked.mp3", { audio: blocked as unknown as HTMLAudioElement });
  await assert.rejects(rejected.done, /autoplay blocked/);
  assert.equal(blocked.unloadCount, 1, "real playback errors must unload before fallback");
  assert.equal(clock.pending, 0);

  // Cancellation should settle even while buffering and dispose of the media.
  let cancel = false;
  const cancelled = new FakeAudio("cancelled.mp3", true);
  const cancelledPlayback = playReplayAudio("cancelled.mp3", {
    audio: cancelled as unknown as HTMLAudioElement,
    shouldCancel: () => cancel,
  });
  cancel = true;
  clock.advance(33);
  await cancelledPlayback.done;
  assert.equal(cancelled.unloadCount, 1);
  assert.equal(clock.pending, 0, "cancellation must release timers");

  // Draw deadlines are active-playback deadlines, not time spent paused.
  let paused = false;
  let position = 0;
  let drawn = false;
  const waiting = waitUntilDrawClock(() => position, 1_000, {
    nowMs: () => clock.now,
    isPaused: () => paused,
  });
  void waiting.then(() => { drawn = true; });
  clock.advance(1);
  paused = true;
  clock.advance(10_000);
  await Promise.resolve();
  assert.equal(drawn, false, "draw must not finish during a long pause");
  paused = false;
  position = 1_000;
  clock.advance(32);
  await waiting;
  assert.equal(drawn, true);
  assert.equal(clock.pending, 0);

  // No timers tick while the page is backgrounded: the first sample after a
  // long pause must not charge the entire gap to the draw clock.
  let noSamplePaused = false;
  const noSampleClock = createAccumulatingMediaClock({
    getPlaybackRate: () => 1,
    nowMs: () => clock.now,
    isPaused: () => noSamplePaused,
  });
  clock.advance(100);
  assert.equal(noSampleClock.positionMs(), 100);
  noSampleClock.setPaused(true);
  noSamplePaused = true;
  clock.advance(20_000);
  noSampleClock.setPaused(false);
  noSamplePaused = false;
  clock.advance(100);
  assert.equal(noSampleClock.positionMs(), 200,
    "a resume sample must not count unsampled paused wall time");

  // The production replay draw waiter must also use active time for its
  // *deadline* when there was no timer callback at all between pause/resume.
  let unsampledPaused = false;
  const activeClock = createAccumulatingMediaClock({
    getPlaybackRate: () => 1,
    nowMs: () => clock.now,
    isPaused: () => unsampledPaused,
  });
  let unsampledDone = false;
  const unsampledWait = waitUntilDrawClock(activeClock.positionMs, 5_000, {
    nowMs: activeClock.nowMs,
    isPaused: () => unsampledPaused,
  });
  const replayHookSource = readFileSync(resolve(import.meta.dirname,
    "../../features/tutor-session/hooks/useReplay.ts"), "utf8");
  const segmentInkSource = readFileSync(resolve(import.meta.dirname,
    "../../features/tutor-session/lib/turn/segmentInk.ts"), "utf8");
  assert.match(replayHookSource,
    /clock: \{[^}]*getAudioPositionMs: getDrawClockMs,[^}]*isPaused,[^}]*nowMs: wallClock\.nowMs/s,
    "the real replay draw clock must carry the pause-aware wall clock");
  assert.match(segmentInkSource,
    /waitUntilDrawClock\(clock\.getAudioPositionMs,[^;]*isPaused: clock\.isPaused[^;]*nowMs: clock\.nowMs/s,
    "the shared draw waiter must use the pause-aware clock for its deadline");
  void unsampledWait.then(() => { unsampledDone = true; });
  clock.advance(16);
  activeClock.setPaused(true);
  unsampledPaused = true;
  clock.suspend(20_000);
  activeClock.setPaused(false);
  unsampledPaused = false;
  clock.advance(16);
  await Promise.resolve();
  assert.equal(unsampledDone, false, "unsampled pause cannot exhaust draw deadline on resume");
  clock.advance(5_000);
  await unsampledWait;
  assert.equal(clock.pending, 0);

  // The actual replay draw clock includes a wall fallback. Pausing that clock
  // must not let the fallback jump past a pending word on resume.
  paused = false;
  const mediaClock = createAccumulatingMediaClock({
    getPlaybackRate: () => 1,
    nowMs: () => clock.now,
    isPaused: () => paused,
  });
  const drawClock = createScheduledWriteClock({
    getRawPositionMs: mediaClock.positionMs,
    nowMs: mediaClock.nowMs,
  });
  let wordDrawn = false;
  const wordWait = waitUntilDrawClock(drawClock, 1_000, {
    nowMs: () => clock.now,
    isPaused: () => paused,
  });
  void wordWait.then(() => { wordDrawn = true; });
  clock.advance(16);
  paused = true;
  clock.advance(10_000);
  await Promise.resolve();
  assert.equal(wordDrawn, false);
  paused = false;
  clock.advance(32);
  await Promise.resolve();
  assert.equal(wordDrawn, false, "draw clock must not jump across a pause");
  clock.advance(1_000);
  await wordWait;
  assert.equal(clock.pending, 0);

  // At media time zero, the media waiter falls back to a wall clock; that
  // fallback must not leap ahead through a paused/buffering interval.
  const media = new FakeAudio("zero.mp3");
  media.paused = false;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => clock.now },
  });
  let mediaReady = false;
  const mediaWait = waitForReplayMediaTime(media as unknown as HTMLAudioElement, 1_000);
  void mediaWait.then(() => { mediaReady = true; });
  clock.advance(16);
  media.paused = true;
  clock.advance(10_000);
  await Promise.resolve();
  assert.equal(mediaReady, false);
  media.paused = false;
  clock.advance(32);
  await Promise.resolve();
  assert.equal(mediaReady, false, "media-zero fallback must not jump across a pause");
  media.currentTime = 1;
  clock.advance(16);
  await mediaWait;
  assert.equal(clock.pending, 0);
  console.log("verify-replay-audio: ok");
} finally {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}
}

void verify().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
