import { measureTextWidth, WORK_CONTINUATION_INDENT } from "@heytutor/drawing";
import {
  ANNOTATION_SNAP_DISTANCE,
  BOARD_WIDTH,
  DIAGRAM_ZONE,
  TEXT_LAYOUT,
} from "../../constants";
import type { BoardLayoutState, BoardTextRect } from "../../types";

export function isInDiagramZone(x: number, y: number): boolean {
  return (
    x >= DIAGRAM_ZONE.x &&
    x <= DIAGRAM_ZONE.x + DIAGRAM_ZONE.width &&
    y >= DIAGRAM_ZONE.y &&
    y <= DIAGRAM_ZONE.y + DIAGRAM_ZONE.height
  );
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function estimateBoardTextWidth(text: string): number {
  const measured = measureTextWidth(text, 32);
  return clampNumber(measured + 16, 40, BOARD_WIDTH - TEXT_LAYOUT.marginX * 2);
}

export function estimateBoardTextWidthAtSize(text: string, fontSize: number): number {
  const measured = measureTextWidth(text, fontSize);
  return clampNumber(measured + 8, 24, BOARD_WIDTH - TEXT_LAYOUT.marginX * 2);
}

export function textRectsOverlap(a: BoardTextRect, b: BoardTextRect, padding = 12): boolean {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

export function pointNearRect(
  px: number,
  py: number,
  rect: BoardTextRect,
  padding = ANNOTATION_SNAP_DISTANCE,
): boolean {
  return (
    px >= rect.x - padding &&
    px <= rect.x + rect.width + padding &&
    py >= rect.y - padding &&
    py <= rect.y + rect.height + padding
  );
}

export function lineNearRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: BoardTextRect,
  padding = ANNOTATION_SNAP_DISTANCE,
): boolean {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return pointNearRect(midX, midY, rect, padding);
}

export function bboxNearRect(
  x: number,
  y: number,
  w: number,
  h: number,
  rect: BoardTextRect,
  padding = ANNOTATION_SNAP_DISTANCE,
): boolean {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return pointNearRect(cx, cy, rect, padding);
}

export function pointRectDistance(px: number, py: number, rect: BoardTextRect): number {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return Math.hypot(px - cx, py - cy);
}

export function findNearestTextRect(
  probe: (rect: BoardTextRect) => boolean,
  rects: BoardTextRect[],
  referencePoint?: { x: number; y: number },
): BoardTextRect | null {
  const candidates = rects.filter(probe);
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (!referencePoint) {
    return candidates[0];
  }
  let best = candidates[0];
  let bestDist = pointRectDistance(referencePoint.x, referencePoint.y, best);
  for (let i = 1; i < candidates.length; i++) {
    const d = pointRectDistance(referencePoint.x, referencePoint.y, candidates[i]);
    if (d < bestDist) {
      best = candidates[i];
      bestDist = d;
    }
  }
  return best;
}

export function registerBoardAnchor(layout: BoardLayoutState, rect: BoardTextRect): void {
  layout.rects.push(rect);
}

const WORK_AREA_MAX_X = 400;

export function withWorkRowIdentity(layout: BoardLayoutState, rect: BoardTextRect): BoardTextRect {
  if (rect.x >= WORK_AREA_MAX_X || !rect.text) return rect;
  if (rect.workIndex != null && rect.workId) return rect;
  let maxIndex = 0;
  for (const existing of layout.rects) {
    if (existing.workIndex != null && existing.workIndex > maxIndex) {
      maxIndex = existing.workIndex;
    }
  }
  const workIndex = maxIndex + 1;
  return { ...rect, workIndex, workId: `w${workIndex}` };
}

export function getWorkAreaFlowStartY(layout: BoardLayoutState): number {
  const hasHeading = layout.rects.some((rect) => rect.y < TEXT_LAYOUT.headingBottomY);
  const queuedY = Math.max(layout.nextY, TEXT_LAYOUT.topY);
  if (hasHeading && queuedY <= TEXT_LAYOUT.headingBottomY) {
    return TEXT_LAYOUT.workTopY;
  }
  return queuedY;
}

export interface WorkTextSlotOptions {
  layout: BoardLayoutState;
  requestedX: number;
  requestedY: number;
  width: number;
  height: number;
  diagramActive: boolean;
  sequential: boolean;
  runtimeOwnsX: boolean;
}

/** Pure slot selection used by live drawing and deterministic layout tests. */
/**
 * How wide the solution column is right now.
 *
 * A committed figure holds the right of the board, so the column stops short of
 * its left edge; with no figure the column is the whole board less both
 * margins. Exported because the row's *size* is chosen from this width before
 * a slot is ever asked for — one steady size per column, wrapped to fit.
 */
export function workColumnMaxWidth(
  layout: BoardLayoutState,
  diagramActive: boolean,
): number {
  const diagramRects = diagramActive
    ? layout.rects.filter((rect) => rect.x >= DIAGRAM_ZONE.x)
    : [];
  const diagramLeftEdge =
    diagramRects.length > 0
      ? Math.min(...diagramRects.map((rect) => rect.x))
      : DIAGRAM_ZONE.x;
  const columnRight = diagramActive
    ? Math.max(TEXT_LAYOUT.marginX + 160, diagramLeftEdge - 28)
    : BOARD_WIDTH - TEXT_LAYOUT.marginX;
  return Math.max(columnRight - TEXT_LAYOUT.marginX, 40);
}

/**
 * The one x offset a runtime-owned row may keep: the wrapped-continuation
 * indent. Everything else snaps to the margin, so a model that asks for its own
 * x still cannot shift the column, but a continuation stays set in under the
 * line it belongs to.
 */
export function workRowIndentOf(requestedX: number): number {
  if (!Number.isFinite(requestedX)) return 0;
  const offset = requestedX - TEXT_LAYOUT.marginX;
  return Math.abs(offset - WORK_CONTINUATION_INDENT) <= WORK_CONTINUATION_INDENT / 2
    ? WORK_CONTINUATION_INDENT
    : 0;
}

export function findWorkTextSlot({
  layout,
  requestedX,
  requestedY,
  width,
  height,
  diagramActive,
  sequential,
  runtimeOwnsX,
}: WorkTextSlotOptions): { x: number; y: number; maxWidth: number } | null {
  const isDiagramRect = (rect: BoardTextRect) => rect.x >= DIAGRAM_ZONE.x;
  const maxWidth = workColumnMaxWidth(layout, diagramActive);
  const columnRight = TEXT_LAYOUT.marginX + maxWidth;
  const occupiedWidth = Math.min(width, maxWidth);
  const maxX = columnRight - occupiedWidth;
  const candidateX = runtimeOwnsX
    ? TEXT_LAYOUT.marginX + workRowIndentOf(requestedX)
    : clampNumber(requestedX, TEXT_LAYOUT.marginX, Math.max(TEXT_LAYOUT.marginX, maxX));
  const flowStart = Math.max(
    getWorkAreaFlowStartY(layout),
    diagramActive ? TEXT_LAYOUT.workTopY : TEXT_LAYOUT.topY,
  );
  const startY = sequential
    ? flowStart
    : clampNumber(requestedY, TEXT_LAYOUT.topY, TEXT_LAYOUT.bottomY - height);

  // A sequential row that has flowed past the bottom must roll the page, not be
  // clamped back up. Clamping squeezed one extra row in off-grid, tight under
  // the last one, and only an overlap test happened to stop it — so the real
  // capacity depended on whether the squeezed row collided, which drifted from
  // the row count the teaching prompt is told whenever the pitch changed.
  const scanStart = sequential
    ? startY
    : clampNumber(startY, TEXT_LAYOUT.topY, TEXT_LAYOUT.bottomY - height);
  // An indented continuation still has to stop at the same right edge, so it
  // has that much less room than a row starting at the margin.
  const usableWidth = Math.max(columnRight - candidateX, 40);

  for (
    let tryY = scanStart;
    tryY <= TEXT_LAYOUT.bottomY - height;
    tryY += TEXT_LAYOUT.lineHeight
  ) {
    const rect = { x: candidateX, y: tryY, width: occupiedWidth, height };
    if (
      !layout.rects.some(
        (occupied) =>
          !(diagramActive && isDiagramRect(occupied)) &&
          textRectsOverlap(rect, occupied),
      )
    ) {
      return { x: candidateX, y: tryY, maxWidth: usableWidth };
    }
  }

  return null;
}

export function overlapsWorkArea(rect: BoardTextRect): boolean {
  return textRectsOverlap(
    rect,
    {
      x: TEXT_LAYOUT.eraseX,
      y: TEXT_LAYOUT.eraseY,
      width: TEXT_LAYOUT.eraseWidth,
      height: TEXT_LAYOUT.eraseHeight,
    },
    0,
  );
}

export function underlineParamsForRect(match: BoardTextRect, pad: number): number[] {
  return [
    match.x - pad,
    match.y + match.height + 2,
    match.x + match.width + pad,
    match.y + match.height + 2,
  ];
}

export function bboxParamsForRect(match: BoardTextRect, pad: number): number[] {
  return [match.x - pad, match.y - pad, match.width + pad * 2, match.height + pad * 2];
}
