import { getMockCodeLessonPlan, getMockResponse } from "@heytutor/tutor-core";
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
import {
  chatGenerationName,
  chatTimingMetadata,
  providerPerfMetadata,
  readChatTraceHeaders,
  resolveChatGenerationKind,
  resolveTurnTraceInput,
  shouldUpdateParentTraceOutput,
} from "@/lib/obs/chatTrace";
import {
  createInUseRelease,
  holdGrantUntilStreamEnds,
  releaseInUseWhenClientLeaves,
  requireLessonGrant,
} from "@/lib/billing/gate";
import { recordLlmSpend } from "@/lib/billing/track";
import {
  lectureLabPlannerDeadlineCapMs,
  shouldSuppressLectureLabTrace,
  shouldUseLectureLabStandardModel,
} from "@/lib/billing/flags";
import { parseProviderUsage, usageDetailsFromParsed } from "@/lib/obs/providerUsage";
import { markGrantInUse, type TurnGrant } from "@/lib/billing/grant";
import type { SpendActor } from "@/lib/billing/actor";
import { reservePaidUsage, maximumLlmCost, actualLlmCost, holdPaidUsage, type PaidUsageReservation } from "@/lib/billing/paidUsage";
import { readBoundedText, RequestBodyError } from "@/lib/http/requestBody";
import { isTeachingHedge, serverChatBody } from "@/lib/llm/chatRequest";
import {
  resolveCheapFireworksModel,
  DEFAULT_FIREWORKS_MODEL,
  resolveFireworksModel,
} from "@/lib/llm/fireworksModels";
import {
  completionTokenCap,
  providerChatBody,
  readProviderPerf,
  resolveLlmEndpoint,
  type LlmEndpoint,
} from "@/lib/llm/llmProvider";
import { setTimeout as sleepFor } from "node:timers/promises";
import { resolveDiagramStrategyAssignment } from "@/lib/scene/diagramStrategy.server";
import {
  buildLiveDiagramPickerBody,
  injectLiveDiagramExamples,
  parseLiveDiagramExampleIds,
  resolveLiveDiagramExamples,
} from "@/lib/scene/diagramExampleLibrary.server";
import {
  fetchPlannerCompletion,
  resolvePlannerMaxTokens,
  resolvePlannerModels,
} from "@/lib/llm/plannerTransport";
import {
  fetchTeachingCompletion,
  classifyTeachingFailure,
  nextTeachingAttempt,
  readTeachingStartupRetry,
  resolveTeachingContentBudget,
  resolveTeachingModelRoute,
  resolveTeachingReasoningEffort,
  teachingAttemptModel,
  teachingAttemptMayHaveGenerated,
  type TeachingModelRoute,
  type TeachingUpstreamFailure,
} from "@/lib/llm/teachingTransport";

const PUBLIC_CHAT_ERROR = "The tutor is temporarily unavailable. Please try again.";

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

interface FireworksSSEPayload {
  choices?: { delta?: { content?: string; reasoning_content?: string } }[];
  usage?: FireworksUsage;
  /** Final chunk only; shape read by `providerPerfMetadata`. */
  perf_metrics?: unknown;
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

function readUsage(usage: unknown) {
  return parseProviderUsage(usage);
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
    updateTrace: true,
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
    updateTrace: false,
  });
  flushInBackground();
  return Response.json(
    { choices: [{ message: { content } }] },
    { headers: { "x-heytutor-trace-id": traceId } },
  );
}

function finalizeMockDiagramExamplePickerTrace(
  turnTrace: TurnTrace | null,
  traceId: string,
): Response {
  const content = JSON.stringify({ ids: [] });
  endLlmGeneration(turnTrace, {
    output: content,
    usageDetails: { input: 0, output: 0, total: 0 },
    metadata: { mock: true, planner: true, diagram_example_picker: true },
    mock: true,
    updateTrace: false,
  });
  flushInBackground();
  return Response.json(
    { choices: [{ message: { content } }] },
    { headers: { "x-heytutor-trace-id": traceId } },
  );
}

