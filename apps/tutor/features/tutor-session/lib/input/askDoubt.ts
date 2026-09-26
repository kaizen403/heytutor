import type { ConversationExchange } from "@heytutor/tutor-core";
import type { TutorPhase } from "../../types";

/** Runtime snapshot the doubt flow reads before it interrupts a lesson. */
export interface DoubtRuntimeState {
  phase: TutorPhase;
  turnActive: boolean;
  isReplaying: boolean;
  pendingSegmentCount: number;
}

export const DOUBT_PLACEHOLDER = "Ask a doubt about this lesson";

export const DOUBT_INTERRUPT_HINT =
  "Asking a doubt pauses the lesson and answers it right here, under what is on the board. You can continue the lecture afterwards, or ask another doubt.";

/** The interrupted question is context, not the new question — keep it short. */
const MAX_DOUBT_CONTEXT_CHARS = 400;

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
 * The teaching model reads only this string as the student's words. Carry the
 * lesson question with it or a doubt like "why is it negative" is about nothing.
 */
export function buildDoubtPrompt(doubt: string, lessonQuestion?: string | null): string {
  const question = doubt.trim();
  const context = (lessonQuestion ?? "")
    .trim()
    .slice(0, MAX_DOUBT_CONTEXT_CHARS)
    .replace(/[.\s]+$/, "");
  if (!context) {
    return `i have a doubt about this: ${question}`;
  }
  // "why is it negative?" keeps its own mark rather than gaining a second one.
  const said = /[.?!]$/.test(question) ? question : `${question}.`;
  return `i have a doubt about the question "${context}". my doubt: ${said} answer this doubt from the board as it stands.`;
}

/**
 * Everything a doubt turn needs besides its prompt. A doubt is answered on the
 * page it was asked about, so it carries that page's question, and whether the
 * page in front of the student was being redrawn by a replay.
 */
export interface DoubtTurnRequest {
  /** What the teaching model is asked: the composed, board-grounded doubt. */
  prompt: string;
  /** What the turn is saved and listed as. */
  title: string;
  /** The lesson question the page belongs to. Stays the board's question. */
  lessonQuestion: string;
  /** Asked over a replay, not over the live page. */
  afterReplay: boolean;
}

const DOUBT_TITLE_PREFIX = "Doubt: ";
const MAX_DOUBT_TITLE_CHARS = 160;

/** "Doubt: why is it negative", or what was marked when nothing was typed. */
export function doubtTurnTitle(typed: string, markSummary?: string | null): string {
  const text =
    typed.trim() || (markSummary ?? "").trim() || "explain this part again";
  return `${DOUBT_TITLE_PREFIX}${text.replace(/\s+/g, " ")}`.slice(0, MAX_DOUBT_TITLE_CHARS);
}

/** Both doubt prompt builders open this way; a retry has to know it is retrying a doubt. */
export function isDoubtPrompt(text: string): boolean {
  return /^i have a doubt about\b/i.test(text.trim());
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
 * The lesson a doubt interrupted. A doubt turn's title is not that lesson;
 * the page record keeps the original stem on `lessonQuestion`.
 */
export function interruptedLessonStem(
  page: { lessonQuestion?: string | null } | null | undefined,
  liveQuestion: string | null | undefined,
): string {
  const lesson = page?.lessonQuestion?.trim() ?? "";
  if (lesson) return lesson;
  return (liveQuestion ?? "").trim();
}

/**
 * Completed sentences plus the one still being spoken. A segment is recorded
 * only after it finishes, so a mid-sentence interrupt would otherwise omit
 * what the student was hearing.
 */
export function interruptedTurnNarration(
  completed: readonly string[],
  inFlight: string,
): string {
  const heard = completed.map((line) => line.trim()).filter(Boolean);
  const live = inFlight.trim();
  if (live && heard[heard.length - 1] !== live) heard.push(live);
  return heard.join(" ");
}

/**
 * Identity of an `?q=` auto-submission. The board id alone is not enough (the
 * same board can be handed a new question) and the question alone is not either
 * (the same question can start a new board).
 */
export function autoQuestionSubmissionKey(boardId: string, question: string): string {
  return `${boardId}::${question.trim()}`;
}
