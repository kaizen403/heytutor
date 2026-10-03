import { withFastModeHeader } from "./fastMode";
import { withTurnTraceHeaders } from "./traceHeaders";
import { tutorDebug } from "../tutorDebug";

export interface ConversationExchange {
  user: string;
  assistant: string;
}

export type TeachingAttemptKind = "primary" | "hedge";

/**
 * How long the first teaching request may stay silent before a second,
 * reasoning-off request races it. Measured from the first request's start.
 */
export const TEACHING_HEDGE_AFTER_MS = 8_000;

export interface TeachingAttemptStats {
  attempt: TeachingAttemptKind;
  /** When this request started, in ms after the first request started. */
  startedAfterMs: number;
  /** First non-whitespace content token, from this request's own start. */
  firstContentTokenMs: number | null;
  /** First usable content, from this request's own start. */
  ttftContentMs: number | null;
  ttftReasoningMs: number | null;
  reasoningChars: number;
  contentChars: number;
  outcome: "completed" | "aborted" | "failed";
}

export interface StreamLLMResponseParams {
  systemPrompt: string;
  userPrompt: string;
  conversationHistory: ConversationExchange[];
  proxyUrl: string;
  sessionId?: string;
  /** The turn has already been solved and audited by TurnPlanV3. */
  hasAuthoritativePlan?: boolean;
  /** Prefer Fireworks Fast routers when the server has them configured. Default on. */
  fastMode?: boolean;
  /** This turn teaches a committed DSA code lesson; it needs a larger budget. */
  codeLesson?: boolean;
  /** Retry after a reasoning-only response: ask the server for no thinking budget. */
  noReasoning?: boolean;
  firstContentTimeoutMs?: number;
  hasUsableContent?: () => boolean;
  /**
   * Race a reasoning-off copy of this request when no content token has
   * arrived `afterMs` after the request started. The first request to send a
   * content token wins and the other is aborted. Off unless given.
   */
  hedge?: { afterMs: number };
  /** Every request this call opens, with its `performance.now()` start. */
  onRequestStart?: (event: { attempt: TeachingAttemptKind; startedAt: number }) => void;
  /** The hedge request is about to open. `afterMs` is measured from the first request. */
  onHedgeStart?: (event: { afterMs: number }) => void;
  /** A hedge was opened and a request has now won. Not called when no hedge opened. */
  onHedgeWinner?: (event: { winner: TeachingAttemptKind; firstContentTokenMs: number }) => void;
  onTraceId?: (traceId: string) => void;
  signal?: AbortSignal;
  /** Client-generated Langfuse turn id. Every planner and teaching call on this question shares it. */
  traceId?: string;
  /** Student question for the parent Langfuse trace. Not the "continue" prompt. */
  question?: string;
}

