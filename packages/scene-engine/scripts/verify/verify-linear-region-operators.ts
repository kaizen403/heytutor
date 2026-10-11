import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import {
  compileSceneDocument,
  validateSceneDocument,
  type RenderPoint,
  type RenderPrimitive,
  type CompileResult,
  type SceneDocument,
} from "../../src/index";

// Session-owned public compiler gate. These independently worked numbers are
// separate from the frozen 40-row eval; that corpus is not imported here.
let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks++;
  assert.ok(condition, message);
}

function documentFor(operator: string, inputs: Record<string, unknown>, question: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "A graphical solution is required." },
    source: { question },
    quantities: [],
    entities: [{ id: "solution", kind: "linear_region", role: "solution" }],
    constructions: [{ id: "construct_solution", operator, inputs, outputs: ["solution"] }],
    relations: [], assertions: [], annotations: [],
    requiredEntityIds: ["solution"],
    revealGroups: [{ id: "solution_group", entityIds: ["solution"], dependsOn: [], narrationCue: "graphical solution" }],
    teachingTimeline: [{ id: "reveal_solution", action: "reveal", targetId: "solution_group", dependsOn: [], narrationIntent: "Explain the verified solution." }],
  };
}

/** Independent analytic side check for the first concrete half-plane. */
function assertFirstHalfPlaneFill(worldPolygon: readonly RenderPoint[]): void {
  check(worldPolygon.length >= 3, "a proper half-plane has a nonempty clipped region");
  for (const point of worldPolygon) {
    check(-7 * point.x + 4 * point.y <= 9 + 1e-10,
      `wrong shaded side: (-7x + 4y) at (${point.x}, ${point.y}) exceeds 9`);
  }
}

