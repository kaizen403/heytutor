/**
 * A doubt that needs a new figure plans, verifies and draws one (DIAGRAM_DOUBT_FIGURES).
 *
 * Two halves live here:
 *
 * 1. The lesson's numeric authority and fast figure selection, extracted from
 *    useQuestionHandler so the lesson and the doubt run the same code:
 *    `applyDeterministicSourceAuthority`, `reconcilePlanWithAuthority` and
 *    `selectFastFigure`. The lesson's closures call these unchanged; a stale
 *    planner scalar can reach neither figure (rule 4).
 *
 * 2. The doubt's own path: the need check request and when to skip it, the
 *    20 s budget, planning on the composed question (planTurnV3 and ProblemIR
 *    in parallel), the fast tier only (hand coded families, chemistry
 *    families, archetypes), and the refusal of a figure equal to the one
 *    already in the zone. No LLM scene planner and no reference picture.
 *
 * Every miss teaches on the figure that is already drawn.
 */
import {
  applySectionFormulaAuthority,
  applySourceQuantityAuthority,
  reconcileTurnPlanWithSolver,
  SCENE_ENGINE_VERSION,
  type SceneArtifactsV3,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  tutorDebug,
  type NarrationLanguage,
  type ProblemAuthorityV1Response,
  type TurnPlanV3Response,
} from "@heytutor/tutor-core";
import type { TutorSegment, VerifiedDiagram } from "@heytutor/drawing";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import { composeDoubtFigureQuestion } from "@/lib/boards/doubtFigure";
import {
  DOUBT_FIGURE_NEED_DEADLINE_MS,
  pointDecision,
  type DoubtFigureNeedInput,
  type DoubtFigureNeedResult,
} from "@/lib/llm/doubtFigureNeed";
import { selectFastVerifiedRepresentation, type SelectedRepresentation } from "../scene/representationFallback";
import { deriveSceneGate, selectProductionScene } from "../scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../scene/verifiedScenePresentation";
import { turnPlanNeedsNumericAuthority } from "../scene/diagramGeneration";
import { refreshSolverAuthorityForPlan } from "./refreshSolverAuthority";
import type { PersistedTurnScene } from "./doubtTurn";

// ---------------------------------------------------------------------------
// The lesson's authority and fast selection, shared with the doubt.
// ---------------------------------------------------------------------------

type Debug = (scope: "planner", message: string, data: Record<string, unknown>) => void;
const plannerDebug: Debug = (scope, message, data) => tutorDebug(scope, message, data);

/**
 * Section formula stems and topics whose quantities the engine recomputes from
 * the stem: a value that binds without doubt to a recomputed quantity is
 * corrected, any other value is left as written, and a conflict that cannot be
 * bound makes that topic's figure decline.
 */
export function applyDeterministicSourceAuthority(
  question: string,
  sourcePlan: TurnPlanV3,
  authority: ProblemAuthorityV1Response | null,
  debug: Debug = plannerDebug,
): TurnPlanV3 {
  // Section-formula stems: the point's coordinates (or the asked ratio)
  // are solved exactly from the stated endpoints, and an inconsistent or
  // singular stem withdraws every derived number.
  const sectionAuthority = applySectionFormulaAuthority(question, sourcePlan);
  if (sectionAuthority) {
    sourcePlan = sectionAuthority.plan;
    debug("planner", "section formula authority", {
      status: sectionAuthority.reading.status,
      issue_codes: sectionAuthority.issues.map((issue) => issue.code),
    });
  }

  // Topics whose quantities the engine recomputes from the stem (a
  // stated resistor circuit, a uniform circular state) check the plan
  // before each final gate: a value whose symbol binds without doubt to a
  // recomputed quantity is corrected, any other value is left as
  // written, and a conflict that cannot be bound makes that topic's
  // figure decline. Scene validation and the teaching prompt both read
  // the corrected plan, so no stale scalar reaches the narration.
  const sourceAuthority = applySourceQuantityAuthority(sourcePlan, authority?.problemIR ?? null, question);
  if (sourceAuthority.outcomes.length > 0) {
    sourcePlan = sourceAuthority.plan;
    debug("planner", "source quantity authority", {
      topics: sourceAuthority.outcomes.map((outcome) => outcome.topic),
      corrections: sourceAuthority.outcomes.flatMap((outcome) => outcome.corrections.map((correction) => `${correction.symbol}: ${correction.previous} -> ${correction.corrected}`)),
      decline_figure: sourceAuthority.outcomes.filter((outcome) => outcome.declineFigure).map((outcome) => outcome.topic),
      issue_codes: sourceAuthority.outcomes.flatMap((outcome) => outcome.issueCodes),
    });
  }

  return sourcePlan;
}

