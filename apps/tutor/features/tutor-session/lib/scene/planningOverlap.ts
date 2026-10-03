/**
 * Overlap the LLM scene planner with ProblemIR without giving up final-facts
 * selection.
 *
 * The planning block used to run strictly in series: turn plan, then ProblemIR
 * plus the solver (up to 18s), then the deterministic figure, then the scene
 * planner with whatever was left of the 60s budget. Production turns spent
 * 55 to 61s there. Scene candidate generation does not need ProblemIR to start,
 * only to be selected: so when the turn plan has landed and ProblemIR is still
 * running, candidates are generated speculatively from the turn plan alone and
 * kept only if ProblemIR leaves every planner input exactly as it was.
 *
 * Authority is unchanged. Reconciliation, the solver audit, the deterministic
 * figure and the exact gate all run on the final facts exactly as before; the
 * speculative run is a head start on the one request the final facts would
 * have made anyway, or it is discarded.
 *
 * Both the live hook and the offline lecture lab run this module, so the bench
 * measures the path students get. Everything with I/O is injected.
 */
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { deepEqual, finalizeScenePlanAfterAuthority } from "./diagramGeneration";

/** What the exact gate decided for one plan, plus the planner request it implies. */
export interface SceneGateCore {
  /** A figure is wanted and the question is not on the chemistry lane. */
  shouldPlanExactScene: boolean;
  /** shouldAttemptExactScene: some family or archetype to compile against. */
  shouldAttemptLlmScene: boolean;
  families: readonly string[];
  archetypeId: string | null;
  /**
   * Everything the scene planner request carries besides the question: the
   * plan context (with the turn plan JSON), operators, predicates, guidance.
   * Deep-equal inputs mean a byte-identical request.
   */
  request: unknown;
}

export interface SceneResultShape {
  candidates: readonly unknown[];
  validation: { valid: boolean };
  repairRounds?: number;
}

export type SpeculationAbortReason =
  /** The deterministic figure was selected on the final facts. */
  | "deterministic"
  /** The final facts infer a different family set or archetype. */
  | "families_changed"
  /** Reconciliation changed a quantity value in the turn plan. */
  | "values_changed"
  /** Same families and values, but the planner request still differs. */
  | "inputs_changed"
  /** The final exact gate would not run the LLM planner at all. */
  | "not_attempted"
  /** No planner budget remains on the final facts. */
  | "budget";

export interface PlanningTelemetry {
  mark(name: string, metadata?: Record<string, unknown>): void;
  span(name: string, parentName?: string): { end(metadata?: Record<string, unknown>): void };
}

export interface ScenePlanningOverlapInput<A, G extends SceneGateCore, F, R extends SceneResultShape> {
  /** The plan after the visual-need merge, before ProblemIR reconciliation. */
  turnPlan: TurnPlanV3;
  /** Null when the turn needs no numeric authority: nothing to overlap. */
  problemAuthority: Promise<A | null> | null;
  /** False on paths that never speculate, such as a recovered scene. */
  speculationAllowed: boolean;
  plannerStartedAt: number;
  deadlineMs: number;
  now?: () => number;
  /** The turn's own abort; merged into every scene planner run. */
  signal?: AbortSignal;
  /** Wraps every await so a superseded turn throws (awaitCurrentTurn). */
  guard?: <T>(operation: Promise<T>) => Promise<T>;
  telemetry?: PlanningTelemetry;
  /** Parent span name for the stage spans. */
  parentSpan?: string;
  deriveGate(plan: TurnPlanV3, authority: A | null): G;
  /** Reconcile and audit exactly as the serial path did. */
  applyAuthority(plan: TurnPlanV3, authority: A): { turnPlan: TurnPlanV3; authority: A };
  /** A solver contradiction keeps the deterministic figure off, as before. */
  fastFigureBlocked(authority: A | null): boolean;
  /** A stored verified scene, validated against the final plan. */
  recover?(gate: G, plan: TurnPlanV3): R | null;
  selectFast(plan: TurnPlanV3, authority: A | null, gate: G): F | null;
  /**
   * One planSceneDocumentWithRepair run whose validator is bound to `plan`.
   * A speculative run passes `holdRepairsUntil`: it generates initial
   * candidates only, and repairs once the run is kept (true) or never (false).
   */
  planScene(
    gate: G,
    plan: TurnPlanV3,
    run: { signal: AbortSignal; timeoutMs: number; holdRepairsUntil?: Promise<boolean> },
  ): Promise<R | null>;
  /** Revalidate every candidate against the final plan. */
  revalidate(result: R, plan: TurnPlanV3): Promise<R>;
}

