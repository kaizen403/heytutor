/**
 * Later figures inside one lesson, live (DIAGRAM_LESSON_FIGURES, phase 3b).
 *
 * The `DsaFrameController` analogue, one per page: figure 1 is the lesson's
 * own verified figure; figure_2 and figure_3 were planned offline by
 * `planLessonFigures` from the engine's fast selector. The teaching stream
 * moves to one with `[FOCUS:figure_k]`, forward only. It names a figure; the
 * runtime draws that figure's verified intro, never anything the model wrote.
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

export class LessonFigureSequence {
  private first: LessonFigurePresentation | null = null;
  private rest: PlannedLessonFigureView[] = [];
  private index = -1;
  private hooks: LessonFigureSequenceHooks = {};

  commit(first: LessonFigurePresentation, rest: readonly PlannedLessonFigureView[], hooks: LessonFigureSequenceHooks = {}): void {
    this.first = first;
    this.rest = [...rest].sort((a, b) => indexOf(a.id) - indexOf(b.id));
    this.index = -1;
    this.hooks = hooks;
  }

  reset(): void {
    this.first = null;
    this.rest = [];
    this.index = -1;
    this.hooks = {};
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

  /** Forward only: returns the figure to draw, or null when id is not strictly after the current one. */
  advanceTo(id: LessonFigureId): PlannedLessonFigureView | null {
    if (!this.first) return null;
    const view = this.rest.find((candidate) => candidate.id === id);
    if (!view || indexOf(id) <= this.index) return null;
    if (this.hooks.mayAdvance && !this.hooks.mayAdvance(id)) return null;
    this.index = indexOf(id);
    return view;
  }

  /** Tell the page the zone now holds `view`. */
  advanced(view: PlannedLessonFigureView): void {
    this.hooks.onAdvanced?.(view);
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

/** Figure k's intro ink: exactly the commands its intro beats draw (withheld labels stay withheld). */
export function lessonFigureIntroCommands(view: LessonFigurePresentation): DrawCommand[] {
  return view.introSegments.flatMap(getSegmentCommands);
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