interface WorldWindow { xMin: number; xMax: number; yMin: number; yMax: number }
interface Exact { numerator: string; denominator: string }
interface ExactPoint { x: Exact; y: Exact }
function record(value: unknown, message: string): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), message);
  return value as Record<string, unknown>;
}
function exact(value: unknown): Exact {
  const result = record(value, "exact authority must be an object");
  check(typeof result.numerator === "string" && /^-?\d+$/.test(result.numerator), "exact numerator must be an integer string");
  check(typeof result.denominator === "string" && /^\d+$/.test(result.denominator) && BigInt(result.denominator) > 0n,
    "exact denominator must be a positive integer string");
  return { numerator: result.numerator, denominator: result.denominator };
}
function exactPoint(value: unknown): ExactPoint {
  const result = record(value, "world point must be an exact pair");
  return { x: exact(result.x), y: exact(result.y) };
}
function numberFromExact(value: unknown): number {
  const rational = exact(value);
  const result = Number(rational.numerator) / Number(rational.denominator);
  check(Number.isFinite(result), "world values used by display checks must be finite");
  return result;
}
function worldPoints(primitive: RenderPrimitive): ExactPoint[] {
  check(Array.isArray(primitive.provenance?.worldPoints), "every checked linear mark must preserve worldPoints");
  return primitive.provenance.worldPoints.map(exactPoint);
}
function numericWorldPoints(primitive: RenderPrimitive): RenderPoint[] {
  return worldPoints(primitive).map((point) => ({ x: numberFromExact(point.x), y: numberFromExact(point.y) }));
}
function exactValueEquals(actual: Exact, numerator: bigint, denominator = 1n): boolean {
  return BigInt(actual.numerator) * denominator === numerator * BigInt(actual.denominator);
}
function linearMarks(result: CompileResult): RenderPrimitive[] {
  check(result.ok && result.renderScene !== null, "source-grounded linear document must compile atomically");
  const marks = result.renderScene.primitives.filter((primitive) => primitive.entityId === "solution");
  check(marks.length > 0, "linear-region output must have visible marks");
  check(marks.every((primitive) => primitive.provenance?.linearSolution !== undefined), "all linear marks retain protected mathematical authority");
  return marks;
}
function viewFor(primitive: RenderPrimitive): WorldWindow {
  const authority = record(primitive.provenance?.linearSolution, "linearSolution provenance must exist");
  const view = record(authority.view, "linearSolution must distinguish its display view");
  return { xMin: numberFromExact(view.xMin), xMax: numberFromExact(view.xMax), yMin: numberFromExact(view.yMin), yMax: numberFromExact(view.yMax) };
}
function atomicallyRefused(document: SceneDocument, message: string, fatalReason?: RegExp): void {
  const result = compileSceneDocument(document);
  check(!result.ok && result.renderScene === null, `${message}: malformed or ungrounded candidate must emit no scene`);
  check(result.report.issues.some((issue) => issue.severity === "fatal"), `${message}: refusal must be fatal`);
  check(!result.report.issues.some((issue) => issue.code === "unsupported_operator"),
    `${message}: mutation must be refused after the valid operator is supported`);
  if (fatalReason) check(result.report.issues.some((issue) => issue.severity === "fatal" && fatalReason.test(`${issue.code}: ${issue.message}`)),
    `${message}: refusal must identify its actual failure (${result.report.issues.map((issue) => issue.message).join("; ")})`);
}
function compiled(operator: string, inputs: Record<string, unknown>, question: string): CompileResult {
  const document = documentFor(operator, inputs, question);
  const validation = validateSceneDocument(document);
  check(validation.document !== null && validation.report.valid,
    `${operator}: source-complete document validates (${validation.report.issues.map((i) => i.message).join("; ")})`);
  const result = compileSceneDocument(document);
  check(result.ok, `${operator}: ${question} must compile (${result.report.issues.map((i) => i.message).join("; ")})`);
  reservedBoundsSvgOracle(result);
  return result;
}
function reservedBoundsSvgOracle(result:CompileResult, renderedSvg?:string):void {
  check(result.ok && result.renderScene!==null,"reserved-bounds check requires a real public render");
  const svg=renderedSvg??renderSceneSvg(result.renderScene);
  const nodes=Array.from(svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g));
  const escaped=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const attribute=(attributes:string,name:string)=>new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes)?.[1];
  for(const label of result.renderScene.primitives.filter((p)=>p.kind==="label" && p.provenance?.linearSolution)) {
    const bounds=record(label.provenance?.labelBounds,"linear text must preserve its reserved layout bounds");
    check([bounds.x,bounds.y,bounds.width,bounds.height].every((v)=>typeof v==="number" && Number.isFinite(v))
      && Number(bounds.width)>4 && Number(bounds.height)>4,"reserved text box must have finite interior space");
    const matching=nodes.filter((node)=>node[2]===escaped(label.text??""));
    check(matching.some((node)=>{
      const attrs=node[1]!, x=Number(attribute(attrs,"x")), y=Number(attribute(attrs,"y")), width=Number(attribute(attrs,"textLength"));
      const anchor=attribute(attrs,"text-anchor");
      return close(x,Number(bounds.x)+2) && close(y,Number(bounds.y)+2)
        && width>0 && width<=Number(bounds.width)-4+1e-9
        && attribute(attrs,"dominant-baseline")==="hanging" && (anchor===undefined || anchor==="start");
    }),"rendered linear glyphs must start at the padded reserved origin and fit its reserved width");
  }
}
function solutionFor(result: CompileResult): Record<string, unknown> {
  const marks = linearMarks(result);
  const authority = record(marks[0]!.provenance?.linearSolution, "protected linear authority exists");
  const serialized = JSON.stringify(authority);
  check(marks.every((p) => JSON.stringify(p.provenance?.linearSolution) === serialized),
    "all marks carry one immutable coherent solution authority");
  return record(authority.solution, "protected mathematical solution exists");
}
type BoundOracle = [numerator: bigint, denominator: bigint, included: boolean] | null;
function intervalOracle(value: unknown, expected: readonly [BoundOracle, BoundOracle], message: string): void {
  const interval = record(value, `${message}: interval`);
  for (const [field, bound] of [["lower", expected[0]], ["upper", expected[1]]] as const) {
    if (bound === null) check(interval[field] === null, `${message}: ${field} must be infinite`);
    else {
      const actual = record(interval[field], `${message}: finite ${field}`);
      check(exactValueEquals(exact(actual.value), bound[0], bound[1]), `${message}: exact ${field} endpoint`);
      check(actual.included === bound[2], `${message}: ${field} inclusion`);
    }
  }
}
function numberLineOracle(result: CompileResult, expected: ReadonlyArray<readonly [BoundOracle, BoundOracle]>): void {
  const solution = solutionFor(result);
  check(solution.kind === "number_line_set", "number-line solution retains its mathematical kind");
  check(Array.isArray(solution.intervals) && solution.intervals.length === expected.length,
    "number-line result has every independent canonical interval and no extras");
  solution.intervals.forEach((interval, i) => intervalOracle(interval, expected[i]!, `number-line interval ${i}`));
  const endpoints = linearMarks(result).filter((p) => p.provenance?.linearRole === "solution_endpoint");
  const finite = expected.flat().filter((bound): bound is Exclude<BoundOracle, null> => bound !== null);
  for (const bound of finite) {
    check(endpoints.some((p) => worldPoints(p).some((point) => exactValueEquals(point.x, bound[0], bound[1]))
      && p.provenance?.pointStyle === (bound[2] ? "filled" : "open")), "finite endpoint has the computed exact value and inclusion style");
  }
  check(endpoints.every((p) => worldPoints(p).every((point) => finite.some((bound) => exactValueEquals(point.x, bound[0], bound[1])))),
    "no finite marker is fabricated for an infinite endpoint");
}
const selectedFamily = process.argv.find((arg) => arg.startsWith("--family="))?.slice("--family=".length);
function selected(family: string): boolean { return selectedFamily === undefined || selectedFamily === family; }
type PointOracle = readonly [xn: bigint, xd: bigint, yn: bigint, yd: bigint];
function pointMatches(value: unknown, expected: PointOracle): boolean {
  const point = exactPoint(value);
  return exactValueEquals(point.x, expected[0], expected[1]) && exactValueEquals(point.y, expected[2], expected[3]);
}
function exactPointOnConstraint(point: ExactPoint, constraint: Record<string, unknown>): boolean {
  const a=exact(constraint.a), b=exact(constraint.b), rhs=exact(constraint.rhs);
  return BigInt(a.numerator)*BigInt(point.x.numerator)*BigInt(b.denominator)*BigInt(point.y.denominator)*BigInt(rhs.denominator)
    + BigInt(b.numerator)*BigInt(point.y.numerator)*BigInt(a.denominator)*BigInt(point.x.denominator)*BigInt(rhs.denominator)
    === BigInt(rhs.numerator)*BigInt(a.denominator)*BigInt(point.x.denominator)*BigInt(b.denominator)*BigInt(point.y.denominator);
}
function noSolidAxisUnderStrictBoundary(result:CompileResult):void {
  const solution=solutionFor(result);
  if(!Array.isArray(solution.constraints))return;
  const strictRows=solution.constraints.map((row)=>record(row,"source row for axis-style check"))
    .filter((row)=>row.strict===true && (BigInt(exact(row.a).numerator)!==0n || BigInt(exact(row.b).numerator)!==0n));
  for(const axis of linearMarks(result).filter((p)=>p.provenance?.linearRole==="axis")) {
    const points=worldPoints(axis);
    for(const row of strictRows)
      check(points.length<2 || !points.every((p)=>exactPointOnConstraint(p,row)) || axis.provenance?.dashed===true,
        "a solid coincident axis must not visually erase a strict dashed source boundary");
  }
}
function cornersOracle(solution: Record<string, unknown>, expected: readonly PointOracle[], included: boolean | readonly boolean[] = true): void {
  check(Array.isArray(solution.closureVertices) && solution.closureVertices.length === expected.length,
    "exact feasible-region corner list must be complete, with no viewport-only corner");
  for (const [index, expectedPoint] of expected.entries()) {
    const corner = solution.closureVertices.map((v) => record(v, "closure corner")).find((v) => pointMatches(v.point, expectedPoint));
    check(corner !== undefined, "independent exact source corner must appear");
    check(corner.included === (typeof included === "boolean" ? included : included[index]), "corner inclusion follows every strict source constraint");
    check(Array.isArray(corner.activeConstraintIds) && corner.activeConstraintIds.length >= 2,
      "a mathematical corner has at least two source constraint incidences");
  }
}
function close(a: number, b: number): boolean { return Math.abs(a - b) <= 1e-9; }
function polygonArea(points: readonly RenderPoint[]): number {
  return Math.abs(points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length]!;
    return sum + p.x * next.y - p.y * next.x;
  }, 0)) / 2;
}

