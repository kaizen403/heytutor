/**
 * Verified Diagram Engine v3 contracts.
 *
 * Narrow first: TurnPlanV3 is scalars + qualitative claims.
 * Full expression-tree CAS and vision-gated ready are deferred.
 */

import { evaluateTopologyAssertion } from "./topology";
import { evaluateMathExpression } from "./expression";
import type { SceneDocument, SceneIssue, ValidationReport, RenderScene } from "./types";
import type { ProblemIR } from "./problemIR";
import type { SolverResult } from "./solver";
import type { SolverAuthorityAudit } from "./solverAuthority";

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

export interface TurnPlanArithmeticReconciliationResult {
  plan: unknown;
  reconciliations: TurnPlanArithmeticReconciliation[];
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
    return { plan: raw, reconciliations: [] };
  }
  const knownUnits = collectPlanUnits(raw);
  const numericBindings = collectNumericBindings(
    Array.isArray(raw.givens) ? raw.givens : [],
  );
  const reconciliations: TurnPlanArithmeticReconciliation[] = [];
  const derived = raw.derived.map((value) => {
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
    );
    if (
      evidence.conflicting ||
      evidence.value === null ||
      approximatelyEqual(evidence.value, value.value)
    ) {
      addNumericBinding(numericBindings, value);
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
      sourceText: replaceTrailingMeasuredValues(
        value.sourceText,
        evidence.value,
        value.unit,
      ),
    };
    if (corrected.sign !== undefined && corrected.sign !== "unsigned") {
      corrected.sign = numericSign(evidence.value);
    }
    addNumericBinding(numericBindings, corrected);
    return corrected;
  });
  if (reconciliations.length === 0) return { plan: raw, reconciliations };
  return {
    plan: { ...raw, derived },
    reconciliations,
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
  const validationBindings = collectNumericBindings(givens);
  derived.forEach((value, index) => {
    if (
      !isRecord(value) ||
      typeof value.value !== "number" ||
      !Number.isFinite(value.value) ||
      typeof value.sourceText !== "string"
    ) {
      addNumericBinding(validationBindings, value);
      return;
    }
    const evidence = evaluateExplicitArithmetic(
      value.sourceText,
      value.unit,
      knownUnits,
      validationBindings,
      false,
      [value.id, value.symbol].filter((key): key is string => typeof key === "string"),
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
      !sourceContainsMatchingMeasuredValue(value.sourceText, value.value, value.unit)
    ) {
      issues.push({
        code: "source_text_value_mismatch",
        path: `derived[${index}].value`,
        message: `declared value ${value.value} disagrees with explicit arithmetic result ${evidence.value}`,
      });
    }
    addNumericBinding(validationBindings, value);
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
      for (const measurement of extractMeasuredValues(value.claim)) {
        const comparable = linkedQuantities.filter((quantity) =>
          typeof quantity.value === "number" &&
          sameMeasurementDimension(quantity.unit, measurement.unit));
        const supported = comparable.some((quantity) =>
          typeof quantity.value === "number" &&
          equivalentDisplayedMeasuredQuantity(
            quantity.value,
            quantity.unit,
            measurement.value,
            measurement.unit,
            measurement.tolerance,
          ),
        );
        if (!supported && comparable.length > 0) {
          issues.push({
            code: "claim_quantity_mismatch",
            path: `${path}.claim`,
            message: `measured claim ${measurement.value} ${measurement.unit} disagrees with its linked quantities`,
          });
        }
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
    const unit = String(value.unit ?? "").trim().toLowerCase();
    if (
      (unit === "" || unit === "none" || unit === "qualitative") &&
      qualitativeOnlyUnknownIds.has(value.id)
    ) return;
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
  if (first.length < 4 || second.length < 4) return false;
  return first.includes(second) || second.includes(first);
}

const QUALITATIVE_DESCRIPTOR_WORDS = new Set([
  "answer", "claim", "direction", "nature", "orientation", "result", "state", "the", "type", "value",
]);

function shareSemanticAnswerAnchor(
  unknown: Record<string, unknown>,
  claim: Record<string, unknown>,
): boolean {
  const words = (values: unknown[]): Set<string> => new Set(values.flatMap((value) =>
    typeof value === "string"
      ? value
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length > 1 && !QUALITATIVE_DESCRIPTOR_WORDS.has(word))
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
}

function evaluateExplicitArithmetic(
  sourceText: string,
  expectedUnit: unknown,
  knownUnits: string[],
  numericBindings: Map<string, number> = new Map(),
  reconcile = false,
  targetKeys: string[] = [],
): ExplicitArithmeticEvidence {
  const results: number[] = [];
  let invalid = false;
  for (const clause of sourceText.split(/[;\n]+/)) {
    const equalityParts = clause.split(/\s*(?:=|≈|≃|≅)\s*/);
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
        results.push(reconcile ? inverseTrigDegrees : stated?.value ?? inverseTrigDegrees);
      }
      continue;
    }
    const solvedTarget = solveExplicitTargetEquation(
      equalityParts,
      clauseTargetKeys,
      knownUnits,
      numericBindings,
      statedIndex,
    );
    if (solvedTarget !== null) {
      if (stated && !reconcile && !withinDisplayedPrecision(solvedTarget, stated)) {
        invalid = true;
      } else {
        results.push(reconcile ? solvedTarget : stated?.value ?? solvedTarget);
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
        if (!stated) {
          results.push(calculated);
        } else if (reconcile || withinDisplayedPrecision(calculated, stated)) {
          results.push(reconcile ? calculated : stated.value);
        } else {
          invalid = true;
        }
        break;
      } catch {
        // Try the next, usually more explicit, equality part.
      }
    }
  }
  if (invalid) return { value: null, conflicting: false, invalid: true };
  if (results.length === 0) return { value: null, conflicting: false, invalid: false };
  const first = results[0]!;
  return results.every((result) => approximatelyEqual(result, first))
    ? { value: first, conflicting: false, invalid: false }
    : { value: null, conflicting: true, invalid: false };
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
  for (const part of equalityParts) {
    if (!/\b(?:asin|acos|atan|arcsin|arccos|arctan)\s*\(/i.test(part)) continue;
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

function solveExplicitTargetEquation(
  equalityParts: string[],
  targetKeys: string[],
  knownUnits: string[],
  numericBindings: Map<string, number>,
  statedIndex: number,
): number | null {
  if (targetKeys.length === 0 || equalityParts.length < 2) return null;
  for (let targetIndex = 0; targetIndex < equalityParts.length; targetIndex += 1) {
    const targetExpression = normalizeTargetNumericExpression(
      equalityParts[targetIndex] ?? "",
      targetKeys,
      knownUnits,
      numericBindings,
    );
    if (!targetExpression) continue;
    const valueIndices = equalityParts
      .map((_, index) => index)
      .filter((index) => index !== targetIndex && index !== statedIndex)
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
    for (const valueIndex of valueIndices) {
      const valueExpression = normalizeExplicitNumericExpression(
        equalityParts[valueIndex] ?? "",
        knownUnits,
        numericBindings,
      );
      if (!valueExpression) continue;
      try {
        const value = evaluateMathExpression(valueExpression, 0);
        if (!Number.isFinite(value)) continue;
        if (targetExpression === "x") return value;
        const solved = solveUniqueEquationValue(targetExpression, value);
        if (solved !== null) return solved;
      } catch {
        // Try a later equality part with more explicit numeric evidence.
      }
    }
  }
  return null;
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
): string | null {
  const targets = new Set(targetKeys.map(normalizeNumericBindingKey).filter(Boolean));
  const placeholder = "TargetVariableQ";
  const assignmentSource = source.replace(
    /^\s*(?:also|and|or|hence|therefore|thus|so)\s+/i,
    "",
  );
  const protectedSource = assignmentSource.replace(
    /[A-Za-zΑ-Ωα-ω_][A-Za-z0-9Α-Ωα-ω_]*/gu,
    (token) => targets.has(normalizeNumericBindingKey(token)) ? placeholder : token,
  );
  if (containsFunctionWrappedTarget(protectedSource, placeholder)) return null;
  let expression = normalizeExplicitNumericExpression(
    protectedSource,
    knownUnits,
    numericBindings,
    placeholder,
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

function normalizeExplicitNumericExpression(
  source: string,
  knownUnits: string[],
  numericBindings: Map<string, number> = new Map(),
  allowedIdentifier?: string,
): string | null {
  let expression = source
    .replace(/[−–]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/√\s*(?=\()/g, "sqrt")
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
  expression = substituteNumericBindings(expression, numericBindings);
  for (const unit of knownUnits) {
    const flags = /^[A-Za-z]+$/.test(unit) && unit.length > 1 ? "gi" : "g";
    expression = expression.replace(
      new RegExp(`${escapeRegExp(unit)}(?=\\s|\\)|\\]|$|[*/+\\-^])`, flags),
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
  return expression;
}

function substituteNumericBindings(
  expression: string,
  numericBindings: Map<string, number>,
): string {
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
      if (exact !== undefined) return `(${exact})`;

      const replacements: number[] = [];
      let cursor = 0;
      while (cursor < token.length) {
        const match = bindings.find(([key]) => token.startsWith(key, cursor));
        if (!match) return token;
        replacements.push(match[1]);
        cursor += match[0].length;
      }
      return replacements.map((value) => `(${value})`).join("*");
    },
  );
}

function collectNumericBindings(values: unknown[]): Map<string, number> {
  const bindings = new Map<string, number>();
  values.forEach((value) => addNumericBinding(bindings, value));
  return bindings;
}

function addNumericBinding(
  bindings: Map<string, number>,
  value: unknown,
): void {
  if (!isRecord(value) || typeof value.value !== "number" || !Number.isFinite(value.value)) return;
  for (const key of [value.id, value.symbol]) {
    if (typeof key !== "string" || key.trim() === "") continue;
    bindings.set(normalizeNumericBindingKey(key), value.value);
  }
  if (typeof value.sourceText === "string") {
    const leftHandSide = value.sourceText.split(/[=≈≃≅]/, 1)[0]?.trim();
    if (leftHandSide && /^[A-Za-zΑ-Ωα-ω][A-Za-z0-9Α-Ωα-ω_{}\\]*$/u.test(leftHandSide)) {
      bindings.set(normalizeNumericBindingKey(leftHandSide), value.value);
    }
  }
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

function fromSuperscriptDigits(value: string): string {
  const digits: Record<string, string> = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  };
  return [...value].map((digit) => digits[digit] ?? "").join("");
}

function collectPlanUnits(plan: Record<string, unknown>): string[] {
  const units = [
    ...(Array.isArray(plan.givens) ? plan.givens : []),
    ...(Array.isArray(plan.derived) ? plan.derived : []),
  ].flatMap((quantity) =>
    isRecord(quantity) && typeof quantity.unit === "string"
      ? unitAliases(quantity.unit)
      : [],
  );
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
    const unit = typeof quantity.unit === "string" ? normalizeUnit(quantity.unit) : null;
    const compatible = planned ?? (numericValue !== null && unit
      ? planQuantities.find((candidate) =>
          equivalentMeasuredQuantity(candidate.value, candidate.unit, numericValue, quantity.unit))
      : undefined);
    if (!planned && compatible) return;
    if (!planned && numericValue !== null && unit && qualitativeEvidence.some((evidence) =>
      equivalentMeasuredQuantity(evidence.value, evidence.unit, numericValue, quantity.unit)
    )) return;
    if (!planned && numericValue !== null && unit) {
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
    unit: normalizeUnit(quantity.unit),
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
    if (!entity.label) return entity;
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
  if (!plan || document.visualDecision.mode !== "scene") return [];

  const evidenceText = [
    ...plan.lawIds,
    ...plan.qualitativeClaims.flatMap((claim) => [claim.id, claim.claim]),
  ].join(" ").toLowerCase();
  const issues = validateSemanticVectorGeometry(document, plan);
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
      if (output === mirrorId && construction.operator === "arc") {
        const centerToVertex = subtractPoint(nextVertex, nextCenter);
        const angle = Math.atan2(centerToVertex.y, centerToVertex.x) * 180 / Math.PI;
        return {
          ...construction,
          inputs: {
            ...construction.inputs,
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
    const value = Number(match[1]);
    const unit = normalizeUnit(match[2]);
    if (Number.isFinite(value) && unit) {
      values.push({ value, unit, tolerance: displayedNumberTolerance(match[1]!) });
    }
  }
  return values;
}

function measuredValuePattern(): RegExp {
  return /(-?\d+(?:\.\d+)?)\s*(ohms?|Ω|volts?|V|amps?|A|mm|cm|km|m|deg|degrees?|°|rad|radians?|Hz|N|J|W)(?=\s|$|[,;).!?:])/gi;
}

function sourceContainsMatchingMeasuredValue(
  sourceText: string,
  expectedValue: number,
  expectedUnit: unknown,
): boolean {
  const unit = normalizeUnit(expectedUnit);
  if (!unit) return false;
  for (const match of sourceText.matchAll(measuredValuePattern())) {
    const value = Number(match[1]);
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
    approximatelyEqual(first.value, second.value);
}

function sameMeasurementDimension(firstUnit: unknown, secondUnit: unknown): boolean {
  const first = canonicalMeasurement(0, firstUnit);
  const second = canonicalMeasurement(0, secondUnit);
  return first !== null && second !== null && first.dimension === second.dimension;
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
    Math.abs(first.value - second.value) <= tolerance.value +
      Math.max(1, Math.abs(first.value), Math.abs(second.value)) * 1e-9;
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
    case "mm": return { value: value * 1e-3, dimension: "length" };
    case "cm": return { value: value * 1e-2, dimension: "length" };
    case "m": return { value, dimension: "length" };
    case "km": return { value: value * 1e3, dimension: "length" };
    case "degree": return { value: value * Math.PI / 180, dimension: "angle" };
    case "radian": return { value, dimension: "angle" };
    default: return { value, dimension: normalized };
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
 * - NEXT_PUBLIC_SCENE_ENGINE_V3_REQUIRED_RETRY — block lesson on required-diagram failure
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
