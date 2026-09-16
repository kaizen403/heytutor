import {
  HEYTUTOR_QUESTION_HEADER,
  HEYTUTOR_TRACE_ID_HEADER,
  readQuestionHeader,
  readTraceIdHeader,
} from "@heytutor/tutor-core";

export type ChatGenerationKind =
  | "teaching"
  | "turn-plan-v3"
  | "problem-ir-v1"
  | "scene-planner-v2"
  | "code-lesson-v1";

/** Teaching keeps `fireworks-llm` so the existing Langfuse token widget still matches. */
export function chatGenerationName(kind: ChatGenerationKind): string {
  return kind === "teaching" ? "fireworks-llm" : kind;
}

export function resolveChatGenerationKind(headers: Headers): ChatGenerationKind {
  if (headers.get("x-planner") !== "1") return "teaching";
  if (headers.get("x-code-lesson-version") === "1") return "code-lesson-v1";
  if (headers.get("x-problem-ir-version") === "1") return "problem-ir-v1";
  if (headers.get("x-turn-planner-version") === "3") return "turn-plan-v3";
  return "scene-planner-v2";
}

/**
 * Parent-trace input is the student question. Planner prompts must not replace
 * it when several `/api/chat` calls share one turn id.
 */
export function resolveTurnTraceInput(options: {
  kind: ChatGenerationKind;
  attach: boolean;
  question?: string;
  userInput: string;
}): string | undefined {
  if (options.question) return options.question;
  if (options.kind === "teaching" || !options.attach) return options.userInput;
  return undefined;
}

/** Continuations are extra generations; do not overwrite the parent lesson text. */
export function shouldUpdateParentTraceOutput(
  kind: ChatGenerationKind,
  userInput: string,
): boolean {
  if (kind !== "teaching") return false;
  return userInput.trim().toLowerCase() !== "continue";
}

export function readChatTraceHeaders(headers: Headers): {
  traceId?: string;
  question?: string;
} {
  return {
    traceId: readTraceIdHeader(headers.get(HEYTUTOR_TRACE_ID_HEADER)),
    question: readQuestionHeader(headers.get(HEYTUTOR_QUESTION_HEADER)),
  };
}
