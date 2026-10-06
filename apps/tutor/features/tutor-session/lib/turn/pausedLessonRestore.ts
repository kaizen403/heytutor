/**
 * A stopped lesson survives a reload.
 *
 * The saved turns are the authority: the paused lesson a reopened board offers
 * to continue is derived from them, not restored from a separate blob. Only
 * what the turns cannot give back (the solver projection the lesson's numbers
 * came from) rides the stopped turn as `resumeState`.
 *
 * Rule: on the board's last page, the lesson chain is the lesson and every
 * resume of it. When the chain's last turn is stopped, the lesson is offered
 * again; doubts answered after it do not close it, a resume that finished
 * does. A lesson that stopped before teaching anything is not offered: there is
 * nothing to continue, and the board offers Teach it again instead.
 *
 * Never continues by itself (decision 3): the caller only offers it.
 */
import {
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
} from "@heytutor/drawing";
import { validateTurnPlanV3 } from "@heytutor/scene-engine";
import {
  storedTurnKind,
  storedTurnStatus,
  type StoredTurn,
} from "@/lib/boards/boardsClient";
import {
  pageTurnsEndingAt,
  storedTurnContinuesBoard,
  storedTurnPageQuestion,
} from "@/lib/boards/boardContinuation";
import { storedCodeLessonPlan } from "@/lib/code-lesson/persistedCodeLesson";

import type { PausedLessonRequest, PersistedTurnScene } from "./doubtTurn";
import type { DoubtBoardRow } from "./turnTeachingPrompt";

/** `resumeState` is opaque to the server; this is the shape this client writes. */
export const LESSON_RESUME_STATE_VERSION = 1;
/** Teaching context only, never ink: a projection larger than this is dropped. */
export const MAX_RESUME_SOLVER_PROJECTION_BYTES = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What a Continue after a reload cannot rebuild from the turns, or null when
 * there is nothing worth sending. Sent with the turn's checkpoints
 * (`liveTurnSave().setResumeState`).
 */
export function lessonResumeState(solverProjection: unknown): Record<string, unknown> | null {
  if (solverProjection === null || solverProjection === undefined) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(solverProjection);
  } catch {
    return null;
  }
  if (!json || new TextEncoder().encode(json).length > MAX_RESUME_SOLVER_PROJECTION_BYTES) return null;
  return { v: LESSON_RESUME_STATE_VERSION, solverProjection: JSON.parse(json) as unknown };
}

/** The solver projection a stored turn's `resumeState` carries, or null. */
export function resumeStateSolverProjection(state: unknown): unknown {
  if (!isRecord(state) || state.v !== LESSON_RESUME_STATE_VERSION) return null;
  return state.solverProjection ?? null;
}

function orderedSegments(turn: StoredTurn): StoredTurn["segments"] {
  return [...turn.segments].sort((a, b) => a.orderIndex - b.orderIndex);
}

/** A segment that put something on the board or said something: not the page CLEAR. */
function segmentTaught(segment: StoredTurn["segments"][number]): boolean {
  if (segment.narration.trim()) return true;
  return parseStoredSegmentCommands(segment.command).some((command) => command.type !== "CLEAR");
}

/** The notebook lines a turn wrote, in order. */
function writtenRows(turn: StoredTurn): DoubtBoardRow[] {
  const rows: DoubtBoardRow[] = [];
  for (const segment of orderedSegments(turn)) {
    for (const command of parseStoredSegmentCommands(segment.command)) {
      if (command.type !== "WRITE") continue;
      const text = (command.text ?? "").replace(/\s+/g, " ").trim();
      if (text) rows.push({ text });
    }
  }
  return rows;
}

function turnScene(turn: StoredTurn): PersistedTurnScene {
  return {
    sceneDocument: turn.sceneDocument,
    sceneEngineVersion: turn.sceneEngineVersion,
    validationReport: turn.validationReport,
    visualStatus: turn.visualStatus,
    sceneArtifacts: turn.sceneArtifacts,
  };
}

/**
 * The paused lesson the board's saved turns leave, or null. Pure: the caller
 * offers it (`offerPausedLessonResume`) and never starts it.
 */
export function pausedLessonFromStoredTurns(
  turns: readonly StoredTurn[],
  options: {
    boardId: string;
    now?: number;
    /**
     * This tab is still teaching the turn. When given, a turn that reads
     * `live` but is not live here is stopped: the tab that taught it died or
     * lost its keepalive close, so nothing will ever stop it sooner.
     */
    isLiveHere?: (turnId: string) => boolean;
  },
): PausedLessonRequest | null {
  if (!options.boardId || turns.length === 0) return null;
  const page = pageTurnsEndingAt(turns);
  if (page.length === 0) return null;
  const lessonQuestion = storedTurnPageQuestion(page[0]!).trim();
  if (!lessonQuestion) return null;

  // A resume is saved under the lesson's question; a doubt under its own title.
  const chain = page.filter(
    (turn) => storedTurnKind(turn) !== "doubt" && turn.question.trim() === lessonQuestion,
  );
  const last = chain.at(-1);
  if (!last) return null;
  const lastStatus = storedTurnStatus(last, options.now);
  const orphaned = lastStatus === "live" && options.isLiveHere !== undefined && !options.isLiveHere(last.id);
  if (lastStatus !== "stopped" && !orphaned) return null;
  if (!chain.some((turn) => turn.segments.some(segmentTaught))) return null;

  // The plan lives on the turn that opened the lesson; a resume that had to
  // open a page of its own leaves it on the page before.
  const lastIndex = turns.indexOf(last);
  let source: StoredTurn | null = null;
  for (let index = lastIndex; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (
      storedTurnKind(turn) === "lesson" &&
      !storedTurnContinuesBoard(turn) &&
      turn.question.trim() === lessonQuestion
    ) {
      source = turn;
      break;
    }
  }
  const planSource = source ?? chain[0]!;
  const rawPlan = isRecord(planSource.sceneArtifacts) ? planSource.sceneArtifacts.turnPlan : null;
  const turnPlan = rawPlan ? validateTurnPlanV3(rawPlan, planSource.question).plan : null;

  let solverProjection: unknown = null;
  for (const turn of [...chain].reverse()) {
    solverProjection = resumeStateSolverProjection(turn.resumeState);
    if (solverProjection !== null) break;
  }
  if (solverProjection === null && source) {
    solverProjection = resumeStateSolverProjection(source.resumeState);
  }

  // Restore stamps every trusted figure stroke of the page: that figure is drawn.
  const figureDrawn = page.some((turn) =>
    turn.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command)),
  );

  // The step Stop cut off is the last thing the chain saved (decision 12),
  // with its board line. The resume finishes it in words and never rewrites it.
  const lastNarration = orderedSegments(last)
    .map((segment) => segment.narration.trim())
    .filter(Boolean)
    .at(-1);

  return {
    boardId: options.boardId,
    // Doubts answered after the stopped turn, on its page.
    reason: page.indexOf(last) < page.length - 1 ? "doubt" : "stop",
    parentTraceId: last.traceId ?? null,
    lessonQuestion,
    turnPlan,
    solverProjection,
    scene: source ? turnScene(source) : null,
    figureDrawn,
    codeLesson: storedCodeLessonPlan(planSource.sceneArtifacts) !== null,
    lessonBoardRows: chain.flatMap(writtenRows),
    ...(lastNarration ? { interruptedStep: lastNarration } : {}),
  };
}
