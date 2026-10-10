/**
 * Client-reported figure diagnostics, not geometry/solver/save authority.
 * Only admitted turns have an owned trace. A terminal report is generated and
 * checkpointed; fetch/beacon cannot guarantee delivery after a browser dies.
 * This module never accepts student text, raw refusal reasons or exceptions.
 */
import type { FigureSource } from "@heytutor/scene-engine";
import type { DiagramSubject } from "@heytutor/tutor-core";

export const FIGURE_OUTCOME_SCHEMA = "figure-outcome/v1" as const;
export const FIGURE_OUTCOME_EVENT_NAMES = [
  "figure-outcome-decision", "figure-outcome-empty", "figure-committed", "figure-turn-terminal",
] as const;
export const FIGURE_EMPTY_CAUSES = [
  "not_needed", "not_attempted", "planner_no_output", "planner_declined", "candidates_invalid",
  "declined_unreadable", "fallback_suppressed", "deadline", "solver_contradiction",
  "presentation_refused", "presentation_no_ink", "save_admission_rejected", "intro_failed", "cancelled", "error",
] as const;
export type FigureEmptyCause = (typeof FIGURE_EMPTY_CAUSES)[number];
export type FigureOutcome = "pending" | "selected" | "committed" | "partially_committed" | "inherited" | "empty";
export type TurnTerminalOutcome = "complete" | "cancelled" | "error";
type VisualRequirement = "required" | "optional" | "none";
type RepresentationTier = "exact_verified" | "qualitative_verified" | "question_representation";

/** Boolean/count evidence only; do not map a free-form reason into this object. */
export interface FigureDecisionEvidence {
  hasSelectedFigure: boolean;
  inheritedFigure?: boolean;
  visualRequirement?: VisualRequirement | null;
  subject?: DiagramSubject | null;
  figureSource?: FigureSource | null;
  representationTier?: RepresentationTier | null;
  candidateCount?: number;
  fatalIssueCount?: number;
  plannerCalls?: number;
  primitiveCount?: number | null;
  /** The selected validated document explicitly chooses text_only. */
  plannerDeclined?: boolean;
  noReadableInk?: boolean;
  fallbackSuppressed?: boolean;
  deadlineHit?: boolean;
  solverContradiction?: boolean;
  presentationRefused?: boolean;
  presentationNoInk?: boolean;
  /** Production selection rejected the candidate's canonical save shape. */
  saveAdmissionRejected?: boolean;
}

export interface FigureOutcomeMetadata extends Record<string, unknown> {
  figure_trace_schema: typeof FIGURE_OUTCOME_SCHEMA;
  figure_outcome: FigureOutcome;
  figure_empty_cause: FigureEmptyCause | null;
  turn_terminal_outcome: TurnTerminalOutcome | null;
  figure_subject: DiagramSubject | null;
  figure_visual_requirement: VisualRequirement | null;
  figure_source: FigureSource | null;
  figure_representation_tier: RepresentationTier | null;
  figure_candidate_count: number | null;
  figure_fatal_issue_count: number | null;
  figure_planner_calls: number | null;
  figure_primitive_count: number | null;
  figure_decision_since_ask_ms: number | null;
  figure_ready_since_ask_ms: number | null;
  figure_committed_since_ask_ms: number | null;
}

export interface FigureOutcomeTelemetry {
  durationMs(): number;
  meta(metadata: Record<string, unknown>): void;
  mark(name: string, metadata?: Record<string, unknown>): void;
  checkpoint(reason: string): Promise<void>;
}

export interface FigureOutcomeTracker {
  decision(evidence: FigureDecisionEvidence): void;
  /** A scoped typed refusal or failed intro can withdraw selected geometry. */
  empty(cause: FigureEmptyCause): void;
  /** Call only after the originating verified canvas transaction commits. */
  committed(options?: { partial?: boolean }): void;
  /** First terminal result wins; later callbacks cannot change a closed turn. */
  finish(outcome: TurnTerminalOutcome): void;
  snapshot(): FigureOutcomeMetadata;
}

/** Runtime-only observer context; this never grants scene or save permission. */
export interface FigureDiagnostics {
  figureSource: FigureSource | null;
  representationTier: RepresentationTier | null;
  primitiveCount: number | null;
}

const outcomes = ["pending", "selected", "committed", "partially_committed", "inherited", "empty"] as const;
const terminals = ["complete", "cancelled", "error"] as const;
const sources = ["planner", "fast_family", "family", "archetype", "chemistry_family", "matrix_source",
  "source_grounded", "last_resort", "text_only", "dsa_trace", "verified_recovery"] as const satisfies readonly FigureSource[];
