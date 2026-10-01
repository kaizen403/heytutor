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
/** Complete bytes may still be waiting for native media to start. */
export const SPEECH_MEDIA_READY_GRACE_MS = 2_500;

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
  activeDeadlineMs?: () => number,
): Promise<"started" | "settled" | "timeout"> {
  if (clock) {
    const state: { outcome: { kind: "started" | "settled"; atMs: number } | null } = { outcome: null };
    void started.then(() => { state.outcome = { kind: "started", atMs: clock.elapsedMs() }; });
    void completed.then(
      () => { state.outcome ??= { kind: "settled", atMs: clock.elapsedMs() }; },
      () => { state.outcome ??= { kind: "settled", atMs: clock.elapsedMs() }; },
    );
    while (true) {
      if (!clock.isPaused()) {
        const deadline = activeDeadlineMs?.() ?? deadlineMs;
        // Polling may observe both expiry and a start. Judge the event's
        // active-time arrival, preserving starts accepted before the cutoff.
        const outcome = state.outcome;
        if (outcome) return outcome.atMs < deadline ? outcome.kind : "timeout";
        if (clock.elapsedMs() >= deadline) return "timeout";
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
  /** Only publish app onStart when this owned startup accepts the event. */
  primary: (onStart: () => boolean, onAudioReady: () => void) => Promise<void>;
  fallback: () => Promise<void>;
  abandonPrimary: () => void;
  /** Caller display state is not allowed to override the owned startup outcome. */
  hasStarted: () => boolean;
  canFallback: () => boolean;
  onFallback?: (reason: "settled" | "timeout") => void;
  deadlineMs?: number;
  clock?: PauseAwareSpeechClock;
}): Promise<void> {
  let announceStart: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { announceStart = resolve; });
  const clock = input.clock ?? createPauseAwareSpeechClock();
  const deadlineMs = input.deadlineMs ?? SPEECH_STARTUP_DEADLINE_MS;
  let readyAtMs: number | null = null;
  let ownsPrimary = true;
  let acceptedStart = false;
  const activeDeadlineMs = () => readyAtMs === null ? deadlineMs :
    Math.max(deadlineMs, readyAtMs + SPEECH_MEDIA_READY_GRACE_MS);
  const primary = input.primary(
    () => {
      if (!ownsPrimary || clock.isPaused() || clock.elapsedMs() >= activeDeadlineMs()) return false;
      acceptedStart = true;
      announceStart?.();
      return true;
    },
    () => {
      if (ownsPrimary && readyAtMs === null && clock.elapsedMs() < activeDeadlineMs()) {
        readyAtMs = clock.elapsedMs();
      }
    },
  );
  try {
    const outcome = await waitForSpeechStartup(started, primary, deadlineMs, clock, activeDeadlineMs);
    // Native/app callback work can cross the cutoff before promise observers
    // run. Only our synchronous acceptance (never caller hasStarted) may win.
    if (outcome !== "started" && !acceptedStart) {
      ownsPrimary = false;
      if (!input.canFallback()) return;
      input.abandonPrimary();
      input.onFallback?.(outcome);
      await input.fallback();
      return;
    }
    await primary;
  } finally {
    ownsPrimary = false;
  }
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
    try {
      await input.speak({
        onStart: () => { started = true; },
        onEnd: () => { ended = true; },
        onError: (reason) => { error = reason; },
      });
    } catch (reason) {
      error = reason;
    }
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
