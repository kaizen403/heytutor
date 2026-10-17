/** Harness 5 owns this source-value boundary gate. No model or network calls. */
import assert from "node:assert/strict";
import { detectArchetype } from "../../src/archetypes/detect";
import { generatorFor } from "../../src/archetypes/generators";
import type { ArchetypeId, Slots } from "../../src/archetypes/catalog";
import type { SlotSource } from "../../src/archetypes/slots";

function generated(id: ArchetypeId, slots: Slots = {}, sources: Record<string, SlotSource> = {}, question = `Draw ${id}`) {
  return generatorFor(id)!({ question, slots, sources, quantities: [], schematic: true });
}
function labels(id: ArchetypeId, slots: Slots = {}, sources: Record<string, SlotSource> = {}) {
  return generated(id, slots, sources)?.entities.flatMap((entity) => entity.label ? [entity.label] : []) ?? [];
}
const conceptual = generated("photoelectric")!;
assert.ok(conceptual, "conceptual energy balance retains symbolic geometry");
for (const id of ["phi_top", "E_top", "kinetic"]) {
  assert.doesNotMatch(conceptual.entities.find((entity) => entity.id === id)!.label!, /\d/, `${id}: display defaults cannot be printed as physical values`);
}
const joules = detectArchetype("The work function of the metal is 3.2 × 10⁻¹⁹ J. Draw the photoelectric energy balance.", { plannerArchetype: "photoelectric" });
assert.ok(joules && typeof joules.slots.workFunction === "number");
assert.ok(Math.abs(joules.slots.workFunction - 2) < 0.01, "Joule energy converts to eV; exponent is never read as part of a decimal");
const unknownUnit = detectArchetype("The work function is 7 kg. Draw photoelectric emission.", { plannerArchetype: "photoelectric" });
assert.equal(unknownUnit?.slots.workFunction, undefined, "energy role cannot accept a different dimension");
const known = generated("photoelectric", { workFunction: 2, photonEnergy: 3 }, { workFunction: "stem", photonEnergy: "stem" })!;
assert.equal(known.entities.find((entity) => entity.id === "kinetic")?.label, "K=1 eV", "source-backed energy difference survives");
assert.deepEqual(labels("photoelectric", { workFunction: 2 }, { workFunction: "stem" }).filter((label) => /[=]\d/.test(label)), ["φ=2 eV"], "one given does not authorize fabricated photon/kinetic values");
const derived = detectArchetype("Draw photoelectric emission.", { plannerArchetype: "photoelectric", turnPlan: { derived: [{ id: "phi", value: 2, unit: "eV" }] } });
assert.equal(derived?.slots.workFunction, undefined, "planner-derived numbers are not solver authority");
for (const id of ["dipole_in_field", "bar_magnet_in_field", "shm_superposition"] as const) {
  assert.ok(labels(id).every((label) => !/[=]\d/.test(label)), `${id}: default angle/amplitude stay symbolic`);
}
assert.ok(labels("centre_of_mass").every((label) => !/[=]\d/.test(label)), "centre of mass display positions are not given coordinates");
assert.ok(labels("screw_gauge").every((label) => !/(?:pitch\s*=\s*\d|LC=\d|\d+ div)/.test(label)), "default instrument dimensions stay symbolic");
assert.ok(labels("vernier_calliper").every((label) => !/(?:=\s*\d.*mm|\d+th|error [+-−]\d)/.test(label)), "default instrument reading/least count stay symbolic");
assert.equal(generated("fx_graph_area", { expression: "2*x" }, { expression: "stem" }), null, "area interval cannot be invented");
assert.ok(generated("fx_graph_area", { expression: "2*x", from: 0, to: 4 }, { expression: "stem", from: "stem", to: "stem" }), "grounded graph interval survives");
assert.ok(labels("plane_refraction", { i: 30 }, { i: "stem" }).every((label) => !/n[12]=|r=/.test(label)), "unprovided indices and derived angle stay symbolic");
// Each recovered numeric label has a positive source-backed counterpart.
assert.ok(labels("dipole_in_field", { theta: 37 }, { theta: "stem" }).includes("θ=37°"));
assert.ok(labels("bar_magnet_in_field", { theta: 37 }, { theta: "stem" }).includes("θ=37°"));
assert.ok(labels("shm_superposition", { phase: 40 }, { phase: "stem" }).includes("x2 (φ=40°)"));
for (const id of ["meter_bridge", "potentiometer"] as const) {
  assert.ok(labels(id).includes("J"), `${id} default balance is symbolic`);
  assert.ok(labels(id, { balance: 40 }, { balance: "stem" }).includes("J (40 cm)"));
}
assert.ok(labels("dipole_in_field", { theta: 37 }, { theta: "default" }).includes("θ"), "a display angle is never numeric ink");
assert.equal(generated("fx_graph_area", { expression: "2*x", from: 0, to: 4 }, { expression: "stem", from: "default", to: "default" }), null, "display intervals are not work integration bounds");
const cm = labels("centre_of_mass", { masses: [2, 3], positions: [0, 5] }, { masses: "stem", positions: "stem" });
assert.ok(cm.includes("CM x=3"));
assert.ok(cm.includes("x2=5"));
assert.ok(labels("centre_of_mass", { masses: [9] }, { masses: "stem" }).every((label) => !/m[12]=/.test(label)), "one mass cannot ground the fallback two-mass example");
assert.ok(labels("screw_gauge", { pitch: 0.5, divisions: 50 }, { pitch: "stem", divisions: "stem" }).includes("LC=0.01 mm"));
assert.ok(labels("vernier_calliper", { mainScaleReading: 23, vernierDivision: 4, leastCount: 0.1 }, { mainScaleReading: "stem", vernierDivision: "stem", leastCount: "stem" }).includes("= 23.4 mm"));
assert.ok(labels("standing_wave").includes("envelope"));
assert.ok(labels("standing_wave", { harmonic: 3 }, { harmonic: "stem" }).includes("n=3"));
assert.equal(generated("standing_wave", { harmonic: 9 }, { harmonic: "stem" }), null, "unsupported harmonic must never be clamped to a different one");
assert.ok(labels("free_fall").includes("u"));
assert.ok(labels("free_fall", { u: 0 }, { u: "stem" }).includes("u=0 m/s"));
assert.ok(labels("collision_line").includes("u2"));
assert.ok(labels("collision_line", { u2: 0 }, { u2: "stem" }).includes("u2=0 m/s"));
assert.equal(generated("circle_and_point", { r: 2 }, { r: "stem" }), null, "circle must not invent centre coordinates");
assert.ok(generated("circle_and_point", { cx: 0, cy: 0, r: 2 }, { cx: "stem", cy: "stem", r: "stem" }));
for (const id of ["spherical_mirror", "thin_lens", "lens_maker", "plane_refraction", "prism", "incline_body", "pulley_incline", "banked_road", "ladder_wall", "dipole_in_field", "bar_magnet_in_field", "centre_of_mass", "screw_gauge", "vernier_calliper"] as const) {
  assert.equal(generated(id)?.quantities.length ?? 0, 0, `${id} cannot publish default numbers as authoritative quantities`);
}
assert.ok(labels("binding_energy_curve").includes("near iron"), "approximate display formula cannot invent a measured nuclear binding energy");
const noInstant = generated("xt_graph", { expression: "x^2" }, { expression: "stem" })!;
assert.equal(noInstant.entities.find((entity) => entity.id === "P")?.label, "P", "display sample point does not claim a given instant");
assert.ok(generated("xt_graph", { expression: "x^2" }, { expression: "stem" }, "Draw x=t^2 at t=2 s")!.entities.some((entity) => entity.id === "P"));
const refraction = labels("plane_refraction", { i: 30, n1: 1, n2: 1.5 }, { i: "stem", n1: "stem", n2: "stem" });
assert.ok(refraction.includes("n2=1.5") && refraction.includes("r=19.5°"));
for (const energy of ["3.2 x 10^-19 J", "3.2e-19 joules", "3.2 × 10⁻¹⁹ J"]) {
  const match = detectArchetype(`Work function is ${energy}. Photoelectric emission.`, { plannerArchetype: "photoelectric" })!;
  assert.ok(Math.abs(Number(match.slots.workFunction) - 2) < 0.01, energy);
}
const wavelength = detectArchetype("Photoelectric emission: wavelength is 0.4 μm, work function is 2 eV.", { plannerArchetype: "photoelectric" })!;
assert.equal(wavelength.slots.lambda, 400);
const inferredPhoton = generated("photoelectric", wavelength.slots, wavelength.sources)!;
assert.equal(inferredPhoton.entities.find((entity) => entity.id === "E_top")?.label, "hν=3.1 eV");
const contradictoryPlan = detectArchetype("Photoelectric emission: work function is 2 eV.", { plannerArchetype: "photoelectric", turnPlan: { givens: [{ id: "phi", value: 20, unit: "eV" }] } })!;
assert.equal(contradictoryPlan.slots.workFunction, 2, "role-bound source wins over a contradictory planner value");
console.log("archetype source-value gates passed");
