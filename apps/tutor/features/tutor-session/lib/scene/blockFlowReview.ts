import { blockFlowCitedProcesses, planStatesChain, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  checkRestatedSteps, RESTATED_PROCESS_CLAIM_ID, reviewProcessChains, writeProcessClaim,
  type ProcessReviewOptions, type ProcessReviewResult, type RestatedStep, type SceneCandidateValidation, type StepCheckResult,
} from "@heytutor/tutor-core";
import { deriveSceneGate } from "./productionSceneSelection";

/** Three short reasoning votes run in parallel (up to about 9 s each); a slower review is no review. */
export const BLOCK_FLOW_REVIEW_TIMEOUT_MS = 20_000;

export const BLOCK_FLOW_REVIEW_DECLINED = "block_flow_review_declined";

export { RESTATED_PROCESS_CLAIM_ID };

/**
 * For an eligible "other" lesson that wants a visual, no figure path asks the
 * planner today, and the plan states no process: one short call may restate a
 * process the plan's claims already describe, as one more claim. Each step
 * cites the claim it restates and is checked on its own against it; any
 * failed or missing check keeps the plan untouched. Anything else returns the
 * plan untouched and makes no call. A figure drawn from the restated process
 * still faces grounding, layout and the review votes.
 */
export async function withRestatedProcess(input: {
  question: string; turnPlan: TurnPlanV3; eligible: boolean; options: ProcessReviewOptions;
}): Promise<{
  turnPlan: TurnPlanV3; restated: string | null; asked: boolean;
  steps?: RestatedStep[]; stepChecks?: StepCheckResult;
}> {
  const { question, turnPlan } = input;
  const untouched = { turnPlan, restated: null, asked: false };
  if (!input.eligible || turnPlan.visualRequirement === "none" || planStatesChain(turnPlan)) return untouched;
  if (turnPlan.qualitativeClaims.some((claim) => claim.id === RESTATED_PROCESS_CLAIM_ID)) return untouched;
  const gate = deriveSceneGate({ question, turnPlan, problemIR: null });
  if (gate.shouldAttemptLlmScene || !gate.shouldPlanExactScene) return untouched;
  const restated = await writeProcessClaim(question, turnPlan, input.options);
  if (!restated) return { turnPlan, restated: null, asked: true };
  const stepChecks = await checkRestatedSteps(question, turnPlan, restated, input.options);
  if (stepChecks.verdict !== "pass") return { turnPlan, restated: null, asked: true, steps: restated.steps, stepChecks };
  return {
    asked: true,
    restated: restated.text,
    steps: restated.steps,
    stepChecks,
    turnPlan: { ...turnPlan, qualitativeClaims: [...turnPlan.qualitativeClaims, { id: RESTATED_PROCESS_CLAIM_ID, claim: restated.text, expected: true }] },
  };
}

/**
 * A validated block diagram stands only when every process it draws from
 * passes the semantic review (`reviewProcessChains`). Any other verdict turns
 * the candidate into a refusal, so the turn teaches text only. Results
 * without a block diagram pass through untouched and cost nothing.
 */
export async function reviewBlockFlowScene<
  Value extends { document: SceneDocument },
  Result extends { validation: SceneCandidateValidation<Value> },
>(
  result: Result | null,
  input: { question: string; turnPlan: TurnPlanV3; options: ProcessReviewOptions },
): Promise<{ result: Result | null; review: ProcessReviewResult | null }> {
  const document = result?.validation.valid ? result.validation.value?.document : undefined;
  if (!result || !document || !document.constructions.some((construction) => construction.operator === "block_flow")) {
    return { result, review: null };
  }
  const review = await reviewProcessChains(input.question, blockFlowCitedProcesses(document, input.turnPlan), input.options, input.turnPlan);
  if (review.verdict === "process") return { result, review };
  return {
    review,
    result: {
      ...result,
      validation: {
        valid: false,
        errors: [{
          code: BLOCK_FLOW_REVIEW_DECLINED,
          message: `The process review answered ${review.verdict}: the plan's arrows are not shown to be a real sequence.`,
          path: "constructions",
          severity: "fatal",
        }],
      },
    },
  };
}