/** Independent line/rectangle intersection oracle, not a production clip call. */
function firstHalfPlaneExpectedClip(window: WorldWindow): RenderPoint[] {
  const corners = [
    { x: window.xMin, y: window.yMin }, { x: window.xMax, y: window.yMin },
    { x: window.xMax, y: window.yMax }, { x: window.xMin, y: window.yMax },
  ].filter((p) => -7 * p.x + 4 * p.y <= 9);
  const candidates = [
    { x: window.xMin, y: (7 * window.xMin + 9) / 4 },
    { x: window.xMax, y: (7 * window.xMax + 9) / 4 },
    { x: (4 * window.yMin - 9) / 7, y: window.yMin },
    { x: (4 * window.yMax - 9) / 7, y: window.yMax },
  ].filter((p) => p.x >= window.xMin && p.x <= window.xMax && p.y >= window.yMin && p.y <= window.yMax);
  const points = [...corners, ...candidates].filter((p, i, all) =>
    all.findIndex((q) => close(p.x, q.x) && close(p.y, q.y)) === i);
  const center = points.reduce((acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }), { x: 0, y: 0 });
  return points.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
}

function assertFirstHalfPlaneComplete(worldPolygon: readonly RenderPoint[], window: WorldWindow): void {
  assertFirstHalfPlaneFill(worldPolygon);
  check(worldPolygon.every((p) => p.x >= window.xMin - 1e-9 && p.x <= window.xMax + 1e-9
    && p.y >= window.yMin - 1e-9 && p.y <= window.yMax + 1e-9), "fill vertices must remain inside the actual display clip");
  const expected = firstHalfPlaneExpectedClip(window);
  for (const corner of expected) {
    check(worldPolygon.some((p) => close(p.x, corner.x) && close(p.y, corner.y)),
      `incomplete half-plane fill: required clipped corner (${corner.x}, ${corner.y}) is missing`);
  }
  check(close(polygonArea(worldPolygon), polygonArea(expected)), "half-plane fill area is incomplete or wrongly ordered");
}

// Deliberately wrong shade samples must fail this gate, even if they contain ink.
assert.throws(() => assertFirstHalfPlaneFill([
  { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 0, y: 5 },
]), /wrong shaded side/);
console.log("wrong-side sensitivity: PASS (independent polygon sample rejected)");
const sensitivityWindow = { xMin: -4, xMax: 4, yMin: -4, yMax: 4 };
assertFirstHalfPlaneComplete([
  { x: -25 / 7, y: -4 }, { x: 4, y: -4 }, { x: 4, y: 4 }, { x: 1, y: 4 },
], sensitivityWindow);
assert.throws(() => assertFirstHalfPlaneComplete([
  { x: 4, y: -4 }, { x: 4, y: 4 }, { x: 1, y: 4 },
], sensitivityWindow), /incomplete half-plane fill/);
console.log("fill-completeness sensitivity: PASS (correct-side incomplete polygon rejected)");

const firstHalfPlane = documentFor("linear_half_plane", { inequality: "-7x + 4y <= 9" },
  "Graph the solution set of -7x + 4y <= 9 in the coordinate plane.");
const firstValidation = validateSceneDocument(firstHalfPlane);
const firstCompile = compileSceneDocument(firstHalfPlane);
console.log(JSON.stringify({
  case: "independent-first-half-plane",
  structurallyValid: firstValidation.report.valid,
  compiled: firstCompile.ok,
  renderSceneIsNull: firstCompile.renderScene === null,
  issueCodes: firstCompile.report.issues.map((issue) => issue.code),
  issueMessages: firstCompile.report.issues.map((issue) => issue.message),
}));
check(firstCompile.ok && firstCompile.renderScene !== null,
  "a valid closed half-plane must compile through the public scene seam");
check(firstValidation.document !== null && firstValidation.report.valid,
  "a supported linear-region document must validate");
reservedBoundsSvgOracle(firstCompile);
const verifiedSvg=renderSceneSvg(firstCompile.renderScene);
assert.throws(()=>reservedBoundsSvgOracle(firstCompile,verifiedSvg.replace(/dominant-baseline="hanging"/g,'dominant-baseline="central"')),
  /glyphs must start at the padded reserved origin/);
assert.throws(()=>reservedBoundsSvgOracle(firstCompile,verifiedSvg.replace(/textLength="([^"]+)"/g,
  (_match,value:string)=>`textLength="${Number(value)+20}"`)),/fit its reserved width/);
console.log("reserved-bounds rendering sensitivity: PASS (shifted baseline and overflowing glyph width rejected)");

const firstMarks = linearMarks(firstCompile);
const firstFills = firstMarks.filter((primitive) => primitive.provenance?.linearRole === "feasible_fill");
check(firstFills.length === 1, "proper half-plane emits its complete clipped fill once");
const firstFill = firstFills[0]!;
check(firstFill.kind === "polygon" && firstFill.provenance?.fillRole === "region" && firstFill.provenance?.fillOnly === true,
  "a viewport-clipped fill has region provenance and no fabricated polygon border");
assertFirstHalfPlaneComplete(numericWorldPoints(firstFill), viewFor(firstFill));
const firstBoundaries = firstMarks.filter((primitive) => primitive.provenance?.linearRole === "source_boundary");
check(firstBoundaries.length === 1, "proper half-plane has exactly one original boundary");
check(firstBoundaries[0]!.provenance?.dashed !== true, "a weak inequality boundary is solid");
for (const point of worldPoints(firstBoundaries[0]!)) {
  const n = -7n * BigInt(point.x.numerator) * BigInt(point.y.denominator)
    + 4n * BigInt(point.y.numerator) * BigInt(point.x.denominator);
  const d = BigInt(point.x.denominator) * BigInt(point.y.denominator);
  check(n === 9n * d, "every source-boundary endpoint lies on the exact original equation");
}
// Mutate an actual emitted fill, not a private solver or an unknown operator.
const wrongSide = numericWorldPoints(firstFill).map((point) => ({ x: point.x, y: (7 * point.x + 9) / 2 - point.y }));
assert.throws(() => assertFirstHalfPlaneComplete(wrongSide, viewFor(firstFill)), /wrong shaded side|display clip/);
assert.throws(() => assertFirstHalfPlaneComplete(numericWorldPoints(firstFill).slice(1), viewFor(firstFill)),
  /incomplete half-plane fill|nonempty clipped region/);
