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
import { FIGURE_QUESTION_CHARS, figureQuestionChars } from "@/lib/scene/figureQuestion";
import {
  displayedSceneQuantityTexts,
  certifyVseprSourceDocument,
  RELATIVE_MOTION_SOURCE_MODEL,
  synthesizeFamilyScene,
  validateCoordinateDistanceSourceInputs,
  validateMatrixSourceBinding,
  validatePvSourceBinding,
  validateFluidApparatusSourceInputs,
  validateLinearSourcePlan,
  validatePointLineSourceInputs, validateSectionPointSourceInputs,
  validateRelativeMotionSourceInputs,
  validateUniformCircularSourceInputs,
  validateSceneQuantityAgreement,
  validateProjectileMeasurementPlan,
  vseprPlanConflict,
  validateTurnPlanSceneProofs,
  validateCircuitTerminalClosure,
  opticsArchetypeOf,
  opticsArchetypePlanAgreement,
  sceneUnitSignature,
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
  /** The regenerated document itself, when one was built. */
  document?: SceneDocument;
}

const MEASURED = /(-?\d+(?:\.\d+)?)\s*(ohms?|Ω|volts?|V|amps?|A|mm|cm|km|m\/s\^?2|m\/s|m|deg|degrees?|°|rad|radians?|Hz|N|J|W|kg|s)(?=\s|$|[,;).!?:])/gi;

function unitKey(unit: unknown): string {
  const text = typeof unit === "string" ? unit.trim().toLowerCase() : "";
  if (["deg", "degree", "degrees", "°"].includes(text)) return "degree";
  if (["ω", "ohm", "ohms"].includes(text)) return "ohm";
  return text;
}

/**
 * The coarse dimension of a unit, wider than its exact signature so that no unit of the
 * same kind slips past: every length is "length" (pm, nm, Å), every energy is "energy"
 * (kJ/mol, J/mol, eV, kcal/mol), a plain number is "". Anything not recognised is
 * "unknown", which the caller treats as governing everything.
 */
function measureDimension(unit: unknown): string {
  const text = typeof unit === "string" ? unit.trim() : unit === undefined || unit === null ? "" : null;
  if (text === null) return "unknown";
  if (/^(?:å|angstroms?|ångströms?)$/i.test(text)) return "length";
  if (/^k?cal(?:\s*(?:\/\s*mol|mol\^?-1))?$/i.test(text)) return "energy";
  const signature = sceneUnitSignature(text);
  if (signature === null) return "unknown";
  if (signature === "m^1") return "length";
  if (/^(?:J|eV)\^1(?:·mol\^-1)?$/.test(signature)) return "energy";
  return signature;
}

/** Units a question may state a value in, read only to decline. One letter units need a space ("5 s", not "4s"). */
const STATED_UNIT = /^\s*(?:k?J\b|MJ\b|kcal\b|cal\b|eV\b|pm\b|nm\b|Å|angstroms?\b|ångströms?\b|picomet(?:re|er)s?\b|nanomet(?:re|er)s?\b|pauling\b|debye\b|kPa\b|atm\b|bar\b|mol\b|mmol\b|mL\b|°C?|%|\s(?:s|K|D|M|V|L|g|m)\b)/iu;

/**
 * Whether the question states a value of its own: a decimal, or a number followed by a
 * unit, outside formula notation. A digit after a letter (SF6, H2S, C2H4) or after a
 * caret (SO4^2-) is notation, not a value; "period 3" and "group 17" carry no unit.
 * Read only to decline: a computed figure never overrides numbers the question gave.
 */
export function questionStatesValue(question: string): boolean {
  const text = question.normalize("NFKC").replace(/[−–]/g, "-");
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_^.])-?\d+(?:\.\d+)?/gu)) {
    const number = match[0];
    const after = text.slice(match.index! + number.length);
    if (number.includes(".")) return true;
    if (STATED_UNIT.test(after)) return true;
  }
  return false;
}

/**
 * Values the engine itself derives for this question, recomputed here from
 * the question and the validated plan alone (the same inputs on both sides of
 * the save), never read from the submitted document. A figure counts only
 * when every quantity it carries came from the stem or the plan, or was
 * computed by the family itself (a bond count from its own structure, a value
 * from the periodic table); a figure holding a display default (a stock angle)
 * supports nothing. A value that contradicts a plan-derived value of the same
 * unit is not supported either, so a stale narration scalar can never pair
 * with the engine's figure. A computed value supports nothing when the plan
 * states any number in its unit: the question's own numbers govern then.
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
  const regenerated = { ...empty, document: fresh.document };
  const source = fresh.document.source as Record<string, unknown>;
  const slotSources = typeof source.slotSources === "object" && source.slotSources !== null
    ? source.slotSources as Record<string, unknown>
    : null;
  if (!slotSources) return regenerated;
  const sourced = (id: string): boolean => slotSources[id] === "stem" || slotSources[id] === "plan" || slotSources[id] === "computed";
  if (!fresh.document.quantities.every((quantity) => sourced(quantity.id))) return regenerated;
  // A computed value supports nothing once the plan states any number of its dimension,
  // in any unit and under any id: radii in nm govern computed pm, J/mol governs kJ/mol.
  // A plan number in a unit nobody recognises governs every computed value. The families
  // that compute their quantities carry one in each unit they show, so refusing the
  // quantity refuses the figure; their texts hold no value MEASURED reads.
  const planDimensions = new Set([...turnPlan.givens, ...turnPlan.derived].map((quantity) => measureDimension(quantity.unit)));
  // The question's own stated values govern too, with or without plan givens.
  const questionStates = questionStatesValue(question);
  const computedButPlanStated = (id: string, unit: unknown): boolean => {
    if (slotSources[id] !== "computed") return false;
    if (questionStates) return true;
    const dimension = measureDimension(unit);
    return planDimensions.has("unknown") || dimension === "unknown"
      ? planDimensions.size > 0
      : planDimensions.has(dimension);
  };
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
    if (computedButPlanStated(quantity.id, quantity.unit)) continue;
    quantities.set(quantity.id, { value: quantity.value, unit: quantity.unit });
  }
  const texts = new Set<string>();
  for (const text of displayedSceneText(fresh.document)) {
    const values = [...text.matchAll(MEASURED)].map((match) => ({ value: Number(match[1]), unit: unitKey(match[2]) }));
    if (values.some((value) => contradicts(value.value, value.unit))) continue;
    texts.add(text);
  }
  return { quantities, texts, document: fresh.document };
}

/**
 * The engine's own lens or mirror figure, regenerated here from the question
 * and the plan: same archetype, same u, f and v, same span texts. Only that
 * document is held to the optics agreement; a submitted document that merely
 * names the archetype is audited as before.
 */
