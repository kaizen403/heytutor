import { useEffect, useRef, type RefObject } from "react";
import type Konva from "konva";
import type { WhiteboardHandle } from "@heytutor/whiteboard";

function visibleInk(board: WhiteboardHandle): Konva.Node[] {
  return [board.getDrawLayer(), board.getAnimLayer()].flatMap(layer =>
    layer?.getChildren().filter(node => node.isVisible() && node.getAbsoluteOpacity() > 0) ?? [],
  );
}

/** Read existing rendered glyph metadata, never commands or unrevealed labels. */
function minimumFontSize(ink: Konva.Node[]): number | null {
  let minimum: number | null = null;
  for (const node of ink) {
    const size: unknown = node.getAttr("fontSize");
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) continue;
    if (node.getClassName() === "Text" && !String(node.getAttr("text") ?? "").trim()) continue;
    const dash: unknown = node.getAttr("dash");
    // A scheduled stroke is mounted before the first pixel of it is revealed.
    if (Array.isArray(dash) && dash.length > 0 && Number(node.getAttr("dashOffset")) >= Number(dash[0])) continue;
    minimum = Math.min(minimum ?? size, size);
  }
  return minimum;
}

export function minimumVisibleBoardFontSize(board: WhiteboardHandle): number | null {
  return minimumFontSize(visibleInk(board));
}

export interface BoardReadingInput {
  enabled: boolean;
  follow: boolean;
  boardRef: RefObject<WhiteboardHandle | null>;
  paneRef: RefObject<HTMLDivElement | null>;
  scale: number;
  /** A session/turn/diagram switch must not follow its predecessor's cursor. */
  scope: unknown;
  diagram: unknown;
  onMinimumFontSize: (size: number | null) => void;
}

/** View-only: keep the displayed board's moving nib inside a readable window. */
export function useBoardReading({
  enabled, follow, boardRef, paneRef, scale, scope, diagram, onMinimumFontSize,
}: BoardReadingInput): void {
  const viewRef = useRef({ follow, scale });
  useEffect(() => { viewRef.current = { follow, scale }; }, [follow, scale]);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let board = boardRef.current;
    const nibOf = (owner: WhiteboardHandle | null) => owner?.getCursorLayer()?.getChildren().find(node => node.getClassName() === "Group");
    let cursor = nibOf(board);
    let previous = cursor?.position() ?? null;
    let activity: unknown = cursor?.getAttr("htCursorActivity");
    let wasVisible = Boolean(cursor?.isVisible() && cursor.getAbsoluteOpacity() > 0);
    let wasFollowing = viewRef.current.follow;
    let lastScale = viewRef.current.scale;
    let priorInk = new Set(board ? visibleInk(board) : []);
    let fontSize: number | null | undefined;
    const tick = () => {
      const current = boardRef.current;
      if (current) {
        const ink = visibleInk(current);
        const minimum = minimumFontSize(ink);
        if (minimum !== fontSize) {
          fontSize = minimum;
          onMinimumFontSize(minimum);
        }
        const nib = nibOf(current);
        const point = nib?.position();
        const nextActivity: unknown = nib?.getAttr("htCursorActivity");
        const visible = Boolean(nib?.isVisible() && nib.getAbsoluteOpacity() > 0);
        const retiredPage = priorInk.size > 0 && !ink.some(node => priorInk.has(node));
        const changedOwner = board !== current || cursor !== nib || retiredPage;
        // A same-board page can be replaced and receive a zero-distance POINT
        // between samples. Fence its first sample, but retain that accepted
        // command's new intent for the next frame instead of swallowing it.
        const pendingPageActivity = retiredPage && board === current && cursor === nib && nextActivity !== activity;
        const moved = point && previous && (point.x !== previous.x || point.y !== previous.y);
        const { follow: following, scale: currentScale } = viewRef.current;
        const active = moved || nextActivity !== activity || !wasFollowing || !wasVisible || lastScale !== currentScale;
        const pane = paneRef.current;
        if (following && !changedOwner && active && point && ink.length > 0 && pane && visible &&
          Number.isFinite(point.x) && Number.isFinite(point.y)) {
          const surface = pane.querySelector<HTMLElement>(".wb-surface");
          if (surface) {
            const paper = surface.getBoundingClientRect();
            const window = pane.getBoundingClientRect();
            const x = paper.left - window.left + pane.scrollLeft + point.x * currentScale;
            const y = paper.top - window.top + pane.scrollTop + point.y * currentScale;
            const reveal = (value: number, start: number, length: number, total: number) => {
              const margin = Math.min(48, length / 5);
              const next = value < start + margin ? value - margin
                : value > start + length - margin ? value - length + margin : start;
              return Math.max(0, Math.min(next, Math.max(total - length, 0)));
            };
            const left = reveal(x, pane.scrollLeft, pane.clientWidth, pane.scrollWidth);
            const top = reveal(y, pane.scrollTop, pane.clientHeight, pane.scrollHeight);
            if (left !== pane.scrollLeft || top !== pane.scrollTop) pane.scrollTo({ left, top, behavior: "auto" });
          }
        }
        board = current;
        cursor = nib;
        previous = point ? { ...point } : null;
        if (!pendingPageActivity) activity = nextActivity;
        wasFollowing = following;
        wasVisible = visible;
        lastScale = currentScale;
        if (ink.length !== priorInk.size || ink.some(node => !priorInk.has(node))) priorInk = new Set(ink);
      } else {
        board = null;
        cursor = undefined;
        previous = null;
        priorInk.clear();
        if (fontSize !== null) { fontSize = null; onMinimumFontSize(null); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, boardRef, paneRef, scope, diagram, onMinimumFontSize]);
}