console.log("compiled-fill mutation sensitivity: PASS (wrong side and omitted clipped corner rejected)");

for (const [field, forged] of [
  ["shadeSide", "above"], ["vertices", [[0, 0], [1, 0], [0, 1]]],
  ["feasible", false], ["solution", { state: "all_plane" }],
] as const) {
  const candidate = structuredClone(firstHalfPlane);
  candidate.constructions[0]!.inputs[field] = forged;
  atomicallyRefused(candidate, `model-supplied ${field}`);
}
const reversedSourceRelation = structuredClone(firstHalfPlane);
reversedSourceRelation.constructions[0]!.inputs.inequality = "-7x + 4y >= 9";
atomicallyRefused(reversedSourceRelation, "a reversed candidate inequality cannot bind to the unchanged source");
const alteredSourceCoefficient = structuredClone(firstHalfPlane);
alteredSourceCoefficient.constructions[0]!.inputs.inequality = "-8x + 4y <= 9";
atomicallyRefused(alteredSourceCoefficient, "a changed coefficient cannot bind to the unchanged source");
const falseBoundaryLabel = structuredClone(firstHalfPlane);
falseBoundaryLabel.entities[0]!.label = "-7x + 4y = -9";
atomicallyRefused(falseBoundaryLabel, "a false boundary equation label cannot be hidden by computed text replacement");

if (selected("number-line")) {
const firstNumberLine = compiled("number_line_set", { expression: { inequality: "-6x + 5 >= 0" } },
  "Graph the solution of -6x + 5 >= 0 on a number line.");
numberLineOracle(firstNumberLine, [[null, [5n, 6n, true]]]);

const numberLineCases: Array<{ expression: unknown; question: string; intervals: Array<[BoundOracle, BoundOracle]> }> = [
  { expression: { inequality: "-2x + 1 < 0" }, question: "Graph -2x + 1 < 0 on a number line.", intervals: [[[1n, 2n, false], null]] },
  { expression: { union: [{ inequality: "x < 2" }, { inequality: "x >= 2" }] }, question: "Graph x < 2 or x >= 2 on a number line.", intervals: [[null, null]] },
  { expression: { union: [{ inequality: "x < 0" }, { inequality: "x > 0" }] }, question: "Graph x < 0 or x > 0 on a number line.", intervals: [[null, [0n, 1n, false]], [[0n, 1n, false], null]] },
  { expression: { intersection: [{ inequality: "x >= -4" }, { inequality: "x <= -4" }] }, question: "Graph the common solution of x >= -4 and x <= -4.", intervals: [[[ -4n, 1n, true], [-4n, 1n, true]]] },
  { expression: { intersection: [{ inequality: "x > -4" }, { inequality: "x <= -5" }] }, question: "Graph the common solution of x > -4 and x <= -5.", intervals: [] },
  { expression: { complement: { intersection: [{ inequality: "x > -1" }, { inequality: "x <= 4" }] } }, question: "Graph the complement of the common solution of x > -1 and x <= 4.", intervals: [[null, [-1n, 1n, true]], [[4n, 1n, false], null]] },
  { expression: { inequality: "0x < 2" }, question: "Graph the real solution set of 0x < 2.", intervals: [[null, null]] },
  { expression: { inequality: "0x > 1" }, question: "Graph the real solution set of 0x > 1.", intervals: [] },
];
for (const test of numberLineCases) numberLineOracle(compiled("number_line_set", { expression: test.expression }, test.question), test.intervals);
numberLineOracle(compiled("number_line_set", { variable: "t", expression: { inequality: "-3t >= 8" } },
  "Graph -3t >= 8 on a number line for real t."), [[null, [-8n, 3n, true]]]);
const connectiveMutation = documentFor("number_line_set", { expression: { union: [{ inequality: "x < 0" }, { inequality: "x > 0" }] } },
  "Graph x < 0 and x > 0 on a number line.");
atomicallyRefused(connectiveMutation, "OR candidate must not bind to an AND source");
const firstNumberLineDocument = documentFor("number_line_set", { expression: { inequality: "-6x + 5 >= 0" } },
  "Graph the solution of -6x + 5 >= 0 on a number line.");
const wrongEndpointClaim = structuredClone(firstNumberLineDocument);
wrongEndpointClaim.entities[0]!.label = "x >= 5/6";
atomicallyRefused(wrongEndpointClaim, "a wrong endpoint direction label cannot be replaced silently");
}

if (selected("half-plane")) {
for (const test of [
  { inequality: "-7x + 4y < 9", strict: true, inside: (p: RenderPoint) => -7*p.x+4*p.y <= 9+1e-9 },
  { inequality: "-9x > 2", strict: true, inside: (p: RenderPoint) => p.x <= -2/9+1e-9 },
  { inequality: "-5x < 0", strict: true, inside: (p: RenderPoint) => p.x >= -1e-9 },
  { inequality: "4y >= -5", strict: false, inside: (p: RenderPoint) => p.y >= -5/4-1e-9 },
  { inequality: "-2x + 5y > 0", strict: true, inside: (p: RenderPoint) => -2*p.x+5*p.y >= -1e-9 },
]) {
  const result = compiled("linear_half_plane", { inequality: test.inequality }, `Graph ${test.inequality} in the coordinate plane.`);
  noSolidAxisUnderStrictBoundary(result);
  check(solutionFor(result).state === "proper_half_plane", "nonzero normal gives a proper half-plane");
  const marks = linearMarks(result);
  const boundary = marks.filter((p) => p.provenance?.linearRole === "source_boundary");
  check(boundary.length === 1 && (boundary[0]!.provenance?.dashed === true) === test.strict,
    "original boundary style is derived from strictness, including axis-parallel boundaries");
  const fill = marks.filter((p) => p.provenance?.linearRole === "feasible_fill");
  check(fill.length === 1 && numericWorldPoints(fill[0]!).every(test.inside), "half-plane fill uses the independently computed side");
}
for (const [inequality, state] of [["0x + 0y <= 1", "all_plane"], ["0x + 0y < 0", "empty"]] as const) {
  const result = compiled("linear_half_plane", { inequality }, `Graph ${inequality} for real x and y.`);
  check(solutionFor(result).state === state, "zero-normal source has honest empty/all-plane classification");
  check(!linearMarks(result).some((p) => p.provenance?.linearRole === "source_boundary"), "constant inequality never invents a boundary line");
}
}

