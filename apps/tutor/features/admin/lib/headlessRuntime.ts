import { BOARD_HEIGHT, BOARD_WIDTH } from "@/features/tutor-session/constants";

/** Scaled live preview so the admin can see ink without covering the syllabus. */
export const HEADLESS_PREVIEW_SCALE = 0.36;

export const LIVE_WATCH_SLOT_ATTR = "data-live-watch-slot";

export type LiveWatchSlotRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function headlessLecturePreviewSize(): { width: number; height: number } {
  return {
    width: Math.round(BOARD_WIDTH * HEADLESS_PREVIEW_SCALE),
    height: Math.round(BOARD_HEIGHT * HEADLESS_PREVIEW_SCALE),
  };
}

/** Keep Konva in the viewport without showing stacked live canvases. */
export function headlessLectureOffscreenStyle(index: number): {
  position: "fixed";
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  overflow: "hidden";
  pointerEvents: "none";
  zIndex: number;
} {
  return {
    position: "fixed",
    left: 0,
    top: index * 4,
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    opacity: 0,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: -1,
  };
}

export function liveRecordingsDockStyle(): {
  position: "fixed";
  right: number;
  bottom: number;
  zIndex: number;
} {
  return {
    position: "fixed",
    right: 16,
    bottom: 88,
    zIndex: 40,
  };
}

export function headlessLecturePreviewStyle(index: number): {
  position: "fixed";
  right: number;
  bottom: number;
  width: number;
  height: number;
  zIndex: number;
  overflow: "hidden";
  pointerEvents: "auto";
  borderRadius: number;
  border: string;
  background: string;
  boxShadow: string;
} {
  const size = headlessLecturePreviewSize();
  const caption = 28;
  return {
    position: "fixed",
    right: 16,
    bottom: 88 + index * (size.height + caption + 12),
    width: size.width,
    height: size.height + caption,
    zIndex: 40,
    overflow: "hidden",
    pointerEvents: "auto",
    borderRadius: 12,
    border: "1px solid rgba(201,201,210,0.28)",
    background: "#151517",
    boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
  };
}

export function headlessLectureBoardStyle(scale = HEADLESS_PREVIEW_SCALE): {
  width: number;
  height: number;
  transform: string;
  transformOrigin: "top left";
  pointerEvents: "none";
} {
  return {
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    pointerEvents: "none",
  };
}

export function readLiveWatchSlotRect(root: ParentNode | Document = document): LiveWatchSlotRect | null {
  const el = root.querySelector(`[${LIVE_WATCH_SLOT_ATTR}]`);
  if (!(el instanceof HTMLElement)) {
    return null;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function promotedLectureScale(slot: Pick<LiveWatchSlotRect, "width" | "height">): number {
  if (slot.width <= 0 || slot.height <= 0) {
    return HEADLESS_PREVIEW_SCALE;
  }
  return Math.min(slot.width / BOARD_WIDTH, slot.height / BOARD_HEIGHT);
}

export function promotedLectureFrameStyle(slot: LiveWatchSlotRect): {
  position: "fixed";
  left: number;
  top: number;
  width: number;
  height: number;
  zIndex: number;
  overflow: "hidden";
  pointerEvents: "none";
  display: "flex";
  alignItems: "center";
  justifyContent: "center";
  background: string;
} {
  return {
    position: "fixed",
    left: slot.left,
    top: slot.top,
    width: slot.width,
    height: slot.height,
    zIndex: 61,
    overflow: "hidden",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0B0B0C",
  };
}

export function promotedLectureBoardWrapStyle(slot: Pick<LiveWatchSlotRect, "width" | "height">): {
  width: number;
  height: number;
  overflow: "hidden";
} {
  const scale = promotedLectureScale(slot);
  return {
    width: Math.round(BOARD_WIDTH * scale),
    height: Math.round(BOARD_HEIGHT * scale),
    overflow: "hidden",
  };
}

export function promotedLectureBoardStyle(slot: Pick<LiveWatchSlotRect, "width" | "height">): {
  width: number;
  height: number;
  transform: string;
  transformOrigin: "top left";
  pointerEvents: "none";
} {
  return headlessLectureBoardStyle(promotedLectureScale(slot));
}
