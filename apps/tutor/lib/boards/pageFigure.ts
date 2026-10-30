/**
 * Which stored turn's figure stands in the diagram zone while a turn plays.
 *
 * A page opens with its lesson's figure. A doubt that drew its own figure
 * (DIAGRAM_DOUBT_FIGURES, `doubtFigure.ts`) swaps that figure out of the zone;
 * the lesson's resume brings it back. A doubt without a figure of its own
 * points at whatever stands in the zone. Replay, restore and export all ask
 * this one pure function, so no surface draws the doubt's figure over the
 * lesson's or leaves the lesson's figure off after the resume.
 *
 * `consumedIds` are the FOCUS and ANNOTATE targets of the earlier turns that
 * pointed at the figure now in the zone. Replaying them through
 * `takeDeferredAnnotations` on a freshly built presentation gives the deferred
 * state the live object had, so a returned figure never letters a label twice.
 *
 * The lesson's figure is not always the opener's. A Stop or doubt before the
 * figure's first beat saves the opener as text only, and the resume draws the
 * whole figure from its own trusted rows. That resume installs the lesson's
 * figure (`installsLesson`) and is its source from then on.
 *
 * A lesson may also move to a later figure of its own (DIAGRAM_LESSON_FIGURES):
 * a kept `[FOCUS:figure_k]` in a lesson-owned turn (opener or resume, never a
 * doubt) puts figure k of the lesson's source in the zone, forward only. The
 * zone is then `(sourceIndex, figureId)`, and `consumedIds` are only the ids
 * released while that pair stood in the zone.
 */
import { isStoredCommandTrustedGeometry, parseFocusSpec, parseStoredSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import type { StoredTurn } from "./boardsClient";
import { BOARD_CONTINUATION_VERSION, storedTurnContinuesBoard } from "./boardContinuation";
import { doubtFigureOf } from "./doubtFigure";
import { LESSON_FIGURE_IDS, isLessonFigureAdvanceId, lessonFiguresOf, type LessonFigureId } from "./lessonFigures";

/** Figure 1 is the turn's own scene; figure_2 and figure_3 are its later lesson figures. */
export type PageFigureId = "figure_1" | LessonFigureId;

export type PageFigureTurn = Pick<StoredTurn, "sceneArtifacts" | "segments" | "sceneDocument" | "visualStatus"> &
  Partial<Pick<StoredTurn, "kind">>;

export interface PageFigureAt {
  /** Index of the turn whose figure is in the zone while turns[index] plays; null when the zone is empty. */
  sourceIndex: number | null;
  /** turns[index] draws its own figure: the zone must be cleared before its intro. */
  swapIn: boolean;
  /** turns[index] is a resume that brings the lesson's figure back into the zone. */
  returnsLesson: boolean;
  /** turns[index] is a resume whose own rows draw the lesson's figure: it becomes the figure's source. */
  installsLesson: boolean;
  /** FOCUS / ANNOTATE targets earlier turns released on that figure, in first use order. */
  consumedIds: string[];
  /** Which of sourceIndex's figures stands in the zone when turns[index] starts: figure_1 unless the lesson advanced. */
  figureId: PageFigureId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A turn that opened a page with a figure: a validated scene or a stored reference picture. */
function opensWithFigure(turn: PageFigureTurn): boolean {
  if (turn.visualStatus === "validated" && turn.sceneDocument) return true;
  return isRecord(turn.sceneArtifacts) && isRecord(turn.sceneArtifacts.referencePicture);
}

/** A turn carries the lesson's figure: a validated scene or a stored reference picture. */
function hasLessonFigure(turn: PageFigureTurn): boolean {
  return opensWithFigure(turn);
}

/**
 * A turn of the lesson (opener or resume, never a doubt) whose saved rows drew
 * the lesson's figure. A resume only counts when its own trusted rows drew it:
 * every resume carries the lesson's scene, but only the one that first drew
 * the figure (its opener was saved text only) has the ink.
 */
export function storedTurnDrawsLessonFigure(turn: PageFigureTurn, isOpener: boolean): boolean {
  if (isOpener) return opensWithFigure(turn);
  return turn.kind === "resume" &&
    doubtFigureOf(turn.sceneArtifacts) === null &&
    hasLessonFigure(turn) &&
    turn.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command));
}

/** A continuation that drew its own verified figure in the zone. */
export function storedTurnSwapsFigureIn(turn: PageFigureTurn): boolean {
  return storedTurnContinuesBoard(turn) &&
    doubtFigureOf(turn.sceneArtifacts) !== null &&
    turn.visualStatus === "validated" &&
    Boolean(turn.sceneDocument);
}

/** A stored turn's commands, row by row, in order. */
function storedTurnCommands(turn: Pick<StoredTurn, "segments">): DrawCommand[] {
  const segments = [...turn.segments].sort((a, b) => a.orderIndex - b.orderIndex);
  return segments.flatMap((segment) => parseStoredSegmentCommands(segment.command));
}

