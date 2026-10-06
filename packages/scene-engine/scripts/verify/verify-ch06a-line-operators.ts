import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";
import {
  ANALYTIC_LINE_OPERATORS,
  evaluateAnalyticLineConstruction,
  validateAnalyticLineConstruction,
  type AnalyticLineEvaluationContext,
  type AnalyticLineGeometry,
  type AnalyticLineRecord,
} from "../../src/compile/analyticLineGeometry";

const quantities = new Map<string, number>();
const geometries = new Map<string, AnalyticLineGeometry>();
const context: AnalyticLineEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const resolved = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
    if (!Number.isFinite(resolved)) throw new Error("not finite");
    return resolved;
  },
  point(value) {
    if (typeof value === "string") {
      const found = geometries.get(value);
      if (found?.kind === "point") return found.point;
      throw new Error("not a point");
    }
    if (Array.isArray(value) && value.length === 2) return { x: Number(value[0]), y: Number(value[1]) };
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
      return { x: Number(value.x), y: Number(value.y) };
    }
    throw new Error("not a point");
  },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(message);
}
function close(actual: number, expected: number, message: string, tolerance = 1e-8): void {
  check(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected), Math.abs(actual), 1), `${message}: ${actual} != ${expected}`);
}
function evaluate(operator: string, inputs: Record<string, unknown>): AnalyticLineGeometry[] {
  return evaluateAnalyticLineConstruction(operator, inputs, context);
}
function one(operator: string, inputs: Record<string, unknown>): AnalyticLineGeometry {
  const result = evaluate(operator, inputs);
  check(result.length === 1, `${operator} returns one geometry`);
  return result[0]!;
}
function reject(operator: string, inputs: Record<string, unknown>, message?: string): void {
  let threw = false;
  try { evaluate(operator, inputs); }
  catch { threw = true; }
  check(threw, message ?? `${operator} must reject ${JSON.stringify(inputs)}`);
}
function asPoint(geometry: AnalyticLineGeometry, message: string): { point: RenderPoint; analyticLine: AnalyticLineRecord } {
  check(geometry.kind === "point", message);
  if (geometry.kind !== "point") throw new Error(message);
  return geometry;
}
function asPath(geometry: AnalyticLineGeometry, message: string): { points: RenderPoint[]; analyticLine: AnalyticLineRecord; infinite?: true; directed?: true } {
  check(geometry.kind === "path" && geometry.points.length === 2, message);
  if (geometry.kind !== "path") throw new Error(message);
  return geometry;
}
function asCircle(geometry: AnalyticLineGeometry, message: string): { center: RenderPoint; radius: number; analyticLine: AnalyticLineRecord } {
  check(geometry.kind === "circle", message);
  if (geometry.kind !== "circle") throw new Error(message);
  return geometry;
}
function hypot(a: RenderPoint, b: RenderPoint): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}
function residual(a: number, b: number, c: number, point: RenderPoint): number {
  return Math.abs(a * point.x + b * point.y + c) / Math.sqrt(a * a + b * b);
}
function containsNonFinite(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some(containsNonFinite);
}
function solve2(first: { a: number; b: number; c: number }, second: { a: number; b: number; c: number }): { det: number; x: number; y: number } {
  const det = first.a * second.b - first.b * second.a;
  return {
    det,
    x: (-first.c * second.b + first.b * second.c) / det,
    y: (-first.a * second.c + first.c * second.a) / det,
  };
}
function det3(rows: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]): number {
  const [a, b, c] = rows;
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}
function normalizeOracle(a: number, b: number, c: number): { a: number; b: number; c: number } {
  const scale = Math.hypot(a, b);
  let na = a / scale;
  let nb = b / scale;
  let nc = c / scale;
  if (na < 0 || (Math.abs(na) <= 1e-12 && nb < 0)) {
    na = -na;
    nb = -nb;
    nc = -nc;
  }
  return { a: na, b: nb, c: nc };
}
function acuteOracle(first: RenderPoint, second: RenderPoint): number {
  const cross = Math.abs(first.x * second.y - first.y * second.x);
  const dot = Math.abs(first.x * second.x + first.y * second.y);
  return Math.atan2(cross, dot);
}
function directionOracle(line: { a: number; b: number }): RenderPoint {
  return { x: -line.b, y: line.a };
}

check(ANALYTIC_LINE_OPERATORS.length === 9, "analytic line operator inventory");

// Worked distance: 3-4-5. Holdout later is the 12-9-15 pair.
const workedDistance = asPath(one("coordinate_distance", { a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }), "3-4-5 segment");
close(workedDistance.analyticLine.distance!, 5, "worked world distance");
close(workedDistance.analyticLine.distance!, Math.sqrt(3 * 3 + 4 * 4), "sqrt oracle");
close(hypot(workedDistance.points[0]!, workedDistance.points[1]!), 5, "undecorated segment uses the world length");
check(workedDistance.analyticLine.worldUnits === true, "distance is tagged in world units");
check(workedDistance.analyticLine.axisAligned === "neither", "3-4-5 is not axis-aligned");

for (const displayLength of [10, 400, 760]) {
  const drawn = asPath(one("coordinate_distance", { a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, displayLength }), "display segment");
  close(drawn.analyticLine.distance!, 5, "display length cannot change world distance");
  close(hypot(drawn.points[0]!, drawn.points[1]!), displayLength, "display length is only the drawn segment");
  check(drawn.analyticLine.distance !== displayLength, "pixel-sized display length stays out of the metric");
}
for (const key of ["displayScale", "pixelLength", "boardScale", "fittedScale"]) {
  reject("coordinate_distance", { a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, [key]: 2 }, `${key} must not supply the metric`);
}