/** The plan reconciled with the solver, then the source authority, and the authority refreshed for it. */
export function reconcilePlanWithAuthority(
  question: string,
  planToReconcile: TurnPlanV3,
  authority: ProblemAuthorityV1Response,
  debug: Debug = plannerDebug,
): { turnPlan: TurnPlanV3; authority: ProblemAuthorityV1Response } {
  const reconciledPlan = applyDeterministicSourceAuthority(question, reconcileTurnPlanWithSolver(
    planToReconcile,
    authority.problemIR,
    authority.solverResult,
  ), authority, debug);
  const refreshedAuthority = refreshSolverAuthorityForPlan(authority, reconciledPlan, question);
  return { turnPlan: reconciledPlan, authority: refreshedAuthority };
}

/** The fast verified tier: hand coded families, chemistry families, archetypes. */
export function selectFastFigure(input: {
  question: string;
  turnPlan: TurnPlanV3;
  authority: ProblemAuthorityV1Response | null;
  families: readonly string[];
}): SelectedRepresentation | null {
  return selectFastVerifiedRepresentation({
    question: input.question,
    turnPlan: input.turnPlan,
    problemIR: input.authority?.problemIR ?? null,
    families: input.families as string[],
  });
}

// ---------------------------------------------------------------------------
// The doubt's need check.
// ---------------------------------------------------------------------------

/** From the doubt's start: need check, planning, selection, all of it. */
export const DOUBT_FIGURE_BUDGET_MS = 20_000;

/**
 * Spoken once while the doubt's figure plans. It promises no figure: a miss
 * (budget, no fast family, the same figure) teaches on the old one.
 */
export const DOUBT_FIGURE_HOLDING_LINE: Record<NarrationLanguage, string> = {
  english: "Good question. Give me a moment.",
  hinglish: "अच्छा सवाल है. एक पल रुको.",
};

export function doubtFigureHoldingSegment(language: NarrationLanguage = "english"): TutorSegment {
  return { narration: DOUBT_FIGURE_HOLDING_LINE[language], command: null, delivery: "opening" };
}

/**
 * Why a doubt answers "point" without asking, or null when the need check runs.
 * A ring on a figure part is a question about that part. A code board's new
 * figures are out of scope in v1. Only a verified figure in the zone can be
 * stashed and returned, so an empty zone or a reference picture is pointed at.
 */
export function doubtFigureNeedSkip(input: {
  granted: boolean;
  codeBoard: boolean;
  markedFigureIds: readonly string[];
  zoneFigure: VerifiedDiagram | null;
  zoneReturnable: boolean;
}): string | null {
  if (!input.granted) return "flag_off";
  if (input.codeBoard) return "code_board";
  const marked = new Set(input.markedFigureIds.map((id) => id.trim().toLowerCase()).filter(Boolean));
  if (marked.size > 0 && input.zoneFigure?.anchors.some((anchor) => marked.has(anchor.id.trim().toLowerCase()))) {
    return "marked_figure_part";
  }
  if (!input.zoneFigure || input.zoneFigure.id !== "verified_scene" || !input.zoneReturnable) return "zone_not_returnable";
  return null;
}

/** The need check body: what the zone's figure shows, by part. */
export function doubtFigureNeedInput(input: {
  lessonQuestion: string;
  doubtTitle: string;
  zoneFigure: VerifiedDiagram | null;
  zoneFamily?: string | null;
}): DoubtFigureNeedInput {
  return {
    lessonQuestion: input.lessonQuestion,
    doubt: input.doubtTitle.replace(/^Doubt:\s*/, "").trim() || input.doubtTitle,
    figure: {
      family: input.zoneFamily ?? null,
      parts: (input.zoneFigure?.anchors ?? []).slice(0, 80).map((anchor) => ({
        id: anchor.id.slice(0, 80),
        labels: anchor.labels.filter((label) => label.trim()).slice(0, 6).map((label) => label.slice(0, 80)),
      })),
    },
  };
}

