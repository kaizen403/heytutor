import type { FigureSource } from "@heytutor/scene-engine";
import type { DiagramSubject } from "@heytutor/tutor-core";

export type DiagramStrategy = "current" | "strict";

export const DIAGRAM_STRATEGY_POLICY_VERSION = "diagram-strategy/v2";
export const PHYSICS_HYBRID_POLICY_VERSION = "physics-hybrid/preplanning-signals-v1";
export type PhysicsDiagramMode = "hybrid";

/** Only the explicit opt-in is accepted; absent or unknown settings stay off. */
export function parsePhysicsDiagramMode(value: unknown): PhysicsDiagramMode | null {
  return value === "hybrid" ? "hybrid" : null;
}

/** Existing engine gate outputs, never question keywords or evaluation metadata. */
export interface DiagramStrategySceneSignal {
  families: readonly string[];
  archetypeId: string | null;
}

// Frozen from development data before the held-out measurement. These choose
// between existing policies; they confer no geometry/proof/admission authority.
const CURRENT_PHYSICS_FAMILIES = new Set([
  "ray_path", "axis_view", "interface", "instrument_chain", "aperture", "screen_pattern", "polarizer",
]);
const CURRENT_PHYSICS_ARCHETYPES = new Set([
  "vernier_calliper", "screw_gauge",
  "spring_mass", "shm_energy", "simple_pendulum", "standing_wave", "shm_superposition", "wave_profile", "wave_types",
  "resistor_network", "two_loop_network", "wheatstone_bridge", "meter_bridge", "potentiometer",
  "straight_wire_field", "parallel_wires", "bar_magnet",
]);

function currentPhysicsSignal(signal: DiagramStrategySceneSignal | undefined): string | null {
  const family = signal?.families.find((id) => CURRENT_PHYSICS_FAMILIES.has(id));
  if (family) return `family:${family}`;
  const archetype = signal?.archetypeId;
  return archetype && CURRENT_PHYSICS_ARCHETYPES.has(archetype) ? `archetype:${archetype}` : null;
}

export interface DiagramStrategyContext {
  chemistryLane: boolean;
  codeLesson: boolean;
  dsa: boolean;
  doubt: boolean;
  subject?: DiagramSubject;
  strictSubjects?: readonly DiagramSubject[];
  physicsMode?: PhysicsDiagramMode | null;
  sceneSignal?: DiagramStrategySceneSignal;
}

export interface DiagramStrategyDecision extends DiagramStrategyContext {
  assignedStrategy: DiagramStrategy;
  /** The strategy actually used after subject/turn exemptions. */
  strategy: DiagramStrategy;
  selectionOrder: "current" | "planner_first";
  usePickedExamples: boolean;
  strategyReason: "current" | "turn_exempt" | "strict_assignment" | "strict_subject" |
    "hybrid_current_signal" | "hybrid_strict_default";
  hybridSignal: string | null;
  policyVersion: typeof PHYSICS_HYBRID_POLICY_VERSION | null;
}

/**
 * The single live/lab policy boundary for the strict diagram experiment.
 * Cohort assignment is deliberately separate: this function applies the
 * subject and turn exemptions and describes every downstream choice.
 */
export function decideDiagramStrategy(
  input: DiagramStrategyContext & { assignedStrategy: DiagramStrategy },
): DiagramStrategyDecision {
  const hybrid = input.physicsMode === "hybrid" && input.subject === "physics";
  const exempt = input.chemistryLane || input.codeLesson || input.dsa || input.doubt;
  const strictSubject = input.subject !== undefined && input.subject !== "other" &&
    input.strictSubjects?.includes(input.subject);
  let strategy: DiagramStrategy = "current";
  let strategyReason: DiagramStrategyDecision["strategyReason"] = "current";
  let hybridSignal: string | null = null;
  if (exempt) {
    strategyReason = "turn_exempt";
  } else if (input.assignedStrategy === "strict") {
    strategy = "strict";
    strategyReason = "strict_assignment";
  } else if (strictSubject) {
    strategy = "strict";
    strategyReason = "strict_subject";
  } else if (hybrid) {
    hybridSignal = currentPhysicsSignal(input.sceneSignal);
    strategy = hybridSignal ? "current" : "strict";
    strategyReason = hybridSignal ? "hybrid_current_signal" : "hybrid_strict_default";
  }
  return {
    ...input,
    strategy,
    selectionOrder: strategy === "strict" ? "planner_first" : "current",
    usePickedExamples: strategy === "strict",
    strategyReason, hybridSignal,
    policyVersion: hybrid ? PHYSICS_HYBRID_POLICY_VERSION : null,
  };
}

export function liveDiagramStrategyDecision(
  input: DiagramStrategyContext & { assignedStrategy: DiagramStrategy },
): DiagramStrategyDecision {
  return decideDiagramStrategy(input);
}

export function evaluationDiagramStrategyDecision(
  arm: "current" | "planner_first" | "planner_examples" | "planner_examples_strict",
  context: DiagramStrategyContext,
): DiagramStrategyDecision {
  if (arm === "planner_examples_strict") {
    return decideDiagramStrategy({ assignedStrategy: "strict", ...context });
  }
  const current = decideDiagramStrategy({ assignedStrategy: "current", ...context });
  return {
    ...current,
    selectionOrder: arm === "current" ? "current" : "planner_first",
    usePickedExamples: arm === "planner_examples",
  };
}

/** Recovery is already server-verified and remains available in strict. */
export function diagramStrategyAllowsFigureSource(
  decision: DiagramStrategyDecision,
  source: FigureSource,
): boolean {
  return decision.strategy === "current" ||
    source === "planner" ||
    source === "verified_recovery" ||
    source === "text_only";
}
