import type { RenderPoint, SceneDocument, SceneIssue } from "../../src/types";
import { VECTOR_OPERATORS, evaluateVectorConstruction, validateVectorConstruction, type VectorEvaluationContext, type VectorGeometry } from "../../src/compile/vectorGeometry";

const geometry = new Map<string, unknown>([
  ["u", { kind: "path", directed: true, points: [{ x: 4, y: -2 }, { x: 7, y: 2 }] }],
  ["v", { kind: "path", directed: true, points: [{ x: -8, y: 1 }, { x: -9, y: 3 }] }],
  ["w", { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] }],
]);
const quantities = new Map<string, number>([["negative_factor", -2], ["origin_x", -4], ["origin_y", 8]]);
const context: VectorEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const number = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
    if (!Number.isFinite(number)) throw new Error("not a finite scalar");
    return number;
  },
  point(value) {
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) return { x: context.number(value.x), y: context.number(value.y) };
    throw new Error("not a point");
  },
  geometry(value) { return typeof value === "string" ? geometry.get(value) : undefined; },
};
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks += 1; if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string, tolerance = 1e-12): void {
  check(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function distance(a: RenderPoint, b: RenderPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
const summed = evaluateVectorConstruction("vector_sum", { vectors: ["u", "v"], origin: { x: 5, y: 6 } }, context)[0]!;
check(summed.kind === "path" && summed.directed, "a nonzero resultant must be a directed arrow");
close(summed.vectorDefinition.components.x, 2, "translated free-vector sum x");
close(summed.vectorDefinition.components.y, 6, "translated free-vector sum y");
close(summed.points[1]!.x, 7, "resultant endpoint x");
close(summed.points[1]!.y, 12, "resultant endpoint y");
close(distance(summed.points[0]!, summed.points[1]!), Math.sqrt(40), "arrow displacement retains resultant magnitude");
const scaled = evaluateVectorConstruction("vector_scale", { vector: "u", factor: -2, origin: { x: -4, y: 8 } }, context)[0]!;
check(scaled.kind === "path", "negative scalar must produce an opposite directed vector");
close(scaled.vectorDefinition.components.x, -6, "negative scalar x");
close(scaled.vectorDefinition.components.y, -8, "negative scalar y");
close(scaled.points[1]!.x, -10, "negative scalar endpoint x");
close(scaled.points[1]!.y, 0, "negative scalar endpoint y");
const zero = evaluateVectorConstruction("vector_scale", { vector: "u", factor: 0, origin: { x: 9, y: 8 } }, context)[0]!;
check(zero.kind === "point" && zero.vectorDefinition.zero, "zero scalar must create a verified zero marker");
const projected = evaluateVectorConstruction("vector_projection", { vector: "u", onto: "w", origin: { x: 7, y: -3 } }, context)[0]!;
check(projected.kind === "path", "nonzero vector projection is a directed arrow");
close(projected.vectorDefinition.components.x, 2.2, "projection x worked oracle");
close(projected.vectorDefinition.components.y, 4.4, "projection y worked oracle");
close(projected.vectorDefinition.projection!.coefficient, 2.2, "projection coefficient");
close(projected.vectorDefinition.projection!.dotProduct, 11, "source dot product");
check(projected.vectorDefinition.exactComponents.x.numerator === "11" && projected.vectorDefinition.exactComponents.x.denominator === "5", "projection must retain exact rational authority through composition");
function scene(): SceneDocument {
  const ids = ["a", "b", "c", "u", "v", "result"];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "verified free-vector arithmetic" }, source: {}, quantities: [],
    entities: ids.map((id, index) => ({ id, kind: index < 3 ? "point" : "vector", role: index < 3 ? "vector endpoint" : "free vector", label: id })),
    constructions: [
      { id: "a_point", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "b_point", operator: "point", inputs: { x: 3, y: 4 }, outputs: ["b"] },
      { id: "c_point", operator: "point", inputs: { x: -1, y: 2 }, outputs: ["c"] },
      { id: "u_vector", operator: "vector", inputs: { start: "a", end: "b" }, outputs: ["u"] },
      { id: "v_vector", operator: "vector", inputs: { start: "a", end: "c" }, outputs: ["v"] },
      { id: "sum_vector", operator: "vector_sum", inputs: { vectors: ["u", "v"], origin: { x: 7, y: 0 } }, outputs: ["result"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "vectors", entityIds: ids, dependsOn: [], narrationCue: "free vector arithmetic" }], teachingTimeline: [],
  };
}
function issues(document: SceneDocument, index = 5): SceneIssue[] {
  const report: SceneIssue[] = [];
  const byOutput = new Map(document.constructions.flatMap((construction) => construction.outputs.map((output) => [output, construction] as const)));
  validateVectorConstruction(document.constructions[index]!, index, document, byOutput, report);
  return report;
}
check(issues(scene()).length === 0, "literal verified free-vector sources must validate");
const notVector = scene();
notVector.entities[3]!.kind = "line";
check(issues(notVector).some((issue) => issue.severity === "fatal"), "a line entity cannot be reinterpreted as a free vector");

function evaluate(operator: string, inputs: Record<string, unknown>): VectorGeometry {
  const result = evaluateVectorConstruction(operator, inputs, context);
  check(result.length === 1, "vector operator arity");
  return result[0]!;
}
function rejects(operator: string, inputs: Record<string, unknown>, message: string): void {
  let rejected = false;
  try { evaluateVectorConstruction(operator, inputs, context); } catch { rejected = true; }
  check(rejected, message);
}
geometry.set("sum", summed);
geometry.set("projection", projected);
geometry.set("zero", zero);
geometry.set("x_unit", { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
geometry.set("perpendicular", { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: -4, y: 3 }] });
const negative = evaluate("vector_scale", { vector: "u", factor: -1, origin: { x: 0, y: 0 } });
geometry.set("negative", negative);
const cancellation = evaluate("vector_sum", { vectors: ["u", "negative"], origin: { x: 2, y: 3 } });
check(cancellation.kind === "point" && cancellation.point.x === 2 && cancellation.point.y === 3 && cancellation.vectorDefinition.zero, "opposite vectors must create an exact zero marker at the explicit origin");
const zeroAdded = evaluate("vector_sum", { vectors: ["zero", "u"], origin: { x: 0, y: 0 } });
close(zeroAdded.vectorDefinition.components.x, 3, "verified zero retains sum identity x");
close(zeroAdded.vectorDefinition.components.y, 4, "verified zero retains sum identity y");
const orthogonal = evaluate("vector_projection", { vector: "u", onto: "perpendicular", origin: { x: 9, y: 0 } });
check(orthogonal.kind === "point" && orthogonal.vectorDefinition.zero && orthogonal.vectorDefinition.projection!.dotProduct === 0, "orthogonal projection must be a certified zero");
const zeroProjection = evaluate("vector_projection", { vector: "zero", onto: "w", origin: { x: 0, y: 0 } });
check(zeroProjection.kind === "point" && zeroProjection.vectorDefinition.zero, "projection of zero onto a nonzero basis is zero");
rejects("vector_projection", { vector: "u", onto: "zero", origin: { x: 0, y: 0 } }, "projection onto a zero vector must fail");
const rationalScaled = evaluate("vector_scale", { vector: "projection", factor: 5, origin: { x: 0, y: 0 } });
close(rationalScaled.vectorDefinition.components.x, 11, "rational projection-scale composition x");
close(rationalScaled.vectorDefinition.components.y, 22, "rational projection-scale composition y");
check(rationalScaled.vectorDefinition.exactComponents.x.denominator === "1", "composed rational result must reduce exactly");
const scaledBasis = evaluate("vector_scale", { vector: "w", factor: -5, origin: { x: 0, y: 0 } });
geometry.set("scaled_basis", scaledBasis);
const invariantProjection = evaluate("vector_projection", { vector: "u", onto: "scaled_basis", origin: { x: 0, y: 0 } });
check(JSON.stringify(invariantProjection.vectorDefinition.exactComponents) === JSON.stringify(projected.vectorDefinition.exactComponents), "projection is invariant under nonzero scaling and sign reversal of its basis");
const oneThird = evaluate("vector_scale", { vector: "x_unit", factor: 1 / 3, origin: { x: 0, y: 0 } });
geometry.set("one_third", oneThird);
const threeThirds = evaluate("vector_scale", { vector: "one_third", factor: 3, origin: { x: 0, y: 0 } });
geometry.set("three_thirds", threeThirds);
geometry.set("minus_one", evaluate("vector_scale", { vector: "x_unit", factor: -1, origin: { x: 0, y: 0 } }));
const exactRemainder = evaluate("vector_sum", { vectors: ["three_thirds", "minus_one"], origin: { x: 0, y: 0 } });
check(exactRemainder.kind === "path" && !exactRemainder.vectorDefinition.zero, "composition cannot replace a nonzero rational remainder with a rounded zero");
close(exactRemainder.vectorDefinition.components.x, -(2 ** -54), "binary64 one-third composition remainder", 1e-30);
const referenced = evaluate("vector_scale", { vector: "u", factor: { value: "negative_factor", unit: "1" }, origin: { x: "origin_x", y: { value: "origin_y" } } });
check(JSON.stringify(referenced) === JSON.stringify(scaled), "quantity IDs and wrappers retain deterministic scale geometry");
for (const order of [["u", "v"], ["v", "u"], ["u", "zero", "v"], ["zero", "v", "u"]]) {
  const sum = evaluate("vector_sum", { vectors: order, origin: { x: 0, y: 0 } });
  check(JSON.stringify(sum.vectorDefinition.exactComponents) === JSON.stringify(summed.vectorDefinition.exactComponents), "exact sum is independent of source permutation and zero identities");
}
for (const factor of [-3, 0.001, 9, 1000]) {
  const a = evaluate("vector_scale", { vector: "u", factor, origin: { x: 0, y: 0 } });
  const b = evaluate("vector_scale", { vector: "v", factor, origin: { x: 0, y: 0 } });
  geometry.set("a_scaled", a); geometry.set("b_scaled", b);
  const left = evaluate("vector_sum", { vectors: ["a_scaled", "b_scaled"], origin: { x: 0, y: 0 } });
  const right = evaluate("vector_scale", { vector: "sum", factor, origin: { x: 0, y: 0 } });
  check(JSON.stringify(left.vectorDefinition.exactComponents) === JSON.stringify(right.vectorDefinition.exactComponents), "scalar distributivity must hold through exact source composition");
}
for (const angle of [Math.PI / 2, 0.7, -1.1]) {
  const rotate = (point: RenderPoint): RenderPoint => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
  for (const [id, components] of [["rot_u", { x: 3, y: 4 }], ["rot_v", { x: -1, y: 2 }], ["rot_w", { x: 1, y: 2 }]] as const) geometry.set(id, { kind: "path", directed: true, points: [{ x: 0, y: 0 }, rotate(components)] });
  const rotatedSum = evaluate("vector_sum", { vectors: ["rot_u", "rot_v"], origin: { x: 0, y: 0 } });
  const expectedSum = rotate({ x: 2, y: 6 });
  close(rotatedSum.vectorDefinition.components.x, expectedSum.x, "rotated sum covariance x");
  close(rotatedSum.vectorDefinition.components.y, expectedSum.y, "rotated sum covariance y");
  const rotatedProjection = evaluate("vector_projection", { vector: "rot_u", onto: "rot_w", origin: { x: 0, y: 0 } });
  const expectedProjection = rotate({ x: 2.2, y: 4.4 });
  close(rotatedProjection.vectorDefinition.components.x, expectedProjection.x, "rotated projection covariance x");
  close(rotatedProjection.vectorDefinition.components.y, expectedProjection.y, "rotated projection covariance y");
}
const residual = { x: 3 - projected.vectorDefinition.components.x, y: 4 - projected.vectorDefinition.components.y };
close(residual.x + 2 * residual.y, 0, "projection residual must be perpendicular to its basis");
check(VECTOR_OPERATORS.length === 3, "declared vector operator inventory");

const invalidSources: unknown[] = [
  { kind: "point", point: { x: 0, y: 0 } }, { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
  { kind: "path", points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
  { kind: "path", directed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
  { kind: "path", directed: true, infinite: true, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
  { kind: "path", directed: true, closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
  { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 4 }] },
  { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] },
  { kind: "path", directed: true, points: [{ x: Infinity, y: 0 }, { x: 1, y: 2 }] },
  { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: 1e13, y: 2 }] },
  { kind: "path", directed: true, points: [{ x: 1e12, y: 0 }, { x: 1e12 + 0.001, y: 2 }] },
  { kind: "path", directed: true, spaceLine: {}, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
  { kind: "path", directed: true, spaceFrameId: "frame", points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
  { kind: "path", directed: true, electricField: {}, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
  { kind: "path", directed: true, kinematics: {}, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
  { kind: "path", directed: true, sampledCurve: {}, points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] },
  { ...summed, vectorDefinition: { ...summed.vectorDefinition, components: { x: 99, y: 6 } } },
  { ...summed, vectorDefinition: { ...summed.vectorDefinition, exactComponents: { x: { numerator: "4", denominator: "2" }, y: summed.vectorDefinition.exactComponents.y } } },
  { ...summed, points: [{ x: 5, y: 6 }, { x: 99, y: 99 }] },
];
for (const source of invalidSources) {
  geometry.set("bad", source);
  rejects("vector_sum", { vectors: ["bad"], origin: { x: 0, y: 0 } }, "malformed, protected, or ill-conditioned source cannot be a free vector");
}
for (const inputs of [
  { vectors: [] }, { vectors: Array(33).fill("u") }, { vectors: ["u", null] }, { vectors: ["missing"] },
  { vectors: ["u"], origin: undefined }, { vectors: ["u"], origin: { x: NaN, y: 0 } },
  { vectors: ["u"], origin: { x: 0, y: 0, z: 1 } }, { vectors: ["u"], origin: [0, 0, 1] },
  { vectors: ["u"], origin: { x: true, y: 0 } }, { vectors: ["u"], magnitude: 999 },
  { vectors: ["u"], origin: { x: 1e12, y: 1e12 } },
]) rejects("vector_sum", { vectors: ["u", "v"], origin: { x: 0, y: 0 }, ...inputs }, "malformed vector sum must fail closed");
for (const factor of [NaN, Infinity, null, true, "", " ", 1e6 + 1, { value: 2, unit: "m" }, { value: 2, unit: "N" }, { value: 2, coefficient: 99 }]) rejects("vector_scale", { vector: "u", factor, origin: { x: 0, y: 0 } }, "scale factor contract must fail closed");
rejects("vector_scale", { vector: "u", factor: 1e-4, origin: { x: 1e12, y: 0 } }, "result placement cannot erase or materially distort a small vector");
geometry.set("tiny", { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: Number.MIN_VALUE, y: 0 }] });
rejects("vector_scale", { vector: "tiny", factor: 0.5, origin: { x: 0, y: 0 } }, "nonzero exact scaled values cannot underflow to a claimed zero");
geometry.set("huge", { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: 1e12, y: 0 }] });
rejects("vector_scale", { vector: "huge", factor: 2, origin: { x: 0, y: 0 } }, "vector result coordinate bounds must hold");
geometry.set("small_basis", { kind: "path", directed: true, points: [{ x: 0, y: 0 }, { x: 1e-20, y: 0 }] });
rejects("vector_projection", { vector: "u", onto: "small_basis", origin: { x: 0, y: 0 } }, "projection coefficient verification bound must reject extreme basis conditioning");

for (const unit of ["N", "m/s", "kg*m/s", "m"]) {
  const compatible = scene();
  compatible.quantities = [{ id: "ux", value: 3, unit }, { id: "uy", value: 4, unit }, { id: "vx", value: -1, unit }, { id: "vy", value: 2, unit }];
  compatible.constructions[1]!.inputs = { x: "ux", y: "uy" };
  compatible.constructions[2]!.inputs = { x: "vx", y: "vy" };
  check(issues(compatible).length === 0, "shared length, force, velocity, or momentum component units must validate");
  compatible.quantities[3]!.unit = unit === "m" ? "cm" : "other";
  check(issues(compatible).some((issue) => issue.severity === "fatal"), "known source unit mismatches must reject rather than convert");
}
const factorUnits = scene();
factorUnits.quantities = [{ id: "factor", value: 2, unit: "N" }];
factorUnits.constructions[5] = { id: "scaled", operator: "vector_scale", inputs: { vector: "u", factor: "factor", origin: { x: 7, y: 0 } }, outputs: ["result"] };
check(issues(factorUnits).some((issue) => issue.severity === "fatal"), "quantity-backed dimensionful scale factors must reject");
factorUnits.quantities[0]!.unit = "dimensionless";
check(issues(factorUnits).length === 0, "quantity-backed dimensionless scale factor must validate");
factorUnits.quantities[0]!.value = "factor";
check(issues(factorUnits).some((issue) => issue.severity === "fatal"), "cyclic scale quantities must fail closed");
const missingOutput = scene();
Reflect.deleteProperty(missingOutput.constructions[5]!, "outputs");
const outputIssues: SceneIssue[] = [];
validateVectorConstruction(missingOutput.constructions[5]!, 5, missingOutput, new Map(missingOutput.constructions.slice(0, 5).flatMap((construction) => construction.outputs.map((output) => [output, construction] as const))), outputIssues);
check(outputIssues.some((issue) => issue.code === "invalid_vector_sum_outputs"), "missing output list must reject without throwing");
const derivedOrigin = scene();
derivedOrigin.entities.push({ id: "centroid", kind: "point", role: "derived placement" });
derivedOrigin.requiredEntityIds.push("centroid"); derivedOrigin.revealGroups[0]!.entityIds.push("centroid");
derivedOrigin.constructions.push({ id: "derive_centroid", operator: "triangle_center", inputs: { a: { x: 18, y: 0 }, b: { x: 21, y: 0 }, c: { x: 18, y: 3 }, kind: "centroid" }, outputs: ["centroid"] });
derivedOrigin.constructions[5]!.inputs.origin = "centroid";
check(issues(derivedOrigin).length === 0, "derived verified 2D placement points defer geometry checks without fake coordinates");

if (!process.argv.includes("--geometry-only")) {
  const { compileSceneDocument, validateSceneDocument } = await import("../../src/index");
  for (const candidate of [scene(), derivedOrigin]) {
    const before = JSON.stringify(candidate);
    const validated = validateSceneDocument(candidate);
    check(validated.document, `vector scene invalid: ${JSON.stringify(validated.report.issues)}`);
    const result = compileSceneDocument(candidate);
    check(result.ok && result.renderScene, `vector scene failed: ${JSON.stringify(result.report.issues)}`);
    check(result.renderScene.primitives.some((primitive) => primitive.entityId === "result" && primitive.kind === "vector"), "nonzero arithmetic vector must render an arrow");
    check(JSON.stringify(candidate) === before, "vector compilation must not mutate its input document");
    check(JSON.stringify(result.renderScene) === JSON.stringify(compileSceneDocument(candidate).renderScene), "vector compilation must be deterministic");
  }
  for (const operator of ["vector_scale", "vector_projection"]) {
    const candidate = scene();
    candidate.constructions[5] = { id: "derived_vector", operator, inputs: operator === "vector_scale" ? { vector: "u", factor: -2, origin: { x: 7, y: 0 } } : { vector: "u", onto: "v", origin: { x: 7, y: 0 } }, outputs: ["result"] };
    const result = compileSceneDocument(candidate);
    check(result.ok && result.renderScene, `${operator} live compile failure: ${JSON.stringify(result.report.issues)}`);
  }
  const nullCandidate = scene();
  nullCandidate.constructions[5] = { id: "zero_vector", operator: "vector_scale", inputs: { vector: "u", factor: 0, origin: { x: 7, y: 0 } }, outputs: ["result"] };
  const nullResult = compileSceneDocument(nullCandidate);
  check(nullResult.ok && nullResult.renderScene, `zero vector compile failure: ${JSON.stringify(nullResult.report.issues)}`);
  check(nullResult.renderScene.primitives.some((primitive) => primitive.entityId === "result" && primitive.kind === "point"), "zero free vector must render a point marker");
  check(!nullResult.renderScene.primitives.some((primitive) => primitive.entityId === "result" && primitive.kind === "vector"), "zero free vector cannot render an arbitrary arrow");
  for (const mutation of [{ vectors: [] }, { vectors: ["a"] }, { origin: { x: NaN, y: 0 } }, { vectors: Array(33).fill("u") }, { extra: 99 }]) {
    const candidate = scene(); Object.assign(candidate.constructions[5]!.inputs, mutation);
    const result = compileSceneDocument(candidate);
    check(!result.ok && result.renderScene === null, "invalid vector construction cannot render partial geometry");
  }
}
console.log(`vector operator verification passed (${checks} checks${process.argv.includes("--geometry-only") ? ", geometry only" : ""})`);
