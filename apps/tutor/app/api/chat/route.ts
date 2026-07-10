import { getMockResponse } from "@heytutor/tutor-core";
import { tutorDebug } from "@heytutor/tutor-core";
import {
  parseReasoningMode,
  resolveReasoningEffort,
  type ReasoningEffort,
} from "@heytutor/tutor-core";
import {
  endLlmGeneration,
  flushInBackground,
  genTraceId,
  startTurnTrace,
  type TurnTrace,
} from "@/lib/langfuse";
import { ensureUser, getUserId } from "@/lib/auth";

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
}

async function handlePlannerRequest({
  rawBody,
  apiKey,
  traceId,
  turnTrace,
  requestStartedAt,
}: PlannerRequestArgs): Promise<Response> {
  const plannerModel =
    process.env.FIREWORKS_PLANNER_MODEL ??
    "accounts/fireworks/models/kimi-k2p6";

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    parsed.model = plannerModel;
    delete parsed.reasoning_effort;
    // Enable thinking with a small budget — the model needs to reason about
    // the question to plan coordinates. Without thinking, it outputs garbage.
    parsed.thinking = { type: "enabled", budget_tokens: 2048 };
    parsed.max_tokens = 4000;
    parsed.stream = false;
    parsed.response_format = { type: "json_object" };

    const upstreamStartedAt = Date.now();
    const response = await fetch(FIREWORKS_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed),
    });

    tutorDebug("planner", "fireworks response", {
      status: response.status,
      connect_ms: Date.now() - upstreamStartedAt,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      endLlmGeneration(turnTrace, {
        output: errorBody,
        metadata: { error: true, status: response.status, planner: true },
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
      endLlmGeneration(turnTrace, {
        output: content,
        usageDetails: buildUsageDetails(parsedResponse.usage as FireworksUsage | undefined),
        metadata: {
          planner: true,
          content_chars: content.length,
          reasoning_chars: reasoning.length,
          elapsed_ms: Date.now() - requestStartedAt,
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
  }
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
    return finalizeMockTrace(turnTrace, userInput, traceId);
  }

  const serverModel = process.env.FIREWORKS_MODEL ?? "accounts/fireworks/models/kimi-k2p6";

  // Planner branch: the LLM diagram architect calls with stream:false and a
  // dedicated header. It needs its own (low) reasoning budget and max_tokens,
  // and returns raw JSON — not an SSE stream — so it bypasses the teaching
  // stream's reasoning classification and SSE tracing transform.
  if (request.headers.get("x-planner") === "1") {
    return handlePlannerRequest({
      rawBody,
      apiKey,
      traceId,
      turnTrace,
      requestStartedAt,
    });
  }

  const reasoningMode = parseReasoningMode(process.env.TUTOR_REASONING_MODE);
  const reasoningEffort = resolveReasoningEffort(userInput, reasoningMode);
  const bodyToSend = injectStreamOptions(rawBody, serverModel, reasoningEffort);

  tutorDebug("chat", "forwarding to Fireworks", {
    model: serverModel,
    reasoning_mode: reasoningMode,
    reasoning_effort: reasoningEffort,
  });

  try {
    const upstreamStartedAt = Date.now();
    const response = await fetch(FIREWORKS_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: bodyToSend,
    });

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
