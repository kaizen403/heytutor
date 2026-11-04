/**
 * POST /api/doubt-figure-need: does a doubt need a figure the board lacks?
 *
 * Off unless DIAGRAM_DOUBT_FIGURES=on. One fast mode call on the lesson's own
 * provider, bounded by DOUBT_FIGURE_NEED_DEADLINE_MS. Any failure answers
 * "point", so the doubt teaches on the figure already drawn.
 */
import { requireLessonGrant } from "@/lib/billing/gate";
import { actualLlmCost, maximumLlmCost, reservePaidUsage } from "@/lib/billing/paidUsage";
import { resolveDoubtFiguresEnabled } from "@/lib/boards/doubtFigure";
import { readBoundedJson, RequestBodyError } from "@/lib/http/requestBody";
import {
  buildDoubtFigureNeedMessages,
  completionText,
  DOUBT_FIGURE_NEED_DEADLINE_MS,
  DOUBT_FIGURE_NEED_MAX_TOKENS,
  parseDoubtFigureNeedInput,
  parseDoubtFigureNeedReply,
  pointDecision,
} from "@/lib/llm/doubtFigureNeed";
import { completionTokenCap, providerChatBody, resolveLlmEndpoint } from "@/lib/llm/llmProvider";
import { fetchPlannerCompletion, resolvePlannerModels } from "@/lib/llm/plannerTransport";
import { parseProviderUsage, usageDetailsFromParsed } from "@/lib/obs/providerUsage";

export async function POST(request: Request): Promise<Response> {
  if (!resolveDoubtFiguresEnabled()) return Response.json(pointDecision("flag_off"));
  const gated = await requireLessonGrant(request);
  if (gated instanceof Response) return gated;
  let body: unknown;
  try {
    body = await readBoundedJson(request, 64 * 1024);
  } catch (error) {
    return Response.json({ error: "invalid_json" }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const input = parseDoubtFigureNeedInput(body);
  if (!input) return Response.json({ error: "invalid_input" }, { status: 400 });

  const llm = resolveLlmEndpoint();
  if (!llm.apiKey) return Response.json(pointDecision("mock"));
  const models = resolvePlannerModels({ semanticSceneV2: false, turnPlanV3: false, plannerPhase: "plan", fastMode: true });
  const providerBody = providerChatBody({
    messages: buildDoubtFigureNeedMessages(input),
    max_tokens: DOUBT_FIGURE_NEED_MAX_TOKENS,
    temperature: 0,
    stream: false,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
  }, llm);
  const reservation = await reservePaidUsage({
    actor: gated.actor,
    grant: gated.grant,
    kind: "policy",
    traceId: request.headers.get("x-heytutor-trace-id") ?? undefined,
    usd: maximumLlmCost(providerBody.messages, completionTokenCap(providerBody), models, 1),
  });
  if (reservation instanceof Response) return Response.json(pointDecision("unfunded"));
  if (request.signal.aborted) {
    await reservation.cancelBeforeDispatch();
    return Response.json(pointDecision("aborted"));
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DOUBT_FIGURE_NEED_DEADLINE_MS)]);
  try {
    const transport = await fetchPlannerCompletion({
      url: llm.url,
      apiKey: llm.apiKey,
      body: providerBody,
      models,
      maxAttemptsPerModel: 1,
      attemptTimeoutMs: DOUBT_FIGURE_NEED_DEADLINE_MS,
      signal,
    });
    if (!transport.response.ok) {
      await transport.response.body?.cancel();
      return Response.json(pointDecision(`provider_${transport.response.status}`));
    }
    const payload: unknown = await transport.response.json();
    const usage = parseProviderUsage((payload as { usage?: unknown } | null)?.usage);
    if (usage.known) await reservation.settle(actualLlmCost(usageDetailsFromParsed(usage), transport.model));
    return Response.json(parseDoubtFigureNeedReply(completionText(payload)) ?? pointDecision("unreadable_reply"));
  } catch {
    return Response.json(pointDecision(signal.aborted ? "timeout" : "provider_error"));
  } finally {
    await reservation.finish();
  }
}
