/**
 * physics|2|uniform-circular-motion readiness gate (owned by the UCM lane).
 *
 * Expected values below are hand computed from the question text, not read
 * back from the engine: ω = v/r = 2π/T = 2πN/t = 2π·rpm/60, v = ωr,
 * a = v²/r = ω²r, F = m a, θ = ωt, s = vt. Directions use x right, y up with
 * positive ω anticlockwise; the board flips y once (screen y grows downward).
 */
import assert from "node:assert/strict";
import { applySourceQuantityAuthority, planNamesCircularMotion, readUniformCircularSource, synthesizeFamilyScene, synthesizeLastResortScene, synthesizeUniformCircularScene, type RenderScene, type UniformCircularNumeric } from "../../src";

let checks = 0;
const close = (actual: number, expected: number, what: string, tolerance = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${what}: ${actual} != ${expected}`);
  checks++;
};
const numeric = (question: string): UniformCircularNumeric => {
  const source = readUniformCircularSource(question);
  assert.equal(source?.status, "numeric", `${question} must bind a numeric uniform state, got ${JSON.stringify(source)}`);
  return source as UniformCircularNumeric;
};
/**
 * A turn plan that names circular motion and carries no numbers: the topic
 * decision comes from it, the quantities from the source. Cases that test
 * the plan's own numbers pass their own plan.
 */
const circularPlan = { schemaVersion: "turn-plan/v3", lawIds: ["uniform circular motion: a_c = v^2/r"], givens: [], derived: [], unknowns: [], qualitativeClaims: [], assumptions: [], visualRequirement: "required" };
const drawn = (question: string, turnPlan: unknown = circularPlan): RenderScene => {
  const result = synthesizeUniformCircularScene(question, { turnPlan });
  assert.equal(result?.status, "drawn", `${question} must draw, got ${JSON.stringify(result)}`);
  const family = synthesizeFamilyScene({ question, turnPlan, families: ["contact_body", "bounded_region", "vector_diagram"] });
  assert.ok(family, "the normal family path must return the same figure");
  assert.equal(family.family, "vector_diagram");
  assert.deepEqual(family.renderScene, result!.status === "drawn" ? result!.scene.renderScene : null, "the family path must not substitute a lexical figure");
  checks += 2;
  return family.renderScene;
};
const primitive = (scene: RenderScene, entityId: string, kind?: string) => scene.primitives.find((p) => p.entityId === entityId && (!kind || p.kind === kind));
const label = (scene: RenderScene, entityId: string): string | undefined => scene.primitives.find((p) => p.entityId === entityId && p.kind === "label")?.text;
const direction = (scene: RenderScene, entityId: string): { x: number; y: number } => {
  const p = primitive(scene, entityId, "vector");
  assert.ok(p && p.points.length === 2, `${entityId} must be a drawn vector`);
  const dx = p.points[1]!.x - p.points[0]!.x; const dy = -(p.points[1]!.y - p.points[0]!.y);
  const n = Math.hypot(dx, dy); return { x: dx / n, y: dy / n };
};
const inZone = (scene: RenderScene): void => {
  for (const p of scene.primitives) for (const point of p.points) {
    assert.ok(point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700, `${p.id} leaves the diagram zone at ${point.x},${point.y}`);
  }
  checks++;
};
const noSenseImplied = (scene: RenderScene): void => {
  assert.ok(!primitive(scene, "velocity", "vector"), "no velocity arrowhead without a stated sense");
  assert.ok(primitive(scene, "tangent", "line") ?? primitive(scene, "velocity", "line"), "the velocity line is still drawn as the tangent");
  checks += 2;
};
const declined = (question: string, code: string, turnPlan: unknown = circularPlan): void => {
  const result = synthesizeUniformCircularScene(question, { turnPlan });
  assert.equal(result?.status, "declined", `${question} must decline`);
  assert.ok(result!.status === "declined" && result!.reason.startsWith(code), `${question} must decline as ${code}, got ${result!.status === "declined" ? result!.reason : ""}`);
  assert.equal(synthesizeFamilyScene({ question, turnPlan, families: ["contact_body", "bounded_region", "vector_diagram", "trajectory"] }), null, `${question}: no other family may paint a replacement`);
  checks += 3;
};
const notThisTopic = (question: string, turnPlan: unknown = circularPlan): void => {
  assert.equal(readUniformCircularSource(question), null, `${question} belongs to another topic`);
  assert.equal(synthesizeUniformCircularScene(question, { turnPlan }), null);
  checks += 2;
};

// C1 car on a circular track, no stated sense: a = 20²/50 = 8 m/s², ω = 0.4 rad/s, T = 2π/0.4.
{
  const q = "A car moves with a constant speed of 20 m/s on a circular track of radius 50 m. Find its centripetal acceleration.";
  const s = numeric(q);
  close(s.radiusM, 50, "C1 r"); close(s.speed, 20, "C1 v"); close(s.angularSpeed, 0.4, "C1 ω"); close(s.period, 2 * Math.PI / 0.4, "C1 T"); close(s.centripetalAcceleration, 8, "C1 a");
  assert.equal(s.sense, null); assert.equal(s.signedAngularVelocity, null); checks += 2;
  const scene = drawn(q); inZone(scene); noSenseImplied(scene);
  const a = direction(scene, "accel"); close(a.x, 0, "C1 a points to centre x", 1e-6); close(a.y, -1, "C1 a points to centre y", 1e-6);
  assert.equal(label(scene, "radius"), "r=50 m"); assert.equal(label(scene, "tangent"), "v=20 m/s"); assert.equal(label(scene, "accel"), "a=8 m/s^2"); checks += 3;
}

// C2 NCERT stone: string 80 cm, horizontal circle, 14 revolutions in 25 s.
// ω = 2π·14/25 = 3.518583772 rad/s, a = ω²·0.8 = 9.904345 m/s² (textbook 9.91), v = 2.814867 m/s.
{
  const q = "A stone tied to the end of a string 80 cm long is whirled in a horizontal circle with a constant speed. If the stone makes 14 revolutions in 25 s, what is the magnitude and direction of acceleration of the stone?";
  const s = numeric(q);
  assert.equal(s.radiusSource, "string_length"); assert.equal(s.radiusUnit, "cm"); assert.equal(s.rateSource, "revolutions_in_time"); checks += 3;
  close(s.radiusM, 0.8, "C2 r"); close(s.angularSpeed, 2 * Math.PI * 14 / 25, "C2 ω"); close(s.speed, 2.8148670176, "C2 v", 1e-9); close(s.centripetalAcceleration, 9.9043454086, "C2 a", 1e-9);
  const scene = drawn(q); inZone(scene); noSenseImplied(scene);
  assert.equal(label(scene, "radius"), "r=80 cm"); assert.equal(label(scene, "accel"), "a=9.904 m/s^2"); checks += 2;
}

// C3 force: m = 2 kg, v = 4 m/s, r = 0.5 m: a = 32 m/s², F = 64 N.
{
  const s = numeric("A particle of mass 2 kg moves in uniform circular motion with speed 4 m/s on a circle of radius 0.5 m. Find the centripetal force on it.");
  close(s.centripetalAcceleration, 32, "C3 a"); close(s.mass!, 2, "C3 m"); close(s.centripetalForce!, 64, "C3 F");
  // A stated force that disagrees with m v²/r is a contradiction.
  declined("A particle of mass 2 kg moves in uniform circular motion with speed 4 m/s on a circle of radius 0.5 m under a centripetal force of 50 N.", "contradictory_rates");
}

// C4 stated clockwise sense with a period: ω = 2π/2 = π, v = 0.8π, a = 0.8π².
// Body at the top: clockwise velocity points to +x (screen right); a points down to O.
{
  const q = "A stone is whirled clockwise in a horizontal circle of radius 0.8 m with a period of 2 s. Find its speed and acceleration.";
  const s = numeric(q);
  close(s.signedAngularVelocity!, -Math.PI, "C4 signed ω"); close(s.speed, 0.8 * Math.PI, "C4 v"); close(s.centripetalAcceleration, 0.8 * Math.PI ** 2, "C4 a");
  const scene = drawn(q); inZone(scene);
  const v = direction(scene, "velocity"); close(v.x, 1, "C4 clockwise v at top x", 1e-6); close(v.y, 0, "C4 v y", 1e-6);
  const a = direction(scene, "accel"); close(a.x, 0, "C4 a x", 1e-6); close(a.y, -1, "C4 a y", 1e-6); close(v.x * a.x + v.y * a.y, 0, "C4 v ⟂ a", 1e-6);
  assert.equal(label(scene, "velocity"), "v=2.513 m/s"); assert.equal(label(scene, "accel"), "a=7.896 m/s^2"); checks += 2;
}

// C5 anticlockwise at 30 rpm, r = 2 m, after 3 s: ω = π, v = 2π, a = 2π², θ = 3π rad, s = 6π m.
{
  const q = "A body moves anticlockwise uniformly on a circle of radius 2 m at 30 rpm. Find the angle swept and the distance travelled in 3 s.";
  const s = numeric(q);
  close(s.angularSpeed, Math.PI, "C5 ω"); close(s.speed, 2 * Math.PI, "C5 v"); close(s.centripetalAcceleration, 2 * Math.PI ** 2, "C5 a");
  close(s.elapsedTime!, 3, "C5 t"); close(s.angleSwept!, 3 * Math.PI, "C5 θ"); close(s.arcLength!, 6 * Math.PI, "C5 s");
  const scene = drawn(q); inZone(scene);
  const v = direction(scene, "velocity"); close(v.x, -1, "C5 anticlockwise v at top x", 1e-6);
}

// C6 unit conversion: 72 km/h on a 100 m circular road: v = 20 m/s, a = 4 m/s².
{
  const s = numeric("A car goes round a circular road of radius 100 m at a constant speed of 72 km/h. Find its centripetal acceleration.");
  close(s.speed, 20, "C6 v"); close(s.centripetalAcceleration, 4, "C6 a");
}

// Number collision: mass and an unrelated clock reading are not radius or time.
{
  const s = numeric("A 2 kg ball moves uniformly on a circle of radius 3 m with speed 6 m/s while a clock shows 3 s.");
  close(s.radiusM, 3, "collision r"); close(s.centripetalAcceleration, 12, "collision a"); assert.equal(s.elapsedTime, null); checks++;
}

// Native JEE Main 2022 Q37 (symbolic R, v, θ): qualitative figure, no numbers, no sense.
{
  const q = "For a particle in uniform circular motion, the acceleration a at any point P(R,θ) on the circular path of radius R is (when θ is measured from the positive x-axis and v is uniform speed):";
  const source = readUniformCircularSource(q);
  assert.equal(source?.status, "symbolic"); checks++;
  assert.ok(source?.status === "symbolic" && source.radiusSymbol === "R" && source.speedSymbol === "v" && source.angleSymbol === "θ" && source.angleFromPositiveX); checks++;
  const result = synthesizeUniformCircularScene(q, { turnPlan: circularPlan });
  assert.ok(result?.status === "drawn"); checks++;
  const scene = result.scene.renderScene; inZone(scene);
  assert.equal(result.scene.tier, "qualitative_verified"); assert.equal(result.scene.nonMetric, true); checks += 2;
  assert.ok(!scene.primitives.some((p) => p.kind === "label" && /\d/.test(p.text ?? "")), "symbolic source must not gain numeric labels"); checks++;
  assert.ok(!primitive(scene, "velocity", "vector"), "no velocity sense for the symbolic source"); checks++;
  assert.equal(label(scene, "accel"), "a = v²/R"); assert.equal(label(scene, "theta"), "θ"); checks += 2;
  // a points from P to O, i.e. along −(cosθ, sinθ) for the drawn display θ.
  const p = primitive(scene, "P", "point")!.points[0]!; const o = primitive(scene, "O", "point")!.points[0]!;
  const toCentre = { x: o.x - p.x, y: -(o.y - p.y) }; const n = Math.hypot(toCentre.x, toCentre.y);
  const a = direction(scene, "accel"); close(a.x, toCentre.x / n, "Q37 a inward x", 1e-3); close(a.y, toCentre.y / n, "Q37 a inward y", 1e-3);
}

// Rejections: every one declines atomically and no other family paints a replacement.
declined("A particle moves uniformly on a circle of radius 0 m with speed 3 m/s.", "nonpositive_radius");
declined("A particle moves uniformly on a circle of radius -2 m with speed 3 m/s.", "nonpositive_radius");
declined("A particle moves clockwise and anticlockwise in uniform circular motion on a circle of radius 2 m with speed 3 m/s.", "contradictory_sense");
declined("A particle moves in uniform circular motion on a circle of radius 2 m with speed 6 m/s and angular speed 4 rad/s.", "contradictory_rates");
declined("A particle moves on a circle of radius 2 m and its speed increases uniformly from 3 m/s to 5 m/s.", "nonuniform");
declined("A particle moves in uniform circular motion with speed 3 m/s on a circle of radius 2 m; a second circle has radius 3 m.", "ambiguous_radius");

// Wrong-family holdouts stay with their own topics.
notThisTopic("A stone tied to a string is whirled in a vertical circle of radius 1 m. Find the minimum speed at the highest point.");
notThisTopic("A car takes a turn on a circular road banked at 30 degrees with radius 50 m at 20 m/s.");
notThisTopic("An electron moves in a circle of radius 2 cm in a uniform magnetic field with speed 3 m/s.");
notThisTopic("A ball is projected horizontally with speed 10 m/s from a height of 20 m.");
notThisTopic("A car moves on a level circular road of radius 50 m; the coefficient of friction is 0.4. Find the maximum speed.");

// HEY-91 authored cohort (unchanged question text from contract.json), stated positions.
// Expected: r = (R cosφ, R sinφ), v = ω(−y, x), a = −ω²(x, y) with ω signed (+ anticlockwise).
const cohort: Array<[string, string, { r: number; omega: number; phase: number; v: [number, number]; a: [number, number] }]> = [
  ["UC-E-CCW", "In the xy-plane (x right, y up), a particle travels anticlockwise at constant angular velocity 3 rad/s on a circle of radius 2 m centred at O. At P=(2,0) m, which pair gives its velocity and acceleration? Draw the path, radius, tangent velocity and inward acceleration.", { r: 2, omega: 3, phase: 0, v: [0, 6], a: [-18, 0] }],
  ["UC-E-CW", "In the xy-plane (x right, y up), a particle travels clockwise at constant angular speed 3 rad/s on a circle of radius 2 m centred at O. At P=(2,0) m, which pair gives its velocity and acceleration? Draw the path, radius, tangent velocity and inward acceleration.", { r: 2, omega: -3, phase: 0, v: [0, -6], a: [-18, 0] }],
  ["UC-M-NORTH", "A particle moves clockwise uniformly on a circle of radius 0.5 m in the xy-plane, with angular speed 4 rad/s. At the north point P=(0,0.5) m, choose its velocity and acceleration; draw both arrows at P.", { r: 0.5, omega: -4, phase: Math.PI / 2, v: [2, 0], a: [0, -8] }],
  ["UC-H-ROTATED", "A particle is at P=(1.8,2.4) m relative to centre O in the xy-plane. It moves anticlockwise uniformly on the circle through P at angular speed 2 rad/s. Choose its instantaneous velocity and acceleration, then draw the circle, radius and both vectors.", { r: 3, omega: 2, phase: Math.atan2(2.4, 1.8), v: [-4.8, 3.6], a: [-7.2, -9.6] }],
  ["UC-C-UNITS", "A particle moves clockwise uniformly on a circle of radius 200 cm. Its angular speed is 0.003 rad/ms. At the east point, choose its SI speed and centripetal acceleration magnitude, and draw its velocity and inward acceleration. The schematic circle radius may be arbitrary.", { r: 2, omega: -3, phase: 0, v: [0, -6], a: [-18, 0] }],
  ["UC-M-PERIOD", "A particle moves anticlockwise uniformly on a circle of radius 2 m with period 4 s. At the east point, choose its speed and centripetal acceleration magnitude. Draw its velocity and acceleration.", { r: 2, omega: Math.PI / 2, phase: 0, v: [0, Math.PI], a: [-(Math.PI ** 2) / 2, 0] }],
  ["UC-M-SPEED", "A particle moves clockwise uniformly with speed 10 m/s on a circle of radius 5 m. At the west point in the xy-plane, choose the signed angular velocity and acceleration; draw velocity and acceleration.", { r: 5, omega: -2, phase: Math.PI, v: [0, 10], a: [20, 0] }],
  ["UC-HO-SOUTH-CW", "A particle moves clockwise uniformly at angular speed 0.5 rad/s on a circle of radius 4 m. At the south point P=(0,-4) m in the xy-plane, choose velocity and acceleration.", { r: 4, omega: -0.5, phase: -Math.PI / 2, v: [-2, 0], a: [0, 1] }],
  ["UC-HO-SECOND-QUADRANT", "A particle is at P=(-3,4) m relative to O and moves clockwise uniformly with angular speed 0.2 rad/s. Choose its velocity and acceleration.", { r: 5, omega: -0.2, phase: Math.atan2(4, -3), v: [0.8, 0.6], a: [0.12, -0.16] }],
];
for (const [id, q, e] of cohort) {
  const s = numeric(q);
  close(s.radiusM, e.r, `${id} r`); close(s.signedAngularVelocity!, e.omega, `${id} ω`); close(s.phase!, e.phase, `${id} φ`, 1e-12);
  close(s.speed, Math.hypot(...e.v), `${id} |v|`); close(s.centripetalAcceleration, Math.hypot(...e.a), `${id} |a|`);
  const scene = drawn(q); inZone(scene);
  const v = direction(scene, "velocity"); const a = direction(scene, "accel");
  close(v.x, e.v[0] / Math.hypot(...e.v), `${id} v̂x`, 1e-3); close(v.y, e.v[1] / Math.hypot(...e.v), `${id} v̂y`, 1e-3);
  close(a.x, e.a[0] / Math.hypot(...e.a), `${id} âx`, 1e-3); close(a.y, e.a[1] / Math.hypot(...e.a), `${id} ây`, 1e-3);
}
// No stated sense at a stated position: undirected tangent at the east point, a points to −x.
{
  const q = "A particle travels uniformly on a circle of radius 2 m at angular speed 3 rad/s. At the east point, which direction is its velocity?";
  const s = numeric(q); assert.equal(s.signedAngularVelocity, null); close(s.phase!, 0, "UC-N-DIRECTION-MISSING φ");
  const scene = drawn(q); noSenseImplied(scene);
  const a = direction(scene, "accel"); close(a.x, -1, "direction-missing a x", 1e-6);
}
declined("A particle moves clockwise uniformly in the xy-plane (positive omega is anticlockwise), and has omega=+3 rad/s and radius 2 m. Is the signed state consistent?", "contradictory_sense");
declined("A particle lies at the east point of a circle of radius 2 m with omega=0 rad/s and alpha=0 rad/s^2. Does it have a nonzero tangent velocity or inward acceleration?", "nonpositive_rate");
declined("A particle is at the east point of a circle of radius 2 m with omega=3 rad/s and nonzero angular acceleration alpha=4 rad/s^2. Is its total acceleration purely inward as in uniform circular motion?", "nonuniform");
declined("A particle moves anticlockwise uniformly on a circle of radius 2 m at angular speed 3 rad/s. It is at P=(1.8,2.4) m relative to centre O.", "contradictory_position");
declined("A particle moves anticlockwise uniformly on a circle at angular speed 3 rad/s through P=(1.8,2.4) m.", "ambiguous_position");
{
  const q = "A mass moves uniformly in a horizontal circle under a string's tension. Does centripetal acceleration by itself determine the magnitude of tension without the mass?";
  const r = synthesizeUniformCircularScene(q, { turnPlan: circularPlan }); assert.ok(r?.status === "drawn"); checks++;
  assert.ok(!r.scene.renderScene.primitives.some((p) => p.kind === "label" && /\bT\b|tension|F/i.test(p.text ?? "")), "no invented tension or force mark"); checks++;
}
notThisTopic("A particle is projected horizontally at 3 m/s from height 2 m under constant downward gravitational acceleration. Is its trajectory a uniform circle?", { lawIds: ["projectile motion", "y = h - g t^2 / 2"], givens: [{ id: "u", symbol: "u", value: 3, unit: "m/s", provenance: "given" }], derived: [], unknowns: [] });
notThisTopic("A uniform rod rotates uniformly with angular velocity 2 rad/s about one end.");

// Reviewer regressions (reviews/ucm.md, BLOCK 1 and 2 and the position probes).
// Fractions are read whole: r = 1/2 m, v = 2 m/s gives a = 4/0.5 = 8; v = 1/2 m/s on r = 2 m gives a = 0.25/2 = 0.125.
{
  const s1 = numeric("A particle moves in a circle of radius 1/2 m with a uniform speed of 2 m/s. Find its centripetal acceleration.");
  close(s1.radiusM, 0.5, "fraction r"); close(s1.centripetalAcceleration, 8, "fraction r: a");
  const scene = drawn("A particle moves in a circle of radius 1/2 m with a uniform speed of 2 m/s. Find its centripetal acceleration.");
  assert.equal(label(scene, "radius"), "r=0.5 m"); assert.equal(label(scene, "accel"), "a=8 m/s^2"); checks += 2;
  const s2 = numeric("A particle moves in a circle of radius 2 m with a uniform speed of 1/2 m/s. Find its acceleration.");
  close(s2.speed, 0.5, "fraction v"); close(s2.centripetalAcceleration, 0.125, "fraction v: a");
  // Mixed number 1 1/2 m = 1.5 m; v = 3 m/s gives a = 9/1.5 = 6.
  const s3 = numeric("A particle moves in a circle of radius 1 1/2 m with a uniform speed of 3 m/s.");
  close(s3.radiusM, 1.5, "mixed r"); close(s3.centripetalAcceleration, 6, "mixed r: a");
  // Shared stem grammar (slots.ts STEM_NUMBER): vulgar ½ m = 0.5 m, a = 4/0.5 = 8.
  const s5 = numeric("A particle moves in a circle of radius ½ m with a uniform speed of 2 m/s.");
  close(s5.radiusM, 0.5, "vulgar r"); close(s5.centripetalAcceleration, 8, "vulgar r: a");
  declined("A particle moves in a circle of radius 2 m with a uniform speed of 2^3 m/s.", "unreadable_quantity");
  declined("A particle moves in a circle of radius 3/0 m with a uniform speed of 2 m/s.", "unreadable_quantity");
  // A number inside an expression is not bound piecemeal.
  declined("A particle moves uniformly in a circle of radius 2 m with angular speed π/2 rad/s.", "unreadable_quantity");
  // g is the field, not the centripetal acceleration: a = 2²/1 = 4.
  const s4 = numeric("A stone tied to a string is whirled in a horizontal circle of radius 1 m with a uniform speed of 2 m/s. Take g = 10 m/s^2. Find the centripetal acceleration.");
  assert.equal(s4.rateSource, "speed"); close(s4.centripetalAcceleration, 4, "g given: a"); checks++;
}
// Unitless and absolute positions. (2, 0) on r = 2 m about the origin, anticlockwise: φ = 0, v along +y.
// Centre (6, 0) m, P (3, 4) m: relative (−3, 4), φ = atan2(4, −3); anticlockwise v = ω(−4, −3).
// Centre (5, −7) m, P (5, −3) m: relative (0, 4), φ = π/2; clockwise v along +x.
{
  const positioned: Array<[string, number, [number, number]]> = [
    ["A particle moves anticlockwise with uniform speed in a circle of radius 2 m centred at the origin with angular speed 3 rad/s. At t = 0 it is at (2, 0). Find its velocity and acceleration at t = 0.", 0, [0, 1]],
    ["A particle moves anticlockwise with uniform speed in a circle of radius 5 m centred at (6, 0) m with angular speed 2 rad/s. At t = 0 it is at (3, 4) m. Find its velocity at t = 0.", Math.atan2(4, -3), [-0.8, -0.6]],
    ["A particle moves clockwise with uniform speed in a circle of radius 4 m centred at (5, -7) m with angular speed 2 rad/s. At t = 0 it is at (5, -3) m. Find its velocity at t = 0.", Math.PI / 2, [1, 0]],
  ];
  for (const [q, phase, v] of positioned) {
    const s = numeric(q); close(s.phase!, phase, "position φ", 1e-12);
    const scene = drawn(q); const drawnV = direction(scene, "velocity");
    close(drawnV.x, v[0], "position v̂x", 1e-3); close(drawnV.y, v[1], "position v̂y", 1e-3);
  }
  // A unitless point off the stated circle, or two body positions, decline.
  declined("A particle moves anticlockwise with uniform speed in a circle of radius 2 m with angular speed 3 rad/s. At t = 0 it is at (3, 0).", "contradictory_position");
  declined("A particle moves anticlockwise with uniform speed in a circle of radius 5 m about the origin with angular speed 3 rad/s. It passes (3, 4) m and then (4, 3) m.", "ambiguous_position");
}
// Reviewer's UCM-01 wording: adverb between the verb and "in a circle".
{
  const s = numeric("A particle moves anticlockwise in a circle of radius 2 m with angular speed 3 rad/s. Find its speed and acceleration.");
  close(s.speed, 6, "UCM-01 v"); close(s.centripetalAcceleration, 18, "UCM-01 a");
}

// Admission comes from the plan, not from wording (coordinator rule, 4 Oct 2026).
{
  const car = "A car moves with a constant speed of 20 m/s on a circular track of radius 50 m. Find its centripetal acceleration.";
  // Keywords match but the plan names only straight-line kinematics: not admitted, and no UCM figure from the family path.
  const linearPlan = { lawIds: ["average speed v = d / t"], givens: [{ id: "v", symbol: "v", value: 20, unit: "m/s", provenance: "given" }, { id: "d", symbol: "d", value: 50, unit: "m", provenance: "given" }], derived: [], unknowns: [] };
  // Keywords alone never draw this figure; they may only decline the legacy circle (coordinator decision 1).
  const keywordOnly = synthesizeUniformCircularScene(car, { turnPlan: linearPlan });
  assert.ok(keywordOnly?.status === "declined" && keywordOnly.legacyOnly === true, "keywords alone must not admit");
  assert.equal(synthesizeFamilyScene({ question: car, turnPlan: linearPlan }), null, "no legacy circle and no UCM figure");
  const noPlan = synthesizeUniformCircularScene(car);
  assert.ok(noPlan?.status === "declined" && noPlan.legacyOnly === true, "no plan, no admission"); checks += 3;
  // The plan names circular motion while the wording has no uniform-circle clause: admitted from the plan, quantities from the source.
  const turn = "A car takes a turn of radius 50 m at a speed of 20 m/s. Find its centripetal acceleration.";
  assert.equal(readUniformCircularSource(turn), null, "wording alone does not admit this stem"); checks++;
  const turnScene = drawn(turn);
  assert.equal(label(turnScene, "accel"), "a=8 m/s^2"); assert.equal(label(turnScene, "radius"), "r=50 m"); checks += 2;
  // Each structured signal admits on its own: a law tag, a quantity symbol, an angular unit, a ProblemIR fact.
  drawn(car, { lawIds: [], givens: [], derived: [{ id: "q1", symbol: "a_c", value: 8, unit: "m/s^2", provenance: "derived" }], unknowns: [] });
  drawn(car, { lawIds: [], givens: [], derived: [{ id: "q1", symbol: "w", value: 0.4, unit: "rad/s", provenance: "derived" }], unknowns: [] });
  assert.equal(synthesizeUniformCircularScene(car, { turnPlan: { lawIds: [] }, problemIR: { facts: [{ kind: "requested", statement: "the centripetal acceleration of the car" }] } })?.status, "drawn"); checks++;
}

// Numeric authority: a plan value that disagrees with the recomputed state never pairs with this figure.
// Car: r 50 m, v 20 m/s, a 8 m/s², T 2π/0.4 = 15.708 s. Stone (C4): a 0.8π² = 7.8957 m/s². C3: F 64 N.
{
  const car = "A car moves with a constant speed of 20 m/s on a circular track of radius 50 m. Find its centripetal acceleration.";
  const planWith = (derived: unknown[], givens: unknown[] = []) => ({ lawIds: ["centripetal acceleration a = v^2/r"], givens, derived, unknowns: [] });
  const q = (id: string, symbol: string, value: number, unit: string) => ({ id, symbol, value, unit, provenance: "derived" });
  declined(car, "stale_plan_quantity", planWith([q("a", "a_c", 10, "m/s^2")]));
  declined(car, "stale_plan_quantity", planWith([q("a", "a_c", 8, "m/s^2")], [q("r", "r", 5, "m")]));
  declined(car, "stale_plan_quantity", planWith([q("T", "T", 12.6, "s")]));
  declined(car, "stale_plan_quantity", planWith([q("w", "ω", 0.04, "rad/s")]));
  declined("A particle of mass 2 kg moves in uniform circular motion with speed 4 m/s on a circle of radius 0.5 m. Find the centripetal force on it.", "stale_plan_quantity", planWith([q("F", "F_c", 60, "N")]));
  // Agreeing values, including the planner's own rounding and other units, keep the figure.
  drawn(car, planWith([q("a", "a_c", 8, "m/s^2"), q("T", "T", 15.7, "s"), q("w", "omega", 0.4, "rad/s")], [q("v", "v", 72, "km/h"), q("r", "r", 5000, "cm")]));
  drawn("A stone is whirled clockwise in a horizontal circle of radius 0.8 m with a period of 2 s. Find its speed and acceleration.", planWith([q("v", "v", 2.51, "m/s"), q("a", "a", 7.9, "m/s^2")]));
  // g is not compared with the centripetal acceleration.
  drawn("A stone tied to a string is whirled in a horizontal circle of radius 1 m with a uniform speed of 2 m/s. Take g = 10 m/s^2. Find the centripetal acceleration.", planWith([q("a", "a_c", 4, "m/s^2")], [q("g", "g", 10, "m/s^2")]));
}

// Mock and fallback plans (lawIds [], no quantities): the legacy circular figures are declined, never replaced.
{
  const mock = { schemaVersion: "turn-plan/v3", givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: ["Mock mode does not solve structured quantities."], visualRequirement: "optional" };
  for (const question of [
    "A car moves with a constant speed of 20 m/s on a circular track of radius 50 m. Find its centripetal acceleration.",
    "A stone tied to the end of a string 80 cm long is whirled in a horizontal circle with a constant speed. If the stone makes 14 revolutions in 25 s, what is the magnitude and direction of acceleration of the stone?",
    "A particle moves uniformly on a circle of radius 0 m with speed 3 m/s.",
  ]) {
    const result = synthesizeUniformCircularScene(question, { turnPlan: mock });
    assert.ok(result?.status === "declined" && result.legacyOnly === true, `${question}: legacy decline only`);
    assert.equal(synthesizeFamilyScene({ question, turnPlan: mock, families: ["bounded_region", "contact_body"] }), null, `${question}: no static circle, stock tangent or r=0 circle`);
    assert.equal(synthesizeLastResortScene({ question, turnPlan: mock }), null, `${question}: no schematic circle either`);
    checks += 3;
  }
  // Other topics keep their figures under the same mock plan: banked road, vertical circle, friction.
  for (const question of [
    "A car takes a turn on a circular road banked at 30 degrees with radius 50 m at 20 m/s.",
    "A stone tied to a string is whirled in a vertical circle of radius 1 m. Find the minimum speed at the highest point.",
    "A car moves on a level circular road of radius 50 m; the coefficient of friction is 0.4. Find the maximum speed.",
  ]) {
    assert.equal(synthesizeUniformCircularScene(question, { turnPlan: mock }), null, `${question}: not this topic`);
    assert.ok(synthesizeFamilyScene({ question, turnPlan: mock }), `${question}: its own figure is not suppressed`);
    checks += 2;
  }
}

// Source quantity authority (coordinator decision 2): bound values are corrected so narration and figure agree.
// Car: r 50 m, v 20 m/s = 72 km/h, ω 0.4 rad/s, T 2π/0.4 = 15.7080 s, a 8 m/s². Mass case: F = 2·4²/0.5 = 64 N.
{
  const car = "A car moves with a constant speed of 20 m/s on a circular track of radius 50 m. Find its centripetal acceleration.";
  const q = (id: string, symbol: string, value: number, unit: string, provenance = "derived") => ({ id, symbol, value, unit, provenance });
  const planOf = (givens: unknown[], derived: unknown[]) => ({ schemaVersion: "turn-plan/v3", question: car, givens, derived, unknowns: [], qualitativeClaims: [], lawIds: ["centripetal acceleration a = v^2/r"], assumptions: [], visualRequirement: "required" }) as never;
  const stale = planOf([q("r", "r", 5, "m", "given"), q("v", "v", 70, "km/h", "given")], [q("a", "a_c", 10, "m/s^2"), q("T", "T", 12.6, "s"), q("w", "ω", 0.04, "rad/s")]);
  const seam = applySourceQuantityAuthority(stale, null, car);
  const outcome = seam.outcomes.find((entry) => entry.topic === "physics|2|uniform-circular-motion");
  assert.ok(outcome && !outcome.declineFigure); checks++;
  const value = (id: string) => [...seam.plan.givens, ...seam.plan.derived].find((entry) => entry.id === id)!.value;
  close(value("r"), 50, "corrected r"); close(value("v"), 72, "corrected v in km/h"); close(value("a"), 8, "corrected a_c");
  close(value("T"), 15.708, "corrected T", 1e-5); close(value("w"), 0.4, "corrected ω");
  assert.ok(seam.plan.derived.find((entry) => entry.id === "a")!.sourceText?.includes("Source-verified")); checks++;
  // The corrected plan draws the figure, whose labels agree with the narration's numbers.
  const scene = drawn(car, seam.plan);
  assert.equal(label(scene, "accel"), "a=8 m/s^2"); checks++;
  // Ambiguous symbols and g are left exactly as written; an agreeing ambiguous value keeps the figure.
  const ambiguous = planOf([q("g", "g", 9.8, "m/s^2", "given")], [q("k", "k", 8, "m/s^2")]);
  const kept = applySourceQuantityAuthority(ambiguous, null, car);
  assert.deepEqual(kept.plan, ambiguous, "nothing to correct"); assert.equal(kept.outcomes[0]!.declineFigure, false); checks += 2;
  drawn(car, kept.plan);
  // A conflicting value that binds to no single quantity is not guessed and not narrated: it is withdrawn
  // (Ohm's accepted rule, cov/ohm ecc22784). The family alone, given that plan, still declines.
  const unbound = { ...planOf([], [q("k", "k", 10, "m/s^2")]), unknowns: [{ id: "k", symbol: "k", unit: "m/s^2" }] } as never;
  const withdrawnSeam = applySourceQuantityAuthority(unbound, null, car);
  assert.equal(withdrawnSeam.plan.derived.length, 0, "unbound conflicting value withdrawn from the plan");
  assert.equal(withdrawnSeam.plan.unknowns.length, 0, "and from the unknowns");
  assert.ok(withdrawnSeam.outcomes[0]!.issueCodes.includes("ucm_value_withdrawn")); checks += 3;
  declined(car, "stale_plan_quantity", unbound);
  drawn(car, withdrawnSeam.plan);
  // Force: F_c 60 N corrected to 64 N.
  const forceStem = "A particle of mass 2 kg moves in uniform circular motion with speed 4 m/s on a circle of radius 0.5 m. Find the centripetal force on it.";
  const force = applySourceQuantityAuthority({ ...planOf([], [q("F", "F_c", 60, "N")]), question: forceStem } as never, null, forceStem);
  close(force.plan.derived[0]!.value, 64, "corrected F_c");
  // Not admitted (no circular law in the plan): the authority does nothing.
  const linear = { ...planOf([], [q("a", "a", 10, "m/s^2")]), lawIds: ["average speed v = d / t"] } as never;
  assert.equal(applySourceQuantityAuthority(linear, null, car).outcomes.length, 0); checks++;
}

// Reviewer repros (reviews/ucm.md on 01c3d5d3, probe ucm-authority.mts): stem r 2 m, ω 3 rad/s, so v 6 m/s, a_c 18 m/s²,
// T 2π/3 = 2.0944 s. Over half a revolution |Δv| = 2v = 12 m/s; over a quarter |Δv| = v√2 = 8.4853 m/s.
{
  const stem = "A particle moves anticlockwise in a circle of radius 2 m with angular speed 3 rad/s. Find its speed, its centripetal acceleration and the change in its velocity over half a revolution.";
  const q = (id: string, symbol: string, value: number, unit: string, provenance = "derived") => ({ id, symbol, value, unit, provenance });
  const planOf = (givens: unknown[], derived: unknown[]) => ({ schemaVersion: "turn-plan/v3", question: stem, givens, derived, unknowns: [], qualitativeClaims: [], lawIds: ["uniform circular motion"], assumptions: [], visualRequirement: "required" }) as never;
  const correct = planOf([q("g", "g", 9.8, "m/s^2", "given")], [q("v", "v", 6, "m/s"), q("a", "a_c", 18, "m/s^2"), q("T", "T", 2.09, "s"), q("dv", "Δv", 12, "m/s")]);
  const kept = applySourceQuantityAuthority(correct, null, stem);
  assert.deepEqual(kept.plan, correct, "correct values, rounded T, g and Δv = 2v are never altered");
  assert.equal(kept.outcomes[0]!.declineFigure, false); checks += 2;
  drawn(stem, kept.plan);
  // A wrong Δv binds (it is recomputable here) and is corrected to 12.
  const wrong = applySourceQuantityAuthority(planOf([], [q("dv", "Δv", 6, "m/s"), q("a", "a_c", 12, "m/s^2")]), null, stem);
  close(wrong.plan.derived.find((entry) => entry.id === "dv")!.value, 12, "Δv corrected"); close(wrong.plan.derived.find((entry) => entry.id === "a")!.value, 18, "a_c corrected");
  // Bound givens: r 3 -> 2, v 9 -> 6. Unbound X = 10 m/s² is withdrawn.
  const givens = applySourceQuantityAuthority(planOf([q("r", "r", 3, "m", "given"), q("v", "v", 9, "m/s", "given")], [q("X", "X", 10, "m/s^2")]), null, stem);
  close(givens.plan.givens.find((entry) => entry.id === "r")!.value, 2, "r corrected"); close(givens.plan.givens.find((entry) => entry.id === "v")!.value, 6, "v corrected");
  assert.equal(givens.plan.derived.some((entry) => entry.id === "X"), false); checks++;
  // Quarter turn: |Δv| = 6√2.
  const quarter = "A particle moves anticlockwise in a circle of radius 2 m with angular speed 3 rad/s. Find the change in its velocity over a quarter of a revolution.";
  const quarterPlan = { ...planOf([], [q("dv", "Δv", 8.49, "m/s")]), question: quarter } as never;
  assert.deepEqual(applySourceQuantityAuthority(quarterPlan, null, quarter).plan, quarterPlan, "Δv = 6√2 ≈ 8.49 kept"); checks++;
  // No stated sweep: Δv and an average velocity are not judged, and the figure still draws.
  const plain = "A particle moves anticlockwise in a circle of radius 2 m with angular speed 3 rad/s. Find its speed.";
  const unjudged = { ...planOf([], [q("dv", "Δv", 7, "m/s"), q("vavg", "v_avg", 3.82, "m/s")]), question: plain } as never;
  assert.deepEqual(applySourceQuantityAuthority(unjudged, null, plain).plan, unjudged, "interval quantities unjudged without a stated sweep"); checks++;
  drawn(plain, unjudged);
}

// w, W and ω are not circular-motion evidence on their own (#5 repro: river width w took over a river turn).
{
  const given = (id: string, symbol: string, value: number, unit: string) => ({ id, symbol, value, unit, provenance: "given" });
  const river = "A river is 100 m wide. A boat can travel at 4 m/s in still water and the river flows at 3 m/s. The boat heads straight across. Find the time to cross and the drift downstream.";
  const riverPlan = { lawIds: ["relative velocity", "t = w / v_b"], givens: [given("w", "w", 100, "m"), given("vb", "v_b", 4, "m/s"), given("vr", "v_r", 3, "m/s")], derived: [], unknowns: [] };
  assert.equal(planNamesCircularMotion(riverPlan), false, "river width w is not angular velocity");
  assert.equal(synthesizeUniformCircularScene(river, { turnPlan: riverPlan }), null);
  assert.equal(synthesizeFamilyScene({ question: river, turnPlan: riverPlan })?.document.source.archetype, "river_boat", "the river figure is untouched");
  const riverAuthority = applySourceQuantityAuthority(riverPlan as never, null, river);
  assert.equal(riverAuthority.outcomes.filter((outcome) => outcome.topic === "physics|2|uniform-circular-motion").length, 0, "no UCM correction of a river plan");
  assert.deepEqual(riverAuthority.plan, riverPlan, "valid river quantities remain unchanged across the authority registry");
  checks += 5;
  for (const plan of [
    { lawIds: ["W = m g"], givens: [given("W", "W", 20, "N")], derived: [], unknowns: [] },
    { lawIds: ["W = mg", "N = W cos θ"], givens: [given("w", "w", 49, "N")], derived: [], unknowns: [] },
    { lawIds: ["area = l w"], givens: [given("w", "w", 3, "m"), given("l", "l", 5, "m")], derived: [], unknowns: [] },
    { lawIds: ["X_L = ω L"], givens: [given("f", "f", 50, "Hz"), given("w", "ω", 314, "")], derived: [], unknowns: [] },
    { lawIds: ["v = f λ"], givens: [given("f", "f", 440, "Hz")], derived: [], unknowns: [] },
  ]) { assert.equal(planNamesCircularMotion(plan), false, `${JSON.stringify(plan.givens)} is not circular evidence`); checks++; }
  // Unambiguous evidence still admits: ω with rad/s, rpm, a_c, F_c, a law name, a ProblemIR fact.
  for (const plan of [
    { lawIds: [], givens: [given("w", "ω", 3, "rad/s")], derived: [], unknowns: [] },
    { lawIds: [], givens: [given("w", "w", 3, "rad/s")], derived: [], unknowns: [] },
    { lawIds: [], givens: [given("n", "n", 30, "rpm")], derived: [], unknowns: [] },
    { lawIds: [], givens: [], derived: [given("a", "a_c", 18, "m/s^2")], unknowns: [] },
    { lawIds: [], givens: [], derived: [given("F", "F_c", 36, "N")], unknowns: [] },
    { lawIds: ["centripetal acceleration a = v^2 / r"], givens: [], derived: [], unknowns: [] },
  ]) { assert.equal(planNamesCircularMotion(plan), true, `${JSON.stringify(plan)} names circular motion`); checks++; }
  assert.equal(planNamesCircularMotion({ lawIds: [] }, { facts: [{ kind: "given", statement: "the particle is in uniform circular motion" }] }), true); checks++;
}

// Structural admission (#9 note on 92fcd74e): the plan's own values satisfy a circular relation; no law name needed.
// Car: r 50 m, v 20 m/s, a = 400/50 = 8 m/s². Period: T = 2π·50/20 = 15.708 s. Force: m 2 kg, v 4, r 0.5: F = 64 N.
{
  const qty = (id: string, symbol: string, value: number, unit: string, provenance: string) => ({ id, symbol, value, unit, provenance });
  const car = "A car moves on a circular track of radius 50 m at 20 m/s. Find its acceleration.";
  const carPlan = { lawIds: ["Newton's second law"], givens: [qty("r", "r", 50, "m", "given"), qty("v", "v", 20, "m/s", "given")], derived: [qty("a", "a", 8, "m/s^2", "derived")], unknowns: [] };
  assert.equal(planNamesCircularMotion(carPlan), true, "a = v^2/r from the plan's own r and v admits"); checks++;
  const carScene = drawn(car, carPlan);
  assert.equal(label(carScene, "accel"), "a=8 m/s^2"); checks++;
  const periodPlan = { lawIds: [], givens: [qty("r", "r", 50, "m", "given"), qty("v", "v", 20, "m/s", "given")], derived: [qty("T", "t_1", 15.7, "s", "derived")], unknowns: [] };
  assert.equal(planNamesCircularMotion(periodPlan), true, "T = 2πr/v admits"); checks++;
  const forcePlan = { lawIds: [], givens: [qty("m", "m", 2, "kg", "given"), qty("v", "v", 4, "m/s", "given"), qty("r", "r", 0.5, "m", "given")], derived: [qty("F", "F", 64, "N", "derived")], unknowns: [] };
  assert.equal(planNamesCircularMotion(forcePlan), true, "F = m v^2/r admits"); checks++;
  // Near misses: straight-line a = v/t, uniform acceleration from rest a = v^2/(2s), and a value off by more than its rounding.
  const straight = { lawIds: ["a = (v - u) / t"], givens: [qty("v", "v", 20, "m/s", "given"), qty("t", "t", 4, "s", "given"), qty("d", "d", 40, "m", "given")], derived: [qty("a", "a", 5, "m/s^2", "derived")], unknowns: [] };
  const fromRest = { lawIds: ["v^2 = u^2 + 2 a s"], givens: [qty("v", "v", 20, "m/s", "given"), qty("s", "s", 50, "m", "given")], derived: [qty("a", "a", 4, "m/s^2", "derived")], unknowns: [] };
  const offBy = { lawIds: [], givens: [qty("r", "r", 50, "m", "given"), qty("v", "v", 20, "m/s", "given")], derived: [qty("a", "a", 8.2, "m/s^2", "derived")], unknowns: [] };
  for (const plan of [straight, fromRest, offBy]) { assert.equal(planNamesCircularMotion(plan), false, `${JSON.stringify(plan.derived)} must not admit`); checks++; }
  assert.ok(synthesizeUniformCircularScene("A car accelerates uniformly from rest to 20 m/s in 4 s over 40 m. Find its acceleration.", { turnPlan: straight }) === null); checks++;
}

console.log(`verify-ucm-ready: ${checks} checks passed`);
