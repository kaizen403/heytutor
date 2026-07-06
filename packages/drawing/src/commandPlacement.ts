import { getSegmentCommands, type DrawCommand, type TutorSegment } from "./drawingProtocol";
import { BOARD_CANVAS, DIAGRAM_ZONE, clampToDiagramZone, isInDiagramZone } from "./boardZones";
import { snapGeometryCommand } from "./geometrySnap";
import type { DiagramTemplate, TemplateAnchor, TemplateCommand } from "./templates/types";

const TEMPLATE_SKELETON_DRAW_TYPES = new Set<DrawCommand["type"]>([
  "DRAW_CUBOID",
  "DRAW_CUBE",
  "DRAW_RECT",
  "DRAW_CIRCLE",
  "DRAW_LINE",
]);

const TEMPLATE_PARAM_TOLERANCE = 40;
const TEMPLATE_REDRAW_NARRATION_PATTERN =
  /\b(?:let me draw|i(?:'|’)ll draw|i will draw|draw(?:ing)? (?:the|a|an)|flat horizontal line|surface|box|block|force arrow|arrow|rectangle|ramp|spring|wall|setup first)\b/i;
const TEMPLATE_ACTION_NARRATION_PATTERN =
  /\b(?:let me draw|i(?:'|’)ll draw|i will draw|let(?:'|’)s draw|i will mark|let me mark|i will label|let me label|i(?:'|’)ll label|let(?:'|’)s label|let(?:'|’)s circle|i will circle|let me circle|now circle)\b/i;

const TEMPLATE_OWNED_ZONE = {
  x: DIAGRAM_ZONE.x - 16,
  y: DIAGRAM_ZONE.y - 12,
  width: DIAGRAM_ZONE.width + 32,
  height: DIAGRAM_ZONE.height + 24,
};

export interface BoardTextRect {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

export interface PreparedTemplateSegments {
  segments: TutorSegment[];
  blockedCommandCount: number;
  droppedSegmentCount: number;
}

function shouldDropTemplateRedrawNarration(narration: string): boolean {
  return TEMPLATE_REDRAW_NARRATION_PATTERN.test(narration);
}

function cleanTemplateActionNarration(narration: string): string {
  if (!TEMPLATE_ACTION_NARRATION_PATTERN.test(narration)) {
    return narration;
  }

  const sentences = narration.match(/[^.!?]+[.!?]?/g) ?? [narration];
  const kept = sentences
    .filter((sentence) => !TEMPLATE_ACTION_NARRATION_PATTERN.test(sentence))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return kept || narration.replace(TEMPLATE_ACTION_NARRATION_PATTERN, "").replace(/\s+/g, " ").trim();
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

  if ([...target].some((ch) => ch.charCodeAt(0) > 127)) {
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

function commandBoundingBox(command: DrawCommand): BoardTextRect | null {
  const params = command.params;

  if (params.length < 2) {
    return null;
  }

  if ((command.type === "DRAW_LINE" || command.type === "ARROW") && params.length >= 4) {
    const [x1, y1, x2, y2] = params;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.max(Math.abs(x2 - x1), 1),
      height: Math.max(Math.abs(y2 - y1), 1),
    };
  }

  if (command.type === "DRAW_CIRCLE" && params.length >= 3) {
    const [cx, cy, radius] = params;
    return {
      x: cx - radius,
      y: cy - radius,
      width: radius * 2,
      height: radius * 2,
    };
  }

  if (
    (command.type === "DRAW_RECT" ||
      command.type === "DRAW_CUBOID" ||
      command.type === "HIGHLIGHT" ||
      command.type === "CIRCLE_AROUND") &&
    params.length >= 4
  ) {
    const [x, y, width, height] = params;
    return { x, y, width, height };
  }

  const [x, y] = params;
  return { x, y, width: 1, height: 1 };
}

function rectsIntersect(a: BoardTextRect, b: BoardTextRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function commandTouchesTemplateOwnedZone(command: DrawCommand): boolean {
  const bbox = commandBoundingBox(command);
  return bbox ? rectsIntersect(bbox, TEMPLATE_OWNED_ZONE) : false;
}

/** True when an LLM DRAW_* in the diagram zone repeats runtime template skeleton ink. */
export function isDuplicateTemplateDraw(
  command: DrawCommand,
  template: DiagramTemplate,
): boolean {
  if (!TEMPLATE_SKELETON_DRAW_TYPES.has(command.type)) {
    return false;
  }

  if (!commandTouchesTemplateOwnedZone(command) && !commandAnchorInDiagramZone(command)) {
    return false;
  }

  return template.commands.some(
    (templateCommand) =>
      TEMPLATE_SKELETON_DRAW_TYPES.has(templateCommand.type) &&
      matchesTemplateSkeleton(command, templateCommand),
  );
}

/** True when a matched template owns the diagram and an LLM DRAW_* would improvise over it. */
export function isBlockedTemplateDiagramDraw(
  command: DrawCommand,
  template: DiagramTemplate,
): boolean {
  if (template.allowLlmDrawInDiagramZone) {
    return false;
  }

  // The circuit diagram is fully deterministic and authoritative. Block every
  // structural draw or free-floating arrow/scribble the LLM tries to place over
  // it (batteries, resistor boxes, current-source circles, flow arrows). Only
  // annotations that target an existing label (CIRCLE_AROUND/UNDERLINE/
  // HIGHLIGHT) and left-column WRITE/LABEL are allowed through.
  if (template.id === "circuit") {
    const isStructuralDraw =
      TEMPLATE_SKELETON_DRAW_TYPES.has(command.type) ||
      command.type === "ARROW" ||
      command.type === "SCRIBBLE" ||
      command.type === "DIMENSION";
    if (
      isStructuralDraw &&
      (commandTouchesTemplateOwnedZone(command) || commandAnchorInDiagramZone(command))
    ) {
      return true;
    }
  }

  if (!TEMPLATE_SKELETON_DRAW_TYPES.has(command.type)) {
    return false;
  }

  // Only block if the command is a near-duplicate of existing template skeleton.
  // If the LLM is drawing something NEW (not matching any skeleton command),
  // allow it — the LLM may be adding problem-specific geometry the template
  // doesn't cover. This prevents false-positive template matches from
  // silencing all drawing.
  if (isDuplicateTemplateDraw(command, template)) {
    return true;
  }

  return false;
}

/** Snap diagram LABEL commands to a template anchor when label text matches. */
export function snapLabelToTemplateAnchor(
  command: DrawCommand,
  anchors: TemplateAnchor[],
): DrawCommand {
  if (command.type !== "LABEL" || !command.text || anchors.length === 0) {
    return command;
  }

  const anchor =
    findTemplateAnchor(anchors, command.text) ??
    anchors.find((candidate) =>
      candidate.labels.some((label) => normalizeLabel(label) === normalizeLabel(command.text!)),
    );

  if (!anchor) {
    return command;
  }

  return { ...command, params: [anchor.x, anchor.y] };
}

export function prepareTemplateLessonSegments(
  segments: TutorSegment[],
  template: DiagramTemplate | null,
): PreparedTemplateSegments {
  if (!template) {
    return { segments, blockedCommandCount: 0, droppedSegmentCount: 0 };
  }

  let blockedCommandCount = 0;
  let droppedSegmentCount = 0;
  const prepared: TutorSegment[] = [];

  for (const segment of segments) {
    const commands = getSegmentCommands(segment).map((command) => {
      const repaired = repairDiagramCommand(command);
      const labeled =
        repaired.type === "LABEL"
          ? snapLabelToTemplateAnchor(repaired, template.anchors)
          : repaired;
      return snapGeometryCommand(labeled, template);
    });

    if (commands.length === 0) {
      prepared.push(segment);
      continue;
    }

    let blockedInSegment = 0;
    const keptCommands = commands.filter((command) => {
      const blocked =
        isBlockedTemplateDiagramDraw(command, template) ||
        isDuplicateTemplateDraw(command, template);

      if (blocked) {
        blockedInSegment += 1;
        return false;
      }

      return true;
    });

    blockedCommandCount += blockedInSegment;

    if (
      keptCommands.length === 0 &&
      blockedInSegment > 0
    ) {
      droppedSegmentCount += 1;
      continue;
    }

    const narration = cleanTemplateActionNarration(segment.narration);

    prepared.push({
      ...segment,
      narration,
      command: keptCommands[0] ?? null,
      commands: keptCommands.length > 0 ? keptCommands : undefined,
    });
  }

  return { segments: prepared, blockedCommandCount, droppedSegmentCount };
}

export function repairDiagramCommand(command: DrawCommand): DrawCommand {
  if (command.params.length < 2) {
    return command;
  }

  if (command.type === "DIMENSION" && command.params.length >= 5) {
    const [x1, y1, x2, y2, offset] = command.params;
    const c1 = clampToDiagramZone(x1, y1);
    const c2 = clampToDiagramZone(x2, y2);
    return { ...command, params: [c1.x, c1.y, c2.x, c2.y, offset] };
  }

  const isDiagramShape = ["DRAW_CIRCLE", "DRAW_LINE", "DRAW_RECT", "LABEL"].includes(command.type);
  if (!isDiagramShape) {
    return command;
  }

  const bbox = commandBoundingBox(command);
  if (command.type !== "LABEL" && bbox && bbox.y < DIAGRAM_ZONE.y && bbox.x < DIAGRAM_ZONE.x) {
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
