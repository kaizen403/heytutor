import { withFastModeHeader } from "../llm/fastMode";
import { withTurnTraceHeaders } from "../llm/traceHeaders";
import { tutorDebug } from "../tutorDebug";
import {
  buildSceneDocumentPlannerPrompt,
  SCENE_DOCUMENT_VERSION,
  type ScenePlannerPromptContext,
} from "./scenePlannerV2Prompt";

export type SceneDocumentCandidate = Record<string, unknown>;
export type ScenePlannerLane = "primary" | "alternate";

export interface SceneRepairError {
  code: string;
  message: string;
  severity: "fatal" | "warning";
  path?: string;
  entityIds?: string[];
  expected?: unknown;
  actual?: unknown;
  residual?: number;
  details?: Record<string, unknown>;
}

export interface SceneCandidateValidation<T = unknown> {
  valid: boolean;
  errors: SceneRepairError[];
  value?: T;
  /** Deterministic visual/minimality cost for valid candidates; lower wins. */
  qualityScore?: number;
}

export interface ScenePlannerResponse {
  document: SceneDocumentCandidate;
  rawContent: string;
  phase: "plan" | "repair";
  lane: ScenePlannerLane;
  elapsedMs: number;
  traceId?: string;
  strategy?: string;
}

export interface ScenePlannerOptions extends ScenePlannerPromptContext {
  proxyUrl: string;
  sessionId?: string;
  /** Client-generated Langfuse turn id shared with teaching and TTS. */
  traceId?: string;
  signal?: AbortSignal;
  /** Total plan/repair hard deadline. Defaults to sixty seconds. */
  timeoutMs?: number;
  fastMode?: boolean;
  /** Evaluation diagnostics for every HTTP attempt, including null candidates. */
  onRequestOutcome?: (outcome: ScenePlannerRequestOutcome) => void;
  /** Optional private diagnostics, including responses from discarded speculative searches. */
  onResponse?: (response: ScenePlannerResponse) => void;
  onCandidateValidation?: (response: ScenePlannerResponse, validation: SceneCandidateValidation) => void;
}

export interface ScenePlannerRequestOutcome {
  phase: "plan" | "repair";
  lane: ScenePlannerLane;
  httpStatus: number | null;
  error: string | null;
  /** True only when the model body contained a parseable scene JSON object. */
  bodyParsed: boolean;
  promptChars: number;
  elapsedMs: number;
  /** Model-stated refusal, never the deterministic fallback's reason. */
  declineReason?: string | null;
}

export interface ScenePlannerCandidateDiagnostics {
  declineReason: string | null;
  rejectedCalls: Array<{ constructionId: string | null; operator: string; rawArguments: string; truncated: boolean }>;
}

/** Private evaluation evidence. Preserve rejected inputs without unbounded records. */
export function scenePlannerCandidateDiagnostics(
  document: SceneDocumentCandidate,
  valid: boolean,
): ScenePlannerCandidateDiagnostics {
  const decision = isPlainObject(document.visualDecision) ? document.visualDecision : null;
  const declined = decision?.mode === "text_only" || document.visualDecision === "text_only";
  const source = isPlainObject(document.source) ? document.source : null;
  const declineReason = declined
    ? [decision?.reason, source?.visualLimitation, document.declineReason, document.reason]
        .find((value): value is string => typeof value === "string" && value.trim() !== "") ?? null
    : null;
  const rejectedCalls = !valid && Array.isArray(document.constructions)
    ? document.constructions.flatMap((construction) => {
        if (!isPlainObject(construction) || typeof construction.operator !== "string") return [];
        const bytes = new TextEncoder().encode(JSON.stringify(construction.inputs ?? null));
        return [{
          constructionId: typeof construction.id === "string" ? construction.id : null,
          operator: construction.operator,
          rawArguments: new TextDecoder().decode(bytes.slice(0, 2048), { stream: true }),
          truncated: bytes.length > 2048,
        }];
      })
    : [];
  return { declineReason, rejectedCalls };
}

export interface ScenePlanWithRepairResult<T> {
  response: ScenePlannerResponse;
  validation: SceneCandidateValidation<T>;
  repaired: boolean;
  /** Repair batches launched by the search (each is REPAIR_CANDIDATES_PER_ROUND calls). */
  repairRounds?: number;
  /** The selected candidate is itself a repair (`repaired` only says a round produced one). */
  selectedFromRepair?: boolean;
  candidates: ScenePlanCandidateResult<T>[];
}

