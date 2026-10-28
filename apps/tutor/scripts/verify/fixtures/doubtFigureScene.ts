/**
 * A page where a doubt drew its own figure, saved through the real server
 * canonicalizer: the lesson's number line, a doubt that drew its own copy
 * planned on the composed question, a plain doubt after it, and the resume.
 * Shared by the doubt figure persistence, continuation, replay and completion
 * gates. Nothing here is engine output written by hand.
 */
import assert from "node:assert/strict";
import { serializeSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import type { StoredSegment, StoredTurn } from "../../../lib/boards/boardsClient";
import { boardContinuationArtifacts } from "../../../lib/boards/boardContinuation";
import { composeDoubtFigureQuestion, doubtFigureArtifacts } from "../../../lib/boards/doubtFigure";
import {
  canonicalizeTurnSceneMetadata,
  type SubmittedTurnSceneMetadata,
} from "../../../lib/scene/turnScenePersistence";
import { bindDoubtFigurePageCheck, memoryPageFigureStore, type PageFigureTurn } from "../../../lib/scene/pageFigureLoader";
import { checkpointSceneFixture } from "./checkpointScene";

export const LESSON_TURN_ID = "11111111-1111-4111-8111-111111111111";
export const DOUBT_FIGURE_TURN_ID = "22222222-2222-4222-8222-222222222222";
export const DOUBT_TITLE = "Doubt: why do we add three?";

export const focus = (id: string): DrawCommand => ({ type: "FOCUS", params: [], text: id, charPosition: 0, narrationBefore: "" });
const write = (text: string): DrawCommand => ({ type: "WRITE", params: [90, 142], text, charPosition: 0, narrationBefore: "" });
const CLEAR: DrawCommand = { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" };

/** A submitted teaching row: the words and the commands under them. */
export function teachingRow(orderIndex: number, narration: string, commands: DrawCommand[]) {
  return {
    orderIndex, narration, spokenText: narration,
    command: serializeSegmentCommands(commands, { trustedDiagramGeometry: false }),
  };
}

/** The lesson's scene metadata rewritten onto `question`, as the client plans a doubt figure. */
export function sceneMetadataOn(
  base: SubmittedTurnSceneMetadata,
  question: string,
  extraArtifacts: Record<string, unknown>,
  segments: SubmittedTurnSceneMetadata["segments"],
): SubmittedTurnSceneMetadata {
  const clone = structuredClone(base) as SubmittedTurnSceneMetadata & {
    sceneDocument: { source: { question: string } };
    sceneArtifacts: Record<string, unknown> & { turnPlan: { question: string }; problemIR: { question: string } };
  };
  clone.sceneDocument.source.question = question;
  clone.sceneArtifacts.turnPlan.question = question;
  clone.sceneArtifacts.problemIR.question = question;
  return { ...clone, sceneArtifacts: { ...clone.sceneArtifacts, ...extraArtifacts }, segments };
}

/** Stored turns as the server's page reads see them, on board b1 of user u1. */
export function pageRowsOf(turns: readonly StoredTurn[], userId = "u1"): PageFigureTurn[] {
  return turns.map((turn) => ({
    id: turn.id, boardId: "b1", userId, orderIndex: turn.orderIndex, question: turn.question,
    visualStatus: turn.visualStatus, sceneDocument: turn.sceneDocument, sceneArtifacts: turn.sceneArtifacts,
    segments: turn.segments.map((segment) => ({ orderIndex: segment.orderIndex, command: segment.command })),
  }));
}

/** The real doubt figure page check over these stored turns, for a doubt with no row yet. */
export function doubtPageCheck(turns: readonly StoredTurn[], turnId: string | null = null) {
  return bindDoubtFigurePageCheck({ boardId: "b1", userId: "u1", turnId }, { store: memoryPageFigureStore(pageRowsOf(turns)) });
}

export function stored(
  id: string,
  orderIndex: number,
  question: string,
  saved: Omit<StoredTurn, "id" | "orderIndex" | "question" | "rawResponse" | "speedMultiplier" | "traceId" | "segments"> & {
    segments: ReadonlyArray<{ narration: string; spokenText: string; command: unknown }>;
  },
  options: { opensOnClear: boolean; kind: StoredTurn["kind"] },
): StoredTurn {
  const lead: StoredSegment[] = options.opensOnClear
    ? [{ id: `${id}-clear`, orderIndex: 0, narration: "", spokenText: "", command: CLEAR, audioUrl: null, durationMs: 50, timings: null }]
    : [];
  return {
    id, orderIndex, question, rawResponse: question, speedMultiplier: 1, traceId: null,
    sceneDocument: saved.sceneDocument, sceneEngineVersion: saved.sceneEngineVersion,
    validationReport: saved.validationReport, visualStatus: saved.visualStatus, sceneArtifacts: saved.sceneArtifacts,
    kind: options.kind, status: "complete",
    segments: [...lead, ...saved.segments.map((segment, index): StoredSegment => ({
      id: `${id}-${index}`, orderIndex: lead.length + index, narration: segment.narration, spokenText: segment.spokenText,
      command: segment.command as StoredSegment["command"], audioUrl: null, durationMs: 900, timings: null,
    }))],
  };
}

export async function doubtFigurePageFixture() {
  const lesson = await checkpointSceneFixture();
  const composed = composeDoubtFigureQuestion(lesson.question, DOUBT_TITLE);

  // The lesson: its figure, then a FOCUS that letters the starting value.
  const lessonSaved = await canonicalizeTurnSceneMetadata({
    ...lesson.metadata,
    segments: [
      ...lesson.metadata.segments,
      teachingRow(lesson.metadata.segments.length, "We start at two.", [focus("start_value")]),
    ],
  });
  assert(lessonSaved.ok, `the lesson saves: ${lessonSaved.ok ? "" : lessonSaved.error}`);

  // The doubt's own figure, planned on the composed question; its FOCUS
  // letters the sum on its own figure.
  // Saved under the doubt's title, as Turn.question is.
  const doubtMetadata = (segments: SubmittedTurnSceneMetadata["segments"], extra: Record<string, unknown> = {}) => ({
    ...sceneMetadataOn(lesson.metadata, composed, {
      ...boardContinuationArtifacts(lesson.question),
      ...doubtFigureArtifacts(LESSON_TURN_ID),
      ...extra,
    }, segments),
    question: DOUBT_TITLE,
  });
  const doubtSegments = [
    ...lesson.metadata.segments,
    teachingRow(lesson.metadata.segments.length, "Three more lands on five.", [focus("sum_value")]),
  ];
  const lessonTurn = stored(LESSON_TURN_ID, 0, lesson.question, lessonSaved.value, { opensOnClear: true, kind: "lesson" });
  // The server's page check reads the lesson already saved on the board.
  const pageCheck = doubtPageCheck([lessonTurn]);
  const doubtSaved = await canonicalizeTurnSceneMetadata(doubtMetadata(doubtSegments), { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: pageCheck });
  assert(doubtSaved.ok, `the doubt figure saves: ${doubtSaved.ok ? "" : doubtSaved.error}`);

  const resumeSaved = await canonicalizeTurnSceneMetadata({
    ...lesson.metadata,
    sceneArtifacts: { ...(lesson.metadata.sceneArtifacts as Record<string, unknown>), ...boardContinuationArtifacts(lesson.question) },
    segments: [teachingRow(0, "So the sum is five.", [write("2 + 3 = 5")])],
  }, { kind: "resume" });
  assert(resumeSaved.ok, `the resume saves: ${resumeSaved.ok ? "" : resumeSaved.error}`);

  const doubtFigureTurn = stored(DOUBT_FIGURE_TURN_ID, 1, DOUBT_TITLE, doubtSaved.value, { opensOnClear: false, kind: "doubt" });
  const plainDoubt: StoredTurn = {
    ...stored("33333333-3333-4333-8333-333333333333", 2, "Doubt: and then?", {
      sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
      sceneArtifacts: boardContinuationArtifacts(lesson.question),
      segments: [teachingRow(0, "Then we read it off.", [write("read 5")])],
    }, { opensOnClear: false, kind: "doubt" }),
  };
  const resumeTurn = stored("44444444-4444-4444-8444-444444444444", 3, lesson.question, resumeSaved.value, { opensOnClear: false, kind: "resume" });
  return {
    lesson,
    composed,
    doubtMetadata,
    doubtSegments,
    pageCheck,
    turns: [lessonTurn, doubtFigureTurn, plainDoubt, resumeTurn],
  };
}
