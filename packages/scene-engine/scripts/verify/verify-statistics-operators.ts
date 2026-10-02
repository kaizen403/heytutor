import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument } from "../../src/index";
import { evaluateStatisticsConstruction, validateStatisticsConstruction } from "../../src/compile/statistics";
import type { RenderPoint, RenderPrimitive, SceneDocument } from "../../src/types";

type Bin = { lower: unknown; upper: unknown; frequency: unknown };

const unequalBins: Bin[] = [
  { lower: 0, upper: 2, frequency: 6 },
  { lower: 2, upper: 5, frequency: 9 },
  { lower: 5, upper: 9, frequency: 0 },
];
const numericContext = {
  number: (value: unknown): number => Number(value),
  point: (): RenderPoint => ({ x: 0, y: 0 }),
};
for (const frequency of ["1e-400", "-1e-400", { value: { value: "1e-400" } }]) {
  assert.throws(() => evaluateStatisticsConstruction("histogram", { bins: [{ lower: 0, upper: 1, frequency }], heightMode: "frequency" }, numericContext), undefined,
    "nonzero source frequency literals cannot become an explicit zero-frequency baseline");
}
assert.equal(evaluateStatisticsConstruction("histogram", { bins: [{ lower: 0, upper: 1, frequency: "5e-324" }], heightMode: "frequency" }, numericContext)[0]!.kind, "multi_path",
  "representable tiny source frequency strings retain a nonzero bar before layout");
assert.deepEqual(evaluateStatisticsConstruction("histogram", { bins: [{ lower: 0, upper: 1, frequency: "-0e-400" }], heightMode: "frequency" }, numericContext),
  evaluateStatisticsConstruction("histogram", { bins: [{ lower: 0, upper: 1, frequency: 0 }], heightMode: "frequency" }, numericContext), "explicit zero mantissas retain zero baselines");

const histogram = compile("histogram", { bins: unequalBins, heightMode: "density" });
assert.equal(histogram.length, 3, "one bar or zero baseline per supplied class");
const [firstBar, secondBar, zeroBar] = histogram;
assertClosed(firstBar!);
assertClosed(secondBar!);
assert.equal(zeroBar!.points.length, 2, "zero frequency is a baseline segment");
assert.equal(zeroBar!.points[0]!.y, zeroBar!.points[1]!.y);
const firstWidth = width(firstBar!);
const firstHeight = height(firstBar!);
assertNear(width(secondBar!) / firstWidth, 3 / 2, "class widths remain unequal");
assertNear(height(secondBar!) / firstHeight, 1, "equal density gives equal heights");
assertNear(area(secondBar!) / area(firstBar!), 9 / 6, "bar area encodes frequency");
assertNear(width(zeroBar!) / firstWidth, 4 / 2, "zero class preserves its width");
assertNear(firstBar!.points[1]!.x, secondBar!.points[0]!.x, "neighbor bars touch");

const frequencyBars = compile("histogram", {
  bins: [{ lower: 0, upper: 2, frequency: 6 }, { lower: 2, upper: 4, frequency: 9 }],
  heightMode: "frequency",
});
assertNear(height(frequencyBars[1]!) / height(frequencyBars[0]!), 9 / 6, "equal-width frequency heights");

const polygon = compile("frequency_polygon", { bins: unequalBins, heightMode: "frequency" })[0]!;
assert.equal(polygon.points.length, 3, "no invented closing classes");
assertNear((polygon.points[1]!.x - polygon.points[0]!.x) /
  (polygon.points[2]!.x - polygon.points[1]!.x), 2.5 / 3.5, "vertices use exact class midpoints");
assertNear((polygon.points[2]!.y - polygon.points[1]!.y) /
  (polygon.points[2]!.y - polygon.points[0]!.y), 9 / 6, "frequency polygon heights use frequencies");
const densityPolygon = compile("frequency_polygon", { bins: unequalBins, heightMode: "density" })[0]!;
assert.equal(densityPolygon.points[0]!.y, densityPolygon.points[1]!.y, "density polygon derives f / class width");

