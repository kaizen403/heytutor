import { strict as assert } from "node:assert";
import { attemptArchetypeScene } from "../../src/archetypes";

// The photoelectric energy figure titled its energy axis through the axes
// entity's own label, which names neither axis, so "E (eV)" was set below
// the origin, off the axis it names. The generator now titles the energy
// axis at its own tip.

let checks = 0;
for (const question of [
  "Light of photon energy 5.0 eV falls on a metal of work function 2.0 eV. Draw the energy diagram and find the maximum kinetic energy of the photoelectrons.",
  "Photons of energy 3.0 eV fall on a surface of work function 2.3 eV. Show the photoelectric energy balance.",
]) {
  const attempt = attemptArchetypeScene({ question, turnPlan: { schemaVersion: "turn-plan/v3", question } as never });
  assert.equal(attempt.scene?.archetype, "photoelectric", `${question}: draws the photoelectric figure`);
  const primitives = attempt.scene!.renderScene.primitives;
  const axes = primitives.find((primitive) => primitive.kind === "axes");
  assert.ok(axes && axes.points.length >= 4, `${question}: draws its energy axes`);
  const tip = axes!.points.reduce((top, point) => (point.y < top.y ? point : top));
  const title = primitives.find((primitive) => primitive.kind === "label" && /^E \(eV\)$/.test(String(primitive.text ?? "")));
  const box = title?.provenance?.labelBounds as { x: number; y: number; width: number; height: number } | undefined;
  assert.ok(box, `${question}: the energy axis is titled`);
  const distance = Math.hypot(Math.max(box!.x - tip.x, 0, tip.x - (box!.x + box!.width)), Math.max(box!.y - tip.y, 0, tip.y - (box!.y + box!.height)));
  assert.ok(distance <= 24, `${question}: "E (eV)" sits at the energy axis tip, ${distance.toFixed(1)} px away`);
  checks += 1;
}
console.log(`verify-photoelectric-axis-title: ${checks} checks passed`);
