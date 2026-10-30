import { blockFlowCitedProcesses, planStatesChain, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  checkRestatedSteps, RESTATED_PROCESS_CLAIM_ID, reviewProcessChains, writeProcessClaim,
  type ProcessReviewOptions, type ProcessReviewResult, type RestatedStep, type SceneCandidateValidation, type StepCheckResult,
} from "@heytutor/tutor-core";
import { deriveSceneGate } from "./productionSceneSelection";

/** One review call (a vote, the writer or a step check) takes up to about 9 s; a slower one is no answer. */
export const BLOCK_FLOW_REVIEW_TIMEOUT_MS = 20_000;

/**
 * The writer and the step checks each have their own budget: a slow writer
 * used to eat the one shared budget and leave the checks none. The checks'
 * budget starts when the writer returns.
 */
export const BLOCK_FLOW_WRITER_MAX_MS = 12_000;
export const BLOCK_FLOW_STEP_CHECKS_MAX_MS = 15_000;
/**
 * Scene planning keeps at least this much of its deadline (60 s from the start
 * of planning) after restating: both budgets end by then.
 */
export const BLOCK_FLOW_RESTATE_PLANNING_RESERVE_MS = 30_000;
/** Below this much time before the reserve, no restatement is attempted: the checks could not finish. */
export const BLOCK_FLOW_RESTATE_MIN_MS = 8_000;

/** The writer's and the checks' ceilings; the gate shortens them to keep its rows fast. */
export interface BlockFlowRestateLimits { writerMaxMs: number; checksMaxMs: number }
const RESTATE_LIMITS: BlockFlowRestateLimits = { writerMaxMs: BLOCK_FLOW_WRITER_MAX_MS, checksMaxMs: BLOCK_FLOW_STEP_CHECKS_MAX_MS };

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
  /**
   * What is left of the scene deadline now. Both budgets end before the
   * planning reserve; under BLOCK_FLOW_RESTATE_MIN_MS before it nothing is
   * asked. Absent, only the writer's and the checks' own ceilings apply.
   */
  sceneRemainingMs?: number;
  limits?: Partial<BlockFlowRestateLimits>;
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
  const limits = { ...RESTATE_LIMITS, ...input.limits };
  const startedAt = Date.now();
  // Time left before scene planning's reserve; both budgets end by then.
  const sceneLeftMs = () => (input.sceneRemainingMs ?? Number.POSITIVE_INFINITY) - BLOCK_FLOW_RESTATE_PLANNING_RESERVE_MS - (Date.now() - startedAt);
  if (!(sceneLeftMs() >= BLOCK_FLOW_RESTATE_MIN_MS)) return untouched;
  const restated = await withBudget(input.options, Math.min(limits.writerMaxMs, sceneLeftMs()),
    (options) => writeProcessClaim(question, turnPlan, options));
  if (!restated) return { turnPlan, restated: null, asked: true };
  // The checks' own budget starts now, so the writer's time is never theirs.
  const checksMs = Math.min(limits.checksMaxMs, sceneLeftMs());
  // No time left before the reserve: no check is asked, and the plan stays as it was.
  if (!(checksMs > 0)) return { turnPlan, restated: null, asked: true, steps: restated.steps, stepChecks: { verdict: "unavailable", checks: restated.steps.map(() => null) } };
  const checked = await withBudget(input.options, checksMs, async (options) => ({
    stepChecks: await checkRestatedSteps(question, turnPlan, restated, options), ranOut: options.signal!.aborted,
  }));
  // A check that did not finish keeps the plan as it was.
  if (checked.ranOut) return { turnPlan, restated: null, asked: true, steps: restated.steps, stepChecks: { ...checked.stepChecks, verdict: "unavailable" } };
  const { stepChecks } = checked;
  if (stepChecks.verdict !== "pass") return { turnPlan, restated: null, asked: true, steps: restated.steps, stepChecks };
  return {
    asked: true,
    restated: restated.text,
    steps: restated.steps,
    stepChecks,
    turnPlan: { ...turnPlan, qualitativeClaims: [...turnPlan.qualitativeClaims, { id: RESTATED_PROCESS_CLAIM_ID, claim: restated.text, expected: true }] },
  };
}

/** Runs `body` with every call bounded by `budgetMs`: when it passes, every call in flight aborts. */
async function withBudget<T>(base: ProcessReviewOptions, budgetMs: number, body: (options: ProcessReviewOptions) => Promise<T>): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), Math.max(0, budgetMs));
  const signal = base.signal ? anySignal(base.signal, deadline.signal) : deadline.signal;
  try {
    return await body({ ...base, signal, timeoutMs: Math.max(1, Math.min(base.timeoutMs, budgetMs)) });
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
