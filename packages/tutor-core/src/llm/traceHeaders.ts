/** Client → `/api/chat` / TTS: one Langfuse turn id for every LLM and voice call. */
export const HEYTUTOR_TRACE_ID_HEADER = "x-heytutor-trace-id";
/** Board / session grouping in Langfuse. */
export const HEYTUTOR_SESSION_ID_HEADER = "x-session-id";
/**
 * The student question, not the planner prompt. Parent `tutor-turn` input.
 * URI-encoded so μ / ° survive HTTP headers.
 */
export const HEYTUTOR_QUESTION_HEADER = "x-heytutor-question";

const TRACE_ID_MAX_CHARS = 128;
const QUESTION_HEADER_MAX_CHARS = 2_000;

export function readTraceIdHeader(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > TRACE_ID_MAX_CHARS) return undefined;
  if (!/^[\w.:-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

export function readQuestionHeader(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded.length > 0 ? decoded.slice(0, QUESTION_HEADER_MAX_CHARS) : undefined;
  } catch {
    const fallback = value.trim();
    return fallback.length > 0 ? fallback.slice(0, QUESTION_HEADER_MAX_CHARS) : undefined;
  }
}

export function withTurnTraceHeaders(
  headers: Record<string, string>,
  options: { traceId?: string; sessionId?: string; question?: string },
): Record<string, string> {
  const next = { ...headers };
  if (options.traceId) {
    next[HEYTUTOR_TRACE_ID_HEADER] = options.traceId;
  }
  if (options.sessionId) {
    next[HEYTUTOR_SESSION_ID_HEADER] = options.sessionId;
  }
  const question = options.question?.trim();
  if (question) {
    next[HEYTUTOR_QUESTION_HEADER] = encodeURIComponent(
      question.slice(0, QUESTION_HEADER_MAX_CHARS),
    );
  }
  return next;
}
