/**
 * The scene checks a lecture save applies, as one pure function, so the live
 * turn can run exactly the same ones before it draws.
 *
 * A figure that renders live and is then refused by the save fails the whole
 * turn (400): the student watched a lesson that cannot be reopened. Family
 * and fallback scenes were never held to the TurnPlan quantity audit live, so
 * a scene carrying a stem-derived quantity the plan does not state (a ladder's
 * angle, a cliff height the planner omitted) drew and then failed to save.
 * Both sides now call this function; anything it rejects is declined before
 * render. Values the engine derives from the stem and the plan are supported
 * once recomputed here (engineDerivedValues); a figure built on a display
 * default is not.
 */
import {
  displayedSceneQuantityTexts,
  validateSceneSourceAuthority,
  RELATIVE_MOTION_SOURCE_MODEL,
  synthesizeFamilyScene,
  validateCoordinateDistanceSourceInputs,
  validateMatrixSourceBinding,
  validatePointLineSourceInputs, validateSectionPointSourceInputs,
  validateRelativeMotionSourceInputs,
  validateUniformCircularSourceInputs,
  validateSceneQuantityAgreement,
  validateTurnPlanSceneProofs,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";

export type SaveAdmissionTier = "exact_verified" | "qualitative_verified" | "question_representation";

export function displayedSceneText(document: SceneDocument): string[] {
  return displayedSceneQuantityTexts(document);
}

function formatIssues(issues: Array<{ code?: string; path?: string; message: string }>): string {
  return issues.slice(0, 4).map((issue) =>
    `${issue.code ?? issue.path ?? "invalid"}: ${issue.message}`,
  ).join("; ");
}

interface EngineDerived {
  quantities: Map<string, { value: unknown; unit: unknown }>;
  texts: Set<string>;
}

const MEASURED = /(-?\d+(?:\.\d+)?)\s*(ohms?|Ω|volts?|V|amps?|A|mm|cm|km|m\/s\^?2|m\/s|m|deg|degrees?|°|rad|radians?|Hz|N|J|W|kg|s)(?=\s|$|[,;).!?:])/gi;

function unitKey(unit: unknown): string {
  const text = typeof unit === "string" ? unit.trim().toLowerCase() : "";
  if (["deg", "degree", "degrees", "°"].includes(text)) return "degree";
  if (["ω", "ohm", "ohms"].includes(text)) return "ohm";
  return text;
}

/**
 * Values the engine itself derives for this question, recomputed here from
 * the question and the validated plan alone (the same inputs on both sides of
 * the save), never read from the submitted document. A figure counts only
 * when every quantity it carries came from the stem or the plan; a figure
 * holding a display default (a stock angle) supports nothing. A value that
 * contradicts a plan-derived value of the same unit is not supported either,
 * so a stale narration scalar can never pair with the engine's figure.
 */
function engineDerivedValues(question: string, turnPlan: TurnPlanV3): EngineDerived {
  const empty: EngineDerived = { quantities: new Map(), texts: new Set() };
  let fresh: ReturnType<typeof synthesizeFamilyScene>;
  try {
    fresh = synthesizeFamilyScene({ question, turnPlan });
  } catch {
    return empty;
  }
  if (!fresh) return empty;
  const source = fresh.document.source as Record<string, unknown>;
  const slotSources = typeof source.slotSources === "object" && source.slotSources !== null
    ? source.slotSources as Record<string, unknown>
    : null;
  if (!slotSources) return empty;
  const sourced = (id: string): boolean => slotSources[id] === "stem" || slotSources[id] === "plan";
  if (!fresh.document.quantities.every((quantity) => sourced(quantity.id))) return empty;
  // This document was regenerated above, never supplied by the caller. These
  // source programs check plan values by physical role before synthesis, then
  // validate the complete computed state. Different roles may share a unit
  // (initial position and encounter position, for example).
  const roleCheckedSource =
    (source.sourceModel === RELATIVE_MOTION_SOURCE_MODEL && validateRelativeMotionSourceInputs(fresh.document, question).length === 0)
    || (source.archetype === "uniform_circular_motion_source" && validateUniformCircularSourceInputs(fresh.document, question).length === 0);
  const derived = turnPlan.derived.map((quantity) => ({ value: quantity.value, unit: unitKey(quantity.unit) }));
  const contradicts = (value: number, unit: string): boolean => !roleCheckedSource && derived.some((quantity) =>
    quantity.unit === unit && Math.abs(quantity.value - value) > 1e-6 * Math.max(1, Math.abs(value)) + 0.05);
  const quantities = new Map<string, { value: unknown; unit: unknown }>();
  for (const quantity of fresh.document.quantities) {
    if (typeof quantity.value === "number" && contradicts(quantity.value, unitKey(quantity.unit))) continue;
    quantities.set(quantity.id, { value: quantity.value, unit: quantity.unit });
  }
  const texts = new Set<string>();
  for (const text of displayedSceneText(fresh.document)) {
    const values = [...text.matchAll(MEASURED)].map((match) => ({ value: Number(match[1]), unit: unitKey(match[2]) }));
    if (values.some((value) => contradicts(value.value, value.unit))) continue;
    texts.add(text);
  }
  return { quantities, texts };
}

