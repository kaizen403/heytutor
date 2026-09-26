/** A resolved fallback promise is not proof that the student heard anything. */
export async function requireSpeechStart(
  speech: Promise<void>,
  hasStarted: () => boolean,
): Promise<void> {
  await speech;
  if (!hasStarted()) {
    throw new Error("The voice could not start. Please try the lesson again.");
  }
}

/** Stop waiting on a transport that has neither spoken nor settled. */
export const SPEECH_STARTUP_DEADLINE_MS = 6_500;

/** Active playback time, excluding every pause (including repeated pauses). */
export function createPauseAwareSpeechClock(now: () => number = () => performance.now()) {
  const startedAt = now();
  let pausedAt: number | null = null;
  let pausedMs = 0;
  return {
    pause() {
      if (pausedAt === null) pausedAt = now();
    },
    resume() {
      if (pausedAt !== null) {
        pausedMs += now() - pausedAt;
        pausedAt = null;
      }
    },
    isPaused: () => pausedAt !== null,
    elapsedMs: () => (pausedAt ?? now()) - startedAt - pausedMs,
  };
}

export type PauseAwareSpeechClock = ReturnType<typeof createPauseAwareSpeechClock>;

/** Browser speech retimes pitch with speed; never push recovery above natural rate. */
export function browserRecoveryPlaybackRate(rate: number): number {
  return Number.isFinite(rate) && rate > 0 ? Math.min(rate, 1) : 1;
}

export async function waitForSpeechStartup(
  started: Promise<void>,
  completed: Promise<void>,
  deadlineMs: number = SPEECH_STARTUP_DEADLINE_MS,
  clock?: PauseAwareSpeechClock,
): Promise<"started" | "settled" | "timeout"> {
  if (clock) {
    let outcome: "started" | "settled" | null = null;
    void started.then(() => { outcome = "started"; });
    void completed.then(
      () => { outcome ??= "settled"; },
      () => { outcome ??= "settled"; },
    );
    while (true) {
      if (!clock.isPaused()) {
        if (outcome) return outcome;
        if (clock.elapsedMs() >= deadlineMs) return "timeout";
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      started.then(() => "started" as const),
      completed.then(() => "settled" as const, () => "settled" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A stalled first chunk must hand the sentence to the browser voice. */
export async function speakWithStartupRecovery(input: {
  primary: (onStart: () => void) => Promise<void>;
  fallback: () => Promise<void>;
  abandonPrimary: () => void;
  hasStarted: () => boolean;
  canFallback: () => boolean;
  onFallback?: (reason: "settled" | "timeout") => void;
  deadlineMs?: number;
  clock?: PauseAwareSpeechClock;
}): Promise<void> {
  let announceStart: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { announceStart = resolve; });
  const primary = input.primary(() => announceStart?.());
  const outcome = await waitForSpeechStartup(started, primary, input.deadlineMs, input.clock);
  if (outcome !== "started" && !input.hasStarted()) {
    if (!input.canFallback()) return;
    input.abandonPrimary();
    input.onFallback?.(outcome);
    await input.fallback();
    return;
  }
  await primary;
}

/** Browser pause() cancels the utterance and resolves speakSegment; retry it on resume. */
export async function speakWithPauseOwnedFallback(input: {
  speak: (callbacks: { onStart: () => void; onEnd: () => void; onError: (error: unknown) => void }) => Promise<void>;
  waitWhilePaused: () => Promise<boolean>;
  isCancelled: () => boolean;
  pauseGeneration: () => number;
}): Promise<void> {
  while (!input.isCancelled()) {
    if (!(await input.waitWhilePaused()) || input.isCancelled()) return;
    const generation = input.pauseGeneration();
    let started = false;
    let ended = false;
    let error: unknown = null;
    await input.speak({
      onStart: () => { started = true; },
      onEnd: () => { ended = true; },
      onError: (reason) => { error = reason; },
    });
    if (input.isCancelled()) return;
    if (generation !== input.pauseGeneration()) continue;
    if (error) throw error;
    if (!started || !ended) throw new Error("Browser speech did not complete");
    return;
  }
}

/** Alignment gives a tighter completion bound than a character-count timeout. */
export function speechPlaybackOverdue(input: {
  elapsedMs: number;
  audioDurationMs: number;
  playbackRate: number;
  paused: boolean;
}): boolean {
  if (input.paused || input.audioDurationMs <= 0 || input.playbackRate <= 0) return false;
  const expectedWallMs = input.audioDurationMs / input.playbackRate;
  return input.elapsedMs > Math.max(8_000, expectedWallMs * 1.35 + 3_000);
}
