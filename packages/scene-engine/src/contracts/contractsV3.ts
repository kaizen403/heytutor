/**
 * Verified Diagram Engine v3 contracts.
 *
 * Narrow first: TurnPlanV3 is scalars + qualitative claims.
 * Full expression-tree CAS and vision-gated ready are deferred.
 */

import { validateCoordinateDistanceSourceInputs } from "../ir/coordinateDistanceSource";
import { validatePointLineSourceInputs } from "../ir/pointLineSource";
import { validateSectionPointSourceInputs } from "../ir/sectionFormulaSource";
import { evaluateTopologyAssertion } from "../topology/topology";
import { evaluateMathExpression } from "../math/expression";
import type { SceneDocument, SceneIssue, ValidationReport, RenderScene } from "../types";
import type { ProblemIR } from "../ir/problemIR";
import type { SolverResult } from "../ir/solver";
import type { SolverAuthorityAudit } from "../ir/solverAuthority";

export const TURN_PLAN_V3_VERSION = "turn-plan/v3" as const;
export const SCENE_ARTIFACTS_V3_VERSION = "scene-artifacts/v3" as const;

export type VisualRequirement = "required" | "optional" | "none";

export type TurnPlanProvenance = "given" | "derived" | "assumed";

export interface TurnPlanQuantityV3 {
  id: string;
  /** Human symbol, e.g. "R_eq", "f", "u". */
  symbol: string;
  value: number;
  unit?: string;
  sign?: "positive" | "negative" | "zero" | "unsigned";
  sourceText?: string;
  provenance: TurnPlanProvenance;
  /** IDs of quantities this value depends on. */
  dependsOn?: string[];
  uncertainty?: number;
}

export interface TurnPlanQualitativeClaimV3 {
  id: string;
  /** Free-form but stable claim key, e.g. "image_inverted", "series_path". */
  claim: string;
  expected: boolean | string | number;
  relatedQuantityIds?: string[];
  relatedEntityHints?: string[];
}

export interface TurnPlanV3 {
  schemaVersion: typeof TURN_PLAN_V3_VERSION;
  question: string;
  givens: TurnPlanQuantityV3[];
  unknowns: Array<{ id: string; symbol: string; unit?: string }>;
  derived: TurnPlanQuantityV3[];
  qualitativeClaims: TurnPlanQualitativeClaimV3[];
  /** Law tags only in MVP — not executable CAS. */
  lawIds: string[];
  assumptions: string[];
  visualRequirement: VisualRequirement;
  /** Optional teaching sequence hints (entity/view ids resolved later). */
  teachingSequenceHints?: string[];
}

export interface TurnPlanValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface TurnPlanValidationResult {
  valid: boolean;
  plan: TurnPlanV3 | null;
  issues: TurnPlanValidationIssue[];
}

export interface TurnPlanArithmeticReconciliation {
  quantityId: string;
  previousValue: number;
  reconciledValue: number;
}

export interface TurnPlanArithmeticDecline {
  quantityId: string;
  /** Why the written arithmetic was not used to check or replace the value. */
  reason: "mixed_units";
}

export interface TurnPlanArithmeticReconciliationResult {
  plan: unknown;
  reconciliations: TurnPlanArithmeticReconciliation[];
  /** Values left as declared (and unverified) because the evidence was in doubt. */
  declined: TurnPlanArithmeticDecline[];
}

/**
 * Reconcile only arithmetic that is independently checkable from numeric
 * expressions written in a derived quantity's own sourceText. Symbolic
 * formulas and ambiguous calculations are deliberately left unchanged.
 */
export function reconcileTurnPlanV3ExplicitArithmetic(
  raw: unknown,
): TurnPlanArithmeticReconciliationResult {
  if (!isRecord(raw) || !Array.isArray(raw.derived)) {
    return { plan: raw, reconciliations: [], declined: [] };
  }
  const knownUnits = collectPlanUnits(raw);
  const bindingMeta: NumericBindingMetaMap = new Map();
  const numericBindings = collectNumericBindings(
    Array.isArray(raw.givens) ? raw.givens : [],
    bindingMeta,
  );
  attachTrigStipulations(numericBindings, raw);
  const reconciliations: TurnPlanArithmeticReconciliation[] = [];
  const declined: TurnPlanArithmeticDecline[] = [];
  const derived: unknown[] = [...raw.derived];
  // Evaluate dependencies first so a corrected value reaches every quantity
  // computed from it, whatever order the plan lists them in.
  for (const index of derivedEvaluationOrder(raw.derived)) derived[index] = reconcileOne(raw.derived[index]);
  function reconcileOne(value: unknown): unknown {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.value !== "number" ||
      !Number.isFinite(value.value) ||
      typeof value.sourceText !== "string"
    ) {
      return value;
    }
    const evidence = evaluateExplicitArithmetic(
      value.sourceText,
      value.unit,
      knownUnits,
      numericBindings,
      true,
      [value.id, value.symbol].filter((key): key is string => typeof key === "string"),
      { bindingMeta, declaredValue: value.value },
    );
    const agrees = evidence.value !== null && approximatelyEqual(evidence.value, value.value);
    if (evidence.mixedUnits && !agrees) {
      // Part of the chain mixes units (6400 km in "g R_e^2" for an SI GM)
      // and only its literal numbers back a reading. Never rewrite through
      // that doubt, and never trust the value downstream.
      declined.push({ quantityId: value.id, reason: "mixed_units" });
      addNumericBinding(numericBindings, value, bindingMeta, false);
      return value;
    }
    if (evidence.conflicting || evidence.value === null || agrees) {
      addNumericBinding(numericBindings, value, bindingMeta, evidence.value !== null);
      return value;
    }
    reconciliations.push({
      quantityId: value.id,
      previousValue: value.value,
      reconciledValue: evidence.value,
    });
    const corrected: Record<string, unknown> = {
      ...value,
      value: evidence.value,
      sourceText: replaceRestatedMeasuredValues(
        replaceTrailingMeasuredValues(
          value.sourceText,
          evidence.value,
          value.unit,
        ),
        value.value,
        evidence.value,
        value.unit,
      ),
    };
    if (corrected.sign !== undefined && corrected.sign !== "unsigned") {
      corrected.sign = numericSign(evidence.value);
    }
    addNumericBinding(numericBindings, corrected, bindingMeta);
    return corrected;
  }
  if (reconciliations.length === 0) return { plan: raw, reconciliations, declined };
  return {
    plan: { ...raw, derived },
    reconciliations,
    declined,
  };
}

/**
 * Runtime validation for model-produced plans. TypeScript interfaces do not
 * protect the JSON boundary, so reject malformed or internally inconsistent
 * facts before they become authoritative for the scene and narration.
 */
export function validateTurnPlanV3(raw: unknown, expectedQuestion?: string): TurnPlanValidationResult {
  const issues: TurnPlanValidationIssue[] = [];
  if (!isRecord(raw)) {
    return {
      valid: false,
      plan: null,
      issues: [{ code: "invalid_plan", path: "$", message: "TurnPlanV3 must be an object" }],
    };
  }

  if (raw.schemaVersion !== TURN_PLAN_V3_VERSION) {
    issues.push({ code: "schema_version", path: "schemaVersion", message: `Expected ${TURN_PLAN_V3_VERSION}` });
  }
  if (typeof raw.question !== "string" || raw.question.trim() === "") {
    issues.push({ code: "invalid_question", path: "question", message: "question must be a non-empty string" });
  } else if (
    expectedQuestion !== undefined &&
    normalizeQuestionText(raw.question) !== normalizeQuestionText(expectedQuestion)
  ) {
    issues.push({ code: "question_mismatch", path: "question", message: "planned question does not match the submitted question" });
  }
  if (!isVisualRequirement(raw.visualRequirement)) {
    issues.push({ code: "invalid_visual_requirement", path: "visualRequirement", message: "visualRequirement must be required, optional, or none" });
  }

  const arrayFields = ["givens", "unknowns", "derived", "qualitativeClaims", "lawIds", "assumptions"] as const;
  for (const field of arrayFields) {
    if (!Array.isArray(raw[field])) {
      issues.push({ code: "missing_array", path: field, message: `${field} must be an array` });
    }
  }
  if (issues.some((issue) => issue.code === "missing_array")) {
    return { valid: false, plan: null, issues };
  }

  const givens = raw.givens as unknown[];
  const derived = raw.derived as unknown[];
  const unknowns = raw.unknowns as unknown[];
  const claims = raw.qualitativeClaims as unknown[];
  const quantityIds = new Set<string>();

  const validateQuantity = (value: unknown, path: string, expectedProvenance?: TurnPlanProvenance) => {
    if (!isRecord(value)) {
      issues.push({ code: "invalid_quantity", path, message: "quantity must be an object" });
      return;
    }
    if (typeof value.id !== "string" || value.id.trim() === "") {
      issues.push({ code: "invalid_quantity_id", path: `${path}.id`, message: "quantity id must be non-empty" });
    } else if (quantityIds.has(value.id)) {
      issues.push({ code: "duplicate_quantity_id", path: `${path}.id`, message: `duplicate quantity id ${value.id}` });
    } else {
      quantityIds.add(value.id);
    }
    if (typeof value.symbol !== "string" || value.symbol.trim() === "") {
      issues.push({ code: "invalid_symbol", path: `${path}.symbol`, message: "quantity symbol must be non-empty" });
    }
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
      issues.push({ code: "invalid_quantity_value", path: `${path}.value`, message: "quantity value must be finite" });
    }
    if (value.unit !== undefined && typeof value.unit !== "string") {
      issues.push({ code: "invalid_unit", path: `${path}.unit`, message: "unit must be a string" });
    }
    if (expectedProvenance && value.provenance !== expectedProvenance) {
      issues.push({ code: "invalid_provenance", path: `${path}.provenance`, message: `expected provenance ${expectedProvenance}` });
    }
    if (value.sign !== undefined && !["positive", "negative", "zero", "unsigned"].includes(String(value.sign))) {
      issues.push({ code: "invalid_sign", path: `${path}.sign`, message: "invalid quantity sign" });
    }
    if (typeof value.value === "number" && value.sign !== undefined && value.sign !== "unsigned") {
      const actualSign = value.value > 0 ? "positive" : value.value < 0 ? "negative" : "zero";
      if (value.sign !== actualSign) {
        issues.push({ code: "sign_mismatch", path: `${path}.sign`, message: `declared sign ${String(value.sign)} disagrees with value` });
      }
    }
    if (value.dependsOn !== undefined && (!Array.isArray(value.dependsOn) || value.dependsOn.some((id) => typeof id !== "string"))) {
      issues.push({ code: "invalid_dependencies", path: `${path}.dependsOn`, message: "dependsOn must contain quantity ids" });
    }
  };

  givens.forEach((value, index) => validateQuantity(value, `givens[${index}]`, "given"));
  derived.forEach((value, index) => validateQuantity(value, `derived[${index}]`, "derived"));
  const knownUnits = collectPlanUnits(raw);
  const validationBindingMeta: NumericBindingMetaMap = new Map();
  const validationBindings = collectNumericBindings(givens, validationBindingMeta);
  attachTrigStipulations(validationBindings, raw);
  derivedEvaluationOrder(derived).forEach((index) => {
    const value = derived[index];
    if (
      !isRecord(value) ||
      typeof value.value !== "number" ||
      !Number.isFinite(value.value) ||
      typeof value.sourceText !== "string"
    ) {
      addNumericBinding(validationBindings, value, validationBindingMeta, false);
      return;
    }
    const evidence = evaluateExplicitArithmetic(
      value.sourceText,
      value.unit,
      knownUnits,
      validationBindings,
      false,
      [value.id, value.symbol].filter((key): key is string => typeof key === "string"),
      { bindingMeta: validationBindingMeta, declaredValue: value.value },
    );
    if (evidence.invalid) {
      issues.push({
        code: "source_text_arithmetic_invalid",
        path: `derived[${index}].sourceText`,
        message: "an independently checkable calculation in sourceText is arithmetically incorrect",
      });
    } else if (evidence.conflicting) {
      issues.push({
        code: "source_text_arithmetic_conflict",
        path: `derived[${index}].sourceText`,
        message: "independently checkable calculations in sourceText disagree",
      });
    } else if (
      evidence.value !== null &&
      !approximatelyEqual(evidence.value, value.value) &&
      Math.abs(evidence.value - value.value) > (evidence.tolerance ?? 0) &&
      !sourceContainsMatchingMeasuredValue(value.sourceText, value.value, value.unit)
    ) {
      issues.push({
        code: "source_text_value_mismatch",
        path: `derived[${index}].value`,
        message: `declared value ${value.value} disagrees with explicit arithmetic result ${evidence.value}`,
      });
    }
    addNumericBinding(
      validationBindings,
      value,
      validationBindingMeta,
      evidence.value !== null &&
        Math.abs(evidence.value - (value.value as number)) <= (evidence.tolerance ?? 0) +
          Math.max(1, Math.abs(evidence.value)) * 1e-9,
    );
  });

  const unknownIds = new Set<string>();
  unknowns.forEach((value, index) => {
    const path = `unknowns[${index}]`;
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.symbol !== "string") {
      issues.push({ code: "invalid_unknown", path, message: "unknown requires string id and symbol" });
      return;
    }
    if (unknownIds.has(value.id)) {
      issues.push({ code: "duplicate_unknown_id", path: `${path}.id`, message: `duplicate unknown id ${value.id}` });
    }
    unknownIds.add(value.id);
  });
  const knownQuantityIds = new Set(quantityIds);
  const quantityById = new Map([...givens, ...derived].flatMap((quantity) =>
    isRecord(quantity) && typeof quantity.id === "string" &&
      typeof quantity.value === "number" && Number.isFinite(quantity.value)
      ? [[quantity.id, quantity] as const]
      : [],
  ));
  const claimQuantityIds = new Set([...knownQuantityIds, ...unknownIds]);
  derived.forEach((value, index) => {
    if (!isRecord(value) || !Array.isArray(value.dependsOn)) return;
    for (const dependency of value.dependsOn) {
      if (typeof dependency === "string" && !knownQuantityIds.has(dependency)) {
        issues.push({ code: "unknown_dependency", path: `derived[${index}].dependsOn`, message: `unknown dependency ${dependency}` });
      }
      if (dependency === value.id) {
        issues.push({ code: "cyclic_dependency", path: `derived[${index}].dependsOn`, message: "a quantity cannot depend on itself" });
      }
    }
  });

  const claimIds = new Set<string>();
  const questionMeasurements = [raw.question, expectedQuestion]
    .filter((text): text is string => typeof text === "string")
    .flatMap(claimMeasuredValues);
  const planSymbols = new Set([...givens, ...derived, ...unknowns].flatMap((quantity) =>
    isRecord(quantity) && typeof quantity.symbol === "string" && quantity.symbol.trim() !== ""
      ? [quantity.symbol.trim()]
      : []));
  claims.forEach((value, index) => {
    const path = `qualitativeClaims[${index}]`;
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.claim !== "string") {
      issues.push({ code: "invalid_claim", path, message: "claim requires string id and claim" });
      return;
    }
    if (claimIds.has(value.id)) {
      issues.push({ code: "duplicate_claim_id", path: `${path}.id`, message: `duplicate claim id ${value.id}` });
    }
    claimIds.add(value.id);
    if (!["boolean", "string", "number"].includes(typeof value.expected) ||
        (typeof value.expected === "number" && !Number.isFinite(value.expected))) {
      issues.push({ code: "invalid_claim_expected", path: `${path}.expected`, message: "claim expected value must be finite scalar data" });
    }
    if (Array.isArray(value.relatedQuantityIds)) {
      for (const id of value.relatedQuantityIds) {
        if (typeof id !== "string" || !claimQuantityIds.has(id)) {
          issues.push({ code: "unknown_claim_quantity", path: `${path}.relatedQuantityIds`, message: `unknown related quantity ${String(id)}` });
        }
      }
      const linkedQuantities = value.relatedQuantityIds.flatMap((id) => {
        const quantity = typeof id === "string" ? quantityById.get(id) : undefined;
        return quantity ? [quantity] : [];
      });
      const claimTexts = [value.claim, value.expected]
        .filter((text): text is string => typeof text === "string");
      const sameValue = (
        quantity: Record<string, unknown>,
        measurement: ClaimMeasurement,
        allowMagnitude: boolean,
      ) => typeof quantity.value === "number" && (
        claimMatchesAtStatedPrecision(quantity.value, quantity.unit, measurement) || (
          allowMagnitude &&
          claimMatchesAtStatedPrecision(
            Math.abs(quantity.value),
            quantity.unit,
            { ...measurement, value: Math.abs(measurement.value) },
          )
        ));
      const mismatch = (measurement: ClaimMeasurement) => issues.push({
        code: "claim_quantity_mismatch",
        path: `${path}.claim`,
        message: `measured claim ${measurement.value} ${measurement.unit} disagrees with its linked quantities`,
      });
      const classified = claimTexts.flatMap((text) =>
        classifyClaimMeasurements(text, linkedQuantities, value.id as string, planSymbols)
          .map((entry) => ({ ...entry, text })));
      const statesValue = (quantity: Record<string, unknown>) => classified.some((entry) =>
        entry.kind === "linked" && entry.quantities.includes(quantity) &&
        claimSameDimension(quantity.unit, entry.measurement.unit) &&
        sameValue(quantity, entry.measurement, entry.magnitude === true || isDeclaredMagnitude(quantity)));
      const statedOwnValues = (quantities: Record<string, unknown>[]) => quantities
        .filter(statesValue)
        .map((quantity) => quantity.value as number);
      // A listed candidate that is one of these quantities' own value.
      const ownValueOf = (quantities: Record<string, unknown>[]) => (candidate: (typeof classified)[number]) =>
        quantities.some((quantity) =>
          claimSameDimension(quantity.unit, candidate.measurement.unit) &&
          sameValue(quantity, candidate.measurement, ("magnitude" in candidate && candidate.magnitude === true) || isDeclaredMagnitude(quantity)));
      for (const entry of classified) {
        if (entry.kind === "other") continue;
        const { measurement } = entry;
        if (entry.kind === "linked") {
          // A number stated as the quantity's value must be its value. The
          // sign may differ only for a quantity declared as a magnitude.
          const comparable = entry.quantities.filter((quantity) =>
            claimSameDimension(quantity.unit, measurement.unit));
          if (
            comparable.length > 0 &&
            !comparable.some((quantity) =>
              sameValue(quantity, measurement, entry.magnitude === true || isDeclaredMagnitude(quantity))) &&
            // "roots t = 5 s and t = -1 s; the negative root is rejected":
            // a candidate the claim itself discards is not taught as the
            // value. Only the discarded number is excused; every other
            // number stated for the quantity must still be its value.
            !claimNumberIsDiscarded(entry, statedOwnValues(comparable), classified, ownValueOf(comparable))
          ) mismatch(measurement);
          continue;
        }
        // A number the claim does not attribute still carries a linked
        // quantity's dimension, so it may be that quantity's value worded
        // indirectly ("comes out to 12 cm"). Prose states sizes without
        // signs, so a magnitude matches; otherwise the number must be
        // explained by another of the plan's quantities or by the question.
        const comparable = linkedQuantities.filter((quantity) =>
          claimSameDimension(quantity.unit, measurement.unit));
        if (comparable.length === 0) continue;
        if (comparable.some((quantity) => sameValue(quantity, measurement, true))) continue;
        // "discard the negative value -1 s": a number the claim throws away
        // states nothing.
        if (claimNumberIsDiscarded(entry, statedOwnValues(comparable), classified, ownValueOf(comparable))) continue;
        // "I2 = -1.5 A (i.e. 1.5 A into the battery)" restates a number the
        // claim attributes elsewhere; that attribution decides it.
        const restates = classified.some((other) =>
          other.kind !== "unattributed" &&
          claimSameDimension(other.measurement.unit, measurement.unit) &&
          claimEquivalentMeasuredQuantity(
            Math.abs(other.measurement.value),
            other.measurement.unit,
            Math.abs(measurement.value),
            measurement.unit,
            Math.max(measurement.tolerance, other.measurement.tolerance),
          ));
        if (restates) continue;
        const explained = [...quantityById.values()].some((quantity) =>
          claimSameDimension(quantity.unit, measurement.unit) && sameValue(quantity, measurement, true)) ||
          questionMeasurements.some((stated) =>
            claimSameDimension(stated.unit, measurement.unit) &&
            claimEquivalentMeasuredQuantity(
              Math.abs(stated.value),
              stated.unit,
              Math.abs(measurement.value),
              measurement.unit,
              Math.max(measurement.tolerance, stated.tolerance),
            ));
        if (!explained) mismatch(measurement);
      }
    } else if (value.relatedQuantityIds !== undefined) {
      issues.push({
        code: "invalid_claim_quantity_ids",
        path: `${path}.relatedQuantityIds`,
        message: "relatedQuantityIds must be an array of quantity IDs",
      });
    }
    if (
      value.relatedEntityHints !== undefined &&
      (!Array.isArray(value.relatedEntityHints) ||
        value.relatedEntityHints.some((hint) => typeof hint !== "string"))
    ) {
      issues.push({
        code: "invalid_claim_entity_hints",
        path: `${path}.relatedEntityHints`,
        message: "relatedEntityHints must be an array of strings",
      });
    }
  });
  const qualitativeOnlyUnknownIds = new Set<string>();
  for (const unknown of unknowns) {
    if (!isRecord(unknown) || typeof unknown.id !== "string") continue;
    const unknownKeys = [unknown.id, unknown.symbol]
      .filter((key): key is string => typeof key === "string")
      .map(normalizeQuantityMatchKey)
      .filter(Boolean);
    const answeredByClaim = claims.some((claim) => {
      if (
        !isRecord(claim) ||
        !["boolean", "string", "number"].includes(typeof claim.expected)
      ) return false;
      if (
        Array.isArray(claim.relatedQuantityIds) &&
        claim.relatedQuantityIds.includes(unknown.id)
      ) return true;
      const claimKeys = [claim.id, claim.claim]
        .filter((key): key is string => typeof key === "string")
        .map(normalizeQuantityMatchKey)
        .filter(Boolean);
      return unknownKeys.some((unknownKey) =>
        claimKeys.some((claimKey) => semanticQuantityKeysMatch(unknownKey, claimKey))) ||
        shareSemanticAnswerAnchor(unknown, claim);
    });
    if (answeredByClaim) qualitativeOnlyUnknownIds.add(unknown.id);
  }
  const derivedKeys = derived.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.value !== "number" ||
      !Number.isFinite(value.value)
    ) return [];
    return [value.id, value.symbol]
      .filter((key): key is string => typeof key === "string")
      .map(normalizeQuantityMatchKey)
      .filter(Boolean);
  });
  unknowns.forEach((value, index) => {
    if (!isRecord(value) || typeof value.id !== "string") return;
    if (qualitativeOnlyUnknownIds.has(value.id)) return;
    const keys = [value.id, value.symbol]
      .filter((key): key is string => typeof key === "string")
      .map(normalizeQuantityMatchKey)
      .filter(Boolean);
    const resolved = keys.some((key) =>
      derivedKeys.some((derivedKey) => semanticQuantityKeysMatch(key, derivedKey)));
    if (!resolved) {
      issues.push({
        code: "unresolved_numeric_unknown",
        path: `unknowns[${index}]`,
        message: `requested unknown ${value.id} has no matching finite derived result`,
      });
    }
  });

  (raw.lawIds as unknown[]).forEach((value, index) => {
    if (typeof value !== "string" || value.trim() === "") {
      issues.push({ code: "invalid_law_id", path: `lawIds[${index}]`, message: "law id must be a non-empty string" });
    }
  });
  (raw.assumptions as unknown[]).forEach((value, index) => {
    if (typeof value !== "string" || value.trim() === "") {
      issues.push({ code: "invalid_assumption", path: `assumptions[${index}]`, message: "assumption must be a non-empty string" });
    }
  });

  return {
    valid: issues.length === 0,
    plan: issues.length === 0
      ? { ...raw, question: expectedQuestion ?? raw.question } as unknown as TurnPlanV3
      : null,
    issues,
  };
}

function normalizeQuestionText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeQuantityMatchKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\(?:mathrm|text|operatorname)/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(?:computed|calculated|calculation|calc|result|answer|value|val)$/, "");
}

function semanticQuantityKeysMatch(first: string, second: string): boolean {
  if (first === second) return true;
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  if (shorter.length === 0) return false;
  if (shorter.length >= 4) return longer.includes(shorter);
  if (!longer.startsWith(shorter)) return false;
  const rest = longer.slice(shorter.length);
  return rest.length === 0 || /^(?:[0-9]|tan|slope|val|at|prime)/.test(rest);
}

const QUALITATIVE_DESCRIPTOR_WORDS = new Set([
  "answer", "claim", "direction", "nature", "orientation", "result", "state", "the", "type", "value",
]);

function shareSemanticAnswerAnchor(
  unknown: Record<string, unknown>,
  claim: Record<string, unknown>,
): boolean {
  const keepShort = new Set(
    [unknown.id, unknown.symbol]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase()),
  );
  const words = (values: unknown[]): Set<string> => new Set(values.flatMap((value) =>
    typeof value === "string"
      ? value
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((word) =>
            (word.length > 1 || keepShort.has(word)) && !QUALITATIVE_DESCRIPTOR_WORDS.has(word))
      : [],
  ));
  const unknownWords = words([unknown.id, unknown.symbol]);
  const claimWords = words([claim.id, claim.claim]);
  return [...unknownWords].some((word) => claimWords.has(word));
}