function isRegeneratedOpticsFigure(document: SceneDocument, fresh: SceneDocument | undefined): boolean {
  if (!fresh || !opticsArchetypeOf(document) || opticsArchetypeOf(fresh) !== opticsArchetypeOf(document)) return false;
  const quantities = (doc: SceneDocument) => JSON.stringify(doc.quantities.map((quantity) => [quantity.id, quantity.value, quantity.unit]).sort());
  const spans = (doc: SceneDocument) => JSON.stringify(doc.entities.filter((entity) => entity.kind === "dimension").map((entity) => [entity.id, entity.label ?? null]).sort());
  return quantities(document) === quantities(fresh) && spans(document) === spans(fresh);
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
}): string | null {
  const { document, question, turnPlan, tier } = input;
  // Source geometry never becomes optional with the planner metadata. Legacy
  // native figures without a retained plan still need the exact source graph.
  const vsepr = certifyVseprSourceDocument(document, question, turnPlan);
  if (vsepr.status === "rejected") {
    return `scene source inputs are unsupported or disagree: ${formatIssues(vsepr.issues)}`;
  }
  if (turnPlan) {
    const molecularConflict = vseprPlanConflict(question, turnPlan);
    if (molecularConflict) return molecularConflict;
    // Quantities and labels the engine derives from the stem and the plan,
    // recomputed here, are supported alongside the plan's own. Plan ids stay
    // authoritative: a plan quantity is always checked against the plan.
    const planIds = new Set([...turnPlan.givens, ...turnPlan.derived].map((quantity) => quantity.id));
    let engine: EngineDerived | null = null;
    const derivedByEngine = (): EngineDerived => engine ??= vsepr.status === "certified"
      ? { quantities: new Map(), texts: new Set(vsepr.texts) }
      : engineDerivedValues(question, turnPlan);
    // The engine's lens or mirror figure: its u, f, v and span texts are
    // checked against the plan by magnitude after exact unit conversion, with
    // the plan's own sign convention; any disagreement refuses.
    let opticsIds = new Set<string>();
    let opticsTexts = new Set<string>();
    if (vsepr.status !== "certified" && isRegeneratedOpticsFigure(document, derivedByEngine().document)) {
      const optics = opticsArchetypePlanAgreement(document, turnPlan, question);
      if (optics.issues.length > 0) {
        return `scene quantities disagree with TurnPlanV3: optics_plan_disagreement: ${optics.issues.slice(0, 3).join("; ")}`;
      }
      opticsIds = new Set(optics.quantityIds);
      opticsTexts = new Set(optics.texts);
    }
    const audited = document.quantities.filter((quantity) => {
      if (opticsIds.has(quantity.id)) return false;
      if (planIds.has(quantity.id)) return true;
      const fresh = derivedByEngine().quantities.get(quantity.id);
      return !(fresh && fresh.value === quantity.value && unitKey(fresh.unit) === unitKey(quantity.unit));
    });
    const texts = displayedSceneText(document).filter((text) => !opticsTexts.has(text) && !derivedByEngine().texts.has(text));
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
    ...(turnPlan ? validateProjectileMeasurementPlan(document, turnPlan) : []),
    ...validateLinearSourcePlan(question, turnPlan),
    ...validateCoordinateDistanceSourceInputs(document, question),
    ...validatePointLineSourceInputs(document, question),
    ...validateSectionPointSourceInputs(document, question),
    ...validateRelativeMotionSourceInputs(document, question),
    ...validateUniformCircularSourceInputs(document, question),
    ...validateMatrixSourceBinding(document, question, turnPlan),
    ...validatePvSourceBinding(document, question, turnPlan),
    ...validateFluidApparatusSourceInputs(document, question, turnPlan),
    // Qualitative scenes need the same declared terminal proof as exact ones.
    // Reuse only closure here; unrelated exact-plan obligations stay tiered.
    ...validateCircuitTerminalClosure(document, question, turnPlan),
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
}): string | null {
  if (input.turnPlan && figureQuestionChars(input.question) > FIGURE_QUESTION_CHARS) {
    return `scene question is over the ${FIGURE_QUESTION_CHARS} character figure size`;
  }
  if (input.tier === "exact_verified" && input.turnPlan) {
    const proofIssues = validateTurnPlanSceneProofs(input.document, input.turnPlan);
    if (proofIssues.some((issue) => issue.severity === "fatal")) {
      return `scene proof obligations failed: ${formatIssues(proofIssues)}`;
    }
  }
  return sceneSaveAdmissionFailure(input);
}
