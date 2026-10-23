import type { RefObject } from "react";
import { MIN_BOARD_FONT_SIZE } from "@heytutor/drawing";
import { useEffect, useRef, useState } from "react";
import {
  BOARD_FRAME_MOBILE_MQ,
  BOARD_FRAME_KEYBOARD_INSET_PX,
  boardFramePaddingPx,
  shouldLockBoardScale,
} from "../lib/board/boardFrame";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../constants";
import type { BoardViewport } from "../types";

export type BoardViewportMode = "fit" | "fixed" | "readable-scroll";

const FIXED_VIEWPORT: BoardViewport = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  measured: true,
};

export function useBoardViewport(
  containerRef: RefObject<HTMLDivElement | null>,
  mode: BoardViewportMode = "fit",
  minimumVisibleFontSize?: number | null,
): BoardViewport {
  const fontSizeRef = useRef(minimumVisibleFontSize);
  const refreshRef = useRef<(() => void) | null>(null);
  const fontChangedRef = useRef(false);
  const [viewport, setViewport] = useState<BoardViewport>(
    mode === "fixed"
      ? FIXED_VIEWPORT
      : { scale: 0.1, offsetX: 0, offsetY: 0, measured: false, scrollable: false },
  );

  useEffect(() => {
    if (mode === "fixed") {
      return;
    }

    const container = containerRef.current;
    if (!container) return;
    // The deck stays mounted even while empty. Its natural-size transport or
    // code panel shares the container with the fitted paper.
    const deck = container.querySelector<HTMLElement>("[data-board-deck]");

    let rafId = 0;
    let timeoutId = 0;
    let retries = 0;
    /**
     * The box and the scale the last accepted fit was made from.
     *
     * These live beside the state rather than inside the `setViewport`
     * updater. React may run an updater more than once for a single dispatch
     * (it computes the next state eagerly to decide whether to schedule a
     * render at all, then computes it again while rendering), so an updater
     * that writes its own bookkeeping reads that bookkeeping back on the
     * second run: the box it just recorded, a zero delta, and a lock. Whether
     * the second run happened depended on what else was pending, so the board
     * refit worked through a sidebar animation, which fires a stream of resize
     * events, and silently failed on a phone rotation, which fires one.
     */
    const lastBox = { width: 0, height: 0 };
    let lastScale = 0;
    let lastScrollable = false;
    let measured = false;

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
      const readabilityChanged = fontChangedRef.current;
      fontChangedRef.current = false;

      const visual = window.visualViewport;
      const keyboardInset = visual
        ? Math.max(0, Math.round(window.innerHeight - (visual.offsetTop + visual.height)))
        : 0;
      // The keyboard shrinks this container as well as the visual viewport.
      // A dock or code-panel toggle must not turn that temporary box into the
      // accepted fit. Keep the paper scale until it closes;
      // a genuine width change (rotation/sidebar) still accepts a new fit.
      const keyboardLocked =
        measured &&
        keyboardInset >= BOARD_FRAME_KEYBOARD_INSET_PX &&
        shouldLockBoardScale({
          widthDelta: width - lastBox.width,
          heightDelta: -keyboardInset,
          keyboardInset,
        });

      const availWidth = Math.max(width - framePadding, 1);
      let deckHeight = deck?.getBoundingClientRect().height ?? 0;
      const codePanel = deck?.querySelector<HTMLElement>('[data-board-code-panel="below"]');
      if (
        deck &&
        codePanel &&
        window.matchMedia("(max-width: 767px)").matches
      ) {
        // Reserve paper first, then let the real scrollable editor use what
        // remains after transport and margins. A minimum scale alone would
        // push the uncapped panel outside the measured column.
        const paperHeight = keyboardLocked
          ? lastScale * BOARD_HEIGHT
          : Math.min(
          (availWidth / BOARD_WIDTH) * BOARD_HEIGHT,
          Math.max(height - framePadding, 1) * 0.45,
        );
        const panelHeight = codePanel.getBoundingClientRect().height;
        const panelStyle = getComputedStyle(codePanel);
        const panelMargin = Number.parseFloat(panelStyle.marginTop) || 0;
        const renderedMargin = panelStyle.display === "none" ? 0 : panelMargin;
        const otherDeckHeight = Math.max(deckHeight - panelHeight - renderedMargin, 0);
        const panelMaxHeight = Math.max(height - framePadding - paperHeight - otherDeckHeight - panelMargin, 0);
        // A newly revealed panel must receive its budget even with the
        // keyboard already up. If there is no room for its editor chrome,
        // defer the below-board panel until the keyboard closes; keep the
        // controller and its typed text mounted throughout.
        const deferPanel = keyboardLocked && panelMaxHeight < 64;
        deck.style.setProperty("--board-panel-max-height", `${panelMaxHeight}px`);
        deck.style.setProperty("--board-panel-display", deferPanel ? "none" : "flex");
        // Read the resulting layout, including panel borders and its hidden
        // margin. This avoids fitting against its previous larger/smaller cap.
        deckHeight = deck.getBoundingClientRect().height;
      } else {
        deck?.style.removeProperty("--board-panel-max-height");
        deck?.style.removeProperty("--board-panel-display");
      }
      const minimumFont = fontSizeRef.current;
      // Undefined retains the explicit readable-scroll API's conservative
      // default. The session supplies null for a blank page and the actual
      // smallest visible glyph size once ink exists.
      const minimumScale = mode === "readable-scroll"
        ? minimumFont === null ? 0 : 16 / (minimumFont ?? MIN_BOARD_FONT_SIZE)
        : 0;
      if (keyboardLocked) {
        // The lock can hold a scale larger than the remaining ink needs.
        // Carry that invalidation through to keyboard-close, even when the
        // restored box is byte-identical to the last accepted fit.
        fontChangedRef.current = readabilityChanged;
        const scale = Math.max(lastScale, minimumScale);
        const scrollable = mode === "readable-scroll" && (
          scale * BOARD_WIDTH > availWidth + 1 ||
          scale * BOARD_HEIGHT > Math.max(height - deckHeight - framePadding, 1) + 1
        );
        if (scale !== lastScale || scrollable !== lastScrollable) {
          lastScale = scale;
          lastScrollable = scrollable;
          setViewport({ scale, offsetX: 0, offsetY: 0, measured: true, scrollable });
        }
        return;
      }
      height = Math.max(height - deckHeight, 1);
      const availHeight = Math.max(height - framePadding, 1);

      const widthScale = availWidth / BOARD_WIDTH;
      const heightScale = availHeight / BOARD_HEIGHT;

      // Keep the old full-sheet fit wherever the ink is already readable.
      // Only visible text can require a larger sheet; a retired 19px label or
      // the global type-scale minimum must not enlarge a blank/large-type page.
      const fitScale = Math.min(widthScale, heightScale, windowFallback ? 1 : Number.POSITIVE_INFINITY);
      const nextScale =
        mode === "readable-scroll"
          ? Math.max(fitScale, minimumScale)
          : fitScale;
      const scrollable = mode === "readable-scroll" && nextScale > fitScale + 0.001;
      // Avoid sub-pixel thrash from ResizeObserver feedback.
      if (measured && Math.abs(lastScale - nextScale) < 0.001 && lastScrollable === scrollable) {
        return;
      }
      // Keyboard and tiny height wobble must not rescale a live lecture.
      // The composer docking under the board is a real layout shrink and
      // must refit, or the paper keeps the empty-landing size.
      if (
        measured &&
        !readabilityChanged &&
        lastScrollable === scrollable &&
        lastBox.width > 0 &&
        shouldLockBoardScale({
          widthDelta: width - lastBox.width,
          heightDelta: height - lastBox.height,
          keyboardInset,
        })
      ) {
        return;
      }

      lastBox.width = width;
      lastBox.height = height;
      lastScale = nextScale;
      lastScrollable = scrollable;
      measured = true;
      setViewport({ scale: nextScale, offsetX: 0, offsetY: 0, measured: true, scrollable });
    };

    refreshRef.current = updateScale;
    updateScale();
    // Budget writes can resize the deck itself. Leave observer delivery
    // before applying them so the next fit cannot feed a same-frame loop.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateScale);
    });
    observer.observe(container);
    if (deck) observer.observe(deck);

    const media = window.matchMedia(BOARD_FRAME_MOBILE_MQ);
    media.addEventListener("change", updateScale);
    window.visualViewport?.addEventListener("resize", updateScale);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      observer.disconnect();
      refreshRef.current = null;
      deck?.style.removeProperty("--board-panel-max-height");
      deck?.style.removeProperty("--board-panel-display");
      media.removeEventListener("change", updateScale);
      window.visualViewport?.removeEventListener("resize", updateScale);
    };
  }, [containerRef, mode]);

  useEffect(() => {
    if (fontSizeRef.current === minimumVisibleFontSize) return;
    fontSizeRef.current = minimumVisibleFontSize;
    fontChangedRef.current = true;
    refreshRef.current?.();
  }, [minimumVisibleFontSize]);

  return viewport;
}
