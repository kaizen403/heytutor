import type { VirtualWhiteboardClock } from "@heytutor/whiteboard";

/**
 * Lesson time the export keeps drawing after the last word before it gives up
 * waiting and finishes the file with what is on the board.
 */
export const LECTURE_EXPORT_TAIL_LIMIT_MS = 8_000;

export type ExportTailClock = Pick<
  VirtualWhiteboardClock,
  "now" | "setNow" | "pump" | "pendingCount"
>;

export type ExportTailResult = {
  /** The drawing finished (or failed) inside the limit. */
  settled: boolean;
  /** Cancel was pressed while the tail drained. */
  cancelled: boolean;
  /** Lesson time the clock moved past `startMs`. */
  extraMs: number;
  /** Steps handed to `onStep`, one per encoded tail frame. */
  steps: number;
  /** What the drawing threw, if it threw. */
  error: unknown;
};

/** Pump until no frame callback asks for another one this instant. */
export async function pumpExportClock(clock: ExportTailClock): Promise<void> {
  clock.pump();
  await Promise.resolve();
  for (let extra = 0; extra < 8; extra++) {
    if (clock.pendingCount() === 0) {
      break;
    }
    clock.pump();
    await Promise.resolve();
  }
}

const yieldMacrotask = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Finishes the drawing after the frame loop has reached the end of the audio.
 *
 * The export board only moves when its virtual clock is pumped. Ink, dwells and
 * pauses that run past the last cue's end wait on that clock, so a bare
 * `await drawPromise` after the loop waits for ever (the 99% hang). This keeps
 * the clock moving in `stepMs` strides, as the lecture player's catch up does,
 * until the drawing settles, Cancel is pressed, or `limitMs` of lesson time has
 * passed. It never awaits the drawing unguarded.
 *
 * When the drawing was already done before the tail moved the clock, no step
 * is reported, so a lesson whose audio covered its ink encodes exactly as
 * before. Otherwise every step is reported, including the one where the last
 * mark lands, even when that is the very first advance.
 */
export async function drainExportTail(options: {
  clock: ExportTailClock;
  drawPromise: Promise<unknown>;
  shouldCancel: () => boolean;
  /** Lesson time of the first tail frame (at or after the timeline's end). */
  startMs: number;
  stepMs: number;
  limitMs?: number;
  /** Encode the board at `mediaMs`; called after the clock was pumped there. */
  onStep?: (mediaMs: number, step: number) => Promise<void> | void;
  yieldToHost?: () => Promise<void>;
}): Promise<ExportTailResult> {
  const limitMs = Math.max(0, options.limitMs ?? LECTURE_EXPORT_TAIL_LIMIT_MS);
  const stepMs = Math.max(1, options.stepMs);
  const yieldToHost = options.yieldToHost ?? yieldMacrotask;
  let settled = false;
  let error: unknown = undefined;
  void options.drawPromise.then(
    () => {
      settled = true;
    },
    (reason: unknown) => {
      settled = true;
      error = reason;
    },
  );

  // Let a drawing that already finished say so before the clock moves: only
  // then may the tail add no frame. One that finishes on an advance below
  // gets the frame of that advance, or its last marks are not in the file.
  await Promise.resolve();
  const doneBeforeTail = settled;

  let extraMs = 0;
  let steps = 0;
  for (;;) {
    if (options.shouldCancel()) {
      // Release every wait that re-checks the cancel flag after an advance.
      options.clock.pump();
      await yieldToHost();
      return { settled, cancelled: true, extraMs, steps, error };
    }
    if (doneBeforeTail) {
      return { settled, cancelled: false, extraMs, steps, error };
    }
    options.clock.setNow(options.startMs + extraMs);
    await pumpExportClock(options.clock);
    await yieldToHost();
    await options.onStep?.(options.startMs + extraMs, steps);
    steps += 1;
    if (settled) {
      return { settled, cancelled: false, extraMs, steps, error };
    }
    if (extraMs + stepMs > limitMs) {
      return { settled: false, cancelled: false, extraMs, steps, error };
    }
    extraMs += stepMs;
  }
}
