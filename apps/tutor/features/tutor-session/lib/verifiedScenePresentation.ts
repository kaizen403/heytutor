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
import type {
  LabelBounds,
  LabelObstacle,
  LabelSlot,
  RenderPrimitive,
  RenderScene,
  SceneDocument,
} from "@heytutor/scene-engine";
import {
  obstaclesFromPrimitives,
  placeLabels,
  workColumnObstacle,
} from "@heytutor/scene-engine";
import { buildLabelGlossary } from "./labelGlossary";

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
  // One label engine, not two. The compiler already solves entity labels
  // against real ink; annotation labels now go through the same solver with
  // the same obstacles instead of a private ten-offset guess.
  const labels: LabelPlacementState = {
    keys: new Set<string>(),
    rects: [],
    obstacles: [...obstaclesFromPrimitives(renderScene.primitives), workColumnObstacle()],
  };
  const commandKeys = new Set<string>();
  const rolesByEntityId = new Map(document.entities.map((entity) => [entity.id, entity.role]));
  const regionEntityIds = new Set(document.constructions.flatMap((construction) =>
    construction.operator === "function_region" ? construction.outputs : []));

  const add = (
    groupId: string,
    phase: RevealPhase,
    command: VerifiedDiagramCommand,
    options: { reveal?: boolean } = {},
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
    if (options.reveal === false) return index;
    const group = indicesByGroup.get(groupId) ?? emptyPhaseIndices();
    group[phase].push(index);
    indicesByGroup.set(groupId, group);
    return index;
  };

  const deferredByEntity = new Map<string, VerifiedDiagramCommand[]>();
  const annotateTargetIds = new Set(
    document.teachingTimeline
      .filter((action) => action.action === "annotate")
      .map((action) => action.targetId),
  );

  for (const primitive of renderScene.primitives) {
    const helperRole = isHelperRole(rolesByEntityId.get(primitive.entityId));
    const suppressInlineLabel = helperRole && (primitive.kind !== "label" || isGenericHelperLabel(primitive.text));
    const phase = revealPhaseForPrimitive(primitive);
    for (const command of primitiveCommands(primitive, labels, suppressInlineLabel)) {
      const styled: VerifiedDiagramCommand = {
        ...command,
        ...(regionEntityIds.has(primitive.entityId) && primitive.kind === "polygon"
          ? {
              visualStyle: {
                ...command.visualStyle,
                fillRole: "region" as const,
              },
            }
          : {}),
        ...annotationVisualStyle(primitive, command),
        semanticRef: {
          entityId: primitive.entityId,
          primitiveId: primitive.id,
        },
      };
      const commandPhase =
        command.type === "LABEL" || command.type === "DIMENSION" ? "detail" : phase;
      const defer = shouldDeferAnnotation(primitive, command, annotateTargetIds);
      if (defer) {
        const existing = deferredByEntity.get(primitive.entityId) ?? [];
        existing.push(styled);
        deferredByEntity.set(primitive.entityId, existing);
      }
      add(primitive.groupId, commandPhase, styled, { reveal: !defer });
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

  // Timeline focus/annotate traces stay out of the intro. Circling and labels
  // during the opening beat bury the figure; teaching [FOCUS:id] traces the
  // verified geometry live and reveals withheld labels as they are named.

  const anchors = Object.entries(renderScene.entityBounds).map(([id, bounds]) => {
    const entity = document.entities.find((candidate) => candidate.id === id);
    const padX = Math.max(0, (16 - bounds.width) / 2);
    const padY = Math.max(0, (16 - bounds.height) / 2);
    return {
      id,
      labels: [id, entity?.label, entity?.role].filter((value): value is string => Boolean(value)),
      x: bounds.x - padX,
      y: bounds.y - padY,
      width: Math.max(bounds.width, 16),
      height: Math.max(bounds.height, 16),
    };
  });

  const groups = [
    ...renderScene.revealGroups.map((group) => ({ id: group.id, entityIds: [...group.entityIds] })),
    ...correspondingGroupsFromDocument(document),
  ];
  const focusTargets = [
    ...anchors.map((anchor) => `${anchor.id}${anchor.labels[1] ? ` (${anchor.labels[1]})` : ""}`),
    ...groups.map((group) => group.id),
  ].join(", ");
  const deferredIds = [...deferredByEntity.keys()].join(", ");
  const diagram: VerifiedDiagram = {
    id: "verified_scene",
    name: nonMetric ? "source-grounded conceptual representation" : "validated semantic scene",
    commands,
    anchors,
    reveals,
    groups,
    caption: renderScene.caption ?? (nonMetric ? "Do not read scale from this figure." : undefined),
    deferredAnnotations: [...deferredByEntity.entries()].map(([entityId, deferredCommands]) => ({
      entityId,
      commands: deferredCommands,
    })),
    // Symbols on the figure stay short; the expansion and solved value travel
    // alongside so the board can answer "what is R_1?" without re-deriving it.
    labelGlossary: buildLabelGlossary(document),
    promptAddon: `${nonMetric
      ? `A source-grounded conceptual representation (${representationTier}) has already been compiled and is being explained as it is revealed. It is intentionally non-metric: do not infer scale, missing connections, intersections, regions, directions, or solved values from it.`
      : "A complete metric diagram has already been compiled, validated, and is being explained as it is revealed."}
Do not emit DRAW_*, LABEL, DIMENSION, ARROW, SCRIBBLE, CIRCLE_AROUND, HIGHLIGHT, UNDERLINE, ERASE, or CLEAR tags.
When you name a listed diagram entity, append [FOCUS:entity_id] in that same step. Never provide coordinates. Use only these verified targets: ${focusTargets || "none"}.
Optional FOCUS forms: [FOCUS:entity_id], [FOCUS:entity_id|spotlight], [FOCUS:entity_id|pulse], [FOCUS:id_a,id_b], or a reveal-group id.
When you say what a labeled point is — for example the object O or the image I — put [FOCUS:entity_id] in that same step, immediately after the spoken name. FOCUS also reveals that entity's withheld label.
To box the current work-area equation and highlight its result, use [EMPHASIZE:last]. To reveal a withheld measurement, enclose, or other compiled annotation, use [ANNOTATE:entity_id] with one of: ${deferredIds || "none"}.
Do not describe marker movement or pretend to add, point at, circle, or redraw anything. Say "notice", "follow", "look at", or "this is" the named entity when using FOCUS.
Refer to diagram entities by their visible labels in narration.
Read the figure to the student before you calculate with it: name each labeled part, say what it physically represents, and say which way it points or where it acts, with [FOCUS:entity_id] on the part you just named. Never substitute into a figure the student has not been told how to read.
WRITE the left work column as the student notebook: names, definitions, relations, substitutions, and results (x below 360). Short phrases are allowed. Do not save writing for the last line, and do not speak a step with the marker parked.
The scene engine owns all diagram geometry, labels, annotations, directions, connections, and markings.`,
  };

  const spokenIntro = collapseIntroSpeech(introSegments);

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
const LABEL_MIN_X = DIAGRAM_ZONE.x + 10;
const LABEL_MAX_X = DIAGRAM_ZONE.x + DIAGRAM_ZONE.width - 10;

function emptyPhaseIndices(): Record<RevealPhase, number[]> {
  return { structure: [], direction: [], detail: [] };
}

function shouldDeferAnnotation(
  primitive: RenderPrimitive,
  command: VerifiedDiagramCommand,
  annotateTargetIds: Set<string>,
): boolean {
  const annotationId = typeof primitive.provenance?.annotationId === "string"
    ? primitive.provenance.annotationId
    : undefined;
  if (annotateTargetIds.has(primitive.entityId) || (annotationId && annotateTargetIds.has(annotationId))) {
    return true;
  }
  if (primitive.provenance?.transient === true) return true;
  if (command.type === "LABEL" || command.type === "DIMENSION") return true;
  if (command.type === "CIRCLE_AROUND" || command.type === "HIGHLIGHT") return true;
  if (command.visualStyle?.strokeRole === "trace") return true;
  return false;
}

function annotationVisualStyle(
  primitive: RenderPrimitive,
  command: VerifiedDiagramCommand,
): { visualStyle?: VerifiedDiagramCommand["visualStyle"] } {
  const provenance = primitive.provenance ?? {};
  const corresponding = typeof provenance.correspondingFamily === "number"
    ? Math.min(Math.max(Number(provenance.correspondingFamily), 1), 3) as 1 | 2 | 3
    : undefined;
  const dashed = provenance.dashed === true || corresponding === 3;
  const strokeRole = provenance.strokeRole === "trace" || provenance.strokeRole === "construction"
    ? provenance.strokeRole
    : command.visualStyle?.strokeRole;
  const fillRole = provenance.fillRole === "region" ? "region" as const : command.visualStyle?.fillRole;
  if (!corresponding && !dashed && !strokeRole && !fillRole) return {};
  return {
    visualStyle: {
      ...command.visualStyle,
      ...(corresponding ? { correspondingFamily: corresponding } : {}),
      dashed,
      strokeRole,
      fillRole,
      strokeWidth: corresponding === 2 ? 2.9 : command.visualStyle?.strokeWidth,
    },
  };
}

function correspondingGroupsFromDocument(document: SceneDocument): Array<{ id: string; entityIds: string[] }> {
  const groups: Array<{ id: string; entityIds: string[] }> = [];
  let index = 0;
  for (const assertion of document.assertions) {
    if (assertion.predicate !== "equal_length" && assertion.predicate !== "equal_angle") continue;
    if (assertion.entities.length < 2) continue;
    index += 1;
    groups.push({
      id: `corresponding_${index}`,
      entityIds: [...assertion.entities],
    });
  }
  return groups;
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

function primitiveCommands(
  primitive: RenderPrimitive,
  labels: LabelPlacementState,
  suppressInlineLabel = false,
): VerifiedDiagramCommand[] {
  const points = primitive.points;
  const commands: VerifiedDiagramCommand[] = [];
  const annotationKind = primitive.provenance?.annotation;
  if (annotationKind === "enclose") {
    const bounds = boundsOfPoints(points);
    if (bounds) {
      commands.push({
        type: "CIRCLE_AROUND",
        params: [bounds.x, bounds.y, bounds.width, bounds.height],
        visualStyle: { strokeRole: "trace", strokeWidth: 1.25 },
      });
    }
    return commands;
  }
  if (annotationKind === "loop" && points.length >= 3) {
    commands.push({
      type: "DRAW_LINE",
      params: flatten([...points, points[0]!]),
      visualStyle: { strokeRole: "construction", dashed: true, strokeWidth: 1.25 },
    });
    return commands;
  }
  if (annotationKind === "highlight") {
    const bounds = boundsOfPoints(points);
    if (bounds) {
      commands.push({
        type: "HIGHLIGHT",
        params: [bounds.x, bounds.y, bounds.width, bounds.height],
        visualStyle: { fillRole: "region" },
      });
    }
    return commands;
  }
  if (primitive.kind === "point" && primitive.provenance?.pointStyle === "open" && points[0]) {
    commands.push({ type: "DRAW_CIRCLE", params: [points[0].x, points[0].y, primitive.radius ?? 5] });
    return commands;
  }
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
  const width = Math.max(measureTextWidth(text, LABEL_FONT_PX), 14);
  if (primitive.labelPlacement === "absolute") {
    const reserved = labelBoundsFromProvenance(primitive.provenance);
    const placed = reserved ?? {
      x: x - width / 2,
      y: y - 16,
      width,
      height: 32,
    };
    labels.rects.push(placed);
    labels.obstacles.push({
      id: `label:${primitive.id}`,
      entityId: primitive.entityId,
      kind: "label",
      bounds: placed,
    });
    commands.push({ type: "LABEL", params: [placed.x, placed.y, LABEL_FONT_PX], text, anchorId: primitive.entityId });
    return;
  }
  // Feed the solver the exact glyph width for this label rather than an
  // average character box, so the reserved space is the space it draws in.
  const solved = placeLabels(
    [{
      labelId: primitive.id,
      entityId: primitive.entityId,
      anchor: { x, y },
      text,
      preferredSlot: preferredSlotFor(primitive.labelPlacement),
      viewBounds: LABEL_VIEW_BOUNDS,
      useOwnerBounds: false,
    }],
    labels.obstacles,
    { fontWidthPx: width / Math.max(text.length, 1), fontHeightPx: LABEL_FONT_PX },
  );

  const placement = solved.placements[0];
  const placed = placement
    ? placement.bounds
    : {
        x: clamp(x + 10, LABEL_MIN_X, LABEL_MAX_X - width),
        y: clamp(y - 26, 55, 580),
        width,
        height: 32,
      };

  labels.rects.push(placed);
  labels.obstacles.push({
    id: `label:${primitive.id}`,
    entityId: primitive.entityId,
    kind: "label",
    bounds: placed,
  });

  // When the only clear home is away from the anchor, say which mark it
  // belongs to instead of leaving the reader to guess.
  if (placement?.usesLeader && placement.leaderFrom && placement.leaderTo) {
    commands.push({
      type: "DRAW_LINE",
      params: [
        placement.leaderFrom.x,
        placement.leaderFrom.y,
        placement.leaderTo.x,
        placement.leaderTo.y,
      ],
      visualStyle: { strokeRole: "construction", strokeWidth: 1.1 },
      semanticRef: { entityId: primitive.entityId, primitiveId: primitive.id },
    });
  }

  commands.push({
    type: "LABEL",
    params: [placed.x, placed.y, LABEL_FONT_PX],
    text,
    anchorId: primitive.entityId,
  });
}

function labelBoundsFromProvenance(
  provenance: Record<string, unknown> | undefined,
): { x: number; y: number; width: number; height: number } | null {
  const bounds = provenance?.labelBounds;
  if (!bounds || typeof bounds !== "object") return null;
  const record = bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  if (
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    typeof record.width !== "number" ||
    typeof record.height !== "number"
  ) return null;
  return {
    x: record.x + 4,
    y: record.y + 4,
    width: record.width,
    height: record.height,
  };
}

function boundsOfPoints(points: Array<{ x: number; y: number }>): { x: number; y: number; width: number; height: number } | null {
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(8, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(8, Math.max(...ys) - Math.min(...ys)),
  };
}

interface LabelPlacementState {
  keys: Set<string>;
  rects: LabelBounds[];
  /** Scene ink plus every label already placed this pass. */
  obstacles: LabelObstacle[];
}

/** The region a diagram label is allowed to occupy. */
const LABEL_VIEW_BOUNDS: LabelBounds = {
  x: LABEL_MIN_X,
  y: 55,
  width: LABEL_MAX_X - LABEL_MIN_X,
  height: 525,
};

/** Labels render at 24 px — measure at 24 px, not at the 32 px default. */
const LABEL_FONT_PX = 24;

function preferredSlotFor(placement: string | undefined): Exclude<LabelSlot, "leader"> | undefined {
  switch (placement) {
    case "above": return "north";
    case "below": return "south";
    case "left": return "west";
    case "right": return "east";
    default: return undefined;
  }
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


function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function flatten(points: Array<{ x: number; y: number }>): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}