/**
 * The plan and source checks of the save, after the document compiles. Returns
 * the save's own failure message, or null when the save would accept them.
 */
export function sceneSaveAdmissionFailure(input: {
  document: SceneDocument;
  question: string;
  turnPlan: TurnPlanV3 | null;
  tier: SaveAdmissionTier;
  problemIR?: unknown;
}): string | null {
  const { document, question, turnPlan, tier } = input;
  if (turnPlan) {
    // Quantities and labels the engine derives from the stem and the plan,
    // recomputed here, are supported alongside the plan's own. Plan ids stay
    // authoritative: a plan quantity is always checked against the plan.
    const planIds = new Set([...turnPlan.givens, ...turnPlan.derived].map((quantity) => quantity.id));
    let engine: EngineDerived | null = null;
    const derivedByEngine = (): EngineDerived => engine ??= engineDerivedValues(question, turnPlan);
    const audited = document.quantities.filter((quantity) => {
      if (planIds.has(quantity.id)) return true;
      const fresh = derivedByEngine().quantities.get(quantity.id);
      return !(fresh && fresh.value === quantity.value && unitKey(fresh.unit) === unitKey(quantity.unit));
    });
    const texts = displayedSceneText(document).filter((text) => !derivedByEngine().texts.has(text));
    const agreementIssues = validateSceneQuantityAgreement(
      audited,
      turnPlan,
      texts,
    );
    if (agreementIssues.length > 0) {
      return `scene quantities disagree with TurnPlanV3: ${formatIssues(agreementIssues)}`;
    }
  }
  const sourceInputIssues = [
    ...validateSceneSourceAuthority(document, question, input.problemIR),
    ...validateCoordinateDistanceSourceInputs(document, question),
    ...validatePointLineSourceInputs(document, question),
    ...validateSectionPointSourceInputs(document, question),
    ...validateRelativeMotionSourceInputs(document, question),
    ...validateUniformCircularSourceInputs(document, question),
    ...validateMatrixSourceBinding(document, question, turnPlan),
  ];
  if (sourceInputIssues.some((issue) => issue.severity === "fatal")) {
    return `scene source inputs are unsupported or disagree: ${formatIssues(sourceInputIssues)}`;
  }
  if (sourceInputIssues.some((issue) => issue.code === "matrix_source_component_only") && tier !== "question_representation") {
    return "source-proved matrix components cannot be saved as a whole-question exact or qualitative result";
  }
  return null;
}

/**
 * Everything the live turn can check of the save before drawing: the exact
 * tier's proof obligations against the plan, then the shared checks above.
 * (The save's point-line solver-binding check needs the solver artifacts and
 * is not repeated here.)
 */
export function liveSceneSaveFailure(input: {
  document: SceneDocument;
  question: string;
  turnPlan: TurnPlanV3 | null;
  tier: SaveAdmissionTier;
  problemIR?: unknown;
}): string | null {
  if (input.tier === "exact_verified" && input.turnPlan) {
    const proofIssues = validateTurnPlanSceneProofs(input.document, input.turnPlan);
    if (proofIssues.some((issue) => issue.severity === "fatal")) {
      return `scene proof obligations failed: ${formatIssues(proofIssues)}`;
    }
  }
  return sceneSaveAdmissionFailure(input);
}