interface ExplicitArithmeticEvidence {
  value: number | null;
  conflicting: boolean;
  invalid: boolean;
  /** Displayed precision of a stated result the evidence was read from. */
  tolerance?: number;
  /** A clause mixed input units and was set aside as no evidence. */
  mixedUnits?: boolean;
}

interface ExplicitArithmeticOptions {
  bindingMeta?: NumericBindingMetaMap;
  /** The plan's own value, used only to choose between unit readings. */
  declaredValue?: number;
}

function evaluateExplicitArithmetic(
  sourceText: string,
  expectedUnit: unknown,
  knownUnits: string[],
  numericBindings: Map<string, number> = new Map(),
  reconcile = false,
  targetKeys: string[] = [],
  options: ExplicitArithmeticOptions = {},
): ExplicitArithmeticEvidence {
  const results: Array<{ value: number; tolerance: number }> = [];
  const pushResult = (value: number, stated?: { tolerance: number } | null) => {
    results.push({ value, tolerance: stated?.tolerance ?? 0 });
  };
  const assertions: Array<{ value: number; tolerance: number }> = [];
  const bindingMeta = options.bindingMeta ?? new Map<string, NumericBindingMeta>();
  const declaredAnchor = typeof options.declaredValue === "number" && Number.isFinite(options.declaredValue)
    ? {
        value: options.declaredValue,
        tolerance: displayedNumberTolerance(String(options.declaredValue)),
      }
    : null;
  const readableSource = chainWorksInDegrees(sourceText, expectedUnit, numericBindings)
    ? guardBareDegreeLikeTrigArguments(sourceText)
    : sourceText;
  let invalid = false;
  let signConflict = false;
  let mixedUnits = false;
  for (const clause of splitArithmeticClauses(readableSource)) {
    const equalityParts = splitEqualityParts(clause);
    if (equalityParts.length < 2) continue;
    const clauseTargetKeys = expandDescriptiveAssignmentTargets(equalityParts, targetKeys);
    let stated: { value: number; tolerance: number } | null = null;
    let statedIndex = -1;
    for (let index = equalityParts.length - 1; index >= 1; index -= 1) {
      stated = parseLeadingMeasuredValue(equalityParts[index] ?? "", expectedUnit);
      if (stated) {
        statedIndex = index;
        break;
      }
    }
    const inverseTrigDegrees = evaluateInverseTrigDegreeTarget(
      equalityParts,
      clauseTargetKeys,
      expectedUnit,
      knownUnits,
      numericBindings,
    );
    if (inverseTrigDegrees !== null) {
      if (stated && !withinDisplayedPrecision(inverseTrigDegrees, stated)) {
        invalid = true;
      } else {
        if (reconcile || !stated) pushResult(inverseTrigDegrees);
        else pushResult(stated.value, stated);
      }
      continue;
    }
    if (
      normalizeUnit(expectedUnit) === "degree" &&
      /\b(?:asin|acos|atan|arcsin|arccos|arctan)\s*\(/i.test(normalizeInverseTrigNotation(clause))
    ) {
      // An inverse trig result is in radians. For a target in degrees the
      // clause is evidence only through the degree reading above.
      continue;
    }
    const assertion = parseTargetAssertion(equalityParts, clauseTargetKeys, expectedUnit);
    if (assertion) {
      // "x = 30" restates a value; it is not arithmetic, so it can never be
      // the source of an overwrite, but a computation that disagrees with it
      // makes the sourceText contradict itself.
      assertions.push(assertion);
      continue;
    }
    const solvedTarget = solveExplicitTargetEquation(
      equalityParts,
      clauseTargetKeys,
      knownUnits,
      numericBindings,
      statedIndex,
      bindingMeta,
    );
    if (solvedTarget !== null) {
      const targetStated = solvedTarget.isolated ? stated : null;
      const anchors = [targetStated, declaredAnchor].filter((anchor) => anchor !== null);
      let reading = readSolvedValueInUnit(solvedTarget, equalityParts, expectedUnit, bindingMeta, anchors);
      if (solvedTarget.writtenSign) {
        // The written sign wins only when the chain's stated result or the
        // plan's value agrees with it. Otherwise the chain contradicts itself
        // on the sign: never overwrite, and report the disagreement.
        const written = readSolvedValueInUnit(
          solvedTarget.writtenSign,
          equalityParts,
          expectedUnit,
          bindingMeta,
          anchors,
        );
        if (
          written.kind === "value" &&
          anchors.some((anchor) => withinDisplayedPrecision(written.value, anchor))
        ) {
          reading = written;
        } else {
          signConflict = true;
          continue;
        }
      }
      if (reading.kind === "inconsistent_units") continue;
      if (reading.kind === "mixed_units") {
        mixedUnits = true;
        continue;
      }
      if (
        reading.kind === "value" && targetStated &&
        !withinDisplayedPrecision(reading.value, targetStated) &&
        usesUntrustedBinding(solvedTarget, bindingMeta) &&
        (solvedTarget.alternatives ?? []).some((alternative) => {
          if (usesUntrustedBinding(alternative, bindingMeta)) return false;
          const alternativeReading = readSolvedValueInUnit(
            alternative,
            equalityParts,
            expectedUnit,
            bindingMeta,
            [targetStated],
          );
          return alternativeReading.kind === "value" &&
            withinDisplayedPrecision(alternativeReading.value, targetStated);
        })
      ) {
        // The chain's own numbers agree with its result; only an unchecked
        // upstream value (V = 6 whose text computes 5.727) disagrees. That
        // is doubt about the upstream value, not evidence for this one.
        continue;
      }
      if (reading.kind === "no_reading") {
        // Every unit reading of the computed number disagrees with the value
        // the plan states, so the plan's own arithmetic is wrong. Never
        // overwrite from an unpinned unit; validation reports it.
        if (!reconcile) invalid = true;
        continue;
      }
      if (targetStated && !reconcile && !withinDisplayedPrecision(reading.value, targetStated)) {
        invalid = true;
      } else {
        if (reconcile || !targetStated) pushResult(reading.value);
        else pushResult(targetStated.value, targetStated);
      }
      continue;
    }
    const anonymous = clauseMentionsTarget(equalityParts, clauseTargetKeys)
      ? null
      : evaluateAnchoredAnonymousChain(
          equalityParts,
          expectedUnit,
          knownUnits,
          numericBindings,
          bindingMeta,
          declaredAnchor,
        );
    if (anonymous) {
      if (anonymous.kind === "value") {
        if (!reconcile && !withinDisplayedPrecision(anonymous.value, anonymous.stated)) {
          invalid = true;
        } else {
          if (reconcile) pushResult(anonymous.value);
          else pushResult(anonymous.stated.value, anonymous.stated);
        }
      } else if (anonymous.kind === "no_reading" && !reconcile) {
        invalid = true;
      } else if (anonymous.kind === "mixed_units") {
        mixedUnits = true;
      }
      continue;
    }
    if (equalityParts.some((part) => targetWrappedByNonlinearFunction(part, clauseTargetKeys))) {
      // A nonlinear or otherwise unsupported equation for the requested
      // quantity is not evidence that its numeric right-hand side is the
      // quantity itself (for example sin(theta)=0.47).
      continue;
    }
    if (clauseTargetKeys.length > 0) {
      // A clause may validate or replace an authoritative value only when it
      // contains a solvable assignment for that quantity. Incidental
      // equalities such as "with n_air=1" are useful context, but are not
      // evidence for an unrelated target such as theta_r.
      continue;
    }
    const expressionCandidates = equalityParts.slice(
      1,
      stated && statedIndex >= 1 ? statedIndex : equalityParts.length,
    );
    for (const candidate of expressionCandidates) {
      const expression = normalizeExplicitNumericExpression(
        candidate,
        knownUnits,
        numericBindings,
      );
      if (!expression) continue;
      try {
        const calculated = evaluateMathExpression(expression, 0);
        if (!Number.isFinite(calculated)) continue;
        if (!stated || reconcile) {
          pushResult(calculated);
        } else if (withinDisplayedPrecision(calculated, stated)) {
          pushResult(stated.value, stated);
        } else {
          invalid = true;
        }
        break;
      } catch {
        // Try the next, usually more explicit, equality part.
      }
    }
  }
  if (invalid) return { value: null, conflicting: false, invalid: true, mixedUnits };
  if (signConflict) return { value: null, conflicting: true, invalid: false, mixedUnits };
  const agree = (
    one: { value: number; tolerance: number },
    other: { value: number; tolerance: number },
  ) => approximatelyEqual(one.value, other.value) ||
    Math.abs(one.value - other.value) <= one.tolerance + other.tolerance +
      Math.max(1, Math.abs(one.value), Math.abs(other.value)) * 1e-12;
  if (results.length === 0) {
    // A bare restatement is never a reason to overwrite, but validation
    // still holds the declared value to what the sourceText says it is.
    if (reconcile || assertions.length === 0) return { value: null, conflicting: false, invalid: false, mixedUnits };
    return assertions.every((assertion) => assertions.every((other) => agree(assertion, other)))
      ? {
          value: assertions[0]!.value,
          conflicting: false,
          invalid: false,
          tolerance: Math.max(...assertions.map((assertion) => assertion.tolerance)),
        }
      : { value: null, conflicting: true, invalid: false };
  }
  const first = results[0]!;
  const consistent = results.every((result) => results.every((other) => agree(result, other))) &&
    assertions.every((assertion) => results.every((result) => agree(result, assertion)));
  return consistent
    ? {
        value: first.value,
        conflicting: false,
        invalid: false,
        tolerance: Math.max(...results.map((result) => result.tolerance)),
        mixedUnits,
      }
    : { value: null, conflicting: true, invalid: false, mixedUnits };
}

/** Indices of derived quantities, dependencies (dependsOn) first, stable otherwise. */
function derivedEvaluationOrder(derived: unknown[]): number[] {
  const indexById = new Map<string, number>();
  derived.forEach((value, index) => {
    if (isRecord(value) && typeof value.id === "string" && !indexById.has(value.id)) {
      indexById.set(value.id, index);
    }
  });
  const dependencies = derived.map((value, index) =>
    isRecord(value) && Array.isArray(value.dependsOn)
      ? value.dependsOn.flatMap((id) => {
          const dependency = typeof id === "string" ? indexById.get(id) : undefined;
          return dependency === undefined || dependency === index ? [] : [dependency];
        })
      : []);
  const order: number[] = [];
  const done = new Set<number>();
  while (order.length < derived.length) {
    const next = derived.findIndex((_, index) =>
      !done.has(index) && dependencies[index]!.every((dependency) => done.has(dependency)));
    // A dependency cycle falls back to the listed order.
    const chosen = next >= 0 ? next : derived.findIndex((_, index) => !done.has(index));
    done.add(chosen);
    order.push(chosen);
  }
  return order;
}

function usesUntrustedBinding(solved: SolvedTargetValue, bindingMeta: NumericBindingMetaMap): boolean {
  return [...solved.bindingKeys].some((key) => bindingMeta.get(key)?.trusted === false);
}

function clauseMentionsTarget(equalityParts: string[], targetKeys: string[]): boolean {
  const targets = new Set(targetKeys.map(normalizeNumericBindingKey).filter(Boolean));
  return equalityParts.some((part) =>
    [...part.matchAll(/[A-Za-zΑ-Ωα-ω_][A-Za-z0-9Α-Ωα-ω_]*/gu)].some((match) => {
      if (!targets.has(normalizeNumericBindingKey(match[0]))) return false;
      // "= 6 V" names the unit volt, not a voltage called V.
      const unitLabel = (unitScale(match[0])?.signature ?? "") !== "" &&
        /[0-9)]\s*$/.test(part.slice(0, match.index));
      return !unitLabel;
    }) ||
    targets.has(normalizeNumericBindingKey(part)));
}

/**
 * A quantity's own sourceText may compute it without naming it
 * ("|5-0|+|4-5|+|9-4| = 5+1+5 = 10" for D = 10). When the chain ends by
 * restating the declared value, the chain asserts that its arithmetic equals
 * that value, so it is checkable like a named assignment.
 */
function evaluateAnchoredAnonymousChain(
  equalityParts: string[],
  expectedUnit: unknown,
  knownUnits: string[],
  numericBindings: Map<string, number>,
  bindingMeta: NumericBindingMetaMap,
  declaredAnchor: { value: number; tolerance: number } | null,
):
  | { kind: "value"; value: number; stated: { value: number; tolerance: number } }
  | { kind: "inconsistent_units" | "no_reading" | "mixed_units" }
  | null {
  if (!declaredAnchor || equalityParts.length < 3) return null;
  const finalIndex = equalityParts.length - 1;
  const final = parseMeasuredPart(equalityParts[finalIndex] ?? "");
  if (!final) return null;
  const finalUnit = final.unit ?? expectedUnit;
  const finalValue = convertMeasuredValue(final.value, finalUnit, expectedUnit);
  const finalTolerance = convertMeasuredValue(final.tolerance, finalUnit, expectedUnit);
  if (finalValue === null || finalTolerance === null) return null;
  const stated = { value: finalValue, tolerance: Math.abs(finalTolerance) };
  if (!withinDisplayedPrecision(declaredAnchor.value, stated)) return null;
  for (let index = 1; index < finalIndex; index += 1) {
    const part = equalityParts[index] ?? "";
    if (parseMeasuredPart(part)) continue;
    const bindingKeys = new Set<string>();
    const expression = normalizeExplicitNumericExpression(
      part,
      knownUnits,
      numericBindings,
      undefined,
      bindingKeys,
    );
    if (!expression) continue;
    try {
      const value = evaluateMathExpression(expression, 0);
      if (!Number.isFinite(value)) continue;
      const coherentValue = usesScaledBinding(bindingKeys, bindingMeta)
        ? coherentMemberValue("", part, true, [], knownUnits, coherentNumericBindings(numericBindings, bindingMeta))
        : undefined;
      const reading = readSolvedValueInUnit(
        { value, valueIndex: index, isolated: true, bindingKeys, coherentValue },
        equalityParts,
        expectedUnit,
        bindingMeta,
        [stated],
      );
      return reading.kind === "value" ? { ...reading, stated } : reading;
    } catch {
      // Try the next member of the chain.
    }
  }
  return null;
}

/**
 * Clauses are separate statements. Implication arrows separate derivation
 * steps ("2(x-30)=x => x=60"); they are never an "=" sign.
 */