const quadrants = [
  { x: 2, y: 3, name: "I" },
  { x: -4, y: 5, name: "II" },
  { x: -6, y: -1, name: "III" },
  { x: 8, y: -7, name: "IV" },
];
for (const start of quadrants) {
  for (const end of quadrants) {
    const geometry = one("coordinate_distance", { a: { x: start.x, y: start.y }, b: { x: end.x, y: end.y } });
    const meta = geometry.analyticLine;
    check(meta.quadrants?.[0] === start.name && meta.quadrants[1] === end.name, "quadrant labels");
    if (start === end) {
      const point = asPoint(geometry, "coincident pair is a point");
      close(point.analyticLine.distance!, 0, "coincident distance");
      check(point.analyticLine.coincidentPoints === true && point.analyticLine.axisAligned === "coincident", "coincident classification");
    } else {
      const path = asPath(geometry, "distinct pair is a segment");
      close(path.analyticLine.distance!, hypot(start, end), "quadrant pair sqrt distance");
    }
  }
}
const vertical = asPath(one("coordinate_distance", { a: { x: 0, y: 2 }, b: { x: 0, y: 9 } }), "vertical segment");
close(vertical.analyticLine.distance!, 7, "vertical distance is |dy|");
check(vertical.analyticLine.axisAligned === "vertical", "vertical classification");
check(vertical.analyticLine.quadrants?.[0] === "y-axis", "y-axis endpoint");
const horizontal = asPath(one("coordinate_distance", { a: { x: 2, y: 0 }, b: { x: 9, y: 0 } }), "horizontal segment");
close(horizontal.analyticLine.distance!, 7, "horizontal distance is |dx|");
check(horizontal.analyticLine.axisAligned === "horizontal", "horizontal classification");
const origin = asPoint(one("coordinate_distance", { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }), "origin pair");
close(origin.analyticLine.distance!, 0, "origin coincident distance");
check(origin.analyticLine.quadrants?.[0] === "origin", "origin quadrant");

const holdoutA = { x: -5, y: 2 };
const holdoutB = { x: 7, y: -7 };
const holdoutDistance = asPath(one("coordinate_distance", { a: holdoutA, b: holdoutB }), "holdout segment");
close(holdoutDistance.analyticLine.distance!, 15, "holdout 12-9-15 distance");
check(holdoutDistance.analyticLine.quadrants?.[0] === "II" && holdoutDistance.analyticLine.quadrants[1] === "IV", "holdout quadrants");
for (const shift of [{ x: 4, y: -3 }, { x: -8, y: 2 }, { x: 0, y: 5 }, { x: 19, y: -31 }]) {
  const moved = asPath(one("coordinate_distance", {
    a: { x: holdoutA.x + shift.x, y: holdoutA.y + shift.y },
    b: { x: holdoutB.x + shift.x, y: holdoutB.y + shift.y },
  }), "translated segment");
  close(moved.analyticLine.distance!, 15, "translation preserves world distance");
}
reject("coordinate_distance", { a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, displayLength: 0 });
reject("coordinate_distance", { a: { x: 1, y: 1 }, b: { x: 1, y: 1 }, displayLength: 4 }, "coincident points have no display direction");
reject("coordinate_distance", { a: { x: 0, y: 0, z: 1 }, b: { x: 1, y: 0 } });
reject("coordinate_distance", { a: [0, 0, 0], b: [1, 0] });

// Section formula. Hand values are expanded, then the local affine combination is checked against those literals.
const sectionA = { x: 1, y: 1 };
const sectionB = { x: 4, y: 5 };
const internalHand = { x: 2, y: 7 / 3 };
const internal = asPoint(one("section_point", { a: sectionA, b: sectionB, mode: "internal", m: 1, n: 2 }), "internal section");
close(internal.point.x, internalHand.x, "internal hand x");
close(internal.point.y, internalHand.y, "internal hand y");
function internalOracle(a: RenderPoint, b: RenderPoint, m: number, n: number): RenderPoint {
  return { x: (n * a.x + m * b.x) / (m + n), y: (n * a.y + m * b.y) / (m + n) };
}
function externalOracle(a: RenderPoint, b: RenderPoint, m: number, n: number): RenderPoint {
  return { x: (m * b.x - n * a.x) / (m - n), y: (m * b.y - n * a.y) / (m - n) };
}
close(internalOracle(sectionA, sectionB, 1, 2).x, internalHand.x, "internal oracle matches the hand value");
close(internalOracle(sectionA, sectionB, 1, 2).y, internalHand.y, "internal oracle matches the hand y");
const externalHand = { x: 6, y: 25 / -3 };
const externalA = { x: 2, y: -3 };
const externalB = { x: -4, y: 5 };
const external = asPoint(one("section_point", { a: externalA, b: externalB, mode: "external", m: 2, n: 5 }), "external section");
close(external.point.x, externalHand.x, "external hand x");
close(external.point.y, externalHand.y, "external hand y");
close(externalOracle(externalA, externalB, 2, 5).x, externalHand.x, "external oracle matches the hand value");
const signed = asPoint(one("section_point", { a: { x: 1, y: 2 }, b: { x: 4, y: 8 }, mode: "internal", m: -1, n: 2 }), "signed section");
close(signed.point.x, -2, "signed section x");
close(signed.point.y, -4, "signed section y");
const midpoint = asPoint(one("section_point", { a: externalA, b: externalB, mode: "midpoint" }), "midpoint");
close(midpoint.point.x, -1, "midpoint x");
close(midpoint.point.y, 1, "midpoint y");
const asInternalMidpoint = asPoint(one("section_point", { a: externalA, b: externalB, mode: "internal", m: 1, n: 1 }), "internal midpoint");
close(asInternalMidpoint.point.x, midpoint.point.x, "1:1 internal agrees with midpoint x");
close(asInternalMidpoint.point.y, midpoint.point.y, "1:1 internal agrees with midpoint y");
for (const [m, n, mode] of [[2, 3, "internal"], [-2, 5, "internal"], [3, 1, "external"], [-4, 2, "external"]] as const) {
  const expected = mode === "internal" ? internalOracle(sectionA, sectionB, m, n) : externalOracle(sectionA, sectionB, m, n);
  const point = asPoint(one("section_point", { a: sectionA, b: sectionB, mode, m, n }), `${mode} ${m}:${n}`);
  close(point.point.x, expected.x, `${mode} parameter x`);
  close(point.point.y, expected.y, `${mode} parameter y`);
  const spread = { x: sectionB.x - sectionA.x, y: sectionB.y - sectionA.y };
  const offset = { x: point.point.x - sectionA.x, y: point.point.y - sectionA.y };
  close(offset.x * spread.y - offset.y * spread.x, 0, `${mode} collinearity`);
}
const flippedSection = asPoint(one("section_point", { a: sectionA, b: sectionB, mode: "internal", m: -1, n: 2 }), "flipped ratio");
check(Math.hypot(flippedSection.point.x - internalHand.x, flippedSection.point.y - internalHand.y) > 0.5, "flipping the ratio sign leaves the original section point");
for (const inputs of [
  { a: sectionA, b: sectionB, mode: "external", m: 2, n: 2 },
  { a: sectionA, b: sectionB, mode: "external", m: -3, n: -3 },
  { a: sectionA, b: sectionB, mode: "external", m: 1, n: 1 },
  { a: sectionA, b: sectionB, mode: "internal", m: 2, n: -2 },
  { a: sectionA, b: sectionB, mode: "internal", m: Infinity, n: 1 },
  { a: sectionA, b: sectionB, mode: "external", m: NaN, n: 1 },
  { a: sectionA, b: sectionB, mode: "midpoint", m: 1, n: 1 },
  { a: sectionA, b: sectionB, mode: "ratio", m: 1, n: 1 },
]) reject("section_point", inputs);