const tiers = ["exact_verified", "qualitative_verified", "question_representation"] as const;
const subjects = ["maths", "physics", "chemistry", "other"] as const;
const requirements = ["required", "optional", "none"] as const;
const countFields = ["figure_candidate_count", "figure_fatal_issue_count", "figure_planner_calls", "figure_primitive_count"] as const;
const timeFields = ["figure_decision_since_ask_ms", "figure_ready_since_ask_ms", "figure_committed_since_ask_ms"] as const;
const MAX_COUNT = 100_000;
const MAX_ELAPSED_MS = 3_600_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function member<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.some(item => item === value);
}
function boundedNumber(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= max;
}

/** Reserved fields must never fall through the legacy free-form metadata path. */
export function isFigureOutcomeMetadataKey(key: string): boolean {
  return key.startsWith("figure_") || key === "turn_terminal_outcome";
}

/** Exact boundary allowlist; regex-looking strings are not safe enum values. */
export function sanitizeFigureOutcomeMetadata(value: unknown): Record<string, unknown> {
  if (!record(value)) return {};
  const safe: Record<string, unknown> = {};
  if (value.figure_trace_schema === FIGURE_OUTCOME_SCHEMA) safe.figure_trace_schema = FIGURE_OUTCOME_SCHEMA;
  for (const [key, allowed, nullable] of [
    ["figure_outcome", outcomes, false], ["figure_empty_cause", FIGURE_EMPTY_CAUSES, true],
    ["turn_terminal_outcome", terminals, true], ["figure_subject", subjects, true],
    ["figure_visual_requirement", requirements, true], ["figure_source", sources, true],
    ["figure_representation_tier", tiers, true],
  ] as const) {
    const item = value[key];
    if (member(item, allowed) || (nullable && item === null)) safe[key] = item;
  }
  for (const key of countFields) {
    if (value[key] === null || boundedNumber(value[key], MAX_COUNT)) safe[key] = value[key];
  }
  for (const key of timeFields) {
    if (value[key] === null || boundedNumber(value[key], MAX_ELAPSED_MS)) safe[key] = value[key];
  }
  return safe;
}

/** Closed diagnostic transport through a live page, Stop, doubt and Continue. */
export function sanitizeFigureDiagnostics(value: unknown): FigureDiagnostics {
  const item = record(value) ? value : {};
  return {
    figureSource: member(item.figureSource, sources) ? item.figureSource : null,
    representationTier: member(item.representationTier, tiers) ? item.representationTier : null,
    primitiveCount: boundedNumber(item.primitiveCount, MAX_COUNT) ? item.primitiveCount : null,
  };
}

export function sanitizeFigureSubject(value: unknown): DiagramSubject | null {
  return member(value, subjects) ? value : null;
}

/**
 * Call only after the caller establishes actual retained verified board ink.
 * A saved/cache figure flag is deliberately insufficient. Unknown historical
 * subject/count stay null; no question, chapter, commands or labels are read.
 */
export function inheritedFigureEvidence(input: {
  hasRetainedVerifiedInk: boolean;
  subject?: unknown;
  visualRequirement?: unknown;
  sceneArtifacts?: unknown;
  diagnostics?: unknown;
}): FigureDecisionEvidence | null {
  if (!input.hasRetainedVerifiedInk) return null;
  const scene = sanitizeFigureDiagnostics(input.sceneArtifacts);
  const carried = sanitizeFigureDiagnostics(input.diagnostics);
  return {
    hasSelectedFigure: true, inheritedFigure: true,
    subject: sanitizeFigureSubject(input.subject),
    visualRequirement: member(input.visualRequirement, requirements) ? input.visualRequirement : null,
    // A doubt's saved scene is text-only even while prior figure ink remains.
    figureSource: scene.figureSource && scene.figureSource !== "text_only"
      ? scene.figureSource : carried.figureSource,
    representationTier: scene.representationTier ?? carried.representationTier,
    primitiveCount: carried.primitiveCount,
  };
}

/** A valid explicit planner decline is evidence, not a failed candidate. */
export function classifyFigureEmptyCause(evidence: Omit<FigureDecisionEvidence, "hasSelectedFigure">): FigureEmptyCause {
  if (evidence.solverContradiction) return "solver_contradiction";
  if (evidence.presentationRefused) return "presentation_refused";
  if (evidence.presentationNoInk) return "presentation_no_ink";
  if (evidence.saveAdmissionRejected) return "save_admission_rejected";
  if (evidence.visualRequirement === "none") return "not_needed";
  if (evidence.plannerDeclined) return "planner_declined";
  if (evidence.fallbackSuppressed) return "fallback_suppressed";
  if (evidence.noReadableInk) return "declined_unreadable";
  if (evidence.deadlineHit) return "deadline";
  if ((evidence.fatalIssueCount ?? 0) > 0) return "candidates_invalid";
  if (evidence.plannerCalls === 0) return "not_attempted";
  return "planner_no_output";
}

