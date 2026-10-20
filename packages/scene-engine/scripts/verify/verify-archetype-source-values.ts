/** Harness 5 owns this source-value boundary gate. No model or network calls. */
import "./verify-archetype-wave-source";
import "./verify-archetype-number-roles";
import "./verify-archetype-bridge-source";
import assert from "node:assert/strict";
import { detectArchetype } from "../../src/archetypes/detect";
import { generatorFor } from "../../src/archetypes/generators";
import { readRadiationSource } from "../../src/physics/radiationSource";
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
// Unit boundaries must accept Unicode unit symbols without accepting word prefixes.
for (const unit of ["4000Å", "4000 Å", "4000 angstroms", "400 nm"]) {
  const match = detectArchetype(`Photoelectric emission: incident wavelength is ${unit}, work function is 2 eV.`, { plannerArchetype: "photoelectric" })!;
  assert.equal(match.slots.lambda, 400, `incident wavelength unit ${unit}`);
}
for (const unit of ["4000Åfoo", "400nmextra", "400nmé"]) {
  const match = detectArchetype(`Photoelectric emission: wavelength is ${unit}, work function is 2 eV.`, { plannerArchetype: "photoelectric" })!;
  assert.equal(match.slots.lambda, undefined, `unit cannot be a prefix of ${unit}`);
}
for (const threshold of ["threshold", "cutoff", "cut-off", "cut off"]) {
  for (const clauses of [
    `${threshold} wavelength is 600 nm; incident wavelength is 400 nm`,
    `incident wavelength is 400 nm; ${threshold} wavelength is 600 nm`,
  ]) {
    const match = detectArchetype(`Photoelectric emission: ${clauses}; work function is 2 eV.`, { plannerArchetype: "photoelectric" })!;
    assert.equal(match.slots.lambda, 400, "threshold is not the incident wavelength");
    const scene = generated("photoelectric", match.slots, match.sources)!;
    assert.equal(scene.entities.find((entity) => entity.id === "E_top")?.label, "hν=3.1 eV");
    assert.equal(scene.entities.find((entity) => entity.id === "kinetic")?.label, "K=1.1 eV");
  }
}
for (const source of [
  "threshold wavelength is 600 nm",
  "threshold λ = 600 nm",
  "wavelength threshold is 600 nm",
  "incident wavelength is 400 nm and incident wavelength is 500 nm",
]) {
  const match = detectArchetype(`Photoelectric emission: ${source}; work function is 2 eV.`, { plannerArchetype: "photoelectric" })!;
  assert.equal(match.slots.lambda, undefined, "threshold-only or conflicting incident wavelengths do not ground photon energy");
  const scene = generated("photoelectric", match.slots, match.sources)!;
  assert.equal(scene.entities.find((entity) => entity.id === "E_top")?.label, "hν");
  assert.equal(scene.entities.find((entity) => entity.id === "kinetic")?.label, "K");
}
const repeatedWavelength = detectArchetype("Photoelectric emission: wavelength is 400 nm; incident wavelength is 0.4 μm; work function is 2 eV.", { plannerArchetype: "photoelectric" })!;
assert.equal(repeatedWavelength.slots.lambda, 400, "consistent duplicate source values are unambiguous");
for (const [question, harmonic] of [
  ["Draw a standing wave on a string", undefined],
  ["Draw a standing wave on the first string", undefined],
  ["Draw the fundamental standing wave on a string", 1],
  ["Draw a standing wave on a string with fundamental frequency 100 Hz", undefined],
  ["Draw the third harmonic standing wave on a string with fundamental frequency 100 Hz", 3],
  ["Draw the third harmonic standing wave on a string", 3],
  ["Draw a third-harmonic standing wave on a string", 3],
  ["Draw a 3rd harmonic standing wave on a string", 3],
  ["Draw a 3rd-harmonic standing wave on a string", 3],
  ["Draw a second-harmonic standing wave on a string", 2],
  ["Draw a second–harmonic standing wave on a string", 2],
  ["Draw a third‑harmonic standing wave on a string", 3],
  ["Draw a standing wave on a string, n = 3", 3],
  ["Draw a standing wave on a string (n=2)", 2],
  ["Draw a standing wave on a string, n = 16", 16],
  ["Draw the 6th harmonic standing wave on a string", 6],
  ["Draw the 16th harmonic standing wave on a string", 16],
] as const) {
  const match = detectArchetype(question, { plannerArchetype: "standing_wave" })!;
  assert.equal(match.slots.harmonic, harmonic, `only an explicitly named harmonic is source-grounded: ${question}`);
  assert.equal(match.sources.harmonic, harmonic === undefined ? undefined : "stem", `harmonic provenance: ${question}`);
  const scene = generated("standing_wave", match.slots, match.sources, question);
  if (harmonic === 16) assert.equal(scene, null, "unsupported source harmonic is never truncated or clamped");
  else {
    assert.equal(scene?.entities.find((entity) => entity.id === "wave")?.label, harmonic === undefined ? "envelope" : `n=${harmonic}`);
    if (harmonic !== undefined) {
      assert.equal(scene?.entities.filter((entity) => /^node\d+$/.test(entity.id)).length, harmonic + 1, `draw the stated mode's nodes: ${question}`);
      assert.equal(scene?.entities.filter((entity) => /^antinode\d+$/.test(entity.id)).length, harmonic, `draw the stated mode's antinodes: ${question}`);
    }
  }
}
for (const [leastCount, division] of [[0.05, 15], [0.05, 4], [0.1, 15], [0.1, -1], [0.1, 4.5]]) {
  const question = `Draw vernier callipers with main scale reading 23 mm, least count ${leastCount} mm and vernier division ${division}.`;
  const match = detectArchetype(question, { plannerArchetype: "vernier_calliper" })!;
  // Signed/fractional division spellings may be outside the detector grammar;
  // the generator must still refuse such typed values rather than draw false ink.
  const slots = { ...match.slots, vernierDivision: division };
  assert.equal(generated("vernier_calliper", slots, match.sources, question), null,
    "unsupported vernier scales and coincidence indices cannot draw beyond the supported plate");
}
console.log("archetype source-value gates passed");

