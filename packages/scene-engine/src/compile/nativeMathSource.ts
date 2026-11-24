/** Complete original affine programs, rebuilt inside guide composition.
 * No caller document, renderer, source stamp or arithmetic-only receipt enters.
 */
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { validateSceneDocument } from "../document/validation";
import { selectSourceLinearScalar } from "../ir/linearScalarBinding";
import type { ProblemIR } from "../ir/problemIR";
import type { SolverValue } from "../ir/solver";
import { exactRationalText, exactRationalToNumber, type ExactRational } from "../math/exactRational";
import type { SynthesizedFamilyScene } from "../synthesize/familyScene";
import type { SceneDocument, SceneIssue } from "../types";
import { compileSceneDocument } from "./compiler";
import { evaluateLinearRegionConstruction, type LinearRegionGeometry } from "./linearRegionGeometry";
import { buildLinearSourceDocument, readLinearSourceReferencePoints, validateLinearSourceBinding } from "./linearRegionSource";
import { validateLinearSourcePlan } from "./linearSourceAgreement";

export type NativeMathSourceReplay =
  | { status: "proved"; scene: SynthesizedFamilyScene; resultBounds: Map<string, number> }
  | { status: "unproved"; issues: SceneIssue[] };
const issue = (code: string, message: string): SceneIssue => ({ code, message, severity: "fatal" });
function values(geometry: LinearRegionGeometry): ExactRational[] {
  const solution = geometry.solution;
  if (solution.kind === "number_line_set") return solution.intervals.flatMap(interval =>
    [interval.lower?.value, interval.upper?.value].filter((value): value is ExactRational => value !== undefined));
  if (solution.kind === "linear_system" && solution.intersection) return [solution.intersection.x, solution.intersection.y];
  return [];
}
function sourceResultQuantities(question: string, problem: ProblemIR, geometry: LinearRegionGeometry) {
  const quantities: SceneDocument["quantities"] = [], issues: SceneIssue[] = [];
  const candidates = [...new Map(values(geometry).map(value => [exactRationalText(value), value])).values()];
  const ids = new Set<string>();
  for (const request of problem.solveRequests) {
    const binding = request.resultBinding;
    if (!binding || ids.has(binding.turnPlanQuantityId)) {
      issues.push(issue("guide_math_result_binding_unproved", "Each original affine result requires a unique explicit quantity binding")); continue;
    }
    const selections = candidates.flatMap(exact => {
      const text = exactRationalText(exact);
      const value: SolverValue = { id: `native_${request.id}`, requestId: request.id, valueType: "set",
        approximate: [exactRationalToNumber(exact)], exact: [{ kind: exact.denominator === "1" ? "integer" : "rational", value: text }], errorBound: 0 };
      const selected = selectSourceLinearScalar(problem, request, value, question);
      return selected ? [selected] : [];
    });
    if (selections.length !== 1) {
      issues.push(issue("guide_math_result_source_unproved", "The whole original source, request expression and target must prove exactly one native affine result")); continue;
    }
    const selected = selections[0]!;
    if (typeof selected.value.approximate !== "number") {
      issues.push(issue("guide_math_result_source_unproved", "The native result has no finite scalar projection")); continue;
    }
    ids.add(binding.turnPlanQuantityId);
    quantities.push({ id: binding.turnPlanQuantityId, symbol: binding.symbol, value: selected.value.approximate,
      unit: "1", provenance: "derived", nativeSourceRole: selected.selection.kind,
      nativeSourceSelection: selected.selection, nativeRequestId: request.id, nativeOwnerId: "source_linear_region" });
  }
  return { quantities, issues };
}

/** Null means this whole-source grammar is not applicable. A contradiction or
 * unproved supplied result stays a decline; no quantity roster is trimmed. */
export function rebuildNativeMathSourceScene(input: {
  question: string; plan: TurnPlanV3 | null; problem: ProblemIR | null;
}): NativeMathSourceReplay | null {
  const { question, plan, problem } = input;
  const original = buildLinearSourceDocument(question);
  if (!original) return null;
  try {
    const sourceIssues = [...validateLinearSourceBinding(original), ...validateLinearSourcePlan(question, plan)];
    if (sourceIssues.some(value => value.severity === "fatal")) return { status: "unproved", issues: sourceIssues };
    const construction = original.constructions[0]!;
    const geometry = evaluateLinearRegionConstruction(construction.operator, construction.inputs)[0]!;
    const variables = geometry.input.kind === "number_line_set" ? [geometry.input.variable ?? "x"] : geometry.input.variables ?? ["x", "y"];
    // Literal named positions are source facts even when the plan chose other
    // IDs. Their role and exact value come from the complete original parser.
    const referenceQuantities: SceneDocument["quantities"] = variables.length === 1
      ? readLinearSourceReferencePoints(question, variables).points.map(point => ({
        id: `source_position_${point.label}`, symbol: point.label, value: exactRationalToNumber(point.x), unit: "1",
        provenance: "given", nativeSourceRole: "number_line_position", nativeSourceExact: point.x, nativeOwnerId: "source_linear_region",
      })) : [];
    const results = problem ? sourceResultQuantities(question, problem, geometry) : { quantities: [], issues: [] };
    if (results.issues.length) return { status: "unproved", issues: results.issues };
    const document: SceneDocument = { ...original, quantities: [...referenceQuantities, ...results.quantities] };
    const checked = validateSceneDocument(document);
    if (!checked.document || !checked.report.valid || JSON.stringify(checked.document) !== JSON.stringify(document)) {
      return { status: "unproved", issues: [issue("guide_math_source_document_invalid", "Native affine source must validate with every original part unchanged")] };
    }
    const issues = [...validateLinearSourceBinding(checked.document), ...validateLinearSourcePlan(question, plan)];
    if (issues.some(value => value.severity === "fatal")) return { status: "unproved", issues };
    const compiled = compileSceneDocument(checked.document, { yieldPolicy: "off", figureConsistency: true, linearLabelFontPx: 24 });
    if (!compiled.ok || !compiled.report.valid || !compiled.renderScene?.primitives.length) {
      return { status: "unproved", issues: compiled.report.issues.length ? compiled.report.issues : [issue("guide_math_native_compile_failed", "Native affine compilation could not retain the complete source program")] };
    }
    return { status: "proved", resultBounds: new Map(results.quantities.map(quantity => [quantity.id, 0])),
      scene: { document: checked.document, renderScene: compiled.renderScene, validationReport: compiled.report,
        family: geometry.input.kind === "number_line_set" ? "bounded_region" : "coordinate_figure",
        tier: "exact_verified", nonMetric: false, reason: "Complete original affine program independently recomputed by the native engine" } };
  } catch {
    return { status: "unproved", issues: [issue("guide_math_source_program_unproved", "Complete original affine model, expressions and requested outputs could not be replayed")] };
  }
}