const cumulativeBins = [
  { lower: 0, upper: 2, frequency: 2 },
  { lower: 2, upper: 5, frequency: 0 },
  { lower: 5, upper: 9, frequency: 5 },
];
for (const [direction, expected] of [
  ["less_than", [0, 2, 2, 7]],
  ["greater_than", [7, 5, 5, 0]],
] as const) {
  const curve = compile("cumulative_frequency", { bins: cumulativeBins, direction })[0]!;
  assert.equal(curve.points.length, 4, "ogive has all class boundaries including end caps");
  const baseline = direction === "less_than" ? curve.points[0]!.y : curve.points.at(-1)!.y;
  const totalHeight = height(curve);
  curve.points.forEach((point, index) => {
    assertNear((point.x - curve.points[0]!.x) / width(curve), [0, 2 / 9, 5 / 9, 1][index]!, "ogive class boundary");
    assertNear((baseline - point.y) / totalHeight, expected[index]! / 7, "ogive recomputes cumulative frequency");
  });
  assert.equal(curve.points[1]!.y, curve.points[2]!.y, "zero class leaves a cumulative plateau");
}

const quantities: SceneDocument["quantities"] = [
  { id: "lo", value: 0 }, { id: "edge", value: 2 }, { id: "end", value: 5 },
  { id: "f1", value: 6 }, { id: "f2", value: { value: 9 } },
  { id: "scale", value: 2 },
];
const quantityInput = {
  bins: [{ lower: "lo", upper: { value: "edge" }, frequency: "f1" },
    { lower: "edge", upper: "end", frequency: { value: "f2" } }],
  heightMode: "density", xScale: "scale", yScale: { value: "scale" }, origin: "origin",
};
const quantityScene = candidate("histogram", quantityInput, quantities);
addOrigin(quantityScene, 4, 3);
const literalScene = candidate("histogram", {
  bins: unequalBins.slice(0, 2), heightMode: "density", xScale: 2, yScale: 2, origin: "origin",
});
addOrigin(literalScene, 4, 3);
assert.deepEqual(compileCandidate(quantityScene), compileCandidate(literalScene), "quantity references match literals exactly");
assert.deepEqual(compile("histogram", { bins: [{ lower: "0", upper: "2", frequency: { value: "6" } }], heightMode: "density" }),
  compile("histogram", { bins: [{ lower: 0, upper: 2, frequency: 6 }], heightMode: "density" }), "numeric strings and value wrappers resolve deterministically");
assert.deepEqual(compileCandidate(quantityScene), compileCandidate(quantityScene), "repeat compilation is deterministic");

for (const operator of ["histogram", "frequency_polygon", "cumulative_frequency"]) {
  const inputs = operator === "cumulative_frequency" ? { bins: cumulativeBins, direction: "less_than" }
    : { bins: unequalBins, heightMode: "density" };
  const zeros = compile(operator, { ...inputs, bins: unequalBins.map((bin) => ({ ...bin, frequency: 0 })) });
  assert.ok(zeros.every((primitive) => primitive.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))));
  assert.ok(zeros.every((primitive) => height(primitive) === 0), "all-zero distributions remain on the baseline");
}
const capBins = Array.from({ length: 128 }, (_, index) => ({ lower: index, upper: index + 1, frequency: 1 }));
assert.equal(compile("histogram", { bins: capBins, heightMode: "density" }).length, 128, "documented bin cap is accepted");
assert.equal(compile("cumulative_frequency", { bins: [cumulativeBins[0]], direction: "greater_than" })[0]!.points.length, 2);