/** Ask the need check. Never throws; a timeout or any failure is "point". */
export async function requestDoubtFigureNeed(input: {
  url: string;
  body: DoubtFigureNeedInput;
  signal?: AbortSignal;
  traceId?: string | null;
  sessionId?: string | null;
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
}): Promise<DoubtFigureNeedResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (input.signal?.aborted) return pointDecision("aborted");
  input.signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<DoubtFigureNeedResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(pointDecision("timeout"));
    }, Math.max(1, input.deadlineMs ?? DOUBT_FIGURE_NEED_DEADLINE_MS));
  });
  const call = (async (): Promise<DoubtFigureNeedResult> => {
    try {
      const response = await (input.fetchImpl ?? fetch)(input.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.traceId ? { "x-heytutor-trace-id": input.traceId } : {}),
          ...(input.sessionId ? { "x-session-id": input.sessionId } : {}),
        },
        body: JSON.stringify(input.body),
        signal: controller.signal,
      });
      if (!response.ok) return pointDecision(`http_${response.status}`);
      const payload: unknown = await response.json();
      const record = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
      if (record.decision === "new_figure") {
        return { decision: "new_figure", reason: typeof record.reason === "string" ? record.reason : "" };
      }
      return pointDecision(typeof record.reason === "string" ? record.reason : "point");
    } catch {
      return pointDecision(controller.signal.aborted ? "timeout" : "request_failed");
    }
  })();
  try {
    return await Promise.race([call, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
  }
}

// ---------------------------------------------------------------------------
// The doubt's figure.
// ---------------------------------------------------------------------------

/** What a figure shows, for the redraw check: its parts and their printed labels. */
export function figureFingerprint(diagram: Pick<VerifiedDiagram, "anchors" | "commands">): string {
  const anchors = diagram.anchors
    .map((anchor) => `${anchor.id.trim().toLowerCase()}=${[...anchor.labels].map((label) => label.trim()).sort().join("|")}`)
    .sort();
  const labels = diagram.commands
    .filter((command) => (command.type === "LABEL" || command.type === "DIMENSION") && command.text?.trim())
    .map((command) => command.text!.trim())
    .sort();
  return JSON.stringify({ anchors, labels });
}

/** A figure equal to the one in the zone would only redraw it. */
export function sameFigureAsZone(next: VerifiedDiagram, zone: VerifiedDiagram | null): boolean {
  return zone !== null && figureFingerprint(next) === figureFingerprint(zone);
}

export type DoubtFigureMissReason =
  | "budget_exhausted"
  | "turn_plan_unavailable"
  | "numeric_authority_unavailable"
  | "solver_contradiction"
  | "no_fast_figure"
  | "not_drawable"
  | "same_figure"
  | "aborted";

export interface DoubtFigureDrawn {
  status: "drawn";
  /** The composed question the scene was planned on and the server recomputes. */
  question: string;
  turnPlan: TurnPlanV3;
  authority: ProblemAuthorityV1Response | null;
  representation: SelectedRepresentation;
  presentation: { diagram: VerifiedDiagram; introSegments: TutorSegment[] };
  elapsedMs: number;
}

export type DoubtFigureOutcome = DoubtFigureDrawn | { status: "miss"; reason: DoubtFigureMissReason; elapsedMs: number };

export interface DoubtFigurePlanners {
  /** planTurnV3 on the composed question, bound to the turn's proxy and fast mode. */
  planTurn: (question: string, options: { signal: AbortSignal; timeoutMs: number }) => Promise<TurnPlanV3Response | null>;
  /** planAndSolveProblemV1 on the composed question, started at once beside the turn plan. */
  planAuthority: (question: string, options: { signal: AbortSignal; timeoutMs: number }) => Promise<ProblemAuthorityV1Response | null>;
}

const TIMED_OUT = Symbol("timed_out");

function untilDeadline<T>(operation: Promise<T>, deadlineAt: number, now: () => number): Promise<T | typeof TIMED_OUT> {
  const left = deadlineAt - now();
  if (left <= 0) {
    operation.catch(() => {});
    return Promise.resolve(TIMED_OUT);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    operation,
    new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), left); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * Plan, verify and present the doubt's figure, inside the budget. The lesson's
 * authority runs on the composed question exactly as it does on a lesson; the
 * fast tier is the only figure source; a figure equal to the zone's is refused.
 */
export async function planDoubtFigure(input: {
  lessonQuestion: string;
  doubtTitle: string;
  zoneFigure: VerifiedDiagram | null;
  /** Absolute ms (same clock as `now`): the doubt's start plus DOUBT_FIGURE_BUDGET_MS. */
  deadlineAt: number;
  signal: AbortSignal;
  planners: DoubtFigurePlanners;
  narrationLanguage?: NarrationLanguage;
  now?: () => number;
  debug?: Debug;
}): Promise<DoubtFigureOutcome> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const miss = (reason: DoubtFigureMissReason): DoubtFigureOutcome => ({ status: "miss", reason, elapsedMs: now() - startedAt });
  const question = composeDoubtFigureQuestion(input.lessonQuestion, input.doubtTitle);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (input.signal.aborted) return miss("aborted");
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    const timeoutMs = Math.max(1, input.deadlineAt - now());
    // Both start now: the turn plan and the independent numeric authority.
    const authorityPromise = input.planners.planAuthority(question, { signal: controller.signal, timeoutMs })
      .catch(() => null);
    const planned = await untilDeadline(
      input.planners.planTurn(question, { signal: controller.signal, timeoutMs }).catch(() => null),
      input.deadlineAt, now,
    );
    if (input.signal.aborted) return miss("aborted");
    if (planned === TIMED_OUT) return miss("budget_exhausted");
    if (!planned) return miss("turn_plan_unavailable");
    // The need check already judged that this doubt wants a figure.
    let turnPlan: TurnPlanV3 = planned.turnPlan.visualRequirement === "none"
      ? { ...planned.turnPlan, visualRequirement: "optional" }
      : planned.turnPlan;
    turnPlan = applyDeterministicSourceAuthority(question, turnPlan, null, input.debug);
    const settled = await untilDeadline(authorityPromise, input.deadlineAt, now);
    if (input.signal.aborted) return miss("aborted");
    if (settled === TIMED_OUT) return miss("budget_exhausted");
    let authority: ProblemAuthorityV1Response | null = null;
    if (settled) {
      const reconciled = reconcilePlanWithAuthority(question, turnPlan, settled, input.debug);
      turnPlan = reconciled.turnPlan;
      authority = reconciled.authority;
      if (authority.audit.status === "contradiction") return miss("solver_contradiction");
    } else if (turnPlanNeedsNumericAuthority(question, turnPlan)) {
      // Without the solver a planner scalar would stand unchecked on the figure.
      return miss("numeric_authority_unavailable");
    }
    const gate = deriveSceneGate({ question, turnPlan, problemIR: authority?.problemIR ?? null, conversationContext: "" });
    const fast = selectFastFigure({ question, turnPlan, authority, families: gate.sceneCapabilities.families });
    if (!fast) return miss("no_fast_figure");
    // The lesson's own admission: law only leads, readable ink, save checks.
    const selection = selectProductionScene({
      question, turnPlan, problemIR: authority?.problemIR ?? null, conversationContext: "",
      sceneCapabilities: gate.sceneCapabilities, fastRepresentation: fast,
      requiredRetryEnabled: false, completionEnabled: false,
      solverAuthority: authority ? { problemIR: authority.problemIR, solverResult: authority.solverResult } : null,
      policy: { allowedFigureSources: ["fast_family"] },
    });
    const representation = selection.representation;
    if (!representation || representation.sceneDocument.visualDecision.mode !== "scene") return miss("not_drawable");
    const presentation = buildVerifiedDiagramPresentation(representation.sceneDocument, representation.renderScene, {
      originalQuestion: question,
      ...(input.narrationLanguage ? { narrationLanguage: input.narrationLanguage } : {}),
      turnPlan,
      ...(representation.family ? { figureFamily: representation.family } : {}),
    });
    if (!verifiedDiagramHasDrawableInk(presentation.diagram)) return miss("not_drawable");
    if (sameFigureAsZone(presentation.diagram, input.zoneFigure)) return miss("same_figure");
    if (now() > input.deadlineAt) return miss("budget_exhausted");
    return { status: "drawn", question, turnPlan, authority, representation, presentation, elapsedMs: now() - startedAt };
  } finally {
    input.signal.removeEventListener("abort", abort);
    controller.abort();
  }
}

