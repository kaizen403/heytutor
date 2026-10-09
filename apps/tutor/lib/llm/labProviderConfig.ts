import { completionTokenCap, providerChatBody, resolveLlmEndpoint } from "./llmProvider";
import { resolvePlannerMaxTokens } from "./plannerTransport";
import { resolveTeachingContentBudget } from "./teachingTransport";

/** Non-secret, authenticated preflight from the actual server configuration. */
export function labProviderConfig() {
  const endpoint = resolveLlmEndpoint();
  const caps = [
    ...["primary", "alternate"].flatMap((plannerLane) => [
      { semanticSceneV2: true, turnPlanV3: false },
      { semanticSceneV2: false, turnPlanV3: true },
      { semanticSceneV2: false, turnPlanV3: false, problemIRV1: true },
      { semanticSceneV2: false, turnPlanV3: false, codeLessonV1: true },
    ].map((options) => completionTokenCap(providerChatBody({
      max_tokens: resolvePlannerMaxTokens({ ...options, plannerLane: plannerLane as "primary" | "alternate", plannerPhase: "plan" }),
      thinking: { type: "disabled" },
    }, endpoint)))),
    completionTokenCap(providerChatBody({ max_tokens: 4000, thinking: { type: "enabled", budget_tokens: 2048 } }, endpoint)),
  ];
  const teachingCaps = [false, true].map((codeLesson) => completionTokenCap(providerChatBody({
    max_tokens: resolveTeachingContentBudget({ codeLesson }) + 2048,
    thinking: { type: "enabled", budget_tokens: 2048 },
  }, endpoint)));
  return {
    provider: endpoint.provider, deployment: endpoint.deployment,
    configured: Boolean(endpoint.apiKey && !endpoint.fallbackReason),
    plannerOutputCap: Math.max(...caps), teachingOutputCap: Math.max(...teachingCaps),
  };
}
