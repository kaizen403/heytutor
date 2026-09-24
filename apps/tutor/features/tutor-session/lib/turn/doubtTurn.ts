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
  storedTurnContinuesBoard,
} from "@/lib/boards/boardContinuation";

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
  /** Teaching context a doubt on this page reuses instead of planning again. */
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  /** The verified figure's intro committed: its ink is on the page, not merely planned. */
  figureDrawn: boolean;
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

export function textOnlyTurnScene(): PersistedTurnScene {
  return {
    sceneDocument: null,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: "text_only",
    sceneArtifacts: null,
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
    turn: { kind: "lesson", question, continuesBoard: false, scene: null, saved: false },
  };
}

/**
 * A doubt is text on the page it continues. Its FOCUS names figure parts the
 * lesson's saved scene owns, and the server only keeps a FOCUS it can check
 * against a scene, so a saved doubt keeps its rows and boxes and drops its
 * pointing. The marker is what keeps it on the lesson's page.
 */
export function doubtTurnScene(lessonQuestion: string, continuesBoard: boolean): PersistedTurnScene {
  return {
    ...textOnlyTurnScene(),
    sceneArtifacts: continuesBoard ? boardContinuationArtifacts(lessonQuestion) : null,
  };
}

export function doubtPageRecord(input: {
  boardId: string;
  lessonQuestion: string;
  title: string;
  continuesBoard: boolean;
  figureDrawn: boolean;
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
}): BoardPageRecord {
  return {
    boardId: input.boardId,
    lessonQuestion: input.lessonQuestion,
    turnPlan: input.turnPlan,
    solverProjection: input.solverProjection,
    figureDrawn: input.figureDrawn,
    turn: {
      kind: "doubt",
      question: input.title,
      continuesBoard: input.continuesBoard,
      scene: doubtTurnScene(input.lessonQuestion, input.continuesBoard),
      saved: false,
    },
  };
}

/**
 * What a mid-lesson doubt must hand back so the original lecture can continue
 * on the same page after the doubt is answered.
 */
export interface PausedLessonRequest {
  /** The board this lecture was paused on. A later board must not resume it. */
  boardId: string;
  lessonQuestion: string;
  turnPlan: TurnPlanV3 | null;
  solverProjection: unknown;
  scene: PersistedTurnScene | null;
  figureDrawn: boolean;
  /** A code lesson was on the board; the panel and frames stay. */
  codeLesson: boolean;
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
      scene: input.scene,
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
): PausedLessonRequest | null {
  if (!record) return null;
  const lessonQuestion = record.lessonQuestion.trim();
  if (!lessonQuestion) return null;
  return {
    boardId: record.boardId,
    lessonQuestion,
    turnPlan: record.turnPlan,
    solverProjection: record.solverProjection,
    scene: record.turn.kind === "lesson" ? record.turn.scene : null,
    figureDrawn: record.figureDrawn,
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
}): PausedLessonRequest | null {
  const fromPage = pausedLessonFromPage(input.record, input.codeLesson);
  if (fromPage) {
    return {
      ...fromPage,
      boardId: fromPage.boardId || input.boardId,
      figureDrawn: fromPage.figureDrawn || input.figureDrawn,
      codeLesson: fromPage.codeLesson || input.codeLesson,
    };
  }
  const lessonQuestion = input.lessonQuestion.trim();
  if (!lessonQuestion || !input.boardId) return null;
  return {
    boardId: input.boardId,
    lessonQuestion,
    turnPlan: null,
    solverProjection: null,
    scene: null,
    figureDrawn: input.figureDrawn,
    codeLesson: input.codeLesson,
  };
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
  };
}

/**
 * The scene a stopped turn is saved with. A figure that was planned but never
 * drawn is not saved as a figure: the server rebuilds a validated scene's whole
 * intro into the recording, and replay would then show a figure the student
 * never saw.
 */
export function partialTurnScene(record: BoardPageRecord): PersistedTurnScene {
  if (record.turn.kind === "doubt") {
    return doubtTurnScene(record.lessonQuestion, record.turn.continuesBoard);
  }
  const scene = record.turn.scene;
  if (!scene) return textOnlyTurnScene();
  if (scene.visualStatus === "validated" && !record.figureDrawn) {
    return { ...textOnlyTurnScene(), sceneArtifacts: planOnlyArtifacts(scene.sceneArtifacts) };
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
 */
export function doubtSegment(
  segment: TutorSegment,
  options: { codePanelShowing: boolean; boardRows?: readonly { workId?: string; text: string }[] },
): TutorSegment | null {
  const commands = getSegmentCommands(segment);
  const kept = commands.filter(
    (command) =>
      !NOT_A_DOUBT_COMMAND.has(command.type) &&
      !(options.codePanelShowing && NOT_BESIDE_THE_CODE_PANEL.has(command.type)) &&
      (command.type !== "EMPHASIZE" || groundedDoubtEmphasis(command.text, options.boardRows ?? [])),
  );
  if (kept.length === commands.length) return segment;
  if (kept.length === 0 && !segment.narration.trim()) return null;
  const next: TutorSegment = { ...segment, command: kept[0] ?? null };
  if (kept.length > 1) {
    next.commands = kept;
  } else {
    delete next.commands;
  }
  return next;
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
  const kept: RecordedSegmentPayload[] = [];
  for (const segment of recorded) {
    // Figure intro ink, and the words that described a figure now gone.
    if (isStoredCommandTrustedGeometry(segment.command)) continue;
    const commands = parseStoredSegmentCommands(segment.command);
    const allowed = commands.filter((command) => !SCENE_POINTING.has(command.type));
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