// Translation. x = X + h, y = Y + k. Advanced lists the shift; Main keeps it as an application.
const shift = { h: 2, k: -1 };
const sourcePoint = { x: 5, y: 7 };
const translatedPoint = asPoint(one("axis_translation", { ...shift, direction: "toNew", target: "point", point: sourcePoint }), "translated point");
close(translatedPoint.point.x, 3, "toNew x = x - h");
close(translatedPoint.point.y, 8, "toNew y = y - k");
check(translatedPoint.analyticLine.translation?.examScope.jeeMain === "application", "Main keeps shift of origin as an application");
check(translatedPoint.analyticLine.translation?.examScope.jeeAdvanced === "listed", "Advanced lists shift of origin");
check(translatedPoint.analyticLine.translation?.examScope.shiftOfOrigin === true, "shift-of-origin tag");
check(translatedPoint.analyticLine.translation?.linear[0] === 1 && translatedPoint.analyticLine.translation.linear[1] === 0 && translatedPoint.analyticLine.translation.linear[2] === 0 && translatedPoint.analyticLine.translation.linear[3] === 1, "translation linear part is the identity");
const restoredPoint = asPoint(one("axis_translation", { ...shift, direction: "toOld", target: "point", point: translatedPoint.point }), "reverse point");
close(restoredPoint.point.x, sourcePoint.x, "reverse translation restores x");
close(restoredPoint.point.y, sourcePoint.y, "reverse translation restores y");
const wrongSign = { x: sourcePoint.x - (-shift.h), y: sourcePoint.y - (-shift.k) };
check(Math.hypot(translatedPoint.point.x - wrongSign.x, translatedPoint.point.y - wrongSign.y) > 1, "wrong-sign shift fails the independent point check");
const vectorStart = asPoint(one("axis_translation", { h: 5, k: -3, direction: "toNew", target: "point", point: { x: 1, y: 2 } }), "vector start");
const vectorEnd = asPoint(one("axis_translation", { h: 5, k: -3, direction: "toNew", target: "point", point: { x: 4, y: 6 } }), "vector end");
close(vectorEnd.point.x - vectorStart.point.x, 3, "shift preserves the x component of a vector");
close(vectorEnd.point.y - vectorStart.point.y, 4, "shift preserves the y component of a vector");
const unmoved = asPoint(one("axis_translation", { h: 0, k: 0, direction: "toNew", target: "point", point: { x: 1, y: 0 } }), "zero shift");
close(unmoved.point.x, 1, "zero shift keeps x");
close(unmoved.point.y, 0, "zero shift keeps y");

const sourceLine = { a: 3, b: -4, c: 5 };
const translatedLine = asPath(one("axis_translation", { ...shift, direction: "toNew", target: "line", line: sourceLine }), "translated line");
close(translatedLine.analyticLine.coefficients!.a, 3, "translation keeps a");
close(translatedLine.analyticLine.coefficients!.b, -4, "translation keeps b");
close(translatedLine.analyticLine.coefficients!.c, 15, "translated constant term");
const witness = { x: -0.6, y: 0.8 };
close(residual(3, -4, 5, witness), 0, "hand witness lies on the source line");
const movedWitness = { x: witness.x - shift.h, y: witness.y - shift.k };
close(residual(3, -4, 15, movedWitness), 0, "shifted witness lies on the translated line");
const restoredLine = asPath(one("axis_translation", {
  ...shift,
  direction: "toOld",
  target: "line",
  line: translatedLine.analyticLine.coefficients,
}), "restored line");
const restoredNorm = normalizeOracle(restoredLine.analyticLine.coefficients!.a, restoredLine.analyticLine.coefficients!.b, restoredLine.analyticLine.coefficients!.c);
const sourceNorm = normalizeOracle(3, -4, 5);
close(restoredNorm.a, sourceNorm.a, "reverse line a");
close(restoredNorm.b, sourceNorm.b, "reverse line b");
close(restoredNorm.c, sourceNorm.c, "reverse line c");
const wrongLineC = 5 + 3 * (-shift.h) + (-4) * (-shift.k);
check(Math.abs((translatedLine.analyticLine.coefficients!.c) - wrongLineC) > 1, "wrong-sign shift fails the independent line check");

const translatedCircle = asCircle(one("axis_translation", {
  h: 1,
  k: -2,
  direction: "toNew",
  target: "circle",
  circle: { center: { x: 3, y: 4 }, radius: 5 },
}), "translated circle");
close(translatedCircle.center.x, 2, "circle center x");
close(translatedCircle.center.y, 6, "circle center y");
close(translatedCircle.radius, 5, "translation preserves radius");
const rim = { x: 8 - 1, y: 4 - (-2) };
close(hypot(rim, translatedCircle.center), 5, "a rim point stays on the translated circle");
const fromEquation = asCircle(one("axis_translation", {
  h: 1,
  k: -2,
  direction: "toNew",
  target: "circle",
  circle: { d: -6, e: -8, f: 0 },
}), "translated circle equation");
close(fromEquation.center.x, 2, "equation-form center x");
close(fromEquation.center.y, 6, "equation-form center y");
close(fromEquation.radius, 5, "equation-form radius");
close(fromEquation.analyticLine.circleEquation!.d, -4, "substituted d");
close(fromEquation.analyticLine.circleEquation!.e, -12, "substituted e");
close(fromEquation.analyticLine.circleEquation!.f, 15, "substituted f");

