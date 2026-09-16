import {
  measureTextWidth,
  verifiedDiagramCommandToDrawCommand,
  DIAGRAM_ZONE,
  type DrawCommand,
  type VerifiedDiagram,
  type VerifiedDiagramCommand,
  verifiedDiagramHasDrawableInk,
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
  describeSceneFamily,
  obstaclesFromPrimitives,
  placeLabels,
  workColumnObstacle,
} from "@heytutor/scene-engine";
import { CUE_DEFAULT_MS_PER_CHAR, cuedInkFloorMs, findSpokenToken } from "@heytutor/tutor-core";
import { DSA_CODE_PANEL_RECT, DSA_DIAGRAM_ZONE } from "../../constants";
import { buildLabelGlossary } from "./labelGlossary";

/** Named axis marks stay small so they read as dots, not hollow letters. */
const DIAGRAM_POINT_RADIUS = 2;

export interface VerifiedScenePresentationOptions {
  /**
   * "code_lesson" turns show the IDE panel on the left, so diagram labels
   * clamp to the narrower DSA zone and the protected column widens to cover
   * the panel instead of the handwriting work area.
   */
  layout?: "standard" | "code_lesson";
  /**
   * The construction the family or archetype layer chose, e.g. `double_slit`.
   *
   * The tutor used to receive a bare list of entity ids and had no way to tell
   * that the picture in front of it was for another question, so it renamed the
   * parts and taught them: "S is the capillary tube" over a double slit rig.
   * Naming the figure is what lets the lesson refuse it.
   */
  figureFamily?: string;
}

