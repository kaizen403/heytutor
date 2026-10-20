/**
 * The floor's binding audit, run on the compiled render after every other
 * engine check passed. It does not trust the builder. For each rendered text
 * it recomputes, from ProblemIR alone, which texts that exact element may
 * carry: its own ProblemIR name, the values bound to it through a shared
 * evidence fact (spelled as the question writes them), a "?" bound to it by a
 * solve request, or, for a plotted curve, the question's own spelling of the
 * equation bound to it. A value on the wrong part, an invented or solved
 * number, a name the question does not use, or any arrow refuses the whole
 * figure.
 */
import type { ExpressionNodeIR } from "../ir/problemIR";
import type { RenderScene, SceneDocument } from "../types";
import { readFloorBindings } from "./bindings";
import { FLOOR_FIGURE_VERSION, flattenText, type FloorFacts } from "./facts";
import { boundEquationSpellings } from "./statedText";

export interface FloorAuditIssue {
  code: string;
  message: string;
}

export function normaliseLabel(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s*=\s*/g, " = ").trim();
}

/** Asked values a solve request binds to a node or a branch: "V_m = ?". */
export function boundUnknownTexts(facts: FloorFacts, entityId: string): string[] {
  const problem = facts.problem;
  if (!problem) return [];
  return problem.solveRequests.flatMap((request) => {
    if (request.kind !== "dc_network" || request.output.id !== entityId || !request.resultBinding) return [];
    const unknown = facts.plan.unknowns.find((candidate) => candidate.id === request.resultBinding!.turnPlanQuantityId);
    return unknown ? [`${unknown.symbol} = ?`] : [];
  });
}

/** Every text the stated facts let one ProblemIR entity carry. */
export function allowedTextsFor(facts: FloorFacts, entityId: string): Set<string> {
  const allowed = new Set<string>();
  const add = (text: string) => allowed.add(normaliseLabel(text));
  const object = facts.objects.find((candidate) => candidate.id === entityId);
  if (object?.name) add(object.name);
  for (const binding of readFloorBindings(facts)) {
    if (!binding.entityIds.includes(entityId)) continue;
    add(binding.valueText);
    if (object?.name) add(`${object.name} ${binding.valueText}`);
    if (binding.quantity) add(`${binding.quantity.symbol} = ${binding.valueText}`);
  }
  for (const text of boundUnknownTexts(facts, entityId)) {
    add(text);
    if (object?.name) add(`${object.name} ${text}`);
  }
  for (const spelling of boundEquationSpellings(facts, entityId)) add(spelling);
  return allowed;
}

export function freeVariables(root: ExpressionNodeIR): string[] {
  switch (root.kind) {
    case "variable": return [root.name];
    case "unary": return freeVariables(root.operand);
    case "binary": return [...freeVariables(root.left), ...freeVariables(root.right)];
    case "call": return freeVariables(root.argument);
    default: return [];
  }
}

export function auditFloorFigure(
  document: SceneDocument,
  render: RenderScene,
  facts: FloorFacts,
): FloorAuditIssue[] {
  const issues: FloorAuditIssue[] = [];
  const source = document.source as Record<string, unknown>;
  if (source.floorFigure !== FLOOR_FIGURE_VERSION) issues.push({ code: "floor_version", message: "the document is not a floor figure" });
  if (typeof source.question !== "string" || flattenText(source.question) !== flattenText(facts.question)) {
    issues.push({ code: "floor_question", message: "the floor figure was built for a different question" });
  }
  if (source.representationTier !== "question_representation" || source.nonMetric !== true) {
    issues.push({ code: "floor_tier", message: "a floor figure is a nonmetric question representation" });
  }
  if (!facts.problem) issues.push({ code: "floor_without_structure", message: "a floor figure needs a ProblemIR for this question" });
  if (document.quantities.some((quantity) => typeof quantity.value === "number" &&
      !facts.values.some((value) => value.quantityId === quantity.id && value.value === quantity.value))) {
    issues.push({ code: "floor_unstated_quantity", message: "a floor quantity is not a stated given" });
  }
  const entities = new Map(document.entities.map((entity) => [entity.id, entity]));
  for (const entity of document.entities) {
    const provenance = entity.provenance as Record<string, unknown> | undefined;
    if (!provenance || provenance.floor !== true) issues.push({ code: "floor_unsourced_entity", message: `${entity.id} carries no floor provenance` });
  }
  const axisNames = new Set(facts.problem?.expressions.flatMap((expression) =>
    expression.valueType === "function" ? freeVariables(expression.root) : []) ?? []);
  for (const primitive of render.primitives) {
    if (primitive.kind === "vector" || primitive.kind === "ray") {
      issues.push({ code: "floor_analysis_ink", message: `${primitive.kind} ink on ${primitive.entityId}: the floor draws no arrow` });
      continue;
    }
    if ((primitive.kind !== "label" && primitive.kind !== "dimension") || typeof primitive.text !== "string") continue;
    const text = normaliseLabel(primitive.text);
    if (!text) continue;
    const owner = entities.get(primitive.entityId);
    const provenance = (owner?.provenance ?? {}) as Record<string, unknown>;
    const allowed = typeof provenance.objectId === "string" ? allowedTextsFor(facts, provenance.objectId)
      : provenance.role === "axis_name" && typeof provenance.axisName === "string" && axisNames.has(provenance.axisName)
        ? new Set([provenance.axisName]) : new Set<string>();
    if (!allowed.has(text)) {
      issues.push({ code: "floor_unbound_text", message: `"${text}" is not bound to ${String(provenance.objectId ?? primitive.entityId)} by the ProblemIR` });
    }
  }
  return issues;
}