const translatedConic = asPoint(one("axis_translation", {
  h: 1,
  k: 1,
  direction: "toNew",
  target: "conic",
  conic: { a: 1, b: 0, c: 0, d: 0, e: -1, f: 0 },
  witness: { x: 2, y: 4 },
}), "translated parabola");
close(translatedConic.point.x, 1, "conic witness x");
close(translatedConic.point.y, 3, "conic witness y");
const simpleConic = translatedConic.analyticLine.conic!;
close(simpleConic.a, 1, "parabola a");
close(simpleConic.d, 2, "parabola d");
close(simpleConic.e, -1, "parabola e");
close(simpleConic.f, 0, "parabola f");
check(Math.abs(2 * 0.5 - 1) < 1e-12, "xy = 1 holds at the holdout witness");
const holdoutConic = asPoint(one("axis_translation", {
  h: 2,
  k: -1,
  direction: "toNew",
  target: "conic",
  conic: { a: 0, b: 1, c: 0, d: 0, e: 0, f: -1 },
  witness: { x: 2, y: 0.5 },
}), "holdout conic");
const holdoutCoefficients = holdoutConic.analyticLine.conic!;
close(holdoutCoefficients.a, 0, "holdout conic a");
close(holdoutCoefficients.b, 1, "holdout conic b");
close(holdoutCoefficients.c, 0, "holdout conic c");
close(holdoutCoefficients.d, -1, "holdout conic d");
close(holdoutCoefficients.e, 2, "holdout conic e");
close(holdoutCoefficients.f, -3, "holdout conic f");
close(holdoutConic.point.x, 0, "holdout witness image x");
close(holdoutConic.point.y, 1.5, "holdout witness image y");
for (const key of ["rotation", "angle", "theta", "matrix"]) {
  reject("axis_translation", { ...shift, direction: "toNew", target: "point", point: sourcePoint, [key]: 90 }, `supplied ${key} is not a shift`);
}
reject("axis_translation", { ...shift, direction: "rotate", target: "point", point: sourcePoint });
reject("axis_translation", { h: 1, k: 1, direction: "toNew", target: "conic", conic: { a: 1, b: 0, c: 0, d: 0, e: -1, f: 0 }, witness: { x: 0, y: 1 } }, "off-curve witness");

// Slope, parallel, perpendicular.
const positiveSlope = asPath(one("line_relation", { mode: "slope", line: { a: 2, b: -4, c: 1 } }), "positive slope");
close(positiveSlope.analyticLine.slope!, 0.5, "finite slope -a/b");
check(positiveSlope.analyticLine.slopeDefined === true, "finite slope is defined");
const zeroSlope = asPath(one("line_relation", { mode: "slope", line: { a: 0, b: 1, c: -3 } }), "zero slope");
close(zeroSlope.analyticLine.slope!, 0, "horizontal slope");
const undefinedSlope = asPath(one("line_relation", { mode: "slope", line: { a: 1, b: 0, c: -2 } }), "undefined slope");
check(undefinedSlope.analyticLine.slope === null && undefinedSlope.analyticLine.slopeDefined === false, "vertical slope stays null");
check(undefinedSlope.analyticLine.slope !== Number.POSITIVE_INFINITY, "vertical slope is not a fake infinity");
const negativeSlope = asPath(one("line_relation", { mode: "slope", p: { x: 0, y: 0 }, q: { x: -2, y: 2 } }), "negative direction");
close(negativeSlope.analyticLine.slope!, -1, "negative run still has slope dy/dx");
check((negativeSlope.analyticLine.direction?.x ?? 0) < 0, "point order keeps the negative direction");
const verticalPoints = asPath(one("line_relation", { mode: "slope", p: { x: 3, y: 1 }, q: { x: 3, y: -4 } }), "vertical points");
check(verticalPoints.analyticLine.slope === null, "vertical point pair has no finite slope");
reject("line_relation", { mode: "slope", p: { x: 1, y: 1 }, q: { x: 1, y: 1 } }, "coincident-point direction");
const parallel = asPath(one("line_relation", {
  mode: "relations",
  line: { a: 0, b: 1, c: -2 },
  other: { a: 0, b: 1, c: -5 },
}), "parallel horizontals");
check(parallel.analyticLine.parallel === true && parallel.analyticLine.perpendicular === false && parallel.analyticLine.coincidentLines === false, "distinct horizontals are parallel");
close(parallel.analyticLine.angleRadians!, 0, "parallel angle");
const coincidentLines = asPath(one("line_relation", {
  mode: "relations",
  line: { a: 2, b: -3, c: 1 },
  other: { a: -4, b: 6, c: -2 },
}), "opposite coefficients");
check(coincidentLines.analyticLine.parallel === true && coincidentLines.analyticLine.coincidentLines === true && coincidentLines.analyticLine.sameSense === false, "negative direction remains the same line");
const perpendicular = asPath(one("line_relation", {
  mode: "relations",
  line: { a: 0, b: 1, c: -2 },
  other: { a: 1, b: 0, c: -1 },
}), "horizontal and vertical");
check(perpendicular.analyticLine.perpendicular === true && perpendicular.analyticLine.parallel === false, "axis-parallel lines are perpendicular");
check(perpendicular.analyticLine.slope === 0, "horizontal member keeps slope 0");
close(perpendicular.analyticLine.angleRadians!, Math.PI / 2, "right angle");
const negativePerpendicular = asPath(one("line_relation", {
  mode: "relations",
  p: { x: 0, y: 0 },
  q: { x: 1, y: 0 },
  r: { x: 0, y: 0 },
  s: { x: 0, y: -1 },
}), "negative perpendicular direction");
check(negativePerpendicular.analyticLine.perpendicular === true && negativePerpendicular.analyticLine.sameSense === false, "a downward vertical is still perpendicular");
const verticalParallel = asPath(one("line_relation", {
  mode: "relations",
  line: { a: 1, b: 0, c: -1 },
  other: { a: 2, b: 0, c: -8 },
}), "vertical parallels");
check(verticalParallel.analyticLine.parallel === true && verticalParallel.analyticLine.slope === null, "vertical parallels never acquire a finite slope");
reject("line_relation", { mode: "relations", line: { a: 0, b: 0, c: 1 }, other: { a: 1, b: 0, c: 0 } });
reject("line_relation", { mode: "slope", line: { a: 1, b: -1, c: 0 }, displayScale: 4 });

