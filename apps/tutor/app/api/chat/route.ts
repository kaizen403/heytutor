import { getMockResponse } from "@heytutor/tutor-core";
import { tutorDebug } from "@heytutor/tutor-core";
import {
  parseFastModeHeader,
  parseReasoningMode,
  type ReasoningEffort,
} from "@heytutor/tutor-core";
import {
  endLlmGeneration,
  flushInBackground,
  genTraceId,
  startTurnTrace,
  type TurnTrace,
} from "@/lib/obs/langfuse";
import { ensureUser, getUserId } from "@/lib/auth";
import {
  fetchPlannerCompletion,
  resolvePlannerMaxTokens,
  resolvePlannerModels,
} from "@/lib/llm/plannerTransport";
import {
  fetchTeachingCompletion,
  resolveTeachingModel,
  resolveTeachingReasoningEffort,
} from "@/lib/llm/teachingTransport";

const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 3600;

// Hard reasoning-token caps per tier. kimi-k2p6's `reasoning_effort` levels are
// NOT hard budgets (low can out-reason medium and run until max_tokens), so we
// use Fireworks' Anthropic-compatible `thinking.budget_tokens` instead, which
// bounds reasoning and guarantees room for the lesson content. Must be >= 1024.
const REASONING_BUDGET_TOKENS: Record<Exclude<ReasoningEffort, "none">, number> = {
  low: 1024,
  medium: 2048,
};
// Forces a short natural wrap-up before </think> when the budget is exhausted,
// so the model transitions cleanly into the answer instead of a hard token slam.
const REASONING_BUDGET_END_STR = "Okay, I have my plan. Here is the lesson.";

interface ChatRequestBody {
  messages?: { role?: string; content?: unknown }[];
  stream_options?: { include_usage?: boolean };
  max_tokens?: number;
  reasoning_effort?: unknown;
  thinking?: unknown;
}

interface FireworksUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface FireworksPerfMetrics {
  ttft_ms?: number;
  tokens_per_sec?: number;
}

interface FireworksSSEPayload {
  choices?: { delta?: { content?: string; reasoning_content?: string } }[];
  usage?: FireworksUsage;
  perf_metrics?: FireworksPerfMetrics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPromptFromBody(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);

    if (!isRecord(parsed)) {
      return bodyText;
    }

    const body = parsed as ChatRequestBody;
    const messages = body.messages ?? [];
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const content = lastUserMessage?.content;

    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      const textBlocks = content
        .filter(isRecord)
        .map((block) => block.text)
        .filter((text): text is string => typeof text === "string");

      return textBlocks.join("\n");
    }

    return bodyText;
  } catch {
    return bodyText;
  }
}