// Two independent photon inputs must describe the same incident energy.
for (const energy of [5, 3.1]) {
  const match = detectArchetype(`Photoelectric emission: incident wavelength is 400 nm; photon energy is ${energy} eV; work function is 2 eV`, { plannerArchetype: "photoelectric" })!;
  const scene = generated("photoelectric", match.slots, match.sources)!;
  assert.equal(scene.entities.find(e => e.id === "E_top")?.label, energy === 5 ? "hν" : "hν=3.1 eV", "conflicting photon inputs cannot authorize settled numeric ink");
  assert.equal(scene.entities.find(e => e.id === "kinetic")?.label, energy === 5 ? "K" : "K=1.1 eV");
  assert.equal(scene.entities.find(e => e.id === "phi_top")?.label, "φ=2 eV", "independent work-function value stays grounded");
  assert.equal(scene.quantities.some(q => q.id === "E"), energy !== 5);
}

// Repeated energy roles must agree after unit conversion; no first-match authority.
for (const clauses of [
  "work function is 2 eV; work function is 4 eV",
  "work function is 4 eV; work function is 2 eV",
  "φ = 2 eV; work function of the metal is 6.408706536e-19 J",
]) {
  const match = detectArchetype(`Photoelectric emission: ${clauses}; incident wavelength is 400 nm`, { plannerArchetype: "photoelectric" })!;
  const scene = generated("photoelectric", match.slots, match.sources)!;
  assert.equal(match.slots.workFunction, undefined, "conflicting work functions are not source authority");
  assert.equal(scene.entities.find(e => e.id === "phi_top")?.label, "φ");
  assert.equal(scene.entities.find(e => e.id === "kinetic")?.label, "K");
  assert.equal(scene.entities.find(e => e.id === "E_top")?.label, "hν=3.1 eV", "independent incident energy remains grounded");
  assert.equal(scene.quantities.some(q => q.id === "phi"), false);
}
for (const clauses of [
  "photon energy is 3.1 eV; photon energy is 5 eV",
  "photon energy is 5 eV; photon energy is 3.1 eV",
  "hv = 3.1 eV; energy of the photon is 8.01088317e-19 J",
]) {
  const match = detectArchetype(`Photoelectric emission: ${clauses}; work function is 2 eV; incident wavelength is 400 nm`, { plannerArchetype: "photoelectric" })!;
  const scene = generated("photoelectric", match.slots, match.sources)!;
  assert.equal(match.slots.photonEnergy, undefined, "conflicting photon energies are not source authority");
  assert.equal(scene.entities.find(e => e.id === "E_top")?.label, "hν", "a wavelength cannot erase conflicting explicit photon energies");
  assert.equal(scene.entities.find(e => e.id === "kinetic")?.label, "K");
  assert.equal(scene.entities.find(e => e.id === "phi_top")?.label, "φ=2 eV");
  assert.equal(scene.quantities.some(q => q.id === "E"), false);
}
for (const clauses of [
  "work function is 2 eV; φ = 3.204353268e-19 J; photon energy is 3 eV; hf = 4.806529902e-19 joules",
  "φ = 3.204353268e-19 J; work function is 2 electron-volts; hf = 4.806529902e-19 J; photon energy is 3 eV",
]) {
  const match = detectArchetype(`Photoelectric emission: ${clauses}`, { plannerArchetype: "photoelectric" })!;
  const scene = generated("photoelectric", match.slots, match.sources)!;
  assert.equal(scene.entities.find(e => e.id === "phi_top")?.label, "φ=2 eV", "equivalent values in different units agree");
  assert.equal(scene.entities.find(e => e.id === "E_top")?.label, "hν=3 eV");
  assert.equal(scene.entities.find(e => e.id === "kinetic")?.label, "K=1 eV");
}
console.log("repeated energy role gates passed");

