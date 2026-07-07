import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../constants";
import type { BoardViewport } from "../types";

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

      const widthScale = width / BOARD_WIDTH;
      const heightScale = height / BOARD_HEIGHT;

      if (BOARD_HEIGHT * widthScale <= height) {
        const scale = widthScale;
        setViewport({
          scale,
          offsetX: 0,
          offsetY: (height - BOARD_HEIGHT * scale) / 2,
        });
        return;
      }

      const scale = heightScale;
      setViewport({
        scale,
        offsetX: (width - BOARD_WIDTH * scale) / 2,
        offsetY: 0,
      });
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  return viewport;
}