// Intercepts.
const finiteIntercepts = asPath(one("line_intercepts", { a: 2, b: 3, c: -6 }), "finite intercepts");
close(finiteIntercepts.analyticLine.xIntercept!.x, 3, "x-intercept");
close(finiteIntercepts.analyticLine.xIntercept!.y, 0, "x-intercept on the axis");
close(finiteIntercepts.analyticLine.yIntercept!.x, 0, "y-intercept on the axis");
close(finiteIntercepts.analyticLine.yIntercept!.y, 2, "y-intercept");
close(residual(2, 3, -6, finiteIntercepts.analyticLine.xIntercept!), 0, "x-intercept satisfies the line");
close(residual(2, 3, -6, finiteIntercepts.analyticLine.yIntercept!), 0, "y-intercept satisfies the line");
const throughOrigin = asPath(one("line_intercepts", { a: 2, b: 3, c: 0 }), "through origin");
close(throughOrigin.analyticLine.xIntercept!.x, 0, "origin x-intercept");
close(throughOrigin.analyticLine.yIntercept!.y, 0, "origin y-intercept");
check(throughOrigin.analyticLine.throughOrigin === true && throughOrigin.analyticLine.xAxisCoincident === false, "oblique origin line");
const horizontalIntercept = asPath(one("line_intercepts", { a: 0, b: 1, c: -3 }), "horizontal intercept");
check(horizontalIntercept.analyticLine.xIntercept === null && horizontalIntercept.analyticLine.xAxisCoincident === false, "horizontal line has no x-intercept");
close(horizontalIntercept.analyticLine.yIntercept!.y, 3, "horizontal y-intercept");
const verticalIntercept = asPath(one("line_intercepts", { a: 1, b: 0, c: 2 }), "vertical intercept");
check(verticalIntercept.analyticLine.yIntercept === null && verticalIntercept.analyticLine.yAxisCoincident === false, "vertical line has no y-intercept");
close(verticalIntercept.analyticLine.xIntercept!.x, -2, "vertical x-intercept");
const xAxis = asPath(one("line_intercepts", { a: 0, b: 1, c: 0 }), "x-axis");
check(xAxis.analyticLine.xIntercept === null && xAxis.analyticLine.xAxisCoincident === true, "x-axis intercept is not a single finite point");
close(xAxis.analyticLine.yIntercept!.x, 0, "x-axis meets the y-axis at the origin x");
close(xAxis.analyticLine.yIntercept!.y, 0, "x-axis meets the y-axis at the origin y");
const yAxis = asPath(one("line_intercepts", { a: 1, b: 0, c: 0 }), "y-axis");
check(yAxis.analyticLine.yIntercept === null && yAxis.analyticLine.yAxisCoincident === true, "y-axis intercept is not a single finite point");
close(yAxis.analyticLine.xIntercept!.x, 0, "y-axis x-intercept");
for (const geometry of [horizontalIntercept, verticalIntercept, xAxis, yAxis, finiteIntercepts]) {
  check(!containsNonFinite(geometry.analyticLine), "missing intercepts stay null instead of a fake infinity");
}
const scaledIntercepts = asPath(one("line_intercepts", { a: 2, b: 3, c: -6, displayLength: 4 }), "display intercept span");
close(scaledIntercepts.analyticLine.xIntercept!.x, 3, "display length keeps the x-intercept");
close(scaledIntercepts.analyticLine.yIntercept!.y, 2, "display length keeps the y-intercept");
close(hypot(scaledIntercepts.points[0]!, scaledIntercepts.points[1]!), 4, "display length changes only the drawn span");
reject("line_intercepts", { a: 0, b: 0, c: 1 });
reject("line_intercepts", { a: 0, b: 0, c: 0 });
reject("line_intercepts", { a: 1, b: 1, c: 0, displayScale: 8 });

// Line equations. Equivalent forms meet after an independent normalization.
function expectNormalized(geometry: AnalyticLineGeometry, a: number, b: number, c: number, message: string): AnalyticLineRecord {
  const path = asPath(geometry, message);
  const expected = normalizeOracle(a, b, c);
  const actual = path.analyticLine.normalized!;
  close(actual.a, expected.a, `${message} normalized a`);
  close(actual.b, expected.b, `${message} normalized b`);
  close(actual.c, expected.c, `${message} normalized c`);
  const anchor = { x: (path.points[0]!.x + path.points[1]!.x) / 2, y: (path.points[0]!.y + path.points[1]!.y) / 2 };
  close(residual(path.analyticLine.coefficients!.a, path.analyticLine.coefficients!.b, path.analyticLine.coefficients!.c, anchor), 0, `${message} anchor incidence`);
  return path.analyticLine;
}
const generalLine = expectNormalized(one("line_equation", { form: "general", a: 3, b: 2, c: -6 }), 3, 2, -6, "general");
expectNormalized(one("line_equation", { form: "general", a: -6, b: -4, c: 12 }), 3, 2, -6, "scaled general");
expectNormalized(one("line_equation", { form: "pointSlope", point: { x: 2, y: 0 }, slope: -1.5 }), 3, 2, -6, "point-slope");
expectNormalized(one("line_equation", { form: "twoPoint", p: { x: 2, y: 0 }, q: { x: 0, y: 3 } }), 3, 2, -6, "two-point");
expectNormalized(one("line_equation", { form: "intercept", xIntercept: 2, yIntercept: 3 }), 3, 2, -6, "intercept");
const unit = normalizeOracle(3, 2, -6);
expectNormalized(one("line_equation", { form: "normal", normal: { alpha: Math.atan2(unit.b, unit.a), p: -unit.c } }), 3, 2, -6, "normal");
close(generalLine.slope!, -1.5, "general slope");
expectNormalized(one("line_equation", { form: "general", a: 1, b: 0, c: -4 }), 1, 0, -4, "vertical general");
const verticalForm = expectNormalized(one("line_equation", { form: "pointSlope", point: { x: 4, y: 2 }, slope: null }), 1, 0, -4, "vertical point-slope");
check(verticalForm.slope === null && verticalForm.slopeDefined === false, "vertical equation has undefined slope");
expectNormalized(one("line_equation", { form: "twoPoint", p: { x: 4, y: -1 }, q: { x: 4, y: 5 } }), 1, 0, -4, "vertical two-point");
expectNormalized(one("line_equation", { form: "normal", normal: { alpha: 0, p: 4 } }), 1, 0, -4, "vertical normal");
expectNormalized(one("line_equation", { form: "normal", normal: { alpha: Math.PI, p: -4 } }), 1, 0, -4, "opposite normal");
const negativeIntercept = asPath(one("line_equation", { form: "intercept", xIntercept: -2, yIntercept: 4 }), "negative intercepts");
close(residual(negativeIntercept.analyticLine.coefficients!.a, negativeIntercept.analyticLine.coefficients!.b, negativeIntercept.analyticLine.coefficients!.c, { x: -2, y: 0 }), 0, "negative x-intercept incidence");
close(residual(negativeIntercept.analyticLine.coefficients!.a, negativeIntercept.analyticLine.coefficients!.b, negativeIntercept.analyticLine.coefficients!.c, { x: 0, y: 4 }), 0, "negative y-intercept incidence");
reject("line_equation", { form: "twoPoint", p: { x: 4, y: 2 }, q: { x: 4, y: 2 } }, "identical two-point inputs");
reject("line_equation", { form: "general", a: 0, b: 0, c: 3 });
reject("line_equation", { form: "intercept", xIntercept: 0, yIntercept: 4 });
reject("line_equation", { form: "intercept", xIntercept: 2, yIntercept: 0 });
reject("line_equation", { form: "pointSlope", point: { x: 1, y: 1 }, slope: Infinity });
reject("line_equation", { form: "normal", normal: { alpha: 0, p: 1, rotation: 1 } });
reject("line_equation", { form: "general", a: 1, b: -1, c: 0, angle: 30 });

