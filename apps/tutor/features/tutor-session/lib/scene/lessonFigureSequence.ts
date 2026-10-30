/**
 * Later figures inside one lesson, live (DIAGRAM_LESSON_FIGURES, phase 3b).
 *
 * The `DsaFrameController` analogue, one per page: figure 1 is the lesson's
 * own verified figure; figure_2 and figure_3 were planned offline by
 * `planLessonFigures` from the engine's fast selector. The teaching stream
 * moves to one with `[FOCUS:figure_k]`, forward only. It names a figure; the
 * runtime draws that figure's verified intro, never anything the model wrote.
 *
 * An advance is one step from the moment it starts (review F2). The cursor
 * moves and the cue's row counts as shown before the zone is erased, so a
 * Stop saves the cue; a Stop part way leaves the figure `pendingIntro`, and
 * the next turn on the page draws it whole first (`finishLessonFigureAdvance`),
 * as replay stands it. A cue the cursor never reached (Stop before it, or a
 * refused advance) is not saved (`savedCommandFilter`).
 *
 * Two cursors read this sequence and they must not be confused:
 * - playback (`advanceTo`), moved by the executor when the cue plays;
 * - preparation (`diagramAfter`), which segment preparation reads while the
 *   response streams, far ahead of playback. Preparing a sentence against the
 *   figure on screen instead would drop every FOCUS on figure 2's parts.
 */