export interface ScenePlanCandidateResult<T> {
  candidateId: string;
  response: ScenePlannerResponse;
  validation: SceneCandidateValidation<T>;
  score: number;
  selected: boolean;
}

export type SceneCandidateValidator<T> = (
  document: SceneDocumentCandidate,
) => SceneCandidateValidation<T> | Promise<SceneCandidateValidation<T>>;

export const SCENE_PLANNER_TIMEOUT_MS = 60_000;
const PLANNER_MODEL = "server";
const MAX_SCENE_REPAIR_ROUNDS = 2;
const REPAIR_CANDIDATES_PER_ROUND = 2;
const INITIAL_SCENE_CANDIDATES = 2;
const INITIAL_CANDIDATE_TIMEOUT_MS = 30_000;
const VALID_CANDIDATE_GRACE_MS = 750;

/** Plan a coordinate-free scene. Semantic validation belongs to scene-engine. */
export async function planSceneDocument(
  question: string,
  options: ScenePlannerOptions,
  strategy?: string,
  lane: ScenePlannerLane = "primary",
): Promise<ScenePlannerResponse | null> {
  const prompt = buildSceneDocumentPlannerPrompt(question, options);
  const response = await requestSceneDocument(
    "plan",
    strategy ? `${prompt}\n\nSYNTHESIS STRATEGY\n${strategy}` : prompt,
    options,
    lane,
    question,
  );
  return response
    ? {
        ...response,
        document: normalizeSceneDocumentModelOutput(response.document, question),
        strategy,
      }
    : null;
}

/**
 * Ask the planner for one complete replacement document using deterministic
 * validation failures. This never patches or trusts the invalid candidate.
 */
export async function repairSceneDocument(
  question: string,
  candidate: SceneDocumentCandidate,
  errors: readonly SceneRepairError[],
  options: ScenePlannerOptions,
  strategy = "Apply the smallest coherent correction that resolves every error.",
  lane: ScenePlannerLane = "primary",
): Promise<ScenePlannerResponse | null> {
  if (errors.length === 0) return null;

  const previousStructure = summarizeSceneCandidateForRepair(candidate);
  const usedOperators = Array.isArray(candidate.constructions)
    ? candidate.constructions.flatMap((construction) =>
      isPlainObject(construction) && typeof construction.operator === "string" ? [construction.operator] : [])
    : [];
  const prompt = `${buildSceneDocumentPlannerPrompt(question, options, usedOperators)}

REPAIR REQUEST
Replace all JSON,not a patch. Rebuild failed geometry from authoritative facts/supported operators.

PREVIOUS STRUCTURE
${JSON.stringify(previousStructure)}

STRUCTURED VALIDATION ERRORS
${JSON.stringify(errors)}

Resolve all fatal errors. Reuse useful stable IDs; delete invalid/duplicate/unneeded entities. Hide consumed helpers; label real targets. Preserve authoritative claims/proofs,never weaken assertions; repair geometry. Replacement JSON only.`;
  const connectivityGuidance = errors.some((error) =>
    (error.code === "assertion_failed" && /connect|path|terminal/i.test(error.message)) ||
    error.code === "turnplan_loop_member_not_proven",
  )
    ? "\nConnectivity/path:adjacent paths/components share endpoint IDs. Visual proximity is not connectivity. Rebuild geometry,never rewrite its assertion."
    : "";
  const closedRouteMembers = [...new Set(errors.flatMap((error) =>
    error.code === "turnplan_loop_member_not_proven" ? error.entityIds ?? [] : []))];
  const closedRouteGuidance = closedRouteMembers.length > 0
    ? `\nCLOSED-ROUTE REBUILD (mandatory): ${closedRouteMembers.join(", ")} must form one nondegenerate closed route:cyclic shared IDs p0...pN,adjacent members share IDs. Coordinates/crossings/overlaps/on/decorative polylines prove no connectivity. Component symbols replace side segments; preserve authoritative cardinal directions.`
    : "";
  const bypassedMembers = [...new Set(errors.flatMap((error) =>
    error.code === "turnplan_loop_member_bypassed" ? error.entityIds ?? [] : []))];
  const bypassGuidance = bypassedMembers.length > 0
    ? `\nCOMPONENT BYPASS REMOVAL (mandatory): inspect ${bypassedMembers.join(", ")}. Keep each component symbol as the only edge between its two terminals and delete every ordinary segment/connect with the same terminal pair. Rebuild adjacent route members around the component's endpoints; do not redraw a wire through or behind the symbol.`
    : "";
  const orderedRouteGuidance = buildOrderedRouteRepairGuidance(errors, options.conversationContext);
  const pageNormalGuidance = errors.some((error) =>
    error.code === "physical_page_normal_rendered_in_plane" ||
    error.code === "physical_page_normal_direction_not_proven")
    ? "\nPAGE-NORMAL REBUILD (mandatory): retain the named field/vector entity and construct it with a point-id start plus direction [0,0,-1] for into-page or [0,0,1] for out-of-page. Give that construction exactly one output matching the entity ID. Do not substitute a 2D arrow or prose label."
    : "";
  const waveOpticsGuidance = buildWaveOpticsRepairGuidance(errors);
  const opticalInstrumentGuidance = buildOpticalInstrumentRepairGuidance(errors);

  const diversifiedPrompt = `${prompt}${connectivityGuidance}${closedRouteGuidance}${bypassGuidance}${orderedRouteGuidance}${pageNormalGuidance}${waveOpticsGuidance}${opticalInstrumentGuidance}\n\nREPAIR STRATEGY\n${strategy}`;

  const response = await requestSceneDocument("repair", diversifiedPrompt, options, lane, question);
  return response
    ? {
        ...response,
        document: normalizeSceneDocumentModelOutput(response.document, question),
        strategy,
      }
    : null;
}