/** The FOCUS / ANNOTATE targets of one command. */
function commandTargetIds(command: DrawCommand): string[] {
  if (command.type !== "FOCUS" && command.type !== "ANNOTATE") return [];
  return parseFocusSpec(command.semanticRef?.entityId ?? command.text).targetIds
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** The FOCUS and ANNOTATE targets a stored turn named, in order. */
export function storedTurnFocusIds(turn: Pick<StoredTurn, "segments">): string[] {
  const ids: string[] = [];
  for (const command of storedTurnCommands(turn)) {
    for (const id of commandTargetIds(command)) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * The later figure a stored command moves the lesson to, or null. The same
 * rule as the live sequence and the server cursor: a FOCUS with exactly one
 * target, an advance id the lesson source stores, strictly after `current`.
 */
function storedAdvanceOf(command: DrawCommand, stored: readonly LessonFigureId[], current: PageFigureId): LessonFigureId | null {
  if (command.type !== "FOCUS" || stored.length === 0) return null;
  const targets = parseFocusSpec(command.semanticRef?.entityId ?? command.text).targetIds;
  const target = targets.length === 1 ? targets[0]!.trim() : "";
  if (!isLessonFigureAdvanceId(target) || !stored.includes(target)) return null;
  const currentIndex = current === "figure_1" ? -1 : LESSON_FIGURE_IDS.indexOf(current);
  return LESSON_FIGURE_IDS.indexOf(target) > currentIndex ? target : null;
}

/** Index of the turn that opened the page turns[index] is on. */
function pageOpenerIndex(turns: readonly PageFigureTurn[], index: number): number {
  let opener = index;
  while (opener > 0 && storedTurnContinuesBoard(turns[opener]!)) opener -= 1;
  return opener;
}

/** Which stored turn's figure is in the zone while turns[index] plays. */
export function pageFigureAt(turns: readonly PageFigureTurn[], index: number): PageFigureAt {
  if (!Number.isInteger(index) || index < 0 || index >= turns.length) {
    return { sourceIndex: null, swapIn: false, returnsLesson: false, installsLesson: false, consumedIds: [], figureId: "figure_1" };
  }
  const opener = pageOpenerIndex(turns, index);
  const openerSource = storedTurnDrawsLessonFigure(turns[opener]!, true) ? opener : null;
  const storedIds = (at: number | null): LessonFigureId[] =>
    at === null ? [] : lessonFiguresOf(turns[at]!.sceneArtifacts)?.figures.map((figure) => figure.id) ?? [];

  // The zone while each turn of the page plays, opener first: the source turn
  // and which of its figures. The lesson's source starts at the opener and
  // moves to a resume that drew it; its figure moves forward at each advance.
  let source: number | null = openerSource;
  let lessonSource: number | null = openerSource;
  let lessonFigure: PageFigureId = "figure_1";
  let figureId: PageFigureId = "figure_1";
  let swapIn = false;
  let returnsLesson = false;
  let installsLesson = false;
  // Each id an earlier turn released, with the zone it was released on.
  const released: Array<{ source: number | null; figureId: PageFigureId; id: string }> = [];
  for (let at = opener; at <= index; at += 1) {
    const turn = turns[at]!;
    if (at > opener) {
      const before = source;
      let installs = false;
      if (storedTurnSwapsFigureIn(turn)) {
        source = at;
        figureId = "figure_1";
      } else if (storedTurnDrawsLessonFigure(turn, false)) {
        lessonSource = at;
        lessonFigure = "figure_1";
        source = at;
        figureId = "figure_1";
        installs = true;
      } else if (turn.kind === "resume") {
        source = lessonSource;
        figureId = lessonFigure;
      }
      if (at === index) {
        installsLesson = installs;
        swapIn = !installs && source === at;
        returnsLesson = !swapIn && !installs && turn.kind === "resume" && before !== source;
      }
    }
    if (at === index) break;
    const lessonOwned = at === opener || turn.kind === "resume";
    const stored = lessonOwned && source !== null && source === lessonSource ? storedIds(lessonSource) : [];
    for (const command of storedTurnCommands(turn)) {
      const advance = storedAdvanceOf(command, stored, lessonFigure);
      if (advance) {
        lessonFigure = advance;
        figureId = advance;
        continue;
      }
      for (const id of commandTargetIds(command)) released.push({ source, figureId, id });
    }
  }

  const consumedIds: string[] = [];
  if (source !== null) {
    for (const entry of released) {
      if (entry.source !== source || entry.figureId !== figureId) continue;
      if (!consumedIds.includes(entry.id)) consumedIds.push(entry.id);
    }
  }
  return { sourceIndex: source, swapIn, returnsLesson, installsLesson, consumedIds, figureId };
}

/**
 * Index of the newest lesson-owned turn in [opener, upTo] whose rows drew the
 * lesson's figure, or null when no lesson turn of the page drew it.
 */
export function lessonFigureSourceAt(turns: readonly PageFigureTurn[], upTo: number): number | null {
  if (!Number.isInteger(upTo) || upTo < 0 || upTo >= turns.length) return null;
  const opener = pageOpenerIndex(turns, upTo);
  for (let at = upTo; at > opener; at -= 1) {
    if (storedTurnDrawsLessonFigure(turns[at]!, false)) return at;
  }
  return storedTurnDrawsLessonFigure(turns[opener]!, true) ? opener : null;
}

/**
 * What a resume after the last saved turn must bring back: the lesson's
 * figure (the opener's, or the resume's that drew it) and the ids its earlier turns released, when a doubt's own figure
 * stands in the zone. Null when the zone already holds the lesson's figure.
 * A reloaded board has no live zone stash; this is its stash.
 */
export function lessonFigureReturnAfter(
  turns: readonly PageFigureTurn[],
): { sourceIndex: number | null; consumedIds: string[]; figureId: PageFigureId } | null {
  if (turns.length === 0) return null;
  const resume: PageFigureTurn = {
    kind: "resume",
    sceneArtifacts: { boardContinuation: { schemaVersion: BOARD_CONTINUATION_VERSION, lessonQuestion: "" } },
    segments: [],
    sceneDocument: null,
    visualStatus: "text_only",
  };
  const at = pageFigureAt([...turns, resume], turns.length);
  return at.returnsLesson ? { sourceIndex: at.sourceIndex, consumedIds: at.consumedIds, figureId: at.figureId } : null;
}