export interface StreamLLMResult {
  text: string;
  traceId: string | null;
  streamStats?: {
    durationMs: number;
    contentChars: number;
    reasoningChars: number;
    ttftContentMs: number | null;
    ttftReasoningMs: number | null;
    firstContentTimedOut: boolean;
    /** Which request the text came from. */
    attempt?: TeachingAttemptKind;
    /** Present only when hedging was enabled for this call. */
    hedge?: {
      startedAfterMs: number | null;
      winner: TeachingAttemptKind | null;
      attempts: TeachingAttemptStats[];
    };
  };
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAISSSEChoice {
  delta?: { content?: unknown; reasoning_content?: unknown };
}

interface OpenAISSSEPayload {
  choices?: OpenAISSSEChoice[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readContentChunk(eventPayload: unknown): string | null {
  if (!isRecord(eventPayload)) {
    return null;
  }

  const payload = eventPayload as OpenAISSSEPayload;
  const choice = payload.choices?.[0];

  if (!choice || !isRecord(choice.delta)) {
    return null;
  }

  const content = choice.delta.content;

  if (typeof content === "string" && content.length > 0) {
    return content;
  }

  return null;
}

function readReasoningChunk(eventPayload: unknown): string | null {
  if (!isRecord(eventPayload)) {
    return null;
  }

  const payload = eventPayload as OpenAISSSEPayload;
  const choice = payload.choices?.[0];

  if (!choice || !isRecord(choice.delta)) {
    return null;
  }

  const reasoning = choice.delta.reasoning_content;

  if (typeof reasoning === "string" && reasoning.length > 0) {
    return reasoning;
  }

  return null;
}

function buildMessages(
  systemPrompt: string,
  conversationHistory: ConversationExchange[],
  userPrompt: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  for (const exchange of conversationHistory) {
    messages.push({ role: "user", content: exchange.user });
    messages.push({ role: "assistant", content: exchange.assistant });
  }

  messages.push({ role: "user", content: userPrompt });

  return messages;
}

function buildRequestHeaders(
  sessionId?: string,
  hasAuthoritativePlan = false,
  fastMode = true,
  codeLesson = false,
  noReasoning = false,
  traceId?: string,
  question?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (codeLesson) {
    // A committed program is not a plan for the lesson: the tutor still has
    // to lay out the beats and keep the figure and the code in step, and with
    // reasoning off it was doing that with no budget at all.
    headers["x-heytutor-teaching-pass"] = "code-lesson";
  } else if (hasAuthoritativePlan) {
    headers["x-heytutor-teaching-pass"] = "planned";
  }
  // A DSA lesson narrates a worked example frame by frame and then types a
  // whole program, so it needs a larger content budget than an ordinary
  // teaching turn. Flagged here rather than inferred from the question, so a
  // physics turn's reasoning/content split is never affected.
  if (codeLesson) {
    headers["x-heytutor-code-lesson"] = "1";
  }
  if (noReasoning) {
    headers["x-heytutor-reasoning-retry"] = "1";
  }

  return withFastModeHeader(
    withTurnTraceHeaders(headers, { sessionId, traceId, question }),
    fastMode,
  );
}

/** Races a fetch with its own controller so an aborted request always settles. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

interface TeachingAttempt {
  kind: TeachingAttemptKind;
  controller: AbortController;
  startedAt: number;
  noReasoning: boolean;
  hedgeHeader: boolean;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  traceId: string | null;
  text: string;
  /** Whitespace content held until this request wins, then replayed in order. */
  heldDeltas: string[];
  reasoningChars: number;
  contentChars: number;
  firstContentTokenMs: number | null;
  ttftContentMs: number | null;
  ttftReasoningMs: number | null;
  outcome: "pending" | "completed" | "aborted" | "failed";
  threw: boolean;
  error?: unknown;
}

export async function streamLLMResponse(
  {
    systemPrompt,
    userPrompt,
    conversationHistory,
    proxyUrl,
    sessionId,
    hasAuthoritativePlan,
    fastMode,
    codeLesson,
    noReasoning,
    firstContentTimeoutMs = 15_000,
    hasUsableContent,
    hedge,
    onRequestStart,
    onHedgeStart,
    onHedgeWinner,
    onTraceId,
    signal,
    traceId: requestTraceId,
    question,
  }: StreamLLMResponseParams,
  onDelta?: (chunk: string) => void,
): Promise<StreamLLMResult> {
  const model = "server";
  const streamStart = performance.now();
  const timeoutMs = Number.isFinite(firstContentTimeoutMs) && firstContentTimeoutMs > 0
    ? firstContentTimeoutMs
    : 15_000;
  const hedgeAfterMs = hedge && Number.isFinite(hedge.afterMs) && hedge.afterMs >= 0
    ? hedge.afterMs
    : null;
  const hedging = hedgeAfterMs !== null;
  const requestBody = JSON.stringify({
    model,
    max_tokens: 12000,
    temperature: 0.3,
    stream: true,
    reasoning_effort: "none",
    perf_metrics_in_response: true,
    messages: buildMessages(systemPrompt, conversationHistory, userPrompt),
  });
  const attempts: TeachingAttempt[] = [];
  // Without a hedge the only request owns the stream from the start, so every
  // content chunk reaches onDelta exactly as it always has.
  let winner: TeachingAttempt | null = null;
  let firstContentTimer: ReturnType<typeof setTimeout> | undefined;
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  let firstContentTimedOut = false;
  let hedgeStartedAfterMs: number | null = null;
  let settle: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => { settle = resolve; });

