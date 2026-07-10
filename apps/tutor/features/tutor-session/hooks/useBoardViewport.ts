import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../constants";
import type { BoardViewport } from "../types";

/** Total frame padding (16px surface inset on each side). */
const FRAME_PADDING = 32;

export function useBoardViewport(containerRef: RefObject<HTMLDivElement | null>): BoardViewport {
  const [viewport, setViewport] = useState<BoardViewport>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScale = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const availWidth = Math.max(width - FRAME_PADDING, 1);
      const availHeight = Math.max(height - FRAME_PADDING, 1);

      const widthScale = availWidth / BOARD_WIDTH;
      const heightScale = availHeight / BOARD_HEIGHT;

      if (BOARD_HEIGHT * widthScale <= availHeight) {
        setViewport({ scale: widthScale, offsetX: 0, offsetY: 0 });
        return;
      }

      setViewport({ scale: heightScale, offsetX: 0, offsetY: 0 });
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  return viewport;
}
