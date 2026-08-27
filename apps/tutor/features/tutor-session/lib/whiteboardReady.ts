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
    await new Promise<void>((resolve) => {
      scheduleFrame(() => resolve());
    });
  }
  return true;
}
