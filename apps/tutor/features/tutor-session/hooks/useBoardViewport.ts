import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../constants";
import type { BoardViewport } from "../types";

/** Desktop frame padding (16px surface inset on each side). */
const FRAME_PADDING_DESKTOP = 32;
/** Mobile frame padding (10px surface inset on each side). */
const FRAME_PADDING_MOBILE = 20;
const MOBILE_MQ = "(max-width: 640px)";

export function useBoardViewport(containerRef: RefObject<HTMLDivElement | null>): BoardViewport {
  const [viewport, setViewport] = useState<BoardViewport>({
    scale: 0.1,
    offsetX: 0,
    offsetY: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScale = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const framePadding = window.matchMedia(MOBILE_MQ).matches
        ? FRAME_PADDING_MOBILE
        : FRAME_PADDING_DESKTOP;

      const availWidth = Math.max(width - framePadding, 1);
      const availHeight = Math.max(height - framePadding, 1);

      const widthScale = availWidth / BOARD_WIDTH;
      const heightScale = availHeight / BOARD_HEIGHT;

      // Fit the board inside the container without cropping.
      const nextScale = Math.min(widthScale, heightScale);
      // Avoid sub-pixel thrash from ResizeObserver feedback.
      setViewport((prev) => {
        if (Math.abs(prev.scale - nextScale) < 0.001) return prev;
        return { scale: nextScale, offsetX: 0, offsetY: 0 };
      });
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);

    const media = window.matchMedia(MOBILE_MQ);
    media.addEventListener("change", updateScale);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", updateScale);
    };
  }, [containerRef]);

  return viewport;
}
