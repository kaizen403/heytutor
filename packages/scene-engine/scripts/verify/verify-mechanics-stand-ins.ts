import { strict as assert } from "node:assert";
import { detectArchetype } from "../../src/archetypes/detect";

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
]) {
  assert.equal(detectArchetype(question, {})?.id, "free_fall", `${question}: a dropped body keeps free fall`);
  checks += 1;
}
console.log(`verify-mechanics-stand-ins: ${checks} checks passed`);
