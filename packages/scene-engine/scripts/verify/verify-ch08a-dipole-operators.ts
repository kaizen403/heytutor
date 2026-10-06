import type { RenderPoint, SceneDocument, SceneIssue } from "../../src/types";
import { evaluateFieldConstruction } from "../../src/compile/fieldGeometry";
import {
  DIPOLE_FIELD_OPERATORS,
  evaluateDipoleFieldConstruction,
  validateDipoleFieldConstruction,
  type DipoleFieldEvaluationContext,
  type DipoleGeometry,
  type ExamScope,
} from "../../src/compile/dipoleFieldGeometry";

const quantities = new Map<string, number>([["coulomb_k", 1]]);
const context: DipoleFieldEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    if (typeof value === "string" && quantities.has(value)) return quantities.get(value)!;
    const resolved = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(resolved)) throw new Error("not finite");
    return resolved;
  },
  point(value) {
    if (value === "projected") return { x: 1, y: 2 };
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
      return { x: context.number(value.x), y: context.number(value.y) };
    }
    throw new Error("not a point");
  },
  geometry(value) {
    if (value === "projected") return { kind: "point", point: { x: 1, y: 2 }, world3D: { x: 1, y: 2, z: 9 }, projectedAngle: 0.4 };
    return undefined;
  },
};

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(message);
}
function close(actual: number, expected: number, message: string, tolerance = 1e-9): void {
  check(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function rejects(run: () => void, message: string): void {
  let threw = false;
  try { run(); } catch { threw = true; }
  check(threw, message);
}
function distance(a: RenderPoint, b: RenderPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function dot(a: RenderPoint, b: RenderPoint): number { return a.x * b.x + a.y * b.y; }
function sub(a: RenderPoint, b: RenderPoint): RenderPoint { return { x: a.x - b.x, y: a.y - b.y }; }

/** Independent point-charge field. E = k q r_hat / r^2, with r_hat from the source to the point. */
function oracleField(charge: number, source: RenderPoint, at: RenderPoint, k: number): RenderPoint {
  const dx = at.x - source.x;
  const dy = at.y - source.y;
  const radiusSquared = dx * dx + dy * dy;
  const radius = Math.sqrt(radiusSquared);
  const factor = k * charge / (radiusSquared * radius);
  return { x: factor * dx, y: factor * dy };
}
function oracleSuperposition(charges: Array<{ charge: number; position: RenderPoint }>, at: RenderPoint, k: number): RenderPoint {
  return charges.reduce((sum, source) => {
    const part = oracleField(source.charge, source.position, at, k);
    return { x: sum.x + part.x, y: sum.y + part.y };
  }, { x: 0, y: 0 });
}
/** Force on the second charge. F = k q1 q2 r_hat / r^2 with r_hat from the first charge to the second. */
function oracleForceOnSecond(q1: number, p1: RenderPoint, q2: number, p2: RenderPoint, k: number): RenderPoint {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const radiusSquared = dx * dx + dy * dy;
  const radius = Math.sqrt(radiusSquared);
  const factor = k * q1 * q2 / (radiusSquared * radius);
  return { x: factor * dx, y: factor * dy };
}
/** Page-normal τ = p × E. Out of the page is positive. */
function oracleTau(p: RenderPoint, E: RenderPoint): number { return p.x * E.y - p.y * E.x; }
function oraclePotential(charges: Array<{ charge: number; position: RenderPoint }>, at: RenderPoint, k: number): number {
  return charges.reduce((sum, source) => sum + k * source.charge / distance(at, source.position), 0);
}

function run(operator: string, inputs: Record<string, unknown>): DipoleGeometry[] {
  return evaluateDipoleFieldConstruction(operator, inputs, context);
}
function one(operator: string, inputs: Record<string, unknown>): DipoleGeometry {
  const result = run(operator, inputs);
  check(result.length === 1, `${operator} returns one geometry`);
  return result[0]!;
}
function vectorOf(geometry: DipoleGeometry): RenderPoint {
  check(geometry.dipoleField.components !== undefined, "vector metadata");
  return geometry.dipoleField.components;
}
function exams(scope: ExamScope, main: "listed" | "application", advanced: "listed" | "application", neet: "listed" | "application", message: string): void {
  check(scope["JEE Main 2026"] === main && scope["JEE Advanced 2026"] === advanced && scope["NEET-UG 2026"] === neet, message);
}

check(DIPOLE_FIELD_OPERATORS.length === 7, "dipole field operator inventory");
rejects(() => run("charged_ring", {}), "charged rings are outside CH-08a");

const like = run("coulomb_pair", {
  charges: [{ position: { x: 0, y: 0 }, charge: 2 }, { position: { x: 3, y: 0 }, charge: 4 }],
  k: "coulomb_k", displayLength: 2,
});
check(like.length === 2, "coulomb pair has one force on each charge");
const likeOnSecond = oracleForceOnSecond(2, { x: 0, y: 0 }, 4, { x: 3, y: 0 }, 1);
const likeFirst = vectorOf(like[0]!);
const likeSecond = vectorOf(like[1]!);
close(likeSecond.x, likeOnSecond.x, "like-charge repulsion on the second charge");
close(likeSecond.y, 0, "axial coulomb force has no transverse part");
close(likeFirst.x, -likeOnSecond.x, "pair force on the first charge is opposite");
close(likeFirst.y, -likeOnSecond.y, "pair force y is opposite");
check(likeFirst.x < 0 && likeSecond.x > 0, "like charges repel");
close(Math.hypot(likeSecond.x, likeSecond.y), 8 / 9, "F = k q1 q2 / r^2");
check(like[0]!.kind === "path" && like[0]!.directed && like[1]!.kind === "path" && like[1]!.directed, "nonzero forces are directed paths");
close(distance(like[0]!.points[0]!, like[0]!.points[1]!), 2, "display length sets the first arrow");
close(distance(like[1]!.points[0]!, like[1]!.points[1]!), 2, "display length sets the second arrow");
exams(like[0]!.dipoleField.exams, "listed", "listed", "listed", "coulomb exam tags");
check(like[0]!.dipoleField.topicId === "physics|11|coulombs-law-for-point-charges", "coulomb topic id");

const likeLong = run("coulomb_pair", {
  charges: [{ position: { x: 0, y: 0 }, charge: 2 }, { position: { x: 3, y: 0 }, charge: 4 }],
  k: 1, displayLength: 7,
});
close(vectorOf(likeLong[0]!).x, likeFirst.x, "display length does not change F");
close(vectorOf(likeLong[1]!).y, likeSecond.y, "display length does not change the opposite force");
close(distance(likeLong[1]!.points[0]!, likeLong[1]!.points[1]!), 7, "longer display arrow");

const unlike = run("coulomb_pair", {
  charges: [{ position: { x: 0, y: 0 }, charge: 1 }, { position: { x: 3, y: 4 }, charge: -1 }],
  k: 1, displayLength: 1.5,
});
const unlikeSecond = oracleForceOnSecond(1, { x: 0, y: 0 }, -1, { x: 3, y: 4 }, 1);
close(vectorOf(unlike[1]!).x, unlikeSecond.x, "unlike vector force x");
close(vectorOf(unlike[1]!).y, unlikeSecond.y, "unlike vector force y");
close(vectorOf(unlike[0]!).x, -unlikeSecond.x, "unlike pair remains equal and opposite x");
close(vectorOf(unlike[0]!).y, -unlikeSecond.y, "unlike pair remains equal and opposite y");
check(dot(vectorOf(unlike[1]!), { x: 3, y: 4 }) < 0, "unlike charges attract");
close(Math.hypot(unlikeSecond.x, unlikeSecond.y), 1 / 25, "vector magnitude k|q1 q2|/r^2");

const wider = run("coulomb_pair", {
  charges: [{ position: { x: 0, y: 0 }, charge: 2 }, { position: { x: 6, y: 0 }, charge: 4 }],
  k: 1, displayLength: 2,
});
close(Math.hypot(vectorOf(wider[1]!).x, vectorOf(wider[1]!).y) * 4, 8 / 9, "doubling separation divides the force by four");
const siK = 9e9;
const siForce = run("coulomb_pair", {
  charges: [{ position: { x: 0, y: 0 }, charge: 1e-6 }, { position: { x: 0.1, y: 0 }, charge: 2e-6 }],
  k: siK, displayLength: 0.02,
});
close(vectorOf(siForce[1]!).x, 1.8, "SI coulomb force uses the supplied k");
close(vectorOf(siForce[0]!).x, -1.8, "SI pair is equal and opposite");
rejects(() => run("coulomb_pair", {
  charges: [{ position: { x: 1, y: 1 }, charge: 2 }, { position: { x: 1, y: 1 }, charge: -3 }],
  k: 1, displayLength: 1,
}), "coincident point charges reject");
rejects(() => run("coulomb_pair", {
  charges: [{ position: { x: 0, y: 0 }, charge: 1 }, { position: { x: 1, y: 0 }, charge: 1 }],
  k: { value: 1, unit: "N*m^2/C^2" }, displayLength: 1,
}), "a unit wrapper must not hide an assumed Coulomb constant");

const positivePositions = [{ x: 3, y: 4 }, { x: -2, y: 0 }, { x: 0, y: -5 }];
for (const at of positivePositions) {
  const field = one("point_charge_field", { charge: { position: { x: 0, y: 0 }, charge: 3 }, at, k: 1, displayLength: 1.25 });
  const expected = oracleField(3, { x: 0, y: 0 }, at, 1);
  close(vectorOf(field).x, expected.x, `positive source Ex at ${at.x},${at.y}`);
  close(vectorOf(field).y, expected.y, `positive source Ey at ${at.x},${at.y}`);
  check(field.kind === "path" && field.directed && dot(sub(field.points[1]!, field.points[0]!), expected) > 0, "positive source arrow follows E");
  exams(field.dipoleField.exams, "listed", "listed", "listed", "point-charge field exam tags");
}
for (const at of positivePositions) {
  const field = one("point_charge_field", { charge: { position: { x: 1, y: -2 }, charge: -3 }, at, k: 1, displayLength: 1.25 });
  const expected = oracleField(-3, { x: 1, y: -2 }, at, 1);
  close(vectorOf(field).x, expected.x, `negative source Ex at ${at.x},${at.y}`);
  close(vectorOf(field).y, expected.y, `negative source Ey at ${at.x},${at.y}`);
}
const doubledK = one("point_charge_field", { charge: { position: { x: 0, y: 0 }, charge: 3 }, at: { x: 3, y: 4 }, k: 2, displayLength: 1.25 });
close(vectorOf(doubledK).x, 2 * oracleField(3, { x: 0, y: 0 }, { x: 3, y: 4 }, 1).x, "k scales E and is not implied");
const longArrow = one("point_charge_field", { charge: { position: { x: 0, y: 0 }, charge: 3 }, at: { x: 3, y: 4 }, k: 1, displayLength: 6 });
close(vectorOf(longArrow).x, oracleField(3, { x: 0, y: 0 }, { x: 3, y: 4 }, 1).x, "display length does not change E");
close(distance(longArrow.kind === "path" ? longArrow.points[0]! : longArrow.point, longArrow.kind === "path" ? longArrow.points[1]! : longArrow.point), 6, "point-charge display length");
const siField = one("point_charge_field", { charge: { position: { x: 0, y: 0 }, charge: 1e-6 }, at: { x: 2, y: 0 }, k: siK, displayLength: 0.4 });
close(vectorOf(siField).x, 2250, "SI point-charge field uses the supplied k");
close(vectorOf(siField).y, 0, "SI point-charge field is radial");
rejects(() => run("point_charge_field", { charge: { position: { x: 0, y: 0 }, charge: 3 }, at: { x: 0, y: 0 }, k: 1, displayLength: 1 }), "r=0 rejects");
rejects(() => run("point_charge_field", {
  charge: { position: { x: 0, y: 0 }, charge: 3 }, at: { x: 3, y: 4 }, k: 1, displayLength: 1, testCharge: 5,
}), "a test charge cannot change E");
rejects(() => run("point_charge_field", { charge: { position: "projected", charge: 1 }, at: { x: 3, y: 0 }, k: 1, displayLength: 1 }), "projected source point rejects");

const reused = evaluateFieldConstruction("electric_field", {
  charges: [{ position: { x: 0, y: 0 }, charge: 3 }],
  at: { x: 3, y: 4 }, mode: "schematic", k: 1, displayLength: 1.25,
}, context);
const reusedOracle = oracleField(3, { x: 0, y: 0 }, { x: 3, y: 4 }, 1);
close(reused[0]!.electricField.components.x, reusedOracle.x, "existing electric_field operator matches the independent oracle");
close(reused[0]!.electricField.components.y, reusedOracle.y, "existing electric_field operator y oracle");
const packetField = one("point_charge_field", { charge: { position: { x: 0, y: 0 }, charge: 3 }, at: { x: 3, y: 4 }, k: 1, displayLength: 1.25 });
close(vectorOf(packetField).x, reused[0]!.electricField.components.x, "point_charge_field agrees with electric_field");
close(vectorOf(packetField).y, reused[0]!.electricField.components.y, "point_charge_field y agrees with electric_field");

function lineInputs(charges: Array<{ id: string; position: RenderPoint; charge: number }>, starts: RenderPoint[], stepLength: number, stepCount: number, exclusionRadius: number): Record<string, unknown> {
  return { charges, starts, stepLength, stepCount, k: 1, exclusionRadius };
}
function assertTangents(geometry: DipoleGeometry, charges: Array<{ position: RenderPoint; charge: number }>, message: string): void {
  check(geometry.kind === "multi_path", message);
  if (geometry.kind !== "multi_path") return;
  for (const path of geometry.paths) {
    check(path.directed && path.points.length >= 2, `${message} polyline`);
    for (let index = 0; index < path.points.length - 1; index += 1) {
      const start = path.points[index]!;
      const step = sub(path.points[index + 1]!, start);
      const field = oracleSuperposition(charges, start, 1);
      const alignment = dot(step, field) / (Math.hypot(step.x, step.y) * Math.hypot(field.x, field.y));
      check(alignment > 1 - 1e-8, `${message} tangent follows E`);
    }
  }
}
function assertOutside(geometry: DipoleGeometry, charges: Array<{ position: RenderPoint; charge: number }>, exclusion: number, message: string): void {
  check(geometry.kind === "multi_path", message);
  if (geometry.kind !== "multi_path") return;
  for (const path of geometry.paths) {
    for (let index = 0; index < path.points.length - 1; index += 1) {
      const start = path.points[index]!;
      const end = path.points[index + 1]!;
      for (const source of charges) {
        const edge = sub(end, start);
        const lengthSquared = dot(edge, edge);
        const t = Math.min(1, Math.max(0, dot(sub(source.position, start), edge) / lengthSquared));
        const closest = { x: start.x + edge.x * t, y: start.y + edge.y * t };
        check(distance(closest, source.position) >= exclusion - 1e-9, `${message} does not enter a charge`);
      }
    }
  }
}

const positiveLines = one("field_lines", lineInputs(
  [{ id: "source", position: { x: 0, y: 0 }, charge: 1 }],
  [{ x: 0.15, y: 0 }, { x: 0, y: 0.15 }, { x: -0.15, y: 0 }, { x: 0, y: -0.15 }],
  0.1, 6, 0.1,
));
check(positiveLines.dipoleField.quantitativeDensity === false, "line density is schematic");
check(positiveLines.dipoleField.topicId === "physics|11|electric-field-lines", "field line topic");
exams(positiveLines.dipoleField.exams, "listed", "listed", "listed", "field line exam tags");
assertTangents(positiveLines, [{ position: { x: 0, y: 0 }, charge: 1 }], "single positive line");
assertOutside(positiveLines, [{ position: { x: 0, y: 0 }, charge: 1 }], 0.1, "single positive line");
check(positiveLines.dipoleField.lines?.every((line) => line.startedAtChargeId === "source" && line.endedAtChargeId === null), "positive lines start at the source");
if (positiveLines.kind === "multi_path") {
  for (const path of positiveLines.paths) {
    check(dot(path.points[0]!, path.points[path.points.length - 1]!) > 0, "single-charge line does not pass through the charge");
  }
}

const negativeLines = one("field_lines", lineInputs(
  [{ id: "sink", position: { x: 0, y: 0 }, charge: -1 }],
  [{ x: 1.2, y: 0 }, { x: 0, y: 1.2 }],
  0.1, 20, 0.15,
));
assertTangents(negativeLines, [{ position: { x: 0, y: 0 }, charge: -1 }], "single negative line");
assertOutside(negativeLines, [{ position: { x: 0, y: 0 }, charge: -1 }], 0.15, "single negative line");
check(negativeLines.dipoleField.lines?.every((line) => line.startedAtChargeId === null && line.endedAtChargeId === "sink"), "negative lines end on the sink");

const dipoleCharges = [
  { id: "plus", position: { x: 1, y: 0 }, charge: 1 },
  { id: "minus", position: { x: -1, y: 0 }, charge: -1 },
];
const launch = 0.14;
const dipoleStarts = [Math.PI - 0.45, Math.PI, Math.PI + 0.45].map((angle) => ({ x: 1 + launch * Math.cos(angle), y: launch * Math.sin(angle) }));
const dipoleLines = one("field_lines", lineInputs(dipoleCharges, dipoleStarts, 0.04, 200, 0.12));
assertTangents(dipoleLines, dipoleCharges, "dipole line");
assertOutside(dipoleLines, dipoleCharges, 0.12, "dipole line");
check(dipoleLines.dipoleField.quantitativeDensity === false, "dipole line density stays schematic");
check(dipoleLines.dipoleField.lines?.every((line) => line.startedAtChargeId === "plus" && line.endedAtChargeId === "minus"), "dipole lines run from the positive charge to the negative charge");
rejects(() => run("field_lines", { ...lineInputs(dipoleCharges, dipoleStarts, 0.04, 20, 0.12), density: 8 }), "numeric line density rejects");
rejects(() => run("field_lines", lineInputs(
  [{ id: "source", position: { x: 0, y: 0 }, charge: 1 }],
  [{ x: 0, y: 0 }],
  0.1, 4, 0.1,
)), "a start on a charge rejects");
rejects(() => run("field_lines", lineInputs(
  [{ id: "source", position: { x: 0, y: 0 }, charge: 1 }],
  [{ x: 0.15, y: 0 }, { x: 0.15, y: 0 }],
  0.1, 4, 0.1,
)), "overlapping field lines away from a charge reject");

const pair = [
  { position: { x: 1, y: 0 }, charge: 1 },
  { position: { x: -1, y: 0 }, charge: -1 },
];
function dipoleAt(at: RenderPoint, mode: "finite" | "ideal", displayLength = 1): DipoleGeometry {
  return one("dipole_field", { charges: pair, at, mode, k: 1, displayLength });
}
const nearAxial = dipoleAt({ x: 1.5, y: 0 }, "finite");
const nearAxialOracle = oracleSuperposition(pair, { x: 1.5, y: 0 }, 1);
close(vectorOf(nearAxial).x, nearAxialOracle.x, "near axial finite field is superposition");
close(vectorOf(nearAxial).y, 0, "near axial transverse field");
close(nearAxialOracle.x, 3.84, "near axial hand value");
check(nearAxial.dipoleField.ideal === null && nearAxial.dipoleField.usedIdealFormula === false && nearAxial.dipoleField.formula === null, "finite mode does not return the ideal formula");
check(nearAxial.dipoleField.pureDipole === true && nearAxial.dipoleField.axis === "axial", "near point is a pure axial dipole");
check(nearAxial.dipoleField.p?.x === 2 && nearAxial.dipoleField.p.y === 0, "p = q d from negative toward positive");
exams(nearAxial.dipoleField.exams, "listed", "application", "listed", "dipole exam tags");
check(Math.abs(nearAxialOracle.x - 2 * 2 / (1.5 ** 3)) > 1, "near axial superposition is not the ideal 2kp/r^3 value");

const farAxial = dipoleAt({ x: 20, y: 0 }, "finite");
const farAxialOracle = 80 / 159201;
close(vectorOf(farAxial).x, farAxialOracle, "far axial finite field stays on the superposition");
close(vectorOf(farAxial).y, 0, "far axial transverse cancellation");
check(Math.abs(farAxialOracle - 0.0005) > 1e-6, "far finite field is not replaced by 2kp/r^3");
const negativeAxis = dipoleAt({ x: -20, y: 0 }, "finite");
close(vectorOf(negativeAxis).x, farAxialOracle, "negative axis finite field still points along p");
const nearEquator = dipoleAt({ x: 0, y: 2 }, "finite");
close(vectorOf(nearEquator).x, -2 / (5 * Math.sqrt(5)), "near equatorial superposition");
close(vectorOf(nearEquator).y, 0, "near equatorial normal component cancels");
check(nearEquator.dipoleField.axis === "equatorial" && nearEquator.dipoleField.ideal === null, "finite equatorial mode");
const southEquator = dipoleAt({ x: 0, y: -2 }, "finite");
close(vectorOf(southEquator).x, -2 / (5 * Math.sqrt(5)), "south equatorial field stays antiparallel to p");
const farEquator = dipoleAt({ x: 0, y: 20 }, "finite");
close(vectorOf(farEquator).x, -2 / (401 * Math.sqrt(401)), "far equatorial superposition");
check(Math.abs(vectorOf(farEquator).x - (-2 / 8000)) > 1e-8, "far equatorial finite field is not kp/r^3");

const idealAxial = dipoleAt({ x: 20, y: 0 }, "ideal");
close(vectorOf(idealAxial).x, 0.0005, "ideal axial 2kp/r^3");
close(vectorOf(idealAxial).y, 0, "ideal axial direction is along p");
close(idealAxial.dipoleField.superposition?.x ?? NaN, farAxialOracle, "ideal mode still reports the superposition computed first");
check(idealAxial.dipoleField.usedIdealFormula === true && idealAxial.dipoleField.formula === "2*k*p/r^3", "ideal axial formula tag");
check(Math.abs((idealAxial.dipoleField.superposition?.x ?? 0) - vectorOf(idealAxial).x) > 1e-6, "reported ideal field is not the finite superposition");
const idealNegative = dipoleAt({ x: -20, y: 0 }, "ideal");
close(vectorOf(idealNegative).x, 0.0005, "ideal field on the negative axis stays parallel to p");
const idealEquator = dipoleAt({ x: 0, y: 20 }, "ideal");
close(vectorOf(idealEquator).x, -0.00025, "ideal equatorial kp/r^3");
close(vectorOf(idealEquator).y, 0, "ideal equatorial field is antiparallel to p");
check(idealEquator.dipoleField.formula === "k*p/r^3", "ideal equatorial formula tag");
const idealSouth = dipoleAt({ x: 0, y: -20 }, "ideal");
close(vectorOf(idealSouth).x, -0.00025, "ideal equatorial field does not flip across the axis");
const idealDisplay = dipoleAt({ x: 20, y: 0 }, "ideal", 4);
close(vectorOf(idealDisplay).x, vectorOf(idealAxial).x, "display length does not change ideal E");
close(distance(idealDisplay.kind === "path" ? idealDisplay.points[0]! : idealDisplay.point, idealDisplay.kind === "path" ? idealDisplay.points[1]! : idealDisplay.point), 4, "ideal display length");
rejects(() => dipoleAt({ x: 19, y: 0 }, "ideal"), "ideal mode rejects r < 10 |d|");
rejects(() => dipoleAt({ x: 20, y: 20 }, "ideal"), "ideal mode rejects an off-axis point");
rejects(() => one("dipole_field", {
  charges: [{ position: { x: 1, y: 0 }, charge: 1 }, { position: { x: -1, y: 0 }, charge: 1 }],
  at: { x: 30, y: 0 }, mode: "ideal", k: 1, displayLength: 1,
}), "ideal mode rejects charges that are not +q and -q");

const holdoutAt = { x: 3, y: 2 };
const holdout = dipoleAt(holdoutAt, "finite");
const holdoutFromPlus = oracleField(1, { x: 1, y: 0 }, holdoutAt, 1);
const holdoutFromMinus = oracleField(-1, { x: -1, y: 0 }, holdoutAt, 1);
const holdoutOracle = { x: holdoutFromPlus.x + holdoutFromMinus.x, y: holdoutFromPlus.y + holdoutFromMinus.y };
close(vectorOf(holdout).x, holdoutOracle.x, "holdout off-axis Ex");
close(vectorOf(holdout).y, holdoutOracle.y, "holdout off-axis Ey");
check(holdout.dipoleField.axis === "off-axis" && holdout.dipoleField.ideal === null && holdout.dipoleField.usedIdealFormula === false, "holdout stays on finite superposition");
check(Math.abs(holdoutOracle.y) > 1e-4, "holdout is not on a principal axis");

const flipped = one("dipole_field", {
  charges: [{ position: { x: 1, y: 0 }, charge: -1 }, { position: { x: -1, y: 0 }, charge: -1 }],
  at: { x: 1.5, y: 0 }, mode: "finite", k: 1, displayLength: 1,
});
const flippedOracle = oracleField(-1, { x: 1, y: 0 }, { x: 1.5, y: 0 }, 1).x + oracleField(-1, { x: -1, y: 0 }, { x: 1.5, y: 0 }, 1).x;
close(vectorOf(flipped).x, flippedOracle, "sign-flipped axial field matches superposition");
check(vectorOf(nearAxial).x > 0 && vectorOf(flipped).x < 0, "flipping one charge sign reverses the axial field");
rejects(() => one("dipole_field", {
  charges: [{ position: { x: 0, y: 0 }, charge: 1 }, { position: { x: 0, y: 0 }, charge: -1 }],
  at: { x: 2, y: 0 }, mode: "finite", k: 1, displayLength: 1,
}), "coincident dipole charges reject");
const midpoint = dipoleAt({ x: 0, y: 0 }, "finite");
close(vectorOf(midpoint).x, -2, "midpoint finite superposition");
close(vectorOf(midpoint).y, 0, "midpoint transverse field");
rejects(() => dipoleAt({ x: 0, y: 0 }, "ideal"), "the dipole center is too close for the ideal formula");

function torque(p: RenderPoint, E: RenderPoint, displayLength = 2, extra: Record<string, unknown> = {}): DipoleGeometry {
  return one("dipole_torque", { p, E, at: { x: 0, y: 0 }, displayLength, ...extra });
}
const parallel = torque({ x: 2, y: 0 }, { x: 4, y: 0 });
check(oracleTau({ x: 2, y: 0 }, { x: 4, y: 0 }) === 0 && parallel.dipoleField.tau === 0, "parallel torque is zero");
check(parallel.dipoleField.netForce?.x === 0 && parallel.dipoleField.netForce.y === 0, "uniform field net force is zero");
check(parallel.dipoleField.alignment === "parallel" && parallel.dipoleField.tauSense === "zero" && parallel.dipoleField.uniform === true, "parallel alignment");
const antiparallel = torque({ x: -2, y: 0 }, { x: 4, y: 0 });
check(antiparallel.dipoleField.tau === 0 && antiparallel.dipoleField.alignment === "antiparallel", "antiparallel torque is zero");
const oblique = torque({ x: 1, y: 0 }, { x: 1, y: 1 });
close(oblique.dipoleField.tau ?? NaN, oracleTau({ x: 1, y: 0 }, { x: 1, y: 1 }), "oblique torque is p cross E");
check((oblique.dipoleField.tau ?? 0) !== 0, "oblique torque is nonzero");
const pageNormal = torque({ x: 1, y: 0 }, { x: 0, y: 2 });
close(pageNormal.dipoleField.tau ?? NaN, 2, "right-hand page-normal torque is positive out of the page");
check(pageNormal.dipoleField.tauSense === "out-of-page", "positive tau points out of the page");
const intoPage = torque({ x: 1, y: 0 }, { x: 0, y: -2 });
check(intoPage.dipoleField.tauSense === "into-page" && intoPage.dipoleField.tau === -2, "negative tau points into the page");
exams(pageNormal.dipoleField.exams, "listed", "application", "listed", "torque exam tags");
const longTorque = torque({ x: 1, y: 0 }, { x: 0, y: 2 }, 9);
check(longTorque.dipoleField.tau === pageNormal.dipoleField.tau && longTorque.dipoleField.netForce?.x === 0, "display length does not change tau or net force");
check(longTorque.kind === "path" && distance(longTorque.points[0]!, longTorque.points[1]!) === 9, "torque arrow uses display length");
rejects(() => torque({ x: 1, y: 0 }, { x: 0, y: 2 }, 2, { nonuniform: true }), "nonuniform torque rejects");
rejects(() => torque({ x: 1, y: 0 }, { x: 0, y: 2 }, 2, { gradient: { x: 1, y: 0 } }), "a supplied field gradient rejects");
rejects(() => torque({ x: 1, y: 0 }, { x: 0, y: 2 }, 2, { uniform: false }), "uniform:false rejects");
check(torque({ x: 1, y: 0 }, { x: 0, y: 2 }, 2, { nonuniform: false }).dipoleField.tau === 2, "explicit uniform field still uses p cross E");

const circle = one("equipotential", {
  source: "point_charge", charge: { position: { x: -2, y: 3 }, charge: 2 }, V: 4, k: 1,
});
check(circle.kind === "circle", "point-charge equipotential is a circle");
if (circle.kind === "circle") {
  close(circle.radius, 0.5, "circle radius is k q / V");
  close(circle.center.x, -2, "circle center x");
  close(circle.center.y, 3, "circle center y");
  const angle = 0.7;
  const sample = { x: circle.center.x + circle.radius * Math.cos(angle), y: circle.center.y + circle.radius * Math.sin(angle) };
  close(oraclePotential([{ charge: 2, position: circle.center }], sample, 1), 4, "circle sample has the supplied potential");
  const radial = { x: Math.cos(angle), y: Math.sin(angle) };
  const tangent = { x: -radial.y, y: radial.x };
  const field = oracleField(2, circle.center, sample, 1);
  close(dot(field, tangent), 0, "point-charge E is perpendicular to the circle tangent");
}
check(circle.dipoleField.V === 4 && circle.dipoleField.quantitativeDensity === false, "circle potential metadata");
exams(circle.dipoleField.exams, "listed", "application", "listed", "equipotential exam tags");
const negativeCircle = one("equipotential", {
  source: "point_charge", charge: { position: { x: 0, y: 0 }, charge: -2 }, V: -4, k: 1,
});
check(negativeCircle.kind === "circle" && negativeCircle.radius === 0.5, "negative source equipotential radius");
rejects(() => run("equipotential", { source: "point_charge", charge: { position: { x: 0, y: 0 }, charge: 2 }, V: 0, k: 1 }), "point-charge V=0 rejects");
rejects(() => run("equipotential", { source: "point_charge", charge: { position: { x: 0, y: 0 }, charge: 2 }, V: -4, k: 1 }), "opposite sign V has no real circle");
rejects(() => run("equipotential", {
  source: "point_charge", charge: { position: { x: 0, y: 0 }, charge: 2 }, V: 4, k: 1, displayLength: 3,
}), "display length cannot rescale an equipotential");

const box = { min: { x: -3, y: -3 }, max: { x: 3, y: 3 } };
const contour = one("equipotential", { source: "dipole", charges: pair, V: 8, k: 1, samples: 96, sampleDomain: box });
check(contour.kind === "multi_path" && contour.dipoleField.closed === true && contour.dipoleField.portion === false, "dipole equipotential is a closed contour");
if (contour.kind === "multi_path") {
  const points = contour.paths[0]!.points;
  check(points.length === 96, "dipole contour sample count");
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    close(oraclePotential(pair, point, 1), 8, "dipole contour potential", 1e-6);
    const previous = points[(index - 1 + points.length) % points.length]!;
    const next = points[(index + 1) % points.length]!;
    const tangent = sub(next, previous);
    const field = oracleSuperposition(pair, point, 1);
    const normalDot = dot(field, tangent) / (Math.hypot(field.x, field.y) * Math.hypot(tangent.x, tangent.y));
    check(Math.abs(normalDot) < 1e-2, "dipole contour E is perpendicular to the tangent in the plane");
  }
}
const negativeContour = one("equipotential", { source: "dipole", charges: pair, V: -8, k: 1, samples: 96, sampleDomain: box });
check(negativeContour.kind === "multi_path" && negativeContour.dipoleField.V === -8, "negative dipole equipotential");
if (negativeContour.kind === "multi_path") {
  close(oraclePotential(pair, negativeContour.paths[0]!.points[3]!, 1), -8, "negative contour potential", 1e-6);
}
rejects(() => run("equipotential", { source: "dipole", charges: pair, V: 0, k: 1 }), "unbounded V=0 bisector rejects");
const portion = one("equipotential", { source: "dipole", charges: pair, V: 0, k: 1, sampleDomain: box });
check(portion.kind === "multi_path" && portion.dipoleField.portion === true && portion.dipoleField.portionOf === "perpendicular-bisector", "V=0 draws a declared portion");
if (portion.kind === "multi_path") {
  const [start, end] = portion.paths[0]!.points;
  check(portion.paths[0]!.points.length === 2 && start && end, "bisector portion is one bounded segment");
  close(start!.x, 0, "bisector portion starts on x=0");
  close(end!.x, 0, "bisector portion ends on x=0");
  close(Math.min(start!.y, end!.y), -3, "bisector portion is clipped to the domain");
  close(Math.max(start!.y, end!.y), 3, "bisector portion reaches the other domain edge");
  const tangent = sub(end!, start!);
  for (const t of [0, 0.5, 1]) {
    const point = { x: start!.x + tangent.x * t, y: start!.y + tangent.y * t };
    close(oraclePotential(pair, point, 1), 0, "bisector portion potential is zero");
    const field = oracleSuperposition(pair, point, 1);
    close(dot(field, tangent) / (Math.hypot(field.x, field.y) * Math.hypot(tangent.x, tangent.y)), 0, "bisector E is perpendicular to the portion");
  }
}
rejects(() => run("equipotential", {
  source: "point_charge", charge: { position: { x: 0, y: 0 }, charge: 1 }, V: 1, k: 1, projectedAngle: 0.2,
}), "a projected angle cannot prove the equipotential");

function energy(p: RenderPoint, E: RenderPoint, displayLength = 2, extra: Record<string, unknown> = {}): DipoleGeometry {
  return one("dipole_energy", { p, E, at: { x: 1, y: 1 }, displayLength, zeroConvention: "perpendicular", ...extra });
}
const stable = energy({ x: 3, y: 0 }, { x: 4, y: 0 });
close(stable.dipoleField.U ?? NaN, -12, "stable alignment is U=-pE");
check(stable.dipoleField.alignment === "parallel" && stable.dipoleField.zeroConvention === "perpendicular", "parallel zero convention");
check(stable.dipoleField.topicId === "physics|11|dipole-potential-energy-in-field", "energy topic");
exams(stable.dipoleField.exams, "listed", "listed", "listed", "energy exam tags");
const unstable = energy({ x: -3, y: 0 }, { x: 4, y: 0 });
close(unstable.dipoleField.U ?? NaN, 12, "unstable alignment is U=+pE");
check(unstable.dipoleField.alignment === "antiparallel", "antiparallel alignment");
const perpendicular = energy({ x: 0, y: 5 }, { x: 4, y: 0 });
close(perpendicular.dipoleField.U ?? NaN, 0, "U=0 when p is perpendicular to E");
check(perpendicular.dipoleField.alignment === "perpendicular", "perpendicular alignment");
const obliqueP = { x: 3, y: 1 };
const obliqueE = { x: 2, y: -1 };
const obliqueEnergy = energy(obliqueP, obliqueE);
const obliqueTau = oracleTau(obliqueP, obliqueE);
close(obliqueEnergy.dipoleField.U ?? NaN, -(obliqueP.x * obliqueE.x + obliqueP.y * obliqueE.y), "U=-p·E");
close(obliqueEnergy.dipoleField.tau ?? NaN, obliqueTau, "energy reports the same p cross E");
const pMag = Math.hypot(obliqueP.x, obliqueP.y);
const eMag = Math.hypot(obliqueE.x, obliqueE.y);
const sinFromEToP = (obliqueE.x * obliqueP.y - obliqueE.y * obliqueP.x) / (pMag * eMag);
close(obliqueTau, -pMag * eMag * sinFromEToP, "tau equals -p E sin theta");
const delta = 1e-6;
const turn = (angle: number): RenderPoint => ({
  x: obliqueP.x * Math.cos(angle) - obliqueP.y * Math.sin(angle),
  y: obliqueP.x * Math.sin(angle) + obliqueP.y * Math.cos(angle),
});
const derivative = (-dot(turn(delta), obliqueE) - -dot(turn(-delta), obliqueE)) / (2 * delta);
close(obliqueTau, -derivative, "tau equals -dU/d theta");
close(obliqueEnergy.dipoleField.minusDuDTheta ?? NaN, obliqueTau, "operator derivative agrees with the independent step");
const longEnergy = energy(obliqueP, obliqueE, 8);
check(longEnergy.dipoleField.U === obliqueEnergy.dipoleField.U && longEnergy.dipoleField.tau === obliqueEnergy.dipoleField.tau, "display length does not change U or tau");
rejects(() => run("dipole_energy", { p: obliqueP, E: obliqueE, at: { x: 0, y: 0 }, displayLength: 1 }), "missing zeroConvention rejects");
rejects(() => run("dipole_energy", {
  p: obliqueP, E: obliqueE, at: { x: 0, y: 0 }, displayLength: 1, zeroConvention: "parallel",
}), "a zero at parallel alignment rejects");
rejects(() => energy(obliqueP, obliqueE, 2, { nonuniform: true }), "nonuniform energy rejects");

function scene(construction: SceneDocument["constructions"][number], entities: SceneDocument["entities"]): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "CH-08a dipole field" },
    source: {},
    quantities: [],
    entities,
    constructions: [construction],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: entities.map((entity) => entity.id),
    revealGroups: [{ id: "group", entityIds: entities.map((entity) => entity.id), dependsOn: [], narrationCue: "dipole" }],
    teachingTimeline: [],
  };
}
function issuesOf(document: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const byOutput = new Map(document.constructions.flatMap((construction) => construction.outputs.map((output) => [output, construction] as const)));
  validateDipoleFieldConstruction(document.constructions[0]!, 0, document, byOutput, issues);
  return issues;
}
const good = scene(
  { id: "make_dipole", operator: "dipole_field", inputs: { charges: pair, at: { x: 1.5, y: 0 }, mode: "finite", k: 1, displayLength: 2 }, outputs: ["field"] },
  [{ id: "field", kind: "vector", role: "finite dipole field" }],
);
check(good.schemaVersion === "scene-document/v2", "good document is scene-document/v2");
check(issuesOf(good).length === 0, "good dipole_field document has no issues");
const coincident = scene(
  {
    id: "make_pair", operator: "coulomb_pair",
    inputs: { charges: [{ position: { x: 0, y: 0 }, charge: 2 }, { position: { x: 0, y: 0 }, charge: -4 }], k: 1, displayLength: 1 },
    outputs: ["force_a", "force_b"],
  },
  [{ id: "force_a", kind: "vector", role: "force" }, { id: "force_b", kind: "vector", role: "force" }],
);
const coincidentIssues = issuesOf(coincident);
check(coincidentIssues.length > 0 && coincidentIssues.every((issue) => issue.severity === "fatal"), "coincident charges are fatal");
check(coincidentIssues.some((issue) => issue.message.includes("coincident")), "coincident fatal explains the separation");

console.log(`verify-ch08a-dipole-operators: ${checks} checks passed`);
