import {
  measureTextWidth,
  verifiedDiagramCommandToDrawCommand,
  DIAGRAM_ZONE,
  type DrawCommand,
  type VerifiedDiagram,
  type VerifiedDiagramCommand,
  type VerifiedDiagramPresentation,
  type TutorSegment,
} from "@heytutor/drawing";
import type { RenderPrimitive, RenderScene, SceneDocument } from "@heytutor/scene-engine";

/** Convert validated render primitives into the whiteboard command transport. */
export function buildVerifiedDiagramPresentation(
  document: SceneDocument,
  renderScene: RenderScene,
): VerifiedDiagramPresentation {
  const source = document.source as Record<string, unknown> | undefined;
  const nonMetric = source?.nonMetric === true;
  const representationTier = typeof source?.representationTier === "string"
    ? source.representationTier
    : "exact_verified";
  const commands: VerifiedDiagramCommand[] = [];
  const indicesByGroup = new Map<string, Record<RevealPhase, number[]>>();
  const labels: LabelPlacementState = { keys: new Set<string>(), rects: [] };
  const commandKeys = new Set<string>();
  const rolesByEntityId = new Map(document.entities.map((entity) => [entity.id, entity.role]));
  const regionEntityIds = new Set(document.constructions.flatMap((construction) =>
    construction.operator === "function_region" ? construction.outputs : []));

  const add = (
    groupId: string,
    phase: RevealPhase,
    command: VerifiedDiagramCommand,
  ): number | null => {
    const key = [
      command.type,
      command.params.map((value) => Math.round(value * 100) / 100).join(","),
      command.text ?? "",
      command.visualStyle?.strokeRole ?? "",
      command.visualStyle?.fillRole ?? "",
      command.semanticRef?.actionId ?? "",
    ].join(":");
    if (commandKeys.has(key)) return null;
    commandKeys.add(key);
    const index = commands.push(command) - 1;
    const group = indicesByGroup.get(groupId) ?? emptyPhaseIndices();
    group[phase].push(index);
    indicesByGroup.set(groupId, group);
    return index;
  };

  for (const primitive of renderScene.primitives) {
    const helperRole = isHelperRole(rolesByEntityId.get(primitive.entityId));
    const suppressInlineLabel = helperRole && (primitive.kind !== "label" || isGenericHelperLabel(primitive.text));
    const phase = revealPhaseForPrimitive(primitive);
    for (const command of primitiveCommands(primitive, labels, suppressInlineLabel)) {
      const commandPhase =
        command.type === "LABEL" || command.type === "DIMENSION" ? "detail" : phase;
      add(primitive.groupId, commandPhase, {
        ...command,
        ...(regionEntityIds.has(primitive.entityId) && primitive.kind === "polygon"
          ? {
              visualStyle: {
                ...command.visualStyle,
                fillRole: "region" as const,
              },
            }
          : {}),
        semanticRef: {
          entityId: primitive.entityId,
          primitiveId: primitive.id,
        },
      });
    }
  }

  const orderedGroupIds = orderedRevealGroupIds(renderScene);
  const introSegments: TutorSegment[] = [];
  const reveals: VerifiedDiagram["reveals"] = [];
  orderedGroupIds.forEach((groupId, groupIndex) => {
    const phaseIndices = indicesByGroup.get(groupId) ?? emptyPhaseIndices();
    const group = renderScene.revealGroups.find((candidate) => candidate.id === groupId);
    const timelineCue = timelineNarration(renderScene, "reveal", groupId);
    // Prefer planner prose when present; short group cues still drive the fallback templates.
    const cue = (timelineCue && isSpokenProse(timelineCue) ? timelineCue : null)
      || group?.narrationCue
      || timelineCue
      || groupId;
    const commandIndices = REVEAL_PHASES.flatMap((phase) => phaseIndices[phase]);
    if (commandIndices.length === 0) return;

    chunk(commandIndices, MAX_COMMANDS_PER_GROUP).forEach((indices, chunkIndex) => {
      const drawCommands = indices.map((index) =>
        verifiedDiagramCommandToDrawCommand(commands[index]!),
      );
      const narration = groupRevealNarration({
        cue,
        drawCommands,
        groupIndex,
        chunkIndex,
        groupCount: orderedGroupIds.length,
        rolesByEntityId,
      });
      reveals.push({ narration, commandIndices: indices, kind: "reveal", targetId: groupId });
      introSegments.push({
        narration,
        command: drawCommands[0] ?? null,
        commands: drawCommands,
        verifiedDiagramIntro: true,
      });
    });
  });

  // Focus and annotation actions remain semantic: their paths are copied from
  // verified primitives rather than guessed coordinates. These staged actions
  // explain important relationships before the symbolic solution begins.
  for (const action of renderScene.timeline) {
    if (action.action === "reveal") continue;
    const targetPrimitives = resolveActionPrimitives(document, renderScene, action.targetId);
    const traceIndices: number[] = [];
    for (const primitive of targetPrimitives) {
      for (const command of traceCommandsForPrimitive(primitive, action.id)) {
        const index = add(`__${action.id}`, "direction", command);
        if (index !== null) traceIndices.push(index);
      }
    }
    if (traceIndices.length === 0) continue;
    const actionChunks = chunk(traceIndices, MAX_TRACE_COMMANDS_PER_SEGMENT);
    actionChunks.forEach((commandIndices, chunkIndex) => {
      const narration = focusNarration(action.narrationIntent, action.targetId, chunkIndex);
      reveals.push({
        narration,
        commandIndices,
        kind: action.action,
        targetId: action.targetId,
      });
      const drawCommands = commandIndices.map((index) =>
        verifiedDiagramCommandToDrawCommand(commands[index]!),
      );
      introSegments.push({
        narration,
        command: drawCommands[0] ?? null,
        commands: drawCommands,
        verifiedDiagramIntro: true,
      });
    });
  }

  const anchors = Object.entries(renderScene.entityBounds).map(([id, bounds]) => {
    const entity = document.entities.find((candidate) => candidate.id === id);
    return {
      id,
      labels: [id, entity?.label, entity?.role].filter((value): value is string => Boolean(value)),
      x: bounds.x,
      y: bounds.y,
      width: Math.max(bounds.width, 12),
      height: Math.max(bounds.height, 12),
    };
  });

  const focusTargets = anchors
    .map((anchor) => `${anchor.id}${anchor.labels[1] ? ` (${anchor.labels[1]})` : ""}`)
    .join(", ");
  const diagram: VerifiedDiagram = {
    id: "verified_scene",
    name: nonMetric ? "source-grounded conceptual representation" : "validated semantic scene",
    commands,
    anchors,
    reveals,
    promptAddon: `${nonMetric
      ? `A source-grounded conceptual representation (${representationTier}) has already been compiled and is being explained as it is revealed. It is intentionally non-metric: do not infer scale, missing connections, intersections, regions, directions, or solved values from it.`
      : "A complete metric diagram has already been compiled, validated, and is being explained as it is revealed."}
Do not emit DRAW_*, LABEL, DIMENSION, ARROW, SCRIBBLE, CIRCLE_AROUND, HIGHLIGHT, UNDERLINE, ERASE, or CLEAR tags.
When a solution step genuinely needs the learner to follow an existing diagram entity, you may append one semantic [FOCUS:entity_id] tag. Never provide coordinates. Use only these verified targets: ${focusTargets || "none"}.
When you say what a labeled point is — for example the object O or the image I — put [FOCUS:entity_id] in that same step, immediately after the spoken name.
Do not describe marker movement or pretend to add, point at, circle, or redraw anything. Say "notice", "follow", "look at", or "this is" the named entity when using FOCUS.
Refer to diagram entities by their visible labels in narration.
You may use WRITE only for equations and symbolic working in the left work area (x below 360).
The scene engine owns all diagram geometry, labels, annotations, directions, connections, and markings.`,
  };

  const spokenIntro = collapseIntroSpeech(introSegments);

  // #region agent log
  fetch('http://127.0.0.1:7280/ingest/352483c0-a316-40d0-8703-e595b34ba80f',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e9a5f5'},body:JSON.stringify({sessionId:'e9a5f5',runId:'pre-fix',hypothesisId:'H5',location:'verifiedScenePresentation.ts:present',message:'scene intro built',data:{introCount:spokenIntro.length,revealGroupCount:orderedGroupIds.length,timelineActions:renderScene.timeline.map((a)=>a.action),commandCount:commands.length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return { diagram, introSegments: spokenIntro };
}

function collapseIntroSpeech(segments: TutorSegment[]): TutorSegment[] {
  if (segments.length <= 1) {
    return segments;
  }
  const commands = segments.flatMap((segment) =>
    segment.commands ?? (segment.command ? [segment.command] : []),
  );
  const usable = segments
    .map((segment) => segment.narration.trim())
    .filter((text) =>
      text.length > 0 &&
      !/^the rest of this setup completes the figure\.?$/i.test(text) &&
      !/^next comes scene\.?$/i.test(text),
    );
  const primary = [...usable].sort((left, right) => right.length - left.length)[0]
    ?? "Here is the setup from the question.";
  const extras = usable.filter((text) => text !== primary && !primary.includes(text));
  const narration = [primary, ...extras].join(" ");
  return [{
    narration,
    command: commands[0] ?? null,
    commands,
    verifiedDiagramIntro: true,
  }];
}

type RevealPhase = "structure" | "direction" | "detail";

const REVEAL_PHASES: RevealPhase[] = ["structure", "direction", "detail"];
const MAX_COMMANDS_PER_GROUP = 14;
const MAX_DETAIL_COMMANDS_PER_SEGMENT = 8;
const MAX_TRACE_COMMANDS_PER_SEGMENT = 4;
const LABEL_MIN_X = DIAGRAM_ZONE.x + 10;
const LABEL_MAX_X = DIAGRAM_ZONE.x + DIAGRAM_ZONE.width - 10;

function emptyPhaseIndices(): Record<RevealPhase, number[]> {
  return { structure: [], direction: [], detail: [] };
}

function revealPhaseForPrimitive(primitive: RenderPrimitive): RevealPhase {
  if (primitive.kind === "label" || primitive.kind === "dimension") return "detail";
  if (primitive.kind === "ray" || primitive.kind === "vector") return "direction";
  return "structure";
}

function timelineNarration(
  scene: RenderScene,
  action: "reveal" | "focus" | "annotate",
  targetId: string,
): string | undefined {
  return scene.timeline.find((candidate) =>
    candidate.action === action && candidate.targetId === targetId
  )?.narrationIntent;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function cueSubject(cue: string): string {
  const subject = cue
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/[_-]+/g, " ")
    .replace(
      /^(?:show|draw|reveal|construct|mark|plot|display|indicate|add|focus|annotate|notice|follow|look at)\s+/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return subject || "the physical setup";
}

/** True when the planner already wrote speakable teaching prose. */
function isSpokenProse(text: string): boolean {
  const cleaned = text.trim();
  if (cleaned.length < 18) return false;
  // Reject machine fallbacks like "focus region" / "annotate ann_1".
  if (/^(?:reveal|focus|annotate)\s+[\w-]+$/i.test(cleaned)) return false;
  // Reject short imperative cues that should still go through the templates.
  if (
    /^(?:show|draw|reveal|construct|mark|plot|display|indicate|add|focus|annotate|notice|follow|look at)\s+[\w\s.'-]{1,48}$/i
      .test(cleaned)
  ) {
    return false;
  }
  return /\s/.test(cleaned);
}

function ensureSpokenSentence(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return "Notice this part of the figure.";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function groupRevealNarration({
  cue,
  drawCommands,
  groupIndex,
  chunkIndex,
  groupCount,
  rolesByEntityId,
}: {
  cue: string;
  drawCommands: DrawCommand[];
  groupIndex: number;
  chunkIndex: number;
  groupCount: number;
  rolesByEntityId: ReadonlyMap<string, string>;
}): string {
  if (chunkIndex > 0) {
    return "The rest of this setup completes the figure.";
  }
  const hasLabels = drawCommands.some((command) =>
    command.type === "LABEL" || command.type === "DIMENSION",
  );
  if (hasLabels) {
    return detailNarration(drawCommands, cue, rolesByEntityId);
  }
  return revealNarration({
    cue,
    phase: "structure",
    groupIndex,
    phaseIndex: 0,
    chunkIndex: 0,
    groupCount,
  });
}

function revealNarration({
  cue,
  phase,
  groupIndex,
  phaseIndex,
  chunkIndex,
}: {
  cue: string;
  phase: RevealPhase;
  groupIndex: number;
  phaseIndex: number;
  chunkIndex: number;
  groupCount: number;
}): string {
  if (chunkIndex > 0) {
    return phase === "detail"
      ? "The remaining labels identify the related quantities without crowding the figure."
      : "The rest of this setup completes the connections we need.";
  }
  // Speak planner prose once per reveal group; later phases keep short continuations.
  if (isSpokenProse(cue)) {
    if (phaseIndex === 0) return ensureSpokenSentence(cue);
    if (phase === "detail") {
      return "The remaining labels identify the related quantities without crowding the figure.";
    }
    if (phase === "direction") {
      return "Now follow the important directions in this setup.";
    }
    return "The rest of this setup completes the figure.";
  }
  const subject = cueSubject(cue);
  if (phase === "direction") {
    return `Now follow the important directions and relationships in ${subject}.`;
  }
  if (phase === "detail") {
    return `With the structure in place, these labels and measurements identify ${subject}.`;
  }
  return groupIndex === 0
    ? `Let’s begin with ${subject}.`
    : `Next comes ${subject}.`;
}

function detailNarration(
  commands: DrawCommand[],
  cue: string,
  rolesByEntityId: ReadonlyMap<string, string>,
): string {
  const named = [...new Map(commands
    .filter((command) => command.type === "LABEL" || command.type === "DIMENSION")
    .flatMap((command) => {
      const text = command.text?.trim();
      if (!text) return [];
      return [[text, pointMeaning(rolesByEntityId.get(command.semanticRef?.entityId ?? ""), text)] as const];
    }))].slice(0, MAX_DETAIL_COMMANDS_PER_SEGMENT);

  if (named.length === 0) {
    return revealNarration({
      cue,
      phase: "detail",
      groupIndex: 0,
      phaseIndex: 1,
      chunkIndex: 0,
      groupCount: 1,
    });
  }

  const identified = named.filter(([, meaning]) => Boolean(meaning));
  if (identified.length === named.length && identified.length > 0) {
    const clauses = identified.map(([label, meaning]) => `${label} is the ${meaning}`);
    return clauses.length === 1
      ? `${clauses[0]}.`
      : `${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)}.`;
  }

  const names = named.map(([label]) => label);
  const spokenNames = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
  return names.length === 1
    ? `The label ${spokenNames} identifies this part of the figure.`
    : `The labels ${spokenNames} identify these parts of the figure.`;
}

function pointMeaning(role: string | undefined, label: string): string | null {
  const semantic = `${label} ${role ?? ""}`.toLowerCase();
  if (/\bimage\b/.test(semantic)) return "image";
  if (/\bobject\b/.test(semantic)) return "object";
  if (/\bfoc(?:us|al point)\b/.test(semantic)) return "focus";
  if (/\bcurvature\b/.test(semantic)) return "centre of curvature";
  if (/\bpole\b/.test(semantic)) return "pole";
  if (/\bvertex\b/.test(semantic)) return "vertex";
  return null;
}

function focusNarration(intent: string, targetId: string, chunkIndex = 0): string {
  if (chunkIndex > 0) {
    return "Keep following this part of the figure.";
  }
  const raw = (intent || targetId).trim();
  if (isSpokenProse(raw)) {
    return ensureSpokenSentence(raw);
  }
  const subject = cueSubject(raw || targetId);
  return `Notice ${subject}.`;
}

function resolveActionPrimitives(
  document: SceneDocument,
  renderScene: RenderScene,
  targetId: string,
): RenderPrimitive[] {
  const group = renderScene.revealGroups.find((candidate) => candidate.id === targetId);
  const annotation = document.annotations.find((candidate) => candidate.id === targetId);
  const entityIds = new Set(
    group?.entityIds ??
    annotation?.targetIds ??
    (document.entities.some((entity) => entity.id === targetId) ? [targetId] : []),
  );
  return renderScene.primitives.filter((primitive) => entityIds.has(primitive.entityId));
}

function traceCommandsForPrimitive(
  primitive: RenderPrimitive,
  actionId: string,
): VerifiedDiagramCommand[] {
  const point = primitive.kind === "point" ? primitive.points[0] : undefined;
  if (point) {
    return [{
      type: "DRAW_CIRCLE",
      params: [point.x, point.y, 14],
      visualStyle: { strokeRole: "trace", strokeWidth: 1.25 },
      semanticRef: {
        entityId: primitive.entityId,
        primitiveId: primitive.id,
        actionId,
      },
    }];
  }
  const traceableTypes = new Set<VerifiedDiagramCommand["type"]>([
    "DRAW_CUBOID",
    "DRAW_CUBE",
    "DRAW_RECT",
    "DRAW_CIRCLE",
    "DRAW_ARC",
    "DRAW_LINE",
    "DRAW_POINT",
    "ARROW",
  ]);
  return primitiveCommands(primitive, { keys: new Set(), rects: [] }, true)
    .filter((command) => traceableTypes.has(command.type))
    .map((command) => ({
      ...command,
      visualStyle: { strokeRole: "trace", strokeWidth: 1.25 },
      semanticRef: {
        entityId: primitive.entityId,
        primitiveId: primitive.id,
        actionId,
      },
    }));
}

function primitiveCommands(
  primitive: RenderPrimitive,
  labels: LabelPlacementState,
  suppressInlineLabel = false,
): VerifiedDiagramCommand[] {
  const points = primitive.points;
  const commands: VerifiedDiagramCommand[] = [];
  switch (primitive.kind) {
    case "point": {
      const point = points[0];
      if (point) commands.push({ type: "DRAW_POINT", params: [point.x, point.y, 5] });
      break;
    }
    case "line":
    case "polyline": {
      if (points.length >= 2) commands.push({ type: "DRAW_LINE", params: flatten(points) });
      break;
    }
    case "ray":
    case "vector": {
      const start = points[0]; const end = points.at(-1);
      if (start && end) commands.push({ type: "ARROW", params: [start.x, start.y, end.x, end.y] });
      break;
    }
    case "circle": {
      const center = points[0];
      if (center && primitive.radius) commands.push({ type: "DRAW_CIRCLE", params: [center.x, center.y, primitive.radius] });
      break;
    }
    case "arc": {
      const center = points[0];
      if (center && primitive.radius !== undefined && primitive.startAngle !== undefined && primitive.endAngle !== undefined) {
        commands.push({ type: "DRAW_ARC", params: [center.x, center.y, primitive.radius, radiansToDegrees(primitive.startAngle), radiansToDegrees(primitive.endAngle)] });
      }
      break;
    }
    case "rectangle": {
      if (points.length >= 4) {
        const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
        commands.push({ type: "DRAW_RECT", params: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] });
      }
      break;
    }
    case "polygon": {
      if (points.length >= 3) commands.push({ type: "DRAW_LINE", params: flatten([...points, points[0]!]) });
      break;
    }
    case "axes": {
      if (points.length === 4) {
        commands.push({ type: "DRAW_LINE", params: [points[0]!.x, points[0]!.y, points[1]!.x, points[1]!.y] });
        commands.push({ type: "DRAW_LINE", params: [points[2]!.x, points[2]!.y, points[3]!.x, points[3]!.y] });
      }
      break;
    }
    case "dimension": {
      const start = points[0]; const end = points[1];
      if (start && end) {
        commands.push({ type: "DIMENSION", params: [start.x, start.y, end.x, end.y, 16] });
        if (primitive.text) {
          addLabel(
            commands,
            labels,
            { ...primitive, labelPlacement: primitive.labelPlacement ?? "below" },
            (start.x + end.x) / 2,
            (start.y + end.y) / 2,
          );
        }
      }
      return commands;
    }
    case "label": {
      const point = points[0];
      if (point && primitive.text && !suppressInlineLabel) addLabel(commands, labels, primitive, point.x, point.y);
      return commands;
    }
  }

  const labelPoint = primitiveLabelPoint(primitive);
  if (labelPoint && primitive.text && !suppressInlineLabel) addLabel(commands, labels, primitive, labelPoint.x, labelPoint.y);
  return commands;
}

function isHelperRole(role: string | undefined): boolean {
  return /(?:^|[ _-])(incident|reflected|refracted|normal|intersection|helper|direction)(?:$|[ _-])/i.test(role ?? "");
}

function isGenericHelperLabel(text: string | undefined): boolean {
  return /^(?:ray|incident|reflected|refracted|normal)(?:\s*\d+)?$/i.test(text?.trim() ?? "");
}

function primitiveLabelPoint(primitive: RenderPrimitive): { x: number; y: number } | undefined {
  if (primitive.points.length === 0) return undefined;
  if (primitive.kind === "point" || primitive.kind === "circle" || primitive.kind === "arc") {
    return primitive.points[0];
  }
  const xs = primitive.points.map((point) => point.x);
  const ys = primitive.points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function addLabel(
  commands: VerifiedDiagramCommand[],
  labels: LabelPlacementState,
  primitive: RenderPrimitive,
  x: number,
  y: number,
): void {
  const text = compactDiagramLabel(primitive.text);
  if (!text) return;
  const key = `${primitive.entityId}:${text}`;
  if (labels.keys.has(key)) return;
  labels.keys.add(key);
  const width = Math.max(measureTextWidth(text), 14);
  if (primitive.labelPlacement === "absolute") {
    const desired = {
      x: clamp(x - width / 2, LABEL_MIN_X, LABEL_MAX_X - width),
      y: clamp(y - 16, 55, 580),
      width,
      height: 32,
    };
    const placed = absoluteLabelCandidates(desired)
      .sort((a, b) => labelOverlapScore(a, labels.rects) - labelOverlapScore(b, labels.rects))[0]!;
    labels.rects.push(placed);
    commands.push({ type: "LABEL", params: [placed.x, placed.y, 24], text, anchorId: primitive.entityId });
    return;
  }
  const candidates = labelCandidates(primitive.labelPlacement, width);
  const placed = candidates
    .map(([dx, dy]) => ({
      x: clamp(x + dx, LABEL_MIN_X, LABEL_MAX_X - width),
      y: clamp(y + dy, 55, 580),
      width,
      height: 32,
    }))
    .sort((a, b) => labelOverlapScore(a, labels.rects) - labelOverlapScore(b, labels.rects))[0]!;
  labels.rects.push(placed);
  commands.push({ type: "LABEL", params: [placed.x, placed.y, 24], text, anchorId: primitive.entityId });
}

function absoluteLabelCandidates(
  desired: { x: number; y: number; width: number; height: number },
): Array<{ x: number; y: number; width: number; height: number }> {
  const offsets: Array<[number, number]> = [
    [0, 0], [0, -40], [0, 40], [0, -76], [0, 76],
    [-desired.width - 18, 0], [desired.width + 18, 0],
  ];
  return offsets.map(([dx, dy]) => ({
    ...desired,
    x: clamp(desired.x + dx, LABEL_MIN_X, LABEL_MAX_X - desired.width),
    y: clamp(desired.y + dy, 55, 580),
  }));
}

interface LabelPlacementState {
  keys: Set<string>;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}

function labelCandidates(placement: string | undefined, width: number): Array<[number, number]> {
  const automatic: Array<[number, number]> = [
    [10, -26], [10, 10], [-width - 10, -26], [-width - 10, 10],
    [-width / 2, -50], [-width / 2, 28], [24, -50], [-width - 24, -50],
    [-width / 2, -76], [-width / 2, 54],
  ];
  const preferred = labelOffset(placement, width);
  return [preferred, ...automatic.filter(([dx, dy]) => dx !== preferred[0] || dy !== preferred[1])];
}

function labelOverlapScore(
  candidate: { x: number; y: number; width: number; height: number },
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): number {
  return rects.reduce((score, rect) => {
    const overlapWidth = Math.max(0, Math.min(candidate.x + candidate.width + 6, rect.x + rect.width) - Math.max(candidate.x - 6, rect.x));
    const overlapHeight = Math.max(0, Math.min(candidate.y + candidate.height + 4, rect.y + rect.height) - Math.max(candidate.y - 4, rect.y));
    return score + overlapWidth * overlapHeight;
  }, 0);
}

function compactDiagramLabel(text?: string): string | null {
  const normalized = text?.trim().replace(/\s+/g, " ") ?? "";
  return normalized.length > 0 && normalized.length <= 16 ? normalized : null;
}

function orderedRevealGroupIds(scene: RenderScene): string[] {
  const result: string[] = [];
  for (const action of scene.timeline) {
    if (action.action === "reveal" && scene.revealGroups.some((group) => group.id === action.targetId) && !result.includes(action.targetId)) result.push(action.targetId);
  }
  for (const group of scene.revealGroups) if (!result.includes(group.id)) result.push(group.id);
  for (const primitive of scene.primitives) if (!result.includes(primitive.groupId)) result.push(primitive.groupId);
  return result;
}

function labelOffset(placement: string | undefined, width = 24): [number, number] {
  switch (placement) {
    case "above": return [-width / 2, -30];
    case "below": return [-width / 2, 12];
    case "left": return [-width - 10, -10];
    case "right": return [12, -10];
    default: return [10, -26];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function flatten(points: Array<{ x: number; y: number }>): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}
