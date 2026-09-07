import { scheduleFrame } from "@heytutor/drawing";

export function isWhiteboardReadyToDraw<T extends { getDrawLayer?: () => unknown }>(
  whiteboard: T | null | undefined,
): whiteboard is T {
  return whiteboard?.getDrawLayer?.() != null;
}

export async function waitForWhiteboard(
  whiteboardRef: { current: { getDrawLayer?: () => unknown } | null },
  maxMs = 8_000,
): Promise<boolean> {
  const start = Date.now();
  while (!isWhiteboardReadyToDraw(whiteboardRef.current)) {
    if (Date.now() - start >= maxMs) {
      return false;
    }
    // rAF is silent in some background webviews that do not set
    // document.hidden, so a frame callback alone can hang boot forever.
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      scheduleFrame(() => done());
      setTimeout(done, 50);
    });
  }
  return true;
}