const ENGINE_ONLY_SOURCE_KEYS = ["synthesizedDsa", "dsaTraceFrame", "dsaFitBox"] as const;

/**
 * Canonicalize provenance that is already fixed by the request envelope. This
 * deliberately leaves all mathematical content untouched for scene-engine to
 * validate. An explicit source.question is never overwritten, so a conflicting
 * model claim still fails the server persistence boundary.
 */
export function normalizeSceneDocumentModelOutput(
  document: SceneDocumentCandidate,
  question: string,
): SceneDocumentCandidate {
  // Markers that only the engine's own DSA trace builder may set. A model
  // that writes them must not inherit that builder's trust.
  if (isPlainObject(document.source) && ENGINE_ONLY_SOURCE_KEYS.some((key) => key in (document.source as Record<string, unknown>))) {
    const source = { ...(document.source as Record<string, unknown>) };
    for (const key of ENGINE_ONLY_SOURCE_KEYS) delete source[key];
    document = { ...document, source };
  }
  if (isPlainObject(document.source)) {
    return typeof document.source.question === "string"
      ? document
      : { ...document, source: { ...document.source, question } };
  }
  if (typeof document.source === "string") {
    return {
      ...document,
      source: {
        question,
        sourceLabel: document.source,
      },
    };
  }
  if (document.source === undefined) {
    return {
      ...document,
      source: { question },
    };
  }
  return document;
}

function summarizeSceneCandidateForRepair(
  candidate: SceneDocumentCandidate,
): Record<string, unknown> {
  const shortMetadata = Object.fromEntries(Object.entries(candidate).flatMap(([key, value]) =>
    (typeof value === "string" && value.length <= 120) || typeof value === "number" || typeof value === "boolean"
      ? [[key, value]]
      : []));
  const ids = (field: string): string[] => Array.isArray(candidate[field])
    ? candidate[field].flatMap((item) =>
        isPlainObject(item) && typeof item.id === "string" ? [item.id] : [])
    : [];
  const constructions = Array.isArray(candidate.constructions)
    ? candidate.constructions.flatMap((item) => isPlainObject(item)
      ? [{
          id: typeof item.id === "string" ? item.id : undefined,
          operator: typeof item.operator === "string" ? item.operator : undefined,
          outputs: Array.isArray(item.outputs)
            ? item.outputs.filter((output): output is string => typeof output === "string")
            : [],
        }]
      : [])
    : [];
  return {
    ...shortMetadata,
    quantityIds: ids("quantities"),
    entityIds: ids("entities"),
    constructions,
    assertionIds: ids("assertions"),
    requiredEntityIds: Array.isArray(candidate.requiredEntityIds)
      ? candidate.requiredEntityIds.filter((id): id is string => typeof id === "string")
      : [],
    revealGroupIds: ids("revealGroups"),
  };
}