/**
 * The doubt's own validated scene as planned on the composed question, before
 * lane D's doubtFigureTurnScene adds the continuation and the marker.
 */
export function doubtFigurePlannedScene(drawn: DoubtFigureDrawn): PersistedTurnScene {
  const representation = drawn.representation;
  const artifacts: SceneArtifactsV3 = {
    schemaVersion: "scene-artifacts/v3",
    turnPlan: drawn.turnPlan,
    problemIR: drawn.authority?.problemIR ?? null,
    solverResult: drawn.authority?.solverResult ?? null,
    solverAuthority: drawn.authority?.audit ?? null,
    figureSource: representation.figureSource,
    representationTier: representation.tier,
    nonMetric: representation.nonMetric,
    candidates: [],
    selectedCandidateId: null,
    selectionReason: representation.reason,
    diagramResultStatus: "ready",
    proofObligations: representation.sceneDocument.assertions.map((assertion) => ({
      id: assertion.id,
      predicate: assertion.predicate,
      inputs: [...assertion.entities],
      expected: assertion.expected,
      severity: assertion.severity === "warning" ? "warning" as const : "fatal" as const,
    })),
    budgets: { deadlineMs: DOUBT_FIGURE_BUDGET_MS, planMs: drawn.elapsedMs },
  };
  return {
    sceneDocument: representation.sceneDocument,
    sceneEngineVersion: SCENE_ENGINE_VERSION,
    validationReport: representation.validationReport,
    visualStatus: "validated",
    sceneArtifacts: artifacts,
  };
}

/** A pristine copy of a presentation, taken before teaching consumes its deferred marks. */
export function snapshotPresentation(presentation: { diagram: VerifiedDiagram; introSegments: TutorSegment[] }):
  { diagram: VerifiedDiagram; introSegments: TutorSegment[] } | null {
  try {
    return structuredClone({ diagram: presentation.diagram, introSegments: presentation.introSegments });
  } catch {
    return null;
  }
}