if (selected("lpp")) {
const rationalInputs = { constraints: ["x >= 0", "y >= 0", "3x + 2y <= 11", "x + 3y <= 9"], objective: { expression: "4x + 5y", sense: "max" } };
const rationalQuestion = "Use a graph to maximize Z = 4x + 5y subject to x >= 0, y >= 0, 3x + 2y <= 11 and x + 3y <= 9. Give exact corners and the optimum.";
const rationalRegion = compiled("linear_feasible_region", rationalInputs, rationalQuestion);
const rationalSolution = solutionFor(rationalRegion);
const rationalCorners: PointOracle[] = [[0n,1n,0n,1n], [11n,3n,0n,1n], [15n,7n,16n,7n], [0n,1n,3n,1n]];
cornersOracle(rationalSolution, rationalCorners);
check(rationalSolution.dimension === 2 && rationalSolution.bounded === true, "independent rational quadrilateral is bounded and two-dimensional");
const objective = record(rationalSolution.objective, "rational region objective exists");
const extremum = record(objective.extremum, "objective extremum exists");
check(extremum.status === "attained" && exactValueEquals(exact(extremum.value),20n), "independent maximum is exactly 20 and attained");
check(pointMatches(extremum.point,[15n,7n,16n,7n]), "the unique maximizing point has exact rational coordinates");
check(Array.isArray(objective.cornerValues) && objective.cornerValues.length === 4, "each true corner has its objective value");
for (const [point, value, denominator] of [
  [rationalCorners[0]!,0n,1n], [rationalCorners[1]!,44n,3n], [rationalCorners[2]!,20n,1n], [rationalCorners[3]!,15n,1n],
] as const) {
  const entry = objective.cornerValues.map((v) => record(v, "corner value")).find((v) => pointMatches(v.point, point));
  check(entry !== undefined && exactValueEquals(exact(entry.value),value,denominator), "corner objective uses the independent exact cost");
}
const cornerMarks = linearMarks(rationalRegion).filter((p) => p.provenance?.linearRole === "closure_corner");
check(cornerMarks.length === 4, "only the four actual source corners receive corner marks");
const cornerTexts = linearMarks(rationalRegion).map((p) => p.text ?? "").join(" ");
check(cornerTexts.includes("15/7") && cornerTexts.includes("16/7"), "rational corner labels remain exact instead of rounded into authority");
const droppedCorner = structuredClone(rationalSolution);
(droppedCorner.closureVertices as unknown[]).pop();
assert.throws(() => cornersOracle(droppedCorner,rationalCorners), /corner list must be complete/);
const falseCorner = structuredClone(rationalSolution);
const alteredCorner = record((falseCorner.closureVertices as unknown[])[0], "mutation corner");
alteredCorner.point = { x: { numerator: "1", denominator: "1" }, y: { numerator: "1", denominator: "1" } };
assert.throws(() => cornersOracle(falseCorner,rationalCorners), /source corner must appear/);
console.log("compiled-corner mutation sensitivity: PASS (omitted and perturbed exact corners rejected)");

const equivalent = { constraints: ["-x - 3y >= -9", "6x + 4y <= 22", "-3y <= 0", "-2x <= 0"], objective: { expression: "5y + 4x", sense: "max" } };
cornersOracle(solutionFor(compiled("linear_feasible_region", equivalent, rationalQuestion)), rationalCorners);
const regionCases: Array<{ constraints: string[]; objective?: { expression: string; sense: string }; question: string;
  corners: PointOracle[]; included?: boolean | boolean[]; dimension: number | null; bounded: boolean | null; status?: string; value?: bigint; point?: PointOracle }> = [
  { constraints: ["x >= 0","y >= 0","x + y >= 7"], objective: { expression: "2x + 5y", sense: "min" },
    question: "Graph the feasible region and minimize Z = 2x + 5y subject to x >= 0, y >= 0 and x + y >= 7.",
    corners: [[0n,1n,7n,1n],[7n,1n,0n,1n]], dimension: 2, bounded: false, status: "attained", value: 14n, point: [7n,1n,0n,1n] },
  { constraints: ["x >= 0","y >= 2x + 1"], objective: { expression: "x + y", sense: "max" },
    question: "Graph the feasible region and maximize Z = x + y subject to x >= 0 and y >= 2x + 1.",
    corners: [[0n,1n,1n,1n]], dimension: 2, bounded: false, status: "unbounded" },
  { constraints: ["x > 0","y > 0","x + y < 4"], objective: { expression: "x + y", sense: "max" },
    question: "Graph the feasible region and maximize Z = x + y subject to x > 0, y > 0 and x + y < 4. Distinguish a maximum from a supremum.",
    corners: [[0n,1n,0n,1n],[4n,1n,0n,1n],[0n,1n,4n,1n]], included: false, dimension: 2, bounded: true, status: "finite_limit", value: 4n },
  { constraints: ["x > 0","y > 0","x + y <= 3"], objective: { expression: "x + y", sense: "max" },
    question: "Graph the feasible region and maximize Z = x + y subject to x > 0, y > 0 and x + y <= 3.",
    corners: [[0n,1n,0n,1n],[3n,1n,0n,1n],[0n,1n,3n,1n]], included: false, dimension: 2, bounded: true, status: "attained", value: 3n },
  { constraints: ["x >= -1","x <= 2"], objective: { expression: "x", sense: "max" },
    question: "Graph the region x >= -1 and x <= 2 with unrestricted real y, and maximize Z = x.",
    corners: [], dimension: 2, bounded: false, status: "attained", value: 2n },
  { constraints: ["x > 0","x <= 0"], objective: { expression: "x + y", sense: "max" },
    question: "Graph the common region x > 0 and x <= 0 for real x and y, and maximize Z = x + y if possible.",
    corners: [], dimension: null, bounded: null, status: "infeasible" },
  { constraints: ["x = 2","y = -5"], question: "Graph the common set x = 2 and y = -5 for real x and y.",
    corners: [[2n,1n,-5n,1n]], dimension: 0, bounded: true },
  { constraints: ["x + 2y = 3"], question: "Graph the set x + 2y = 3 for real x and y.",
    corners: [], dimension: 1, bounded: false },
  { constraints: ["y = -2","x > 1","x <= 5"], question: "Graph the common set y = -2, x > 1 and x <= 5.",
    corners: [[1n,1n,-2n,1n],[5n,1n,-2n,1n]], included: [false,true], dimension: 1, bounded: true },
  { constraints: ["0x + 0y <= 1"], objective: { expression: "9", sense: "max" },
    question: "Graph 0x + 0y <= 1 for real x and y and maximize the constant Z = 9.",
    corners: [], dimension: 2, bounded: false, status: "attained", value: 9n },
];
for (const test of regionCases) {
  const result = compiled("linear_feasible_region", { constraints: test.constraints, ...(test.objective ? {objective:test.objective} : {}) }, test.question);
  const solution = solutionFor(result);
  noSolidAxisUnderStrictBoundary(result);
  cornersOracle(solution,test.corners,test.included ?? true);
  check(solution.dimension === test.dimension && solution.bounded === test.bounded, "independent feasibility dimension and boundedness");
  if (test.status) {
    const objective = record(solution.objective,"objective exists");
    const extremum = record(objective.extremum,"extremum exists");
    check(extremum.status === test.status, `${test.question}: objective classification follows its exact attainable range`);
    if (test.value !== undefined) check(exactValueEquals(exact(extremum.value),test.value), "objective extremum or finite limit has the independent exact value");
    if (test.point) check(pointMatches(extremum.point,test.point), "unique optimum has the independent exact point");
    if (test.constraints.includes("x + y <= 3")) {
      const p = exactPoint(extremum.point);
      check(numberFromExact(p.x)>0 && numberFromExact(p.y)>0 && close(numberFromExact(p.x)+numberFromExact(p.y),3),
        "open optimal edge attains the maximum despite having no included corners");
    }
    if (test.status === "unbounded") {
      const p = exactPoint(extremum.basePoint), d = exactPoint(extremum.direction);
      const px=numberFromExact(p.x),py=numberFromExact(p.y),dx=numberFromExact(d.x),dy=numberFromExact(d.y);
      check(px>=0 && py>=2*px+1 && dx>=0 && dy>=2*dx && dx+dy>0,
        "an improving recession ray remains feasible and makes the objective grow");
    }
    if (test.status === "infeasible") {
      check(!linearMarks(result).some((p) => p.provenance?.linearRole === "feasible_fill" || p.provenance?.linearRole === "closure_corner"),
        "empty actual set has neither feasible fill nor relaxation corners masquerading as actual corners");
    }
  }
}

const rationalDocument = documentFor("linear_feasible_region",rationalInputs,rationalQuestion);
for (const [name, alter] of [
  ["source coefficient", (doc: SceneDocument) => { doc.constructions[0]!.inputs.constraints = ["x >= 0","y >= 0","3x + 2y <= 12","x + 3y <= 9"]; }],
  ["objective sense", (doc: SceneDocument) => { doc.constructions[0]!.inputs.objective = {expression:"4x + 5y",sense:"min"}; }],
  ["objective coefficient", (doc: SceneDocument) => { doc.constructions[0]!.inputs.objective = {expression:"4x + 6y",sense:"max"}; }],
  ["removed nonnegativity", (doc: SceneDocument) => { doc.constructions[0]!.inputs.constraints = ["y >= 0","3x + 2y <= 11","x + 3y <= 9"]; }],
  ["false corner entity label", (doc: SceneDocument) => { doc.entities[0]!.label = "A = (15/7, 17/7)"; }],
  ["false optimum entity label", (doc: SceneDocument) => { doc.entities[0]!.label = "max Z = 21"; }],
  ["false optimum annotation", (doc: SceneDocument) => { doc.annotations.push({id:"false_max",kind:"callout",targetIds:["solution"],text:"max Z = 21"}); }],
] as const) {
  const candidate=structuredClone(rationalDocument); alter(candidate); atomicallyRefused(candidate,name);
}
const capturedAuthority = record(linearMarks(rationalRegion)[0]!.provenance?.linearSolution,"compiled authority for tamper gates");
for (const [name, alter] of [
  ["dropped corner proof", (solution: Record<string, unknown>) => { (solution.closureVertices as unknown[]).pop(); }],
  ["inserted clip-only corner", (solution: Record<string, unknown>) => { (solution.closureVertices as unknown[]).push({point:{x:{numerator:"-9",denominator:"1"},y:{numerator:"-9",denominator:"1"}},activeConstraintIds:[],included:true}); }],
  ["zero exact denominator", (solution: Record<string, unknown>) => { record(record((solution.closureVertices as unknown[])[0],"corner").point,"point").x={numerator:"0",denominator:"0"}; }],
  ["forged objective value", (solution: Record<string, unknown>) => { record(record(solution.objective,"objective").extremum,"extremum").value={numerator:"21",denominator:"1"}; }],
] as const) {
  const forged = structuredClone(capturedAuthority); alter(record(forged.solution,"forged solution"));
  const candidate=structuredClone(rationalDocument); candidate.entities[0]!.provenance={linearSolution:forged};
  atomicallyRefused(candidate,name);
}
}

