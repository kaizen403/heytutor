/**
 * Required-diagram status helpers.
 *
 * A missing verified diagram must not stop the lesson. The engine first
 * compiles a family scene from the turn plan; if that still fails it draws a
 * last-resort schematic. Invalid planner fragments still never reach the canvas.
 */
import {
  REQUIRED_DIAGRAM_DEADLINE_MS,
  resolveDiagramFailureStatus,
  type DiagramGenerationStatus,
  type VisualRequirement,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { isConceptLessonQuestion } from "@heytutor/tutor-core";

export type { DiagramGenerationStatus, VisualRequirement };

export const REQUIRED_DIAGRAM_RETRY_ENABLED =
  process.env.NEXT_PUBLIC_SCENE_ENGINE_V3_REQUIRED_RETRY !== "0";

/** Hard end-to-end planner deadline; the tracked target remains 45 seconds. */
export const SCENE_PLANNER_DEADLINE_MS = REQUIRED_DIAGRAM_DEADLINE_MS;

/**
 * Turn-plan lanes race and the first valid result wins. The remaining slice is
 * available to an optional audit, while the scene compiler retains at least
 * forty seconds of the sixty-second end-to-end deadline.
 */
export const TURN_PLAN_DEADLINE_MS = 20_000;
export const TURN_PLAN_ATTEMPT_DEADLINE_MS = 16_000;
export const PROBLEM_AUTHORITY_DEADLINE_MS = 18_000;

export function turnPlanNeedsNumericAuthority(question: string, plan: TurnPlanV3): boolean {
  if (plan.givens.length > 0 || plan.derived.length > 0) {
    return true;
  }
  if (/\d|[=+*/^²³]/.test(question) ||
      /\b(?:find|calculate|compute|evaluate|determine|solve|numeric|numerical|value)\b/i.test(question)) return true;
  const symbolicRequest = /\b(?:derive|derivation|prove)\b/i.test(question) &&
    /\b(?:formula|expression|identity|relation|equation)\b/i.test(question);
  if (!isConceptLessonQuestion(question) && !symbolicRequest) return true;
  return plan.unknowns.some((unknown) =>
    !plan.qualitativeClaims.some((claim) => typeof claim.expected !== "number" &&
      claim.relatedQuantityIds?.includes(unknown.id)));
}

export function diagramFailureVisualStatus(
  visualRequirement: VisualRequirement = "optional",
  requiredRetryEnabled = REQUIRED_DIAGRAM_RETRY_ENABLED,
): "retry_required" | "text_only" {
  const status = resolveDiagramFailureStatus({
    visualRequirement,
    requiredRetryEnabled,
  });
  return status === "retry_required" ? "retry_required" : "text_only";
}

export function resolvePlannedSceneVisualStatus(options: {
  visualRequirement: VisualRequirement;
  hasValidatedScene: boolean;
  requiredRetryEnabled?: boolean;
}): "validated" | "retry_required" | "text_only" {
  if (options.hasValidatedScene) return "validated";
  return diagramFailureVisualStatus(
    options.visualRequirement,
    options.requiredRetryEnabled ?? REQUIRED_DIAGRAM_RETRY_ENABLED,
  );
}

/** Failed diagrams skip the canvas. They must not stop narration or work-area writing. */
// The status is part of the contract and deliberately ignored: nothing about a
// diagram's outcome may block the lesson.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function shouldBlockLessonForDiagram(_status: DiagramGenerationStatus): boolean {
  return false;
}

/**
 * Whether the LLM scene planner is worth awaiting. When no deterministic
 * family matches and no archetype names the figure, the exact attempt has
 * nothing to compile against: awaiting it only holds the student in silence
 * before the same text-only fallback. Skipping still records the miss as
 * `missing_capability` and still teaches.
 */
export function shouldAttemptExactScene(input: {
  visualRequirement: VisualRequirement;
  chemistryLane: boolean;
  familyCount: number;
  hasArchetype: boolean;
  hasSourceProgram?: boolean;
}): boolean {
  if (input.visualRequirement === "none") return false;
  if (input.chemistryLane) return false;
  if (input.familyCount > 0) return true;
  return input.hasArchetype || input.hasSourceProgram === true;
}

export function shouldRevalidateSceneCandidatesAfterAuthority(options: {
  problemAuthorityAvailable: boolean;
  planningTurnPlan: unknown;
  authoritativeTurnPlan: unknown;
}): boolean {
  if (options.problemAuthorityAvailable) return true;
  return !deepEqual(options.planningTurnPlan, options.authoritativeTurnPlan);
}

