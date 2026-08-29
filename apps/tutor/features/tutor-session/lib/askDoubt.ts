import type { ConversationExchange } from "@heytutor/tutor-core";
import type { TutorPhase } from "../types";

/** Runtime snapshot the doubt flow reads before it interrupts a lesson. */
export interface DoubtRuntimeState {
  phase: TutorPhase;
  turnActive: boolean;
  isReplaying: boolean;
  pendingSegmentCount: number;
}

export const DOUBT_PLACEHOLDER = "Ask a doubt about this lesson";

export const DOUBT_INTERRUPT_HINT =
  "Asking a doubt stops this lesson and clears the board to answer it.";

/** The interrupted question is context, not the new question — keep it short. */
export const MAX_DOUBT_CONTEXT_CHARS = 400;

/** Longest wait for the interrupted turn to unwind before the doubt is surfaced back. */
export const DOUBT_INTERRUPT_TIMEOUT_MS = 8000;

export const DOUBT_INTERRUPT_TIMEOUT_MESSAGE =
  "the lesson did not stop in time. ask the doubt again";

/** A doubt asked while the tutor still owns the board must stop that lesson first. */
export function doubtInterruptsLesson(state: DoubtRuntimeState): boolean {
  return state.phase !== "idle" || state.turnActive || state.isReplaying;
}

/**
 * `handleQuestion` drops any question that arrives while a turn is unwinding, so
 * the doubt waits for a genuinely idle runtime — cancelled segments decrement
 * `pendingSegmentCount` asynchronously, well after `stopTurn` returns.
 */
export function isRuntimeReadyForDoubt(state: DoubtRuntimeState): boolean {
  return (
    state.phase === "idle" &&
    !state.turnActive &&
    !state.isReplaying &&
    state.pendingSegmentCount === 0
  );
}

/**
 * The doubt runs as a full turn, so the planner sees only this string. Carry the
 * interrupted question with it or a doubt like "why is it negative" plans nothing.
 */
export function buildDoubtPrompt(doubt: string, lessonQuestion?: string | null): string {
  const question = doubt.trim();
  const context = (lessonQuestion ?? "").trim().slice(0, MAX_DOUBT_CONTEXT_CHARS);
  if (!context) {
    return `i have a doubt about this: ${question}`;
  }
  return `i have a doubt about the question "${context}". my doubt: ${question}. answer just this doubt, do not re-teach the whole lesson.`;
}

/**
 * A cancelled turn never reaches the conversation-history push in
 * `useQuestionHandler`, so without this the doubt turn has no idea what was
 * already taught and erased. Record what the student actually heard.
 */
export function buildInterruptedLessonExchange(
  lessonQuestion: string | null | undefined,
  narrationSoFar: string,
): ConversationExchange | null {
  const question = (lessonQuestion ?? "").trim();
  const narration = narrationSoFar.trim();
  if (!question || !narration) {
    return null;
  }
  return { user: question, assistant: narration };
}

/**
 * Identity of an `?q=` auto-submission. The board id alone is not enough (the
 * same board can be handed a new question) and the question alone is not either
 * (the same question can start a new board).
 */
export function autoQuestionSubmissionKey(boardId: string, question: string): string {
  return `${boardId}::${question.trim()}`;
}