/**
 * Plan, validate, and conditionally replace within one shared time budget.
 * The caller supplies scene-engine validation to keep this package transport-only.
 *
 * Repair starts as soon as a candidate is evaluated invalid. It used to wait
 * for both initial candidates: when neither was valid the slower one (up to
 * the 30s candidate cap) gated every repair, so a turn whose first candidate
 * failed at 10s sat idle until the second failed too. Now:
 *
 * - A repair round is one batch of REPAIR_CANDIDATES_PER_ROUND parallel
 *   replacements seeded from a single invalid candidate, and at most
 *   MAX_SCENE_REPAIR_ROUNDS batches are launched per search, so the repair
 *   call ceiling (2 x 2) is unchanged. Each batch is seeded from the best
 *   invalid candidate evaluated so far that has not seeded a batch yet; the
 *   first batch can therefore start while the other initial candidate is
 *   still pending.
 * - The next batch launches when every call of the previous batch has
 *   settled, or as soon as one of them has settled and a strictly better seed
 *   than the previous batch's is waiting. A first batch seeded early from the
 *   worse initial candidate no longer holds the better one back for a whole
 *   round, and one stalled call cannot starve the second round.
 * - Every repair call is capped at INITIAL_CANDIDATE_TIMEOUT_MS, like the
 *   initial candidates, instead of the whole remaining budget (up to ~50s).
 * - Candidates that have already arrived are evaluated before a seed is
 *   picked, so two answers that land together are still compared first.
 * - The first valid candidate anywhere (initial or repair) stops new repair
 *   batches, opens the 750ms grace window, and every request still pending
 *   when it closes is aborted.
 * - Selection is compareValidations over every evaluated candidate.
 *
 * `holdValidationUntil` lets a speculative caller fetch initial candidates
 * without spending anything else on them: they are neither validated nor
 * repaired until it settles true, and never if it settles false. Validation
 * compiles every candidate, which costs 1 to 3 s of main thread each, so a
 * discarded speculative run must not have compiled anything. A held search
 * with fetched candidates waits for the decision instead of returning.
 *
 * Billing admits at most four "ai" calls in flight per user and twelve
 * planner calls per trace, and refuses the rest. `maxConcurrentRequests`
 * bounds this search's own requests in flight (a repair batch waits rather
 * than exceed it), and `requestBudget` is a counter shared by every search in
 * the turn: each request spends one, and a search that has none left stops
 * launching (a repair batch shrinks to what is left).
 */