export interface ScenePlanningOverlapOutcome<A, G, F, R> {
  /** The authoritative plan: reconciled when ProblemIR answered. */
  turnPlan: TurnPlanV3;
  authority: A | null;
  gate: G;
  fast: F | null;
  /** The finalized scene planner result, or the recovered scene. */
  scene: R | null;
  recovered: boolean;
  speculation: {
    started: boolean;
    /** The speculative run produced `scene`. */
    kept: boolean;
    abortReason: SpeculationAbortReason | null;
    /** Scene planning was started again on the final facts. */
    restarted: boolean;
  };
  timings: {
    /** Time spent waiting for ProblemIR after the orchestrator started. */
    authorityWaitMs: number;
    deterministicFigureMs: number;
    /** Start to result of the scene planner run that produced `scene`. */
    scenePlannerMs: number;
    revalidateMs: number;
    revalidateSkipped: boolean | null;
  };
}

/**
 * Speculation starts only where the serial path would reach the LLM planner
 * on these same inputs: ProblemIR is still pending, the exact gate says plan
 * (visual requirement not none, not chemistry, some family or archetype), the
 * budget is not spent, and the deterministic figure does not already resolve
 * from the turn plan alone (when it does, the final facts almost always pick
 * it too, and the speculative calls would only be aborted).
 */
export function shouldStartSpeculativeScene(input: {
  speculationAllowed: boolean;
  authorityPending: boolean;
  gate: SceneGateCore;
  remainingMs: number;
  deterministicPredicted: boolean;
}): boolean {
  return input.speculationAllowed &&
    input.authorityPending &&
    input.gate.shouldPlanExactScene &&
    input.gate.shouldAttemptLlmScene &&
    input.remainingMs > 0 &&
    !input.deterministicPredicted;
}

/**
 * Keep a speculative run only when the final facts would have issued the very
 * same request and validated against the very same plan. Anything else is an
 * abort, and a restart when the final gate still wants the planner.
 *
 * Why a changed value discards candidates rather than revalidating them: the
 * validator checks numbers in the document's `quantities` (by id against the
 * plan, `scene_quantity_mismatch`) and measured values in labels and
 * annotations (`displayed_quantity_unverified`), but not numeric literals in
 * construction inputs, and a stale value can also coincide with another plan
 * quantity. A candidate generated from pre-reconciliation numbers could pass
 * revalidation while its geometry still carries a number the final plan
 * disagrees with, so it is never kept.
 */
export function decideSpeculation(
  speculative: { gate: SceneGateCore; turnPlan: TurnPlanV3 },
  final: {
    gate: SceneGateCore;
    turnPlan: TurnPlanV3;
    deterministicSelected: boolean;
    recovered: boolean;
    remainingMs: number;
  },
): { keep: true } | { keep: false; reason: SpeculationAbortReason; restart: boolean } {
  if (final.deterministicSelected) return { keep: false, reason: "deterministic", restart: false };
  if (final.recovered || !final.gate.shouldAttemptLlmScene) {
    return { keep: false, reason: "not_attempted", restart: false };
  }
  if (final.remainingMs <= 0) return { keep: false, reason: "budget", restart: false };
  if (
    !sameMembers(speculative.gate.families, final.gate.families) ||
    speculative.gate.archetypeId !== final.gate.archetypeId
  ) {
    return { keep: false, reason: "families_changed", restart: true };
  }
  if (speculative.turnPlan !== final.turnPlan && !deepEqual(speculative.turnPlan, final.turnPlan)) {
    return { keep: false, reason: "values_changed", restart: true };
  }
  if (!deepEqual(speculative.gate.request, final.gate.request)) {
    return { keep: false, reason: "inputs_changed", restart: true };
  }
  return { keep: true };
}

