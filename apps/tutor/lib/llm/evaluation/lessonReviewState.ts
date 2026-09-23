import { createHash } from "node:crypto";
import { LESSON_DATA_NOTICE } from "./rubrics";
import type { LessonReviewState } from "./types";

/** Stay inside the Gateway 32k window with room for the rubric. */
export const LESSON_REVIEW_STATE_CHAR_BUDGET = 24_000;

export interface LessonReviewInput {
  question: string;
  requestedParts?: string[];
  authoritativeFacts?: string[];
  spokenExplanation?: string;
  boardRows?: string[];
  figure?: LessonReviewState["figure"];
}

function lines(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function buildLessonReviewState(input: LessonReviewInput): LessonReviewState {
  const state: LessonReviewState = {
    notice: LESSON_DATA_NOTICE,
    question: input.question.replace(/\s+/g, " ").trim().slice(0, 8_000),
    requestedParts: lines(input.requestedParts).slice(0, 40),
    authoritativeFacts: lines(input.authoritativeFacts).slice(0, 40),
    spokenExplanation: (input.spokenExplanation ?? "").trim(),
    boardRows: lines(input.boardRows).slice(0, 80),
    figure: input.figure ?? null,
    truncated: false,
  };
  const fitted = fitLessonReviewState(state);
  if (
    fitted.question.length < input.question.trim().length ||
    fitted.requestedParts.length < lines(input.requestedParts).length ||
    fitted.boardRows.length < lines(input.boardRows).length
  ) {
    fitted.truncated = true;
  }
  return fitted;
}

function serializedLength(state: LessonReviewState): number {
  return JSON.stringify(state).length;
}

function fitLessonReviewState(state: LessonReviewState): LessonReviewState {
  if (serializedLength(state) <= LESSON_REVIEW_STATE_CHAR_BUDGET) return state;
  const fitted: LessonReviewState = { ...state, truncated: true };
  const narrationBudget = Math.min(fitted.spokenExplanation.length, 12_000);
  fitted.spokenExplanation = fitted.spokenExplanation.slice(0, narrationBudget);
  while (serializedLength(fitted) > LESSON_REVIEW_STATE_CHAR_BUDGET && fitted.spokenExplanation.length > 0) {
    fitted.spokenExplanation = fitted.spokenExplanation.slice(0, Math.floor(fitted.spokenExplanation.length * 0.7));
  }
  while (serializedLength(fitted) > LESSON_REVIEW_STATE_CHAR_BUDGET && fitted.boardRows.length > 1) {
    fitted.boardRows = fitted.boardRows.slice(0, -1);
  }
  if (serializedLength(fitted) > LESSON_REVIEW_STATE_CHAR_BUDGET) {
    fitted.question = fitted.question.slice(0, 4_000);
    fitted.spokenExplanation = fitted.spokenExplanation.slice(0, 1_000);
    fitted.authoritativeFacts = fitted.authoritativeFacts.slice(0, 20);
  }
  return fitted;
}

export function evaluationInputHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