export async function planSceneDocumentWithRepair<T>(
  question: string,
  validate: SceneCandidateValidator<T>,
  options: ScenePlannerOptions & {
    holdValidationUntil?: Promise<boolean>;
    maxConcurrentRequests?: number;
    requestBudget?: { remaining: number };
  },
): Promise<ScenePlanWithRepairResult<T> | null> {
  const startedAt = Date.now();
  const { holdValidationUntil, maxConcurrentRequests, requestBudget, ...plannerOptions } = options;
  const maxInFlight = maxConcurrentRequests ?? Number.POSITIVE_INFINITY;
  const budgetLeft = () => requestBudget?.remaining ?? Number.POSITIVE_INFINITY;
  const timeoutMs = plannerOptions.timeoutMs ?? SCENE_PLANNER_TIMEOUT_MS;
  const remainingMs = () => timeoutMs - (Date.now() - startedAt);
  const initialStrategies = [
    "Build the smallest sufficient scene. Derive every result, and add only assertions required to prove the question's stated relationships.",
    "Start from the exact quantities and invariants, then synthesize a minimal construction graph whose outputs satisfy them without duplicate geometry.",
    "Construct the proof obligations first, then add only the geometry needed to satisfy them; add compact annotations last.",
    "Use the fewest deterministic operators possible, audit every reference and sign, and omit all optional helpers or decorative ink.",
  ].slice(0, INITIAL_SCENE_CANDIDATES);
  const repairStrategies = [
    "Apply the smallest coherent correction that resolves every error while preserving valid geometry.",
    "Rebuild the failing construction subgraph from first principles; reuse valid entities but remove duplicate or weakly justified geometry.",
  ].slice(0, REPAIR_CANDIDATES_PER_ROUND);

  type Evaluated = {
    response: ScenePlannerResponse;
    validation: SceneCandidateValidation<T>;
    seededRepair: boolean;
  };
  type Round = { seed: Evaluated; calls: number; settled: number };
  type Settled = { key: number; candidate: ScenePlannerResponse | null };
  type InFlight = {
    kind: "plan" | "repair";
    round: Round | null;
    controller: AbortController;
    promise: Promise<Settled>;
    settled: Settled | null;
  };
  const evaluated: Evaluated[] = [];
  const inFlight = new Map<number, InFlight>();
  const rounds: Round[] = [];
  let nextKey = 0;
  let firstValidAt: number | null = null;
  let fallbackPlanLaunched = false;
  let released = holdValidationUntil === undefined;
  const releaseMarker: unique symbol = Symbol("validation-released");
  const releaseDecision = holdValidationUntil?.then(
    (release): typeof releaseMarker => {
      released = release;
      return releaseMarker;
    },
    (): typeof releaseMarker => releaseMarker,
  );
  let releaseDecided = holdValidationUntil === undefined;
  /** Fetched while held, in arrival order; validated only once released. */
  const held: ScenePlannerResponse[] = [];
  void releaseDecision?.then(() => {
    releaseDecided = true;
  });

  const launch = (
    kind: InFlight["kind"],
    round: Round | null,
    request: (signal: AbortSignal) => Promise<ScenePlannerResponse | null>,
  ) => {
    const key = nextKey;
    nextKey += 1;
    if (requestBudget) requestBudget.remaining -= 1;
    const controller = new AbortController();
    const signal = plannerOptions.signal
      ? mergeAbortSignals(plannerOptions.signal, controller.signal)
      : controller.signal;
    const entry: InFlight = {
      kind,
      round,
      controller,
      settled: null,
      promise: request(signal).then((candidate) => {
        entry.settled = { key, candidate };
        return entry.settled;
      }),
    };
    inFlight.set(key, entry);
  };

  const collect = (settled: Settled): ScenePlannerResponse | null => {
    const round = inFlight.get(settled.key)?.round;
    inFlight.delete(settled.key);
    if (round) round.settled += 1;
    return settled.candidate;
  };
  const evaluate = async (candidate: ScenePlannerResponse) => {
    const candidateValidation = await validate(candidate.document);
    notifySceneObserver(() => plannerOptions.onCandidateValidation?.(candidate, candidateValidation));
    tutorDebug("planner", "semantic scene candidate validation", {
      phase: candidate.phase,
      valid: candidateValidation.valid,
      error_codes: candidateValidation.errors.map((error) => error.code),
      fatal_count: candidateValidation.errors.filter((error) => error.severity === "fatal").length,
    });
    evaluated.push({ response: candidate, validation: candidateValidation, seededRepair: false });
    if (candidateValidation.valid && firstValidAt === null) firstValidAt = Date.now();
  };

  // Every initial plan settled without a parseable candidate: one serial plan
  // with the rest of the budget, exactly as before.
  const maybeLaunchFallbackPlan = () => {
    if (fallbackPlanLaunched || evaluated.length > 0 || held.length > 0 || inFlight.size > 0) return;
    if (plannerOptions.signal?.aborted || budgetLeft() < 1) return;
    const budgetMs = remainingMs();
    if (budgetMs <= 0) return;
    fallbackPlanLaunched = true;
    launch("plan", null, (signal) => planSceneDocument(question, { ...plannerOptions, signal, timeoutMs: budgetMs }));
  };

  const nextSeed = () => evaluated
    .filter((entry) => !entry.validation.valid && entry.validation.errors.length > 0 && !entry.seededRepair)
    .sort((a, b) => compareValidations(a.validation, b.validation))[0];
  /** Rounds remain and a seed exists: only the hold or the previous round stand in the way. */
  const repairPossible = () =>
    firstValidAt === null && rounds.length < MAX_SCENE_REPAIR_ROUNDS && budgetLeft() >= 1 &&
    nextSeed() !== undefined;

  const maybeLaunchRepairRound = () => {
    if (!released || !repairPossible()) return;
    if (plannerOptions.signal?.aborted) return;
    const budgetMs = remainingMs();
    if (budgetMs <= 0) return;
    const roundStrategies = repairStrategies.slice(0, Math.min(repairStrategies.length, budgetLeft()));
    if (inFlight.size + roundStrategies.length > maxInFlight) return;
    const seed = nextSeed()!;
    const previous = rounds.at(-1);
    if (previous && previous.settled < previous.calls) {
      const strictlyBetter = compareValidations(seed.validation, previous.seed.validation) < 0;
      if (previous.settled === 0 || !strictlyBetter) return;
    }
    seed.seededRepair = true;
    const round: Round = { seed, calls: roundStrategies.length, settled: 0 };
    rounds.push(round);
    tutorDebug("planner", "semantic scene repair round", {
      round: rounds.length,
      seed_phase: seed.response.phase,
      pending_initial: [...inFlight.values()].filter((entry) => entry.kind === "plan").length,
      fatal_count: seed.validation.errors.filter((error) => error.severity === "fatal").length,
    });
    const callTimeoutMs = Math.min(budgetMs, INITIAL_CANDIDATE_TIMEOUT_MS);
    roundStrategies.forEach((strategy, index) => {
      launch("repair", round, (signal) => repairSceneDocument(
        question,
        seed.response.document,
        seed.validation.errors,
        { ...plannerOptions, signal, timeoutMs: callTimeoutMs },
        strategy,
        index === 0 ? "primary" : "alternate",
      ));
    });
  };

  const candidateTimeoutMs = Math.min(timeoutMs, INITIAL_CANDIDATE_TIMEOUT_MS);
  initialStrategies.slice(0, Math.max(0, Math.min(budgetLeft(), maxInFlight))).forEach((strategy, index) => {
    launch("plan", null, (signal) => planSceneDocument(
      question,
      { ...plannerOptions, signal, timeoutMs: candidateTimeoutMs },
      strategy,
      index === 0 ? "primary" : "alternate",
    ));
  });

  for (;;) {
    const hardRemainingMs = remainingMs();
    const waitMs = firstValidAt === null
      ? hardRemainingMs
      : Math.min(hardRemainingMs, VALID_CANDIDATE_GRACE_MS - (Date.now() - firstValidAt));
    if (waitMs <= 0 || plannerOptions.signal?.aborted) break;

    // Evaluate everything that has already arrived before choosing a seed.
    const arrived = [...inFlight.values()].flatMap((entry) => entry.settled ? [entry.settled] : []);
    for (const settled of arrived) {
      const candidate = collect(settled);
      if (!candidate) continue;
      if (released) await evaluate(candidate);
      else held.push(candidate);
    }
    if (released && held.length > 0) {
      for (const candidate of held.splice(0)) await evaluate(candidate);
      continue;
    }
    if (arrived.length > 0) continue;
    if (releaseDecided && !released) break;

    maybeLaunchFallbackPlan();
    maybeLaunchRepairRound();
    const awaitingRelease = !releaseDecided && held.length > 0;
    if (inFlight.size === 0 && !awaitingRelease) break;

    const timeoutMarker = Symbol("candidate-wait-timeout");
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      ...[...inFlight.values()].filter((entry) => !entry.settled).map((entry) => entry.promise),
      ...(releaseDecision && !releaseDecided ? [releaseDecision] : []),
      new Promise<typeof timeoutMarker>((resolve) => {
        timeoutId = setTimeout(() => resolve(timeoutMarker), waitMs);
      }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    if (settled === timeoutMarker) break;
    if (settled === releaseMarker) {
      releaseDecided = true;
      continue;
    }
    // The arrived scan at the top collects it, in arrival order.
  }
  for (const entry of inFlight.values()) entry.controller.abort();

  if (evaluated.length === 0) return null;
  const ranked = [...evaluated].sort((a, b) => compareValidations(a.validation, b.validation));
  const selected = ranked[0]!;
  const { response, validation } = selected;
  tutorDebug("planner", "semantic scene validation", {
    phase: response.phase,
    valid: validation.valid,
    error_codes: validation.errors.map((error) => error.code),
    fatal_count: validation.errors.filter((error) => error.severity === "fatal").length,
    repair_rounds: rounds.length,
  });

  return {
    response,
    validation,
    // As before: a repair round ran and produced at least one candidate.
    repaired: evaluated.some((candidate) => candidate.response.phase === "repair"),
    selectedFromRepair: response.phase === "repair",
    repairRounds: rounds.length,
    candidates: evaluated.map((candidate, index) => ({
      candidateId: `candidate-${index + 1}`,
      response: candidate.response,
      validation: candidate.validation,
      score: validationScore(candidate.validation),
      selected: candidate === selected,
    })),
  };
}

/**
 * Re-run deterministic validation after an independent authority source has
 * reconciled the TurnPlan. Candidate generation may run concurrently with
 * that authority, but selection must always use the final facts.
 */
export async function revalidateScenePlanWithRepairResult<T>(
  result: ScenePlanWithRepairResult<T>,
  validate: SceneCandidateValidator<T>,
  observe?: ScenePlannerOptions["onCandidateValidation"],
): Promise<ScenePlanWithRepairResult<T>> {
  const candidates = await Promise.all(result.candidates.map(async (candidate) => {
    const validation = await validate(candidate.response.document);
    notifySceneObserver(() => observe?.(candidate.response, validation));
    return { ...candidate, validation };
  }));
  const selected = [...candidates].sort((first, second) =>
    compareValidations(first.validation, second.validation))[0]!;
  return {
    response: selected.response,
    validation: selected.validation,
    repaired: result.repaired,
    selectedFromRepair: selected.response.phase === "repair",
    repairRounds: result.repairRounds,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      score: validationScore(candidate.validation),
      selected: candidate.candidateId === selected.candidateId,
    })),
  };
}

