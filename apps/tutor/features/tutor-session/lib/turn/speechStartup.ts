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

export async function waitForSpeechStartup(
  started: Promise<void>,
  completed: Promise<void>,
  deadlineMs: number = SPEECH_STARTUP_DEADLINE_MS,
): Promise<"started" | "settled" | "timeout"> {
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
}): Promise<void> {
  let announceStart: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { announceStart = resolve; });
  const primary = input.primary(() => announceStart?.());
  const outcome = await waitForSpeechStartup(started, primary, input.deadlineMs);
  if (outcome !== "started" && !input.hasStarted()) {
    if (!input.canFallback()) return;
    input.abandonPrimary();
    input.onFallback?.(outcome);
    await input.fallback();
    return;
  }
  await primary;
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