if (selected("system")) {
for (const test of [
  {equations:["4x - y = 9","x + 2y = 7"],relation:"unique",point:[25n,9n,19n,9n] as PointOracle},
  {equations:["3x - 2y = 7","6x - 4y = 15"],relation:"parallel"},
  {equations:["-4x + y = -9","8x - 2y = 18"],relation:"coincident"},
  {equations:["x = -5","y = -2"],relation:"unique",point:[-5n,1n,-2n,1n] as PointOracle},
  {equations:["x = 4","2x = -6"],relation:"parallel"},
  {equations:["3y = 12","-2y = -8"],relation:"coincident"},
]) {
  const result=compiled("linear_system",{equations:test.equations},`Solve ${test.equations[0]} and ${test.equations[1]} graphically.`);
  const solution=solutionFor(result);
  check(solution.relation===test.relation,"two-line relation follows independent determinant/proportionality facts");
  if(test.point) check(pointMatches(solution.intersection,test.point),"unique line intersection has independent exact coordinates");
  else check(solution.intersection===null,"parallel/coincident systems do not invent a unique intersection");
  const boundaryCount=linearMarks(result).filter((p)=>p.provenance?.linearRole==="source_boundary").length;
  check(boundaryCount===(test.relation==="coincident"?1:2),
    `${test.equations.join("; ")}: coincident equations share one geometric line; distinct equations remain separate (count=${boundaryCount}; roles=${JSON.stringify(linearMarks(result).map((p)=>({kind:p.kind,role:p.provenance?.linearRole,text:p.text})))})`);
}
for (const equations of [["0x + 0y = 0","x + y = 1"],["0x + 0y = 1","x + y = 1"],["xy = 1","x + y = 1"]])
  atomicallyRefused(documentFor("linear_system",{equations},`Solve ${equations[0]} and ${equations[1]} graphically.`),"a two-line system requires affine nonzero normals");
}