export async function finalizeScenePlanAfterAuthority<T>(
  result: T | null,
  options: {
    problemAuthorityAvailable: boolean;
    planningTurnPlan: unknown;
    authoritativeTurnPlan: unknown;
    revalidate: (result: T) => Promise<T>;
  },
): Promise<T | null> {
  if (result === null) return null;
  if (!shouldRevalidateSceneCandidatesAfterAuthority(options)) return result;
  return options.revalidate(result);
}

export function selectBestAvailableTurnPlan<T>(
  audited: T | null | undefined,
  planned: T | null | undefined,
  fallback: T,
  peers: readonly T[] = [],
): T {
  const candidates = [audited, planned, ...peers].filter((candidate): candidate is T =>
    candidate !== null && candidate !== undefined);
  if (candidates.length === 0) return fallback;
  const coverages = candidates.map(requestedUnknownCoverage);
  if (coverages.some((coverage) => coverage === null)) return audited ?? planned ?? peers[0] ?? fallback;
  const maximumCoverage = Math.max(...coverages as number[]);
  const complete = candidates.filter((candidate) =>
    requestedUnknownCoverage(candidate) === maximumCoverage);
  const groups = new Map<string, T[]>();
  complete.forEach((candidate) => {
    const fingerprint = requestedResultFingerprint(candidate);
    groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), candidate]);
  });
  const consensus = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (consensus && consensus.length >= 2) {
    return [audited, planned, ...peers].find((candidate) =>
      candidate !== null && candidate !== undefined && consensus.includes(candidate)) ?? consensus[0]!;
  }
  return complete.find((candidate) => candidate === audited) ??
    complete.find((candidate) => candidate === planned) ??
    complete[0]!;
}

function requestedUnknownCoverage(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const plan = value as {
    unknowns?: Array<{ id?: unknown; symbol?: unknown }>;
    derived?: Array<{ id?: unknown; symbol?: unknown; value?: unknown }>;
  };
  if (!Array.isArray(plan.unknowns) || !Array.isArray(plan.derived)) return null;
  const finiteDerivedKeys = plan.derived.flatMap((quantity) => {
    if (typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return [];
    return [quantity.id, quantity.symbol]
      .filter((key): key is string => typeof key === "string")
      .map(normalizeQuantityKey);
  });
  return plan.unknowns.filter((unknown) => {
    const keys = [unknown.id, unknown.symbol]
      .filter((key): key is string => typeof key === "string")
      .map(normalizeQuantityKey);
    return keys.some((key) => finiteDerivedKeys.includes(key));
  }).length;
}

function normalizeQuantityKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\(?:mathrm|text|operatorname)/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(?:computed|calculated|calculation|calc|result|answer|value|val)$/, "");
}

function requestedResultFingerprint(value: unknown): string {
  if (typeof value !== "object" || value === null) return "invalid";
  const plan = value as {
    unknowns?: Array<{ id?: unknown; symbol?: unknown }>;
    derived?: Array<{ id?: unknown; symbol?: unknown; value?: unknown; unit?: unknown }>;
  };
  if (!Array.isArray(plan.unknowns) || !Array.isArray(plan.derived)) return "invalid";
  return plan.unknowns.map((unknown) => {
    const keys = [unknown.id, unknown.symbol]
      .filter((key): key is string => typeof key === "string")
      .map(normalizeQuantityKey);
    const result = plan.derived!.find((quantity) =>
      typeof quantity.value === "number" &&
      Number.isFinite(quantity.value) &&
      [quantity.id, quantity.symbol]
        .filter((key): key is string => typeof key === "string")
        .map(normalizeQuantityKey)
        .some((key) => keys.includes(key)));
    const unit = String(result?.unit ?? "1")
      .toLowerCase()
      .replace(/µ|μ/g, "u")
      .replace(/⁻/g, "-")
      .replace(/²/g, "^2")
      .replace(/³/g, "^3")
      .replace(/\s+/g, "");
    return result && typeof result.value === "number"
      ? `${keys.sort().join("|")}:${Number(result.value.toPrecision(12))}:${unit}`
      : `${keys.sort().join("|")}:missing`;
  }).sort().join(";");
}

function deepEqual(first: unknown, second: unknown): boolean {
  if (first === second) return true;
  if (typeof first !== typeof second) return false;
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((value, index) => deepEqual(value, second[index]));
  }
  if (!isRecord(first) || !isRecord(second)) return false;
  const firstKeys = Object.keys(first).sort();
  const secondKeys = Object.keys(second).sort();
  return firstKeys.length === secondKeys.length &&
    firstKeys.every((key, index) =>
      key === secondKeys[index] && deepEqual(first[key], second[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
