import type { DrawCommand } from "./drawingProtocol";
import { clampToDiagramZone, isInDiagramZone } from "./boardZones";
import type { TemplateAnchor } from "./templates/types";

export interface BoardTextRect {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

function normalizeLabel(text: string): string {
  return text.trim().replace(/\s+/g, "").toLowerCase();
}

export function findTemplateAnchor(
  anchors: TemplateAnchor[],
  labelOrNarration: string,
): TemplateAnchor | null {
  const normalized = labelOrNarration.toLowerCase();
  for (const anchor of anchors) {
    for (const label of anchor.labels) {
      const target = normalizeLabel(label);
      if (normalized.includes(target) || target === normalizeLabel(labelOrNarration)) {
        return anchor;
      }
    }
  }
  return null;
}

export function anchorToTextRect(anchor: TemplateAnchor): BoardTextRect {
  return {
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
    text: anchor.labels[0],
  };
}

export function bboxParamsForAnchor(anchor: TemplateAnchor, pad = 8): number[] {
  return [anchor.x - pad, anchor.y - pad, anchor.width + pad * 2, anchor.height + pad * 2];
}

export function underlineParamsForAnchor(anchor: TemplateAnchor, pad = 8): number[] {
  const y = anchor.y + anchor.height + 2;
  return [anchor.x - pad, y, anchor.x + anchor.width + pad, y];
}

/**
 * Prefer template anchors for annotation snap, then fall back to placed board rects.
 */
export function resolveAnnotationWithAnchors(
  kind: DrawCommand["type"],
  params: number[],
  templateAnchors: TemplateAnchor[],
  boardRects: BoardTextRect[],
  narration?: string,
): { params: number[]; snapped: boolean; rect: BoardTextRect | null } {
  const narrationText = narration?.toLowerCase() ?? "";

  for (const anchor of templateAnchors) {
    const labelHit = anchor.labels.some((label) => narrationText.includes(label.toLowerCase()));
    if (!labelHit && kind !== "CIRCLE_AROUND") {
      continue;
    }
    if (kind === "CIRCLE_AROUND" || kind === "HIGHLIGHT") {
      return {
        params: bboxParamsForAnchor(anchor),
        snapped: true,
        rect: anchorToTextRect(anchor),
      };
    }
    if (kind === "UNDERLINE") {
      return {
        params: underlineParamsForAnchor(anchor),
        snapped: true,
        rect: anchorToTextRect(anchor),
      };
    }
  }

  const fromNarration = findTemplateAnchor(templateAnchors, narrationText);
  if (fromNarration && (kind === "CIRCLE_AROUND" || kind === "HIGHLIGHT")) {
    return {
      params: bboxParamsForAnchor(fromNarration),
      snapped: true,
      rect: anchorToTextRect(fromNarration),
    };
  }

  return { params, snapped: false, rect: boardRects[0] ?? null };
}

/** Clamp shape/text anchors that land outside the diagram zone when they should be diagram ink. */
export function repairDiagramCommand(command: DrawCommand): DrawCommand {
  if (command.params.length < 2) {
    return command;
  }

  const isDiagramShape = ["DRAW_CIRCLE", "DRAW_LINE", "DRAW_RECT", "LABEL"].includes(command.type);
  if (!isDiagramShape) {
    return command;
  }

  const [x, y] = command.params;
  if (isInDiagramZone(x, y)) {
    return command;
  }

  // Only repair LABEL commands that look like diagram labels (short text, greek, force symbols)
  if (command.type === "LABEL" && command.text && command.text.length > 12) {
    return command;
  }

  if (command.type === "DRAW_LINE" && command.params.length >= 4) {
    const [x1, y1, x2, y2] = command.params;
    const c1 = clampToDiagramZone(x1, y1);
    const c2 = clampToDiagramZone(x2, y2);
    return { ...command, params: [c1.x, c1.y, c2.x, c2.y] };
  }

  const clamped = clampToDiagramZone(x, y);
  const next = [...command.params];
  next[0] = clamped.x;
  next[1] = clamped.y;
  return { ...command, params: next };
}