// Intersection angle. The 2x2 solution below is the test oracle; the hand point guards it.
const crossingA = { a: 1, b: 1, c: -1 };
const crossingB = { a: 1, b: -1, c: 0 };
const crossingOracle = solve2(crossingA, crossingB);
close(crossingOracle.x, 0.5, "hand intersection x");
close(crossingOracle.y, 0.5, "hand intersection y");
const crossing = asPoint(one("line_intersection_angle", { first: crossingA, second: crossingB }), "intersecting lines");
close(crossing.point.x, 0.5, "operator intersection x");
close(crossing.point.y, 0.5, "operator intersection y");
close(crossing.analyticLine.angleRadians!, Math.PI / 2, "slope 1 and slope -1 are perpendicular");
close(crossing.analyticLine.angleRadians!, acuteOracle(directionOracle(crossingA), directionOracle(crossingB)), "atan2 oracle");
const fortyFive = asPoint(one("line_intersection_angle", {
  first: { a: 0, b: 1, c: 0 },
  second: { a: 1, b: -1, c: 0 },
}), "forty-five degree lines");
close(fortyFive.point.x, 0, "forty-five intersection x");
close(fortyFive.point.y, 0, "forty-five intersection y");
close(fortyFive.analyticLine.angleRadians!, Math.PI / 4, "horizontal against y=x is pi/4");
check(crossing.analyticLine.relation === "intersecting" && crossing.analyticLine.angleConvention === "acute", "acute intersecting convention");
check(crossing.analyticLine.angleRadians! >= 0 && crossing.analyticLine.angleRadians! <= Math.PI / 2, "angle is in [0, pi/2]");

const holdoutFirst = { a: 2, b: -1, c: 1 };
const holdoutSecond = { a: 1, b: 1, c: -4 };
const holdoutSolve = solve2(holdoutFirst, holdoutSecond);
close(holdoutSolve.x, 1, "holdout hand intersection x");
close(holdoutSolve.y, 3, "holdout hand intersection y");
const holdoutAngle = asPoint(one("line_intersection_angle", { first: holdoutFirst, second: holdoutSecond }), "holdout intersection");
close(holdoutAngle.point.x, holdoutSolve.x, "holdout intersection x");
close(holdoutAngle.point.y, holdoutSolve.y, "holdout intersection y");
close(holdoutAngle.analyticLine.angleRadians!, Math.atan2(3, 1), "holdout atan2 angle");
close(residual(2, -1, 1, holdoutAngle.point), 0, "holdout incidence on the first line");
close(residual(1, 1, -4, holdoutAngle.point), 0, "holdout incidence on the second line");
const flippedHoldout = asPoint(one("line_intersection_angle", { first: holdoutFirst, second: { a: -1, b: -1, c: 4 } }), "reversed direction");
close(flippedHoldout.point.x, 1, "reversed direction keeps the intersection x");
close(flippedHoldout.analyticLine.angleRadians!, holdoutAngle.analyticLine.angleRadians!, "absolute cross and dot keep the acute angle");

const parallelLines = asPath(one("line_intersection_angle", {
  first: { a: 0, b: 1, c: -1 },
  second: { a: 0, b: 1, c: 4 },
}), "parallel lines");
check(parallelLines.kind === "path" && parallelLines.analyticLine.intersection === null && parallelLines.analyticLine.relation === "parallel", "parallel lines do not invent a point");
close(parallelLines.analyticLine.angleRadians!, 0, "parallel acute angle");
const coincidentPair = asPath(one("line_intersection_angle", {
  first: { a: 1, b: -1, c: 1 },
  second: { a: 2, b: -2, c: 2 },
}), "coincident lines");
check(coincidentPair.analyticLine.relation === "coincident" && coincidentPair.analyticLine.intersection === null, "coincident lines are not a unique point");
close(coincidentPair.analyticLine.angleRadians!, 0, "coincident angle");
const verticalCross = asPoint(one("line_intersection_angle", {
  first: { a: 1, b: 0, c: 0 },
  second: { a: 1, b: -1, c: 0 },
}), "vertical intersection");
close(verticalCross.point.x, 0, "vertical intersection x");
close(verticalCross.point.y, 0, "vertical intersection y");
close(verticalCross.analyticLine.angleRadians!, Math.PI / 4, "vertical against y=x");
check(verticalCross.analyticLine.slope === undefined || verticalCross.analyticLine.direction?.x === 0, "vertical direction has no horizontal component");
reject("line_intersection_angle", { first: { a: 0, b: 0, c: 1 }, second: { a: 1, b: 0, c: 0 } }, "zero direction");
reject("line_intersection_angle", { first: crossingA, second: crossingB, projectedAngle: 1 });

// Concurrence. Determinant zero is recorded and is not enough to return a point.
const originLines = [
  { a: 1, b: 0, c: 0 },
  { a: 0, b: 1, c: 0 },
  { a: 1, b: 1, c: 0 },
] as const;
const originMeet = asPoint(one("line_concurrence", { first: originLines[0], second: originLines[1], third: originLines[2] }), "origin concurrence");
close(originMeet.point.x, 0, "origin concurrence x");
close(originMeet.point.y, 0, "origin concurrence y");
check(originMeet.analyticLine.concurrent === true, "origin lines are concurrent");
for (const line of originLines) close(residual(line.a, line.b, line.c, originMeet.point), 0, "origin point satisfies every line");

