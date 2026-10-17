import { completionTokenCap, providerChatBody, resolveLlmEndpoint } from "./llmProvider";
import { resolvePlannerMaxTokens } from "./plannerTransport";
import { resolveTeachingContentBudget } from "./teachingTransport";
import { VISUAL_NEED_SERVER_TIMEOUT_MS } from "./visualNeedPolicy";
import { EVALUATION_POLICY_VERSION, JEV_GATEWAY_MODEL } from "./evaluation/types";
import { rubricVersionForJob } from "./evaluation/rubrics";
import { VISUAL_NEED_CLIENT_TIMEOUT_MS, VISUAL_NEED_EVIDENCE_VERSION } from "../../features/tutor-session/lib/scene/visualNeedClient";
import { plannerSpeedSettings } from "./planningSpeed";
import { applyLectureLabSceneEffort, lectureLabSceneEffort } from "./labSceneEffort";

/** Non-secret, authenticated preflight from the actual server configuration. */
export function labProviderConfig(request?: Request) {
  const endpoint = resolveLlmEndpoint();
  const sceneEffort = request ? lectureLabSceneEffort(request) : undefined;
  const plannerBodies = ["primary", "alternate"].flatMap((plannerLane) => [
    { semanticSceneV2: true, turnPlanV3: false },
    { semanticSceneV2: false, turnPlanV3: true },
    { semanticSceneV2: false, turnPlanV3: false, problemIRV1: true },
    { semanticSceneV2: false, turnPlanV3: false, codeLessonV1: true },
  ].map((options) => applyLectureLabSceneEffort(providerChatBody({
    max_tokens: resolvePlannerMaxTokens({ ...options, plannerLane: plannerLane as "primary" | "alternate", plannerPhase: "plan" }),
    thinking: { type: "disabled" },
  }, endpoint), sceneEffort, { provider: endpoint.provider, semanticSceneV2: options.semanticSceneV2 })));
  const caps = [
    ...plannerBodies.map(completionTokenCap),
    completionTokenCap(providerChatBody({ max_tokens: 4000, thinking: { type: "enabled", budget_tokens: 2048 } }, endpoint)),
  ];
  const teachingCaps = [false, true].map((codeLesson) => completionTokenCap(providerChatBody({
    max_tokens: resolveTeachingContentBudget({ codeLesson }) + 2048,
    thinking: { type: "enabled", budget_tokens: 2048 },
  }, endpoint)));
  return {
    provider: endpoint.provider, deployment: endpoint.deployment,
    configured: Boolean(endpoint.apiKey && !endpoint.fallbackReason),
    // The first translated body is the primary scene request, including Azure's floor.
    planningSpeed: { sceneEffort: endpoint.provider === "azure" ? String(plannerBodies[0]?.reasoning_effort ?? "unknown") : "low",
      ...(endpoint.provider === "azure" ? plannerSpeedSettings() : { priority: false }),
      requestTier: endpoint.provider === "azure" && process.env.DIAGRAM_PLANNER_PRIORITY === "1" ? "priority"
        : "auto" },
    plannerOutputCap: Math.max(...caps), teachingOutputCap: Math.max(...teachingCaps),
    visualNeed: { evidenceVersion: VISUAL_NEED_EVIDENCE_VERSION, model: JEV_GATEWAY_MODEL,
      rubricVersion: rubricVersionForJob("visual_need"), policyVersion: EVALUATION_POLICY_VERSION,
      clientTimeoutMs: VISUAL_NEED_CLIENT_TIMEOUT_MS, serverTimeoutMs: VISUAL_NEED_SERVER_TIMEOUT_MS,
      configured: Boolean(process.env.AI_GATEWAY_API_KEY?.trim()) },
  };
}
