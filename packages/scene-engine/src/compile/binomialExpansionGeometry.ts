import { admitFiniteBinomialProblem, displayedFiniteBinomialTerms, finiteBinomialSourceDocument, validateFiniteBinomialSourceDocument } from "../ir/finiteBinomialProgram";
import { exactPolynomialNumber, exactPolynomialText, type FinitePolynomialTerm } from "../math/finitePolynomialExpansion";
import type { RenderPrimitive, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const FINITE_BINOMIAL_OPERATORS = ["finite_polynomial_expansion"] as const;
/** This must come from the caller's turn, not persisted geometry or document flags. */
export interface FiniteBinomialAuthority { question: string; problemIR: unknown; turnPlan?:unknown }
export type FiniteBinomialGeometry =
  | { kind: "finite_polynomial_source"; expression: string; scope: string; answer: string | null }
  | { kind: "finite_polynomial_term"; term: FinitePolynomialTerm; index: number; selected: boolean };

function canonical(value: unknown): string {
  let nodes = 0;
  const visit = (item: unknown, depth: number): string => {
    if (++nodes > 10000 || depth > 64) throw new Error("source geometry exceeds comparison capacity");
    if (Array.isArray(item)) return `[${item.map(child => visit(child, depth + 1)).join(",")}]`;
    if (item && typeof item === "object") return "{" + Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${visit(v, depth + 1)}`).join(",") + "}";
    return JSON.stringify(item);
  };
  return visit(value, 0);
}
function sourceGeometry(authority: FiniteBinomialAuthority): FiniteBinomialGeometry[] {
  if (!authority) throw new Error("caller-owned source authority is required");
  const admission = admitFiniteBinomialProblem(authority.question, authority.problemIR);
  if (admission.status !== "ok") throw new Error(admission.reason);
  const { source } = admission;
  const rows = displayedFiniteBinomialTerms(source.expansion, source.request);
  return [
    { kind: "finite_polynomial_source", expression: source.normalizedExpression,
      scope: source.request.kind === "expansion" ? "All coefficients; nonmetric table" : `Coefficients 0..${source.request.exponent}; higher powers cannot contribute`,
      answer: admission.outputs.length && source.request.kind === "coefficient" ? `coefficient of x^${source.request.exponent}=${exactPolynomialText(admission.outputs[0]!.exact)}` : null },
    ...rows.map((term, index): FiniteBinomialGeometry => ({ kind: "finite_polynomial_term", term, index, selected: source.request.kind === "coefficient" && term.exponent === source.request.exponent })),
  ];
}

/** Compiler-compatible pure evaluator. Raw inputs cannot supply coefficients/labels. */
export function evaluateFiniteBinomialConstruction(operator: string, inputs: Record<string, unknown>, authority: FiniteBinomialAuthority): FiniteBinomialGeometry[] {
  if (operator !== "finite_polynomial_expansion" || !inputs || Object.keys(inputs).sort().join(",") !== "problemIR,question"
    || inputs.question !== authority?.question || canonical(inputs.problemIR) !== canonical(authority?.problemIR)) throw new Error("construction does not bind caller-owned full source IR");
  return sourceGeometry(authority);
}

/** Normalized table coordinates; the parent compiler fits these to its viewport. */
export function finiteBinomialPrimitives(geometry: FiniteBinomialGeometry, entityId: string, groupId: string, authority: FiniteBinomialAuthority): RenderPrimitive[] {
  const expected = sourceGeometry(authority);
  if (!expected.some(candidate => canonical(candidate) === canonical(geometry))) throw new Error("render geometry differs from independently recomputed finite expansion");
  const document = finiteBinomialSourceDocument(authority.question, authority.problemIR)!;
  const index = document.entities.findIndex(entity => entity.id === entityId);
  if (index < 0 || canonical(expected[index]) !== canonical(geometry)
    || !document.revealGroups.some(group => group.id === groupId && group.entityIds.includes(entityId))) throw new Error("render entity/group does not own this source mark");
  const label = (id: string, text: string, x: number, y: number, extra: Record<string, unknown> = {}): RenderPrimitive => ({
    id: `${entityId}_${id}`, entityId, groupId, kind: "label", points: [{ x, y }], text,
    provenance: { nonmetric: true, finitePolynomial: true, ...extra },
  });
  if (geometry.kind === "finite_polynomial_source") {
    return [label("source", geometry.expression, 0, 0), label("scope", geometry.scope, 0, -2),
      ...(geometry.answer ? [label("answer", geometry.answer, 0, -4)] : []), label("headings", "exponent | exact coefficient (nonmetric)", 0, -6)];
  }
  const { term, index: rowIndex, selected } = geometry;
  const rows = expected.filter((row): row is Extract<FiniteBinomialGeometry, { kind: "finite_polynomial_term" }> => row.kind === "finite_polynomial_term");
  const width = Math.max(...rows.map(row => exactPolynomialText(row.term.coefficient).length)) * .8 + 8;
  const x = Math.floor(rowIndex / 8) * width, y = -8 - rowIndex % 8 * 2;
  return [label("exponent", String(term.exponent), x, y, { exponent: term.exponent }),
    label("coefficient", `${selected ? "[" : ""}${exactPolynomialText(term.coefficient)}${selected ? "]" : ""}`, x + 4, y, { exponent: term.exponent, exactCoefficient: term.coefficient, selected })];
}

/** Only a source-selected coefficient row may provide a scalar output label. */
export function finiteBinomialGeometryValue(geometry: FiniteBinomialGeometry, authority: FiniteBinomialAuthority): number | null {
  const expected = sourceGeometry(authority);
  if (!expected.some(candidate => canonical(candidate) === canonical(geometry))) throw new Error("unproved polynomial output geometry");
  return geometry.kind === "finite_polynomial_term" && geometry.selected ? exactPolynomialNumber(geometry.term.coefficient) : null;
}

export function validateFiniteBinomialConstruction(construction: SceneConstruction, index: number, document: SceneDocument, issues: SceneIssue[], authority: FiniteBinomialAuthority): void {
  try {
    const sourceIssues = validateFiniteBinomialSourceDocument(document, authority.question, authority.problemIR);
    if (sourceIssues.length) throw new Error(sourceIssues.map(issue => issue.message).join("; "));
    if (document.constructions[index] !== construction) throw new Error("construction is not the actual candidate producer");
    const outputs = evaluateFiniteBinomialConstruction(construction.operator, construction.inputs, authority);
    if (outputs.length !== construction.outputs.length) throw new Error("incomplete finite expansion output marks");
    for (let i = 0; i < outputs.length; i++) {
      const entityId = construction.outputs[i]!;
      const group = document.revealGroups.find(group => group.entityIds.includes(entityId));
      if (!group) throw new Error("missing source-owned reveal group");
      finiteBinomialPrimitives(outputs[i]!, entityId, group.id, authority);
    }
  } catch (error) {
    issues.push({ code: "invalid_finite_polynomial_expansion", message: error instanceof Error ? error.message : "finite polynomial source proof failed", severity: "fatal", path: `constructions[${index}]`, entityIds: construction.outputs });
  }
}
