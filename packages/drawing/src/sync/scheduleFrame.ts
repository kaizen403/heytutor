/**
 * rAF is paused in background tabs and other macOS Spaces. Lectures still
 * need a clock there, so hidden documents fall back to a short timeout.
 */
const HIDDEN_FRAME_MS = 16;

export function scheduleFrame(callback: FrameRequestCallback): number {
  if (typeof document !== "undefined" && document.hidden) {
    return fallbackTimeout(callback);
  }
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return fallbackTimeout(callback);
}

export function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(id);
  }
  if (typeof clearTimeout === "function") {
    clearTimeout(id);
  }
}

function fallbackTimeout(callback: FrameRequestCallback): number {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return setTimeout(() => callback(now + HIDDEN_FRAME_MS), HIDDEN_FRAME_MS) as unknown as number;
}
