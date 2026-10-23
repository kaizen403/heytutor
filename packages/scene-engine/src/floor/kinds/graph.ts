/**
 * Graph floor, from ProblemIR structure only: each function expression the
 * ProblemIR binds to a curve entity of a graph intent (through a shared
 * evidence fact) is plotted exactly, on a window taken from the ProblemIR's
 * own solve domains or a fixed default where the function is continuous. A
 * curve is labelled only with the question's own spelling of its equation;
 * the horizontal axis carries the expression's variable name. No computed
 * point, intercept, region or area is drawn or written.
 */
import { parseMathExpression } from "../../math/expression";
import type { FloorFacts } from "../facts";
import { boundEquationSpellings, functionSource } from "../statedText";
import type { FloorKindBuild } from "./index";
import { emptyParts, floorDocument, floorEntity, obligatedObjects, point } from "./shared";

const WINDOWS: ReadonlyArray<readonly [number, number]> = [[-4, 4], [0, 4], [-4, 0], [-1, 1], [0.25, 4]];

export function buildGraphFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  const problem = facts.problem;
  if (!problem) return null;
  const graphIds = new Set(problem.representationIntents.filter((intent) => intent.kind === "graph").flatMap((intent) => intent.entityIds));
  const curves = problem.entities.filter((entity) => graphIds.has(entity.id) && (entity.kind === "curve" || entity.kind === "line"));
  if (curves.length === 0) return null;
  const plots = curves.flatMap((curve) => {
    const expressions = problem.expressions.filter((expression) => expression.valueType === "function" &&
      expression.evidenceFactIds.some((id) => curve.evidenceFactIds.includes(id)));
    const source = expressions.length === 1 ? functionSource(expressions[0]!.root) : null;
    const spellings = boundEquationSpellings(facts, curve.id);
    return source && source.variable === "x" && spellings.length === 1 ? [{ curve, expression: expressions[0]!, source: source.source, label: spellings[0]! }] : [];
  });
  if (plots.length !== curves.length) return { declined: "a graph curve has no single stated equation bound to it" };
  const unplaced = obligatedObjects(facts).filter((object) => !plots.some((plot) => plot.curve.id === object.id));
  if (unplaced.length > 0) return { declined: `obligated ${unplaced.map((object) => object.id).join(", ")} is not a plotted curve` };
  const parsed = plots.map((plot) => parseMathExpression(plot.source));
  // The ProblemIR's own domain for these expressions, else the first fixed window where every curve is continuous.
  const ids = new Set(plots.map((plot) => plot.expression.id));
  const stated = problem.solveRequests.flatMap((request) =>
    request.kind === "definite_integral" && ids.has(request.expressionId) ? [[request.lower, request.upper] as const]
      : (request.kind === "roots" && ids.has(request.expressionId)) || (request.kind === "intersections" && (ids.has(request.leftExpressionId) || ids.has(request.rightExpressionId)))
        ? [[request.domain.min, request.domain.max] as const] : []);
  const candidates = stated.length === 1 && stated[0]![1] > stated[0]![0] ? [stated[0]!] : WINDOWS;
  const window = candidates.find(([low, high]) => {
    try { parsed.forEach((curve) => curve.assertContinuousOn(low, high)); return true; } catch { return false; }
  });
  if (!window) return { declined: "no window where every stated curve is continuous" };
  const values = parsed.flatMap((curve) => Array.from({ length: 33 }, (_, index) => curve.evaluate(window[0] + ((window[1] - window[0]) * index) / 32)));
  if (values.some((value) => !Number.isFinite(value))) return { declined: "a stated curve leaves the finite range" };
  let low = Math.min(0, ...values), high = Math.max(0, ...values);
  const pad = Math.max(0.5, (high - low) * 0.08);
  low = Math.floor(low - pad); high = Math.ceil(high + pad);

  const built = emptyParts();
  built.entities.push(floorEntity("axes", "axes", "axes for the stated equations", null, { stated: "graph" }));
  built.constructions.push({ id: "draw_axes", operator: "axes", inputs: { xMin: window[0], xMax: window[1], yMin: low, yMax: high }, outputs: ["axes"] });
  if (window[1] > 0) {
    built.entities.push(floorEntity("axis_x_tag", "point", "label anchor point", null, { stated: "axis" }),
      { ...floorEntity("axis_x_name", "label", "x axis name", "x", { stated: "axis" }), provenance: { floor: true, role: "axis_name", axisName: "x" } });
    built.constructions.push(point("axis_x_tag", window[1], 0), { id: "write_axis_x_name", operator: "label", inputs: { target: "axis_x_tag", text: "x" }, outputs: ["axis_x_name"] });
  }
  plots.forEach((plot, index) => {
    const curve = parsed[index]!;
    built.entities.push(floorEntity(plot.curve.id, "polyline", "stated equation", null, { objectId: plot.curve.id }));
    built.constructions.push({ id: `draw_${plot.curve.id}`, operator: "function_curve",
      inputs: { expression: plot.source, variable: "x", xMin: window[0], xMax: window[1], samples: 65 }, outputs: [plot.curve.id] });
    built.assertions.push({ id: `floor_on_${plot.curve.id}`, predicate: "function_value", entities: [plot.curve.id],
      expected: { x: window[0], y: curve.evaluate(window[0]) }, severity: "fatal", reason: "the curve is the stated equation" });
    // The equation is written beside its own curve, where it is farthest from the others.
    const steps = Array.from({ length: 19 }, (_, step) => window[0] + ((window[1] - window[0]) * (step + 1)) / 20)
      .map((x) => ({ x, y: curve.evaluate(x), gap: Math.min(Infinity, ...parsed.filter((_, other) => other !== index).map((other) => Math.abs(other.evaluate(x) - curve.evaluate(x)))) }))
      .filter((candidate) => candidate.y >= low && candidate.y <= high);
    if (steps.length === 0) return;
    const widest = Math.max(...steps.map((candidate) => candidate.gap));
    const anchor = steps.filter((candidate) => candidate.gap >= widest * 0.7).at(-1)!;
    built.entities.push(floorEntity(`${plot.curve.id}_tag`, "point", "label anchor point", null, { objectId: plot.curve.id }),
      floorEntity(`${plot.curve.id}_name`, "label", "stated equation", plot.label, { objectId: plot.curve.id }));
    built.constructions.push(point(`${plot.curve.id}_tag`, anchor.x, anchor.y),
      { id: `write_${plot.curve.id}_name`, operator: "label", inputs: { target: `${plot.curve.id}_tag`, text: plot.label }, outputs: [`${plot.curve.id}_name`] });
  });
  built.groups.push({ id: "floor_graph", entityIds: built.entities.map((entity) => entity.id), cue: "The equations the question states, plotted exactly." });
  return {
    document: floorDocument(facts, "graph", built, "the stated equations, plotted exactly"),
    names: ["x"],
    directedInk: false,
    reason: `${plots.length} stated equation${plots.length === 1 ? "" : "s"} plotted exactly`,
  };
}