/** Convert validated render primitives into the whiteboard command transport. */
export function buildVerifiedDiagramPresentation(
  document: SceneDocument,
  renderScene: RenderScene,
  options: VerifiedScenePresentationOptions = {},
): VerifiedDiagramPresentation {
  const layout = labelLayoutFor(options.layout ?? "standard");
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
    obstacles: [...obstaclesFromPrimitives(renderScene.primitives), layout.protectedColumn],
    layout,
  };
  const commandKeys = new Set<string>();
  const rolesByEntityId = new Map(document.entities.map((entity) => [entity.id, entity.role]));
  const regionEntityIds = new Set(document.constructions.flatMap((construction) =>
    construction.operator === "function_region" ? construction.outputs : []));
  const orderedGroupIds = orderedRevealGroupIds(renderScene);
  // Default DSA grouping is structure + markers. Hold later groups only when
  // the hint compiled into real worked-example frames (input, split, …).
  const dsaExampleFrames = orderedGroupIds.filter(
    (id) => id !== "structure" && id !== "markers",
  );
  const holdLaterDsaFrames = options.layout === "code_lesson" && dsaExampleFrames.length > 1;
  const introGroupId = holdLaterDsaFrames ? orderedGroupIds[0]! : null;

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

  // Every command held back from the intro, with why. Only a label or a
  // dimension that is waiting for its name (`named`) may be pulled forward
  // into the beat whose sentence says that name.
  const deferred: DeferredCommand[] = [];
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
      if (options.layout === "code_lesson" && isDsaMarkerScribble(styled)) {
        continue;
      }
      const commandPhase =
        command.type === "LABEL" || command.type === "DIMENSION" ? "detail" : phase;
      const deferReason = deferralReason(
        primitive,
        command,
        annotateTargetIds,
        options.layout === "code_lesson",
      ) ?? (holdLaterDsaFrames && primitive.groupId !== introGroupId ? "frame" : null);
      const index = add(primitive.groupId, commandPhase, styled, { reveal: deferReason === null });
      if (deferReason !== null && index !== null) {
        deferred.push({
          index,
          entityId: primitive.entityId,
          groupId: primitive.groupId,
          pullable: deferReason === "named",
        });
      }
    }
  }

  const introSegments: TutorSegment[] = [];
  const reveals: VerifiedDiagram["reveals"] = [];
  const entitiesById = new Map(document.entities.map((entity) => [entity.id, entity]));
  const pulled = new Set<number>();
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

    if (options.layout !== "code_lesson") {
      // One spoken beat per reveal group, in draw order, every command under
      // the word that names it. Chunking would cut a sentence away from the
      // parts it names, so a cued beat is never split.
      const beat = cueRevealBeat({
        cue,
        groupIndex,
        commandIndices,
        commands,
        entitiesById,
        deferred: deferred.filter((entry) =>
          entry.groupId === groupId && entry.pullable && !pulled.has(entry.index),
        ),
      });
      for (const index of beat.pulledIndices) pulled.add(index);
      reveals.push({
        narration: beat.narration,
        commandIndices: beat.indices,
        kind: "reveal",
        targetId: groupId,
      });
      introSegments.push({
        narration: beat.narration,
        command: beat.drawCommands[0] ?? null,
        commands: beat.drawCommands,
        verifiedDiagramIntro: true,
      });
      return;
    }

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

  const anchors = Object.entries(renderScene.entityBounds)
    // A DSA frame carries an invisible box the size of the whole walk-through
    // so every frame fits at one scale. It draws nothing, so it must not be
    // something the marker or a spotlight can be sent to.
    .filter(([id]) => !document.entities.some(
      (entity) => entity.id === id && entity.provenance?.dsaExtent === true,
    ))
    .map(([id, bounds]) => {
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
  // What the student can actually read on the board, per entity. The prompt
  // used to advertise `entityId (label)`, and lessons then spoke the id:
  // "this is body1", "q1 is the total field vector". Worse, reveal-group ids
  // were listed alongside real parts, so `setup` and `current_sense` were
  // taught as apparatus ("the current sense block measures the current
  // flowing through the whole network"). Say the label, tag the id, and keep
  // the groups in their own list where they cannot be mistaken for objects.
  const drawnTextByEntity = new Map<string, string>();
  for (const primitive of renderScene.primitives) {
    if (primitive.kind !== "label" && primitive.kind !== "dimension") continue;
    const text = primitive.text?.trim();
    if (!text || drawnTextByEntity.has(primitive.entityId)) continue;
    drawnTextByEntity.set(primitive.entityId, text);
  }
  const namedTargets = anchors
    .filter((anchor) => drawnTextByEntity.has(anchor.id))
    .map((anchor) => `"${drawnTextByEntity.get(anchor.id)}" = [FOCUS:${anchor.id}]`)
    .join(", ");
  const unnamedTargets = anchors
    .filter((anchor) => !drawnTextByEntity.has(anchor.id))
    .map((anchor) => anchor.id)
    .join(", ");
  const groupTargets = groups.map((group) => group.id).join(", ");
  const deferredByEntity = new Map<string, VerifiedDiagramCommand[]>();
  for (const entry of deferred) {
    if (pulled.has(entry.index)) continue;
    const existing = deferredByEntity.get(entry.entityId) ?? [];
    existing.push(commands[entry.index]!);
    deferredByEntity.set(entry.entityId, existing);
  }
  const deferredIds = [...deferredByEntity.keys()].join(", ");
  const hasDrawableInk = verifiedDiagramHasDrawableInk({ commands });
  const diagram: VerifiedDiagram = {
    id: "verified_scene",
    name: nonMetric ? "source-grounded conceptual representation" : "validated semantic scene",
    commands,
    anchors,
    reveals,
    groups,
    // A caption describes ink. With no drawable command there is no figure to
    // caption. Non-metric scenes used to stamp "Do not read scale from this
    // figure." under every DSA walk; the teaching prompt already forbids
    // reading scale, so the student does not need that line on the board.
    caption: hasDrawableInk ? visibleFigureCaption(renderScene.caption) : undefined,
    layout: options.layout === "code_lesson" ? "code_lesson" : undefined,
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
When you name a listed diagram part, put one [FOCUS:entity_id] for that part inside the sentence, directly after the spoken name (for example "its pole [FOCUS:P] is on the axis"). One id per tag: a sentence that names three parts carries three tags, each right after its own name. Never place the tag at the end of the step after a WRITE row, and never write two ids in one tag. Never provide coordinates.
Parts the student can read, written as the drawn label then its tag: ${namedTargets || "none"}. Speak the label, never the id; the id belongs inside the tag only. The quotation marks are there to delimit the label and are not spoken.
Parts with no label on the board: ${unnamedTargets || "none"}. You may FOCUS these, but do not give them a name aloud and do not claim the figure marks them.
Reveal groups, which are sets of the parts above and not objects in their own right: ${groupTargets || "none"}. Never describe a group as a component, a block, an instrument, or a piece of apparatus.
Optional FOCUS forms: [FOCUS:entity_id], [FOCUS:entity_id|spotlight], [FOCUS:entity_id|pulse], or a reveal-group id.
When you say what a labeled point is, for example the object O or the image I, the tag follows the name inside the sentence. FOCUS also reveals that entity's withheld label.
To box the current work-area equation and highlight its result, use [EMPHASIZE:last]. To reveal a withheld measurement, enclose, or other compiled annotation, use [ANNOTATE:entity_id] with one of: ${deferredIds || "none"}.
Do not describe marker movement or pretend to add, point at, circle, or redraw anything. Say "notice", "follow", "look at", or "this is" the named entity when using FOCUS.
Refer to diagram entities by their visible labels in narration.
Read the figure to the student before you calculate with it: name each labeled part, say what it physically represents, and say which way it points or where it acts, with [FOCUS:entity_id] on the part you just named. Never substitute into a figure the student has not been told how to read.
${options.figureFamily ? `The construction on the board is a ${describeSceneFamily(options.figureFamily)} figure. ` : ""}This figure is what it is. If it is not the setup this question is about, or the labelled parts are not the objects the question names, say in one plain sentence that the picture on the board does not show this setup, then teach the question in words and in the work column. Do not rename a part to make it fit and do not describe apparatus that is not in the list.
${options.layout === "code_lesson"
  ? `The left side of the board is the code editor. Never use [WRITE]; code is revealed only with [TYPE:blockId] tags, one block per step.
This turn overrides the FOCUS instructions above. A [FOCUS] here names a FRAME from the FIGURE BEATS list, not an entity: the runtime advances the worked example to that frame and puts the spotlight on the part of it that changed. No frame is on the board to begin with: the first [FOCUS] draws the first frame. Do not focus entity ids, and do not focus anything on a step that reveals code. If FIGURE BEATS says there are none, the figure does not move and you must not use [FOCUS] at all.
Always write it as [FOCUS:frame_id|spotlight], at most one per step. Never a bare [FOCUS:id], never |pulse, and never traces, underlines, or circles.`
  : "WRITE the left work column as the student notebook: names, definitions, relations, substitutions, and results (x below 360). Short phrases are allowed. Do not save writing for the last line, and do not speak a step with the marker parked."}
The scene engine owns all diagram geometry, labels, annotations, directions, connections, and markings.`,
  };

  const spokenIntro = collapseIntroSpeech(introSegments, {
    codeLesson: options.layout === "code_lesson",
    caption: visibleFigureCaption(renderScene.caption ?? captionAnnotationOf(document)),
  }).map((segment) => (options.layout === "code_lesson"
    ? { ...segment, sceneText: true }
    : segment));

  return { diagram, introSegments: spokenIntro };
}

const SCALE_DISCLAIMER = /Do not read scale from this figure\.?/gi;

/** Drop the scale disclaimer. Real frame captions stay. */
function visibleFigureCaption(caption: string | undefined): string | undefined {
  if (!caption) return undefined;
  const cleaned = caption
    .replace(SCALE_DISCLAIMER, "")
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

/** The caption the scene document draws under the figure, if it has one. */
function captionAnnotationOf(document: SceneDocument): string | undefined {
  const caption = document.annotations?.find((annotation) => annotation.kind === "caption");
  const text = caption?.text?.trim();
  return text ? text : undefined;
}

function collapseIntroSpeech(
  segments: TutorSegment[],
  options: { codeLesson?: boolean; caption?: string } = {},
): TutorSegment[] {
  const commands = segments.flatMap((segment) =>
    segment.commands ?? (segment.command ? [segment.command] : []),
  );

  // A code lesson opens on frame 1 of a walk-through, and the tutor's own
  // first beat then describes it. Reading the label list out first
  // ("the labels 0, 1, 2, 3, a[i], and seen identify these parts of the
  // figure") says nothing and says it immediately before the beat that does,
  // so the turn opens by repeating itself.
  //
  // Only when there is ink to introduce: a spoken opening for a figure that
  // was never drawn would announce something the student cannot see.
  if (options.codeLesson && commands.length > 0) {
    const caption = options.caption?.trim();
    return [{
      narration: caption
        ? `Here is the example we will work through: ${caption.charAt(0).toLowerCase()}${caption.slice(1)}.`
        : "Here is the example we will work through.",
      command: commands[0] ?? null,
      commands,
      verifiedDiagramIntro: true,
    }];
  }

  // A physics or maths figure keeps one beat per reveal group, in draw order.
  // These used to be merged into one sentence with the longest cue spoken
  // first: four of nine archetypes then narrated their parts out of the order
  // they were drawn in, and the pen had one 10 s window with no word in it to
  // wait for. The order the groups are drawn in is the order they are spoken.
  return segments;
}

/**
 * The order a figure appears in, and it is the order a teacher draws in.
 *
 * `point` used to sit in `structure` alongside lines and curves, so whichever
 * the scene document happened to list first went down first — and a scene that
 * declares its points before its geometry drew a scatter of dots into empty
 * space and then threaded the lines through them. That reads as a mistake being
 * corrected rather than a figure being built.
 *
 * A skeleton first, then the points marked on it, then the arrows that say
 * which way things go, then the labels and dimensions that name them.
 */
type RevealPhase = "structure" | "marker" | "direction" | "detail";

const REVEAL_PHASES: RevealPhase[] = ["structure", "marker", "direction", "detail"];
const MAX_COMMANDS_PER_GROUP = 14;
const MAX_DETAIL_COMMANDS_PER_SEGMENT = 8;

interface LabelLayout {
  minX: number;
  maxX: number;
  viewBounds: LabelBounds;
  protectedColumn: LabelObstacle;
}

function labelLayoutFor(mode: "standard" | "code_lesson"): LabelLayout {
  if (mode === "code_lesson") {
    const minX = DSA_DIAGRAM_ZONE.x + 10;
    const maxX = DSA_DIAGRAM_ZONE.x + DSA_DIAGRAM_ZONE.width - 10;
    return {
      minX,
      maxX,
      viewBounds: { x: minX, y: 55, width: maxX - minX, height: 525 },
      protectedColumn: {
        id: "code_panel",
        kind: "protected",
        bounds: {
          x: 0,
          y: 0,
          width: DSA_CODE_PANEL_RECT.x + DSA_CODE_PANEL_RECT.width + 8,
          height: 700,
        },
      },
    };
  }
  const minX = DIAGRAM_ZONE.x + 10;
  const maxX = DIAGRAM_ZONE.x + DIAGRAM_ZONE.width - 10;
  return {
    minX,
    maxX,
    viewBounds: { x: minX, y: 55, width: maxX - minX, height: 525 },
    protectedColumn: workColumnObstacle(),
  };
}

function emptyPhaseIndices(): Record<RevealPhase, number[]> {
  return { structure: [], marker: [], direction: [], detail: [] };
}

function isDsaMarkerScribble(command: VerifiedDiagramCommand): boolean {
  if (command.type === "CIRCLE_AROUND" || command.type === "HIGHLIGHT" || command.type === "UNDERLINE") {
    return true;
  }
  if (command.visualStyle?.strokeRole === "trace") return true;
  return command.type === "DRAW_LINE"
    && command.visualStyle?.dashed === true
    && command.visualStyle?.strokeRole === "construction";
}

interface DeferredCommand {
  /** Position in the diagram's command list. */
  index: number;
  entityId: string;
  groupId: string;
  /** A label or dimension waiting for its name, which the intro may speak. */
  pullable: boolean;
}

/**
 * Why a command stays out of the opening figure, or null when it is drawn.
 *
 * `annotation`: a staged ANNOTATE or focus trace; the lecture asks for it.
 * `named`: a label or dimension, lettered when its part is first named,
 * which may be in the intro beat itself when the group's sentence says the
 * name, and otherwise by FOCUS during teaching.
 */
function deferralReason(
  primitive: RenderPrimitive,
  command: VerifiedDiagramCommand,
  annotateTargetIds: Set<string>,
  codeLesson = false,
): "annotation" | "named" | null {
  // DSA figures are a worked example, not a physics apparatus. Values and
  // indices belong on the boxes as they appear — holding them for FOCUS
  // made later rows look empty while FOCUS traces struck through the first.
  if (codeLesson) {
    return primitive.provenance?.transient === true
      || command.visualStyle?.strokeRole === "trace"
      ? "annotation"
      : null;
  }
  const annotationId = typeof primitive.provenance?.annotationId === "string"
    ? primitive.provenance.annotationId
    : undefined;
  if (annotateTargetIds.has(primitive.entityId) || (annotationId && annotateTargetIds.has(annotationId))) {
    return "annotation";
  }
  if (primitive.provenance?.transient === true) return "annotation";
  if (command.type === "CIRCLE_AROUND" || command.type === "HIGHLIGHT") return "annotation";
  if (command.visualStyle?.strokeRole === "trace") return "annotation";
  if (command.type === "LABEL" || command.type === "DIMENSION") return "named";
  return null;
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
  // A point marks a position on geometry that must already exist.
  if (primitive.kind === "point") return "marker";
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

// ---------------------------------------------------------------------------
// The figure is drawn the way a teacher draws it: one part as its name is
// spoken. Each reveal group becomes one sentence, and each command in the
// group is tagged with the word of that sentence which names the part it
// draws, so the runner can wait for the word and draw the part under it.

type SceneEntity = SceneDocument["entities"][number];

interface CuedMatch {
  /** The word as it appears in the sentence, for the runner to find again. */
  token: string;
  /** Character offset of that word in the sentence: the order it is said in. */
  index: number;
  /**
   * The name was the label, the whole role, or the role's head word. A weak
   * match is some other role word ("object" in "object distance"), enough to
   * time the part's ink but not to pull a measurement into the intro.
   */
  strong: boolean;
}

interface CuedRevealBeat {
  narration: string;
  indices: number[];
  drawCommands: DrawCommand[];
  pulledIndices: number[];
}

/** Words a role is made of that never name a part on their own. */
const ROLE_STOP_WORDS = new Set([
  "the", "a", "an", "of", "to", "at", "on", "in", "and", "or", "its", "with", "from",
  "into", "through", "along", "between", "parallel", "relative", "paraxial", "by",
  "for", "under", "over", "per", "first", "second", "third", "upper", "lower", "near",
  "far", "left", "right", "this", "that", "is", "as",
]);
const ROLE_GENERIC_WORDS = new Set([
  "point", "points", "line", "lines", "mark", "marks", "end", "ends", "corner",
  "corners", "tip", "tail", "top", "bottom", "reference", "direction", "label",
  "side", "edge", "arrow", "segment", "vector", "foot", "start", "hatch",
]);
/** Endpoint and scaffold roles: drawn with their parent, never named aloud. */
const UNSPEAKABLE_ROLE = /\b(?:end|corner|tip|tail|top|start|hatch|reference end)$/i;
const ROLE_SYNONYMS: Record<string, string[]> = {
  body: ["mass", "block"],
  mass: ["body", "block"],
  block: ["body", "mass"],
  velocity: ["speed"],
  speed: ["velocity"],
  centre: ["center"],
  center: ["centre"],
  trajectory: ["path"],
  path: ["trajectory"],
};
const IRREGULAR_PLURALS: Record<string, string> = {
  focus: "foci",
  axis: "axes",
  radius: "radii",
  vertex: "vertices",
  index: "indices",
  medium: "media",
};
const IRREGULAR_SINGULARS: Record<string, string> = Object.fromEntries(
  Object.entries(IRREGULAR_PLURALS).map(([singular, plural]) => [plural, singular]),
);
/** A label short enough to say after its role: "its pole P", "the weight mg". */
const SPEAKABLE_LABEL = /^[A-Za-z]{1,2}[′']?$/;

function cleanRole(role: string | undefined): string {
  return (role ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[:;]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function roleWords(role: string): string[] {
  return role.toLowerCase().split(/[^\p{L}\p{N}'′]+/u).filter(Boolean);
}

function distinctiveRoleWords(role: string): string[] {
  return roleWords(role).filter((word) => !ROLE_STOP_WORDS.has(word) && !ROLE_GENERIC_WORDS.has(word));
}

/** Stems a role word shares with its spoken forms: "inclined" says "incline". */
function wordStems(word: string): string[] {
  const stems = [word];
  if (word.length > 4 && word.endsWith("ing")) stems.push(word.slice(0, -3), `${word.slice(0, -3)}e`);
  if (word.length > 4 && word.endsWith("ed")) stems.push(word.slice(0, -1), word.slice(0, -2));
  if (word.length > 3 && word.endsWith("es")) stems.push(word.slice(0, -2));
  if (word.length > 3 && word.endsWith("s")) stems.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("ies")) stems.push(`${word.slice(0, -3)}y`);
  const singular = IRREGULAR_SINGULARS[word];
  if (singular) stems.push(singular);
  return [...new Set(stems)];
}

function wordVariants(word: string): string[] {
  const variants: string[] = [];
  for (const stem of wordStems(word)) {
    variants.push(stem);
    const plural = IRREGULAR_PLURALS[stem];
    if (plural) variants.push(plural);
    variants.push(`${stem}s`, `${stem}es`);
    if (stem.endsWith("y")) variants.push(`${stem.slice(0, -1)}ies`);
    for (const synonym of ROLE_SYNONYMS[stem] ?? []) {
      variants.push(synonym, `${synonym}s`, `${synonym}es`);
    }
  }
  return [...new Set(variants)];
}

interface NameCandidate {
  text: string;
  strong: boolean;
  /**
   * `lettered`: the text on the board or the entity label. `phrase`: the
   * whole role, which claims its span when spoken. `word`: one role word.
   */
  kind: "lettered" | "phrase" | "word";
}

/**
 * The words that can name this entity, most specific first: what is lettered
 * on the board, the entity's label, its whole role, the role's head word and
 * only then any other role word. Never its id.
 */
function entityNameCandidates(
  entity: SceneEntity | undefined,
  drawnTexts: string[],
): NameCandidate[] {
  const candidates: NameCandidate[] = [];
  const push = (text: string | undefined, strong: boolean, kind: NameCandidate["kind"] = "word") => {
    const cleaned = text?.trim();
    if (!cleaned || candidates.some((candidate) => candidate.text === cleaned)) return;
    candidates.push({ text: cleaned, strong, kind });
  };
  const role = cleanRole(entity?.role);
  if (role && /\s/.test(role)) push(role, true, "phrase");
  for (const text of drawnTexts) push(text, true, "lettered");
  push(entity?.label, true, "lettered");
  if (role) {
    push(role, true);
    // The head noun names the part: "centre" in "centre of curvature", "ray"
    // in "reflected ray through F". When the head is generic ("object foot",
    // "launch point", "angle mark") the words left over name the parent or
    // the kind of mark: they time this part's ink under that word, but they
    // do not letter its label, because "the object" is not "O".
    const head = roleHeadWord(role);
    if (head) for (const variant of wordVariants(head)) push(variant, true);
    for (const word of distinctiveRoleWords(role)) {
      if (word === head) continue;
      for (const variant of wordVariants(word)) push(variant, false);
    }
  }
  return candidates;
}

const ROLE_PREPOSITIONS = new Set([
  "of", "to", "at", "on", "in", "through", "along", "into", "between", "from",
  "relative", "parallel", "under", "over", "with", "by", "for", "per",
]);

/** The last word of the role's head phrase, when it is a name in its own right. */
function roleHeadWord(role: string): string | null {
  const words = roleWords(role);
  const cut = words.findIndex((word) => ROLE_PREPOSITIONS.has(word));
  const headPhrase = cut > 0 ? words.slice(0, cut) : words;
  const head = headPhrase.at(-1);
  if (!head || ROLE_STOP_WORDS.has(head) || ROLE_GENERIC_WORDS.has(head)) return null;
  return head;
}

interface ClaimedSpan {
  start: number;
  end: number;
  text: string;
}

/**
 * Whole-word search that steps over the spans other parts' role phrases
 * have claimed. Without this the resultant's head word "velocity" landed
 * inside "the boat velocity relative to water" and the resultant arrow was
 * drawn under the boat's words.
 */
function findUnclaimedToken(sentence: string, text: string, claimed: ClaimedSpan[]): number {
  let from = 0;
  while (from <= sentence.length) {
    const index = findSpokenToken(sentence, text, from);
    if (index < 0) return -1;
    const end = index + text.length;
    const inside = claimed.some((span) =>
      index >= span.start && end <= span.end && span.text.toLowerCase() !== text.toLowerCase(),
    );
    if (!inside) return index;
    from = index + 1;
  }
  return -1;
}

/**
 * Where the sentence names each part. Whole role phrases are placed first
 * and claim their words; then each part takes its most specific spoken name
 * that occurs outside another part's phrase: the lettered text, the label,
 * the role's head word, and only then any other role word. The current arrow
 * is drawn under "current" (its label), not under "river" (a role word that
 * happens to come first).
 */
function matchEntitiesInSentence(
  sentence: string,
  candidatesByEntity: ReadonlyMap<string, NameCandidate[]>,
): Map<string, CuedMatch> {
  const matches = new Map<string, CuedMatch>();
  const claimed: ClaimedSpan[] = [];
  for (const [entityId, candidates] of candidatesByEntity) {
    // What is lettered on the board beats the role phrase: "i=40°" is the
    // angle of incidence's own name, "angle mark" is one it shares.
    const lettered = candidates.some((candidate) =>
      candidate.kind === "lettered" && findSpokenToken(sentence, candidate.text, 0) >= 0,
    );
    if (lettered) continue;
    for (const candidate of candidates) {
      if (candidate.kind !== "phrase") continue;
      const index = findSpokenToken(sentence, candidate.text, 0);
      if (index < 0) continue;
      claimed.push({ start: index, end: index + candidate.text.length, text: candidate.text });
      matches.set(entityId, {
        token: sentence.slice(index, index + candidate.text.length),
        index,
        strong: true,
      });
    }
  }
  for (const [entityId, candidates] of candidatesByEntity) {
    if (matches.has(entityId)) continue;
    for (const candidate of candidates) {
      if (candidate.kind === "phrase") continue;
      const index = findUnclaimedToken(sentence, candidate.text, claimed);
      if (index < 0) continue;
      matches.set(entityId, {
        token: sentence.slice(index, index + candidate.text.length),
        index,
        strong: candidate.strong,
      });
      break;
    }
  }
  return matches;
}

function firstSpokenWord(sentence: string): string {
  return /^[\p{L}\p{N}]+/u.exec(sentence)?.[0] ?? sentence.trim().split(/\s+/)[0] ?? "";
}

function capitaliseSentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The group's cue as the sentence a teacher says while drawing the group. */
function spokenCueSentence(cue: string, groupIndex: number): string {
  if (isSpokenProse(cue)) return capitaliseSentence(ensureSpokenSentence(cue));
  const subject = cueSubject(cue);
  return groupIndex === 0 ? `Let’s begin with ${subject}.` : `Next comes ${subject}.`;
}

/**
 * "the weight mg", "the normal reaction N", "the weight component".
 *
 * The role's head phrase, not the whole role: "the weight component along
 * the incline, and the weight component into the incline" made a four-arrow
 * beat twelve seconds long with the pen idle for two thirds of it. Two parts
 * with the same head phrase share the words, and the window.
 */
function entityPhrase(entity: SceneEntity): string | null {
  const role = cleanRole(entity.role).replace(/\s+label$/i, "");
  const label = entity.label?.trim();
  if (!role) {
    return label && SPEAKABLE_LABEL.test(label) ? label : null;
  }
  if (UNSPEAKABLE_ROLE.test(role)) return null;
  const words = roleWords(role);
  const cut = words.findIndex((word) => ROLE_PREPOSITIONS.has(word));
  const headPhrase = cut > 0 && roleHeadWord(role) ? words.slice(0, cut).join(" ") : role;
  const spokenLabel = label && SPEAKABLE_LABEL.test(label) && !words.includes(label.toLowerCase())
    ? ` ${label}`
    : "";
  const article = /^(?:the|a|an|its)\s/i.test(headPhrase) ? "" : "the ";
  return `${article}${headPhrase}${spokenLabel}`;
}

/**
 * One phrase per part, in draw order, with the connectives a teacher uses
 * while the hand is busy. Sized to be spoken for about as long as the parts
 * take to draw; the first beat also says what is happening.
 */
/** Ink may trail the last word of an intro beat by this much before the beat says more. */
const CUE_OVERRUN_TOLERANCE_MS = 400;

function walkedSetupSentence(phrases: string[], groupIndex: number): string {
  const opening = groupIndex === 0 ? "Here is the setup. " : "Next, ";
  const parts = phrases.map((phrase, index) => {
    if (index === 0) return `first ${phrase}`;
    if (index === phrases.length - 1) return `and finally ${phrase}`;
    return index % 2 === 1 ? `then ${phrase}` : phrase;
  });
  const body = parts.join(", ");
  const closing = groupIndex === 0 ? " That is the setup." : " All in place.";
  const sentence = groupIndex === 0 ? `${body.charAt(0).toUpperCase()}${body.slice(1)}` : body;
  return `${opening}${sentence}.${closing}`;
}

function joinSpokenList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * Give every drawn thing a word.
 *
 * When the cue names fewer than half of the group's parts ("every force on
 * the body" names none of the four arrows), the sentence goes on to name the
 * rest from their roles and labels, so each arrow has a word to be drawn
 * under and each label a moment to be lettered in.
 */
function extendCueSentence(base: string, phrases: string[], nothingNamed: boolean): string {
  const trimmed = base.trim().replace(/[.!?]+$/, "");
  const list = joinSpokenList(phrases);
  return nothingNamed ? `${trimmed}: ${list}.` : `${trimmed}, with ${list}.`;
}

function cueRevealBeat(input: {
  cue: string;
  groupIndex: number;
  commandIndices: number[];
  commands: VerifiedDiagramCommand[];
  entitiesById: ReadonlyMap<string, SceneEntity>;
  deferred: DeferredCommand[];
}): CuedRevealBeat {
  const { commands, entitiesById } = input;
  const entityIds: string[] = [];
  for (const index of input.commandIndices) {
    const entityId = commands[index]?.semanticRef?.entityId;
    if (entityId && !entityIds.includes(entityId)) entityIds.push(entityId);
  }
  const drawnTextsByEntity = new Map<string, string[]>();
  for (const entry of input.deferred) {
    const text = commands[entry.index]?.text?.trim();
    if (!text) continue;
    const texts = drawnTextsByEntity.get(entry.entityId) ?? [];
    if (!texts.includes(text)) texts.push(text);
    drawnTextsByEntity.set(entry.entityId, texts);
  }
  // A measurement has no ink of its own in the beat, only its withheld
  // dimension and label; it is still matched so "and range" can pull R in.
  const matchedIds = [...entityIds];
  for (const entry of input.deferred) {
    if (!matchedIds.includes(entry.entityId)) matchedIds.push(entry.entityId);
  }
  const candidatesByEntity = new Map(matchedIds.map((entityId) => [
    entityId,
    entityNameCandidates(entitiesById.get(entityId), drawnTextsByEntity.get(entityId) ?? []),
  ]));
  const matchAll = (sentence: string): Map<string, CuedMatch> => {
    const matches = matchEntitiesInSentence(sentence, candidatesByEntity);
    // Compiler helpers are named after their parent: `incline_hatch`,
    // `body_c0`, `ceiling_l`. They are drawn under the parent's word. Left
    // to inherit from whatever was drawn before them, the incline's hatching
    // inherited "angle" from the angle mark and ran 570 ms past the sentence.
    for (const entityId of matchedIds) {
      if (matches.has(entityId)) continue;
      const parent = [...matches.keys()]
        .filter((candidate) => entityId.startsWith(`${candidate}_`))
        .sort((left, right) => right.length - left.length)[0];
      if (parent) matches.set(entityId, { ...matches.get(parent)!, strong: false });
    }
    return matches;
  };

  let narration = spokenCueSentence(input.cue, input.groupIndex);
  let matches = matchAll(narration);
  const nameable = entityIds.filter((entityId) => {
    const entity = entitiesById.get(entityId);
    return Boolean(entity && (entity.label || entity.role));
  });
  const named = nameable.filter((entityId) => matches.has(entityId));
  // The hand needs at least this long for the group's ink (labels the
  // sentence names included). A sentence shorter than that leaves the pen
  // running past the voice, so it too earns the rest of the names.
  const floorMs = (currentMatches: Map<string, CuedMatch>): number =>
    input.commandIndices.reduce((sum, index) => sum + cuedInkFloorMs(verifiedDiagramCommandToDrawCommand(commands[index]!)), 0)
    + input.deferred.reduce((sum, entry) =>
      currentMatches.get(entry.entityId)?.strong
        ? sum + cuedInkFloorMs(verifiedDiagramCommandToDrawCommand(commands[entry.index]!))
        : sum, 0);
  const spokenMs = (sentence: string): number => sentence.length * CUE_DEFAULT_MS_PER_CHAR;
  const tooShort = floorMs(matches) > spokenMs(narration);
  if (named.length * 2 < nameable.length || tooShort) {
    const phrases: string[] = [];
    for (const entityId of nameable) {
      if (matches.has(entityId)) continue;
      const phrase = entityPhrase(entitiesById.get(entityId)!);
      if (phrase && !phrases.includes(phrase)) phrases.push(phrase);
    }
    if (phrases.length > 0) {
      narration = extendCueSentence(narration, phrases, named.length === 0);
      matches = matchAll(narration);
    }
  }
  // Every command gets a word: its own part's when the sentence names it,
  // otherwise the word of the command before it, so scaffolding is drawn
  // with the part it belongs to. Then the beat is put in spoken order, stable,
  // so parts the sentence does not name keep the skeleton-first phase order.
  //
  // A label the sentence names is lettered right after its part's ink, in
  // the same word's window: "pole" letters P as it is said. Only a strong
  // match letters: "the object" times the foot O under the object's word but
  // does not pull `u = 20 cm` forward or letter O itself. Those wait for the
  // lecture to name them and FOCUS releases them.
  interface BeatItem { index: number; entityId: string; token: string; position: number }
  const layout = (sentence: string, sentenceMatches: Map<string, CuedMatch>) => {
    const items: BeatItem[] = [];
    let previous = { token: firstSpokenWord(sentence), position: 0 };
    for (const index of input.commandIndices) {
      const entityId = commands[index]?.semanticRef?.entityId ?? "";
      const match = sentenceMatches.get(entityId);
      if (match) previous = { token: match.token, position: match.index };
      items.push({ index, entityId, ...previous });
    }
    const pulled: number[] = [];
    for (const entry of input.deferred) {
      const match = sentenceMatches.get(entry.entityId);
      if (!match?.strong) continue;
      const item: BeatItem = { index: entry.index, entityId: entry.entityId, token: match.token, position: match.index };
      let at = -1;
      for (let cursor = items.length - 1; cursor >= 0; cursor--) {
        if (items[cursor]!.entityId === entry.entityId) { at = cursor; break; }
      }
      items.splice(at >= 0 ? at + 1 : items.length, 0, item);
      pulled.push(entry.index);
    }
    const ordered = items
      .map((item, order) => ({ item, order }))
      .sort((left, right) => left.item.position - right.item.position || left.order - right.order)
      .map(({ item }) => item);
    return { ordered, pulled };
  };
  // How far the hand runs past the sentence when every part waits for its
  // word and then takes its floor: the parts under the last word start late
  // by construction, so a sentence can be long enough in total and still end
  // a second before the ink does.
  const overrunMs = (sentence: string, ordered: BeatItem[]): number => {
    let clockMs = 0;
    for (const item of ordered) {
      clockMs = Math.max(clockMs, item.position * CUE_DEFAULT_MS_PER_CHAR)
        + cuedInkFloorMs(verifiedDiagramCommandToDrawCommand(commands[item.index]!));
    }
    return clockMs - spokenMs(sentence);
  };

  // Every part may already be named and the sentence still be shorter than
  // the hand: a circuit of 26 strokes needs eleven seconds and its cue
  // ("the battery, R1 and R2") is under five, so the pen ran six seconds past
  // the voice. A teacher who has that much to draw says more while drawing
  // it, so the beat becomes a walk through the parts, one phrase each, in the
  // order they go down, closing on a short clause so the last part has its
  // time too.
  let placed = layout(narration, matches);
  if (overrunMs(narration, placed.ordered) > CUE_OVERRUN_TOLERANCE_MS) {
    const phrases: string[] = [];
    for (const entityId of nameable) {
      const phrase = entityPhrase(entitiesById.get(entityId)!);
      if (phrase && !phrases.includes(phrase)) phrases.push(phrase);
    }
    if (phrases.length >= 2) {
      const walked = walkedSetupSentence(phrases, input.groupIndex);
      const walkedMatches = matchAll(walked);
      const walkedPlaced = layout(walked, walkedMatches);
      if (
        walkedMatches.size >= matches.size &&
        overrunMs(walked, walkedPlaced.ordered) < overrunMs(narration, placed.ordered)
      ) {
        narration = walked;
        matches = walkedMatches;
        placed = walkedPlaced;
      }
    }
  }
  const ordered = placed.ordered;
  const pulledIndices = placed.pulled;

  return {
    narration,
    indices: ordered.map((item) => item.index),
    drawCommands: ordered.map((item) => ({
      ...verifiedDiagramCommandToDrawCommand(commands[item.index]!),
      spokenCue: { token: item.token, entityId: item.entityId },
    })),
    pulledIndices,
  };
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
  // The extent box exists so every frame of a walk-through fits at the same
  // scale. It is geometry for the compiler, never ink for the student.
  if (primitive.provenance?.dsaExtent === true) return commands;
  const dsaStyle = dsaMarkStyle(primitive.provenance);
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
    commands.push({ type: "DRAW_CIRCLE", params: [points[0].x, points[0].y, primitive.radius ?? DIAGRAM_POINT_RADIUS] });
    return commands;
  }
  switch (primitive.kind) {
    case "point": {
      const point = points[0];
      if (point) commands.push({ type: "DRAW_POINT", params: [point.x, point.y, primitive.radius ?? DIAGRAM_POINT_RADIUS] });
      break;
    }
    case "line":
    case "polyline": {
      if (points.length >= 2) commands.push({ type: "DRAW_LINE", params: flatten(points), ...dsaStyle });
      break;
    }
    case "ray":
    case "vector": {
      const start = points[0]; const end = points.at(-1);
      if (start && end) commands.push({ type: "ARROW", params: [start.x, start.y, end.x, end.y], ...dsaStyle });
      break;
    }
    case "circle": {
      const center = points[0];
      if (center && primitive.radius) commands.push({ type: "DRAW_CIRCLE", params: [center.x, center.y, primitive.radius], ...dsaStyle });
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
        commands.push({ type: "DRAW_RECT", params: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], ...dsaStyle });
      }
      break;
    }
    case "polygon": {
      if (points.length >= 3) commands.push({ type: "DRAW_LINE", params: flatten([...points, points[0]!]), ...dsaStyle });
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
        commands.push({ type: "DIMENSION", params: [start.x, start.y, end.x, end.y, 0] });
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

/**
 * What a DSA mark looks like on the board.
 *
 * The compiled figure says what the algorithm is doing to each element:
 * `active` is a filled wash, a magnitude bar is filled, `candidate` and
 * `window` are dashed outlines. A plain rectangle primitive carries no style,
 * so without this every one of those drew as an ordinary box and the
 * distinction the mark exists to make was lost.
 *
 * `strokeRole` is deliberately not set to "construction": on a code lesson a
 * dashed construction line is filtered out as marker scribble.
 */
function dsaMarkStyle(
  provenance: Record<string, unknown> | undefined,
): { visualStyle?: VerifiedDiagramCommand["visualStyle"] } {
  if (!provenance) return {};
  const fillRole = provenance.fillRole === "region" ? ("region" as const) : undefined;
  const dashed = provenance.dashed === true;
  const strokeWidth = typeof provenance.strokeWidth === "number" ? provenance.strokeWidth : undefined;
  if (!fillRole && !dashed && strokeWidth === undefined) return {};
  return { visualStyle: { ...(fillRole ? { fillRole } : {}), ...(dashed ? { dashed } : {}), ...(strokeWidth !== undefined ? { strokeWidth } : {}) } };
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
  const fontPx = labelFontPx(primitive.provenance);
  const width = Math.max(measureTextWidth(text, fontPx), 14);
  if (primitive.labelPlacement === "absolute") {
    const reserved = labelBoundsFromProvenance(primitive.provenance);
    const placed = reserved ?? {
      x: x - width / 2,
      y: y - Math.round(fontPx * 0.65),
      width,
      height: fontPx + 8,
    };
    labels.rects.push(placed);
    labels.obstacles.push({
      id: `label:${primitive.id}`,
      entityId: primitive.entityId,
      kind: "label",
      bounds: placed,
    });
    commands.push({ type: "LABEL", params: [placed.x, placed.y, fontPx], text, anchorId: primitive.entityId });
    return;
  }
  // Feed the solver the renderer's own glyph metrics rather than an average
  // character box, so the reserved space is the space it draws in.
  const solve = (obstacles: LabelObstacle[]) => placeLabels(
    [{
      labelId: primitive.id,
      entityId: primitive.entityId,
      anchor: { x, y },
      text,
      preferredSlot: preferredSlotFor(primitive.labelPlacement),
      viewBounds: labels.layout.viewBounds,
      useOwnerBounds: false,
    }],
    obstacles,
    // `fontPx`, not the 24px default: the reserved box has to be the size this
    // label is actually lettered at, and a compiled label may carry its own.
    { fontHeightPx: fontPx, measureTextPx: measureTextWidth },
  );

  // With every stroke blocking, the label still has to land somewhere. Solving
  // again against the protected column alone keeps the same one engine — and
  // the same in-view, out-of-the-work-column guarantees — instead of the fixed
  // offset this used to fall back to, which ignored the figure entirely.
  const placement = solve(labels.obstacles).placements[0]
    ?? solve(labels.obstacles.filter((obstacle) => obstacle.kind === "protected")).placements[0];
  const placed = placement?.bounds ?? {
    x: clamp(x + 10, labels.layout.minX, labels.layout.maxX - width),
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

  // Centre the run in the box the solver reserved, the way the compiled path
  // already does. `placed` carries the solver's padding on both sides, so
  // lettering from its corner leaves all the slack on one side and puts the
  // ink closer to the neighbour on the other. Horizontally only: the reserved
  // height is the em box, and the run's descender already uses the space below.
  const inset = Math.max(0, (placed.width - width) / 2);
  commands.push({
    type: "LABEL",
    params: [placed.x + inset, placed.y, labelFontPx(primitive.provenance)],
    text,
    anchorId: primitive.entityId,
  });
}

function labelFontPx(provenance: Record<string, unknown> | undefined): number {
  const value = provenance?.fontPx;
  return typeof value === "number" && value >= 12 && value <= 40 ? value : LABEL_FONT_PX;
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
  const pad = typeof provenance?.labelPad === "number" ? provenance.labelPad : 4;
  return {
    x: record.x + pad,
    y: record.y + pad,
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
  /** Mode-aware clamp region for this turn's board split. */
  layout: LabelLayout;
}

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