export async function runScenePlanningOverlap<A, G extends SceneGateCore, F, R extends SceneResultShape>(
  input: ScenePlanningOverlapInput<A, G, F, R>,
): Promise<ScenePlanningOverlapOutcome<A, G, F, R>> {
  const now = input.now ?? Date.now;
  const guard = input.guard ?? (<T,>(operation: Promise<T>) => operation);
  const remainingMs = () => Math.max(0, input.deadlineMs - (now() - input.plannerStartedAt));
  const parent = input.parentSpan;
  const timings: ScenePlanningOverlapOutcome<A, G, F, R>["timings"] = {
    authorityWaitMs: 0,
    deterministicFigureMs: 0,
    scenePlannerMs: 0,
    revalidateMs: 0,
    revalidateSkipped: null,
  };

  type Run = {
    controller: AbortController;
    /** Speculative runs only: settle true to allow repairs, false to forbid them. */
    releaseRepairs: ((release: boolean) => void) | null;
    spanEnded: boolean;
    promise: Promise<R | null>;
    startedAt: number;
    gate: G;
    turnPlan: TurnPlanV3;
    span: { end(metadata?: Record<string, unknown>): void } | undefined;
    speculative: boolean;
    restarted: boolean;
  };
  const inFlight = new Set<Run>();
  const startRun = (gate: G, turnPlan: TurnPlanV3, speculative: boolean, restarted: boolean): Run => {
    const controller = new AbortController();
    const signal = input.signal ? mergeAbortSignals(input.signal, controller.signal) : controller.signal;
    const span = input.telemetry?.span("scene-planner", parent);
    const startedAt = now();
    // A discarded speculative run used to have launched a repair batch already
    // (up to four calls) by the time ProblemIR answered. Its repairs now wait
    // for the keep decision, inside the same budget.
    let releaseRepairs: ((release: boolean) => void) | null = null;
    const holdRepairsUntil = speculative
      ? new Promise<boolean>((resolve) => {
          releaseRepairs = resolve;
        })
      : undefined;
    const promise = input.planScene(gate, turnPlan, {
      signal,
      timeoutMs: remainingMs(),
      ...(holdRepairsUntil ? { holdRepairsUntil } : {}),
    });
    // An abandoned run settles on its own; nothing may observe its result.
    promise.catch(() => {});
    const run: Run = {
      controller,
      releaseRepairs,
      spanEnded: false,
      promise,
      startedAt,
      gate,
      turnPlan,
      span,
      speculative,
      restarted,
    };
    inFlight.add(run);
    return run;
  };
  const endRunSpan = (run: Run, metadata: Record<string, unknown>) => {
    if (run.spanEnded) return;
    run.spanEnded = true;
    run.span?.end(metadata);
  };
  const stopRun = (run: Run, metadata: Record<string, unknown>) => {
    run.releaseRepairs?.(false);
    run.controller.abort();
    inFlight.delete(run);
    endRunSpan(run, metadata);
  };
  const finishRun = async (run: Run): Promise<R | null> => {
    const result = await guard(run.promise);
    inFlight.delete(run);
    timings.scenePlannerMs = now() - run.startedAt;
    endRunSpan(run, {
      speculative: run.speculative,
      restarted: run.restarted,
      candidates: result?.candidates.length ?? 0,
      repair_rounds: result?.repairRounds ?? 0,
      valid: result?.validation.valid ?? false,
    });
    return result;
  };

  let speculative: Run | null = null;
  try {
    let authorityPending = false;
    const authorityPromise = input.problemAuthority
      ? input.problemAuthority.finally(() => {
          authorityPending = false;
        })
      : null;
    if (authorityPromise) {
      authorityPending = true;
      // Let an authority that has already answered report itself first.
      await Promise.resolve();
    }

    if (input.speculationAllowed && authorityPending) {
      const gate = input.deriveGate(input.turnPlan, null);
      const budgetMs = remainingMs();
      const eligible = gate.shouldPlanExactScene && gate.shouldAttemptLlmScene && budgetMs > 0;
      const deterministicPredicted = eligible && input.selectFast(input.turnPlan, null, gate) !== null;
      if (shouldStartSpeculativeScene({
        speculationAllowed: input.speculationAllowed,
        authorityPending,
        gate,
        remainingMs: budgetMs,
        deterministicPredicted,
      })) {
        speculative = startRun(gate, input.turnPlan, true, false);
        input.telemetry?.mark("scene-speculative-start", {
          family_count: gate.families.length,
          has_archetype: gate.archetypeId !== null,
          budget_ms: budgetMs,
        });
      } else if (eligible && deterministicPredicted) {
        input.telemetry?.mark("scene-speculative-skip", { reason: "deterministic_predicted" });
      }
    }

    let authority: A | null = null;
    let turnPlan = input.turnPlan;
    if (authorityPromise) {
      const waitStartedAt = now();
      authority = await guard(authorityPromise);
      timings.authorityWaitMs = now() - waitStartedAt;
    }
    if (authority) ({ turnPlan, authority } = input.applyAuthority(turnPlan, authority));

    const gate = input.deriveGate(turnPlan, authority);
    let scene = input.recover?.(gate, turnPlan) ?? null;
    const recovered = scene !== null;

    let fast: F | null = null;
    if (!scene && gate.shouldPlanExactScene && !input.fastFigureBlocked(authority)) {
      const span = input.telemetry?.span("deterministic-figure", parent);
      const fastStartedAt = now();
      fast = input.selectFast(turnPlan, authority, gate);
      timings.deterministicFigureMs = now() - fastStartedAt;
      span?.end({ selected: fast !== null });
    }

    let validatedAgainst: TurnPlanV3 = turnPlan;
    let abortReason: SpeculationAbortReason | null = null;
    let restarted = false;
    let kept = false;
    let run: Run | null = null;
    if (speculative) {
      const decision = decideSpeculation(
        { gate: speculative.gate, turnPlan: speculative.turnPlan },
        { gate, turnPlan, deterministicSelected: fast !== null, recovered, remainingMs: remainingMs() },
      );
      if (decision.keep) {
        run = speculative;
        kept = true;
        validatedAgainst = speculative.turnPlan;
        speculative.releaseRepairs?.(true);
      } else {
        abortReason = decision.reason;
        stopRun(speculative, { speculative: true, restarted: false, aborted: decision.reason });
        input.telemetry?.mark("scene-speculative-abort", { reason: decision.reason });
        speculative = null;
        if (decision.restart) {
          run = startRun(gate, turnPlan, false, true);
          restarted = true;
        }
      }
    } else if (!scene && !fast && gate.shouldAttemptLlmScene && remainingMs() > 0) {
      run = startRun(gate, turnPlan, false, false);
    }
    if (run) scene = await finishRun(run);

    if (scene) {
      const span = input.telemetry?.span("revalidate", parent);
      const revalidateStartedAt = now();
      let revalidated = false;
      const finalized = await guard(finalizeScenePlanAfterAuthority(scene, {
        problemAuthorityAvailable: authority !== null,
        planningTurnPlan: validatedAgainst,
        authoritativeTurnPlan: turnPlan,
        // Every validator here is bound to the plan it was handed and nothing
        // else, so an identical final plan cannot change any verdict.
        candidatesValidatedAgainst: validatedAgainst,
        revalidate: (result) => {
          revalidated = true;
          return input.revalidate(result, turnPlan);
        },
      }));
      scene = finalized;
      timings.revalidateMs = now() - revalidateStartedAt;
      timings.revalidateSkipped = !revalidated;
      span?.end({ skipped: !revalidated });
    }

    return {
      turnPlan,
      authority,
      gate,
      fast,
      scene,
      recovered,
      speculation: { started: kept || abortReason !== null, kept, abortReason, restarted },
      timings,
    };
  } finally {
    // A cancelled turn or a thrown authority never leaves a planner running,
    // and its span still closes.
    for (const run of [...inFlight]) {
      stopRun(run, { speculative: run.speculative, restarted: run.restarted, aborted: true });
    }
  }
}

function sameMembers(first: readonly string[], second: readonly string[]): boolean {
  const left = new Set(first);
  const right = new Set(second);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function mergeAbortSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  if (first.aborted) return first;
  if (second.aborted) return second;
  const controller = new AbortController();
  const abort = () => controller.abort();
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
