import { measureTextWidth } from "@heytutor/drawing";
import {
  ANNOTATION_SNAP_DISTANCE,
  BOARD_WIDTH,
  DIAGRAM_ZONE,
  TEXT_LAYOUT,
} from "../constants";
import type { BoardLayoutState, BoardTextRect } from "../types";

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

export function getWorkAreaFlowStartY(layout: BoardLayoutState): number {
  const hasHeading = layout.rects.some((rect) => rect.y < TEXT_LAYOUT.headingBottomY);
  const queuedY = Math.max(layout.nextY, TEXT_LAYOUT.topY);
  if (hasHeading && queuedY <= TEXT_LAYOUT.headingBottomY) {
    return TEXT_LAYOUT.workTopY;
  }
  return queuedY;
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