function finalizeMockCodeLessonTrace(
  turnTrace: TurnTrace | null,
  question: string,
  traceId: string,
): Response {
  const content = JSON.stringify(getMockCodeLessonPlan(question));
  endLlmGeneration(turnTrace, {
    output: content,
    usageDetails: { input: 0, output: 0, total: 0 },
    metadata: { mock: true, planner: true, code_lesson_version: 1 },
    mock: true,
    updateTrace: false,
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
    updateTrace: false,
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
    updateTrace: false,
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
  codeLesson: boolean,
  llm: LlmEndpoint,
): string {
  try {
    const parsed = serverChatBody(JSON.parse(bodyText));
    const contentBudget = resolveTeachingContentBudget({
      codeLesson,
      env: process.env,
    });

    parsed.model = serverModel;
    parsed.stream = true;
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

    // Written in Fireworks terms; Azure translates thinking and max_tokens.
    return JSON.stringify(providerChatBody(parsed, llm));
  } catch {
    return bodyText;
  }
}

interface TeachingTraceTiming {
  /** POST received, before auth, grant, and reservation work. */
  requestStartedAt: number;
  /** First upstream fetch attempt started. */
  upstreamStartedAt: number;
  /** The attempt that produced the response started. */
  finalAttemptStartedAt: number;
  attemptCount: number;
  /** Upstream response headers arrived. */
  responseHeadersAt: number;
}

function createTracingTransformStream(
  turnTrace: TurnTrace | null,
  mock: boolean,
  timing: TeachingTraceTiming,
  updateTrace: boolean,
  spend?: { actor: SpendActor; model: string; reservation: PaidUsageReservation; unknownCost: () => number; retryCost: () => number },
  generationMetadata: Record<string, unknown> = {},
  /** The student's request signal only; server deadlines are not aborts. */
  clientSignal?: AbortSignal,
): TransformStream<Uint8Array, Uint8Array> {
  const requestStartedAt = timing.upstreamStartedAt;
  const decoder = new TextDecoder();
  let bufferedText = "";
  let accumulatedOutput = "";
  let accumulatedReasoning = "";
  let latestUsage: unknown;
  let latestPerfMetrics: unknown;
  let firstContentAt: number | null = null;
  let firstReasoningAt: number | null = null;
  let chunkCount = 0;
  // A client abort cancels the stream instead of flushing it; whichever runs
  // first closes the Langfuse generation.
  let generationEnded = false;

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

      const perfMetrics = readProviderPerf(payload);
      if (perfMetrics) {
        latestPerfMetrics = perfMetrics;
      }
    } catch {
      // ignore malformed SSE lines
    }
  };

  const timingMetadata = () => chatTimingMetadata({ ...timing, firstContentAt });

  // `cancel` is a standard transformer hook (Node 20+) that the DOM lib types
  // in this TypeScript version do not declare yet.
  const transformer: Transformer<Uint8Array, Uint8Array> & { cancel(reason: unknown): void } = {
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
      const usage = readUsage(latestUsage);
      const perf = providerPerfMetadata(latestPerfMetrics, { completionTokens: usage.known ? usage.output : undefined });

      tutorDebug("chat", "upstream stream complete", {
        duration_ms: durationMs,
        content_chars: accumulatedOutput.length,
        reasoning_chars: accumulatedReasoning.length,
        content_chunks: chunkCount,
        ttft_content_ms: firstContentAt ? firstContentAt - requestStartedAt : null,
        ttft_reasoning_ms: firstReasoningAt ? firstReasoningAt - requestStartedAt : null,
        fireworks_ttft_ms: perf.ttft_ms,
        tokens_per_sec: perf.tokens_per_sec,
      });

      if (accumulatedOutput.length === 0) {
        tutorDebug("chat", "empty content from upstream", {
          reasoning_chars: accumulatedReasoning.length,
          usage: latestUsage,
        });
      }

      if (!generationEnded) {
        generationEnded = true;
        endLlmGeneration(turnTrace, {
          output: accumulatedOutput,
          usageDetails: usageDetailsFromParsed(usage),
          metadata: {
            ...generationMetadata,
            ...perf,
            ...timingMetadata(),
            reasoning_chars: accumulatedReasoning.length,
            content_chars: accumulatedOutput.length,
            usage_status: usage.known ? "known" : "unknown",
            cached_input_tokens: usage.cachedInput ?? 0,
            ...(usage.reasoning !== undefined ? { reasoning_tokens: usage.reasoning } : {}),
          },
          model: spend?.model,
          mock,
          updateTrace,
        });
      }
      if (spend && !mock && usage.known) {
        recordLlmSpend({
          actor: spend.actor,
          model: spend.model,
          accounted: true,
          usage: usageDetailsFromParsed(usage),
        });
      }

      if (spend) await spend.reservation.settle(usage.known ? (actualLlmCost(usageDetailsFromParsed(usage), spend.model) ?? 0) + spend.retryCost() : spend.unknownCost());
      flushInBackground();
    },
    // Runs when the client cancels the body and when the upstream stream
    // dies mid-flight. Billing for both is settled by `holdPaidUsage`; this
    // only closes the generation, as an abort (for example the losing hedge)
    // or as an upstream error.
    cancel(reason) {
      if (generationEnded) return;
      generationEnded = true;
      const clientAborted = clientSignal?.aborted === true;
      const reasonName = reason instanceof Error || reason instanceof DOMException
        ? reason.name
        : typeof reason === "string" ? reason.slice(0, 120) : undefined;
      endLlmGeneration(turnTrace, {
        output: accumulatedOutput,
        metadata: {
          ...generationMetadata,
          ...timingMetadata(),
          ...(clientAborted
            ? { aborted: true, abort_reason: reasonName }
            : { error: true, upstream_error: reasonName ?? "unknown" }),
          reasoning_chars: accumulatedReasoning.length,
          content_chars: accumulatedOutput.length,
          usage_status: "unknown",
        },
        model: spend?.model,
        mock,
        updateTrace: false,
        level: clientAborted ? "WARNING" : "ERROR",
      });
      flushInBackground();
    },
  };
  return new TransformStream(transformer);
}

