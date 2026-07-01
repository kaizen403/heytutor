import type { DrawCommand } from "./drawingProtocol";
import { clampToDiagramZone, isInDiagramZone } from "./boardZones";
import type { DiagramTemplate, TemplateAnchor, TemplateCommand } from "./templates/types";

const TEMPLATE_SKELETON_DRAW_TYPES = new Set<DrawCommand["type"]>([
  "DRAW_CUBOID",
  "DRAW_CUBE",
  "DRAW_RECT",
  "DRAW_CIRCLE",
  "DRAW_LINE",
]);

const TEMPLATE_PARAM_TOLERANCE = 40;

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match diagram labels in narration without substring false positives (e.g. O in "hoop", m in "moves"). */
export function narrationMentionsLabel(narration: string, label: string): boolean {
  const target = label.trim();
  if (!target) {
    return false;
  }

  if (target === normalizeLabel(narration)) {
    return true;
  }

  if (/[^\x00-\x7F]/.test(target)) {
    return narration.includes(target);
  }

  const escaped = escapeRegExp(target);
  if (target.length <= 2) {
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(narration);
  }

  return new RegExp(`\\b${escaped}\\b`, "i").test(narration);
}

export function findTemplateAnchor(
  anchors: TemplateAnchor[],
  labelOrNarration: string,
): TemplateAnchor | null {
  for (const anchor of anchors) {
    for (const label of anchor.labels) {
      if (
        narrationMentionsLabel(labelOrNarration, label) ||
        normalizeLabel(label) === normalizeLabel(labelOrNarration)
      ) {
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
    const labelHit = anchor.labels.some((label) => narrationMentionsLabel(narrationText, label));
    if (!labelHit) {
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

  return { params, snapped: false, rect: boardRects[0] ?? null };
}

function commandAnchorInDiagramZone(command: DrawCommand): boolean {
  if (command.params.length < 2) {
    return false;
  }

  const [x, y] = command.params;
  if (isInDiagramZone(x, y)) {
    return true;
  }

  if (command.type === "DRAW_LINE" && command.params.length >= 4) {
    const x2 = command.params[2];
    const y2 = command.params[3];
    return isInDiagramZone(x2, y2);
  }

  return false;
}

function matchesTemplateSkeleton(command: DrawCommand, templateCommand: TemplateCommand): boolean {
  if (command.type !== templateCommand.type) {
    return false;
  }

  if (command.params.length !== templateCommand.params.length) {
    return false;
  }

  return command.params.every(
    (value, index) => Math.abs(value - templateCommand.params[index]!) <= TEMPLATE_PARAM_TOLERANCE,
  );
}

/** True when an LLM DRAW_* in the diagram zone repeats runtime template skeleton ink. */
export function isDuplicateTemplateDraw(
  command: DrawCommand,
  template: DiagramTemplate,
): boolean {
  if (!TEMPLATE_SKELETON_DRAW_TYPES.has(command.type)) {
    return false;
  }

  if (!commandAnchorInDiagramZone(command)) {
    return false;
  }

  return template.commands.some(
    (templateCommand) =>
      TEMPLATE_SKELETON_DRAW_TYPES.has(templateCommand.type) &&
      matchesTemplateSkeleton(command, templateCommand),
  );
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