function validationScore(validation: SceneCandidateValidation<unknown>): number {
  if (validation.valid) return Math.max(0, validation.qualityScore ?? 0);
  const fatalCount = validation.errors.filter((error) => error.severity === "fatal").length;
  return 1_000_000_000 + fatalCount * 100 + validation.errors.length;
}

function compareValidations(
  first: SceneCandidateValidation<unknown>,
  second: SceneCandidateValidation<unknown>,
): number {
  if (first.valid !== second.valid) return first.valid ? -1 : 1;
  return validationScore(first) - validationScore(second);
}

async function requestSceneDocument(
  phase: "plan" | "repair",
  prompt: string,
  options: ScenePlannerOptions,
  lane: ScenePlannerLane,
  question: string,
): Promise<ScenePlannerResponse | null> {
  const { proxyUrl, sessionId, traceId, signal, timeoutMs = SCENE_PLANNER_TIMEOUT_MS } = options;
  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let outcomeReported = false;
  let declineReason: string | null = null;
  const reportOutcome = (error: string | null, bodyParsed: boolean) => {
    if (outcomeReported) return;
    outcomeReported = true;
    try {
      options.onRequestOutcome?.({
        phase,
        lane,
        httpStatus,
        error,
        bodyParsed,
        promptChars: prompt.length,
        elapsedMs: Date.now() - startedAt,
        declineReason,
      });
    } catch {
      // Diagnostics must never change planning behavior.
    }
  };
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), Math.max(1, timeoutMs));
  const combinedSignal = signal
    ? mergeAbortSignals(signal, timeoutController.signal)
    : timeoutController.signal;

  tutorDebug("planner", `starting semantic scene ${phase}`, {
    timeout_ms: timeoutMs,
    prompt_chars: prompt.length,
    schema_version: SCENE_DOCUMENT_VERSION,
    lane,
  });

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: withFastModeHeader(
        withTurnTraceHeaders(
          {
            "content-type": "application/json",
            "x-planner": "1",
            "x-scene-planner-version": "2",
            "x-scene-planner-phase": phase,
            "x-scene-planner-lane": lane,
            "x-planner-deadline-ms": String(timeoutMs),
          },
          { sessionId, traceId, question },
        ),
        options.fastMode,
      ),
      signal: combinedSignal,
      body: JSON.stringify({
        model: PLANNER_MODEL,
        max_tokens: 4000,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: "system",
            content: `Synthesize one coordinate-free scene-document/v2 operator program. Follow the complete schema, capability contracts, authority rules, and safety constraints in the user message. Return only the JSON object. Never emit pixels, drawing commands, markdown, prose outside JSON, topic templates, or unverified geometry.`,
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    httpStatus = response.status;

    if (!response.ok) {
      const responseText = (await response.text().catch(() => "")).trim();
      const errorText = responseText.slice(0, 500) || response.statusText || `HTTP ${response.status}`;
      tutorDebug("planner", `semantic scene ${phase} request failed`, {
        status: response.status,
        error: errorText,
        elapsed_ms: Date.now() - startedAt,
      });
      reportOutcome(errorText, false);
      return null;
    }

    let payload: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      payload = (await response.json()) as typeof payload;
    } catch (error) {
      const errorText = `response_json_parse_failed: ${error instanceof Error ? error.message : String(error)}`;
      tutorDebug("planner", `semantic scene ${phase} returned an unreadable response body`, {
        elapsed_ms: Date.now() - startedAt,
      });
      reportOutcome(errorText, false);
      return null;
    }
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      tutorDebug("planner", `semantic scene ${phase} returned empty content`, {
        elapsed_ms: Date.now() - startedAt,
      });
      reportOutcome("empty_content", false);
      return null;
    }

    const document = parseScenePlannerResponseJson(content);
    if (!document) {
      tutorDebug("planner", `semantic scene ${phase} returned invalid JSON`, {
        content_preview: content.slice(0, 200),
        elapsed_ms: Date.now() - startedAt,
      });
      reportOutcome("invalid_scene_json", false);
      return null;
    }

    const elapsedMs = Date.now() - startedAt;
    declineReason = scenePlannerCandidateDiagnostics(document, true).declineReason;
    tutorDebug("planner", `semantic scene ${phase} candidate ready`, {
      schema_version: document.schemaVersion,
      entity_count: Array.isArray(document.entities) ? document.entities.length : undefined,
      elapsed_ms: elapsedMs,
    });
    reportOutcome(null, true);

    const plannedResponse: ScenePlannerResponse = {
      document,
      rawContent: content,
      phase,
      lane,
      elapsedMs,
      traceId: response.headers.get("x-heytutor-trace-id") ?? undefined,
    };
    notifySceneObserver(() => options.onResponse?.(plannedResponse));
    return plannedResponse;
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    tutorDebug("planner", `semantic scene ${phase} failed`, {
      reason: isAbort ? "timeout_or_cancelled" : String(error),
      elapsed_ms: Date.now() - startedAt,
    });
    reportOutcome(
      isAbort ? "timeout_or_cancelled" : error instanceof Error ? error.message : String(error),
      false,
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function notifySceneObserver(observer: () => void): void {
  try { observer(); } catch { /* Diagnostics must never change planning behavior. */ }
}

/** Parse only the JSON envelope; scene-engine owns all semantic validation. */
export function parseScenePlannerResponseJson(content: string): SceneDocumentCandidate | null {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    const value: unknown = JSON.parse(text.slice(firstBrace, lastBrace + 1));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is SceneDocumentCandidate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildOrderedRouteRepairGuidance(
  errors: readonly SceneRepairError[],
  context: string | undefined,
): string {
  const needsRouteRepair = errors.some((error) =>
    error.code === "turnplan_loop_member_not_proven" ||
    error.code === "turnplan_loop_member_bypassed" ||
    error.code === "turnplan_route_direction_not_proven");
  if (!needsRouteRepair || !context) return "";

  const pattern = /\b(up(?:ward)?|down(?:ward)?|left(?:ward)?|right(?:ward)?)\s+(?:through|along|across)\s+(?:the\s+)?([a-z][a-z0-9_-]*(?:\s+[a-z0-9_-]+){0,2}?)(?=\s*(?:,|;|\(|\)|\band\b|\.|$))/gi;
  const seen = new Set<string>();
  const members = [...context.matchAll(pattern)].flatMap((match) => {
    const direction = match[1]?.toLowerCase();
    const hint = match[2]?.trim().toLowerCase();
    if (!direction || !hint || seen.has(hint)) return [];
    seen.add(hint);
    return [{ direction, hint }];
  });
  if (members.length < 3) return "";

  const edges = members.map((member, index) => {
    const end = index === members.length - 1 ? "p0" : `p${index + 1}`;
    return `${index + 1}. ${member.hint}: p${index} -> ${end} (${member.direction})`;
  }).join("\n");
  return `\nORDERED CYCLIC ROUTE (mandatory, derived from the authoritative claim):\n${edges}\nAssign each member its listed terminal pair and shared cycle terminals in order. Coordinates preserve stated cardinal directions. Symbols are sole edges; no full-length segments behind them, polygon replacement or coincident duplicate IDs.`;
}

function buildWaveOpticsRepairGuidance(
  errors: readonly SceneRepairError[],
): string {
  const needsWavefrontRepair = errors.some((error) =>
    error.code === "derived_role_operator_mismatch" && /wavefront|refract|reflect/i.test(error.message));
  const hasRefractionFailure = errors.some((error) =>
    /refract|total internal reflection|snell/i.test(`${error.code} ${error.message}`));
  if (!needsWavefrontRepair && !hasRefractionFailure) return "";
  return `
WAVE-OPTICS REBUILD (mandatory): one constructed surface contact. Stated incidence: exactly one reflect_at/refract_at produces [incident_ray, normal, outgoing_ray]; remove guessed duplicates. Plane fronts:wavefront_family direction=corresponding verified ray ID. Angle marks share contact vertex. Speeds v1,v2 require n1/n2 = v2/v1 and numeric inputs n1:n2=v2:v1; never swap the ratio or invent indices.`;
}

function buildOpticalInstrumentRepairGuidance(
  errors: readonly SceneRepairError[],
): string {
  const codes = new Set(errors.map((error) => error.code));
  if (![
    "instrument_axis_not_unique",
    "instrument_element_orientation_not_proven",
    "instrument_ray_bundle_not_proven",
    "normal_adjustment_focal_plane_split",
    "instrument_intermediate_focus_not_proven",
  ].some((code) => codes.has(code))) return "";
  return `
OPTICAL-INSTRUMENT REBUILD (mandatory): one optical-axis entity; objective/eyepiece transverse with fatal perpendicular proofs. Continuous rays traverse elements; prove two objective rays converge at the intermediate image and requested incoming/emergent bundles parallel. Normal adjustment: objective image and eyepiece focus use one shared point ID between elements. Never weaken/delete failed assertions.`;
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const abort = () => controller.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
