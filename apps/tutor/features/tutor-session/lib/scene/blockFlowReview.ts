import { blockFlowCitedProcesses, planStatesChain, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  checkRestatedSteps, RESTATED_PROCESS_CLAIM_ID, reviewProcessChains, writeProcessClaim,
  type ProcessReviewOptions, type ProcessReviewResult, type RestatedStep, type SceneCandidateValidation, type StepCheckResult,
} from "@heytutor/tutor-core";
import { deriveSceneGate } from "./productionSceneSelection";

/** One review call (a vote, the writer or a step check) takes up to about 9 s; a slower one is no answer. */
export const BLOCK_FLOW_REVIEW_TIMEOUT_MS = 20_000;

/**
 * The writer and every step check share one budget, so a restated process can
 * never eat the time scene planning needs (60 s from the start of planning).
 */
export const BLOCK_FLOW_RESTATE_MAX_MS = 25_000;
/** Scene planning keeps at least this much of its deadline after restating. */
export const BLOCK_FLOW_RESTATE_PLANNING_RESERVE_MS = 30_000;
/** Below this budget no restatement is attempted: the checks could not finish. */
export const BLOCK_FLOW_RESTATE_MIN_MS = 8_000;

/** The restatement budget for what is left of the scene deadline. */
export function blockFlowRestateBudgetMs(remainingSceneMs: number): number {
  return Math.min(BLOCK_FLOW_RESTATE_MAX_MS, remainingSceneMs - BLOCK_FLOW_RESTATE_PLANNING_RESERVE_MS);
}

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
  /** Shared by the writer and every step check; under BLOCK_FLOW_RESTATE_MIN_MS nothing is asked. */
  budgetMs?: number;
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
  const budgetMs = input.budgetMs ?? BLOCK_FLOW_RESTATE_MAX_MS;
  if (!(budgetMs >= BLOCK_FLOW_RESTATE_MIN_MS)) return untouched;
  // One deadline for the writer and all checks; when it passes, every call in flight aborts and the plan stays as it was.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), budgetMs);
  const signal = input.options.signal ? anySignal(input.options.signal, deadline.signal) : deadline.signal;
  const options: ProcessReviewOptions = { ...input.options, signal, timeoutMs: Math.min(input.options.timeoutMs, budgetMs) };
  try {
    return await restate(question, turnPlan, options);
  } finally {
    clearTimeout(timer);
  }
}

function anySignal(first: AbortSignal, second: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) abort();
  else {
    first.addEventListener("abort", abort, { once: true });
    second.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

async function restate(question: string, turnPlan: TurnPlanV3, options: ProcessReviewOptions): Promise<{
  turnPlan: TurnPlanV3; restated: string | null; asked: boolean; steps?: RestatedStep[]; stepChecks?: StepCheckResult;
}> {
  const restated = await writeProcessClaim(question, turnPlan, options);
  if (!restated) return { turnPlan, restated: null, asked: true };
  const stepChecks = await checkRestatedSteps(question, turnPlan, restated, options);
  if (options.signal?.aborted) return { turnPlan, restated: null, asked: true, steps: restated.steps, stepChecks: { ...stepChecks, verdict: "unavailable" } };
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
