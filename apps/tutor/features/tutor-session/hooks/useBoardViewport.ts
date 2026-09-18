import type { RefObject } from "react";
import { useEffect, useState } from "react";
import {
  BOARD_FRAME_MOBILE_MQ,
  boardFramePaddingPx,
  shouldLockBoardScale,
} from "../lib/board/boardFrame";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../constants";
import type { BoardViewport } from "../types";

export type BoardViewportMode = "fit" | "fixed";

const FIXED_VIEWPORT: BoardViewport = { scale: 1, offsetX: 0, offsetY: 0, measured: true };

export function useBoardViewport(
  containerRef: RefObject<HTMLDivElement | null>,
  mode: BoardViewportMode = "fit",
): BoardViewport {
  const [viewport, setViewport] = useState<BoardViewport>(
    mode === "fixed" ? FIXED_VIEWPORT : { scale: 0.1, offsetX: 0, offsetY: 0, measured: false },
  );

  useEffect(() => {
    if (mode === "fixed") {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let rafId = 0;
    let timeoutId = 0;
    let retries = 0;
    const lastBox = { width: 0, height: 0 };

    const updateScale = () => {
      const box = container.getBoundingClientRect();
      let width = box.width;
      let height = box.height;
      let windowFallback = false;
      // An empty landing parks the board as `absolute` with no inset, so the
      // first measure is often 0×0. rAF retries also never fire in some
      // background webviews. A stuck 0.1 scale shrinks the figure; using the
      // raw window overshoots (sidebar) and clips the same figure.
      if (width <= 0 || height <= 0) {
        if (retries < 30) {
          retries += 1;
          cancelAnimationFrame(rafId);
          window.clearTimeout(timeoutId);
          rafId = requestAnimationFrame(updateScale);
          timeoutId = window.setTimeout(updateScale, 50);
          return;
        }
        windowFallback = true;
        width = Math.max(window.innerWidth - 360, 720);
        height = Math.max(window.innerHeight - 200, 420);
      } else {
        retries = 0;
      }

      const framePadding = boardFramePaddingPx(
        window.matchMedia(BOARD_FRAME_MOBILE_MQ).matches,
      );

      const availWidth = Math.max(width - framePadding, 1);
      const availHeight = Math.max(height - framePadding, 1);

      const widthScale = availWidth / BOARD_WIDTH;
      const heightScale = availHeight / BOARD_HEIGHT;

      // Fit the board inside the container without cropping.
      const nextScale = Math.min(widthScale, heightScale, windowFallback ? 1 : Number.POSITIVE_INFINITY);
      const visual = window.visualViewport;
      const keyboardInset = visual
        ? Math.max(0, Math.round(window.innerHeight - (visual.offsetTop + visual.height)))
        : 0;
      // Avoid sub-pixel thrash from ResizeObserver feedback.
      setViewport((prev) => {
        if (prev.measured && Math.abs(prev.scale - nextScale) < 0.001) return prev;
        // Keyboard and tiny height wobble must not rescale a live lecture.
        // The composer docking under the board is a real layout shrink and
        // must refit, or the paper keeps the empty-landing size.
        if (
          prev.measured &&
          lastBox.width > 0 &&
          shouldLockBoardScale({
            widthDelta: width - lastBox.width,
            heightDelta: height - lastBox.height,
            keyboardInset,
          })
        ) {
          return prev;
        }
        lastBox.width = width;
        lastBox.height = height;
        return { scale: nextScale, offsetX: 0, offsetY: 0, measured: true };
      });
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);

    const media = window.matchMedia(BOARD_FRAME_MOBILE_MQ);
    media.addEventListener("change", updateScale);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      observer.disconnect();
      media.removeEventListener("change", updateScale);
    };
  }, [containerRef, mode]);

  return viewport;
}
