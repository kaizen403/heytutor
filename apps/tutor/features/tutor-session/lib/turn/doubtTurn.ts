/**
 * A doubt is answered on the page it was asked on.
 *
 * The student circles a line, asks, and watches the tutor think over the same
 * board. The answer is written under what is already there, and the board only
 * turns a page when the work column runs out, the way it does in any long
 * lesson. The doubt used to run as a brand new question: `beginBoardEpoch`
 * wiped the page, the figure was dropped, the whole planning pipeline ran again
 * on the composed prompt, and the lesson restarted from its givens.
 *
 * This is the pure half of the doubt turn: what it may assume about the page,
 * what must be saved before it so replay and a reload put it on the right page,
 * and what its answer may draw.
 */
import {
  getSegmentCommands,
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { CodeLessonPlan } from "@heytutor/tutor-core";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import type {
  RecordedSegmentPayload,
  SceneVisualStatus,
  StoredTurn,
} from "@/lib/boards/boardsClient";
import {
  boardContinuationArtifacts,
  boardContinuationOf,
  pageTurnsEndingAt,
  storedTurnContinuesBoard,
  storedTurnPageQuestion,
} from "@/lib/boards/boardContinuation";
import {
  doubtFigureRefArtifacts,
  doubtFigureRefOf,
  DOUBT_FIGURE_REF_VERSION,
  type DoubtFigureKind,
  type DoubtFigureRef,
  type DoubtPointingPolicy,
} from "@/lib/boards/doubtFigureRef";

import { doubtFigureArtifacts, doubtFigureOf } from "@/lib/boards/doubtFigure";
import type { LessonFigureId } from "@/lib/boards/lessonFigures";

import type { DoubtBoardRow } from "./turnTeachingPrompt";
import type { DiagramStrategy } from "../scene/diagramStrategy";
import { classifyEarlyLessonProgress, type EarlyLessonSpokenSegment } from "./earlyLessonOpening";
import {
  isReferencePictureDiagram,
  isReferencePictureRow,
  pointsAtReferencePicture,
  readStoredReferencePicture,
  referencePictureIdOf,
  referencePicturePointables,
} from "../scene/referencePicturePresentation";
import type { FailedTurnTelemetry } from "@/lib/obs/failedTurnTelemetry";

/** A lesson opens a page; a doubt answers on it; a resume continues after that. */
export type PageTurnKind = "lesson" | "doubt" | "resume";

/** The scene fields a turn is saved with. */
export interface PersistedTurnScene {
  sceneDocument: unknown | null;
  sceneEngineVersion: string | null;
  validationReport: unknown | null;
  visualStatus: SceneVisualStatus | null;
  sceneArtifacts: unknown | null;
}

/**
 * The page on the board right now, and the turn teaching on it.
 *
 * Lives in a ref beside the other live turn buffers. A doubt reads it to decide
 * whether it continues a saved page, whether the turn it stopped left unsaved
 * ink that must be saved first, which figure is really drawn, and which plan
 * the lesson's numbers came from.
 */
export interface BoardPageRecord {
  boardId: string;
  /** The question the page belongs to: the lesson, never a doubt about it. */
  lessonQuestion: string;
  /** Runtime-only: a pre-authority acknowledgement is not taught work. */
  earlyOpeningStarted?: boolean;
  /** Content-free diagnostics attached to saves, without affecting page/scene ownership. */
  failureTelemetry?: FailedTurnTelemetry;
  /** Teaching context a doubt on this page reuses instead of planning again. */
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  /** The verified figure's intro committed: its ink is on the page, not merely planned. */
  figureDrawn: boolean;
  /**
   * Checkpoint id of the turn whose figure is in the zone: set when a turn's
   * figure commits, copied onto the doubt record that replaces it. Absent or
   * null when this tab did not see the figure drawn (a restored board).
   */
  figureTurnId?: string | null;
  /**
   * Set while a doubt's own figure stands in the zone: the lesson figure it
   * replaced, returned when the lesson resumes (DIAGRAM_DOUBT_FIGURES).
   * `presentation` is what returnPageFigure redraws. A null `diagram`: the
   * zone stood empty, and the resume clears it again.
   */
  zoneStash?: import("../scene/figureSwap").ZoneStash | null;
  /**
   * The lesson's later figure in the zone (DIAGRAM_LESSON_FIGURES), set when
   * `[FOCUS:figure_k]` drew it; absent while figure 1 stands.
   */
  lessonFigureId?: import("@/lib/boards/lessonFigures").LessonFigureId | null;
  /** The turn teaching on this page now, or the last one that did. */
  turn: {
    kind: PageTurnKind;
    /** What the turn is saved as. */
    question: string;
    /** Saved without the runtime CLEAR, onto the page a saved turn left. */
    continuesBoard: boolean;
    /** Scene the turn is saved with. Null until a lesson has finished planning. */
    scene: PersistedTurnScene | null;
    /** On the board's saved turns, whole or as the part taught before a doubt stopped it. */
    saved: boolean;
  };
}

export function textOnlyTurnScene(diagramStrategy?: DiagramStrategy): PersistedTurnScene {
  return {
    sceneDocument: null,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: "text_only",
    sceneArtifacts: diagramStrategy ? { diagramStrategy } : null,
  };
}

/** A lesson takes a fresh page. Its scene and plan are filled in once planned. */
export function lessonPageRecord(boardId: string, question: string): BoardPageRecord {
  return {
    boardId,
    lessonQuestion: question,
    turnPlan: null,
    solverProjection: null,
    figureDrawn: false,
    figureTurnId: null,
    turn: { kind: "lesson", question, continuesBoard: false, scene: null, saved: false },
  };
}

/**
 * A doubt is text on the page it continues. Its FOCUS names figure parts an
 * earlier turn's saved scene owns. The marker keeps it on the lesson's page;
 * `pointsAtFigure` names the turn whose figure was in the zone, so the server
 * can check the doubt's pointing against that figure and keep what resolves.
 * Without the reference, or one the server cannot resolve, the doubt keeps its
 * rows and boxes and drops its pointing, as before.
 */
export function doubtTurnScene(
  lessonQuestion: string,
  continuesBoard: boolean,
  diagramStrategy?: DiagramStrategy,
  pointsAtFigure?: DoubtFigureRef | null,
): PersistedTurnScene {
  const ref = continuesBoard && pointsAtFigure ? doubtFigureRefOf(doubtFigureRefArtifacts(pointsAtFigure)) : null;
  return {
    ...textOnlyTurnScene(diagramStrategy),
    sceneArtifacts: continuesBoard
      ? {
          ...boardContinuationArtifacts(lessonQuestion),
          ...(ref ? doubtFigureRefArtifacts(ref) : {}),
          ...(diagramStrategy ? { diagramStrategy } : {}),
        }
      : diagramStrategy ? { diagramStrategy } : null,
  };
}

/**
 * A doubt that drew its own figure (DIAGRAM_DOUBT_FIGURES) is saved as its own
 * validated scene, on the lesson's page: the scene the doubt planned and
 * verified on the composed question, plus the continuation marker and the
 * doubt figure marker naming the figure it replaced. It points at its own
 * figure, so no `pointsAtFigure` rides with it. Lane C sets the doubt record's
 * `turn.scene` to this once the doubt's figure is selected.
 */
export function doubtFigureTurnScene(
  scene: PersistedTurnScene,
  lessonQuestion: string,
  replacedTurnId: string | null,
): PersistedTurnScene {
  const artifacts = isRecord(scene.sceneArtifacts) ? { ...scene.sceneArtifacts } : {};
  delete artifacts.pointsAtFigure;
  return {
    ...scene,
    sceneArtifacts: {
      ...artifacts,
      ...boardContinuationArtifacts(lessonQuestion),
      ...doubtFigureArtifacts(replacedTurnId),
    },
  };
}

/** The doubt's own validated figure scene, when the record holds one. */
export function doubtOwnFigureScene(record: Pick<BoardPageRecord, "turn"> | null | undefined): PersistedTurnScene | null {
  const scene = record?.turn.kind === "doubt" && record.turn.continuesBoard ? record.turn.scene : null;
  if (!scene || scene.visualStatus !== "validated" || !scene.sceneDocument) return null;
  if (!doubtFigureOf(scene.sceneArtifacts) || !boardContinuationOf(scene.sceneArtifacts)) return null;
  return scene;
}

/**
 * The scene a doubt with its own figure is saved with. Its figure is saved
 * only once its intro committed (`figureDrawn`, set by enqueueVerifiedIntro
 * after the swap cleared it); before that the doubt is text on the page,
 * pointing at nothing, since the zone stood empty.
 */
export function doubtFigureSaveScene(record: BoardPageRecord, textOnly = false): PersistedTurnScene | null {
  const scene = doubtOwnFigureScene(record);
  if (!scene) return null;
  if (record.figureDrawn && !textOnly) return scene;
  return doubtTurnScene(record.lessonQuestion, true, undefined, null);
}

export function doubtPageRecord(input: {
  boardId: string;
  lessonQuestion: string;
  title: string;
  continuesBoard: boolean;
  figureDrawn: boolean;
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  /** The record this doubt replaces (`boardPageRef.current`): its figure turn carries over. */
  replaces?: BoardPageRecord | null;
  /** `doubtFigureRefFor`: the figure this doubt may point at, saved with it. */
  pointsAtFigure?: DoubtFigureRef | null;
}): BoardPageRecord {
  const replaced = input.replaces?.boardId === input.boardId ? input.replaces : null;
  return {
    boardId: input.boardId,
    lessonQuestion: input.lessonQuestion,
    turnPlan: input.turnPlan,
    solverProjection: input.solverProjection,
    figureDrawn: input.figureDrawn,
    figureTurnId: input.continuesBoard
      ? replaced?.figureTurnId ?? input.pointsAtFigure?.turnId ?? null
      : null,
    turn: {
      kind: "doubt",
      question: input.title,
      continuesBoard: input.continuesBoard,
      scene: doubtTurnScene(input.lessonQuestion, input.continuesBoard, undefined, input.pointsAtFigure),
      saved: false,
    },
  };
}

/** Which kind of figure is in the zone, judged from the diagram the board holds. */
function activeFigureKind(diagram: VerifiedDiagram): DoubtFigureKind {
  if (diagram.layout === "code_lesson") return "dsa_frame";
  if (isReferencePictureDiagram(diagram)) return "reference_picture";
  return "verified_scene";
}

/** The figure kind a saved turn holds, or null when it saved none. */
function storedFigureKind(turn: Pick<StoredTurn, "visualStatus" | "sceneArtifacts">): DoubtFigureKind | null {
  if (referencePictureIdOf(turn.sceneArtifacts) && readStoredReferencePicture(turn.sceneArtifacts)) {
    return "reference_picture";
  }
  if (turn.visualStatus !== "validated") return null;
  return isRecord(turn.sceneArtifacts) && isRecord(turn.sceneArtifacts.codeLesson) ? "dsa_frame" : "verified_scene";
}

/**
 * The figure a doubt points at, saved on it as `sceneArtifacts.pointsAtFigure`.
 *
 * Null unless the doubt continues a page with a figure drawn on it and was not
 * asked over a replay (whose page is not the last saved one). The live record
 * names the turn whose figure committed in this tab; on a restored board there
 * is no such record, and the figure is the newest saved turn on the last page
 * that holds a validated scene or a stored picture. The server checks the
 * reference again before it keeps any pointing, so a wrong guess here loses
 * the pointing, never the doubt.
 */
export function doubtFigureRefFor(input: {
  record: BoardPageRecord | null;
  boardId: string;
  afterReplay: boolean;
  figureOnPage: boolean;
  storedTurns: readonly StoredTurn[];
  activeDiagram: VerifiedDiagram | null;
  codeLessonFrameIndex: number | null;
  /** `lessonFigureIdInZone`: the lesson's later figure in the zone, or null for its own figure. */
  lessonFigureId?: LessonFigureId | null;
}): DoubtFigureRef | null {
  if (input.afterReplay || !input.figureOnPage || !input.activeDiagram) return null;
  const kind = activeFigureKind(input.activeDiagram);
  let frameIndex: number | undefined;
  if (kind === "dsa_frame") {
    const index = input.codeLessonFrameIndex;
    if (index === null || !Number.isInteger(index) || index < 0) return null;
    frameIndex = index;
  }
  const build = (turnId: string): DoubtFigureRef | null => doubtFigureRefOf(doubtFigureRefArtifacts({
    schemaVersion: DOUBT_FIGURE_REF_VERSION,
    turnId,
    kind,
    ...(frameIndex !== undefined ? { frameIndex } : {}),
    ...(kind === "verified_scene" && input.lessonFigureId ? { figureId: input.lessonFigureId } : {}),
  }));
  const record = input.record?.boardId === input.boardId ? input.record : null;
  if (record?.figureTurnId) return build(record.figureTurnId);
  // A live lesson that opened a fresh page and committed no figure in this tab:
  // the saved turns end on the page before, whose figure is not in the zone.
  if (record && !record.turn.continuesBoard) return null;
  const page = pageTurnsEndingAt(input.storedTurns);
  for (let index = page.length - 1; index >= 0; index -= 1) {
    const turn = page[index]!;
    const stored = storedFigureKind(turn);
    if (!stored) continue;
    if (stored !== kind) return null;
    if (record && storedTurnPageQuestion(turn).trim() !== record.lessonQuestion.trim()) return null;
    return build(turn.id);
  }
  return null;
}

/**
 * Why the lesson is paused. "stop": the student pressed Stop (or left) and has
 * come back. "doubt": a doubt on this board was answered after the lesson
 * stopped. The resume prompt must not claim a doubt it never saw.
 */
export type PausedLessonReason = "stop" | "doubt";

/**
 * What a stopped lesson must hand back so it can continue on the same page:
 * after a doubt, after a plain Stop, or after a reload.
 */
export interface PausedLessonRequest {
  /** The board this lecture was paused on. A later board must not resume it. */
  boardId: string;
  reason: PausedLessonReason;
  /**
   * Trace of the turn that stopped, for billing lineage only. The resume saves
   * under a trace of its own (one turn per trace).
   */
  parentTraceId?: string | null;
  /** Exact saved chain identity for a fresh continuation admission. */
  parentTurnId?: string;
  lessonQuestion: string;
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  scene: PersistedTurnScene | null;
  figureDrawn: boolean;
  /** A code lesson was on the board; the panel and frames stay. */
  codeLesson: boolean;
  /** Notebook rows at the moment the doubt interrupted, before any page turn. */
  lessonBoardRows?: readonly DoubtBoardRow[];
  /** The last lesson idea the student heard, for resuming at the next step. */
  interruptedStep?: string;
  /**
   * Figure intro beats Stop cut off before they were drawn (live only: a
   * reloaded board has the whole figure, the server completes the intro of the
   * stopped turn). Continue draws them first and never saves them, so the
   * figure is not stored twice. Only set when `figureDrawn`.
   */
  remainingIntro?: readonly TutorSegment[];
  /**
   * A reloaded board whose zone holds a doubt's own figure: the stored turn
   * whose figure the resume returns (`turnId` null: the zone empties) and the
   * ids earlier turns released on it. The live board uses `zoneStash`.
   */
  returnsFigure?: { turnId: string | null; consumedIds: string[]; figureId?: import("@/lib/boards/lessonFigures").LessonFigureId };
}

/**
 * The scene the rest of a lesson is saved with: the lesson's own scene plus the
 * board continuation marker, so a reload, replay, the notes and the export keep
 * it on the lesson's page. Without the marker the server rebuilt the whole
 * figure intro into the resume and every surface drew the figure twice.
 */
export function resumeTurnScene(
  scene: PersistedTurnScene | null,
  lessonQuestion: string,
): PersistedTurnScene {
  const base = scene ?? textOnlyTurnScene();
  const artifacts = isRecord(base.sceneArtifacts) ? base.sceneArtifacts : {};
  return {
    ...base,
    sceneArtifacts: { ...artifacts, ...boardContinuationArtifacts(lessonQuestion) },
  };
}

/**
 * The rest of a paused lesson, saved onto the page the doubt just answered on.
 * Same figure, same plan, no CLEAR.
 */
export function resumePageRecord(input: {
  boardId: string;
  lessonQuestion: string;
  figureDrawn: boolean;
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  scene: PersistedTurnScene | null;
}): BoardPageRecord {
  return {
    boardId: input.boardId,
    lessonQuestion: input.lessonQuestion,
    turnPlan: input.turnPlan,
    solverProjection: input.solverProjection,
    figureDrawn: input.figureDrawn,
    turn: {
      kind: "lesson",
      question: input.lessonQuestion,
      continuesBoard: true,
      scene: resumeTurnScene(input.scene, input.lessonQuestion),
      saved: false,
    },
  };
}

/**
 * Snapshot the page a doubt is about to stop, so the lecture can continue from
 * it. A doubt's own page record is text-only and must not replace a lesson
 * snapshot that already holds the figure.
 */
export function pausedLessonFromPage(
  record: BoardPageRecord | null,
  codeLesson: boolean,
  reason: PausedLessonReason = "doubt",
): PausedLessonRequest | null {
  if (!record) return null;
  const lessonQuestion = record.lessonQuestion.trim();
  if (!lessonQuestion) return null;
  return {
    boardId: record.boardId,
    reason,
    lessonQuestion,
    turnPlan: record.turnPlan,
    solverProjection: record.solverProjection,
    scene: record.turn.kind === "lesson" ? record.turn.scene : null,
    // A doubt's own figure is not the lesson's: the lesson's was drawn when
    // the doubt stashed it from the zone. A doubt that drew on an empty zone
    // stashed nothing drawn.
    figureDrawn: doubtOwnFigureScene(record) ? Boolean(record.zoneStash?.diagram) : record.figureDrawn,
    codeLesson,
  };
}

/**
 * Snapshot a lesson a doubt is about to stop, even when the page record is not
 * ready yet (a doubt asked during planning). Without this the lecture cannot
 * continue after the doubt, because there is nothing to hand back.
 */
export function pausedLessonFromLive(input: {
  record: BoardPageRecord | null;
  boardId: string;
  lessonQuestion: string;
  codeLesson: boolean;
  figureDrawn: boolean;
  lessonBoardRows?: readonly DoubtBoardRow[];
  interruptedStep?: string;
  spokenSegments?: readonly EarlyLessonSpokenSegment[];
  /** Defaults to "doubt": the doubt that stopped the lesson is answered first. */
  reason?: PausedLessonReason;
  parentTraceId?: string | null;
  /** Exact saved chain identity for a fresh continuation admission. */
  parentTurnId?: string;
  remainingIntro?: readonly TutorSegment[];
}): PausedLessonRequest | null {
  if (input.record?.earlyOpeningStarted && !input.record.turnPlan &&
    !input.codeLesson && !input.record.figureDrawn && !input.figureDrawn &&
    classifyEarlyLessonProgress({
      earlyOpeningStarted: true, spokenSegments: input.spokenSegments ?? [],
      activeNarration: input.interruptedStep, figureDrawn: false,
    }) !== "substantive") return null;
  const reason = input.reason ?? "doubt";
  const fromPage = pausedLessonFromPage(input.record, input.codeLesson, reason);
  if (fromPage) {
    const figureDrawn = fromPage.figureDrawn || input.figureDrawn;
    return {
      ...fromPage,
      boardId: fromPage.boardId || input.boardId,
      parentTraceId: input.parentTraceId ?? null,
      figureDrawn,
      codeLesson: fromPage.codeLesson || input.codeLesson,
      lessonBoardRows: input.lessonBoardRows ?? fromPage.lessonBoardRows,
      interruptedStep: input.interruptedStep ?? fromPage.interruptedStep,
      ...(figureDrawn && input.remainingIntro?.length ? { remainingIntro: input.remainingIntro } : {}),
    };
  }
  const lessonQuestion = input.lessonQuestion.trim();
  if (!lessonQuestion || !input.boardId) return null;
  return {
    boardId: input.boardId,
    reason,
    parentTraceId: input.parentTraceId ?? null,
    lessonQuestion,
    turnPlan: null,
    solverProjection: null,
    scene: null,
    figureDrawn: input.figureDrawn,
    codeLesson: input.codeLesson,
    lessonBoardRows: input.lessonBoardRows,
    interruptedStep: input.interruptedStep,
  };
}

/** A resume this tab is teaching, and the page record it started from. */
export interface ActiveResume {
  request: PausedLessonRequest;
  pageBefore: BoardPageRecord | null;
}

/**
 * What a plain Stop leaves to continue (decision 3: offered, never automatic).
 *
 * A lesson is resumable once it taught something: a finished row, the row Stop
 * cut off, or figure ink. A resume is always resumable again, since the lesson
 * it continues is still unfinished; stopped before it drew anything, it hands
 * back the request it started from. A doubt is never a lesson to continue: the
 * lesson it interrupted keeps its own offer.
 */
export function pausedLessonOnStop(input: {
  record: BoardPageRecord | null;
  boardId: string;
  activeResume: ActiveResume | null;
  taught: boolean;
  liveQuestion: string;
  codeLesson: boolean;
  lessonBoardRows: readonly DoubtBoardRow[];
  interruptedStep: string;
  spokenSegments?: readonly EarlyLessonSpokenSegment[];
  parentTraceId: string | null;
  /** Figure beats still to draw: undefined when unknown, [] when none. */
  remainingIntro?: readonly TutorSegment[];
}): PausedLessonRequest | null {
  if (!input.boardId) return null;
  const record = input.record?.boardId === input.boardId ? input.record : null;
  const resume = input.activeResume?.request.boardId === input.boardId ? input.activeResume : null;
  if (resume) {
    const resumePage =
      record &&
      record !== resume.pageBefore &&
      record.turn.kind === "lesson" &&
      record.turn.continuesBoard &&
      record.lessonQuestion.trim() === resume.request.lessonQuestion.trim()
        ? record
        : null;
    if (!resumePage || !input.taught) {
      // `remainingIntro` undefined: this turn never started the figure's
      // missing beats, so the request still owes them; [] means it drew them.
      const { remainingIntro: owed, ...request } = resume.request;
      const remainingIntro = input.remainingIntro ?? owed;
      return {
        ...request,
        ...(request.figureDrawn && remainingIntro?.length ? { remainingIntro } : {}),
      };
    }
    return pausedLessonFromLive({
      record: resumePage,
      boardId: input.boardId,
      lessonQuestion: resume.request.lessonQuestion,
      codeLesson: input.codeLesson || resume.request.codeLesson,
      figureDrawn: false,
      lessonBoardRows: input.lessonBoardRows,
      interruptedStep: input.interruptedStep.trim() || resume.request.interruptedStep,
      spokenSegments: input.spokenSegments,
      reason: "stop",
      parentTraceId: input.parentTraceId ?? resume.request.parentTraceId ?? null,
      remainingIntro: input.remainingIntro,
    });
  }
  if (!record || record.turn.kind !== "lesson" || !input.taught) return null;
  return pausedLessonFromLive({
    record,
    boardId: input.boardId,
    lessonQuestion: input.liveQuestion,
    codeLesson: input.codeLesson,
    // Only ink counts: a figure planned but never drawn is redrawn on Continue.
    figureDrawn: false,
    lessonBoardRows: input.lessonBoardRows,
    interruptedStep: input.interruptedStep.trim() || undefined,
    spokenSegments: input.spokenSegments,
    reason: "stop",
    parentTraceId: input.parentTraceId,
    remainingIntro: input.remainingIntro,
  });
}

export interface DoubtPagePlan {
  /** Save the doubt without a CLEAR: the page it answers on is already saved. */
  continuesBoard: boolean;
  /** The turn this doubt stopped was never saved and left ink: save that part first. */
  savePartialTurn: boolean;
  /** The committed figure is drawn on the page, so the doubt may point at it. */
  figureOnPage: boolean;
}

/**
 * What a doubt may assume about the page in front of the student.
 *
 * Without a live record for this board (a restored board, or one a replay has
 * redrawn) the page is whatever the saved turns drew, and the figure is the one
 * restore or replay committed. A doubt that stopped a replay mid-way is asked
 * over a page that is not the last saved one, so it cannot claim to continue
 * it; it is saved on a page of its own.
 */
export function planDoubtPage(input: {
  record: BoardPageRecord | null;
  boardId: string;
  /** Segments the stopped turn finished drawing, from `recordedSegmentsRef`. */
  recordedSegmentCount: number;
  storedTurnCount: number;
  afterReplay: boolean;
  /** `activeVerifiedDiagramRef` holds a figure. */
  hasActiveFigure: boolean;
}): DoubtPagePlan {
  const record = input.record?.boardId === input.boardId ? input.record : null;
  if (input.afterReplay || !record) {
    return {
      continuesBoard: !input.afterReplay && input.storedTurnCount > 0,
      savePartialTurn: false,
      figureOnPage: input.hasActiveFigure,
    };
  }
  const savePartialTurn =
    !record.turn.saved && (input.recordedSegmentCount > 0 || record.figureDrawn);
  // An unsaved turn with no ink leaves the page as it found it: blank when it
  // was a lesson (its epoch cleared the board), still the saved page when it
  // was a doubt that continued one. A committed figure is ink even when no
  // segment has been recorded yet — interrupting the intro used to treat that
  // page as blank, the doubt opened a new one, and the lesson never came back.
  const pageSaved =
    record.turn.saved ||
    savePartialTurn ||
    record.figureDrawn ||
    (record.turn.kind === "doubt" && record.turn.continuesBoard);
  return {
    continuesBoard: pageSaved,
    savePartialTurn,
    figureOnPage: input.hasActiveFigure && record.figureDrawn,
  };
}

function planOnlyArtifacts(artifacts: unknown): unknown | null {
  if (typeof artifacts !== "object" || artifacts === null || Array.isArray(artifacts)) {
    return null;
  }
  const source = artifacts as Record<string, unknown>;
  return {
    ...(source.schemaVersion ? { schemaVersion: source.schemaVersion } : {}),
    turnPlan: source.turnPlan ?? null,
    ...(source.codeLesson ? { codeLesson: source.codeLesson } : {}),
    // A stopped resume saved without its figure is still on the lesson's page.
    ...(source.boardContinuation ? { boardContinuation: source.boardContinuation } : {}),
    ...(source.diagramStrategy ? { diagramStrategy: source.diagramStrategy } : {}),
  };
}

/**
 * The scene a stopped turn is saved with. A figure that was planned but never
 * drawn is not saved as a figure: the server rebuilds a validated scene's whole
 * intro into the recording, and replay would then show a figure the student
 * never saw.
 */
export function partialTurnScene(record: BoardPageRecord): PersistedTurnScene {
  const doubtFigure = doubtFigureSaveScene(record);
  if (doubtFigure) return doubtFigure;
  if (record.turn.kind === "doubt") {
    return doubtTurnScene(
      record.lessonQuestion,
      record.turn.continuesBoard,
      undefined,
      doubtFigureRefOf(record.turn.scene?.sceneArtifacts),
    );
  }
  const scene = record.turn.scene;
  if (!scene) return textOnlyTurnScene();
  if (scene.visualStatus === "validated" && !record.figureDrawn) {
    return { ...textOnlyTurnScene(), sceneArtifacts: planOnlyArtifacts(scene.sceneArtifacts) };
  }
  // A reference picture planned but not drawn is not saved as shown either.
  if (!record.figureDrawn && referencePictureIdOf(scene.sceneArtifacts)) {
    const artifacts = { ...(scene.sceneArtifacts as Record<string, unknown>) };
    delete artifacts.referencePicture;
    return { ...scene, sceneArtifacts: artifacts };
  }
  return scene;
}

/** Said where a stopped turn had spoken nothing yet; the save needs some text. */
export const PARTIAL_TURN_NOTE = "the lesson paused here for a doubt.";

/** What the stopped turn actually said, in order. */
export function partialTurnRawResponse(
  recorded: readonly Pick<RecordedSegmentPayload, "narration">[],
): string {
  const narration = recorded
    .map((segment) => segment.narration.trim())
    .filter(Boolean)
    .join(" ");
  return narration || PARTIAL_TURN_NOTE;
}

/** A turn saved without the epoch CLEAR still needs dense, unique order indexes. */
export function reindexRecordedSegments(
  recorded: readonly RecordedSegmentPayload[],
): RecordedSegmentPayload[] {
  return recorded.map((segment, orderIndex) => ({ ...segment, orderIndex }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The plan and solver values the lesson on this page was taught from, so a
 * doubt about a number agrees with the number on the board. The live record
 * has both; a restored board has only the plan its saved lesson carried.
 */
export function inheritedTeachingContext(input: {
  record: BoardPageRecord | null;
  boardId: string;
  lessonQuestion: string;
  storedTurns: readonly StoredTurn[];
}): { turnPlan: TurnPlanV3 | null; solverProjection: unknown } {
  const lessonQuestion = input.lessonQuestion.trim();
  const record = input.record;
  if (
    record &&
    record.boardId === input.boardId &&
    record.lessonQuestion.trim() === lessonQuestion
  ) {
    return { turnPlan: record.turnPlan, solverProjection: record.solverProjection };
  }
  for (let index = input.storedTurns.length - 1; index >= 0; index -= 1) {
    const turn = input.storedTurns[index]!;
    if (storedTurnContinuesBoard(turn)) continue;
    if (turn.question.trim() !== lessonQuestion) break;
    const raw = isRecord(turn.sceneArtifacts) ? turn.sceneArtifacts.turnPlan : null;
    const turnPlan = raw ? validateTurnPlanV3(raw, turn.question).plan : null;
    return { turnPlan, solverProjection: null };
  }
  return { turnPlan: null, solverProjection: null };
}

/**
 * Ink a doubt never draws: [TYPE] and [FRAME] step a code lesson this turn does
 * not conduct, [POINT] walks its frames, and [ANNOTATE] reveals a label the
 * lesson withheld. A doubt is saved as text, where the server refuses it, so an
 * annotating doubt was lost on reload.
 */
const NOT_A_DOUBT_COMMAND = new Set<DrawCommand["type"]>(["TYPE", "FRAME", "POINT", "ANNOTATE"]);
/** With the code panel over the left of the board there is no notebook to write in. */
const NOT_BESIDE_THE_CODE_PANEL = new Set<DrawCommand["type"]>(["WRITE", "EMPHASIZE"]);

/**
 * The segment as a doubt may draw it, or null when nothing is left to say or
 * draw. Narration always survives; only the ink this board cannot take goes.
 *
 * With `pointing.enabled` (DIAGRAM_DOUBT_POINTING granted for this turn) a
 * doubt may also name a withheld measurement of the figure in the zone with
 * ANNOTATE, and its FOCUS keeps only ids of that figure. A code board takes
 * FOCUS on the current frame's cells only, as a spotlight that never stays.
 * Without the policy, or with it off, nothing changes.
 */
export function doubtSegment(
  segment: TutorSegment,
  options: {
    codePanelShowing: boolean;
    boardRows?: readonly { workId?: string; text: string }[];
    pointing?: DoubtPointingPolicy;
  },
): TutorSegment | null {
  const commands = getSegmentCommands(segment);
  const pointing = options.pointing?.enabled === true ? options.pointing : null;
  let changed = false;
  const kept: DrawCommand[] = [];
  for (const command of commands) {
    const allowed =
      (!NOT_A_DOUBT_COMMAND.has(command.type) || (pointing !== null && command.type === "ANNOTATE")) &&
      !(options.codePanelShowing && NOT_BESIDE_THE_CODE_PANEL.has(command.type)) &&
      (command.type !== "EMPHASIZE" || groundedDoubtEmphasis(command.text, options.boardRows ?? []));
    if (!allowed) {
      changed = true;
      continue;
    }
    if (!pointing || (command.type !== "FOCUS" && command.type !== "ANNOTATE")) {
      kept.push(command);
      continue;
    }
    const pointed = command.type === "FOCUS"
      ? doubtFocusOnFigure(command, pointing)
      : doubtAnnotateOnFigure(command, pointing);
    if (pointed !== command) changed = true;
    if (pointed) kept.push(pointed);
  }
  if (!changed) return segment;
  if (kept.length === 0 && !segment.narration.trim()) return null;
  const next: TutorSegment = { ...segment, command: kept[0] ?? null };
  if (kept.length > 1) {
    next.commands = kept;
  } else {
    delete next.commands;
  }
  return next;
}

/** The target a FOCUS or ANNOTATE names: the semantic ref wins over the text, as live. */
function pointingTarget(command: DrawCommand): string {
  return (command.semanticRef?.entityId ?? command.text ?? "").trim();
}

function withPointingTarget(command: DrawCommand, target: string): DrawCommand {
  return {
    ...command,
    text: target,
    ...(command.semanticRef ? { semanticRef: { ...command.semanticRef, entityId: target } } : {}),
  };
}

/**
 * A doubt's FOCUS on the figure in the zone: only the ids that figure owns
 * survive, in the order spoken. Modifiers are kept as written, except on a code
 * board, where the mark is always a spotlight and never stays (a frame cell
 * changes with the frame, and a frame id would step the walk-through).
 */
function doubtFocusOnFigure(command: DrawCommand, pointing: DoubtPointingPolicy): DrawCommand | null {
  const raw = pointingTarget(command);
  const [idsPart = "", ...modifiers] = raw.split("|");
  const ids = idsPart.split(",").map((id) => id.trim()).filter(Boolean);
  const known = ids.filter((id) => pointing.figureIds.has(id.toLowerCase()));
  if (known.length === 0) return null;
  const kept = pointing.codeBoard
    ? ["spotlight"]
    : modifiers.map((modifier) => modifier.trim()).filter(Boolean);
  const target = [known.join(","), ...kept].join("|");
  return target === raw ? command : withPointingTarget(command, target);
}

/** A doubt may letter a withheld measurement only by an id of the figure in the zone, and never on a code board. */
function doubtAnnotateOnFigure(command: DrawCommand, pointing: DoubtPointingPolicy): DrawCommand | null {
  if (pointing.codeBoard) return null;
  const target = pointingTarget(command).toLowerCase();
  return target && pointing.figureIds.has(target) ? command : null;
}

/** A doubt may box only a line whose exact text it copied from this page. */
function groundedDoubtEmphasis(
  raw: string | undefined,
  rows: readonly { workId?: string; text: string }[],
): boolean {
  const separator = raw?.indexOf("|") ?? -1;
  if (separator < 1) return false;
  const id = raw!.slice(0, separator).trim().toLowerCase();
  const quoted = raw!.slice(separator + 1).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (!quoted) return false;
  if (id === "last") return true; // Written by this doubt; checked against live ink at execution.
  return rows.some((row) =>
    row.workId?.toLowerCase() === id &&
    row.text.normalize("NFKC").replace(/\s+/g, "").toLowerCase() === quoted,
  );
}

/** Pointing that names parts of a scene; a text only save has no scene to name. */
const SCENE_POINTING = new Set<DrawCommand["type"]>(["POINT", "FOCUS", "FRAME", "ANNOTATE"]);
/**
 * What a doubt that names its page's figure (`pointsAtFigure`) still sends:
 * the server checks each target against that figure. POINT and FRAME walk a
 * code lesson a doubt never conducts.
 */
const DOUBT_POINTING = new Set<DrawCommand["type"]>(["FOCUS", "ANNOTATE"]);

/** A doubt saved onto a page whose figure it names: its pointing goes to the server for checking. */
export function sceneKeepsDoubtPointing(sceneArtifacts: unknown): boolean {
  return boardContinuationOf(sceneArtifacts) !== null && doubtFigureRefOf(sceneArtifacts) !== null;
}

/**
 * The segments a stopped turn is saved with. Saved as a figure, it keeps them
 * all. Saved as text only (its figure never committed), it keeps its words and
 * rows but drops the figure's ink and every pointing at it: the server rejects
 * trusted geometry outside a validated scene and pointing with no scene, and a
 * rejected save put the doubt after it onto the page before.
 */
export function partialTurnSegments(
  recorded: readonly RecordedSegmentPayload[],
  scene: PersistedTurnScene,
): RecordedSegmentPayload[] {
  if (scene.visualStatus === "validated") return [...recorded];
  // A text only turn that drew a reference picture keeps the picture's two
  // passes and the FOCUS on it (or, with part focus, on its parts): the
  // server rebuilds the passes and checks every target against its own record.
  const pictureId = referencePictureIdOf(scene.sceneArtifacts);
  const storedPicture = pictureId ? readStoredReferencePicture(scene.sceneArtifacts) : null;
  const pointables = storedPicture ? referencePicturePointables(storedPicture) : null;
  // A stopped doubt that names its page's figure keeps the pointing it spoke.
  const keepDoubtPointing = !pictureId && sceneKeepsDoubtPointing(scene.sceneArtifacts);
  const kept: RecordedSegmentPayload[] = [];
  for (const segment of recorded) {
    if (pictureId && isReferencePictureRow(segment.command, pictureId)) {
      kept.push(segment);
      continue;
    }
    // Figure intro ink, and the words that described a figure now gone.
    if (isStoredCommandTrustedGeometry(segment.command)) continue;
    const commands = parseStoredSegmentCommands(segment.command);
    const allowed = commands.filter((command) =>
      !SCENE_POINTING.has(command.type) ||
      (keepDoubtPointing && DOUBT_POINTING.has(command.type)) ||
      (pictureId !== null && pointsAtReferencePicture(command, pointables)));
    if (allowed.length === commands.length) {
      kept.push(segment);
      continue;
    }
    if (allowed.length === 0 && !segment.narration.trim()) continue;
    kept.push({
      ...segment,
      command: allowed.length > 0 ? serializeSegmentCommands(allowed) : null,
    });
  }
  return kept;
}

/**
 * The code a doubt beside the code panel can see: every block revealed so far,
 * in plan order, under its section title. Null when nothing is showing.
 */
export function revealedCodeText(
  plan: CodeLessonPlan | null,
  revealedChars: Readonly<Record<string, number>>,
): string | null {
  if (!plan) return null;
  const parts: string[] = [];
  for (const section of plan.sections) {
    const code = section.blocks
      .map((block) => block.code.slice(0, Math.max(0, revealedChars[block.id] ?? 0)))
      .filter((text) => text.trim().length > 0);
    if (code.length > 0) parts.push(`${section.title}:\n${code.join("\n")}`);
  }
  return parts.length > 0 ? parts.join("\n\n").slice(0, 6_000) : null;
}
