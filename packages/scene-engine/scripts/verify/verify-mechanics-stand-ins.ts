import { strict as assert } from "node:assert";
import { detectArchetype } from "../../src/archetypes/detect";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";

// Two mechanics archetypes drew a figure the stem never described. A car
// moving along a level road got a car going round a circle, because "level
// road" alone cleared the circular-motion bar. A rod pivoted at one end and
// released got a body in free fall. The circle now needs the stem to say the
// body turns, and free fall declines a body turning about a pivot. Stems that
// do describe those figures keep them.

let checks = 0;
const claims = (question: string, id: string) => [detectArchetype(question, {})?.id, detectArchetype(question, { plannerArchetype: id })?.id];

for (const question of [
  "A car moves on a level road with constant speed. Draw its x-t graph.",
  "A car accelerates along a level road from rest at 2 m/s^2. Find its speed after 5 s.",
]) {
  for (const id of claims(question, "circular_motion_level")) assert.notEqual(id, "circular_motion_level", `${question}: no circle the stem does not name`);
  checks += 1;
}
for (const question of [
  "A car of mass 1000 kg takes a turn of radius 50 m on a level road at 15 m/s. Find the friction needed.",
  "A cyclist moves on a level circular track of radius 20 m at 6 m/s. Find the centripetal acceleration.",
]) {
  assert.equal(detectArchetype(question, {})?.id, "circular_motion_level", `${question}: a stated turn keeps the circle`);
  checks += 1;
}
// A whirled stone names its circle in other words; the planner's circle claim stands.
for (const question of [
  "A stone of mass 0.2 kg is whirled on a string of length 1 m at 3 revolutions per second in a horizontal plane. Find the tension.",
  "A stone tied to a string of length 0.5 m is whirled round at 4 m/s on a smooth horizontal table.",
  "A ball attached to a string revolves at 2 m/s on a frictionless horizontal surface, string length 0.8 m.",
  "A stone tied to a string of length 1 m rotates at 4 m/s in a horizontal plane. Find the tension.",
]) {
  assert.equal(detectArchetype(question, { plannerArchetype: "circular_motion_level" })?.id, "circular_motion_level", `${question}: the planner's circle claim stands`);
  checks += 1;
}
// A body spinning in place goes round no circle, even with a radius named.
for (const question of [
  "A ball rotates about its own axis at 10 rad/s. Find its rotational kinetic energy.",
  "A solid sphere of radius 0.1 m spins at 20 rad/s. Find its angular momentum.",
  "A particle of mass 2 kg rotates about its centre of radius 0.3 m. Find its moment of inertia.",
]) {
  assert.notEqual(detectArchetype(question, { plannerArchetype: "circular_motion_level" })?.id, "circular_motion_level", `${question}: a spin in place is no circle`);
  checks += 1;
}
check: {
  const straight = "A block slides straight across a smooth horizontal table at 3 m/s. Find the time to cross 2 m.";
  assert.notEqual(detectArchetype(straight, { plannerArchetype: "circular_motion_level" })?.id, "circular_motion_level", "a horizontal table names no turn");
  const axle = "A disc of radius 0.2 m is mounted at its rim on a fixed horizontal axle and released from rest to rotate under gravity. Find its angular speed at the bottom.";
  assert.notEqual(detectArchetype(axle, { plannerArchetype: "free_fall" })?.id, "free_fall", "rotation about an axle is no free fall");
  checks += 1;
}
for (const question of [
  "A rod pivoted at one end is released from horizontal. Find its angular speed at the bottom.",
  "A uniform rod hinged at one end is released from rest in the horizontal position. Find its angular acceleration.",
]) {
  for (const id of claims(question, "free_fall")) assert.notEqual(id, "free_fall", `${question}: a turning rod is no free fall`);
  checks += 1;
}
for (const question of [
  "A stone is dropped from the top of a 45 m tower. Find the time it takes to reach the ground.",
  "A ball is released from a height of 20 m. Find its speed just before it hits the ground.",
  "A ball is dropped from a height of 20 m. Ignore air resistance and the Earth's rotation. Find the time to reach the ground.",
  "A ball is dropped from a swinging crane at a height of 30 m. Find its speed when it reaches the ground.",
  "A disc is dropped without rotation from a height of 20 m. Find its speed before it reaches the ground.",
]) {
  assert.equal(detectArchetype(question, {})?.id, "free_fall", `${question}: a dropped body keeps free fall`);
  checks += 1;
}
// A refused lead declines the whole deterministic figure. The runner up, a
// family and the last resort schematic must not take the turn instead.
const plans: Record<string, unknown> = {
  plain: undefined,
  torque: { schemaVersion: "turn-plan/v3", givens: [], unknowns: [], derived: [], qualitativeClaims: [], assumptions: [], lawIds: ["torque about the pivot", "conservation of energy"] },
  kinematics: { schemaVersion: "turn-plan/v3", givens: [], unknowns: [], derived: [], qualitativeClaims: [], assumptions: [], lawIds: ["equations of uniformly accelerated motion", "relative velocity"] },
};
for (const question of [
  "A car moves on a level road with constant speed. Draw its x-t graph.",
  "A car accelerates along a level road from rest at 2 m/s^2. Find its speed after 5 s.",
  "A car travels on a straight level road at 20 m/s and brakes to rest in 40 m. Find the deceleration.",
  "A rod pivoted at one end is released from horizontal. Find its angular speed at the bottom.",
  "A uniform rod of length 2 m is released from horizontal and swings about a horizontal axis through one end.",
]) {
  for (const [name, turnPlan] of Object.entries(plans)) {
    const input = { question, turnPlan: turnPlan ? { ...(turnPlan as object), question } : undefined };
    assert.equal(synthesizeFamilyScene(input), null, `${question} (${name} plan): the family path declines a refused lead`);
    assert.equal(synthesizeLastResortScene(input), null, `${question} (${name} plan): the last resort declines a refused lead`);
    checks += 1;
  }
}
check: {
  // A two body claim on one car changing speed declines; it does not draw two cars.
  const one = "A car changes speed from 10 m/s to 20 m/s while continuing in the same direction on a straight road.";
  assert.equal(detectArchetype(one, { plannerArchetype: "relative_motion_line" }), null, "a relative motion claim needs two bodies");
  checks += 1;
}
check: {
  const level = "A car accelerates along a level road from rest at 2 m/s^2. Find its speed after 5 s.";
  assert.equal(detectArchetype(level, {}), null, "a refused circle lead declines, no runner up");
  checks += 1;
}
console.log(`verify-mechanics-stand-ins: ${checks} checks passed`);