const holdoutLines = [
  { a: 1, b: 0, c: -3 },
  { a: 0, b: 1, c: 2 },
  { a: 2, b: 1, c: -4 },
] as const;
const holdoutExpected = solve2(holdoutLines[0], holdoutLines[1]);
close(holdoutExpected.x, 3, "holdout concurrence hand x");
close(holdoutExpected.y, -2, "holdout concurrence hand y");
close(residual(2, 1, -4, { x: 3, y: -2 }), 0, "holdout third line passes through the hand point");
const holdoutMeet = asPoint(one("line_concurrence", { first: holdoutLines[0], second: holdoutLines[1], third: holdoutLines[2] }), "holdout concurrence");
close(holdoutMeet.point.x, 3, "holdout concurrence x");
close(holdoutMeet.point.y, -2, "holdout concurrence y");
check(holdoutMeet.analyticLine.concurrent === true && holdoutMeet.analyticLine.commonPoint?.x === holdoutMeet.point.x, "unique common point");

const triangleLines = [
  { a: 1, b: 0, c: 0 },
  { a: 0, b: 1, c: 0 },
  { a: 1, b: 1, c: -1 },
] as const;
const pairwise = [
  solve2(triangleLines[0], triangleLines[1]),
  solve2(triangleLines[0], triangleLines[2]),
  solve2(triangleLines[1], triangleLines[2]),
];
check(new Set(pairwise.map((point) => `${point.x},${point.y}`)).size === 3, "pairwise intersections are distinct");
const notConcurrent = asPath(one("line_concurrence", { first: triangleLines[0], second: triangleLines[1], third: triangleLines[2] }), "pairwise distinct");
check(notConcurrent.kind === "path" && notConcurrent.analyticLine.concurrent === false && notConcurrent.analyticLine.commonPoint === null, "distinct pairwise intersections are not a common point");
check(notConcurrent.analyticLine.concurrenceReason === "pairwise-distinct", "pairwise reason");

const parallelTriple = [
  { a: 1, b: 0, c: 0 },
  { a: 1, b: 0, c: -1 },
  { a: 1, b: 0, c: -2 },
] as const;
close(det3(parallelTriple.map((line) => [line.a, line.b, line.c] as [number, number, number]) as unknown as [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]), 0, "three parallel lines have determinant zero");
const parallelConcurrence = asPath(one("line_concurrence", { first: parallelTriple[0], second: parallelTriple[1], third: parallelTriple[2] }), "three parallel lines");
check(parallelConcurrence.kind === "path" && parallelConcurrence.analyticLine.concurrent === false && parallelConcurrence.analyticLine.commonPoint === null, "determinant zero does not certify a point for parallel lines");
check(parallelConcurrence.analyticLine.concurrenceReason === "parallel", "parallel reason");
close(parallelConcurrence.analyticLine.determinant!, 0, "stored determinant agrees with the independent expansion");

const repeatedTransversal = [
  { a: 1, b: 0, c: 0 },
  { a: 2, b: 0, c: 0 },
  { a: 0, b: 1, c: -4 },
] as const;
close(det3(repeatedTransversal.map((line) => [line.a, line.b, line.c]) as unknown as [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]), 0, "a repeated line also has determinant zero");
const repeatedMeet = asPoint(one("line_concurrence", { first: repeatedTransversal[0], second: repeatedTransversal[1], third: repeatedTransversal[2] }), "repeated line plus transversal");
close(repeatedMeet.point.x, 0, "repeated transversal x");
close(repeatedMeet.point.y, 4, "repeated transversal y");
for (const line of repeatedTransversal) close(residual(line.a, line.b, line.c, repeatedMeet.point), 0, "repeated transversal substitution");

const allCoincident = asPath(one("line_concurrence", {
  first: { a: 1, b: 1, c: 1 },
  second: { a: 2, b: 2, c: 2 },
  third: { a: 3, b: 3, c: 3 },
}), "three coincident lines");
check(allCoincident.analyticLine.concurrent === false && allCoincident.analyticLine.concurrenceReason === "coincident" && allCoincident.analyticLine.commonPoint === null, "coincident lines are not a unique point");
const coincidentParallel = asPath(one("line_concurrence", {
  first: { a: 1, b: 1, c: 1 },
  second: { a: 2, b: 2, c: 2 },
  third: { a: 1, b: 1, c: 4 },
}), "coincident pair plus a parallel");
check(coincidentParallel.analyticLine.concurrent === false && coincidentParallel.analyticLine.commonPoint === null, "a parallel third line leaves no common point");
reject("line_concurrence", { first: { a: 0, b: 0, c: 1 }, second: { a: 1, b: 0, c: 0 }, third: { a: 0, b: 1, c: 0 } });

// Point-to-line distance.
const distancePoint = { x: 1, y: 2 };
const distanceLine = { a: 3, b: 4, c: -5 };
const workedFoot = one("point_line_distance", { point: distancePoint, ...distanceLine });
const workedFootPath = asPath(workedFoot, "foot segment");
close(workedFootPath.analyticLine.distance!, 1.2, "worked distance");
close(workedFootPath.analyticLine.distance!, Math.abs(3 + 8 - 5) / 5, "formula distance");
close(workedFootPath.analyticLine.foot!.x, 7 / 25, "foot x");
close(workedFootPath.analyticLine.foot!.y, 26 / 25, "foot y");
close(residual(3, 4, -5, workedFootPath.analyticLine.foot!), 0, "foot incidence");
close(hypot(distancePoint, workedFootPath.analyticLine.foot!), 1.2, "foot segment length matches the formula");
const step = { x: distancePoint.x - 7 / 25, y: distancePoint.y - 26 / 25 };
const normal = { x: 3, y: 4 };
close(step.x * normal.y - step.y * normal.x, 0, "foot step is parallel to the normal");
close(step.x * -4 + step.y * 3, 0, "foot segment is perpendicular to direction (-b, a)");
const flippedDistance = asPath(one("point_line_distance", { point: distancePoint, a: 3, b: 4, c: 5 }), "sign-flipped line");
check(Math.abs(flippedDistance.analyticLine.distance! - 1.2) > 0.5, "flipping c changes the distance");
check(residual(3, 4, 5, { x: 7 / 25, y: 26 / 25 }) > 1, "the original foot fails incidence after the sign flip");