const invalidInputs: Array<[string, string, Record<string, unknown>, string]> = [
  ["unequal frequency bars", "histogram", { bins: unequalBins, heightMode: "frequency" }, "invalid_statistics_height_mode"],
  ["absent height mode", "histogram", { bins: unequalBins }, "invalid_statistics_height_mode"],
  ["absent direction", "cumulative_frequency", { bins: cumulativeBins }, "invalid_statistics_direction"],
  ["invented relative totals", "cumulative_frequency", { bins: cumulativeBins, direction: "less_than", normalization: "percent" }, "invalid_statistics_input"],
  ["empty bins", "histogram", { bins: [], heightMode: "density" }, "invalid_statistics_bins"],
  ["malformed bin", "histogram", { bins: [null], heightMode: "density" }, "invalid_statistics_bins"],
  ["missing frequency", "histogram", { bins: [{ lower: 0, upper: 2 }], heightMode: "density" }, "invalid_statistics_bins"],
  ["zero width", "histogram", { bins: [{ lower: 2, upper: 2, frequency: 1 }], heightMode: "density" }, "invalid_statistics_bins"],
  ["negative count", "histogram", { bins: [{ lower: 0, upper: 2, frequency: -1 }], heightMode: "density" }, "invalid_statistics_bins"],
  ["non-finite edge", "histogram", { bins: [{ lower: 0, upper: Infinity, frequency: 1 }], heightMode: "density" }, "invalid_statistics_bins"],
  ["non-finite count", "histogram", { bins: [{ lower: 0, upper: 2, frequency: NaN }], heightMode: "density" }, "invalid_statistics_bins"],
  ["overlapping classes", "histogram", { bins: [{ lower: 0, upper: 2, frequency: 1 }, { lower: 1, upper: 3, frequency: 1 }], heightMode: "density" }, "invalid_statistics_bins"],
  ["missing class interval", "histogram", { bins: [{ lower: 0, upper: 2, frequency: 1 }, { lower: 3, upper: 4, frequency: 1 }], heightMode: "density" }, "invalid_statistics_bins"],
  ["descending classes", "histogram", { bins: [...unequalBins].reverse(), heightMode: "density" }, "invalid_statistics_bins"],
  ["too many bins", "histogram", { bins: [...capBins, { lower: 128, upper: 129, frequency: 1 }], heightMode: "density" }, "invalid_statistics_bins"],
  ["single midpoint cannot form polygon", "frequency_polygon", { bins: [unequalBins[0]], heightMode: "frequency" }, "invalid_statistics_bins"],
  ["negative scale", "histogram", { bins: unequalBins, heightMode: "density", xScale: -1 }, "invalid_statistics_scale"],
  ["non-finite scale", "histogram", { bins: unequalBins, heightMode: "density", yScale: Infinity }, "invalid_statistics_scale"],
  ["coordinate overflow", "histogram", { bins: unequalBins, heightMode: "density", xScale: Number.MAX_VALUE }, "invalid_statistics_geometry"],
  ["density overflow", "histogram", { bins: [{ lower: 0, upper: Number.MIN_VALUE, frequency: 1 }], heightMode: "density" }, "invalid_statistics_geometry"],
  ["cumulative overflow", "cumulative_frequency", { bins: [{ lower: 0, upper: 1, frequency: Number.MAX_VALUE }, { lower: 1, upper: 2, frequency: Number.MAX_VALUE }], direction: "less_than" }, "invalid_statistics_geometry"],
  ["unknown quantity", "histogram", { bins: [{ lower: 0, upper: 2, frequency: "missing" }], heightMode: "density" }, "invalid_statistics_bins"],
  ["malformed quantity wrapper", "histogram", { bins: [{ lower: 0, upper: 2, frequency: { quantityId: "f1" } }], heightMode: "density" }, "invalid_statistics_bins"],
];
for (const [name, operator, inputs, code] of invalidInputs) assertRejected(name, candidate(operator, inputs), code);
const invalidOutput = candidate("histogram", { bins: unequalBins, heightMode: "density" });
invalidOutput.entities[0]!.kind = "polygon";
assertRejected("wrong output kind", invalidOutput, "invalid_statistics_output");
const invalidOrigin = candidate("histogram", { bins: unequalBins, heightMode: "density", origin: "diagram" });
assertRejected("non-point origin", invalidOrigin, "invalid_statistics_origin");
const cyclicQuantity = candidate("histogram", { bins: [{ lower: 0, upper: 2, frequency: "cycle" }], heightMode: "density" }, [{ id: "cycle", value: "cycle" }]);
assertRejected("cyclic quantity reference", cyclicQuantity, "invalid_statistics_bins");
for (const frequency of ["1e-400", "-1e-400", { value: { value: "1e-400" } }]) assertRejected("nonzero source frequency underflow", candidate("histogram", { bins: [{ lower: 0, upper: 1, frequency }], heightMode: "frequency" }), "invalid_statistics_bins");
const erasedQuantity = candidate("histogram", { bins: [{ lower: 0, upper: 1, frequency: { value: "tiny_alias" } }], heightMode: "frequency" },
  [{ id: "tiny_source", value: { value: "1e-400" } }, { id: "tiny_alias", value: "tiny_source" }]);