  // Observer callbacks are telemetry: one that throws must never kill or hang
  // a request, and must never throw out of a timer.
  const notify = (name: string, callback: () => void) => {
    try {
      callback();
    } catch (error: unknown) {
      tutorDebug("llm", "teaching request callback failed", {
        callback: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const abortAttempt = (attempt: TeachingAttempt, reason: unknown) => {
    attempt.controller.abort(reason);
    void attempt.reader?.cancel().catch(() => undefined);
  };
  const abortAll = (reason: unknown) => {
    clearTimeout(firstContentTimer);
    firstContentTimer = undefined;
    clearTimeout(hedgeTimer);
    hedgeTimer = undefined;
    for (const attempt of attempts) abortAttempt(attempt, reason);
  };
  const onExternalAbort = () => abortAll(signal?.reason);

  const deliver = (attempt: TeachingAttempt, chunk: string) => {
    onDelta?.(chunk);

    if (attempt.ttftContentMs === null && (hasUsableContent
      ? hasUsableContent()
      : attempt.text.replace(/\[[^\]]*(?:\]|$)/g, "").trim().length > 0)) {
      clearTimeout(firstContentTimer);
      firstContentTimer = undefined;
      attempt.ttftContentMs = Math.round(performance.now() - attempt.startedAt);
      tutorDebug("llm", "first content token", {
        attempt: attempt.kind,
        ttft_ms: attempt.ttftContentMs,
        preview: chunk.slice(0, 80),
      });
    }
  };

  const claimWinner = (attempt: TeachingAttempt) => {
    winner = attempt;
    clearTimeout(hedgeTimer);
    hedgeTimer = undefined;
    for (const other of attempts) {
      if (other !== attempt) {
        abortAttempt(other, new DOMException("Another teaching request spoke first", "AbortError"));
      }
    }
    if (hedgeStartedAfterMs !== null) {
      tutorDebug("llm", "teaching hedge winner", {
        winner: attempt.kind,
        first_content_token_ms: attempt.firstContentTokenMs,
      });
      notify("onHedgeWinner", () => onHedgeWinner?.({
        winner: attempt.kind,
        firstContentTokenMs: attempt.firstContentTokenMs ?? 0,
      }));
    }
    const hedgeTraceId = attempt.kind === "hedge" ? attempt.traceId : null;
    if (hedgeTraceId) {
      notify("onTraceId", () => onTraceId?.(hedgeTraceId));
    }
    for (const held of attempt.heldDeltas.splice(0)) {
      if (attempt.controller.signal.aborted) return;
      deliver(attempt, held);
    }
  };

  const processLine = (attempt: TeachingAttempt, line: string): boolean => {
    if (attempt.controller.signal.aborted || !line.startsWith("data: ")) {
      return false;
    }

    const jsonString = line.slice(6).trim();

    if (jsonString === "[DONE]") {
      return true;
    }

    try {
      const eventPayload: unknown = JSON.parse(jsonString);
      const reasoningChunk = readReasoningChunk(eventPayload);

      if (reasoningChunk !== null) {
        attempt.reasoningChars += reasoningChunk.length;

        if (attempt.ttftReasoningMs === null) {
          attempt.ttftReasoningMs = Math.round(performance.now() - attempt.startedAt);
          tutorDebug("llm", "first reasoning token (ignored for teaching)", {
            attempt: attempt.kind,
            ttft_ms: attempt.ttftReasoningMs,
            preview: reasoningChunk.slice(0, 80),
          });
        }
      }

      const textChunk = readContentChunk(eventPayload);

      if (textChunk !== null) {
        attempt.contentChars += textChunk.length;
        attempt.text += textChunk;

        if (winner === null) {
          // Whitespace is not a content token: a request that has only
          // cleared its throat has not started the lesson.
          if (!/\S/.test(textChunk)) {
            attempt.heldDeltas.push(textChunk);
            return false;
          }
          attempt.firstContentTokenMs = Math.round(performance.now() - attempt.startedAt);
          claimWinner(attempt);
          if (attempt.controller.signal.aborted) return false;
        } else if (attempt.firstContentTokenMs === null && /\S/.test(textChunk)) {
          attempt.firstContentTokenMs = Math.round(performance.now() - attempt.startedAt);
        }

        if (winner === attempt) {
          deliver(attempt, textChunk);
        }
      }
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }

    return false;
  };

  const onAttemptSettled = () => {
    if (attempts.some((attempt) => attempt.outcome === "pending")) return;
    // Every request has ended. A pending hedge has nothing left to race:
    // the first request finished (or failed) without speaking, which is
    // today's reasoning-only or error path.
    clearTimeout(hedgeTimer);
    hedgeTimer = undefined;
    settle();
  };

  const runAttempt = async (attempt: TeachingAttempt): Promise<void> => {
    try {
      tutorDebug("llm", "fetch start", {
        model,
        attempt: attempt.kind,
        user_chars: userPrompt.length,
        history_turns: conversationHistory.length,
      });

      const headers = buildRequestHeaders(
        sessionId,
        hasAuthoritativePlan,
        fastMode,
        codeLesson,
        attempt.noReasoning,
        requestTraceId,
        question,
      );
      if (attempt.hedgeHeader) {
        headers["x-heytutor-teaching-hedge"] = "1";
      }

      const response = await raceAbort(fetch(proxyUrl, {
        method: "POST",
        headers,
        signal: attempt.controller.signal,
        body: requestBody,
      }), attempt.controller.signal);

      tutorDebug("llm", "fetch headers received", {
        attempt: attempt.kind,
        status: response.status,
        elapsed_ms: Math.round(performance.now() - attempt.startedAt),
      });

      attempt.traceId = response.headers.get("x-heytutor-trace-id");

      if (attempt.traceId && attempt.kind === "primary") {
        onTraceId?.(attempt.traceId);
      }

      if (!response.ok) {
        const errorBody = await raceAbort(response.text(), attempt.controller.signal);
        throw new Error(`LLM proxy error (${response.status}): ${errorBody}`);
      }

      if (!response.body) {
        throw new Error("LLM proxy returned no response body.");
      }

      const reader = response.body.getReader();
      attempt.reader = reader;
      const decoder = new TextDecoder();
      let bufferedText = "";
      let sawDone = false;

      while (!sawDone) {
        if (attempt.controller.signal.aborted) {
          break;
        }

        const { value, done } = await reader.read();

        if (done || attempt.controller.signal.aborted) {
          break;
        }

        bufferedText += decoder.decode(value, { stream: true });
        const lines = bufferedText.split(/\r?\n/);
        bufferedText = lines.pop() ?? "";

        for (const line of lines) {
          if (processLine(attempt, line)) {
            sawDone = true;
            break;
          }
        }
      }

      if (!sawDone && !attempt.controller.signal.aborted) {
        bufferedText += decoder.decode();

        if (bufferedText.length > 0) {
          for (const line of bufferedText.split(/\r?\n/)) {
            if (processLine(attempt, line)) {
              break;
            }
          }
        }
      }

      attempt.outcome = sawDone || !attempt.controller.signal.aborted ? "completed" : "aborted";
    } catch (error: unknown) {
      attempt.threw = true;
      attempt.error = error;
      attempt.outcome = attempt.controller.signal.aborted ? "aborted" : "failed";
      if (attempt !== winner) {
        tutorDebug("llm", "teaching request ended without speaking", {
          attempt: attempt.kind,
          outcome: attempt.outcome,
        });
      }
    } finally {
      try {
        if (attempt.reader) {
          void attempt.reader.cancel().catch(() => undefined);
          attempt.reader.releaseLock();
        }
      } catch {
        // A reader that cannot release must still let the call settle.
      } finally {
        onAttemptSettled();
      }
    }
  };

  /** Starts the request first; observer callbacks run only once it is in flight. */
  const startAttempt = (kind: TeachingAttemptKind, beforeRequestEvent?: () => void) => {
    const attempt: TeachingAttempt = {
      kind,
      controller: new AbortController(),
      startedAt: performance.now(),
      // The hedge exists to start speaking quickly, so it never thinks.
      noReasoning: kind === "hedge" ? true : Boolean(noReasoning),
      hedgeHeader: kind === "hedge",
      traceId: null,
      text: "",
      heldDeltas: [],
      reasoningChars: 0,
      contentChars: 0,
      firstContentTokenMs: null,
      ttftContentMs: null,
      ttftReasoningMs: null,
      outcome: "pending",
      threw: false,
    };
    attempts.push(attempt);
    if (!hedging) winner = attempt;
    if (signal?.aborted) abortAttempt(attempt, signal.reason);
    void runAttempt(attempt);
    if (beforeRequestEvent) notify("onHedgeStart", beforeRequestEvent);
    notify("onRequestStart", () => onRequestStart?.({ attempt: kind, startedAt: attempt.startedAt }));
    return attempt;
  };

  try {
    if (!signal?.aborted) {
      signal?.addEventListener("abort", onExternalAbort, { once: true });
      // The usable-step deadline is measured from the first request's start,
      // whichever request ends up winning: a hedge never extends it.
      if (!hasUsableContent?.()) {
        firstContentTimer = setTimeout(() => {
          firstContentTimer = undefined;
          firstContentTimedOut = true;
          abortAll(new DOMException("LLM first-content deadline expired", "TimeoutError"));
        }, timeoutMs);
      }
      if (hedgeAfterMs !== null) {
        hedgeTimer = setTimeout(() => {
          hedgeTimer = undefined;
          if (winner || firstContentTimedOut || signal?.aborted) return;
          hedgeStartedAfterMs = Math.round(performance.now() - streamStart);
          const afterMs = hedgeStartedAfterMs;
          tutorDebug("llm", "teaching hedge start", { after_ms: afterMs });
          startAttempt("hedge", () => onHedgeStart?.({ afterMs }));
        }, hedgeAfterMs);
      }
    }

    const primary = startAttempt("primary");

    await settled;

    const chosen: TeachingAttempt = winner
      ?? (firstContentTimedOut || signal?.aborted
        ? primary
        : attempts.find((attempt) => attempt.outcome === "completed") ?? primary);

    const finishResult = (): StreamLLMResult => {
      if (firstContentTimedOut && noReasoning) {
        throw new Error("The lesson did not start in time, even after retrying. Please try asking again.");
      }

      // Only the winner's words ever reached onDelta, so only they are text.
      const text = chosen === winner ? chosen.text : "";
      const durationMs = Math.round(performance.now() - streamStart);
      const streamStats: NonNullable<StreamLLMResult["streamStats"]> = {
        durationMs,
        contentChars: chosen.contentChars,
        reasoningChars: chosen.reasoningChars,
        ttftContentMs: chosen.ttftContentMs,
        ttftReasoningMs: chosen.ttftReasoningMs,
        firstContentTimedOut,
        attempt: chosen.kind,
      };
      if (hedging) {
        const pickedWinner: TeachingAttempt | null = winner;
        streamStats.hedge = {
          startedAfterMs: hedgeStartedAfterMs,
          winner: pickedWinner ? pickedWinner.kind : null,
          attempts: attempts.map((attempt) => ({
            attempt: attempt.kind,
            startedAfterMs: Math.round(attempt.startedAt - streamStart),
            firstContentTokenMs: attempt.firstContentTokenMs,
            ttftContentMs: attempt.ttftContentMs,
            ttftReasoningMs: attempt.ttftReasoningMs,
            reasoningChars: attempt.reasoningChars,
            contentChars: attempt.contentChars,
            outcome: attempt.outcome === "pending" ? "aborted" : attempt.outcome,
          })),
        };
      }

      tutorDebug("llm", "stream complete", streamStats);

      if (text.length === 0) {
        tutorDebug("llm", "empty content output", {
          reasoning_chars: chosen.reasoningChars,
          hint:
            chosen.reasoningChars > 0
              ? "model sent reasoning_content only — check reasoning_effort"
              : "no content or reasoning received",
        });
      }

      return { text, traceId: chosen.traceId ?? primary.traceId, streamStats };
    };

    if (chosen.threw) {
      if (firstContentTimedOut) {
        return finishResult();
      }
      if (signal?.aborted && chosen.reader) {
        return finishResult();
      }
      throw chosen.error;
    }

    return finishResult();
  } finally {
    clearTimeout(firstContentTimer);
    clearTimeout(hedgeTimer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