const holdoutFoot = asPath(one("point_line_distance", { point: { x: 1, y: 1 }, a: 2, b: -1, c: 4 }), "holdout distance");
close(holdoutFoot.analyticLine.distance!, Math.sqrt(5), "holdout distance");
close(holdoutFoot.analyticLine.foot!.x, -1, "holdout foot x");
close(holdoutFoot.analyticLine.foot!.y, 2, "holdout foot y");
close(residual(2, -1, 4, holdoutFoot.analyticLine.foot!), 0, "holdout foot incidence");

const verticalDistance = asPath(one("point_line_distance", { point: { x: 0, y: 7 }, a: 1, b: 0, c: -4 }), "vertical distance");
close(verticalDistance.analyticLine.distance!, 4, "vertical distance");
close(verticalDistance.analyticLine.foot!.x, 4, "vertical foot x");
close(verticalDistance.analyticLine.foot!.y, 7, "vertical foot y");
const horizontalDistance = asPath(one("point_line_distance", { point: { x: 5, y: 3 }, a: 0, b: 1, c: 2, displayLength: 9 }), "horizontal distance");
close(horizontalDistance.analyticLine.distance!, 5, "horizontal world distance");
close(hypot(horizontalDistance.points[0]!, horizontalDistance.points[1]!), 9, "display length does not replace the world distance");
close(horizontalDistance.analyticLine.foot!.x, 5, "horizontal foot x");
close(horizontalDistance.analyticLine.foot!.y, -2, "horizontal foot y");
const onLine = asPoint(one("point_line_distance", { point: { x: 4, y: 7 }, a: 1, b: 0, c: -4 }), "point on the line");
close(onLine.analyticLine.distance!, 0, "incidence distance is 0");
close(onLine.analyticLine.signedDistance!, 0, "incidence signed distance is 0");
close(onLine.point.x, 4, "on-line point x");
close(onLine.point.y, 7, "on-line point y");
reject("point_line_distance", { point: { x: 0, y: 0 }, a: 0, b: 0, c: 1 });
reject("point_line_distance", { point: { x: 4, y: 7 }, a: 1, b: 0, c: -4, displayLength: 3 }, "on-line display length");
reject("point_line_distance", { point: { x: 0, y: 7 }, a: 1, b: 0, c: -4, displayScale: 12 });
reject("point_line_distance", { point: { x: { value: 0, unit: "px" }, y: 7 }, a: 1, b: 0, c: -4 });

function scene(construction: SceneConstruction, kinds: Record<string, string>, quantities: Array<{ id: string; value: unknown }> = []): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "analytic line" },
    source: {},
    quantities,
    entities: Object.entries(kinds).map(([id, kind]) => ({ id, kind, role: "analytic line" })),
    constructions: [construction],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: construction.outputs,
    revealGroups: [{ id: "line", entityIds: construction.outputs, dependsOn: [], narrationCue: "line" }],
    teachingTimeline: [],
  };
}
function issuesFor(document: SceneDocument, index = document.constructions.length - 1): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const byOutput = new Map(document.constructions.flatMap((construction) => construction.outputs.map((output) => [output, construction] as const)));
  validateAnalyticLineConstruction(document.constructions[index]!, index, document, byOutput, issues);
  return issues;
}
const goodDistance: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "analytic line" },
  source: {},
  quantities: [{ id: "x1", value: 0 }, { id: "y1", value: 0 }, { id: "x2", value: 3 }, { id: "y2", value: 4 }],
  entities: [
    { id: "A", kind: "point", role: "endpoint" },
    { id: "B", kind: "point", role: "endpoint" },
    { id: "seg", kind: "segment", role: "distance" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: "x1", y: "y1" }, outputs: ["A"] },
    { id: "make_b", operator: "point", inputs: { x: "x2", y: "y2" }, outputs: ["B"] },
    { id: "make_distance", operator: "coordinate_distance", inputs: { a: "A", b: "B" }, outputs: ["seg"] },
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["A", "B", "seg"],
  revealGroups: [{ id: "line", entityIds: ["A", "B", "seg"], dependsOn: [], narrationCue: "distance" }],
  teachingTimeline: [],
};
check(issuesFor(goodDistance).length === 0, "a resolved distance document has no issues");
const goodLine = scene(
  { id: "make_line", operator: "line_equation", inputs: { form: "general", a: 1, b: -1, c: 0 }, outputs: ["ln"] },
  { ln: "line" },
);
check(issuesFor(goodLine).length === 0, "a general line document has no issues");
const badCoefficients = scene(
  { id: "bad_line", operator: "line_intercepts", inputs: { a: 0, b: 0, c: 1 }, outputs: ["ln"] },
  { ln: "line" },
);
check(issuesFor(badCoefficients).some((issue) => issue.severity === "fatal"), "a=b=0 is fatal");
const badDistance = scene(
  { id: "bad_distance", operator: "point_line_distance", inputs: { point: { x: 0, y: 0 }, a: 0, b: 0, c: 2 }, outputs: ["foot"] },
  { foot: "segment" },
);
check(issuesFor(badDistance).some((issue) => issue.severity === "fatal"), "a=b=0 distance is fatal");
const identicalPoints = scene(
  { id: "bad_points", operator: "line_equation", inputs: { form: "twoPoint", p: { x: 4, y: 2 }, q: { x: 4, y: 2 } }, outputs: ["ln"] },
  { ln: "line" },
);
check(issuesFor(identicalPoints).some((issue) => issue.severity === "fatal"), "identical two-point inputs are fatal");
const externalInfinity = scene(
  { id: "bad_section", operator: "section_point", inputs: { a: { x: 0, y: 0 }, b: { x: 2, y: 2 }, mode: "external", m: 2, n: 2 }, outputs: ["P"] },
  { P: "point" },
);
check(issuesFor(externalInfinity).some((issue) => issue.severity === "fatal"), "external m=n is fatal");
const unknownScale = scene(
  { id: "bad_scale", operator: "coordinate_distance", inputs: { a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, displayScale: 2 }, outputs: ["seg"] },
  { seg: "segment" },
);
check(issuesFor(unknownScale).some((issue) => issue.severity === "fatal"), "displayScale is a fatal document input");
let validationThrew = false;
try { issuesFor(badCoefficients); }
catch { validationThrew = true; }
check(!validationThrew, "validate converts a bad line into issues instead of escaping");

console.log(`analytic line operators verified: ${checks} independent metric and rejection checks`);
