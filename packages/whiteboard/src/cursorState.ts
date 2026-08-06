export type CursorState = "idle" | "thinking" | "speaking" | "drawing" | "erasing";

export function cursorOpacity(state: CursorState): number {
  if (state === "idle") return 0;
  if (state === "erasing") return 0.95;
  if (state === "thinking") return 0.75;
  if (state === "speaking") return 0.9;
  return 1;
}