function readContentChunk(payload: FireworksSSEPayload): string {
  const content = payload.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

function readReasoningChunk(payload: FireworksSSEPayload): string {
  const reasoning = payload.choices?.[0]?.delta?.reasoning_content;
  return typeof reasoning === "string" ? reasoning : "";
}

function buildUsageDetails(usage: FireworksUsage | undefined): {
  input?: number;
  output?: number;
  total?: number;
} {
  if (!usage) {
    return {};
  }

  const input = usage.prompt_tokens;
  const output = usage.completion_tokens;
  const total = usage.total_tokens ?? (input !== undefined && output !== undefined ? input + output : undefined);

  return { input, output, total };
}

async function finalizeMockTrace(
  turnTrace: TurnTrace | null,
  question: string,
  traceId: string,
): Promise<Response> {
  const responseText = getMockResponse(question);

  endLlmGeneration(turnTrace, {
    output: responseText,
    usageDetails: { input: 0, output: 0, total: 0 },
    metadata: { mock: true },
    mock: true,
  });

  flushInBackground();

  const payload = JSON.stringify({
    choices: [{ delta: { content: responseText } }],
  });

  return new Response(`data: ${payload}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-heytutor-trace-id": traceId,
    },
  });
}

function finalizeMockPlannerTrace(
  turnTrace: TurnTrace | null,
  question: string,
  traceId: string,
): Response {
  const document = {
    schemaVersion: "scene-document/v2",
    visualDecision: {
      mode: "text_only",
      reason: "Mock mode does not synthesize semantic geometry",
    },
    source: { question, givens: [], asks: [] },
    quantities: [],
    entities: [],
    constructions: [],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: [],
    revealGroups: [],
    teachingTimeline: [],
  };
  const content = JSON.stringify(document);
  endLlmGeneration(turnTrace, {
    output: content,
    usageDetails: { input: 0, output: 0, total: 0 },
    metadata: { mock: true, planner: true, scene_planner_version: 2 },
    mock: true,
  });
  flushInBackground();
  return Response.json(
    { choices: [{ message: { content } }] },
    { headers: { "x-heytutor-trace-id": traceId } },
  );
}

function finalizeMockTurnPlannerTrace(
  turnTrace: TurnTrace | null,
  question: string,
  traceId: string,
): Response {
  const content = JSON.stringify({
    schemaVersion: "turn-plan/v3",
    question,
    givens: [],
    unknowns: [],
    derived: [],
    qualitativeClaims: [],
    lawIds: [],
    assumptions: ["Mock mode does not solve structured quantities."],
    visualRequirement: /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph)\b/i.test(question)
      ? "required"
      : "optional",
  });
  endLlmGeneration(turnTrace, {
    output: content,
    usageDetails: { input: 0, output: 0, total: 0 },
    metadata: { mock: true, planner: true, turn_planner_version: 3 },
    mock: true,
  });
  flushInBackground();
  return Response.json(
    { choices: [{ message: { content } }] },
    { headers: { "x-heytutor-trace-id": traceId } },
  );
}

function finalizeMockProblemIRTrace(
  turnTrace: TurnTrace | null,
  plannerInput: string,
  traceId: string,
): Response {
  const question = plannerInput.match(/SUBMITTED QUESTION\n([\s\S]*?)\n\nVALIDATED TURN PLAN V3/)?.[1]?.trim() ?? plannerInput;
  const content = JSON.stringify({
    schemaVersion: "problem-ir/v1",
    id: "mockProblem",
    question,
    facts: [],
    entities: [],
    expressions: [],
    constraints: [],
    representationIntents: [],
    solveRequests: [],
  });
  endLlmGeneration(turnTrace, {
    output: content,
    usageDetails: { input: 0, output: 0, total: 0 },
    metadata: { mock: true, planner: true, problem_ir_version: 1 },
    mock: true,
  });
  flushInBackground();
  return Response.json(
    { choices: [{ message: { content } }] },
    { headers: { "x-heytutor-trace-id": traceId } },
  );
}

function injectStreamOptions(
  bodyText: string,
  serverModel: string,
  reasoningEffort: ReasoningEffort,
): string {
  try {
    const parsed = JSON.parse(bodyText) as ChatRequestBody & Record<string, unknown>;
    const configuredMaxTokens = Number.parseInt(
      process.env.FIREWORKS_MAX_TOKENS ?? `${DEFAULT_MAX_TOKENS}`,
      10,
    );
    // Token budget reserved for the spoken lesson itself.
    const contentBudget = Number.isFinite(configuredMaxTokens)
      ? Math.min(Math.max(configuredMaxTokens, 1200), 6000)
      : DEFAULT_MAX_TOKENS;

    parsed.model = serverModel;
    parsed.stream_options = { include_usage: true };

    // We drive reasoning exclusively through `thinking` — Fireworks rejects a
    // request that sets both `thinking` and `reasoning_effort`.
    delete parsed.reasoning_effort;

    if (reasoningEffort === "none") {
      parsed.thinking = { type: "disabled" };
      parsed.max_tokens = contentBudget;
    } else {
      const reasoningBudget = REASONING_BUDGET_TOKENS[reasoningEffort];
      parsed.thinking = {
        type: "enabled",
        budget_tokens: reasoningBudget,
        budget_end_str: REASONING_BUDGET_END_STR,
      };
      // max_tokens must cover BOTH the reasoning budget and the lesson content,
      // otherwise reasoning eats the whole allowance and no content is emitted.
      parsed.max_tokens = contentBudget + reasoningBudget;
    }

    return JSON.stringify(parsed);
  } catch {
    return bodyText;
  }
}

function createTracingTransformStream(
  turnTrace: TurnTrace | null,
  mock: boolean,
  requestStartedAt: number,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let bufferedText = "";
  let accumulatedOutput = "";
  let accumulatedReasoning = "";
  let latestUsage: FireworksUsage | undefined;
  let latestPerfMetrics: FireworksPerfMetrics | undefined;
  let firstContentAt: number | null = null;
  let firstReasoningAt: number | null = null;
  let chunkCount = 0;

  const processLine = (line: string): void => {
    if (!line.startsWith("data: ")) {
      return;
    }

    const jsonString = line.slice(6).trim();

    if (jsonString === "[DONE]") {
      return;
    }

    try {
      const payload = JSON.parse(jsonString) as FireworksSSEPayload;
      const reasoningChunk = readReasoningChunk(payload);

      if (reasoningChunk.length > 0) {
        accumulatedReasoning += reasoningChunk;

        if (firstReasoningAt === null) {
          firstReasoningAt = Date.now();
          tutorDebug("chat", "first upstream reasoning chunk", {
            ttft_ms: firstReasoningAt - requestStartedAt,
            preview: reasoningChunk.slice(0, 80),
          });
        }
      }

      const contentChunk = readContentChunk(payload);

      if (contentChunk.length > 0) {
        accumulatedOutput += contentChunk;
        chunkCount += 1;

        if (firstContentAt === null) {
          firstContentAt = Date.now();
          tutorDebug("chat", "first upstream content chunk", {
            ttft_ms: firstContentAt - requestStartedAt,
            preview: contentChunk.slice(0, 80),
          });
        }
      }

      if (payload.usage) {
        latestUsage = payload.usage;
      }

      if (payload.perf_metrics) {
        latestPerfMetrics = payload.perf_metrics;
      }
    } catch {
      // ignore malformed SSE lines
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      bufferedText += decoder.decode(chunk, { stream: true });
      const lines = bufferedText.split(/\r?\n/);
      bufferedText = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line);
      }
    },
    async flush() {
      if (bufferedText.length > 0) {
        for (const line of bufferedText.split(/\r?\n/)) {
          processLine(line);
        }
      }

      const durationMs = Date.now() - requestStartedAt;

      tutorDebug("chat", "upstream stream complete", {
        duration_ms: durationMs,
        content_chars: accumulatedOutput.length,
        reasoning_chars: accumulatedReasoning.length,
        content_chunks: chunkCount,
        ttft_content_ms: firstContentAt ? firstContentAt - requestStartedAt : null,
        ttft_reasoning_ms: firstReasoningAt ? firstReasoningAt - requestStartedAt : null,
        fireworks_ttft_ms: latestPerfMetrics?.ttft_ms,
        tokens_per_sec: latestPerfMetrics?.tokens_per_sec,
      });

      if (accumulatedOutput.length === 0) {
        tutorDebug("chat", "empty content from upstream", {
          reasoning_chars: accumulatedReasoning.length,
          usage: latestUsage,
        });
      }

      endLlmGeneration(turnTrace, {
        output: accumulatedOutput,
        usageDetails: buildUsageDetails(latestUsage),
        metadata: {
          ttft_ms: latestPerfMetrics?.ttft_ms,
          tokens_per_sec: latestPerfMetrics?.tokens_per_sec,
          reasoning_chars: accumulatedReasoning.length,
          content_chars: accumulatedOutput.length,
        },
        mock,
      });

      flushInBackground();
    },
  });
}

interface PlannerRequestArgs {
  rawBody: string;
  apiKey: string;
  traceId: string;
  turnTrace: TurnTrace | null;
  requestStartedAt: number;
  semanticSceneV2: boolean;
  turnPlanV3: boolean;
  problemIRV1: boolean;
  plannerPhase: "plan" | "repair";
  plannerLane: "primary" | "alternate";
  fastMode: boolean;
  deadlineMs: number;
  signal: AbortSignal;
}

async function handlePlannerRequest({
  rawBody,
  apiKey,
  traceId,
  turnTrace,
  requestStartedAt,
  semanticSceneV2,
  turnPlanV3,
  problemIRV1,
  plannerPhase,
  plannerLane,
  fastMode,
  deadlineMs,
  signal,
}: PlannerRequestArgs): Promise<Response> {
  const plannerModels = resolvePlannerModels({
    semanticSceneV2,
    turnPlanV3,
    problemIRV1,
    plannerPhase,
    plannerLane,
    fastMode,
  });

  const deadlineController = new AbortController();
  const deadlineId = setTimeout(
    () => deadlineController.abort(new DOMException("Planner request deadline exceeded", "TimeoutError")),
    deadlineMs,
  );
  const boundedSignal = mergePlannerSignals(signal, deadlineController.signal);
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    delete parsed.reasoning_effort;
    if (semanticSceneV2 || turnPlanV3 || problemIRV1) {
      // Hidden reasoning adds latency without improving the audited document.
      // Complex scenes routinely exceed 1,400 output tokens; truncating JSON
      // makes an otherwise usable scene indistinguishable from no scene.
      parsed.thinking = { type: "disabled" };
      parsed.max_tokens = resolvePlannerMaxTokens({
        semanticSceneV2,
        turnPlanV3,
        problemIRV1,
        plannerPhase,
        plannerLane,
        fastMode,
      });
    } else {
      parsed.thinking = { type: "enabled", budget_tokens: 2048 };
      parsed.max_tokens = 4000;
    }
    parsed.stream = false;
    parsed.response_format = { type: "json_object" };

    const upstreamStartedAt = Date.now();
    const transport = await fetchPlannerCompletion({
      url: FIREWORKS_CHAT_URL,
      apiKey,
      body: parsed,
      models: plannerModels,
      signal: boundedSignal,
      onRetry: ({ attempt, delayMs, message, model, modelAttempt, status }) => {
        tutorDebug("planner", message ? "Fireworks fetch failed" : "transient Fireworks response", {
          attempt,
          delay_ms: delayMs,
          message,
          model,
          model_attempt: modelAttempt,
          status,
        });
      },
    });
    const { response } = transport;

    tutorDebug("planner", "fireworks response", {
      status: response.status,
      connect_ms: Date.now() - upstreamStartedAt,
      model: transport.model,
      attempts: transport.attemptCount,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      endLlmGeneration(turnTrace, {
        output: errorBody,
        metadata: {
          error: true,
          status: response.status,
          planner: true,
          planner_model: transport.model,
          planner_lane: plannerLane,
          planner_attempts: transport.attemptCount,
        },
      });
      flushInBackground();
      return new Response(errorBody, {
        status: response.status,
        headers: { "content-type": "application/json", "x-heytutor-trace-id": traceId },
      });
    }

    const jsonBody = await response.text();

    // Trace the planner output (non-streaming, so accumulate at once).
    try {
      const parsedResponse = JSON.parse(jsonBody) as {
        choices?: { message?: { content?: string; reasoning_content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = parsedResponse.choices?.[0]?.message?.content ?? "";
      const reasoning = parsedResponse.choices?.[0]?.message?.reasoning_content ?? "";
      // #region agent log
      if (semanticSceneV2 && !turnPlanV3 && !problemIRV1) {
        try {
          const parsedScene = JSON.parse(content) as {
            constructions?: Array<{ operator?: string; inputs?: Record<string, unknown> }>;
            assertions?: Array<{ id?: string; predicate?: string; severity?: string; entities?: string[] }>;
          };
          const { appendFileSync } = await import("node:fs");
          appendFileSync("/Users/kaizen/heytutor/.cursor/debug-e9a5f5.log", `${JSON.stringify({
            sessionId: "e9a5f5",
            runId: "post-fix",
            hypothesisId: "H1",
            location: "chat/route.ts:planner",
            message: "scene planner output",
            data: {
              plannerLane,
              operators: (parsedScene.constructions ?? []).map((c) => c.operator ?? ""),
              assertionSeverities: parsedScene.assertions ?? [],
              hasSolidProjection: (parsedScene.constructions ?? []).some((c) => c.operator === "solid_projection"),
            },
            timestamp: Date.now(),
          })}\n`);
        } catch {
          // ignore malformed planner JSON in debug capture
        }
      }
      // #endregion
      endLlmGeneration(turnTrace, {
        output: content,
        usageDetails: buildUsageDetails(parsedResponse.usage as FireworksUsage | undefined),
        metadata: {
          planner: true,
          scene_planner_version: turnPlanV3 || problemIRV1 ? undefined : semanticSceneV2 ? 2 : 1,
          turn_planner_version: turnPlanV3 ? 3 : undefined,
          problem_ir_version: problemIRV1 ? 1 : undefined,
          content_chars: content.length,
          reasoning_chars: reasoning.length,
          elapsed_ms: Date.now() - requestStartedAt,
          planner_model: transport.model,
          planner_lane: plannerLane,
          planner_attempts: transport.attemptCount,
        },
      });
    } catch {
      // Still return the body even if tracing fails.
    }
    flushInBackground();

    return new Response(jsonBody, {
      status: response.status,
      headers: {
        "content-type": "application/json",
        "x-heytutor-trace-id": traceId,
        "x-heytutor-planner-model": transport.model,
        "x-heytutor-planner-lane": plannerLane,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "planner proxy error";
    tutorDebug("planner", "proxy error", { message, elapsed_ms: Date.now() - requestStartedAt });
    endLlmGeneration(turnTrace, { output: message, metadata: { error: true, planner: true } });
    flushInBackground();
    return Response.json(
      { error: message },
      { status: 500, headers: { "x-heytutor-trace-id": traceId } },
    );
  } finally {
    clearTimeout(deadlineId);
  }
}

function mergePlannerSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  if (first.aborted) abort(first);
  else first.addEventListener("abort", () => abort(first), { once: true });
  if (second.aborted) abort(second);
  else second.addEventListener("abort", () => abort(second), { once: true });
  return controller.signal;
}

export async function POST(request: Request): Promise<Response> {
  const requestStartedAt = Date.now();
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  await ensureUser(userId);

  const rawBody = await request.text();
  const sessionId = request.headers.get("x-session-id") ?? undefined;
  const userInput = readPromptFromBody(rawBody);
  const traceId = genTraceId();
  const apiKey = process.env.FIREWORKS_API_KEY;
  const mock = !apiKey;
  const turnTrace = startTurnTrace({ sessionId, input: userInput, traceId, mock });

  tutorDebug("chat", "POST /api/chat", {
    trace_id: traceId,
    session_id: sessionId ?? null,
    mock,
    question_preview: userInput.slice(0, 120),
    question_chars: userInput.length,
  });

  if (mock) {
    tutorDebug("chat", "using mock response (no FIREWORKS_API_KEY)");
    if (request.headers.get("x-planner") === "1") {
      if (request.headers.get("x-problem-ir-version") === "1") {
        return finalizeMockProblemIRTrace(turnTrace, userInput, traceId);
      }
      if (request.headers.get("x-turn-planner-version") === "3") {
        return finalizeMockTurnPlannerTrace(turnTrace, userInput, traceId);
      }
      return finalizeMockPlannerTrace(turnTrace, userInput, traceId);
    }
    return finalizeMockTrace(turnTrace, userInput, traceId);
  }

  // Planner branch: the semantic scene planner calls with stream:false and a
  // dedicated header. It needs its own bounded reasoning budget and max_tokens,
  // and returns raw JSON — not an SSE stream — so it bypasses the teaching
  // stream's reasoning classification and SSE tracing transform.
  if (request.headers.get("x-planner") === "1") {
    const turnPlanV3 = request.headers.get("x-turn-planner-version") === "3";
    const problemIRV1 = request.headers.get("x-problem-ir-version") === "1";
    return handlePlannerRequest({
      rawBody,
      apiKey,
      traceId,
      turnTrace,
      requestStartedAt,
      semanticSceneV2: !turnPlanV3 && !problemIRV1 && request.headers.get("x-scene-planner-version") === "2",
      turnPlanV3,
      problemIRV1,
      plannerPhase: request.headers.get("x-scene-planner-phase") === "repair" ? "repair" : "plan",
      plannerLane: (
        turnPlanV3
          ? request.headers.get("x-turn-planner-lane")
          : request.headers.get("x-scene-planner-lane")
      ) === "alternate" ? "alternate" : "primary",
      fastMode: parseFastModeHeader(request.headers.get("x-heytutor-fast-mode")),
      deadlineMs: Math.min(
        60_000,
        Math.max(
          1_000,
          Number.parseInt(request.headers.get("x-planner-deadline-ms") ?? "60000", 10) || 60_000,
        ),
      ),
      signal: request.signal,
    });
  }

  const fastMode = parseFastModeHeader(request.headers.get("x-heytutor-fast-mode"));
  const serverModel = resolveTeachingModel(process.env, { fastMode });
  const reasoningMode = parseReasoningMode(process.env.TUTOR_REASONING_MODE);
  const hasAuthoritativePlan =
    request.headers.get("x-heytutor-teaching-pass") === "planned";
  const reasoningEffort = resolveTeachingReasoningEffort({
    question: userInput,
    hasAuthoritativePlan,
    mode: reasoningMode,
  });
  const bodyToSend = injectStreamOptions(rawBody, serverModel, reasoningEffort);

  tutorDebug("chat", "forwarding to Fireworks", {
    model: serverModel,
    authoritative_plan: hasAuthoritativePlan,
    reasoning_mode: reasoningMode,
    reasoning_effort: reasoningEffort,
  });

  try {
    const upstreamStartedAt = Date.now();
    let response: Response | null = null;
    let lastFetchError: unknown = null;

    // Transient DNS/TLS/"fetch failed" blips are common; one quick retry avoids
    // aborting a whole turn for a one-off network hiccup.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetchTeachingCompletion({
          url: FIREWORKS_CHAT_URL,
          signal: request.signal,
          init: {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: bodyToSend,
          },
        });
        lastFetchError = null;
        break;
      } catch (error: unknown) {
        lastFetchError = error;
        tutorDebug("chat", "Fireworks fetch failed", {
          attempt: attempt + 1,
          message: error instanceof Error ? error.message : String(error),
        });
        if (request.signal.aborted) break;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
    }

    if (!response) {
      throw lastFetchError instanceof Error
        ? lastFetchError
        : new Error("fetch failed");
    }

    tutorDebug("chat", "Fireworks response headers", {
      status: response.status,
      connect_ms: Date.now() - upstreamStartedAt,
    });

    if (!response.ok) {
      const errorBody = await response.text();

      endLlmGeneration(turnTrace, {
        output: errorBody,
        metadata: { error: true, status: response.status },
      });
      flushInBackground();

      return new Response(errorBody, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? "application/json",
          "x-heytutor-trace-id": traceId,
        },
      });
    }

    if (!response.body) {
      endLlmGeneration(turnTrace, {
        output: "",
        metadata: { error: true, reason: "empty_body" },
      });
      flushInBackground();

      return new Response("upstream returned no body", {
        status: 502,
        headers: { "x-heytutor-trace-id": traceId },
      });
    }

    const tracedBody = response.body.pipeThrough(
      createTracingTransformStream(turnTrace, false, upstreamStartedAt),
    );

    tutorDebug("chat", "streaming response to client", {
      trace_id: traceId,
      total_setup_ms: Date.now() - requestStartedAt,
    });

    return new Response(tracedBody, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "text/event-stream",
        "cache-control": "no-cache",
        "x-heytutor-trace-id": traceId,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown chat proxy error";

    tutorDebug("chat", "proxy error", {
      message,
      elapsed_ms: Date.now() - requestStartedAt,
    });

    endLlmGeneration(turnTrace, {
      output: message,
      metadata: { error: true },
    });
    flushInBackground();

    return Response.json(
      { error: message },
      {
        status: 500,
        headers: { "x-heytutor-trace-id": traceId },
      },
    );
  }
}