if (selected("view")) {
  // View choices can change the clip, but cannot hide the required exact marks.
  const endpointQuestion="Graph -8x + 3 <= 0 on a number line.";
  const endpointInputs={expression:{inequality:"-8x + 3 <= 0"}};
  numberLineOracle(compiled("number_line_set",{...endpointInputs,view:{xMin:-2,xMax:2,yMin:-1,yMax:1}},endpointQuestion),
    [[[3n,8n,true],null]]);
  atomicallyRefused(documentFor("number_line_set",{...endpointInputs,view:{xMin:1,xMax:2,yMin:-1,yMax:1}},endpointQuestion),
    "a view cannot hide a required finite number-line endpoint");

  const halfPlaneWithView=compiled("linear_half_plane",{inequality:"-7x + 4y <= 9",view:sensitivityWindow},
    "Graph -7x + 4y <= 9 in the coordinate plane.");
  const halfPlaneFill=linearMarks(halfPlaneWithView).find((p)=>p.provenance?.linearRole==="feasible_fill");
  check(halfPlaneFill!==undefined,"changed valid half-plane window still has its complete fill");
  assertFirstHalfPlaneComplete(numericWorldPoints(halfPlaneFill),sensitivityWindow);
  atomicallyRefused(documentFor("linear_half_plane",{inequality:"-7x + 4y <= 9",view:{xMin:0,xMax:1,yMin:10,yMax:11}},
    "Graph -7x + 4y <= 9 in the coordinate plane."),"a view cannot omit the proper half-plane boundary");

  const cornerQuestion="Graph the common region x >= 0, y >= 0 and 5x + 2y <= 13, showing every exact corner.";
  const cornerInputs={constraints:["x >= 0","y >= 0","5x + 2y <= 13"]};
  const defaultRegion=compiled("linear_feasible_region",cornerInputs,cornerQuestion);
  const wideRegion=compiled("linear_feasible_region",{...cornerInputs,view:{xMin:"-2",xMax:"9",yMin:"-2",yMax:"9"}},cornerQuestion);
  const expectedCorners:PointOracle[]=[[0n,1n,0n,1n],[13n,5n,0n,1n],[0n,1n,13n,2n]];
  cornersOracle(solutionFor(wideRegion),expectedCorners);
  check(JSON.stringify(solutionFor(defaultRegion))===JSON.stringify(solutionFor(wideRegion)),
    "a changed display view leaves the exact region solution and corners unchanged");
  atomicallyRefused(documentFor("linear_feasible_region",{...cornerInputs,view:{xMin:0,xMax:1,yMin:0,yMax:8}},cornerQuestion),
    "a view cannot remove a true rational source corner");
  atomicallyRefused(documentFor("linear_system",{equations:["4x - y = 9","x + 2y = 7"],view:{xMin:-1,xMax:1,yMin:-1,yMax:1}},
    "Solve 4x - y = 9 and x + 2y = 7 graphically."),"a view cannot hide the unique system intersection");

  const denominator="1000000000000000000000000000000";
  const tinyConstraints=["x >= 0","y >= 0",`x <= 1/${denominator}`,`y <= 1/${denominator}`];
  atomicallyRefused(documentFor("linear_feasible_region",{constraints:tinyConstraints,view:{xMin:-1,xMax:1,yMin:-1,yMax:1}},
    `Graph the common region x >= 0, y >= 0, x <= 1/${denominator} and y <= 1/${denominator}. Show every corner.`),
    "four distinct exact tiny corners cannot silently collapse in display",/precision|indistinguish|collapse/i);

  for(const inequality of ["x > 0","x >= 0"])
    atomicallyRefused(documentFor("linear_half_plane",{inequality,view:{xMin:-2,xMax:0,yMin:-1,yMax:1}},
      `Graph ${inequality} in the coordinate plane.`),
      "a tangent window with no two-dimensional feasible interior cannot masquerade as the proper half-plane");
  const thinStrip=["x >= 0",`x <= 1/${denominator}`];
  atomicallyRefused(documentFor("linear_feasible_region",{constraints:thinStrip,view:{xMin:-1,xMax:1,yMin:-1,yMax:1}},
    `Graph the common region x >= 0 and x <= 1/${denominator} with unrestricted real y.`),
    "a no-vertex two-dimensional thin strip cannot collapse into a drawn line",/precision|indistinguish|collapse/i);
}

