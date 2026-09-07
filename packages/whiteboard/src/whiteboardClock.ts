import { cancelFrame, scheduleFrame } from "@heytutor/drawing";

/**
 * Clock the whiteboard animations read. Live teaching uses the wall clock.
 * Lecture MP4 export injects a virtual clock so frames do not depend on rAF
 * or the tab staying focused.
 */
export interface WhiteboardTimeSource {
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}

export const DEFAULT_WHITEBOARD_TIME_SOURCE: WhiteboardTimeSource = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  requestFrame: scheduleFrame,
  cancelFrame,
};

export interface VirtualWhiteboardClock {
  source: WhiteboardTimeSource;
  now: () => number;
  setNow: (ms: number) => void;
  advance: (ms: number) => void;
  pump: () => void;
  waitForAdvance: () => Promise<void>;
  pendingCount: () => number;
}

export function createVirtualWhiteboardClock(startMs = 0): VirtualWhiteboardClock {
  let now = startMs;
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  const advanceWaiters: Array<() => void> = [];

  const source: WhiteboardTimeSource = {
    now: () => now,
    requestFrame: (callback) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    cancelFrame: (id) => {
      pending.delete(id);
    },
  };

  const flushAdvanceWaiters = (): void => {
    const waiters = advanceWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  };

  return {
    source,
    now: () => now,
    setNow: (ms) => {
      now = ms;
    },
    advance: (ms) => {
      now += ms;
    },
    pump: () => {
      const callbacks = [...pending.entries()];
      pending.clear();
      for (const [, callback] of callbacks) {
        callback(now);
      }
      flushAdvanceWaiters();
    },
    waitForAdvance: () =>
      new Promise<void>((resolve) => {
        advanceWaiters.push(resolve);
      }),
    pendingCount: () => pending.size,
  };
}

export type BoardCaptureKind = "snapshot" | "frame";

/**
 * Notes PDF snapshots always hide the pen. Lecture frames keep it unless the
 * caller opts out.
 */
export function shouldHideCursorForCapture(
  kind: BoardCaptureKind,
  hideCursor?: boolean,
): boolean {
  if (kind === "snapshot") {
    return true;
  }
  return hideCursor === true;
}

export interface CaptureFrameOptions {
  pixelRatio?: number;
  hideCursor?: boolean;
}