import {
  getSegmentCommands,
  parseFocusSpec,
  prepareVerifiedLessonSegments,
  foldWritelessFocusRuns,
  type DrawCommand,
  type PreparedVerifiedSegments,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { LESSON_FIGURE_IDS, isLessonFigureAdvanceId, type LessonFigureId } from "@/lib/boards/lessonFigures";
import { describeSceneFamily } from "@heytutor/scene-engine";
import type { LaterFigurePrompt } from "../turn/turnTeachingPrompt";
import type { BoardLayoutState } from "../../types";
import { returnFigureToZone, type FigureSwapExecuteCommand, type ZoneBoard } from "./figureSwap";

export interface LessonFigurePresentation {
  diagram: VerifiedDiagram;
  introSegments: TutorSegment[];
}

export interface PlannedLessonFigureView extends LessonFigurePresentation {
  id: LessonFigureId;
  family: string | null;
}

export interface LessonFigureSequenceHooks {
  /** False refuses an advance: the zone holds a doubt's figure (a stash exists). */
  mayAdvance?: (id: LessonFigureId) => boolean;
  /** The zone now holds `view` (the executor set it active before drawing it). */
  onAdvanced?: (view: PlannedLessonFigureView) => void;
}

/** The figure index of an id: -1 for figure 1, 0 for figure_2, 1 for figure_3. */
function indexOf(id: LessonFigureId): number {
  return LESSON_FIGURE_IDS.indexOf(id);
}

/**
 * The advance a command names, or null. Same rule as the server cursor
 * (turnScenePersistence `lesson-figure-cursor`): a FOCUS with exactly one
 * target, an advance id, a figure the sequence holds, strictly after `after`.
 */
export function lessonFigureAdvanceOf(
  command: Pick<DrawCommand, "type" | "text" | "semanticRef">,
  has: (id: LessonFigureId) => boolean,
  after: number,
): LessonFigureId | null {
  if (command.type !== "FOCUS") return null;
  const spec = parseFocusSpec(command.semanticRef?.entityId ?? command.text);
  const target = spec.targetIds.length === 1 ? spec.targetIds[0]!.trim() : "";
  if (!isLessonFigureAdvanceId(target) || !has(target)) return null;
  return indexOf(target) > after ? target : null;
}

/** Why an advance id was refused (review N6), for telemetry. */
export type LessonFigureRefusal = "no_sequence" | "not_held" | "not_forward" | "zone_held";

export class LessonFigureSequence {
  private first: LessonFigurePresentation | null = null;
  private rest: PlannedLessonFigureView[] = [];
  private index = -1;
  private hooks: LessonFigureSequenceHooks = {};
  /** The figure an advance started and has not finished drawing (Stop part way). */
  private pending: PlannedLessonFigureView | null = null;

  commit(first: LessonFigurePresentation, rest: readonly PlannedLessonFigureView[], hooks: LessonFigureSequenceHooks = {}): void {
    this.first = first;
    this.rest = [...rest].sort((a, b) => indexOf(a.id) - indexOf(b.id));
    this.index = -1;
    this.hooks = hooks;
    this.pending = null;
  }

  reset(): void {
    this.first = null;
    this.rest = [];
    this.index = -1;
    this.hooks = {};
    this.pending = null;
  }

  /** A sequence with at least one later figure. */
  active(): boolean {
    return this.first !== null && this.rest.length > 0;
  }

  views(): readonly PlannedLessonFigureView[] {
    return this.rest;
  }

  currentId(): "figure_1" | LessonFigureId {
    return this.index < 0 ? "figure_1" : LESSON_FIGURE_IDS[this.index]!;
  }

  has(id: LessonFigureId): boolean {
    return this.rest.some((view) => view.id === id);
  }

  /** The advance `command` makes from the playback cursor, or null. */
  advanceIdOf(command: Pick<DrawCommand, "type" | "text" | "semanticRef">): LessonFigureId | null {
    return this.first ? lessonFigureAdvanceOf(command, (id) => this.has(id), this.index) : null;
  }

  /**
   * Forward only: returns the figure to draw, or null when id is not strictly
   * after the current one. The returned figure is pending until `introDone`.
   */
  advanceTo(id: LessonFigureId): PlannedLessonFigureView | null {
    if (this.refusalOf(id) !== null) return null;
    const view = this.rest.find((candidate) => candidate.id === id)!;
    this.index = indexOf(id);
    this.pending = view;
    return view;
  }

  /**
   * Review round 3 M1: a stored surface (restore, replay, a resume's return)
   * stands figure `id` whole in the zone itself, so the cursor moves there with
   * nothing pending: no later doubt or resume may redraw it (which would drop
   * the labels its rows released). Forward only, as `advanceTo`.
   */
  seekTo(id: LessonFigureId): PlannedLessonFigureView | null {
    if (!this.first || !this.has(id) || indexOf(id) <= this.index) return null;
    const view = this.rest.find((candidate) => candidate.id === id)!;
    this.index = indexOf(id);
    this.pending = null;
    return view;
  }

  /** Why `advanceTo(id)` refuses now, or null when it would advance. */
  refusalOf(id: LessonFigureId): LessonFigureRefusal | null {
    if (!this.first) return "no_sequence";
    if (!this.has(id)) return "not_held";
    if (indexOf(id) <= this.index) return "not_forward";
    if (this.hooks.mayAdvance && !this.hooks.mayAdvance(id)) return "zone_held";
    return null;
  }

  /** Tell the page the zone now holds `view`. */
  advanced(view: PlannedLessonFigureView): void {
    this.hooks.onAdvanced?.(view);
  }

  /** Figure `view`'s intro is whole on the board. */
  introDone(view: PlannedLessonFigureView): void {
    if (this.pending === view) this.pending = null;
  }

  /** The figure an advance started and a Stop left part drawn, or null. */
  pendingIntro(): PlannedLessonFigureView | null {
    return this.pending;
  }

  /**
   * Whether a played row may be saved with `command`. Only an advance cue the
   * playback cursor never reached is not: live never moved to that figure, so
   * replay must not either. Every other command is kept.
   */
  savesCommand(command: Pick<DrawCommand, "type" | "text" | "semanticRef">): boolean {
    if (!this.first || command.type !== "FOCUS") return true;
    const spec = parseFocusSpec(command.semanticRef?.entityId ?? command.text);
    const target = spec.targetIds.length === 1 ? spec.targetIds[0]!.trim() : "";
    if (!isLessonFigureAdvanceId(target) || !this.has(target)) return true;
    return indexOf(target) <= this.index;
  }

  /**
   * The diagram later FOCUS are checked against once the cues so far have
   * played (preparation cursor), from figure 1, forward only.
   */
  diagramAfter(cueIds: readonly string[]): VerifiedDiagram | null {
    if (!this.first) return null;
    let index = -1;
    for (const raw of cueIds) {
      const id = raw.trim();
      if (isLessonFigureAdvanceId(id) && this.has(id) && indexOf(id) > index) index = indexOf(id);
    }
    return index < 0 ? this.first.diagram : this.rest.find((view) => indexOf(view.id) === index)!.diagram;
  }
}

/**
 * The filter a played row's commands pass before it is saved, or undefined
 * when no lesson sequence is active (flag off: the row is saved as before).
 * Read when the row is saved, so a Stop sees the cursor as it stood.
 */
export function savedCommandFilter(
  sequence: LessonFigureSequence | null | undefined,
): ((command: DrawCommand) => boolean) | undefined {
  if (!sequence || !sequence.active()) return undefined;
  return (command) => sequence.savesCommand(command);
}

/**
 * Review F2: an advance a Stop cut part way (zone half erased, or figure k
 * part drawn) is finished before the next turn on the page reads the zone:
 * figure k returned whole at duration 0, as replay stands it from the saved
 * cue. Null when nothing is pending, there is no board, or it was cancelled
 * (it stays pending for the next turn).
 */
export async function finishLessonFigureAdvance(
  wb: ZoneBoard | null,
  layout: BoardLayoutState | null,
  sequence: LessonFigureSequence | null | undefined,
  opts: { shouldCancel?: () => boolean; executeCommand: FigureSwapExecuteCommand },
): Promise<PlannedLessonFigureView | null> {
  const view = sequence?.pendingIntro() ?? null;
  if (!sequence || !view || !wb) return null;
  const result = await returnFigureToZone(wb, layout, view, [], opts);
  if (result.cancelled) return null;
  sequence.advanced(view);
  sequence.introDone(view);
  return view;
}

/** Figure k's intro ink: exactly the commands its intro beats draw (withheld labels stay withheld). */
export function lessonFigureIntroCommands(view: LessonFigurePresentation): DrawCommand[] {
  return view.introSegments.flatMap(getSegmentCommands);
}

/**
 * The prompt's view of a later figure: its id, its kind, and each part's id
 * with the label its intro draws on it. Withheld labels (answers among them)
 * are not drawn by the intro, so they are never listed. No geometry.
 */
export function laterFigurePromptOf(view: PlannedLessonFigureView): LaterFigurePrompt {
  const drawnLabels = new Map<string, string>();
  for (const command of lessonFigureIntroCommands(view)) {
    const id = command.semanticRef?.entityId;
    const text = command.text?.trim();
    if (command.type === "LABEL" && id && text && !drawnLabels.has(id)) drawnLabels.set(id, text);
  }
  return {
    id: view.id,
    kind: view.family ? `a ${describeSceneFamily(view.family)} figure` : null,
    parts: view.diagram.anchors.map((anchor) => ({ id: anchor.id, label: drawnLabels.get(anchor.id) ?? null })),
  };
}

/**
 * Segment preparation with the preparation cursor. `cueIds` holds the
 * advances already kept on this turn and is extended in place, so a stream
 * that prepares one segment at a time carries it from call to call.
 *
 * With no sequence this is `prepareVerifiedLessonSegments` itself, byte for
 * byte. With one, each segment is prepared against the figure the cues before
 * it moved to. A segment carrying an advance is prepared against the figure
 * it moves to, the advance itself exempt from the part check (it names a
 * figure, not a part) and run first, so every command after it in the
 * sentence resolves on the figure the advance draws. The server cursor checks
 * the same way.
 */
export function prepareLessonFigureSegments(
  segments: TutorSegment[],
  staticDiagram: VerifiedDiagram | null,
  sequence: LessonFigureSequence | null,
  cueIds: string[],
): PreparedVerifiedSegments {
  if (!sequence || !sequence.active()) return prepareVerifiedLessonSegments(segments, staticDiagram);
  let blockedCommandCount = 0;
  let droppedSegmentCount = 0;
  const prepared: TutorSegment[] = [];
  for (const segment of segments) {
    const before = sequence.diagramAfter(cueIds);
    let after = cueIds.reduce((index, id) => isLessonFigureAdvanceId(id) && sequence.has(id) ? Math.max(index, indexOf(id)) : index, -1);
    const advances: DrawCommand[] = [];
    for (const command of getSegmentCommands(segment)) {
      const advance = lessonFigureAdvanceOf(command, (id) => sequence.has(id), after);
      if (!advance) continue;
      advances.push(command);
      after = indexOf(advance);
      cueIds.push(advance);
    }
    if (advances.length === 0) {
      const one = prepareVerifiedLessonSegments([segment], before);
      blockedCommandCount += one.blockedCommandCount;
      droppedSegmentCount += one.droppedSegmentCount;
      prepared.push(...one.segments);
      continue;
    }
    // The advances stay in while preparing, so a sentence that tagged its own
    // cue gets no inferred FOCUS; they are blocked there (no part has their
    // id) and put back first.
    const one = prepareVerifiedLessonSegments([segment], sequence.diagramAfter(cueIds));
    blockedCommandCount += one.blockedCommandCount - advances.length;
    const kept = one.segments[0];
    const rest = kept ? getSegmentCommands(kept).filter((command) => !advances.includes(command)) : [];
    const commands = [...advances, ...rest];
    prepared.push({ ...(kept ?? segment), ...(kept ? {} : { narration: "" }), command: commands[0]!, commands });
  }
  const folded = foldWritelessFocusRuns(prepared, staticDiagram);
  return {
    segments: folded.segments,
    blockedCommandCount,
    droppedSegmentCount,
    foldedFocusSegmentCount: folded.foldedFocusSegmentCount,
  };
}