function splitArithmeticClauses(sourceText: string): string[] {
  return sourceText
    .split(/[;\n]+|==>|=>|⇒|⟹|⟶|→|->|\bimplies\b/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/**
 * Split one clause into the members of its equality chain. "≈" and its
 * relatives chain like "="; comparison operators (<=, >=, !=, ≤, ≥, ≠) are
 * not equalities and stay inside their member, which then cannot evaluate.
 */
function splitEqualityParts(clause: string): string[] {
  const protectedClause = clause
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/!=|=\/=/g, "≠")
    .replace(/={2,}/g, "=");
  const parts = protectedClause.split(/\s*(?:=|≈|≃|≅)\s*/);
  // "use nodal: V = ..." labels the chain; the assignment head is "V".
  if (parts.length > 1) parts[0] = (parts[0] ?? "").replace(/^[^=]*:\s*(?=\S)/, "");
  return parts;
}

/** "x = 30 cm" (target alone on one side, a plain measured value on the other). */
function parseTargetAssertion(
  equalityParts: string[],
  targetKeys: string[],
  expectedUnit: unknown,
): { value: number; tolerance: number } | null {
  if (equalityParts.length !== 2 || targetKeys.length === 0) return null;
  const targets = new Set(targetKeys.map(normalizeNumericBindingKey).filter(Boolean));
  const left = normalizeNumericBindingKey(
    (equalityParts[0] ?? "").replace(/^\s*(?:also|and|or|hence|therefore|thus|so)\s+/i, ""),
  );
  if (!targets.has(left)) return null;
  const measured = parseMeasuredPart(equalityParts[1] ?? "");
  if (!measured) return null;
  const unit = measured.unit ?? expectedUnit;
  const value = convertMeasuredValue(measured.value, unit, expectedUnit);
  const tolerance = convertMeasuredValue(measured.tolerance, unit, expectedUnit);
  if (value === null || tolerance === null) return null;
  return { value, tolerance: Math.abs(tolerance) };
}

type SolvedValueReading =
  | { kind: "value"; value: number }
  | { kind: "inconsistent_units" }
  | { kind: "no_reading" }
  /**
   * The chain mixes units (6400 km beside m/s^2, 32 g/mol in an SI formula,
   * cm beside m) and only the literal reading of its numbers, not the
   * dimensionally converted one, agrees with what the chain states or the
   * plan declares. The expression may convert units itself, or the chain
   * may have slipped a power of ten; the text cannot tell, so it is no
   * evidence either way and the reconcile declines.
   */
  | { kind: "mixed_units" };

/**
 * Read a computed number in the declared unit, then hold it to dimensional
 * analysis when the chain substituted a prefixed or non-coherent input whose
 * unit does not simply pin the result (one unit shared by every input of
 * the target's dimension). Converting every input to coherent SI and
 * evaluating again gives the dimensionally sound result. When the two
 * readings differ, the coherent one wins only when the chain's stated
 * result or the plan's declared value supports it; a reading only the
 * literal numbers support is mixed units, and no reading is a slip.
 */
function readSolvedValueInUnit(
  solved: SolvedTargetValue,
  equalityParts: string[],
  expectedUnit: unknown,
  bindingMeta: NumericBindingMetaMap,
  /** The chain's stated result first, then the plan's declared value. */
  anchors: Array<{ value: number; tolerance: number }>,
): SolvedValueReading {
  const reading = readSolvedValueInDeclaredUnit(solved, equalityParts, expectedUnit, bindingMeta, anchors);
  if (solved.coherentValue === undefined || reading.kind !== "value") return reading;
  const expectedScale = unitScale(expectedUnit);
  if (expectedScale && expectedScale.signature !== "") {
    let sameDimensionFactor: number | null = null;
    let pinnedByOneUnit = true;
    for (const key of solved.bindingKeys) {
      const scale = unitScale(bindingMeta.get(key)?.unit);
      const scaled = scaledBindingUnit(key, bindingMeta) !== null;
      if (!scale || scale.signature !== expectedScale.signature) {
        if (scaled) pinnedByOneUnit = false;
        continue;
      }
      if (sameDimensionFactor === null) sameDimensionFactor = scale.factor;
      else if (!approximatelyEqual(sameDimensionFactor, scale.factor)) pinnedByOneUnit = false;
    }
    // f and d_o both in cm for an image distance: the input unit pins the
    // result, and the declared-unit reader already honours a conversion
    // written in the expression ("v0*1000/3600").
    if (pinnedByOneUnit && sameDimensionFactor !== null) return reading;
  }
  if (!expectedScale || solved.coherentValue === null) return { kind: "mixed_units" };
  const dimensional = solved.coherentValue / expectedScale.factor;
  if (approximatelyEqual(dimensional, reading.value)) return reading;
  const supports = (value: number) => anchors.some((anchor) => withinDisplayedPrecision(value, anchor));
  // The coherent reading replaces a declared value only when the chain's own
  // stated result agrees with it: the chain then writes the conversion out.
  if (supports(dimensional)) return { kind: "value", value: dimensional };
  if (supports(reading.value) || supports(solved.value)) {
    // A conversion cannot be written without a number ("v0*1000/3600",
    // "(R_e*1e3)^2"). A member of bare symbols ("g R_e^2", "a + b") that
    // only agrees once its mixed inputs are read literally is a unit slip:
    // report it. With a literal in the member the text cannot tell.
    const member = (equalityParts[solved.valueIndex] ?? "").replace(/\^\s*\(?\s*[-−]?\d+(?:\.\d+)?\s*\)?/g, "");
    return !solved.isolated || /(?<![\w.])\d/.test(member) ? { kind: "mixed_units" } : { kind: "no_reading" };
  }
  return { kind: "no_reading" };
}

/**
 * A computed number has no unit of its own. Read it in the quantity's
 * declared unit only when the text pins the unit:
 * 1. the chain writes the result with a unit right after the expression
 *    ("... ≈ 6.283×10⁻⁴ T = 628.3 µT" says the expression is in T);
 * 2. every same-dimension input it uses carries one unit (f, d_o in cm),
 *    unless the expression converts units itself (then the stated or
 *    declared value decides, and neither supporting a reading declines);
 * 3. the declared unit is coherent (no prefix), so there is one reading.
 * Otherwise (a prefixed unit with no evidence) both the declared and the
 * coherent SI reading are possible; keep the one the stated value supports.
 */
function readSolvedValueInDeclaredUnit(
  solved: SolvedTargetValue,
  equalityParts: string[],
  expectedUnit: unknown,
  bindingMeta: NumericBindingMetaMap,
  /** The chain's stated result first, then the plan's declared value. */
  anchors: Array<{ value: number; tolerance: number }>,
): SolvedValueReading {
  const convertFrom = (unit: unknown): SolvedValueReading => {
    const value = convertMeasuredValue(solved.value, unit, expectedUnit);
    return value === null ? { kind: "inconsistent_units" } : { kind: "value", value };
  };
  if (solved.isolated) {
    for (let index = solved.valueIndex + 1; index < equalityParts.length; index += 1) {
      const measured = parseMeasuredPart(equalityParts[index] ?? "");
      if (!measured) continue;
      if (!measured.unit) break;
      // The written result carries a unit label. If the computed number only
      // matches that result once read in the label's coherent unit (SI
      // inputs, then "= 628.3 µT"), the label is a converted display.
      const labelScale = unitScale(measured.unit);
      if (labelScale && !approximatelyEqual(labelScale.factor, 1)) {
        const asLabel = withinDisplayedPrecision(solved.value, measured);
        const asCoherent = withinDisplayedPrecision(solved.value / labelScale.factor, measured);
        if (asCoherent && !asLabel) {
          const value = convertMeasuredValue(solved.value / labelScale.factor, measured.unit, expectedUnit);
          return value === null ? { kind: "inconsistent_units" } : { kind: "value", value };
        }
      }
      return convertFrom(measured.unit);
    }
  }
  const expectedScale = unitScale(expectedUnit);
  const sameDimensionUnits = [...solved.bindingKeys].flatMap((key) => {
    const unit = bindingMeta.get(key)?.unit;
    const scale = unitScale(unit);
    // Dimensionless inputs (ratios, counts) say nothing about the result unit.
    return scale && expectedScale && scale.signature !== "" &&
      scale.signature === expectedScale.signature
      ? [{ unit, factor: scale.factor }]
      : [];
  });
  if (sameDimensionUnits.length > 0) {
    const factor = sameDimensionUnits[0]!.factor;
    if (sameDimensionUnits.every((entry) => approximatelyEqual(entry.factor, factor))) {
      const pinned = convertFrom(sameDimensionUnits[0]!.unit);
      // The expression may convert units itself ("v0*1000/3600" from km/h,
      // "L/100" from cm). Then the computed number is already in the
      // declared unit. The input unit pins the reading only when the two
      // readings coincide, or when the pinned one is what the chain states
      // or the plan declares; a value the chain's own result supports is
      // never overwritten through a unit guess.
      if (pinned.kind !== "value" || approximatelyEqual(pinned.value, solved.value)) return pinned;
      const supports = (reading: number) =>
        anchors.some((anchor) => withinDisplayedPrecision(reading, anchor));
      if (supports(pinned.value)) return pinned;
      if (supports(solved.value)) return { kind: "value", value: solved.value };
      return { kind: "no_reading" };
    }
  }
  if (!expectedScale || approximatelyEqual(expectedScale.factor, 1)) {
    return { kind: "value", value: solved.value };
  }
  if (
    expectedScale.signature === "" &&
    approximatelyEqual(expectedScale.factor, 0.01) &&
    writesPercentScaling(equalityParts[solved.valueIndex] ?? "")
  ) {
    // Multiplying a ratio by 100 is what turns it into a percentage, so the
    // member that writes "×100" is already in percent.
    return { kind: "value", value: solved.value };
  }
  const readings = [solved.value, solved.value / expectedScale.factor];
  const anchor = anchors[0];
  if (!anchor) return { kind: "inconsistent_units" };
  const supported = readings.filter((reading) => withinDisplayedPrecision(reading, anchor));
  return supported.length === 1 ? { kind: "value", value: supported[0]! } : { kind: "no_reading" };
}

function writesPercentScaling(member: string): boolean {
  return /[*×·⋅]\s*100(?![\d.])|(?<![\d.])100\s*[*×·⋅]/.test(member);
}

function expandDescriptiveAssignmentTargets(
  equalityParts: string[],
  targetKeys: string[],
): string[] {
  if (targetKeys.length === 0) return targetKeys;
  const left = equalityParts[0]?.trim() ?? "";
  if (!/^[A-Za-z][A-Za-z ]{1,40}$/.test(left)) return targetKeys;
  const normalizedLeft = normalizeNumericBindingKey(left).toLowerCase();
  const normalizedTargets = targetKeys
    .map((key) => normalizeNumericBindingKey(key).toLowerCase())
    .filter(Boolean);
  const describesTarget = normalizedTargets.some((target) =>
    target === normalizedLeft || (target.length === 1 && normalizedLeft.startsWith(target)));
  return describesTarget ? [...targetKeys, left] : targetKeys;
}

function evaluateInverseTrigDegreeTarget(
  equalityParts: string[],
  targetKeys: string[],
  expectedUnit: unknown,
  knownUnits: string[],
  numericBindings: Map<string, number>,
): number | null {
  if (normalizeUnit(expectedUnit) !== "degree" || equalityParts.length < 2) return null;
  const targets = new Set(targetKeys.map(normalizeNumericBindingKey).filter(Boolean));
  const hasDirectTarget = equalityParts.some((part) =>
    targets.has(normalizeNumericBindingKey(part)));
  if (!hasDirectTarget) return null;
  for (const rawPart of equalityParts) {
    const part = normalizeInverseTrigNotation(rawPart.replace(/[−–]/g, "-"));
    if (!/\b(?:asin|acos|atan|arcsin|arccos|arctan)\s*\(/i.test(part)) continue;
    // The member is converted from radians as a whole, which is right for
    // "asin(x)", "2 atan(x)" or "90° - atan(x)" but not for a bare number
    // added in degrees ("90 - atan(x)"). That reading would be a guess.
    if (addsBareNumberToInverseTrig(part)) continue;
    const expression = normalizeExplicitNumericExpression(part, knownUnits, numericBindings);
    if (!expression) continue;
    try {
      const radians = evaluateMathExpression(expression, 0);
      if (Number.isFinite(radians)) return radians * 180 / Math.PI;
    } catch {
      // Try another explicit inverse-trigonometric expression in the chain.
    }
  }
  return null;
}

function addsBareNumberToInverseTrig(part: string): boolean {
  let outside = part;
  for (;;) {
    const match = /\b(?:asin|acos|atan|arcsin|arccos|arctan)\s*\(/i.exec(outside);
    if (!match) break;
    let depth = 0;
    let end = outside.length;
    for (let index = match.index + match[0].length - 1; index < outside.length; index += 1) {
      if (outside[index] === "(") depth += 1;
      else if (outside[index] === ")") depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
    outside = `${outside.slice(0, match.index)} Q ${outside.slice(end)}`;
  }
  const additive = /[+-]/.test(outside.trim().replace(/^[+-]/, ""));
  const bareNumber = /(?<![\d.])\d+(?:\.\d+)?(?![\d.]|\s*(?:°|degrees?\b|deg\b))/i.test(outside);
  return additive && bareNumber;
}

interface SolvedTargetValue {
  value: number;
  /** Index of the equality member the value was computed from. */
  valueIndex: number;
  /** The target stands alone ("x = expr") rather than inside an equation. */
  isolated: boolean;
  /** Numeric bindings substituted while computing the value. */
  bindingKeys: Set<string>;
  /**
   * The same member evaluated with every prefixed or non-coherent binding
   * (km, cm, g, min, %) first converted to its coherent SI unit. Absent when
   * no such binding was substituted; null when the coherent evaluation fails.
   */
  coherentValue?: number | null;
  /** Other members of the chain that also evaluate, in preference order. */
  alternatives?: SolvedTargetValue[];
  /**
   * A written member equal in size and opposite in sign to a value computed
   * from a binding with no declared sign.
   */
  writtenSign?: SolvedTargetValue;
}

function solveExplicitTargetEquation(
  equalityParts: string[],
  targetKeys: string[],
  knownUnits: string[],
  numericBindings: Map<string, number>,
  statedIndex: number,
  bindingMeta: NumericBindingMetaMap = new Map(),
): SolvedTargetValue | null {
  if (targetKeys.length === 0 || equalityParts.length < 2) return null;
  for (let targetIndex = 0; targetIndex < equalityParts.length; targetIndex += 1) {
    const targetBindingKeys = new Set<string>();
    const targetExpression = normalizeTargetNumericExpression(
      equalityParts[targetIndex] ?? "",
      targetKeys,
      knownUnits,
      numericBindings,
      targetBindingKeys,
    );
    if (!targetExpression) continue;
    const isolated = targetExpression === "x";
    // A stated result belongs to an isolated target ("x = ... = 30"). In an
    // equation such as "3y - 6 = 9" the plain number is the other side.
    const valueIndices = equalityParts
      .map((_, index) => index)
      .filter((index) => index !== targetIndex && (!isolated || index !== statedIndex))
      // A plain number next to an isolated target restates a value; it is
      // not arithmetic that can confirm or replace one.
      .filter((index) => !isolated || !parseMeasuredPart(equalityParts[index] ?? ""))
      .sort((first, second) => {
        const firstUsesBindings = referencesTrustedNumericBinding(
          equalityParts[first] ?? "",
          numericBindings,
        );
        const secondUsesBindings = referencesTrustedNumericBinding(
          equalityParts[second] ?? "",
          numericBindings,
        );
        const firstHasArithmetic = explicitArithmeticOperation(equalityParts[first] ?? "");
        const secondHasArithmetic = explicitArithmeticOperation(equalityParts[second] ?? "");
        return Number(secondUsesBindings) - Number(firstUsesBindings) ||
          Number(secondHasArithmetic) - Number(firstHasArithmetic) || second - first;
      });
    const candidates: SolvedTargetValue[] = [];
    for (const valueIndex of valueIndices) {
      const bindingKeys = new Set(targetBindingKeys);
      const valueExpression = normalizeExplicitNumericExpression(
        equalityParts[valueIndex] ?? "",
        knownUnits,
        numericBindings,
        undefined,
        bindingKeys,
      );
      if (!valueExpression) continue;
      try {
        const value = evaluateMathExpression(valueExpression, 0);
        if (!Number.isFinite(value)) continue;
        const solved = isolated ? value : solveUniqueEquationValue(targetExpression, value);
        if (solved === null) continue;
        const candidate: SolvedTargetValue = { value: solved, valueIndex, isolated, bindingKeys };
        if (usesScaledBinding(bindingKeys, bindingMeta)) {
          candidate.coherentValue = coherentMemberValue(
            equalityParts[targetIndex] ?? "",
            equalityParts[valueIndex] ?? "",
            isolated,
            targetKeys,
            knownUnits,
            coherentNumericBindings(numericBindings, bindingMeta),
          );
        }
        candidates.push(candidate);
      } catch {
        // Try a later equality part with more explicit numeric evidence.
      }
    }
    const preferred = candidates[0];
    if (!preferred) continue;
    // Substituting a binding with no declared sign (f2 = 0.30 for a concave
    // lens) may drop a sign the chain writes explicitly ("1/(-0.30)"). Keep
    // the written member that agrees in size and differs only in sign; the
    // caller lets it win only when the stated result or the declared value
    // agrees with it.
    const usesMagnitude = [...preferred.bindingKeys].some((key) => bindingMeta.get(key)?.magnitudeOnly);
    const writtenSign = usesMagnitude
      ? candidates.find((candidate) =>
          candidate.bindingKeys.size === 0 &&
          Math.sign(candidate.value) === -Math.sign(preferred.value) &&
          Math.abs(Math.abs(candidate.value) - Math.abs(preferred.value)) <=
            1e-6 * Math.max(1, Math.abs(preferred.value)))
      : undefined;
    return { ...preferred, alternatives: candidates.slice(1), writtenSign };
  }
  return null;
}

/** A binding whose unit converts to its coherent SI unit by a factor other than 1. */
function scaledBindingUnit(key: string, bindingMeta: NumericBindingMetaMap): UnitScale | null {
  const meta = bindingMeta.get(key);
  if (!meta) return null;
  const scale = unitScale(meta.unit);
  return scale && !approximatelyEqual(scale.factor, 1) ? scale : null;
}

function usesScaledBinding(bindingKeys: Set<string>, bindingMeta: NumericBindingMetaMap): boolean {
  return [...bindingKeys].some((key) => scaledBindingUnit(key, bindingMeta) !== null);
}

/** Every binding in its coherent SI unit (6400 km as 6.4e6, 32 g/mol as 0.032). */
function coherentNumericBindings(
  numericBindings: Map<string, number>,
  bindingMeta: NumericBindingMetaMap,
): Map<string, number> {
  const coherent = new Map<string, number>();
  for (const [key, value] of numericBindings) {
    const scale = scaledBindingUnit(key, bindingMeta);
    coherent.set(key, scale ? value * scale.factor : value);
    markDegreeBinding(coherent, key, degreeBindingKeys(numericBindings).has(key));
  }
  const stipulations = TRIG_STIPULATIONS.get(numericBindings);
  if (stipulations) TRIG_STIPULATIONS.set(coherent, stipulations);
  return coherent;
}

/**
 * Evaluate one equality member (and, for an equation, solve the target side)
 * with coherent bindings. A dimensionally sound formula then yields the
 * result in the coherent unit of the target, whatever units the inputs had.
 */
function coherentMemberValue(
  targetMember: string,
  valueMember: string,
  isolated: boolean,
  targetKeys: string[],
  knownUnits: string[],
  coherentBindings: Map<string, number>,
): number | null {
  try {
    const valueExpression = normalizeExplicitNumericExpression(valueMember, knownUnits, coherentBindings);
    if (!valueExpression) return null;
    const value = evaluateMathExpression(valueExpression, 0);
    if (!Number.isFinite(value)) return null;
    if (isolated) return value;
    const targetExpression = normalizeTargetNumericExpression(
      targetMember,
      targetKeys,
      knownUnits,
      coherentBindings,
    );
    return targetExpression ? solveUniqueEquationValue(targetExpression, value) : null;
  } catch {
    return null;
  }
}

function explicitArithmeticOperation(source: string): boolean {
  const normalized = source.trim().replace(/^[-+]/, "");
  return /[*/^()]|\d\s*[+-]\s*\d/.test(normalized);
}

function referencesTrustedNumericBinding(
  source: string,
  numericBindings: ReadonlyMap<string, number>,
): boolean {
  // Degree-valued variables need an explicit angle-unit conversion before
  // they can safely become arguments to trigonometric functions.
  if (/\b(?:sin|cos|tan)\s*\(/i.test(source)) return false;
  const identifiers = source.match(/[A-Za-zΑ-Ωα-ω_][A-Za-z0-9Α-Ωα-ω_]*/gu) ?? [];
  return identifiers.some((identifier) =>
    numericBindings.has(normalizeNumericBindingKey(identifier)),
  );
}

function normalizeTargetNumericExpression(
  source: string,
  targetKeys: string[],
  knownUnits: string[],
  numericBindings: Map<string, number>,
  usedBindingKeys?: Set<string>,
): string | null {
  const targets = new Set(targetKeys.map(normalizeNumericBindingKey).filter(Boolean));
  const placeholder = "TargetVariableQ";
  const assignmentSource = source.replace(
    /^\s*(?:also|and|or|hence|therefore|thus|so)\s+/i,
    "",
  );
  const protectedSource = assignmentSource.replace(
    /[A-Za-zΑ-Ωα-ω_][A-Za-z0-9Α-Ωα-ω_]*/gu,
    (token: string, offset: number, whole: string) => {
      if (!targets.has(normalizeNumericBindingKey(token))) return token;
      // Implicit products written without a space ("3y", "2(x-30)",
      // "I(R+r)"). "6 V" or "6V" for a quantity named V is a unit label,
      // not a product, so a target spelled like a unit never multiplies.
      const spelledLikeUnit = (unitScale(token)?.signature ?? "") !== "";
      const before = spelledLikeUnit ? "" : /[0-9)]/.test(whole[offset - 1] ?? "") ? "*" : "";
      const after = whole[offset + token.length] === "(" ? "*" : "";
      return `${before}${placeholder}${after}`;
    },
  );
  if (containsFunctionWrappedTarget(protectedSource, placeholder)) return null;
  let expression = normalizeExplicitNumericExpression(
    protectedSource,
    knownUnits,
    numericBindings,
    placeholder,
    usedBindingKeys,
  );
  if (!expression) return null;
  expression = expression.replaceAll(placeholder, "x");
  if (!/(^|[^A-Za-z0-9_])x([^A-Za-z0-9_]|$)/.test(expression)) return null;
  const safetyExpression = expression.replace(/x/g, "");
  return /^[0-9eE+\-*/^().]*$/.test(safetyExpression) ? expression : null;
}

function targetWrappedByNonlinearFunction(source: string, targetKeys: string[]): boolean {
  const targets = new Set(targetKeys.map(normalizeNumericBindingKey).filter(Boolean));
  if (targets.size === 0) return false;
  const placeholder = "TargetVariableQ";
  const protectedSource = source.replace(
    /[A-Za-zΑ-Ωα-ω_][A-Za-z0-9Α-Ωα-ω_]*/gu,
    (token) => targets.has(normalizeNumericBindingKey(token)) ? placeholder : token,
  );
  return containsFunctionWrappedTarget(protectedSource, placeholder);
}

function containsFunctionWrappedTarget(source: string, placeholder: string): boolean {
  return new RegExp(
    `\\b(?:sqrt|sin|cos|tan|asin|acos|atan|abs|exp|log|ln)\\s*\\(?\\s*${placeholder}\\b`,
    "i",
  ).test(source);
}

function solveUniqueEquationValue(expression: string, rightValue: number): number | null {
  const residual = (value: number): number => evaluateMathExpression(expression, value) - rightValue;
  const scale = Math.max(1, Math.abs(rightValue));
  const residualTolerance = scale * 1e-9;
  const samples = new Set<number>([0, -1, 1, rightValue, -rightValue]);
  if (rightValue !== 0) {
    samples.add(1 / rightValue);
    samples.add(-1 / rightValue);
  }
  for (let exponent = -12; exponent <= 12; exponent += 1) {
    const magnitude = 10 ** exponent;
    samples.add(magnitude);
    samples.add(-magnitude);
  }
  const ordered = [...samples].filter(Number.isFinite).sort((first, second) => first - second);
  const roots: number[] = [];
  let previous: { x: number; y: number } | null = null;
  for (const x of ordered) {
    let y: number;
    try {
      y = residual(x);
    } catch {
      previous = null;
      continue;
    }
    if (!Number.isFinite(y)) {
      previous = null;
      continue;
    }
    if (Math.abs(y) <= residualTolerance) addEquationRoot(roots, x);
    if (previous && Math.sign(previous.y) !== Math.sign(y)) {
      const root = bisectEquationRoot(residual, previous.x, x, previous.y, y, residualTolerance);
      if (root !== null) addEquationRoot(roots, root);
    }
    previous = { x, y };
  }
  return roots.length === 1 ? roots[0]! : null;
}

function bisectEquationRoot(
  residual: (value: number) => number,
  leftStart: number,
  rightStart: number,
  leftResidual: number,
  rightResidual: number,
  tolerance: number,
): number | null {
  let left = leftStart;
  let right = rightStart;
  let leftValue = leftResidual;
  let rightValue = rightResidual;
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const middle = left + (right - left) / 2;
    const middleValue = residual(middle);
    if (!Number.isFinite(middleValue)) return null;
    if (Math.sign(leftValue) !== Math.sign(middleValue)) {
      right = middle;
      rightValue = middleValue;
    } else {
      left = middle;
      leftValue = middleValue;
    }
    if (Math.abs(right - left) <= Math.max(1, Math.abs(middle)) * 1e-12) {
      const candidate = Math.abs(leftValue) <= Math.abs(rightValue) ? left : right;
      return Math.abs(residual(candidate)) <= tolerance * 10 ? candidate : null;
    }
  }
  return null;
}

function addEquationRoot(roots: number[], value: number): void {
  if (!roots.some((root) => approximatelyEqual(root, value))) roots.push(value);
}

function parseLeadingMeasuredValue(
  text: string,
  expectedUnit: unknown,
): { value: number; tolerance: number } | null {
  const match = text.match(
    /^\s*[~≈]?\s*\(?\s*([+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)\s*([A-Za-zΩ°μµ][A-Za-z0-9Ω°μµ/*^²³·⋅-]*)?/,
  );
  if (!match) return null;
  // "10(2) + b" or "6.283×10⁻⁴ T" only start with a number; the member is
  // arithmetic, not a stated result. A trailing word or comment is fine.
  const rest = text.slice(match[0].length);
  if (rest.trim() !== "" && /[0-9=+*/^×·⋅−-]/.test(rest)) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const plannedUnit = normalizeUnit(expectedUnit);
  const statedUnit = normalizeUnit(match[2]);
  if (plannedUnit !== statedUnit) return null;
  return {
    value,
    tolerance: displayedNumberTolerance(match[1]!),
  };
}

/**
 * Trig values the question or plan fixes for an angle ("Take sin 37 = 0.6
 * and cos 37 = 0.8"), keyed "cos:37". The problem's own convention is the
 * authority for that angle, so "F cos θ = 30 × 0.8 = 24" is never refined
 * to the exact 23.96.
 */
const TRIG_STIPULATIONS = new WeakMap<Map<string, number>, Map<string, number>>();

function collectTrigStipulations(plan: Record<string, unknown>): Map<string, number> {
  const stipulations = new Map<string, number>();
  // [text, whether a stated equality needs prescriptive wording to count]
  const texts: Array<[string, boolean]> = [];
  if (typeof plan.question === "string") texts.push([plan.question, true]);
  for (const given of Array.isArray(plan.givens) ? plan.givens : []) {
    if (!isRecord(given)) continue;
    if (typeof given.sourceText === "string") texts.push([given.sourceText, false]);
    if (typeof given.value !== "number" || !Number.isFinite(given.value)) continue;
    for (const name of [given.symbol, given.id]) {
      if (typeof name !== "string") continue;
      const match = name.replace(/\\/g, "").match(
        /^\s*(sin|cos|tan)\s*[_({]?\s*(\d+(?:\.\d+)?)\s*(?:°|\^\s*\\?circ|deg(?:rees?)?)?\s*[)}]?\s*$/i,
      );
      if (match) stipulations.set(`${match[1]!.toLowerCase()}:${Number(match[2])}`, given.value);
    }
  }
  for (const [text, needsPrescription] of texts) {
    for (const match of text.matchAll(
      /(?<![A-Za-z])(sin|cos|tan)\s*\(?\s*(\d+(?:\.\d+)?)\s*(?:°|deg(?:rees?)?)?\s*\)?\s*(?:=|≈)\s*([+\-−]?\s*\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/gi,
    )) {
      if (needsPrescription && !prescribedInItsSentence(text, match.index ?? 0)) continue;
      const numerator = Number(match[3]!.replace(/\s+/g, "").replace("−", "-"));
      const value = numerator / (match[4] === undefined ? 1 : Number(match[4]));
      if (Number.isFinite(value)) stipulations.set(`${match[1]!.toLowerCase()}:${Number(match[2])}`, value);
    }
  }
  return stipulations;
}

/**
 * A trig equality in the question fixes a value only when the problem
 * prescribes it ("Take sin 37 = 0.6", "use cos 143° = -0.8"). One the student
 * is asked about ("Is sin 30° = 0.6?") is not an assumption.
 */
function prescribedInItsSentence(text: string, index: number): boolean {
  // A full stop ends a sentence only before whitespace or the end, so the
  // decimal point in "0.6" does not split one.
  const boundary = /[?!;]|\.(?=\s|$)/g;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(boundary)) {
    const at = match.index ?? 0;
    if (at < index) start = at + 1;
    else { end = at; break; }
  }
  if (text[end] === "?") return false;
  return /\b(?:take|taking|use|using|assume|assuming|given|let|put|where|with|consider)\b/i.test(text.slice(start, index));
}

function attachTrigStipulations(bindings: Map<string, number>, plan: Record<string, unknown>): void {
  const stipulations = collectTrigStipulations(plan);
  if (stipulations.size > 0) TRIG_STIPULATIONS.set(bindings, stipulations);
}

function trigStipulations(bindings: Map<string, number>): ReadonlyMap<string, number> {
  return TRIG_STIPULATIONS.get(bindings) ?? new Map();
}

/** The stipulated value of name(argument) when the argument is that angle in degrees. */
function stipulatedTrigValue(
  stipulations: ReadonlyMap<string, number>,
  name: string,
  radiansArgument: string,
): number | null {
  if (stipulations.size === 0) return null;
  let degrees: number;
  try {
    degrees = evaluateMathExpression(radiansArgument.replace(/\s+/g, ""), 0) * 180 / Math.PI;
  } catch {
    return null;
  }
  if (!Number.isFinite(degrees)) return null;
  for (const [key, value] of stipulations) {
    const [stipulatedName, angle] = key.split(":");
    if (stipulatedName === name && Math.abs(Number(angle) - degrees) <= 1e-9 * Math.max(1, degrees)) return value;
  }
  return null;
}

// "cosθ" written glued is one token, as it always was; "cos θ" is cos(θ).
const TRIG_FUNCTION = /(?<![A-Za-z0-9_])(sin|cos|tan)(?![A-Za-z0-9Α-Ωα-ω_])\s*/giu;

/** sin⁻¹ x, sin^-1 x and sin^(-1) x are asin x. */
function normalizeInverseTrigNotation(source: string): string {
  return source.replace(
    /(?<![A-Za-z0-9_])(sin|cos|tan)\s*(?:⁻¹|\^\s*\(\s*-\s*1\s*\)|\^\s*-\s*1(?![0-9.]))/gi,
    (_, name: string) => `a${name.toLowerCase()}`,
  );
}

/**
 * Rewrite the argument of every sin, cos and tan: a parenthesised argument,
 * or a single number or name written without parentheses ("cos θ",
 * "sin 0.5 rad"). An unparenthesised argument that runs on into a product
 * ("sin 2θ") is ambiguous and left as written.
 */
function mapTrigArguments(
  expression: string,
  rewrite: (name: "sin" | "cos" | "tan", argument: string, original: string) => string,
): string {
  let output = "";
  let cursor = 0;
  for (const match of expression.matchAll(TRIG_FUNCTION)) {
    const start = match.index ?? 0;
    if (start < cursor) continue;
    const argumentStart = start + match[0].length;
    const rest = expression.slice(argumentStart);
    let argument: string | null = null;
    let consumed = 0;
    if (rest.startsWith("(")) {
      let depth = 0;
      for (let index = 0; index < rest.length; index += 1) {
        if (rest[index] === "(") depth += 1;
        else if (rest[index] === ")") depth -= 1;
        if (depth === 0) {
          argument = rest.slice(1, index);
          consumed = index + 1;
          break;
        }
      }
    } else {
      const atom = rest.match(
        /^(?:[A-Za-zΑ-Ωα-ω_][A-Za-z0-9Α-Ωα-ω_]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*(?:°|(?:degrees?|deg|radians?|rad)\b))?)/u,
      );
      if (atom && !/^\s*[A-Za-z0-9Α-Ωα-ω_.(]/u.test(rest.slice(atom[0].length))) {
        argument = atom[0];
        consumed = atom[0].length;
      }
    }
    if (argument === null) continue;
    const name = match[1]!.toLowerCase() as "sin" | "cos" | "tan";
    const inner = mapTrigArguments(argument, rewrite);
    const original = inner === argument
      ? expression.slice(start, argumentStart + consumed)
      : `${name}(${inner})`;
    output += `${expression.slice(cursor, start)}${rewrite(name, inner, original)}`;
    cursor = argumentStart + consumed;
  }
  return output + expression.slice(cursor);
}

/**
 * A trig argument that is a bare number above 2π ("sin(60)") in a chain that
 * works in degrees is almost certainly degrees written without the mark.
 * Reading it in radians would be a guess, so that member is made unreadable
 * and is no evidence; the chain's other members still are.
 */
function guardBareDegreeLikeTrigArguments(sourceText: string): string {
  return mapTrigArguments(sourceText, (name, argument, original) => {
    if (/[A-Za-zΑ-Ωα-ωπ°]/u.test(argument) || !/\d/.test(argument)) return original;
    try {
      const value = evaluateMathExpression(
        argument.replace(/[−–]/g, "-").replace(/[×·⋅]/g, "*").replace(/\s+/g, ""),
        0,
      );
      if (Number.isFinite(value) && Math.abs(value) > 2 * Math.PI) return `${name}(${argument} ?)`;
    } catch {
      // Not a plain number; nothing to judge.
    }
    return original;
  });
}

function chainWorksInDegrees(
  sourceText: string,
  expectedUnit: unknown,
  numericBindings: Map<string, number>,
): boolean {
  return normalizeUnit(expectedUnit) === "degree" ||
    /°|\bdeg(?:rees?)?\b/i.test(sourceText) ||
    degreeBindingKeys(numericBindings).size > 0;
}

function normalizeExplicitNumericExpression(
  source: string,
  knownUnits: string[],
  numericBindings: Map<string, number> = new Map(),
  allowedIdentifier?: string,
  usedBindingKeys?: Set<string>,
): string | null {
  let expression = normalizeInverseTrigNotation(source.replace(/[−–]/g, "-"))
    .replace(/[×·⋅]/g, "*")
    .replace(/√\s*(?=\()/g, "sqrt")
    .replace(/√\s*(\d+(?:\.\d+)?|[A-Za-zΑ-Ωα-ω_][A-Za-z0-9Α-Ωα-ω_]*)/gu, "sqrt($1)")
    .replace(/\barcsin\b/gi, "asin")
    .replace(/\barccos\b/gi, "acos")
    .replace(/\barctan\b/gi, "atan")
    .replace(/π/g, "(pi)")
    .replace(/⁻([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, digits: string) =>
      `^(-${fromSuperscriptDigits(digits)})`)
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/[{}]/g, "");
  expression = expression.replace(
    /([+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)\s*(?:(?:degrees?|deg)\b|°)/gi,
    "(($1)*pi/180)",
  );
  const substitutedKeys = new Set<string>();
  // Trig arguments first: a degree-valued binding becomes radians there
  // ("u cos θ" with θ = 30 deg is u cos(π/6)), and only there.
  const degreeKeys = degreeBindingKeys(numericBindings);
  const stipulations = trigStipulations(numericBindings);
  expression = mapTrigArguments(expression, (name, argument) => {
    const radians = substituteNumericBindings(
      argument.replace(/(\d|\))\s*(?:radians?|rad)\b(?!\s*[/^*])/gi, "$1"),
      numericBindings,
      substitutedKeys,
      degreeKeys,
    );
    const stipulated = stipulatedTrigValue(stipulations, name, radians);
    return stipulated === null ? `${name}(${radians})` : `(${stipulated})`;
  });
  expression = substituteNumericBindings(expression, numericBindings, substitutedKeys);
  for (const unit of knownUnits) {
    const flags = /^[A-Za-z]+$/.test(unit) && unit.length > 1 ? "gi" : "g";
    // A unit label follows a number ("(0.18 N)(4 m/s)"). The same letters
    // after an operator are a variable ("μk N" is the normal force), and
    // deleting them silently changes the arithmetic.
    expression = expression.replace(
      new RegExp(`(?<=[0-9.)\\]]\\s*)${escapeRegExp(unit)}(?=\\s|\\)|\\]|$|[*/+\\-^])`, flags),
      "",
    );
  }
  expression = expression
    .replace(/\s+/g, "")
    .replace(/\)\(/g, ")*(")
    .replace(/(\d|\))\(/g, "$1*(")
    .replace(/\)(?=\d|\.)/g, ")*")
    .replace(/(\d|\))(?=pi\b|sqrt\b|sin\b|cos\b|tan\b|asin\b|acos\b|atan\b|abs\b|exp\b|log\b|ln\b)/g, "$1*");
  const safetyExpression = expression
    .replaceAll(allowedIdentifier ?? "\0", "")
    .replace(/\b(?:sqrt|sin|cos|tan|asin|acos|atan|abs|exp|log|ln|pi|e)\b/g, "");
  const identifierOnly = Boolean(allowedIdentifier && expression === allowedIdentifier);
  if (
    expression === "" ||
    (!/[0-9]/.test(expression) && !(allowedIdentifier && expression.includes(allowedIdentifier))) ||
    (!identifierOnly && !/^[0-9eE+\-*/^().]+$/.test(safetyExpression))
  ) {
    return null;
  }
  // A bare "e" in a physics chain is the elementary charge ("(E - φ)/e" in
  // volts) as often as Euler's number; only "e^..." is unambiguous.
  if (/(^|[^A-Za-z0-9_.])e(?![A-Za-z0-9_^])/.test(expression)) return null;
  substitutedKeys.forEach((key) => usedBindingKeys?.add(key));
  return expression;
}

function substituteNumericBindings(
  expression: string,
  numericBindings: Map<string, number>,
  usedKeys?: Set<string>,
  /** Keys to substitute in radians (the expression is a trig argument). */
  degreeKeys: ReadonlySet<string> = new Set(),
): string {
  const literal = (key: string, value: number) =>
    degreeKeys.has(key) ? `((${value})*pi/180)` : `(${value})`;
  const reserved = new Set([
    "sqrt", "sin", "cos", "tan", "asin", "acos", "atan",
    "abs", "exp", "log", "ln", "pi", "e",
  ]);
  const bindings = [...numericBindings.entries()]
    .filter(([key]) => key !== "")
    .sort(([first], [second]) => second.length - first.length);
  return expression.replace(
    /[A-Za-zΑ-Ωα-ω_][A-Za-z0-9Α-Ωα-ω_]*/gu,
    (token) => {
      if (reserved.has(token)) return token;
      const exact = numericBindings.get(token);
      if (exact !== undefined) {
        usedKeys?.add(token);
        return literal(token, exact);
      }

      const replacements: Array<[string, number]> = [];
      let cursor = 0;
      while (cursor < token.length) {
        const match = bindings.find(([key]) => token.startsWith(key, cursor));
        if (!match) return token;
        replacements.push(match);
        cursor += match[0].length;
      }
      replacements.forEach(([key]) => usedKeys?.add(key));
      return replacements.map(([key, value]) => literal(key, value)).join("*");
    },
  );
}

interface NumericBindingMeta {
  unit: unknown;
  /** No declared sign and a non-negative value: the binding is a size only. */
  magnitudeOnly: boolean;
  /**
   * A given, or a derived value its own sourceText arithmetic confirmed or
   * corrected. Other derived values are the model's unchecked numbers.
   */
  trusted: boolean;
}

type NumericBindingMetaMap = Map<string, NumericBindingMeta>;

function collectNumericBindings(
  values: unknown[],
  meta?: NumericBindingMetaMap,
): Map<string, number> {
  const bindings = new Map<string, number>();
  values.forEach((value) => addNumericBinding(bindings, value, meta));
  return bindings;
}

function addNumericBinding(
  bindings: Map<string, number>,
  value: unknown,
  meta?: NumericBindingMetaMap,
  trusted = true,
): void {
  if (!isRecord(value) || typeof value.value !== "number" || !Number.isFinite(value.value)) return;
  const entry: NumericBindingMeta = {
    unit: value.unit,
    magnitudeOnly: isMagnitudeOnlyQuantity(value),
    trusted,
  };
  const degrees = normalizeUnit(value.unit) === "degree";
  const bind = (key: string) => {
    const normalized = normalizeNumericBindingKey(key);
    bindings.set(normalized, value.value as number);
    meta?.set(normalized, entry);
    markDegreeBinding(bindings, normalized, degrees);
  };
  for (const key of [value.id, value.symbol]) {
    if (typeof key !== "string" || key.trim() === "") continue;
    bind(key);
  }
  if (typeof value.sourceText === "string") {
    const leftHandSide = value.sourceText.split(/[=≈≃≅]/, 1)[0]?.trim();
    if (leftHandSide && /^[A-Za-zΑ-Ωα-ω][A-Za-z0-9Α-Ωα-ω_{}\\]*$/u.test(leftHandSide)) {
      bind(leftHandSide);
    }
  }
}

/**
 * Keys of each binding map whose quantity is an angle in degrees (theta =
 * 30 deg). A trigonometric function reads its argument in radians, so such a
 * binding is converted where it is a trig argument ("u cos θ") and nowhere
 * else ("θ/2" stays in degrees). Kept beside the map so every caller that
 * evaluates with the map sees the same angle units.
 */
const DEGREE_BINDING_KEYS = new WeakMap<Map<string, number>, Set<string>>();

function markDegreeBinding(bindings: Map<string, number>, key: string, degrees: boolean): void {
  let keys = DEGREE_BINDING_KEYS.get(bindings);
  if (!degrees) {
    keys?.delete(key);
    return;
  }
  if (!keys) {
    keys = new Set();
    DEGREE_BINDING_KEYS.set(bindings, keys);
  }
  keys.add(key);
}

function degreeBindingKeys(bindings: Map<string, number>): ReadonlySet<string> {
  return DEGREE_BINDING_KEYS.get(bindings) ?? new Set();
}

function normalizeNumericBindingKey(value: string): string {
  return value
    .replace(/\\(?:mathrm|text|operatorname)\s*/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

function replaceTrailingMeasuredValues(
  sourceText: string,
  value: number,
  expectedUnit: unknown,
): string {
  const replacement = Number(value.toPrecision(12)).toString();
  return sourceText.split(/([;\n]+)/).map((clause, index) => {
    if (index % 2 === 1) return clause;
    const matches = [...clause.matchAll(
      /([+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)\s*([A-Za-zΩ°μµ][A-Za-z0-9Ω°μµ/*^²³·⋅-]*)?/g,
    )];
    const expected = normalizeUnit(expectedUnit);
    const last = expected === null
      ? matches.at(-1)
      : [...matches].reverse().find((match) => normalizeUnit(match[2]) === expected);
    if (!last || last.index === undefined) return clause;
    const numericOffset = last.index;
    return `${clause.slice(0, numericOffset)}${replacement}${clause.slice(numericOffset + last[1]!.length)}`;
  }).join("");
}

const NUMBER_SOURCE = String.raw`[+\-−]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+\-−]?\d+)?`;
const POWER_OF_TEN_SOURCE =
  String.raw`(?:\s*[×x*·⋅]\s*10\s*(?:\^\s*\(?\s*([+\-−]?\d+)\s*\)?|([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)))?`;

/**
 * An equality member that is only a measured value: "0.0329 m/s",
 * "6.283×10⁻⁴ T", "≈ -3.3333", "60 mA". Returns null for anything with
 * arithmetic or prose in it.
 */
function parseMeasuredPart(
  text: string,
): { value: number; tolerance: number; unit: string | null } | null {
  const match = text.match(new RegExp(
    String.raw`^\s*[~≈]?\s*\(?\s*(${NUMBER_SOURCE})${POWER_OF_TEN_SOURCE}\s*\)?\s*([A-Za-zΩΩ°μµ%][A-Za-z0-9ΩΩ°μµ/*^²³¹⁰⁻·⋅ ()\-]*)?\s*[.,]?\s*$`,
  ));
  if (!match) return null;
  const mantissa = match[1]!.replace(/−/g, "-");
  const exponentText = match[2] ?? (match[3] ? superscriptInteger(match[3]) : null);
  const exponent = exponentText === null ? 0 : Number(exponentText.replace(/−/g, "-"));
  const value = Number(mantissa) * 10 ** exponent;
  if (!Number.isFinite(value)) return null;
  const unit = match[4]?.trim() || null;
  if (unit && !isRecognisedUnitLabel(unit)) return null;
  return {
    value,
    tolerance: displayedNumberTolerance(mantissa) * 10 ** exponent,
    unit,
  };
}

/**
 * A trailing token is a unit only when it parses as one; a lone letter such
 * as the x in "2x" is a variable, not a unit.
 */
function isRecognisedUnitLabel(unit: string): boolean {
  if (unitScale(unit)) return true;
  const normalized = normalizeUnit(unit);
  if (normalized === "degree" || normalized === "radian") return true;
  return /^[A-Za-z]{2,}$/.test(unit) && !/^(?:is|so|as|at|to|or|and|the|which|for|of|in|on|by)$/i.test(unit);
}

function superscriptInteger(value: string): string {
  const sign = value.startsWith("⁻") ? "-" : "";
  return `${sign}${fromSuperscriptDigits(value.replace(/^[⁺⁻]/, ""))}`;
}

interface UnitScale {
  /** Multiplier to the coherent unit with the same signature. */
  factor: number;
  /** Base-symbol signature, e.g. "m^1·s^-1"; "" for dimensionless. */
  signature: string;
}

const SI_PREFIX_FACTORS: Record<string, number> = {
  p: 1e-12, n: 1e-9, "µ": 1e-6, "μ": 1e-6, u: 1e-6, m: 1e-3, c: 1e-2, k: 1e3, M: 1e6, G: 1e9,
};

const PREFIXABLE_UNITS: Record<string, { base: string; factor: number }> = {
  m: { base: "m", factor: 1 },
  g: { base: "kg", factor: 1e-3 },
  s: { base: "s", factor: 1 },
  A: { base: "A", factor: 1 },
  K: { base: "K", factor: 1 },
  mol: { base: "mol", factor: 1 },
  N: { base: "N", factor: 1 },
  J: { base: "J", factor: 1 },
  W: { base: "W", factor: 1 },
  Pa: { base: "Pa", factor: 1 },
  Hz: { base: "Hz", factor: 1 },
  C: { base: "C", factor: 1 },
  V: { base: "V", factor: 1 },
  "Ω": { base: "Ω", factor: 1 },
  F: { base: "F", factor: 1 },
  H: { base: "H", factor: 1 },
  T: { base: "T", factor: 1 },
  Wb: { base: "Wb", factor: 1 },
  eV: { base: "eV", factor: 1 },
  L: { base: "L", factor: 1 },
};

const UNPREFIXED_UNITS: Record<string, { base: string; factor: number }> = {
  min: { base: "s", factor: 60 },
  h: { base: "s", factor: 3600 },
  hr: { base: "s", factor: 3600 },
  D: { base: "D", factor: 1 },
  "%": { base: "", factor: 0.01 },
};

const UNIT_WORD_ALIASES: Record<string, string> = {
  ohm: "Ω", ohms: "Ω", "Ω": "Ω", kohm: "kΩ", kohms: "kΩ",
  volt: "V", volts: "V", amp: "A", amps: "A", ampere: "A", amperes: "A",
  watt: "W", watts: "W", newton: "N", newtons: "N", joule: "J", joules: "J",
  sec: "s", second: "s", seconds: "s", metre: "m", metres: "m", meter: "m", meters: "m",
  tesla: "T", hertz: "Hz", dioptre: "D", dioptres: "D", diopter: "D", diopters: "D",
};

/**
 * Scale of a unit relative to its coherent form, for the prefixed SI units a
 * plan writes (µT, mA, nm, cm/s, km/s, kg/m^3, m/s²). Null when any factor is
 * not recognised; angles stay on the degree/radian path.
 */
function unitScale(unit: unknown): UnitScale | null {
  if (unit === undefined || unit === null) return { factor: 1, signature: "" };
  if (typeof unit !== "string") return null;
  const text = unit.trim()
    .replace(/[−–]/g, "-")
    .replace(/⁻/g, "^-")
    .replace(/[¹²³⁰⁴⁵⁶⁷⁸⁹]+/g, (digits) => `^${fromSuperscriptDigits(digits.replace("¹", "1"))}`)
    .replace(/\^-\^/g, "^-")
    .replace(/[()]/g, " ");
  if (text === "" || /^(?:1|none|dimensionless|unitless|scalar)$/i.test(text)) {
    return { factor: 1, signature: "" };
  }
  let factor = 1;
  const exponents = new Map<string, number>();
  const segments = text.split("/");
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const direction = segmentIndex === 0 ? 1 : -1;
    const factors = segments[segmentIndex]!.split(/[\s·⋅*]+/).filter(Boolean);
    if (factors.length === 0) {
      if (segmentIndex === 0 && segments.length > 1) continue;
      return null;
    }
    for (const term of factors) {
      const match = term.match(/^([A-Za-zΩΩµμ%]+)(?:\^?\(?(-?\d+)\)?)?$/u);
      if (!match) return null;
      const resolved = resolveUnitSymbol(match[1]!);
      if (!resolved) return null;
      const power = Number(match[2] ?? 1) * direction;
      factor *= resolved.factor ** power;
      if (resolved.base !== "") {
        exponents.set(resolved.base, (exponents.get(resolved.base) ?? 0) + power);
      }
    }
  }
  const signature = [...exponents.entries()]
    .filter(([, power]) => power !== 0)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([base, power]) => `${base}^${power}`)
    .join("·");
  return { factor, signature };
}

function resolveUnitSymbol(symbol: string): { base: string; factor: number } | null {
  const aliased = UNIT_WORD_ALIASES[symbol] ?? UNIT_WORD_ALIASES[symbol.toLowerCase()] ??
    symbol.replace(/Ω/g, "Ω");
  const direct = PREFIXABLE_UNITS[aliased] ?? UNPREFIXED_UNITS[aliased];
  if (direct) return direct;
  const prefix = SI_PREFIX_FACTORS[aliased[0] ?? ""];
  const base = PREFIXABLE_UNITS[aliased.slice(1)];
  return prefix !== undefined && base ? { base: base.base, factor: prefix * base.factor } : null;
}

/** Convert between units only when they provably measure the same thing. */
function convertMeasuredValue(value: number, fromUnit: unknown, toUnit: unknown): number | null {
  const from = unitScale(fromUnit);
  const to = unitScale(toUnit);
  if (from && to) {
    return from.signature === to.signature ? value * from.factor / to.factor : null;
  }
  return normalizeUnit(fromUnit) === normalizeUnit(toUnit) ? value : null;
}

/**
 * After a reconcile, an equality member that restated the replaced value in
 * another unit ("≈ 0.0329 m/s" beside "= 3.29 cm/s") or as a bare number
 * would still teach the stale number. Rewrite each such member in its own
 * unit.
 */
function replaceRestatedMeasuredValues(
  sourceText: string,
  previousValue: number,
  value: number,
  expectedUnit: unknown,
): string {
  return sourceText.split(/(\s*(?:=>|⇒|=|≈|≃|≅|;|\n)\s*)/).map((part, index) => {
    if (index % 2 === 1 || index === 0) return part;
    const measured = parseMeasuredPart(part);
    if (!measured) return part;
    const unit = measured.unit ?? expectedUnit;
    const previousInUnit = convertMeasuredValue(previousValue, expectedUnit, unit);
    const valueInUnit = convertMeasuredValue(value, expectedUnit, unit);
    if (previousInUnit === null || valueInUnit === null) return part;
    if (Math.abs(previousInUnit - measured.value) > measured.tolerance +
      Math.max(1, Math.abs(previousInUnit)) * 1e-12) return part;
    const replacement = Number(valueInUnit.toPrecision(12)).toString();
    const leading = part.match(/^\s*[~≈]?\s*\(?\s*/)?.[0] ?? "";
    const rest = part.slice(leading.length).replace(
      new RegExp(`^${NUMBER_SOURCE}${POWER_OF_TEN_SOURCE}`),
      "",
    );
    return `${leading}${replacement}${rest}`;
  }).join("");
}

function fromSuperscriptDigits(value: string): string {
  const digits: Record<string, string> = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  };
  return [...value].map((digit) => digits[digit] ?? "").join("");
}

function collectPlanUnits(plan: Record<string, unknown>): string[] {
  const quantities = [
    ...(Array.isArray(plan.givens) ? plan.givens : []),
    ...(Array.isArray(plan.derived) ? plan.derived : []),
  ];
  // A plan symbol that spells a unit (N for the normal force) is a
  // variable; stripping it as a unit label would change the arithmetic.
  const symbols = new Set(quantities.flatMap((quantity) =>
    isRecord(quantity)
      ? [quantity.id, quantity.symbol].filter((key): key is string => typeof key === "string")
      : []));
  const units = quantities.flatMap((quantity) =>
    isRecord(quantity) && typeof quantity.unit === "string"
      ? unitAliases(quantity.unit)
      : [],
  ).filter((unit) => !symbols.has(unit));
  return [...new Set(units)].sort((first, second) => second.length - first.length);
}

function unitAliases(unit: string): string[] {
  switch (normalizeUnit(unit)) {
    case "ohm": return ["ohms", "ohm", "Ω"];
    case "v": return ["volts", "volt", "V"];
    case "a": return ["amps", "amp", "A"];
    case "w": return ["watts", "watt", "W"];
    case "n": return ["newtons", "newton", "N"];
    case "j": return ["joules", "joule", "J"];
    case "degree": return ["degrees", "degree", "deg", "°"];
    default: return [unit.trim()];
  }
}

function approximatelyEqual(first: number, second: number): boolean {
  const scale = Math.max(1, Math.abs(first), Math.abs(second));
  return Math.abs(first - second) <= scale * 1e-9;
}

function withinDisplayedPrecision(
  calculated: number,
  stated: { value: number; tolerance: number },
): boolean {
  return Math.abs(calculated - stated.value) <= stated.tolerance +
    Math.max(1, Math.abs(calculated), Math.abs(stated.value)) * 1e-12;
}

function displayedNumberTolerance(source: string): number {
  const match = source.toLowerCase().match(
    /^[+-]?(?:(?:\d+(?:\.(\d*))?)|(?:\.(\d+)))(?:e([+-]?\d+))?$/,
  );
  if (!match) return 0;
  const decimalPlaces = (match[1] ?? match[2] ?? "").length;
  const exponent = Number(match[3] ?? 0);
  return 0.5 * (10 ** (exponent - decimalPlaces));
}

function numericSign(value: number): "positive" | "negative" | "zero" {
  return value > 0 ? "positive" : value < 0 ? "negative" : "zero";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A matrix table's name label ("2A", "kA", "(A+B)^T") is an expression over the
 * scene's own matrix names, not a measured value: "2A" there is twice matrix A,
 * never two amperes. Only matrix_array entities qualify, and only when every
 * letter run is the name of another matrix table in the scene; validateMatrixSourceBinding
 * certifies those labels against the source separately. A scene with no
 * matrix tables (a circuit) keeps reading "2A" as a current.
 */
export function isMatrixExpressionLabel(document: Pick<SceneDocument, "entities">, entity: SceneDocument["entities"][number]): boolean {
  if (entity.kind !== "matrix_array" || typeof entity.label !== "string" || entity.label.length > 64) return false;
  const names = new Set(document.entities
    .filter((candidate) => candidate.kind === "matrix_array" && candidate !== entity)
    .flatMap((candidate) => [candidate.id, candidate.label])
    .filter((name): name is string => typeof name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(name)));
  if (names.size === 0) return false;
  let rest = entity.label.replace(/\^\s*(?:\{\s*(?:T|\\top)\s*\}|T|\\top)|['′ᵀ]/g, " ");
  let sawName = false;
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const next = rest.replace(new RegExp(`(?<![A-Za-z_])${escapeRegExp(name)}`, "g"), " ");
    sawName ||= next !== rest;
    rest = next;
  }
  rest = rest.replace(/\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/g, " ");
  return sawName && /^[\s+\-*·()]*$/.test(rest);
}

/** Every label and annotation text a scene displays that may carry a measured value. */
export function displayedSceneQuantityTexts(document: Pick<SceneDocument, "entities" | "annotations">): string[] {
  return [
    ...document.entities.filter((entity) => !isMatrixExpressionLabel(document, entity)).map((entity) => entity.label),
    ...document.annotations.map((annotation) => annotation.text),
  ].filter((value): value is string => typeof value === "string");
}

/** Verify that any shared numeric quantity keeps the plan's value and unit. */
export function validateSceneQuantityAgreement(
  sceneQuantities: Array<Record<string, unknown> & { id: string }>,
  plan: TurnPlanV3,
  displayedTexts: string[] = [],
): TurnPlanValidationIssue[] {
  const issues: TurnPlanValidationIssue[] = [];
  const planQuantities = [...plan.givens, ...plan.derived];
  const qualitativeEvidence = plan.qualitativeClaims.flatMap((claim) => [
    claim.claim,
    ...(claim.relatedEntityHints ?? []),
  ]).flatMap(extractMeasuredValues);
  const authoritative = new Map(planQuantities.map((quantity) => [quantity.id, quantity]));
  sceneQuantities.forEach((quantity, index) => {
    const planned = authoritative.get(quantity.id);
    const numericValue = typeof quantity.value === "number" && Number.isFinite(quantity.value)
      ? quantity.value
      : null;
    const compatible = planned ?? (numericValue !== null
      ? planQuantities.find((candidate) =>
          equivalentMeasuredQuantity(candidate.value, candidate.unit, numericValue, quantity.unit))
      : undefined);
    if (!planned && compatible) return;
    if (!planned && numericValue !== null && qualitativeEvidence.some((evidence) =>
      equivalentMeasuredQuantity(evidence.value, evidence.unit, numericValue, quantity.unit)
    )) return;
    if (!planned && numericValue !== null) {
      issues.push({ code: "scene_quantity_unverified", path: `quantities[${index}]`, message: `${quantity.id} is not supported by TurnPlanV3` });
      return;
    }
    if (!planned) return;
    const equivalent = numericValue !== null && equivalentMeasuredQuantity(
      numericValue,
      quantity.unit,
      planned.value,
      planned.unit,
    );
    if (!equivalent) {
      issues.push({ code: "scene_quantity_mismatch", path: `quantities[${index}].value`, message: `${quantity.id} disagrees with TurnPlanV3` });
    }
    if (
      planned.unit !== undefined &&
      normalizeUnit(quantity.unit) !== normalizeUnit(planned.unit) &&
      !equivalent
    ) {
      issues.push({ code: "scene_unit_mismatch", path: `quantities[${index}].unit`, message: `${quantity.id} unit disagrees with TurnPlanV3` });
    }
  });

  const supportedDisplays = planQuantities.map((quantity) => ({
    value: quantity.value,
    unit: quantity.unit ?? "",
  })).concat(qualitativeEvidence);
  displayedTexts.forEach((text, index) => {
    for (const match of extractMeasuredValues(text)) {
      if (!supportedDisplays.some((quantity) =>
        equivalentDisplayedMeasuredQuantity(
          quantity.value,
          quantity.unit,
          match.value,
          match.unit,
          match.tolerance,
        ))) {
        issues.push({
          code: "displayed_quantity_unverified",
          path: `displayedTexts[${index}]`,
          message: `displayed value ${match.value} ${match.unit} is not supported by TurnPlanV3`,
        });
      }
    }
  });
  return issues;
}

/**
 * Remove optional annotation text that introduces a measured value absent from
 * the authoritative plan. Geometry and declared quantities are never changed;
 * those still fail agreement instead of being silently repaired.
 */
export function pruneUnverifiedSceneAnnotations(
  document: SceneDocument,
  plan: TurnPlanV3,
): SceneDocument {
  let changed = false;
  const removedIds = new Set<string>();
  const annotations = document.annotations.filter((annotation) => {
    if (!annotation.text) return true;
    const unsupported = validateSceneQuantityAgreement([], plan, [annotation.text])
      .some((issue) => issue.code === "displayed_quantity_unverified");
    if (unsupported) {
      changed = true;
      removedIds.add(annotation.id);
    }
    return !unsupported;
  });
  const entities = document.entities.map((entity) => {
    if (!entity.label || isMatrixExpressionLabel(document, entity)) return entity;
    const label = pruneUnsupportedMeasuredFragments(entity.label, plan);
    if (label === entity.label) return entity;
    changed = true;
    if (label) return { ...entity, label };
    const withoutLabel = { ...entity };
    delete withoutLabel.label;
    return withoutLabel;
  });
  if (!changed) return document;
  return {
    ...document,
    entities,
    annotations,
    teachingTimeline: document.teachingTimeline.filter((action) => !removedIds.has(action.targetId)),
  };
}

/**
 * Derive the minimum structural proofs implied by an authoritative turn plan.
 * This closes the gap where a scene can compile while contradicting the law it
 * is meant to teach. The checks operate on semantic groups and topology only;
 * they do not prescribe coordinates or a topic-specific drawing template.
 */
export function validateTurnPlanSceneProofs(
  document: SceneDocument,
  plan: TurnPlanV3 | null | undefined,
): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const sourceQuestion = plan?.question ?? document.source.question;
  const issues = [
    ...validateCoordinateDistanceSourceInputs(document, sourceQuestion),
    ...validatePointLineSourceInputs(document, sourceQuestion),
    ...validateSectionPointSourceInputs(document, sourceQuestion),
  ];
  if (!plan) return issues;

  const evidenceText = [
    ...plan.lawIds,
    ...plan.qualitativeClaims.flatMap((claim) => [claim.id, claim.claim]),
  ].join(" ").toLowerCase();
  issues.push(...validateSemanticVectorGeometry(document, plan));
  issues.push(...validateClaimedClosedRouteMembers(document, plan));
  issues.push(...validatePoweredCircuitClosure(
    document,
    [plan.question, evidenceText, ...plan.assumptions].join(" ").toLowerCase(),
  ));
  const resistorIds = document.constructions.flatMap((construction) =>
    construction.operator === "symbol" &&
    typeof construction.inputs.symbol === "string" &&
    /resistor/i.test(construction.inputs.symbol) &&
    typeof construction.outputs[0] === "string"
      ? [construction.outputs[0]]
      : [],
  );
  if (resistorIds.length < 2) return issues;
  const needsSeries =
    /\bseries[-_\s]+resistance\b|\bresistors?\s+in\s+series\b/.test(evidenceText);
  const needsParallel =
    /\bparallel[-_\s]+resistance\b|\bresistors?\s+in\s+parallel\b/.test(evidenceText);
  if (!needsSeries && !needsParallel) return issues;

  const resistorSet = new Set(resistorIds);
  const conceptsRequested = Number(needsSeries) + Number(needsParallel);

  const groupFor = (concept: "series" | "parallel") => {
    const named = document.revealGroups.find((group) =>
      new RegExp(`\\b${concept}\\b`, "i").test(`${group.id} ${group.narrationCue ?? ""}`),
    );
    if (named) return named;
    return conceptsRequested === 1 && document.revealGroups.length === 1
      ? document.revealGroups[0]
      : undefined;
  };

  const prove = (concept: "series" | "parallel", predicate: "path" | "sameTerminalPair") => {
    const group = groupFor(concept);
    const groupMembers = group?.entityIds.filter((id) => resistorSet.has(id)) ?? [];
    const mixedTopology = conceptsRequested > 1 && !group;
    const candidateSets = mixedTopology
      ? [
          resistorIds,
          ...resistorIds.flatMap((first, index) =>
            resistorIds.slice(index + 1).map((second) => [first, second]),
          ),
        ]
      : [groupMembers];
    const proof = candidateSets.find((members) => {
      if (members.length < 2) return false;
      const proofIssues: SceneIssue[] = [];
      return evaluateTopologyAssertion({
        id: `turnplan_${concept}_proof`,
        predicate,
        entities: members,
        expected: true,
        severity: "fatal",
        reason: `The ${concept} topology required by TurnPlanV3 was not proved`,
      }, document, proofIssues) === true;
    });
    if (proof) return;

    const members = groupMembers.length > 0 ? groupMembers : resistorIds;
    if (members.length < 2) {
      issues.push({
        code: `turnplan_${concept}_group_missing`,
        message: `TurnPlanV3 requires at least two owned resistors proving ${concept} topology`,
        severity: "fatal",
        entityIds: members,
      });
      return;
    }

    const proofIssues: SceneIssue[] = [];
    evaluateTopologyAssertion({
      id: `turnplan_${concept}_proof`,
      predicate,
      entities: members,
      expected: true,
      severity: "fatal",
      reason: `The ${concept} view does not prove the ${concept} topology required by TurnPlanV3`,
    }, document, proofIssues);
    issues.push({
      ...(proofIssues[0] ?? {
        message: `The ${concept} view failed its required topology proof`,
        severity: "fatal" as const,
        entityIds: members,
      }),
      code: `turnplan_${concept}_not_proven`,
    });
  };

  if (needsSeries) prove("series", "path");
  if (needsParallel) prove("parallel", "sameTerminalPair");
  return issues;
}

const CLOSED_ROUTE_EDGE_OPERATORS = new Set(["segment", "connect", "symbol"]);
const CLOSED_ROUTE_TOPOLOGY_PREDICATES = new Set([
  "connected", "path", "pathCount", "sameTerminalPair", "degree", "on",
]);
const CLOSED_ROUTE_SYMBOLS = new Set([
  "resistor", "battery", "cell", "capacitor", "inductor", "lamp",
  "galvanometer", "ammeter", "voltmeter", "ac_source", "diode", "zener", "switch",
]);

interface ClosedRouteEdge {
  id: string;
  start: string;
  end: string;
}

/**
 * Compile a complete cardinal route claim into one shared-terminal cycle.
 * This repairs model topology with semantic constraints, not topic templates:
 * any balanced sequence such as up/left/down/right is supported.
 */
export function normalizeClaimedClosedRouteGeometry(
  document: SceneDocument,
  plan: TurnPlanV3 | null | undefined,
): SceneDocument {
  if (!plan || document.visualDecision.mode !== "scene") return document;
  const entityById = new Map(document.entities.map((entity) => [entity.id, entity]));
  const constructionByOutput = constructionOutputMap(document);
  const edges = structuralClosedRouteEdges(document);
  const explicitRoute = plan.qualitativeClaims
    .map((claim) => claimedRouteDirections(claim.claim))
    .filter((members) => members.length >= 3 && cardinalRouteCloses(members))
    .sort((first, second) => second.length - first.length)[0];
  const route = explicitRoute ?? inferFourEdgeClosedRoute(
    plan,
    edges,
    entityById,
    constructionByOutput,
  );
  if (!route) return document;
  const used = new Set<string>();
  const members = route.flatMap((part) => {
    const edge = edges.find((candidate) =>
      !used.has(candidate.id) && semanticEntityMatchesHint(
        candidate.id,
        part.hint,
        entityById,
        constructionByOutput,
      ));
    if (!edge) return [];
    used.add(edge.id);
    return [{ ...part, edge }];
  });
  if (members.length !== route.length) return document;
  if (members.every(({ edge, direction }) =>
    edgeBelongsToNonDegenerateClosedRoute(edge, edges, document) &&
    edgeMatchesCardinalAxis(edge, direction, constructionByOutput))) {
    return document;
  }

  const vertices: string[] = [];
  const pointConstructions = new Map(document.constructions.flatMap((construction) =>
    construction.operator === "point" && typeof construction.outputs[0] === "string"
      ? [[construction.outputs[0], construction] as const]
      : [],
  ));
  for (let index = 0; index < members.length; index += 1) {
    if (index === 0) {
      vertices.push(members[0]!.edge.start, members[0]!.edge.end);
      continue;
    }
    if (index === members.length - 1) break;
    const edge = members[index]!.edge;
    const previous = vertices[index]!;
    const next = edge.start === previous
      ? edge.end
      : edge.end === previous
        ? edge.start
        : !vertices.includes(edge.end) ? edge.end : edge.start;
    if (vertices.includes(next)) return document;
    vertices.push(next);
  }
  if (
    vertices.length !== members.length ||
    vertices.some((id) => pointConstructions.get(id)?.operator !== "point")
  ) return document;

  const existingLengths = members.map(({ edge }) => {
    const start = pointForEntity(edge.start, constructionByOutput);
    const end = pointForEntity(edge.end, constructionByOutput);
    return start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 0;
  });
  const horizontalScale = Math.max(1e-3, ...members.flatMap((member, index) =>
    /^(?:left|right)/.test(member.direction) ? [existingLengths[index] ?? 0] : []));
  const verticalScale = Math.max(1e-3, ...members.flatMap((member, index) =>
    /^(?:up|down)/.test(member.direction) ? [existingLengths[index] ?? 0] : []));
  const coordinates: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  for (let index = 0; index < members.length - 1; index += 1) {
    const previous = coordinates[index]!;
    const delta = cardinalDelta(members[index]!.direction, horizontalScale, verticalScale);
    coordinates.push({ x: previous.x + delta.x, y: previous.y + delta.y });
  }

  const routeIds = new Set(members.map((member) => member.edge.id));
  const matchedEndpointIds = new Set(members.flatMap((member) =>
    [member.edge.start, member.edge.end]));
  const removableEdgeIds = new Set(edges.flatMap((edge) => {
    if (routeIds.has(edge.id)) return [];
    const entity = entityById.get(edge.id);
    const semantic = `${edge.id} ${entity?.role ?? ""} ${entity?.label ?? ""}`.toLowerCase();
    const touchesRoute = matchedEndpointIds.has(edge.start) || matchedEndpointIds.has(edge.end);
    return touchesRoute && /\b(?:wire|rail|connector|lead|circuit)\b/.test(semantic)
      ? [edge.id]
      : [];
  }));
  const routeDecorationIds = new Set(document.entities.flatMap((entity) => {
    if (routeIds.has(entity.id)) return [];
    const construction = constructionByOutput.get(entity.id);
    const isOutline = entity.kind === "polygon" || entity.kind === "polyline" ||
      entity.kind === "group" ||
      construction?.operator === "polygon" || construction?.operator === "polyline" ||
      construction?.operator === "rectangle";
    const semantic = `${entity.id} ${entity.role ?? ""} ${entity.label ?? ""}`.toLowerCase();
    return isOutline && /\b(?:circuit|loop|cycle)\b/.test(semantic) ? [entity.id] : [];
  }));

  const pointUpdates = new Map(vertices.map((id, index) => [id, coordinates[index]!]));
  let constructions = document.constructions.flatMap((construction) => {
    const output = construction.outputs[0];
    if (output && (removableEdgeIds.has(output) || routeDecorationIds.has(output))) return [];
    const point = output ? pointUpdates.get(output) : undefined;
    if (point && construction.operator === "point") {
      const coordinateSpace = construction.inputs.coordinateSpace === "layout" ? "layout" : "world";
      return [{ ...construction, inputs: { x: point.x, y: point.y, coordinateSpace } }];
    }
    const memberIndex = members.findIndex((member) => member.edge.id === output);
    if (memberIndex < 0) return [construction];
    const member = members[memberIndex]!;
    const start = vertices[memberIndex]!;
    const end = vertices[(memberIndex + 1) % vertices.length]!;
    const symbol = routeSymbolFor(member.hint, entityById.get(member.edge.id));
    return [{
      ...construction,
      operator: symbol ? "symbol" : "segment",
      inputs: symbol ? { symbol, start, end } : { start, end },
    }];
  });

  const removedIds = new Set([...removableEdgeIds, ...routeDecorationIds]);
  const referencedIds = new Set<string>();
  for (const construction of constructions) {
    collectStringIds(construction.inputs, referencedIds);
  }
  for (const entity of document.entities) {
    if (entity.kind !== "point" || referencedIds.has(entity.id)) continue;
    if (pointConstructions.has(entity.id)) removedIds.add(entity.id);
  }
  constructions = constructions.filter((construction) =>
    !construction.outputs.some((output) => removedIds.has(output)));

  const entities = document.entities.flatMap((entity) => {
    if (removedIds.has(entity.id)) return [];
    const member = members.find((candidate) => candidate.edge.id === entity.id);
    if (!member) return [entity];
    return [{
      ...entity,
      kind: routeSymbolFor(member.hint, entity) ? "component" : "segment",
    }];
  });
  const annotations = document.annotations.filter((annotation) =>
    !annotation.targetIds.some((id) => removedIds.has(id)));
  const removedAnnotationIds = new Set(document.annotations
    .filter((annotation) => !annotations.includes(annotation))
    .map((annotation) => annotation.id));
  const cycleSubjectIds = new Set([...routeIds, ...matchedEndpointIds, ...removedIds]);
  const assertions = document.assertions.filter((assertion) =>
    !(
      CLOSED_ROUTE_TOPOLOGY_PREDICATES.has(assertion.predicate) &&
      assertion.entities.some((id) => cycleSubjectIds.has(id))
    ));

  return {
    ...document,
    entities,
    constructions,
    assertions,
    annotations,
    requiredEntityIds: document.requiredEntityIds.filter((id) => !removedIds.has(id)),
    revealGroups: document.revealGroups.map((group) => ({
      ...group,
      entityIds: group.entityIds.filter((id) => !removedIds.has(id)),
    })),
    teachingTimeline: document.teachingTimeline.filter((action) =>
      !removedIds.has(action.targetId) && !removedAnnotationIds.has(action.targetId)),
  };
}

/**
 * Compile semantic principal-ray claims into a consistent paraxial mirror
 * construction. The planner supplies named entities and audited quantities;
 * this pass supplies geometry from constraints rather than accepting guessed
 * ray coordinates.
 */
export function normalizeClaimedParaxialReflectionGeometry(
  document: SceneDocument,
  plan: TurnPlanV3 | null | undefined,
): SceneDocument {
  if (!plan || document.visualDecision.mode !== "scene") return document;
  const claims = plan.qualitativeClaims.filter((claim) => claim.expected !== false);
  const entityById = new Map(document.entities.map((entity) => [entity.id, entity]));
  const semantic = (id: string): string => {
    const entity = entityById.get(id);
    return `${id} ${entity?.role ?? ""} ${entity?.label ?? ""}`
      .toLowerCase().replace(/[_-]+/g, " ");
  };
  const findEntity = (pattern: RegExp, kinds?: readonly string[]): string | null =>
    document.entities.find((entity) =>
      (!kinds || kinds.includes(entity.kind)) && pattern.test(semantic(entity.id)))?.id ?? null;
  const mirrorId = findEntity(/\bmirror\b/, ["arc", "circle", "line", "segment"]);
  const hasPrincipalRayClaims = claims.some((claim) =>
    /\bparallel\b.*\breflect(?:s|ed)?\b.*\bfoc(?:us|al)\b/i.test(claim.claim)) &&
    claims.some((claim) =>
      /\bfoc(?:us|al)\b.*\breflect(?:s|ed)?\b.*\bparallel\b/i.test(claim.claim));
  const hasRequiredRayDiagram = claims.some((claim) =>
    /\bray\s+diagram\b/i.test(`${claim.id} ${claim.claim} ${claim.relatedEntityHints?.join(" ") ?? ""}`));
  const namedRayCount = document.entities.filter((entity) =>
    (entity.kind === "ray" || entity.kind === "vector") && /\bray\b/.test(semantic(entity.id))).length;
  if (!mirrorId || (!hasPrincipalRayClaims && !(hasRequiredRayDiagram && namedRayCount >= 4))) {
    return document;
  }
  const hasSolvedReflection = document.constructions.some((construction) =>
    construction.operator === "reflect_direction");
  const producers = constructionOutputMap(document);
  const semanticArrowEndpoints = (owner: "object" | "image"): readonly [string, string] | null => {
    const arrowId = findEntity(new RegExp(`\\b${owner}\\b`), ["vector"]);
    const construction = arrowId ? producers.get(arrowId) : undefined;
    if (!construction) return null;
    const start = typeof construction.inputs.start === "string" ? construction.inputs.start : null;
    const end = typeof construction.inputs.end === "string" ? construction.inputs.end : null;
    return start && end ? [start, end] : null;
  };
  const objectArrow = semanticArrowEndpoints("object");
  const imageArrow = semanticArrowEndpoints("image");
  const vertexId = findEntity(/\b(?:mirror )?vertex\b|\bpole\b/, ["point"]);
  const focusId = findEntity(/\bfoc(?:us|al point)\b/, ["point"]);
  const centerId = findEntity(/\b(?:center|centre)(?: of curvature)?\b/, ["point"]);
  const axisId = findEntity(/\b(?:principal|optical) axis\b|\baxis\b/, ["line", "segment"]);
  const objectBaseId = objectArrow?.[0] ?? findEntity(/\bobject (?:base|bottom|position)\b/, ["point"]);
  const objectTipId = objectArrow?.[1] ?? findEntity(/\bobject (?:tip|top)\b/, ["point"]);
  const imageBaseId = imageArrow?.[0] ?? findEntity(/\bimage (?:base|bottom|position)\b/, ["point"]);
  const imageTipId = imageArrow?.[1] ?? findEntity(/\bimage (?:tip|top)\b/, ["point"]);
  if (!mirrorId || !vertexId || !focusId || !centerId || !axisId || !objectBaseId ||
      !objectTipId || !imageBaseId || !imageTipId) return document;

  const vertex = pointForEntity(vertexId, producers);
  const objectBase = pointForEntity(objectBaseId, producers);
  const objectTip = pointForEntity(objectTipId, producers);
  const imageBase = pointForEntity(imageBaseId, producers);
  const imageTip = pointForEntity(imageTipId, producers);
  if (!vertex || !objectBase || !objectTip || !imageBase || !imageTip) return document;
  const objectVector = subtractPoint(objectBase, vertex);
  const objectDistanceNow = vectorMagnitude(objectVector);
  if (objectDistanceNow <= 1e-9) return document;
  const objectSide = scalePoint(objectVector, 1 / objectDistanceNow);
  const currentHeight = subtractPoint(objectTip, objectBase);
  const height = vectorMagnitude(currentHeight);
  if (height <= 1e-9) return document;
  const heightDirection = scalePoint(currentHeight, 1 / height);

  const quantities = [...plan.givens, ...plan.derived];
  const quantity = (aliases: readonly RegExp[], fallback: number): number => {
    const match = quantities.find((candidate) => {
      const keys = [candidate.id, candidate.symbol]
        .map((key) => key.toLowerCase().replace(/[^a-z0-9]+/g, ""));
      return aliases.some((alias) => keys.some((key) => alias.test(key)));
    });
    return match && Number.isFinite(match.value) ? Math.abs(match.value) : fallback;
  };
  const focalNow = pointForEntity(focusId, producers);
  const focalDistance = quantity([/^(?:f|focallength)$/],
    focalNow ? vectorMagnitude(subtractPoint(focalNow, vertex)) : 1);
  const objectDistance = quantity([/^(?:do|objectdistance|u)$/], objectDistanceNow);
  const imageDistance = quantity([/^(?:di|imagedistance|v)$/],
    vectorMagnitude(subtractPoint(imageBase, vertex)));
  const magnificationQuantity = quantities.find((candidate) => {
    const keys = [candidate.id, candidate.symbol]
      .map((key) => key.toLowerCase().replace(/[^a-z0-9]+/g, ""));
    return keys.some((key) => /^(?:m|magnification)$/.test(key));
  });
  const magnification = magnificationQuantity && Number.isFinite(magnificationQuantity.value)
    ? magnificationQuantity.value
    : dotPoint(subtractPoint(imageTip, imageBase), heightDirection) / height;
  if (![focalDistance, objectDistance, imageDistance, magnification].every(Number.isFinite) ||
      focalDistance <= 0 || objectDistance <= 0 || imageDistance <= 0) return document;
  const hasSpecifiedHeight = /\b(?:object|image)\s+height\b/i.test(plan.question) ||
    quantities.some((candidate) =>
      [candidate.id, candidate.symbol].some((key) =>
        /^(?:objectheight|imageheight|ho|hi)$/.test(
          key.toLowerCase().replace(/[^a-z0-9]+/g, ""),
        )));
  const illustrationHeight = hasSpecifiedHeight ? height : Math.min(height, focalDistance * 0.08);

  const isConvex = /\bconvex\s+mirror\b/i.test(plan.question);
  const isVirtual = claims.some((claim) => /\bimage\b.*\bvirtual\b/i.test(claim.claim));
  const isReal = claims.some((claim) => /\bimage\b.*\breal\b/i.test(claim.claim));
  const focalSide = isConvex ? scalePoint(objectSide, -1) : objectSide;
  const imageSide = isVirtual && !isReal ? scalePoint(objectSide, -1) : objectSide;
  const nextVertex = vertex;
  const nextFocus = addPoint(nextVertex, scalePoint(focalSide, focalDistance));
  const nextCenter = addPoint(nextVertex, scalePoint(focalSide, 2 * focalDistance));
  const nextObjectBase = addPoint(nextVertex, scalePoint(objectSide, objectDistance));
  const nextObjectTip = addPoint(nextObjectBase, scalePoint(heightDirection, illustrationHeight));
  const nextImageBase = addPoint(nextVertex, scalePoint(imageSide, imageDistance));
  const nextImageTip = addPoint(nextImageBase, scalePoint(heightDirection, illustrationHeight * magnification));
  const axisDirection = objectSide;
  const hit1 = addPoint(nextVertex, scalePoint(heightDirection,
    dotPoint(subtractPoint(nextObjectTip, nextVertex), heightDirection)));
  const hit2 = linePlaneIntersection(nextObjectTip, nextFocus, nextVertex, axisDirection);
  const hit3 = linePlaneIntersection(nextObjectTip, nextCenter, nextVertex, axisDirection);
  if (!hit2 || !hit3) return document;

  const pointUpdates = new Map<string, { x: number; y: number }>([
    [vertexId, nextVertex], [focusId, nextFocus], [centerId, nextCenter],
    [objectBaseId, nextObjectBase], [objectTipId, nextObjectTip],
    [imageBaseId, nextImageBase], [imageTipId, nextImageTip],
  ]);
  const rayMembers = document.entities.flatMap((entity) => {
    if (entity.kind !== "ray" && entity.kind !== "vector") return [];
    const words = semantic(entity.id);
    const number = words.match(/\bray\s*([123])\b/)?.[1] ?? entity.id.match(/ray[_-]?([123])/i)?.[1];
    if (!number) return [];
    const outgoing = /\b(?:out|reflected|reflection|ref)\b/.test(words);
    const incoming = /\b(?:in|incident)\b/.test(words);
    return outgoing || incoming ? [{ id: entity.id, number: Number(number), outgoing }] : [];
  });
  const endpoints = new Map<string, readonly [string, string]>();
  const hits = [hit1, hit2, hit3];
  for (let index = 1; index <= 3; index += 1) {
    const hitEntity = findEntity(new RegExp(`\\bray\\s*${index}\\s*hit\\b|\\bray${index} hit\\b`), ["point"]);
    if (hitEntity) pointUpdates.set(hitEntity, hits[index - 1]!);
    const incoming = rayMembers.find((member) => member.number === index && !member.outgoing);
    const outgoing = rayMembers.find((member) => member.number === index && member.outgoing);
    if (!hitEntity || !incoming || !outgoing) continue;
    endpoints.set(incoming.id, [objectTipId, hitEntity]);
    endpoints.set(outgoing.id, index === 1
      ? [hitEntity, focusId]
      : index === 2 ? [hitEntity, imageTipId] : [hitEntity, centerId]);
  }
  if (!hasSolvedReflection && endpoints.size < 4) return document;
  const outgoingRay1 = rayMembers.find((member) => member.number === 1 && member.outgoing)?.id;
  const outgoingRay2 = rayMembers.find((member) => member.number === 2 && member.outgoing)?.id;
  const governedIds = new Set([
    mirrorId, vertexId, focusId, centerId, axisId, objectBaseId, objectTipId,
    imageBaseId, imageTipId, ...rayMembers.map((member) => member.id),
  ]);
  const governedPredicates = new Set([
    "on", "between", "same_side", "opposite_side", "converges", "parallel",
    "perpendicular", "incident",
  ]);
  const assertions = document.assertions.filter((assertion) =>
    !(
      governedPredicates.has(assertion.predicate) &&
      assertion.entities.some((id) => governedIds.has(id))
    ));
  for (const [id, pointId] of [
    ["focus_on_axis", focusId],
    ["center_on_axis", centerId],
    ["object_on_axis", objectBaseId],
    ["image_on_axis", imageBaseId],
  ] as const) {
    assertions.push({
      id: `constraint_paraxial_${id}`,
      predicate: "on",
      entities: [pointId, axisId],
      expected: true,
      severity: "fatal",
      reason: "paraxial reflection constraint compiler",
    });
  }
  if (outgoingRay1 && outgoingRay2) {
    assertions.push({
      id: "constraint_paraxial_rays_converge",
      predicate: "converges",
      entities: [outgoingRay1, outgoingRay2, imageTipId],
      expected: true,
      severity: "fatal",
      reason: "principal reflected rays meet at the audited image position",
    });
  }

  return {
    ...document,
    source: {
      ...document.source,
      constraintCompilers: [
        ...(Array.isArray(document.source.constraintCompilers)
          ? document.source.constraintCompilers.filter((value): value is string => typeof value === "string")
          : []),
        "paraxial_reflection",
      ],
    },
    constructions: document.constructions.map((construction) => {
      const output = construction.outputs[0];
      const point = output ? pointUpdates.get(output) : undefined;
      if (point && construction.operator === "point") {
        return {
          ...construction,
          inputs: {
            ...construction.inputs,
            x: point.x,
            y: point.y,
            coordinateSpace: construction.inputs.coordinateSpace === "layout" ? "layout" : "world",
          },
        };
      }
      const pair = output ? endpoints.get(output) : undefined;
      if (
        pair &&
        construction.operator !== "reflect_direction" &&
        construction.operator !== "refract_direction"
      ) {
        return { ...construction, operator: "ray", inputs: { start: pair[0], end: pair[1] } };
      }
      if (hasSolvedReflection && construction.operator === "surface_contact") {
        const number = [construction.id, ...construction.outputs].join(" ").match(/\d+/)?.[0];
        const through = number === "1" ? hit1 : number === "2" ? focusId : number === "3" ? centerId : null;
        if (through) return { ...construction, inputs: { ...construction.inputs, through } };
      }
      if (
        output === mirrorId &&
        (construction.operator === "arc" ||
          construction.operator === "line" ||
          construction.operator === "segment" ||
          construction.operator === "perpendicular_through")
      ) {
        const centerToVertex = subtractPoint(nextVertex, nextCenter);
        const angle = Math.atan2(centerToVertex.y, centerToVertex.x) * 180 / Math.PI;
        return {
          ...construction,
          operator: "arc",
          inputs: {
            center: centerId,
            radius: 2 * focalDistance,
            startAngle: angle - 60,
            endAngle: angle + 60,
            angleUnit: "degrees",
          },
        };
      }
      return construction;
    }),
    entities: document.entities.map((entity) =>
      entity.id === mirrorId ? { ...entity, kind: "arc", role: entity.role || "spherical mirror" } : entity),
    assertions,
  };
}

function addPoint(first: { x: number; y: number }, second: { x: number; y: number }): { x: number; y: number } {
  return { x: first.x + second.x, y: first.y + second.y };
}

function subtractPoint(first: { x: number; y: number }, second: { x: number; y: number }): { x: number; y: number } {
  return { x: first.x - second.x, y: first.y - second.y };
}

function scalePoint(point: { x: number; y: number }, scale: number): { x: number; y: number } {
  return { x: point.x * scale, y: point.y * scale };
}

function vectorMagnitude(point: { x: number; y: number }): number {
  return Math.hypot(point.x, point.y);
}

function dotPoint(first: { x: number; y: number }, second: { x: number; y: number }): number {
  return first.x * second.x + first.y * second.y;
}

function linePlaneIntersection(
  first: { x: number; y: number },
  second: { x: number; y: number },
  planePoint: { x: number; y: number },
  planeNormal: { x: number; y: number },
): { x: number; y: number } | null {
  const direction = subtractPoint(second, first);
  const denominator = dotPoint(direction, planeNormal);
  if (Math.abs(denominator) <= 1e-9) return null;
  const parameter = dotPoint(subtractPoint(planePoint, first), planeNormal) / denominator;
  return addPoint(first, scalePoint(direction, parameter));
}

function inferFourEdgeClosedRoute(
  plan: TurnPlanV3,
  edges: ClosedRouteEdge[],
  entities: Map<string, SceneDocument["entities"][number]>,
  constructions: Map<string, SceneDocument["constructions"][number]>,
): Array<{ direction: string; hint: string }> | null {
  const claim = plan.qualitativeClaims.find((candidate) =>
    candidate.expected !== false &&
    /\bcurrent\b/i.test(candidate.claim) &&
    /\b(?:loop|cycle|circuit|counter[- ]?clockwise|clockwise)\b/i.test(candidate.claim));
  if (!claim) return null;
  const directed = claimedRouteDirections(claim.claim);
  const verticalAnchor = directed.find((member) =>
    member.direction.startsWith("up") || member.direction.startsWith("down"));
  if (!verticalAnchor) return null;
  const anchor = edges.find((edge) => semanticEntityMatchesHint(
    edge.id,
    verticalAnchor.hint,
    entities,
    constructions,
  ));
  const semantic = (edge: ClosedRouteEdge) => normalizeSemanticTokens([
    edge.id,
    entities.get(edge.id)?.role,
    entities.get(edge.id)?.label,
  ].filter((value): value is string => typeof value === "string").join(" "));
  const top = edges.find((edge) => {
    const tokens = semantic(edge);
    return tokens.includes("top") && tokens.includes("rail");
  });
  const bottom = edges.find((edge) => {
    const tokens = semantic(edge);
    return tokens.includes("bottom") && tokens.includes("rail");
  });
  const component = edges.find((edge) =>
    constructions.get(edge.id)?.operator === "symbol" &&
    edge.id !== anchor?.id && edge.id !== top?.id && edge.id !== bottom?.id);
  if (!anchor || !top || !bottom || !component) return null;
  if (new Set([anchor.id, top.id, component.id, bottom.id]).size !== 4) return null;

  if (verticalAnchor.direction.startsWith("down")) {
    return [
      { direction: "down", hint: anchor.id },
      { direction: "right", hint: bottom.id },
      { direction: "up", hint: component.id },
      { direction: "left", hint: top.id },
    ];
  }
  return [
    { direction: "up", hint: anchor.id },
    { direction: "left", hint: top.id },
    { direction: "down", hint: component.id },
    { direction: "right", hint: bottom.id },
  ];
}

function cardinalRouteCloses(route: Array<{ direction: string }>): boolean {
  const unit = route.reduce((sum, member) => {
    const delta = cardinalDelta(member.direction, 1, 1);
    return { x: sum.x + delta.x, y: sum.y + delta.y };
  }, { x: 0, y: 0 });
  return unit.x === 0 && unit.y === 0;
}

function cardinalDelta(
  direction: string,
  horizontalScale: number,
  verticalScale: number,
): { x: number; y: number } {
  if (direction.startsWith("left")) return { x: -horizontalScale, y: 0 };
  if (direction.startsWith("right")) return { x: horizontalScale, y: 0 };
  if (direction.startsWith("down")) return { x: 0, y: -verticalScale };
  return { x: 0, y: verticalScale };
}

function edgeMatchesCardinalAxis(
  edge: ClosedRouteEdge,
  direction: string,
  constructions: Map<string, SceneDocument["constructions"][number]>,
): boolean {
  const vector = directionForEntity(edge.id, constructions);
  if (!vector) return false;
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 1e-9) return false;
  return /^(?:left|right)/.test(direction)
    ? Math.abs(vector.y) / length <= 0.04
    : Math.abs(vector.x) / length <= 0.04;
}

function routeSymbolFor(
  hint: string,
  entity: SceneDocument["entities"][number] | undefined,
): string | null {
  const semantic = `${hint} ${entity?.id ?? ""} ${entity?.role ?? ""} ${entity?.label ?? ""}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  return [...CLOSED_ROUTE_SYMBOLS].find((symbol) =>
    new RegExp(`(?:^|[^a-z])${symbol.replace(/_/g, " ")}(?:[^a-z]|$)`, "i").test(semantic)) ?? null;
}

function collectStringIds(value: unknown, target: Set<string>): void {
  if (typeof value === "string") {
    target.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringIds(item, target));
    return;
  }
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach((item) => collectStringIds(item, target));
  }
}

function validateClaimedClosedRouteMembers(
  document: SceneDocument,
  plan: TurnPlanV3,
): SceneIssue[] {
  const evidence = [
    ...plan.assumptions,
    ...plan.qualitativeClaims.map((claim) => claim.claim),
  ];
  const memberHints = new Set<string>();

  for (const statement of evidence) {
    for (const pattern of [
      /\b(?:loop|cycle|closed\s+path)\b[^.;]{0,80}?\bwith\s+(?:the\s+)?([a-z][a-z0-9 _-]{0,40}?)\s+as\s+(?:(?:one|a|the)\s+)?(?:side|edge|branch|part|member)\b/gi,
      /\b([a-z][a-z0-9 _-]{0,40}?)\s+(?:forms|is|serves\s+as)\s+(?:(?:one|a|the)\s+)?(?:side|edge|branch|part|member)\s+(?:of|in)\s+(?:the\s+)?(?:loop|cycle|closed\s+path)\b/gi,
    ]) {
      for (const match of statement.matchAll(pattern)) {
        const hint = match[1]?.trim();
        if (hint) memberHints.add(hint);
      }
    }
  }

  for (const claim of plan.qualitativeClaims) {
    if (
      claim.expected !== false &&
      (
        /\b(?:loop|cycle|closed\s+path)\b/i.test(claim.claim) ||
        (/\b(?:current|emf)\b/i.test(claim.claim) && /\b(?:through|along|around|flows?|drives?)\b/i.test(claim.claim))
      )
    ) {
      for (const hint of claim.relatedEntityHints ?? []) memberHints.add(hint);
      for (const route of claimedRouteDirections(claim.claim)) memberHints.add(route.hint);
      for (const hint of claimedCurrentMemberHints(claim.claim)) memberHints.add(hint);
    }
  }

  const edges = structuralClosedRouteEdges(document);
  const closedCurrentIsClaimed = plan.qualitativeClaims.some((claim) =>
    claim.expected !== false &&
    (
      /\b(?:current\s+(?:flows?|is)|emf\s+drives\s+current)\b/i.test(claim.claim) ||
      (/\bcurrent\b/i.test(claim.claim) &&
        /\b(?:loop|circuit|counter[- ]?clockwise|clockwise)\b/i.test(claim.claim))
    ) &&
    !/\b(?:no|zero)\s+current\b|\bopen\s+circuit\b/i.test(claim.claim),
  ) && !/\b(?:open circuit|open switch|switch is open|disconnected circuit)\b/i.test(
    [plan.question, ...plan.assumptions].join(" "),
  );
  if (closedCurrentIsClaimed) {
    const constructionByOutput = constructionOutputMap(document);
    for (const edge of edges) {
      if (constructionByOutput.get(edge.id)?.operator === "symbol") memberHints.add(edge.id);
    }
  }
  if (edges.length === 0) return [];
  const entityById = new Map(document.entities.map((entity) => [entity.id, entity]));
  const constructionByOutput = constructionOutputMap(document);
  const issues: SceneIssue[] = [];
  const checked = new Set<string>();

  if (closedCurrentIsClaimed) {
    issues.push(...validateClosedRouteSymbolBypasses(document, edges, constructionByOutput));
  }

  if (memberHints.size > 0) {
    for (const hint of memberHints) {
      const matching = edges.filter((edge) => semanticEntityMatchesHint(
        edge.id,
        hint,
        entityById,
        constructionByOutput,
      ));
      for (const edge of matching) {
        if (checked.has(edge.id)) continue;
        checked.add(edge.id);
        if (edgeBelongsToNonDegenerateClosedRoute(edge, edges, document)) continue;
        issues.push({
          code: "turnplan_loop_member_not_proven",
          message: `${edge.id} is named as part of a closed route but is not on a non-degenerate closed path`,
          severity: "fatal",
          entityIds: [edge.id],
        });
      }
    }
  }

  issues.push(...validateClaimedRouteAxisDirections(
    document,
    plan,
    edges,
    entityById,
    constructionByOutput,
  ));
  return issues;
}

function validateClosedRouteSymbolBypasses(
  document: SceneDocument,
  edges: ClosedRouteEdge[],
  constructions: Map<string, SceneDocument["constructions"][number]>,
): SceneIssue[] {
  const endpointKeys = new Map<string, string>();
  for (const entity of document.entities) {
    const point = pointForEntity(entity.id, constructions);
    if (!point) continue;
    const space = coordinateSpaceForEntity(entity.id, constructions) ?? "world";
    endpointKeys.set(
      entity.id,
      `${space}:${Math.round(point.x * 1e8)}:${Math.round(point.y * 1e8)}`,
    );
  }
  const keyFor = (id: string) => endpointKeys.get(id) ?? `id:${id}`;
  const terminalPair = (edge: ClosedRouteEdge) => [keyFor(edge.start), keyFor(edge.end)].sort().join("|");
  const plainEdgesByPair = new Map<string, ClosedRouteEdge[]>();
  for (const edge of edges) {
    if (constructions.get(edge.id)?.operator === "symbol") continue;
    const pair = terminalPair(edge);
    plainEdgesByPair.set(pair, [...(plainEdgesByPair.get(pair) ?? []), edge]);
  }

  return edges.flatMap((edge): SceneIssue[] => {
    if (constructions.get(edge.id)?.operator !== "symbol") return [];
    const bypasses = plainEdgesByPair.get(terminalPair(edge)) ?? [];
    if (bypasses.length === 0) return [];
    return [{
      code: "turnplan_loop_member_bypassed",
      message: `${edge.id} is overlaid by a plain route edge between the same terminals`,
      severity: "fatal",
      entityIds: [edge.id, ...bypasses.map((bypass) => bypass.id)],
    }];
  });
}

function structuralClosedRouteEdges(document: SceneDocument): ClosedRouteEdge[] {
  return document.constructions.flatMap((construction) => {
    if (!CLOSED_ROUTE_EDGE_OPERATORS.has(construction.operator)) return [];
    const start = firstStringValue(construction.inputs, ["start", "from", "a"]);
    const end = firstStringValue(construction.inputs, ["end", "to", "b"]);
    const id = construction.outputs[0];
    return start && end && id && start !== end ? [{ id, start, end }] : [];
  });
}

function constructionOutputMap(document: SceneDocument): Map<string, SceneDocument["constructions"][number]> {
  const result = new Map<string, SceneDocument["constructions"][number]>();
  for (const construction of document.constructions) {
    for (const output of construction.outputs) result.set(output, construction);
  }
  return result;
}

function semanticEntityMatchesHint(
  entityId: string,
  hint: string,
  entities: Map<string, SceneDocument["entities"][number]>,
  constructions: Map<string, SceneDocument["constructions"][number]>,
): boolean {
  const entity = entities.get(entityId);
  const construction = constructions.get(entityId);
  const semantic = normalizeSemanticTokens([
    entityId,
    entity?.role,
    entity?.label,
    construction?.operator,
    construction?.inputs.symbol,
  ].filter((value): value is string => typeof value === "string").join(" "));
  const wanted = normalizeSemanticTokens(hint)
    .filter((token) => !["the", "a", "an", "one", "each", "all"].includes(token));
  return wanted.length > 0 && wanted.every((token) => semantic.includes(token));
}

function normalizeSemanticTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token);
}

function edgeBelongsToNonDegenerateClosedRoute(
  target: ClosedRouteEdge,
  edges: ClosedRouteEdge[],
  document: SceneDocument,
): boolean {
  const constructions = constructionOutputMap(document);
  const pointKey = new Map<string, string>();
  const pointByKey = new Map<string, { x: number; y: number }>();
  for (const entity of document.entities) {
    const point = pointForEntity(entity.id, constructions);
    if (!point) continue;
    const space = coordinateSpaceForEntity(entity.id, constructions) ?? "world";
    const key = `${space}:${Math.round(point.x * 1e8)}:${Math.round(point.y * 1e8)}`;
    pointKey.set(entity.id, key);
    pointByKey.set(key, point);
  }
  const keyFor = (id: string) => pointKey.get(id) ?? `id:${id}`;
  const start = keyFor(target.start);
  const end = keyFor(target.end);
  if (start === end) return false;

  const adjacency = new Map<string, Array<{ next: string; owner: string }>>();
  const link = (first: string, second: string, owner: string) => {
    adjacency.set(first, [...(adjacency.get(first) ?? []), { next: second, owner }]);
    adjacency.set(second, [...(adjacency.get(second) ?? []), { next: first, owner }]);
  };
  for (const edge of edges) link(keyFor(edge.start), keyFor(edge.end), edge.id);

  const visited = new Set([start]);
  const path = [start];
  let explored = 0;
  const findsClosedRoute = (node: string): boolean => {
    if (explored++ > 10_000) return false;
    if (node === end) {
      const points = path.map((key) => pointByKey.get(key));
      if (!points.every((point): point is { x: number; y: number } => Boolean(point))) {
        return path.length >= 3;
      }
      const twiceArea = points.reduce((area, point, index) => {
        const next = points[(index + 1) % points.length]!;
        return area + point.x * next.y - next.x * point.y;
      }, 0);
      const scale = Math.max(1, ...points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]));
      return Math.abs(twiceArea) > scale * scale * 1e-8;
    }
    for (const neighbour of adjacency.get(node) ?? []) {
      if (neighbour.owner === target.id || visited.has(neighbour.next)) continue;
      visited.add(neighbour.next);
      path.push(neighbour.next);
      if (findsClosedRoute(neighbour.next)) return true;
      path.pop();
      visited.delete(neighbour.next);
    }
    return false;
  };
  return findsClosedRoute(start);
}

function validateClaimedRouteAxisDirections(
  document: SceneDocument,
  plan: TurnPlanV3,
  edges: ClosedRouteEdge[],
  entities: Map<string, SceneDocument["entities"][number]>,
  constructions: Map<string, SceneDocument["constructions"][number]>,
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const checked = new Set<string>();
  for (const claim of plan.qualitativeClaims) {
    for (const route of claimedRouteDirections(claim.claim)) {
      const { direction, hint } = route;
      const expectsHorizontal = direction.startsWith("left") || direction.startsWith("right");
      for (const edge of edges.filter((candidate) =>
        semanticEntityMatchesHint(candidate.id, hint, entities, constructions))) {
        const key = `${edge.id}:${expectsHorizontal ? "horizontal" : "vertical"}`;
        if (checked.has(key)) continue;
        checked.add(key);
        const vector = directionForEntity(edge.id, constructions);
        if (!vector) continue;
        const length = Math.hypot(vector.x, vector.y);
        const residual = length <= 1e-9
          ? 1
          : expectsHorizontal ? Math.abs(vector.y) / length : Math.abs(vector.x) / length;
        if (residual <= 0.04) continue;
        issues.push({
          code: "turnplan_route_direction_not_proven",
          message: `${edge.id} must be ${expectsHorizontal ? "horizontal" : "vertical"} to support “${direction} through ${hint}”`,
          severity: "fatal",
          entityIds: [edge.id],
          residual,
        });
      }
    }
  }
  return issues;
}

function claimedRouteDirections(claim: string): Array<{ direction: string; hint: string }> {
  const pattern = /\b(up(?:ward)?|down(?:ward)?|left(?:ward)?|right(?:ward)?)\s+(?:through|along|across)\s+(?:the\s+)?([a-z][a-z0-9_-]*(?:\s+[a-z0-9_-]+){0,2}?)(?=\s*(?:,|;|\(|\)|\band\b|$))/gi;
  return [...claim.matchAll(pattern)].map((match) => ({
    direction: match[1]!.toLowerCase(),
    hint: match[2]!.trim(),
  }));
}

function claimedCurrentMemberHints(claim: string): string[] {
  const pattern = /\bcurrent(?:\s+direction)?\s+(?:in|through|along)\s+(?:the\s+)?([a-z][a-z0-9_-]*(?:\s+[a-z0-9_-]+){0,2}?)(?=\s+(?:is|points?|flows?)\b|\s*[:(,])/gi;
  return [...claim.matchAll(pattern)].flatMap((match) =>
    match[1]?.trim() ? [match[1].trim()] : []);
}

function validatePoweredCircuitClosure(
  document: SceneDocument,
  evidenceText: string,
): SceneIssue[] {
  if (/\b(?:open circuit|open switch|switch is open|disconnected circuit)\b/.test(evidenceText)) {
    return [];
  }
  const entityById = new Map(document.entities.map((entity) => [entity.id, entity]));
  const edges = document.constructions.flatMap((construction) => {
    if (construction.operator !== "symbol" && construction.operator !== "connect") return [];
    const start = firstStringValue(construction.inputs, ["start", "from", "a"]);
    const end = firstStringValue(construction.inputs, ["end", "to", "b"]);
    const id = construction.outputs[0];
    return start && end && id ? [{ id, start, end, construction }] : [];
  });
  const sources = edges.filter(({ id, construction }) => {
    if (construction.operator !== "symbol") return false;
    const entity = entityById.get(id);
    const semantic = `${String(construction.inputs.symbol ?? "")} ${entity?.role ?? ""} ${entity?.label ?? ""}`;
    return /\b(?:(?:ac|dc|voltage|current|power)[_ -]?source|battery|cell|supply|generator)\b/i
      .test(semantic);
  });
  const issues: SceneIssue[] = [];
  for (const source of sources) {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.id === source.id) continue;
      adjacency.set(edge.start, [...(adjacency.get(edge.start) ?? []), edge.end]);
      adjacency.set(edge.end, [...(adjacency.get(edge.end) ?? []), edge.start]);
    }
    const pending = [source.start];
    const visited = new Set(pending);
    while (pending.length > 0) {
      const node = pending.shift()!;
      for (const next of adjacency.get(node) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        pending.push(next);
      }
    }
    if (!visited.has(source.end)) {
      issues.push({
        code: "source_loop_not_closed",
        message: `Source ${source.id} is not part of a closed component path`,
        severity: "fatal",
        entityIds: [source.id],
      });
    }
  }
  return issues;
}

function firstStringValue(
  values: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    if (typeof values[key] === "string") return values[key];
  }
  return null;
}

/**
 * Vector directions are physical geometry, not raw page layout. A consistent
 * layout-space network is interpreted in a y-up proof frame; mixed coordinate
 * spaces remain invalid because their relative directions are ambiguous.
 */
function validateSemanticVectorGeometry(
  document: SceneDocument,
  plan: TurnPlanV3,
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const constructions = new Map<string, SceneDocument["constructions"][number]>();
  document.constructions.forEach((construction) =>
    construction.outputs.forEach((output) => constructions.set(output, construction)));
  const entities = new Map(document.entities.map((entity) => [entity.id, entity]));
  const vectors = document.entities.filter((entity) => entity.kind === "vector");

  issues.push(...validatePageNormalDirections(document, plan, constructions));

  for (const vector of vectors) {
    if (coordinateSpaceForEntity(vector.id, constructions) === "mixed") {
      issues.push({
        code: "physical_vector_mixed_coordinate_spaces",
        message: `${vector.id} mixes layout and world coordinates, so its physical direction is ambiguous`,
        severity: "fatal",
        entityIds: [vector.id],
      });
    }
  }

  const semanticText = (id: string) => {
    const entity = entities.get(id);
    return `${id} ${entity?.role ?? ""} ${entity?.label ?? ""}`
      .toLowerCase()
      .replace(/[_-]+/g, " ");
  };
  const surfaces = document.entities.filter((entity) =>
    /\b(?:incline|inclined plane|ramp|slope)\b/.test(semanticText(entity.id)) &&
    directionForEntity(entity.id, constructions) !== null);
  const surface = surfaces[0];
  if (surface) {
    const verifyDirectionRelation = (
      entity: SceneDocument["entities"][number],
      predicate: "parallel" | "perpendicular",
    ) => {
      const first = directionForEntity(entity.id, constructions);
      const second = directionForEntity(surface.id, constructions);
      if (!first || !second) return;
      const firstSpace = coordinateSpaceForEntity(entity.id, constructions);
      const secondSpace = coordinateSpaceForEntity(surface.id, constructions);
      if (
        firstSpace === "mixed" ||
        secondSpace === "mixed" ||
        (firstSpace !== null && secondSpace !== null && firstSpace !== secondSpace)
      ) {
        issues.push({
          code: "physical_relation_mixed_coordinate_spaces",
          message: `${predicate} relation between ${entity.id} and ${surface.id} mixes coordinate spaces`,
          severity: "fatal",
          entityIds: [entity.id, surface.id],
        });
        return;
      }
      const firstLength = Math.hypot(first.x, first.y);
      const secondLength = Math.hypot(second.x, second.y);
      if (firstLength <= 1e-9 || secondLength <= 1e-9) return;
      const residual = predicate === "parallel"
        ? Math.abs(first.x * second.y - first.y * second.x) / (firstLength * secondLength)
        : Math.abs(first.x * second.x + first.y * second.y) / (firstLength * secondLength);
      if (residual > 0.04) {
        issues.push({
          code: "physical_direction_relation_failed",
          message: `${entity.id} must be ${predicate} to ${surface.id}`,
          severity: "fatal",
          entityIds: [entity.id, surface.id],
          residual,
        });
      }
    };

    vectors
      .filter((entity) => /\bnormal(?:\s+(?:force|reaction))?\b/.test(semanticText(entity.id)))
      .forEach((entity) => verifyDirectionRelation(entity, "perpendicular"));
    vectors
      .filter((entity) => /\bfriction\b/.test(semanticText(entity.id)))
      .forEach((entity) => verifyDirectionRelation(entity, "parallel"));
  }

  const planEvidence = [
    ...plan.lawIds,
    ...plan.qualitativeClaims.flatMap((claim) => [claim.id, claim.claim, String(claim.expected)]),
  ].join(" ").toLowerCase();
  const expectedOrientation = /\bcounter[- ]?clockwise\b/.test(planEvidence)
    ? "counterclockwise"
    : /\bclockwise\b/.test(planEvidence)
      ? "clockwise"
      : null;
  if (expectedOrientation) {
    const orientationSubjects = [
      /\bcurrent\b/.test(planEvidence) ? /\bcurrent\b/ : null,
      /\b(?:path|cycle|loop)\b/.test(planEvidence) ? /\b(?:path|cycle|loop)\b/ : null,
      /\bprocess\b/.test(planEvidence) ? /\bprocess\b/ : null,
      /\b(?:circulation|field)\b/.test(planEvidence) ? /\b(?:circulation|field)\b/ : null,
    ].filter((pattern): pattern is RegExp => pattern !== null);
    const carriesOrientationSubject = (semantic: string) =>
      orientationSubjects.length > 0
        ? orientationSubjects.some((pattern) => pattern.test(semantic))
        : /\b(?:current|path|cycle|loop|process|circulation)\b/.test(semantic);
    const cycleEdges = vectors.flatMap((entity) => {
      const construction = constructions.get(entity.id);
      const start = construction?.inputs.start;
      const end = construction?.inputs.end;
      return carriesOrientationSubject(semanticText(entity.id)) &&
        typeof start === "string" &&
        typeof end === "string"
        ? [{ entityId: entity.id, start, end }]
        : [];
    });
    if (cycleEdges.length >= 3) {
      const byStart = new Map<string, typeof cycleEdges>();
      for (const edge of cycleEdges) {
        byStart.set(edge.start, [...(byStart.get(edge.start) ?? []), edge]);
      }
      const ordered: typeof cycleEdges = [];
      const used = new Set<string>();
      let current = cycleEdges[0]!;
      const firstStart = current.start;
      while (!used.has(current.entityId)) {
        ordered.push(current);
        used.add(current.entityId);
        const next = (byStart.get(current.end) ?? [])
          .find((candidate) => !used.has(candidate.entityId));
        if (!next) break;
        current = next;
      }
      const closes = ordered.length === cycleEdges.length &&
        ordered.at(-1)?.end === firstStart;
      if (!closes) {
        issues.push({
          code: "directed_cycle_not_closed",
          message: `The claimed ${expectedOrientation} path is not one closed directed cycle`,
          severity: "fatal",
          entityIds: cycleEdges.map((edge) => edge.entityId),
        });
      } else {
        const points = ordered.map((edge) => pointForEntity(edge.start, constructions));
        if (points.every((point): point is { x: number; y: number } => point !== null)) {
          const twiceArea = points.reduce((sum, point, index) => {
            const next = points[(index + 1) % points.length]!;
            return sum + point.x * next.y - next.x * point.y;
          }, 0);
          const orientation = twiceArea < 0 ? "clockwise" : "counterclockwise";
          if (Math.abs(twiceArea) <= 1e-12 || orientation !== expectedOrientation) {
            issues.push({
              code: "directed_cycle_orientation_failed",
              message: `The directed path must be ${expectedOrientation}`,
              severity: "fatal",
              entityIds: cycleEdges.map((edge) => edge.entityId),
              expected: expectedOrientation,
              actual: Math.abs(twiceArea) <= 1e-12 ? "degenerate" : orientation,
              residual: twiceArea,
            });
          }
        }
      }
    }
  }
  return issues;
}

function validatePageNormalDirections(
  document: SceneDocument,
  plan: TurnPlanV3,
  constructions: Map<string, SceneDocument["constructions"][number]>,
): SceneIssue[] {
  const requirements: Array<{
    aliases: string[];
    subjectTokens: string[];
    direction: "into" | "out";
    source: string;
  }> = [];
  const claimedAliases = new Set<string>();
  const directionFrom = (text: string): "into" | "out" | null => {
    if (/\binto\s+(?:the\s+)?(?:page|screen|plane)\b|(?:^|\W)-\s*(?:z|k)(?:\W|$)/i.test(text)) {
      return "into";
    }
    if (/\bout\s+of\s+(?:the\s+)?(?:page|screen|plane)\b|(?:^|\W)\+\s*(?:z|k)(?:\W|$)/i.test(text)) {
      return "out";
    }
    return null;
  };
  const addRequirement = (aliases: string[], source: string, requireLocalAlias = false) => {
    const direction = directionFrom(source);
    const directionMatch = source.match(
      /\b(?:into\s+(?:the\s+)?(?:page|screen|plane)|out\s+of\s+(?:the\s+)?(?:page|screen|plane))\b|(?:^|\W)[+-]\s*(?:z|k)(?:\W|$)/i,
    );
    const localTokens = new Set(normalizeSemanticTokens(directionMatch
      ? source.slice(Math.max(0, (directionMatch.index ?? 0) - 56),
          Math.min(source.length, (directionMatch.index ?? 0) + directionMatch[0].length + 16))
      : source));
    const groundedAliases = requireLocalAlias
      ? aliases.filter((alias) => normalizeSemanticTokens(alias).some((token) => localTokens.has(token)))
      : aliases;
    const normalized = groundedAliases.flatMap(normalizeSemanticTokens);
    if (!direction || normalized.length === 0 || normalized.some((alias) => claimedAliases.has(alias))) return;
    normalized.forEach((alias) => claimedAliases.add(alias));
    const subjectTokens = [...localTokens].filter((token) =>
      token.length > 1 &&
      !/^\d/.test(token) &&
      ![
        "the", "a", "an", "of", "to", "is", "are", "was", "be", "uniform",
        "directed", "direction", "pointing", "points", "into", "out", "page",
        "screen", "plane", "positive", "negative", "plus", "minus", "along",
      ].includes(token),
    );
    requirements.push({ aliases: groundedAliases, subjectTokens, direction, source });
  };

  for (const given of plan.givens) {
    if (given.sourceText) addRequirement([given.id, given.symbol], given.sourceText);
  }
  for (const claim of plan.qualitativeClaims) {
    const aliases = [
      ...(claim.relatedEntityHints ?? []),
      ...(claim.relatedQuantityIds ?? []).flatMap((id) => {
        const quantity = [...plan.givens, ...plan.derived].find((candidate) => candidate.id === id);
        return quantity ? [quantity.id, quantity.symbol] : [id];
      }),
    ];
    addRequirement(aliases, claim.claim, true);
  }

  const issues: SceneIssue[] = [];
  for (const requirement of requirements) {
    const aliases = new Set(requirement.aliases.flatMap(normalizeSemanticTokens));
    const matching = document.entities.filter((entity) => {
      const construction = constructions.get(entity.id);
      if (construction?.operator !== "vector" && construction?.operator !== "label") return false;
      const idTokens = normalizeSemanticTokens(entity.id);
      const labelTokens = normalizeSemanticTokens(entity.label ?? "");
      const tokens = new Set(normalizeSemanticTokens([
        entity.id,
        entity.role,
        entity.label,
        typeof construction?.inputs.symbol === "string" ? construction.inputs.symbol : "",
      ].filter(Boolean).join(" ")));
      const aliasMatch = [...aliases].some((alias) => alias.length === 1
        ? idTokens[0] === alias || (labelTokens.length === 1 && labelTokens[0] === alias)
        : tokens.has(alias));
      const subjectMatch = requirement.subjectTokens.length > 0 &&
        requirement.subjectTokens.some((token) => tokens.has(token));
      return aliasMatch || subjectMatch;
    });
    const expectedMarks = requirement.direction === "into" ? new Set(["×", "⊗"]) : new Set(["•", "⊙"]);
    const correctlyMarked = matching.some((entity) => {
      const construction = constructions.get(entity.id);
      return construction?.operator === "label" &&
        typeof construction.inputs.text === "string" &&
        expectedMarks.has(construction.inputs.text.trim());
    });
    if (correctlyMarked) continue;
    const inPlane = matching.filter((entity) => constructions.get(entity.id)?.operator === "vector");
    issues.push({
      code: inPlane.length > 0
        ? "physical_page_normal_rendered_in_plane"
        : "physical_page_normal_direction_not_proven",
      message: inPlane.length > 0
        ? `${inPlane.map((entity) => entity.id).join(", ")} is page-normal in the plan but was rendered as an in-plane arrow`
        : `${requirement.aliases.join("/")} must use a ${requirement.direction === "into" ? "cross" : "dot"} page-normal marker`,
      severity: "fatal",
      entityIds: matching.map((entity) => entity.id),
      expected: requirement.direction,
      actual: matching.length === 0 ? "missing" : "wrong marker",
    });
  }
  return issues;
}

function coordinateSpaceForEntity(
  entityId: string,
  constructions: Map<string, SceneDocument["constructions"][number]>,
  visiting = new Set<string>(),
): "world" | "layout" | "mixed" | null {
  if (visiting.has(entityId)) return null;
  visiting.add(entityId);
  const construction = constructions.get(entityId);
  if (!construction) return null;
  if (construction.operator === "point") {
    const space = construction.inputs.coordinateSpace;
    return space === "world" || space === "layout" ? space : null;
  }
  const spaces = Object.values(construction.inputs)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string" && constructions.has(value))
    .map((value) => coordinateSpaceForEntity(value, constructions, new Set(visiting)))
    .filter((value): value is "world" | "layout" | "mixed" => value !== null);
  if (spaces.length === 0) return null;
  return spaces.every((space) => space === spaces[0]) ? spaces[0]! : "mixed";
}

function directionForEntity(
  entityId: string,
  constructions: Map<string, SceneDocument["constructions"][number]>,
): { x: number; y: number } | null {
  const construction = constructions.get(entityId);
  if (!construction) return null;
  const explicit = construction.inputs.direction;
  if (
    Array.isArray(explicit) &&
    explicit.length >= 2 &&
    typeof explicit[0] === "number" &&
    Number.isFinite(explicit[0]) &&
    typeof explicit[1] === "number" &&
    Number.isFinite(explicit[1])
  ) {
    return coordinateSpaceForEntity(entityId, constructions) === "layout"
      ? { x: explicit[0], y: -explicit[1] }
      : { x: explicit[0], y: explicit[1] };
  }
  const startId = construction.inputs.start;
  const endId = construction.inputs.end;
  if (typeof startId !== "string" || typeof endId !== "string") return null;
  const start = pointForEntity(startId, constructions);
  const end = pointForEntity(endId, constructions);
  return start && end ? { x: end.x - start.x, y: end.y - start.y } : null;
}

function pointForEntity(
  entityId: string,
  constructions: Map<string, SceneDocument["constructions"][number]>,
): { x: number; y: number } | null {
  const construction = constructions.get(entityId);
  if (
    !construction ||
    construction.operator !== "point" ||
    typeof construction.inputs.x !== "number" ||
    !Number.isFinite(construction.inputs.x) ||
    typeof construction.inputs.y !== "number" ||
    !Number.isFinite(construction.inputs.y)
  ) return null;
  return construction.inputs.coordinateSpace === "layout"
    ? { x: construction.inputs.x, y: -construction.inputs.y }
    : { x: construction.inputs.x, y: construction.inputs.y };
}

function pruneUnsupportedMeasuredFragments(text: string, plan: TurnPlanV3): string {
  const pruned = text.replace(measuredValuePattern(), (measurement) => {
    const unsupported = validateSceneQuantityAgreement([], plan, [measurement])
      .some((issue) => issue.code === "displayed_quantity_unverified");
    return unsupported ? "" : measurement;
  });
  return pruned
    .replace(/\s*=\s*$/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractMeasuredValues(text: string): Array<{ value: number; unit: string; tolerance: number }> {
  const values: Array<{ value: number; unit: string; tolerance: number }> = [];
  const pattern = measuredValuePattern();
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]?.replace(/−/g, "-"));
    const unit = match[2]?.trim();
    if (Number.isFinite(value) && unit) {
      values.push({ value, unit, tolerance: displayedNumberTolerance(match[1]!.replace(/−/g, "-")) });
    }
  }
  return values;
}

type ClaimMeasurement = {
  value: number;
  unit: string;
  /** Half a unit in the last written digit: the rounding window. */
  tolerance: number;
  /** Significant figures written in the claim's number. */
  significantFigures?: number;
};

type ClassifiedClaimMeasurement = ClaimMeasurementKind & {
  /** Where the number (with its unit) sits in the claim text. */
  index: number;
  length: number;
};

type ClaimMeasurementKind =
  | {
    kind: "linked";
    measurement: ClaimMeasurement;
    quantities: Record<string, unknown>[];
    /** Named in prose rather than by symbol, so it states a size and may drop the sign. */
    magnitude?: boolean;
  }
  /** Stated for something the claim names that is not a linked quantity. */
  | { kind: "other"; measurement: ClaimMeasurement }
  /** No subject, or a description that names no linked quantity. */
  | { kind: "unattributed"; measurement: ClaimMeasurement };

const CLAIM_MEASURED_VALUE = new RegExp(
  String.raw`(${NUMBER_SOURCE})${POWER_OF_TEN_SOURCE}\s*([A-Za-zΩΩ°µμ][A-Za-z0-9ΩΩ°µμ/^²³¹⁰⁻·⋅*]*)(?=\s|$|[,;).!?:])`,
  "gu",
);

/**
 * Every number with a physical unit in claim or question prose: any unit the
 * plan's unit parser reads (mA, µT, kg, kPa, m/s², ...) plus angles. A
 * trailing word that does not parse as a unit is not one ("12 times").
 */
function claimMeasuredValues(text: string): Array<ClaimMeasurement & { index: number; length: number }> {
  const values: Array<ClaimMeasurement & { index: number; length: number }> = [];
  for (const match of text.matchAll(CLAIM_MEASURED_VALUE)) {
    if (match.index === undefined) continue;
    const unit = match[4]!;
    const canonical = claimCanonicalMeasurement(0, unit);
    if (!canonical || canonical.dimension === "dimensionless" || !isClaimUnit(unit)) continue;
    const mantissa = match[1]!.replace(/−/g, "-");
    const exponentText = match[2] ?? (match[3] ? superscriptInteger(match[3]) : null);
    const exponent = exponentText === null ? 0 : Number(exponentText.replace(/−/g, "-"));
    const value = Number(mantissa) * 10 ** exponent;
    if (!Number.isFinite(value)) continue;
    values.push({
      value,
      unit,
      tolerance: displayedNumberTolerance(mantissa.replace(/^[+-]/, "")) * 10 ** exponent,
      significantFigures: writtenSignificantFigures(mantissa),
      index: match.index,
      length: match[0].length,
    });
  }
  return values;
}

/** "483.6" has 4, "0.032" has 2, "480" has 3 (a written integer's zeros count). */
function writtenSignificantFigures(mantissa: string): number {
  const digits = mantissa.replace(/^[+\-−]/, "").replace(".", "").replace(/^0+/, "");
  return digits.length;
}

/**
 * A claim states a number at its own precision. It matches a quantity when
 * it is the quantity rounded at that precision ("≈ 484 m/s" for 483.67), or,
 * for a number written to at least three significant figures, the quantity
 * truncated there ("483 m/s", "483.6 m/s" for 483.67): one unit in the last
 * written place, toward zero, at most 1% of the number. Nothing looser: "480"
 * or "480.0" is not 483.67, and two figures never truncate (12 is not 12.9).
 */
function claimMatchesAtStatedPrecision(
  quantityValue: number,
  quantityUnit: unknown,
  measurement: ClaimMeasurement,
): boolean {
  if (claimEquivalentMeasuredQuantity(
    quantityValue,
    quantityUnit,
    measurement.value,
    measurement.unit,
    measurement.tolerance,
  )) return true;
  if ((measurement.significantFigures ?? 0) < CLAIM_TRUNCATION_MIN_FIGURES || measurement.value === 0) return false;
  const quantity = claimCanonicalMeasurement(quantityValue, quantityUnit);
  const stated = claimCanonicalMeasurement(measurement.value, measurement.unit);
  const lastPlace = claimCanonicalMeasurement(2 * measurement.tolerance, measurement.unit);
  if (!quantity || !stated || !lastPlace || quantity.dimension !== stated.dimension) return false;
  if (Math.sign(quantity.value) !== Math.sign(stated.value)) return false;
  const size = Math.abs(quantity.value);
  const statedSize = Math.abs(stated.value);
  const slack = canonicalMeasurementComparisonSlack(size, statedSize);
  return size >= statedSize - slack && size < statedSize + Math.abs(lastPlace.value) - slack;
}

const CLAIM_TRUNCATION_MIN_FIGURES = 3;

function isClaimUnit(unit: string): boolean {
  const normalized = normalizeUnit(unit);
  if (normalized === "degree" || normalized === "radian") return true;
  return claimUnitScale(unit) !== null;
}

function claimUnitScale(unit: unknown): UnitScale | null {
  if (typeof unit !== "string" || unit.trim() === "") return null;
  const normalized = normalizeUnit(unit);
  const alias = normalized === "ohm" ? "Ω" : normalized === "v" ? "V" : normalized === "a" ? "A" : null;
  return unitScale(unit) ?? (alias ? unitScale(alias) : null);
}

/**
 * Claim values compare on the plan's unit parser, so 120 mA and 0.12 A are
 * one current and 314 µT and 0.314 mT one field; angles keep the
 * degree/radian path.
 */
function claimCanonicalMeasurement(value: number, unit: unknown): { value: number; dimension: string } | null {
  const normalized = normalizeUnit(unit);
  if (normalized === "degree" || normalized === "radian") return canonicalMeasurement(value, unit);
  const scale = claimUnitScale(unit);
  if (!scale || !Number.isFinite(value)) return canonicalMeasurement(value, unit);
  return { value: value * scale.factor, dimension: scale.signature === "" ? "dimensionless" : scale.signature };
}

/**
 * A claim may mention many numbers (a condition such as "refracted angle 90°",
 * an intermediate such as "mg = 50 N", a signed coordinate). Each number is
 * classified by what the claim states it is:
 * - linked: the head of an equality chain is a linked quantity's symbol or id
 *   ("I_L = V/R = 21/11 ≈ 1.91 A"), or a copula ("is", "equals", ...) whose
 *   subject ends with the symbol, or whose descriptive subject contains every
 *   word of the quantity's id or of the claim's own id ("The refracted angle
 *   is about 28.1°" under claim id refracted_angle), or whose noun phrase
 *   heads on the quantity's name across prepositions ("The image distance of
 *   the mirror is 12 cm"), or a number that directly follows the quantity's
 *   name ("gives an image distance of about 12 cm");
 * - other: the head is another symbol or an expression ("mg = 49 N");
 * - unattributed: anything else ("the image is located 12 cm behind").
 */
function classifyClaimMeasurements(
  text: string,
  linkedQuantities: Record<string, unknown>[],
  claimId: string,
  planSymbols: ReadonlySet<string> = new Set(),
): ClassifiedClaimMeasurement[] {
  const classified: ClassifiedClaimMeasurement[] = [];
  const names = (values: unknown[]) => values
    .filter((name): name is string => typeof name === "string")
    .map(descriptiveWords)
    .filter((nameWords) => nameWords.length > 0);
  const namedBy = (phrase: string) => {
    const phraseWords = new Set(descriptiveWords(phrase));
    return linkedQuantities.filter((quantity) =>
      names([quantity.id, quantity.symbol]).some((nameWords) => nameWords.every((word) => phraseWords.has(word))));
  };
  for (const found of claimMeasuredValues(text)) {
    const measurement = { value: found.value, unit: found.unit, tolerance: found.tolerance, significantFigures: found.significantFigures };
    const push = (entry: ClaimMeasurementKind) =>
      classified.push({ ...entry, index: found.index, length: found.length });
    const prefix = text.slice(0, found.index);
    // The tail of a larger number ("90/11 V", "7.0e6 m", "2/5 m R^2") is
    // not a measured value on its own.
    if (/[A-Za-z0-9_.^/]$/.test(prefix)) continue;
    if (claimNumberIsFormulaOperand(text, found, planSymbols)) {
      push({ kind: "other", measurement });
      continue;
    }
    const subject = claimMeasurementSubject(prefix);
    if (!subject) {
      const bound = CLAIM_FUNCTION_ARGUMENT.test(prefix) ||
        CLAIM_COMPARISON_BEFORE.test(prefix) ||
        CLAIM_COMPARISON_AFTER.test(text.slice(found.index + found.length));
      if (bound) {
        push({ kind: "other", measurement });
        continue;
      }
      const described = describedClaimQuantities(prefix, linkedQuantities);
      push(described.length > 0
        ? { kind: "linked", measurement, quantities: described, magnitude: true }
        : { kind: "unattributed", measurement });
      continue;
    }
    if (subject.kind === "expression" || CLAIM_OPERAND_AFTER.test(text.slice(found.index + found.length))) {
      push({ kind: "other", measurement });
      continue;
    }
    const bySymbol = (key: string) => linkedQuantities.filter((quantity) =>
      quantityMatchKeys(quantity).has(normalizeClaimSubjectKey(key)));
    let quantities: Record<string, unknown>[] = [];
    if (subject.kind === "symbol") {
      quantities = bySymbol(subject.text);
      if (quantities.length === 0) {
        push({ kind: "other", measurement });
        continue;
      }
    } else {
      const words = subject.text.split(/\s+/).filter(Boolean);
      quantities = bySymbol(words.at(-1) ?? "");
      if (quantities.length === 0) {
        const subjectWords = new Set(descriptiveWords(subject.text));
        const namesSubject = (nameWords: string[]) =>
          nameWords.every((word) => subjectWords.has(word));
        quantities = names([claimId]).some(namesSubject)
          ? linkedQuantities
          : namedBy(subject.text);
      }
      // "The image distance of the mirror is 12 cm": the clause boundary at
      // "of" cut the subject to "the mirror", but the phrase is about its
      // head, the image distance.
      if (quantities.length === 0 && subject.head) quantities = namedBy(subject.head);
      // "magnitude f_k = 6.4 N": the left side of the equation is f_k.
      if (quantities.length === 0 && subject.equationHead && looksLikeSymbol(words.at(-1) ?? "")) {
        push({ kind: "other", measurement });
        continue;
      }
    }
    push(quantities.length > 0
      ? { kind: "linked", measurement, quantities }
      : { kind: "unattributed", measurement });
  }
  return classified;
}

/**
 * Linked quantities whose name the number directly follows, through
 * connectives such as "of about": "gives an image distance of about 12 cm".
 * Only the words right before the number count, so "an image twice the
 * object distance of 15 cm" names the object distance, not the image.
 */
function describedClaimQuantities(
  prefix: string,
  linkedQuantities: Record<string, unknown>[],
): Record<string, unknown>[] {
  const tail = prefix
    .replace(/(?:\s*(?:\b(?:of|about|approximately|roughly|nearly|around|exactly|only|just)\b|[≈~:]))*\s*$/i, "");
  const clause = tail.slice(Math.max(lastClaimBoundaryEnd(tail, CLAIM_SENTENCE_BOUNDARY), 0));
  if (/[0-9+\-*/^()·⋅×=]/.test(clause)) return [];
  const tailWords = descriptiveWords(clause);
  return linkedQuantities.filter((quantity) =>
    [quantity.id, quantity.symbol]
      .filter((name): name is string => typeof name === "string")
      .map(descriptiveWords)
      .some((nameWords) => nameWords.length > 0 && nameWords.length <= tailWords.length &&
        nameWords.every((word, index) => tailWords[tailWords.length - nameWords.length + index] === word)));
}

const CLAIM_CLAUSE_BOUNDARY =
  /[,;:<>≤≥!?]|\.\s|\b(?:and|or|so|but|while|whereas|then|thus|hence|therefore|giving|gives|give|since|because|with|where|which|when|if|at|for|from|to|into|of|in|on|is|are|was|were|equals|by|after|before|than|via|i\.e\.|e\.g\.)\b/gi;

/**
 * The clause boundaries without the prepositions that sit inside a noun
 * phrase: "the image distance of the mirror" is one subject.
 */
const CLAIM_SENTENCE_BOUNDARY =
  /[,;:<>≤≥!?]|\.\s|\b(?:and|or|so|but|while|whereas|then|thus|hence|therefore|giving|gives|give|since|because|with|where|which|when|if|is|are|was|were|equals|after|before|than|i\.e\.|e\.g\.)\b/gi;

/** Prepositions that end the head of a noun phrase ("distance | of the mirror"). */
const CLAIM_NOUN_PHRASE_PREPOSITION =
  /\b(?:of|in|on|at|for|from|to|into|by|via|through|behind|beyond|between|inside|across|along)\b/i;

/** Heads that only wrap the quantity they govern ("the magnitude of the current"). */
const CLAIM_TRANSPARENT_HEADS = new Set(["magnitude", "value", "size", "numerical", "absolute", "measured", "final"]);

function claimMeasurementSubject(prefix: string): ClaimSubject | null {
  const trimmed = prefix.replace(/\s+$/, "");
  if (/[=≈≃≅~]$/.test(trimmed)) {
    const operands = trimmed.slice(0, -1).split(/[=≈≃≅~]/);
    for (let index = operands.length - 1; index >= 0; index -= 1) {
      const operand = operands[index] ?? "";
      const boundary = lastClaimBoundaryEnd(operand);
      if (boundary >= 0 || index === 0) {
        const subject = classifyClaimSubject(operand.slice(Math.max(boundary, 0)));
        return subject && { ...subject, equationHead: true, head: claimNounPhraseHead(operand) };
      }
    }
    return null;
  }
  const copula = trimmed.match(
    /\b(?:is|are|was|were|equals|becomes|be)(?:\s+(?:approximately|about|roughly|nearly|around|exactly|only|just|still|now|also))*$/i,
  );
  if (!copula || copula.index === undefined) return null;
  const before = trimmed.slice(0, copula.index);
  const subject = classifyClaimSubject(before.slice(Math.max(lastClaimBoundaryEnd(before), 0)));
  return subject && { ...subject, head: claimNounPhraseHead(before) };
}

function lastClaimBoundaryEnd(text: string, boundary: RegExp = CLAIM_CLAUSE_BOUNDARY): number {
  let end = -1;
  for (const match of text.matchAll(boundary)) {
    if (match.index !== undefined) end = match.index + match[0].length;
  }
  return end;
}

/**
 * The head of the noun phrase that ends a clause: "The image distance of the
 * mirror" heads on "image distance", "the magnitude of the current in R" on
 * "current". Null when the phrase carries a number or an operator.
 */
function claimNounPhraseHead(text: string): string | null {
  const phrase = text.slice(Math.max(lastClaimBoundaryEnd(text, CLAIM_SENTENCE_BOUNDARY), 0));
  if (/[0-9+\-*/^()·⋅×=]/.test(phrase)) return null;
  for (const segment of phrase.split(new RegExp(CLAIM_NOUN_PHRASE_PREPOSITION.source, "gi"))) {
    const words = descriptiveWords(segment);
    if (words.length === 0) continue;
    if (words.every((word) => CLAIM_TRANSPARENT_HEADS.has(word))) continue;
    return segment.trim();
  }
  return null;
}

type ClaimSubject = {
  kind: "symbol" | "phrase" | "expression";
  text: string;
  /** The left side of an "=" rather than the subject of a copula. */
  equationHead?: boolean;
  /** Head of the whole noun phrase, read across its prepositions. */
  head?: string | null;
};

function classifyClaimSubject(raw: string): ClaimSubject | null {
  const text = raw.trim().replace(/^(?:the|a|an|its|their|this|that|net)\s+/i, "").trim();
  if (text === "") return null;
  // A pronoun names nothing; the number is unattributed, not context.
  if (/^(?:it|this|that|they|these|those|which|what|there|here|result|answer|value)$/i.test(text)) {
    return null;
  }
  if (looksLikeSymbol(text)) return { kind: "symbol", text };
  // Expressions (m1*g, x(3)-x(0)) and fragments carrying other numbers are
  // not the name of a single linked quantity.
  if (/[0-9+\-*/^()·⋅×]/.test(text)) return { kind: "expression", text };
  return { kind: "phrase", text };
}

/**
 * A single token that reads as a symbol (mg, f_k, θ_c, R2, Vth) rather than
 * an English word ("current", "Distance"): marks, digits, Greek, or at most
 * three letters.
 */
function looksLikeSymbol(token: string): boolean {
  if (!/^[A-Za-zΑ-Ωα-ω][\w\u0370-\u03ff₀-₉′'{}\\]*$/u.test(token)) return false;
  return /[_\d\u0370-\u03ff₀-₉′'{}\\]/u.test(token) || token.length <= 3 || !/^[A-Z]?[a-z]+$/.test(token);
}

/**
 * Words that may stand between a discard verb and the number it throws
 * away: "reject the negative root t = -1 s", "discard the other value 3 m".
 * A closed list, so "rejecting the root gives t = 7 s" never reaches 7.
 */
const CLAIM_DISCARD_NOUN_PHRASE =
  String.raw`(?:(?:the|a|an|this|that|its|their|negative|positive|other|second|first|smaller|larger|lower|higher|spurious|extraneous|unphysical|non-?physical|root|roots|value|values|solution|solutions|candidate|candidates)\s+)*`;

/** A number right after a discard verb: "reject t = -1 s", "discarding the negative root -1 s". */
const CLAIM_DISCARD_BEFORE_NUMBER = new RegExp(
  String.raw`\b(?:reject|discard)(?:s|ed|ing)?\s+${CLAIM_DISCARD_NOUN_PHRASE}(?:[A-Za-zΑ-Ωα-ω][\w\u0370-\u03ff₀-₉′']*\s*=\s*)?[-−+]?\s*$`,
  "iu",
);

/**
 * A number right before the wording that discards it: "t = -1 s is
 * rejected", "-1 s (rejected)", "-1 s, which is not physical".
 */
const CLAIM_DISCARD_AFTER_NUMBER =
  /^\s*(?:\(\s*|,\s*which\s+)?(?:(?:is|are|was|were|being|gets|get|must\s+be|should\s+be|can\s+be|has\s+to\s+be|also|hence|therefore|thus|so|clearly)\s+)*(?:rejected|discarded|non-?physical|unphysical|extraneous|inadmissible|not\s+(?:physical|admissible|valid|acceptable|allowed))\b/i;

/**
 * Wording that discards a candidate named only by its sign: "the negative
 * root is rejected", "rejecting the positive solution". Returns the sign it
 * names, or null.
 */
function claimDiscardedSign(text: string): -1 | 1 | null {
  const sign = (word: string | undefined) => (/^neg/i.test(word ?? "") ? -1 : 1);
  const noun = String.raw`(?:root|value|solution|candidate|answer|one)s?`;
  const predicate = String.raw`(?:(?:is|are|was|were|being|must\s+be|should\s+be|can\s+be|has\s+to\s+be)\s+)?(?:rejected|discarded|non-?physical|unphysical|extraneous|inadmissible|not\s+(?:physical|admissible|valid|acceptable|allowed))\b`;
  const subject = text.match(new RegExp(String.raw`\b(negative|positive)\s+${noun}\s+${predicate}`, "i"));
  if (subject) return sign(subject[1]);
  const object = text.match(new RegExp(String.raw`\b(?:reject|discard)(?:s|ed|ing)?\s+(?:the|a|an|this|that|its)\s+(negative|positive)\s+${noun}\b`, "i"));
  return object ? sign(object[1]) : null;
}

/**
 * Wording that discards a candidate named by its place in a list: "the latter
 * is discarded", "the second root is rejected", "the former is not physical",
 * "we discard the other value". Captures the reference word.
 */
const CLAIM_DISCARD_REFERENCE = (() => {
  const reference = String.raw`(latter|former|first|second|other)`;
  const noun = String.raw`(?:\s+(?:root|value|solution|candidate|answer|one)s?)?`;
  const predicate = String.raw`(?:(?:is|are|was|were|being|must\s+be|should\s+be|can\s+be|has\s+to\s+be)\s+)?(?:rejected|discarded|non-?physical|unphysical|extraneous|inadmissible|not\s+(?:physical|admissible|valid|acceptable|allowed))\b`;
  return {
    subject: new RegExp(String.raw`\bthe\s+${reference}${noun}\s+${predicate}`, "gi"),
    object: new RegExp(String.raw`\b(?:reject|discard)(?:s|ed|ing)?\s+the\s+${reference}${noun}\b`, "gi"),
  };
})();

/**
 * Resolve "the latter", "the second root", "the other value" against the
 * ordered numbers the claim lists before that wording (same dimension, same
 * claim text). Returns the one candidate the wording points at, or null when
 * the reference does not pick out exactly one. "The other" names the one of
 * two candidates that is not the quantity's own value, so it resolves only
 * when exactly one of the two is that value.
 */
function claimReferencedDiscards<T extends ClassifiedClaimMeasurement & { text: string }>(
  entry: T,
  siblings: T[],
  isOwnValue: (candidate: T) => boolean,
): T[] {
  const referenced: T[] = [];
  for (const pattern of [CLAIM_DISCARD_REFERENCE.subject, CLAIM_DISCARD_REFERENCE.object]) {
    for (const match of entry.text.matchAll(pattern)) {
      const at = match.index ?? 0;
      const candidates = siblings
        .filter((other) => other.text === entry.text && other.kind !== "other" && other.index + other.length <= at &&
          claimSameDimension(other.measurement.unit, entry.measurement.unit))
        .sort((left, right) => left.index - right.index);
      if (candidates.length < 2) continue;
      const word = (match[1] ?? "").toLowerCase();
      if (word === "latter") referenced.push(candidates[candidates.length - 1]!);
      else if (word === "former" || word === "first") referenced.push(candidates[0]!);
      else if (word === "second") referenced.push(candidates[1]!);
      else if (word === "other" && candidates.length === 2) {
        const own = candidates.filter(isOwnValue);
        if (own.length === 1) referenced.push(candidates.find((candidate) => candidate !== own[0])!);
      }
    }
  }
  return referenced;
}

/**
 * The claim throws this number away as a rejected candidate. Only the
 * number the discard wording is tied to counts: "the negative root t = -1 s
 * is rejected, so the physical answer is t = 7 s" discards -1 s, never 7 s.
 * A candidate named only by its sign ("the negative root is rejected") is
 * discarded when the claim also states the quantity's own value and that
 * value has the other sign. A candidate named by its place in the list ("the
 * latter is discarded") is resolved to that one number.
 */
function claimNumberIsDiscarded<T extends ClassifiedClaimMeasurement & { text: string }>(
  entry: T,
  statedOwnValues: number[],
  siblings: T[] = [],
  isOwnValue: (candidate: T) => boolean = () => false,
): boolean {
  const { text, index, length, measurement } = entry;
  if (CLAIM_DISCARD_BEFORE_NUMBER.test(text.slice(0, index))) return true;
  if (CLAIM_DISCARD_AFTER_NUMBER.test(text.slice(index + length))) return true;
  if (claimReferencedDiscards(entry, siblings, isOwnValue).includes(entry)) return true;
  const sign = claimDiscardedSign(text);
  return sign !== null && Math.sign(measurement.value) === sign && statedOwnValues.length > 0 &&
    statedOwnValues.every((value) => Math.sign(value) === -sign);
}

/**
 * A number followed by an operator ("50 mJ / 5", "2 A + 1 A") is an operand
 * of the arithmetic, not the value the chain states.
 */
const CLAIM_OPERAND_AFTER = /^\s*(?:[/*×·⋅÷^+]|[-−]\s*[\d(.])/;

/**
 * A number that is part of a formula is an operand, not a stated
 * measurement, even when the letters after it spell a unit:
 * - glued to a plan quantity symbol with no space: "2C" in Q²/(2C) is twice
 *   the capacitance C, not two coulombs;
 * - after a multiplication, division or power sign ("Q × 5 V", "x^2 m"), or
 *   before one ("1 C × 1 V");
 * - inside a bracketed group of an equation that is itself an operand: the
 *   bracket is glued to an operand or operator ("Q²/(2 C)", "½(3 m)"), or
 *   the group holds arithmetic of its own ("(2 C + q)").
 * "Q = 2 C", "the charge is 2 C" and "the charge (2 C)" stay measurements.
 */
function claimNumberIsFormulaOperand(
  text: string,
  found: { index: number; length: number; unit: string },
  planSymbols: ReadonlySet<string>,
): boolean {
  const end = found.index + found.length;
  const unitStart = end - found.unit.length;
  const glued = unitStart > found.index && !/\s/.test(text[unitStart - 1] ?? " ");
  if (glued && planSymbols.has(found.unit.replace(/(?:\^\d+|[²³])$/, ""))) return true;
  const before = text.slice(0, found.index);
  if (CLAIM_OPERATOR_BEFORE.test(before) || CLAIM_OPERATOR_AFTER.test(text.slice(end))) return true;
  if (!/[=≈≃≅]/.test(text)) return false;
  const open = innermostOpenBracket(before);
  if (open < 0) return false;
  if (CLAIM_OPERAND_BEFORE_BRACKET.test(before.slice(0, open))) return true;
  const close = text.indexOf(")", end);
  const group = text.slice(open + 1, found.index) + " " + text.slice(end, close < 0 ? text.length : close);
  return /[+*/^×·⋅÷]/.test(group);
}

/** Index of the last "(" in the prefix that is not closed before the number. */
function innermostOpenBracket(prefix: string): number {
  let depth = 0;
  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const char = prefix[index];
    if (char === ")") depth += 1;
    else if (char === "(") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

/** A multiplication, division or power sign, or a bracket glued to one, right before the number. */
const CLAIM_OPERATOR_BEFORE = /(?:[*^×·⋅÷/]\s*|[*^×·⋅÷/]\(\s*)$/;
/** A multiplication, division or power sign right after the number's unit. */
const CLAIM_OPERATOR_AFTER = /^\s*[*^×·⋅÷/]/;
/** A bracket glued to an operand or operator: "/(", "²(", "½(", "x(". */
const CLAIM_OPERAND_BEFORE_BRACKET = /[\p{L}\p{N}_)\]²³½¼¾*^×·⋅÷/+\-−]$/u;

/** A number that is a function argument ("sin(90°)") is not a stated value. */
const CLAIM_FUNCTION_ARGUMENT = /\b(?:sin|cos|tan|sec|csc|cot|asin|acos|atan|arcsin|arccos|arctan|sqrt|log|ln|exp)\s*\(\s*$/i;

/**
 * A number on either side of a comparison ("29.4 N < T", "less than weight
 * 50 N", "exceeding the net displacement of 9 m") is a bound, not the value
 * of the quantity compared with it.
 */
const CLAIM_COMPARISON_BEFORE =
  /(?:[<>≤≥]\s*|\b(?:(?:less|more|greater|smaller|larger|lower|higher|bigger)\s+than|exceed(?:s|ed|ing)?|below|between)\s+)(?:[A-Za-z_][\w']*\s+){0,4}$/i;
const CLAIM_COMPARISON_AFTER = /^\s*(?:[<>≤≥]|(?:is\s+)?(?:less|more|greater|smaller|larger|lower|higher|bigger)\s+than\b)/i;

function normalizeClaimSubjectKey(value: string): string {
  return normalizeNumericBindingKey(value)
    .replace(/[_\s]/g, "")
    .replace(/[₀-₉]/g, (digit) => String(digit.charCodeAt(0) - 0x2080))
    .toLowerCase();
}

function quantityMatchKeys(quantity: Record<string, unknown>): Set<string> {
  return new Set([quantity.id, quantity.symbol]
    .filter((key): key is string => typeof key === "string" && key.trim() !== "")
    .map(normalizeClaimSubjectKey));
}

function descriptiveWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && !["the", "and", "for", "with", "from"].includes(word));
}

/**
 * A quantity whose sign a claim may set by convention: one declared
 * sign: "unsigned", or a given read from the question with no sign (a
 * radius of 20 cm may be written R2 = -20 cm). A derived value with no
 * declared sign is the plan's own signed result.
 */
function isDeclaredMagnitude(quantity: Record<string, unknown>): boolean {
  if (typeof quantity.value !== "number" || quantity.value < 0) return false;
  return quantity.sign === "unsigned" || (quantity.provenance === "given" && quantity.sign === undefined);
}

function isMagnitudeOnlyQuantity(quantity: Record<string, unknown>): boolean {
  return (quantity.sign === undefined || quantity.sign === "unsigned") &&
    typeof quantity.value === "number" && quantity.value >= 0;
}

function measuredValuePattern(): RegExp {
  // Match the whole physical unit, including powers and compound units.
  // Reading only "m" silently missed speed/acceleration labels at the slash.
  const base = String.raw`(?:ohms?|volts?|amps?|deg(?:rees?)?|°|rad(?:ians?)?|[pnumckMGµμ]?(?:mol|Pa|Hz|Wb|eV|[mgsAKNJWCVFHTLΩ]))`;
  const factor = `${base}(?:\\^?-?\\d+|[²³¹⁰⁻]+)?`;
  return new RegExp(`(${NUMBER_SOURCE})\\s*(${factor}(?:\\s*(?:[/·⋅*]|\\s+)\\s*${factor})*)(?=\\s|$|[,;).!?:])`, "gi");
}

function sourceContainsMatchingMeasuredValue(
  sourceText: string,
  expectedValue: number,
  expectedUnit: unknown,
): boolean {
  const unit = normalizeUnit(expectedUnit);
  if (!unit) return false;
  for (const match of sourceText.matchAll(measuredValuePattern())) {
    const value = Number(match[1]?.replace(/−/g, "-"));
    if (
      Number.isFinite(value) &&
      normalizeUnit(match[2]) === unit &&
      Math.abs(value - expectedValue) <= displayedNumberTolerance(match[1]!)
    ) return true;
  }
  return false;
}

function normalizeUnit(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const unit = value.trim().toLowerCase();
  if (unit === "ω" || unit === "ohm" || unit === "ohms") return "ohm";
  if (unit === "v" || unit === "volt" || unit === "volts") return "v";
  if (unit === "a" || unit === "amp" || unit === "amps") return "a";
  if (unit === "deg" || unit === "degree" || unit === "degrees" || unit === "°") return "degree";
  if (unit === "rad" || unit === "radian" || unit === "radians") return "radian";
  return unit;
}

function equivalentMeasuredQuantity(
  firstValue: number,
  firstUnit: unknown,
  secondValue: number,
  secondUnit: unknown,
): boolean {
  const first = canonicalMeasurement(firstValue, firstUnit);
  const second = canonicalMeasurement(secondValue, secondUnit);
  return first !== null && second !== null && first.dimension === second.dimension &&
    canonicalMeasurementValuesAgree(first.value, second.value);
}

/** Floating-point slack scales with the measurement, never with one SI unit. */
function canonicalMeasurementComparisonSlack(first: number, second: number): number {
  return Math.max(Math.abs(first), Math.abs(second)) * 1e-9;
}

function canonicalMeasurementValuesAgree(
  first: number,
  second: number,
  statedPrecisionTolerance = 0,
): boolean {
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(statedPrecisionTolerance)) return false;
  return Math.abs(first - second) <= statedPrecisionTolerance +
    canonicalMeasurementComparisonSlack(first, second);
}

function claimSameDimension(firstUnit: unknown, secondUnit: unknown): boolean {
  const first = claimCanonicalMeasurement(0, firstUnit);
  const second = claimCanonicalMeasurement(0, secondUnit);
  return first !== null && second !== null && first.dimension === second.dimension;
}

function claimEquivalentMeasuredQuantity(
  firstValue: number,
  firstUnit: unknown,
  secondValue: number,
  secondUnit: unknown,
  secondTolerance: number,
): boolean {
  const first = claimCanonicalMeasurement(firstValue, firstUnit);
  const second = claimCanonicalMeasurement(secondValue, secondUnit);
  const tolerance = claimCanonicalMeasurement(secondTolerance, secondUnit);
  return first !== null && second !== null && tolerance !== null &&
    first.dimension === second.dimension && first.dimension === tolerance.dimension &&
    canonicalMeasurementValuesAgree(first.value, second.value, tolerance.value);
}

function equivalentDisplayedMeasuredQuantity(
  firstValue: number,
  firstUnit: unknown,
  secondValue: number,
  secondUnit: unknown,
  secondTolerance: number,
): boolean {
  const first = canonicalMeasurement(firstValue, firstUnit);
  const second = canonicalMeasurement(secondValue, secondUnit);
  const tolerance = canonicalMeasurement(secondTolerance, secondUnit);
  return first !== null && second !== null && tolerance !== null &&
    first.dimension === second.dimension && first.dimension === tolerance.dimension &&
    canonicalMeasurementValuesAgree(first.value, second.value, tolerance.value);
}

function canonicalMeasurement(
  value: number,
  unit: unknown,
): { value: number; dimension: string } | null {
  const normalized = normalizeUnit(unit);
  if (!Number.isFinite(value)) return null;
  if (!normalized) return { value, dimension: "dimensionless" };
  switch (normalized) {
    case "1":
    case "dimensionless":
    case "none":
    case "scalar":
    case "unitless":
      return { value, dimension: "dimensionless" };
    case "degree": return { value: value * Math.PI / 180, dimension: "angle" };
    case "radian": return { value, dimension: "angle" };
    default: {
      const coherent = unitScale(unit);
      return coherent
        ? { value: value * coherent.factor, dimension: coherent.signature === "m^1" ? "length" : coherent.signature || "dimensionless" }
        : { value, dimension: normalized };
    }
  }
}

export type ProofSeverity = "fatal" | "warning";

export interface ProofObligation {
  id: string;
  predicate: string;
  /** Semantic entity IDs and/or quantity IDs depending on predicate. */
  inputs: string[];
  expected?: unknown;
  tolerance?: number;
  severity: ProofSeverity;
  reason?: string;
  evidence?: {
    measured?: unknown;
    residual?: number;
    notes?: string;
  };
}

/** Priority topology predicates for MVP corpus lock-in. */
export const TOPOLOGY_ASSERTION_PREDICATES = [
  "path",
  "pathCount",
  "sameTerminalPair",
  "degree",
  "connected",
  "exists",
  "entity_count",
] as const;

export type TopologyAssertionPredicate = (typeof TOPOLOGY_ASSERTION_PREDICATES)[number];

export type DiagramGenerationStatus =
  | "ready"
  | "retry_required"
  | "not_required"
  | "text_only";

export interface DiagramGenerationResult {
  status: DiagramGenerationStatus;
  turnPlan?: TurnPlanV3 | null;
  /** Accepted scene document when status is ready (v2 transport). */
  sceneDocument?: SceneDocument | null;
  renderScene?: RenderScene | null;
  validationReport?: ValidationReport | null;
  artifacts?: SceneArtifactsV3 | null;
  /** Why retry/text_only was chosen. */
  reason?: string;
  elapsedMs?: number;
}

export interface SceneCandidateArtifactV3 {
  candidateId: string;
  strategy?: string;
  phase: "plan" | "repair";
  accepted: boolean;
  sceneDocument?: SceneDocument | null;
  validationReport: ValidationReport;
  score?: number;
  rejectionCodes?: string[];
}

export interface VisualReviewV3 {
  schemaVersion: "visual-review/v3";
  mode: "shadow" | "gate";
  findings: Array<{
    id: string;
    confidence: number;
    message: string;
    entityIds?: string[];
    region?: { x: number; y: number; width: number; height: number };
  }>;
  /** Shadow findings never flip ready → retry by themselves. */
  wouldReject: boolean;
}

/** The path that produced the representation committed for a turn. */
export const FIGURE_SOURCES = [
  "planner",
  "fast_family",
  "family",
  "archetype",
  "chemistry_family",
  "matrix_source",
  "source_grounded",
  "last_resort",
  "text_only",
  // These lanes bypass the normal planner/family selector and need their own
  // provenance rather than being folded into a misleading family bucket.
  "dsa_trace",
  "verified_recovery",
] as const;

export type FigureSource = (typeof FIGURE_SOURCES)[number];

export interface SceneArtifactsV3 {
  schemaVersion: typeof SCENE_ARTIFACTS_V3_VERSION;
  turnPlan?: TurnPlanV3 | null;
  problemIR?: ProblemIR | null;
  solverResult?: SolverResult | null;
  solverAuthority?: SolverAuthorityAudit | null;
  /** Confidence tier selected for the committed canvas representation. */
  representationTier?: "exact_verified" | "qualitative_verified" | "question_representation";
  /** True when positions communicate relationships only, not physical scale. */
  nonMetric?: boolean;
  /** Which pipeline path produced the committed figure (or text-only result). */
  figureSource?: FigureSource;
  candidates: SceneCandidateArtifactV3[];
  selectedCandidateId?: string | null;
  selectionReason?: string;
  /** Bounded telemetry for an exact scene that was attempted but not committed. */
  degradation?: {
    attemptedTier: "exact_verified";
    reason:
      | "planner_unavailable"
      | "candidate_invalid"
      | "missing_capability"
      | "solver_contradiction"
      | "required_visual_unavailable";
    issueCodes: string[];
    candidateCount: number;
  };
  proofObligations?: ProofObligation[];
  visualReview?: VisualReviewV3 | null;
  diagramResultStatus: DiagramGenerationStatus;
  budgets?: {
    deadlineMs: number;
    planMs?: number;
    candidatesMs?: number;
    repairMs?: number;
    qaMs?: number;
  };
}

/** Target latency and hard deadline are distinct: accuracy may outlive the target. */
export const REQUIRED_DIAGRAM_TARGET_MS = 45_000;
export const REQUIRED_DIAGRAM_DEADLINE_MS = 60_000;

export const REQUIRED_DIAGRAM_BUDGET_MS = {
  plan: 10_000,
  candidates: 22_000,
  repair: 8_000,
  qa: 5_000,
} as const;

/**
 * Feature flags (read by tutor app; documented here for contract clarity).
 * - NEXT_PUBLIC_SCENE_ENGINE_V3_REQUIRED_RETRY — record required-diagram failure
 *   status. Teaching still continues; unverified geometry is not drawn.
 */
export function resolveDiagramFailureStatus(options: {
  visualRequirement: VisualRequirement;
  requiredRetryEnabled: boolean;
}): Extract<DiagramGenerationStatus, "retry_required" | "text_only" | "not_required"> {
  if (options.visualRequirement === "none") return "not_required";
  if (options.visualRequirement === "required" && options.requiredRetryEnabled) {
    return "retry_required";
  }
  return "text_only";
}

export function isRequiredRetryEnabled(
  env: Record<string, string | undefined> = runtimeEnvironment(),
): boolean {
  return env.NEXT_PUBLIC_SCENE_ENGINE_V3_REQUIRED_RETRY !== "0";
}

function runtimeEnvironment(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVisualRequirement(value: unknown): value is VisualRequirement {
  return value === "required" || value === "optional" || value === "none";
}