// A late callback keeps its own tracker; there is no mutable active-turn owner.
const trackers = new WeakMap<object, FigureOutcomeTracker>();
export function figureOutcomeTrackerFor(telemetry: unknown): FigureOutcomeTracker | null {
  return record(telemetry) ? trackers.get(telemetry) ?? null : null;
}

export function createFigureOutcomeTracker(telemetry: FigureOutcomeTelemetry): FigureOutcomeTracker {
  const existing = trackers.get(telemetry);
  if (existing) return existing;
  const state: FigureOutcomeMetadata = {
    figure_trace_schema: FIGURE_OUTCOME_SCHEMA, figure_outcome: "pending", figure_empty_cause: null,
    turn_terminal_outcome: null, figure_subject: null, figure_visual_requirement: null,
    figure_source: null, figure_representation_tier: null, figure_candidate_count: null,
    figure_fatal_issue_count: null, figure_planner_calls: null, figure_primitive_count: null,
    figure_decision_since_ask_ms: null, figure_ready_since_ask_ms: null, figure_committed_since_ask_ms: null,
  };
  const elapsed = (): number | null => {
    try {
      const value = Math.round(telemetry.durationMs());
      return boundedNumber(value, MAX_ELAPSED_MS) ? value : null;
    } catch { return null; }
  };
  const publish = (name?: (typeof FIGURE_OUTCOME_EVENT_NAMES)[number]) => {
    // Diagnostics must not throw into teaching or mask the original failure.
    try { telemetry.meta({ ...state }); } catch { /* best effort */ }
    if (name) { try { telemetry.mark(name, { ...state }); } catch { /* best effort */ } }
  };
  const tracker: FigureOutcomeTracker = {
    decision(evidence) {
      if (state.turn_terminal_outcome || state.figure_outcome === "committed" || state.figure_outcome === "partially_committed") return;
      Object.assign(state, sanitizeFigureOutcomeMetadata({
        figure_subject: evidence.subject, figure_visual_requirement: evidence.visualRequirement,
        figure_source: evidence.figureSource, figure_representation_tier: evidence.representationTier,
        figure_candidate_count: evidence.candidateCount, figure_fatal_issue_count: evidence.fatalIssueCount,
        figure_planner_calls: evidence.plannerCalls, figure_primitive_count: evidence.primitiveCount,
      }));
      state.figure_decision_since_ask_ms = elapsed();
      state.figure_outcome = evidence.hasSelectedFigure ? evidence.inheritedFigure ? "inherited" : "selected" : "empty";
      state.figure_empty_cause = evidence.hasSelectedFigure ? null : classifyFigureEmptyCause(evidence);
      if (evidence.hasSelectedFigure) state.figure_ready_since_ask_ms ??= state.figure_decision_since_ask_ms;
      publish("figure-outcome-decision");
    },
    empty(cause) {
      if (state.turn_terminal_outcome || state.figure_outcome === "committed" || state.figure_outcome === "partially_committed") return;
      state.figure_outcome = "empty";
      state.figure_empty_cause = cause;
      publish("figure-outcome-empty");
    },
    committed(options) {
      if (state.turn_terminal_outcome || state.figure_outcome === "committed" ||
        (state.figure_outcome !== "selected" && state.figure_outcome !== "inherited")) return;
      state.figure_outcome = options?.partial ? "partially_committed" : "committed";
      state.figure_empty_cause = null;
      state.figure_committed_since_ask_ms = elapsed();
      publish("figure-committed");
    },
    finish(outcome) {
      if (state.turn_terminal_outcome) return;
      state.turn_terminal_outcome = outcome;
      if (state.figure_outcome === "pending" || state.figure_outcome === "selected") {
        const selected = state.figure_outcome === "selected";
        state.figure_outcome = "empty";
        state.figure_empty_cause ??= outcome === "complete" ? selected ? "intro_failed" : "not_attempted" : outcome;
      }
      publish("figure-turn-terminal");
      try { void telemetry.checkpoint("figure-turn-terminal").catch(() => undefined); } catch { /* best effort */ }
    },
    snapshot: () => ({ ...state }),
  };
  trackers.set(telemetry, tracker);
  publish();
  return tracker;
}
