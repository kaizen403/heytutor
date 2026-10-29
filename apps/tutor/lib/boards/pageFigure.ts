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
 */
import { isStoredCommandTrustedGeometry, parseFocusSpec, parseStoredSegmentCommands } from "@heytutor/drawing";
import type { StoredTurn } from "./boardsClient";
import { BOARD_CONTINUATION_VERSION, storedTurnContinuesBoard } from "./boardContinuation";
import { doubtFigureOf } from "./doubtFigure";

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

/** The FOCUS and ANNOTATE targets a stored turn named, in order. */
export function storedTurnFocusIds(turn: Pick<StoredTurn, "segments">): string[] {
  const ids: string[] = [];
  const segments = [...turn.segments].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const segment of segments) {
    for (const command of parseStoredSegmentCommands(segment.command)) {
      if (command.type !== "FOCUS" && command.type !== "ANNOTATE") continue;
      for (const id of parseFocusSpec(command.semanticRef?.entityId ?? command.text).targetIds) {
        const trimmed = id.trim();
        if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
      }
    }
  }
  return ids;
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
    return { sourceIndex: null, swapIn: false, returnsLesson: false, installsLesson: false, consumedIds: [] };
  }
  const opener = pageOpenerIndex(turns, index);
  const openerSource = storedTurnDrawsLessonFigure(turns[opener]!, true) ? opener : null;

  // The zone's source while each turn of the page plays, opener first. The
  // lesson's source starts at the opener and moves to a resume that drew it.
  let source: number | null = openerSource;
  let lessonSource: number | null = openerSource;
  const sourceDuring: Array<number | null> = [source];
  let swapIn = false;
  let returnsLesson = false;
  let installsLesson = false;
  for (let at = opener + 1; at <= index; at += 1) {
    const turn = turns[at]!;
    const before = source;
    let installs = false;
    if (storedTurnSwapsFigureIn(turn)) {
      source = at;
    } else if (storedTurnDrawsLessonFigure(turn, false)) {
      lessonSource = at;
      source = at;
      installs = true;
    } else if (turn.kind === "resume") {
      source = lessonSource;
    }
    sourceDuring.push(source);
    if (at === index) {
      installsLesson = installs;
      swapIn = !installs && source === at;
      returnsLesson = !swapIn && !installs && turn.kind === "resume" && before !== source;
    }
  }

  const consumedIds: string[] = [];
  if (source !== null) {
    for (let at = opener; at < index; at += 1) {
      if (sourceDuring[at - opener] !== source) continue;
      for (const id of storedTurnFocusIds(turns[at]!)) {
        if (!consumedIds.includes(id)) consumedIds.push(id);
      }
    }
  }
  return { sourceIndex: source, swapIn, returnsLesson, installsLesson, consumedIds };
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
): { sourceIndex: number | null; consumedIds: string[] } | null {
  if (turns.length === 0) return null;
  const resume: PageFigureTurn = {
    kind: "resume",
    sceneArtifacts: { boardContinuation: { schemaVersion: BOARD_CONTINUATION_VERSION, lessonQuestion: "" } },
    segments: [],
    sceneDocument: null,
    visualStatus: "text_only",
  };
  const at = pageFigureAt([...turns, resume], turns.length);
  return at.returnsLesson ? { sourceIndex: at.sourceIndex, consumedIds: at.consumedIds } : null;
}