interface PlannerRequestArgs {
  rawBody: string;
  llm: LlmEndpoint;
  apiKey: string;
  traceId: string;
  turnTrace: TurnTrace | null;
  requestStartedAt: number;
  semanticSceneV2: boolean;
  turnPlanV3: boolean;
  problemIRV1: boolean;
  codeLessonV1: boolean;
  diagramExamplePicker: boolean;
  diagramExampleIds: string[];
  question: string;
  plannerPhase: "plan" | "repair";
  plannerLane: "primary" | "alternate";
  fastMode: boolean;
  evaluationModelOverride?: string;
  problemIRModelOverride?: string;
  deadlineMs: number;
  signal: AbortSignal;
  actor: SpendActor;
  grant: TurnGrant;
}

async function handlePlannerRequest({
  rawBody,
  llm,
  apiKey,
  traceId,
  turnTrace,
  requestStartedAt,
  semanticSceneV2,
  turnPlanV3,
  problemIRV1,
  codeLessonV1,
  diagramExamplePicker,
  diagramExampleIds,
  question,
  plannerPhase,
  plannerLane,
  fastMode,
  evaluationModelOverride,
  problemIRModelOverride,
  deadlineMs,
  signal,
  actor,
  grant,
}: PlannerRequestArgs): Promise<Response> {
  const plannerModels = diagramExamplePicker ? [resolveCheapFireworksModel()] : resolvePlannerModels({
    semanticSceneV2,
    turnPlanV3,
    problemIRV1,
    plannerPhase,
    plannerLane,
    fastMode,
    evaluationModelOverride,
    problemIRModelOverride,
  });

  let reservation: PaidUsageReservation | null = null;
  const deadlineController = new AbortController();
  const deadlineId = setTimeout(
    () => deadlineController.abort(new DOMException("Planner request deadline exceeded", "TimeoutError")),
    deadlineMs,
  );
  const boundedSignal = mergePlannerSignals(signal, deadlineController.signal);
  try {
    const preparedBody = diagramExamplePicker
      ? buildLiveDiagramPickerBody(rawBody, question)
      : semanticSceneV2 && diagramExampleIds.length > 0
        ? injectLiveDiagramExamples(rawBody, resolveLiveDiagramExamples(question, diagramExampleIds))
        : rawBody;
    const parsed = serverChatBody(JSON.parse(preparedBody), "planner");
    delete parsed.reasoning_effort;
    if (diagramExamplePicker) {
      parsed.thinking = { type: "disabled" };
      parsed.max_tokens = 60;
    } else if (semanticSceneV2 || turnPlanV3 || problemIRV1 || codeLessonV1) {
      // Hidden reasoning adds latency without improving the audited document.
      // Complex scenes routinely exceed 1,400 output tokens; truncating JSON
      // makes an otherwise usable scene indistinguishable from no scene.
      parsed.thinking = { type: "disabled" };
      parsed.max_tokens = resolvePlannerMaxTokens({
        semanticSceneV2,
        turnPlanV3,
        problemIRV1,
        codeLessonV1,
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
    const body = providerChatBody(parsed, llm);

    const reserved = await reservePaidUsage({ actor, grant, kind: "planner", traceId, usd: maximumLlmCost(body.messages, completionTokenCap(body), plannerModels, plannerModels.length * 2) });
    if (reserved instanceof Response) return reserved;
    reservation = reserved;
    const upstreamStartedAt = Date.now();
    let finalAttemptStartedAt = upstreamStartedAt;
    const transport = await fetchPlannerCompletion({
      url: llm.url,
      apiKey,
      body,
      fetchImpl: (input, init) => {
        finalAttemptStartedAt = Date.now();
        return fetch(input, init);
      },
      models: plannerModels,
      signal: boundedSignal,
      onRetry: ({ attempt, delayMs, message, model, modelAttempt, status }) => {
        tutorDebug("planner", message ? "provider fetch failed" : "transient provider response", {
          provider: llm.provider,
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
    const timing = chatTimingMetadata({
      requestStartedAt,
      upstreamStartedAt,
      finalAttemptStartedAt,
      attemptCount: transport.attemptCount,
      responseHeadersAt: Date.now(),
    });

    tutorDebug("planner", "provider response", {
      provider: llm.provider,
      status: response.status,
      ...timing,
      model: transport.model,
      attempts: transport.attemptCount,
    });

    if (!response.ok) {
      await response.body?.cancel();
      endLlmGeneration(turnTrace, {
        output: PUBLIC_CHAT_ERROR,
        metadata: {
          ...timing,
          error: true,
          status: response.status,
          planner: true,
          planner_model: transport.model,
          planner_lane: plannerLane,
          planner_attempts: transport.attemptCount,
          diagram_example_picker: diagramExamplePicker || undefined,
        },
        model: transport.model,
        updateTrace: false,
        level: "ERROR",
      });
      flushInBackground();
      return Response.json({ error: PUBLIC_CHAT_ERROR }, {
        status: 502,
        headers: {
          "content-type": "application/json",
          "x-heytutor-trace-id": traceId,
          "x-heytutor-planner-model": transport.model,
        },
      });
    }

    const jsonBody = await response.text();

    // Trace the planner output (non-streaming, so accumulate at once).
    try {
      const parsedResponse = JSON.parse(jsonBody) as {
        choices?: { message?: { content?: string; reasoning_content?: string } }[];
        usage?: unknown;
        perf_metrics?: unknown;
      };
      const content = parsedResponse.choices?.[0]?.message?.content ?? "";
      const reasoning = parsedResponse.choices?.[0]?.message?.reasoning_content ?? "";
      const usage = readUsage(parsedResponse.usage);
      endLlmGeneration(turnTrace, {
        output: content,
        usageDetails: usageDetailsFromParsed(usage),
        metadata: {
          ...providerPerfMetadata(readProviderPerf(parsedResponse), {
            headers: response.headers,
            completionTokens: usage.known ? usage.output : undefined,
          }),
          ...timing,
          temperature: body.temperature,
          llm_provider: llm.provider,
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
          diagram_example_picker: diagramExamplePicker || undefined,
          usage_status: usage.known ? "known" : "unknown",
          cached_input_tokens: usage.cachedInput ?? 0,
          ...(usage.reasoning !== undefined ? { reasoning_tokens: usage.reasoning } : {}),
        },
        model: transport.model,
        updateTrace: false,
      });
      if (usage.known) {
        recordLlmSpend({
          actor,
          model: transport.model,
          accounted: true,
          usage: usageDetailsFromParsed(usage),
        });
      }
      if (usage.known && transport.attemptCount === 1) await reservation.settle(actualLlmCost(usageDetailsFromParsed(usage), transport.model));
    } catch {
      endLlmGeneration(turnTrace, {
        output: jsonBody.slice(0, 2_000),
        metadata: { error: true, planner: true, reason: "unparseable_response" },
        updateTrace: false,
        level: "WARNING",
      });
    }
    flushInBackground();

    return new Response(jsonBody, {
      status: response.status,
      headers: {
        "content-type": "application/json",
        "x-heytutor-trace-id": traceId,
        "x-heytutor-planner-model": transport.model,
        "x-heytutor-planner-lane": plannerLane,
        "x-heytutor-upstream-attempts": String(transport.attemptCount),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "planner proxy error";
    const aborted =
      (error instanceof DOMException && error.name === "AbortError") ||
      signal.aborted ||
      (error instanceof Error && /abort|deadline|timeout/i.test(error.message));
    tutorDebug("planner", "proxy error", { message, elapsed_ms: Date.now() - requestStartedAt });
    endLlmGeneration(turnTrace, {
      output: message,
      metadata: { error: true, planner: true, aborted, usage_status: "unknown" },
      updateTrace: false,
      level: aborted ? "WARNING" : "ERROR",
    });
    flushInBackground();
    return Response.json(
      { error: PUBLIC_CHAT_ERROR },
      { status: 500, headers: { "x-heytutor-trace-id": traceId } },
    );
  } finally {
    clearTimeout(deadlineId);
    await reservation?.finish().catch(error => console.error("[billing] planner reconciliation failed", error));
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
  const gated = await requireLessonGrant(request);
  if (gated instanceof Response) {
    console.error(`[chat] grant denied ${gated.status} ${Date.now() - requestStartedAt}ms`);
    return gated;
  }
  const { actor, grant } = gated;
  const grantTraceId = readChatTraceHeaders(request.headers).traceId ?? `bypass-${actor.userId}`;
  markGrantInUse(grant, 1, grantTraceId);
  const releaseInUse = createInUseRelease(grant, grantTraceId);
  releaseInUseWhenClientLeaves(request.signal, releaseInUse);
  let streamOwnsGrant = false;
  let reservation: PaidUsageReservation | null = null;
  let attemptCount = 0;
  // What each dispatched upstream attempt may cost, priced for the model it called.
  const attemptCosts: number[] = [];
  const attemptedCost = () => attemptCosts.reduce((total, cost) => total + cost, 0);
  const extendedEvaluationScenePlanner =
    request.headers.get("x-planner") === "1" &&
    lectureLabPlannerDeadlineCapMs(request) === 120_000;
  // The extra five seconds is transport headroom around the evaluation-only
  // 120 s scene budget. Live requests retain their existing outer deadline.
  const requestSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(extendedEvaluationScenePlanner ? 125_000 : 120_000),
  ]);
  try {
  let rawBody: string;
  try {
    rawBody = await readBoundedText(request);
    serverChatBody(JSON.parse(rawBody));
  } catch (error) {
    return Response.json({ error: "Invalid chat request." }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const sessionId = request.headers.get("x-session-id") ?? undefined;
  const userInput = readPromptFromBody(rawBody);
  const { traceId: incomingTraceId, question } = readChatTraceHeaders(request.headers);
  const traceId = incomingTraceId ?? genTraceId();
  const attach = Boolean(incomingTraceId);
  const kind = resolveChatGenerationKind(request.headers);
  const diagramExamplePicker = request.headers.get("x-diagram-example-picker") === "1";
  const fastMode = parseFastModeHeader(request.headers.get("x-heytutor-fast-mode"));
  const llm = resolveLlmEndpoint();
  const apiKey = llm.apiKey;
  const evaluationModelOverride = shouldUseLectureLabStandardModel(request)
    ? llm.deployment ?? DEFAULT_FIREWORKS_MODEL
    : undefined;
  const mock = !apiKey;
  // A startup retry after a stalled Fast router runs on the standard deployment.
  const teachingRoute: TeachingModelRoute | null = kind === "teaching"
    ? evaluationModelOverride
      ? { model: evaluationModelOverride, alternate: null, fallbackReason: null }
      : resolveTeachingModelRoute(process.env, { fastMode, startupRetry: readTeachingStartupRetry(request.headers) })
    : null;
  const serverModel = teachingRoute
    ? teachingRoute.model
    : evaluationModelOverride ?? resolveFireworksModel({ fastMode });
  const diagramStrategyAssignment = resolveDiagramStrategyAssignment(actor);
  const turnTrace = shouldSuppressLectureLabTrace(request) ? null : startTurnTrace({
    userId: actor.userId,
    sessionId,
    input: resolveTurnTraceInput({ kind, attach, question, userInput }),
    generationInput: userInput,
    traceId,
    mock,
    model: serverModel,
    generationName: chatGenerationName(kind),
    tags: [`diagram-strategy-assigned:${diagramStrategyAssignment}`],
  });

  tutorDebug("chat", "POST /api/chat", {
    trace_id: traceId,
    session_id: sessionId ?? null,
    mock,
    generation: chatGenerationName(kind),
    diagram_strategy_assigned: diagramStrategyAssignment,
    attach,
    question_preview: (question ?? userInput).slice(0, 120),
    question_chars: (question ?? userInput).length,
  });

  if (mock) {
    tutorDebug("chat", "using mock response (no FIREWORKS_API_KEY)");
    if (request.headers.get("x-planner") === "1") {
      if (diagramExamplePicker) {
        return finalizeMockDiagramExamplePickerTrace(turnTrace, traceId);
      }
      if (request.headers.get("x-code-lesson-version") === "1") {
        return finalizeMockCodeLessonTrace(turnTrace, userInput, traceId);
      }
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
    const codeLessonV1 = request.headers.get("x-code-lesson-version") === "1";
    const semanticSceneV2 = !turnPlanV3 && !problemIRV1 && !codeLessonV1 &&
      request.headers.get("x-scene-planner-version") === "2";
    return handlePlannerRequest({
      rawBody,
      llm,
      apiKey,
      traceId,
      turnTrace,
      requestStartedAt,
      semanticSceneV2,
      turnPlanV3,
      problemIRV1,
      codeLessonV1,
      diagramExamplePicker,
      diagramExampleIds: parseLiveDiagramExampleIds(new URL(request.url).searchParams.get("diagramExampleIds")),
      question: question ?? "",
      plannerPhase: request.headers.get("x-scene-planner-phase") === "repair" ? "repair" : "plan",
      plannerLane: (
        turnPlanV3
          ? request.headers.get("x-turn-planner-lane")
          : request.headers.get("x-scene-planner-lane")
      ) === "alternate" ? "alternate" : "primary",
      fastMode,
      evaluationModelOverride,
      problemIRModelOverride: problemIRV1 && shouldUseLectureLabStandardModel(request)
        ? resolveFireworksModel({ fastMode: false })
        : undefined,
      deadlineMs: Math.min(
        semanticSceneV2 ? lectureLabPlannerDeadlineCapMs(request) : 60_000,
        Math.max(
          1_000,
          Number.parseInt(request.headers.get("x-planner-deadline-ms") ?? "60000", 10) || 60_000,
        ),
      ),
      signal: requestSignal,
      actor,
      grant,
    });
  }

  const reasoningMode = parseReasoningMode(process.env.TUTOR_REASONING_MODE);
  // A hedge is admitted exactly like any teaching call on this trace: same
  // grant, ownership check, per-trace call allowance, and reservation. The
  // header only tags the generation so the pair can be told apart.
  const teachingHedge = isTeachingHedge(request.headers);
  const teachingMetadata: Record<string, unknown> = teachingHedge ? { teaching_hedge: true } : {};
  teachingMetadata.llm_provider = llm.provider;
  const route = teachingRoute ?? { model: serverModel, alternate: null, fallbackReason: null };
  const markModelFallback = (reason: string) => {
    teachingMetadata.teaching_model_fallback = true;
    teachingMetadata.teaching_model_fallback_reason = reason;
  };
  if (route.fallbackReason) markModelFallback(route.fallbackReason);
  const teachingPass = request.headers.get("x-heytutor-teaching-pass");
  const hasAuthoritativePlan = teachingPass === "planned";
  const isCodeLessonTurn =
    request.headers.get("x-heytutor-code-lesson") === "1" || teachingPass === "code-lesson";
  const reasoningEffort = resolveTeachingReasoningEffort({
    question: userInput,
    hasAuthoritativePlan,
    mode: reasoningMode,
    codeLesson: teachingPass === "code-lesson",
    afterReasoningOnly: request.headers.get("x-heytutor-reasoning-retry") === "1",
  });
  const TEACHING_UPSTREAM_ATTEMPTS = 3;
  // Same body for every deployment; only `model` differs.
  const bodyFor = (model: string) => injectStreamOptions(rawBody, model, reasoningEffort, isCodeLessonTurn, llm);
  const providerBody = JSON.parse(bodyFor(route.model)) as Record<string, unknown>;
  const attemptCostFor = (model: string) =>
    maximumLlmCost(providerBody.messages, completionTokenCap(providerBody), [model]);
  let reservedUsd = 0;
  for (let attempt = 0; attempt < TEACHING_UPSTREAM_ATTEMPTS; attempt++) {
    reservedUsd += attemptCostFor(teachingAttemptModel(route, attempt, TEACHING_UPSTREAM_ATTEMPTS));
  }
  const reserved = await reservePaidUsage({ actor, grant, kind: "teaching", traceId, usd: reservedUsd });
  if (reserved instanceof Response) return reserved;
  reservation = reserved;

  tutorDebug("chat", "forwarding to provider", {
    provider: llm.provider,
    model: route.model,
    alternate_model: route.alternate,
    model_fallback: route.fallbackReason,
    authoritative_plan: hasAuthoritativePlan,
    code_lesson: isCodeLessonTurn,
    reasoning_mode: reasoningMode,
    reasoning_effort: reasoningEffort,
    teaching_hedge: teachingHedge,
  });

  let upstreamStartedAt: number | null = null;
  // The deployment the latest upstream attempt called.
  let calledModel = route.model;
  try {
    upstreamStartedAt = Date.now();
    let finalAttemptStartedAt = upstreamStartedAt;
    let response: Response | null = null;
    let lastFetchError: unknown = null;

    // Transient DNS/TLS/"fetch failed" blips and provider 5xx are common; quick
    // retries avoid aborting a whole turn for a one-off hiccup. When every
    // earlier attempt failed before content, the last one moves to the
    // alternate deployment; a 429 skips straight there or is not retried.
    // Nothing here runs once a response has been accepted, so a stream that
    // started is never retried.
    let lastFailure: TeachingUpstreamFailure | null = null;
    let attempt = 0;
    while (attempt < TEACHING_UPSTREAM_ATTEMPTS) {
      if (requestSignal.aborted) break;
      const model = teachingAttemptModel(route, attempt, TEACHING_UPSTREAM_ATTEMPTS);
      if (model !== route.model && !teachingMetadata.teaching_model_fallback) {
        markModelFallback(lastFailure ?? "upstream_connect_failure");
        tutorDebug("chat", "teaching falls back to the alternate deployment", { from: route.model, to: model, after: lastFailure });
      }
      calledModel = model;
      attemptCount += 1;
      attemptCosts.push(attemptCostFor(model));
      finalAttemptStartedAt = Date.now();
      let failure: TeachingUpstreamFailure | null;
      try {
        const attemptResponse = await fetchTeachingCompletion({
          url: llm.url,
          signal: requestSignal,
          init: {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: bodyFor(model),
          },
        });
        lastFetchError = null;
        // A provider error status means no generation ran: that attempt is free.
        if (!teachingAttemptMayHaveGenerated(attemptResponse)) attemptCosts[attemptCosts.length - 1] = 0;
        failure = classifyTeachingFailure(attemptResponse);
        if (nextTeachingAttempt(route, attempt, TEACHING_UPSTREAM_ATTEMPTS, failure) === null) {
          response = attemptResponse;
          break;
        }
        await attemptResponse.body?.cancel().catch(() => undefined);
        lastFetchError = new Error(`upstream status ${attemptResponse.status}`);
        tutorDebug("chat", "provider error before content", {
          attempt: attempt + 1,
          model,
          status: attemptResponse.status,
        });
      } catch (error: unknown) {
        failure = "upstream_connect_failure";
        lastFetchError = error;
        tutorDebug("chat", "provider fetch failed", {
          attempt: attempt + 1,
          model,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      lastFailure = failure;
      const next = requestSignal.aborted
        ? null
        : nextTeachingAttempt(route, attempt, TEACHING_UPSTREAM_ATTEMPTS, failure);
      if (next === null) break;
      // Stop or the client deadline ends the backoff at once, so the pending
      // slot and the reservation are released without waiting it out.
      await sleepFor(400 * (attempt + 1), undefined, { signal: requestSignal }).catch(() => undefined);
      attempt = next;
    }

    if (!response) {
      throw lastFetchError instanceof Error
        ? lastFetchError
        : new Error("fetch failed");
    }

    const timing: TeachingTraceTiming = {
      requestStartedAt,
      upstreamStartedAt,
      finalAttemptStartedAt,
      attemptCount,
      responseHeadersAt: Date.now(),
    };
    tutorDebug("chat", "provider response headers", {
      status: response.status,
      ...chatTimingMetadata(timing),
    });

    if (!response.ok) {
      await response.body?.cancel();

      endLlmGeneration(turnTrace, {
        output: PUBLIC_CHAT_ERROR,
        metadata: { ...teachingMetadata, ...chatTimingMetadata(timing), error: true, status: response.status },
        model: calledModel,
        updateTrace: shouldUpdateParentTraceOutput(kind, userInput),
        level: "ERROR",
      });
      flushInBackground();

      return Response.json({ error: PUBLIC_CHAT_ERROR }, {
        status: 502,
        headers: {
          "x-heytutor-trace-id": traceId,
        },
      });
    }

    if (!response.body) {
      endLlmGeneration(turnTrace, {
        output: "",
        metadata: { ...teachingMetadata, ...chatTimingMetadata(timing), error: true, reason: "empty_body" },
        model: calledModel,
        updateTrace: shouldUpdateParentTraceOutput(kind, userInput),
        level: "ERROR",
      });
      flushInBackground();

      return new Response("upstream returned no body", {
        status: 502,
        headers: { "x-heytutor-trace-id": traceId },
      });
    }

    const tracedBody = response.body.pipeThrough(
      createTracingTransformStream(
        turnTrace,
        false,
        timing,
        shouldUpdateParentTraceOutput(kind, userInput),
        // Usage is priced for the deployment that streamed; earlier failed
        // attempts keep their own bounded charge.
        { actor, model: calledModel, reservation, unknownCost: attemptedCost, retryCost: () => attemptedCost() - (attemptCosts.at(-1) ?? 0) },
        teachingMetadata,
        request.signal,
      ),
    );

    tutorDebug("chat", "streaming response to client", {
      trace_id: traceId,
      total_setup_ms: Date.now() - requestStartedAt,
    });

    const heldBody = holdGrantUntilStreamEnds(grant, grantTraceId, holdPaidUsage(tracedBody, reservation, attemptedCost), releaseInUse);
    streamOwnsGrant = true;
    return new Response(heldBody, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "text/event-stream",
        "cache-control": "no-cache",
        "x-heytutor-trace-id": traceId,
        "x-heytutor-model": calledModel,
        "x-heytutor-upstream-attempts": String(attemptCount),
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
      metadata: {
        ...teachingMetadata,
        ...(upstreamStartedAt === null ? {} : { server_setup_ms: upstreamStartedAt - requestStartedAt }),
        attempt_count: attemptCount,
        error: true,
        ...(request.signal.aborted ? { aborted: true } : { upstream_error: error instanceof Error ? error.name : "unknown" }),
      },
      model: calledModel,
      updateTrace: shouldUpdateParentTraceOutput(kind, userInput),
      level: request.signal.aborted ? "WARNING" : "ERROR",
    });
    flushInBackground();

    return Response.json(
      { error: PUBLIC_CHAT_ERROR },
      {
        status: 500,
        headers: { "x-heytutor-trace-id": traceId },
      },
    );
  }
  } finally {
    if (!streamOwnsGrant) {
      await reservation?.settle(attemptedCost()).catch(error => console.error("[billing] teaching reconciliation failed", error));
      releaseInUse();
    }
  }
}