if (selected("source-authority")) {
  for(const source of [
    "Graph -7x + 4y + z <= 9 in the coordinate plane.",
    "Graph -7x + 4y + sin(x) <= 9 in the coordinate plane.",
    "Graph -7x^2 + 4y <= 9 in the coordinate plane.",
    "Graph all points that do not satisfy -7x + 4y <= 9 in the coordinate plane.",
    "Graph the complement of -7x + 4y <= 9 in the coordinate plane.",
    "Graph -7x + 4y <= 9 if x >= 2 in the coordinate plane.",
    "Graph -7x + 4y <= 9 for positive real x and y.",
    "Graph -7x + 4y <= 9 for non-negative real x and y.",
    "Graph -7x + 4y <= 9 for integers x and y.",
    "Graph -7x + 4y <= 9 for real X and Y.",
    "Graph -7x + 4y <= 9 for x,y in ℤ.",
    "Graph (-7x + 4y <= 9) ∖ (x >= 0) in the coordinate plane.",
    "Graph -7x + 4y <= 9 ⇒ x >= 0 in the coordinate plane.",
  ]) atomicallyRefused(documentFor("linear_half_plane",{inequality:"-7x + 4y <= 9"},source),
    `source grammar cannot silently discard meaning: ${source}`);
  check(solutionFor(compiled("linear_half_plane",{inequality:"-7x + 4y <= 9"},
    "Graph -7x + 4y <= 9 for real x and y.")).state==="proper_half_plane",
    "an explicit real domain preserves the continuous half-plane");
  const upperCase=compiled("linear_half_plane",{variables:["X","Y"],inequality:"-7X + 4Y <= 9"},
    "Graph -7X + 4Y <= 9 for real X and Y.");
  check(JSON.stringify(solutionFor(upperCase).variables)===JSON.stringify(["X","Y"]),
    "explicit variable names and their domain remain case-sensitive");
  atomicallyRefused(documentFor("linear_half_plane",{inequality:"x + y <= 8"},
    "Graph x + a + y <= 8 in the coordinate plane."),"an undeclared affine addend cannot be dropped from the source");
  const tupleQuestion="Graph the common region x, y >= 2 + 1 in the coordinate plane.";
  const tupleRegion=compiled("linear_feasible_region",{constraints:["x >= 3","y >= 3"]},tupleQuestion);
  cornersOracle(solutionFor(tupleRegion),[[3n,1n,3n,1n]]);
  atomicallyRefused(documentFor("linear_feasible_region",{constraints:["x >= 2","y >= 2"]},tupleQuestion),
    "tuple-domain normalization cannot truncate the arithmetic right-hand side");

  const wholeComplementQuestion="Graph all real x that do not satisfy (x < -5 or x >= 2) on a number line.";
  const union={union:[{inequality:"x < -5"},{inequality:"x >= 2"}]};
  numberLineOracle(compiled("number_line_set",{expression:{complement:union}},wholeComplementQuestion),
    [[[-5n,1n,true],[2n,1n,false]]]);
  atomicallyRefused(documentFor("number_line_set",{expression:union},wholeComplementQuestion),
    "do-not-satisfy applies to the complete Boolean source set");

  const constraints=["x >= 0","y >= 0","5x + 2y <= 13"];
  for(const sense of ["maximize","minimize"])
    atomicallyRefused(documentFor("linear_feasible_region",{constraints},
      `Graph and ${sense} Z = 3x + y subject to x >= 0, y >= 0 and 5x + 2y <= 13.`),
      `an explicit ${sense} request cannot omit its objective`);
  const tracedCandidate=structuredClone(firstHalfPlane);
  tracedCandidate.annotations.push({id:"candidate_trace",kind:"trace",targetIds:["solution"]});
  atomicallyRefused(tracedCandidate,"a trace annotation cannot replace a linear boundary with a generic polygon perimeter");
  const siblingPoint=structuredClone(firstHalfPlane);
  siblingPoint.entities.push({id:"untrusted_point",kind:"point",role:"claimed_corner",label:"A = (1, 1)"});
  siblingPoint.constructions.push({id:"construct_untrusted_point",operator:"point",inputs:{x:1,y:1},outputs:["untrusted_point"]});
  siblingPoint.requiredEntityIds.push("untrusted_point");
  siblingPoint.revealGroups[0]!.entityIds.push("untrusted_point");
  atomicallyRefused(siblingPoint,"a sibling model-authored point cannot add an unproved mark to a protected linear solution");
}

if (process.argv.includes("--visuals")) {
  const directory=resolve(dirname(fileURLToPath(import.meta.url)),"../../../../.context/h3r6/dev-visuals");
  mkdirSync(directory,{recursive:true});
  const visualCases: Array<{id:string;operator:string;inputs:Record<string,unknown>;question:string}> = [
    {id:"number-line-mixed",operator:"number_line_set",inputs:{expression:{intersection:[{inequality:"x > -3"},{inequality:"x <= 5"}]}},question:"Graph the common solution of x > -3 and x <= 5."},
    {id:"number-line-union",operator:"number_line_set",inputs:{expression:{union:[{inequality:"x <= -2"},{inequality:"x > 4"}]}},question:"Graph x <= -2 or x > 4 on a number line."},
    {id:"half-plane-negative-strict",operator:"linear_half_plane",inputs:{inequality:"-7x + 4y < 9"},question:"Graph -7x + 4y < 9 in the coordinate plane."},
    {id:"half-plane-strict-axis",operator:"linear_half_plane",inputs:{inequality:"-5x < 0"},question:"Graph -5x < 0 in the coordinate plane."},
    {id:"lpp-fractional",operator:"linear_feasible_region",inputs:{constraints:["x >= 0","y >= 0","3x + 2y <= 11","x + 3y <= 9"],objective:{expression:"4x + 5y",sense:"max"}},question:"Graph and maximize Z = 4x + 5y subject to x >= 0, y >= 0, 3x + 2y <= 11 and x + 3y <= 9. Show exact corners and the objective value at each corner."},
    {id:"lpp-unbounded",operator:"linear_feasible_region",inputs:{constraints:["x >= 0","y >= 2x + 1"],objective:{expression:"x + y",sense:"max"}},question:"Graph and maximize Z = x + y subject to x >= 0 and y >= 2x + 1. Determine whether a finite maximum exists."},
    {id:"system-unique",operator:"linear_system",inputs:{equations:["4x - y = 9","x + 2y = 7"]},question:"Solve 4x - y = 9 and x + 2y = 7 graphically."},
    {id:"system-coincident",operator:"linear_system",inputs:{equations:["-4x + y = -9","8x - 2y = 18"]},question:"Solve -4x + y = -9 and 8x - 2y = 18 graphically."},
  ];
  for(const test of visualCases) {
    const document=documentFor(test.operator,test.inputs,test.question);
    const result=compileSceneDocument(document);
    writeFileSync(resolve(directory,`${test.id}.json`),JSON.stringify({document,result},null,2)+"\n");
    if(result.ok && result.renderScene) writeFileSync(resolve(directory,`${test.id}.svg`),renderSceneSvg(result.renderScene));
    console.log(JSON.stringify({developmentVisual:test.id,ok:result.ok,issues:result.report.issues.map((i)=>i.message)}));
  }
}

console.log(`linear-region public compiler gate passed (${checks} checks)`);
