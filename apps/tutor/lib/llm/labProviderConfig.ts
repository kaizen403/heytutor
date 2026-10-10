import { completionTokenCap, providerChatBody, resolveLlmEndpoint } from "./llmProvider";
import { resolvePlannerMaxTokens } from "./plannerTransport";
import { resolveTeachingContentBudget } from "./teachingTransport";
import { VISUAL_NEED_SERVER_TIMEOUT_MS } from "./visualNeedPolicy";
import { EVALUATION_POLICY_VERSION, JEV_GATEWAY_MODEL } from "./evaluation/types";
import { rubricVersionForJob } from "./evaluation/rubrics";
import { VISUAL_NEED_CLIENT_TIMEOUT_MS, VISUAL_NEED_EVIDENCE_VERSION } from "../../features/tutor-session/lib/scene/visualNeedClient";

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
    visualNeed: { evidenceVersion: VISUAL_NEED_EVIDENCE_VERSION, model: JEV_GATEWAY_MODEL,
      rubricVersion: rubricVersionForJob("visual_need"), policyVersion: EVALUATION_POLICY_VERSION,
      clientTimeoutMs: VISUAL_NEED_CLIENT_TIMEOUT_MS, serverTimeoutMs: VISUAL_NEED_SERVER_TIMEOUT_MS,
      configured: Boolean(process.env.AI_GATEWAY_API_KEY?.trim()) },
  };
}