// A display-only work function cannot rule out a sourced incident photon.
for (const [source, energy] of [
  ["photon energy is 1.5 eV", 1.5],
  ["photon energy is 2 eV", 2],
  ["photon energy is 0.5 eV", 0.5],
  ["incident wavelength is 1240 nm", 1],
] as const) {
  const question = `Photoelectric emission: ${source}.`;
  const match = detectArchetype(question, { plannerArchetype: "photoelectric" })!;
  const scene = generated("photoelectric", match.slots, match.sources, question);
  assert.ok(scene, `unknown work function cannot veto ${source}`);
  assert.equal(scene.entities.find(entity => entity.id === "E_top")?.label, `hν=${energy} eV`);
  assert.equal(scene.entities.find(entity => entity.id === "phi_top")?.label, "φ");
  assert.equal(scene.entities.find(entity => entity.id === "kinetic")?.label, "K");
  const sourceRead = readRadiationSource(question);
  assert.ok(sourceRead.status === "symbolic" && sourceRead.missing === "work_function");
  const physicalEnergy = source.startsWith("incident wavelength") ? 0.9998725680096795 : energy;
  assert.ok(sourceRead.photonEnergyEV !== null && Math.abs(sourceRead.photonEnergyEV - physicalEnergy) < 1e-12);
  assert.deepEqual(scene.quantities.map(({ id, value }) => ({ id, value })), [{ id: "E", value: Number(physicalEnergy.toFixed(6)) }]);
  const height = (id: string) => Number(scene.constructions.find(item => item.id === `make_${id}`)?.inputs.y);
  assert.equal(height("E_top"), Number(physicalEnergy.toFixed(4)), "incident geometry uses the builder's existing coordinate serialization");
  assert.ok(height("phi_top") > 0 && height("phi_top") < energy, "symbolic work function leaves a positive qualitative kinetic-energy arrow");
  assert.ok(height("k_tip") > height("k_base"), "kinetic-energy arrow points upward");
}
for (const energy of [1.5, 2]) {
  assert.equal(generated("photoelectric", { workFunction: 2, photonEnergy: energy }, { workFunction: "stem", photonEnergy: "stem" }), null,
    "two grounded values still reject non-emitting energy balances");
}
for (const expression of [
  "2 × 3", "2×3", "2 ÷ 3", "2÷3", "2 x 3", "2 X 3", "2 ⋅ 3", "2 · 3", "2 ∙ 3", "2 ∗ 3",
  "2 + 3", "2 − 3", "2 / 3", "2 ⁄ 3", "2 ∕ 3", "2 ^ 3", "2²", "2(3)",
]) {
  const question = `Draw a standing wave on a string with n = ${expression}.`;
  const match = detectArchetype(question, { plannerArchetype: "standing_wave" })!;
  assert.equal(match.slots.harmonic, undefined, `do not partially read n = ${expression}`);
  assert.equal(match.slots.harmonicUnresolved, "unread", question);
  assert.equal(generated("standing_wave", match.slots, match.sources, question), null, question);
}
console.log("partial photoelectric authority and whole harmonic-expression gates passed");

// Parenthetical mode descriptions are explanations, not implicit multiplication.
for (const description of ["third harmonic", "3rd harmonic", "third mode", "second overtone", "the third harmonic"]) {
  const question = `Draw a standing wave on a string with n = 3 (${description}).`;
  const match = detectArchetype(question, { plannerArchetype: "standing_wave" })!;
  assert.equal(match.slots.harmonic, 3, `accept compatible explanation: ${description}`);
  assert.equal(match.sources.harmonic, "stem");
  const scene = generated("standing_wave", match.slots, match.sources, question);
  assert.ok(scene, question);
  assert.equal(scene.entities.find(entity => entity.id === "wave")?.label, "n=3");
  assert.equal(scene.entities.filter(entity => /^node\d+$/.test(entity.id)).length, 4);
  assert.equal(scene.entities.filter(entity => /^antinode\d+$/.test(entity.id)).length, 3);
}
for (const specification of [
  "3 (second harmonic)", "3 (second mode)", "3 (third overtone)",
  "2(3)", "2 (3)", "2 (3 + 1)", "2 (x)", "2 (third harmonic + 1)",
  "3 (third harmonic) (2)", "3 (third harmonic) × 2",
]) {
  const question = `Draw a standing wave on a string with n = ${specification}.`;
  const match = detectArchetype(question, { plannerArchetype: "standing_wave" })!;
  assert.equal(match.slots.harmonic, undefined, `refuse conflict or multiplication: ${specification}`);
  assert.equal(match.slots.harmonicUnresolved, "unread");
  assert.equal(generated("standing_wave", match.slots, match.sources, question), null);
}
console.log("parenthetical mode explanation gates passed");