const erasedQuantityIssues: import("../../src/types").SceneIssue[] = [];
validateStatisticsConstruction(erasedQuantity.constructions[0]!, 0, erasedQuantity, new Map(), erasedQuantityIssues);
assert.ok(erasedQuantityIssues.some((issue) => issue.code === "invalid_statistics_bins"), "the statistics validator rejects underflow behind source quantity aliases and wrappers");
assertRejected("quantity-bound source frequency underflow", erasedQuantity, "invalid_statistics_bins");
assertRejected("source class-boundary underflow", candidate("histogram", { bins: [{ lower: "-1e-400", upper: 1, frequency: 1 }], heightMode: "frequency" }), "invalid_statistics_bins");
compile("histogram", { bins: [{ lower: 0, upper: 1, frequency: "-0e-400" }], heightMode: "frequency" });

console.log("statistics operator verification passed: exact density areas, midpoints, cumulative sums, caps, quantity refs, and fail-closed inputs");

function candidate(operator: string, inputs: Record<string, unknown>, quantities: SceneDocument["quantities"] = []): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "deterministic source-data statistical geometry" },
    source: { question: "Represent the supplied frequency distribution" },
    quantities,
    entities: [{ id: "diagram", kind: "polyline", role: "statistical data plot" }],
    constructions: [{ id: "make_diagram", operator, inputs, outputs: ["diagram"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["diagram"],
    revealGroups: [{ id: "plot", entityIds: ["diagram"], dependsOn: [], narrationCue: "read the source distribution" }],
    teachingTimeline: [{ id: "show_plot", action: "reveal", targetId: "plot", dependsOn: [], narrationIntent: "represent the supplied frequencies" }],
  };
}

function addOrigin(document: SceneDocument, x: number, y: number): void {
  document.entities.push({ id: "origin", kind: "point", role: "construction helper point" });
  document.constructions.unshift({ id: "make_origin", operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: ["origin"] });
}

function compile(operator: string, inputs: Record<string, unknown>): RenderPrimitive[] {
  return compileCandidate(candidate(operator, inputs));
}

function compileCandidate(document: SceneDocument): RenderPrimitive[] {
  const validated = validateSceneDocument(document);
  assert.ok(validated.document, `structural acceptance: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document!);
  assert.ok(compiled.ok && compiled.renderScene, `compile acceptance: ${JSON.stringify(compiled.report.issues)}`);
  return compiled.renderScene!.primitives.filter((primitive) => primitive.entityId === "diagram" && primitive.kind !== "label");
}

function assertRejected(name: string, document: SceneDocument, code: string): void {
  const validated = validateSceneDocument(document);
  assert.equal(validated.document, null, `${name} must fail structural validation`);
  assert.ok(validated.report.issues.some((issue) => issue.code === code), `${name}: expected ${code}, got ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(document);
  assert.equal(compiled.ok, false, `${name} must fail compilation`);
  assert.equal(compiled.renderScene, null, `${name} must never leak partial geometry`);
}

function width(primitive: RenderPrimitive): number { return Math.max(...primitive.points.map((point) => point.x)) - Math.min(...primitive.points.map((point) => point.x)); }
function height(primitive: RenderPrimitive): number { return Math.max(...primitive.points.map((point) => point.y)) - Math.min(...primitive.points.map((point) => point.y)); }
function area(primitive: RenderPrimitive): number {
  return Math.abs(primitive.points.reduce((sum, point, index, points) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}
function assertClosed(primitive: RenderPrimitive): void {
  assert.equal(primitive.points.length, 5, "bar has four corners and an explicit closing vertex");
  assert.deepEqual(primitive.points[0], primitive.points.at(-1), "bar boundary remains closed after rendering");
  assert.ok(area(primitive) > 0, "positive frequency bar has positive area");
}
function assertNear(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= 1e-4, `${message}: expected ${expected}, got ${actual}`);
}
