/** PR 201 review: dimensions alone do not bind a number to a physical role. */
import assert from "node:assert/strict";
import { detectArchetype } from "../../src/archetypes/detect";
import { generatorFor } from "../../src/archetypes/generators";
import type { ArchetypeId } from "../../src/archetypes/catalog";
import { numbersWithUnit, prepareStem, UNIT } from "../../src/archetypes/slots";

function read(question: string, id: ArchetypeId) {
  const match = detectArchetype(question, { plannerArchetype: id });
  assert.ok(match, `read requested archetype: ${question}`);
  assert.equal(match.id, id);
  const scene = generatorFor(id)!({ question, slots: match.slots, sources: match.sources, quantities: [], schematic: true });
  return { ...match, scene, labels: scene?.entities.flatMap((entity) => entity.label ? [entity.label] : []) ?? [] };
}
for (const resistivity of ["2.0 × 10⁻⁷", "3π×10⁻⁷", "2.0×10⁻⁸", "2.0 x 10^-7", "0.0000002"]) {
  const row = read(`A wire of resistivity ${resistivity} Ω m, length 3.0 m, area 0.60 mm². Draw the resistor.`, "resistor_network");
  assert.equal(row.slots.resistors, undefined, "resistivity is not a resistance");
  assert.ok(row.labels.every((label) => !/R\s*=\s*\d|\d\s*Ω/.test(label)), "no resistor value from a resistivity exponent");
}
const resistance = read("Draw two resistors of 7 Ω and 8 Ω connected in series.", "resistor_network");
assert.deepEqual(resistance.slots.resistors, [7, 8], "actual resistance values remain available");
for (const speed of ["4.0×10⁵", "20"]) {
  const row = read(`A charged particle enters a 0.40 T magnetic field with speed ${speed} m/s. Draw its circular path.`, "charge_in_magnetic_field");
  assert.equal(row.slots.radius, undefined, "speed must not be interpreted as a radius");
  assert.ok(row.labels.every((label) => !/^r=/.test(label)));
  assert.deepEqual(numbersWithUnit(prepareStem(`${speed} m/s`), UNIT.metre), [], "a compound speed unit is not a metre unit");
}
assert.deepEqual(numbersWithUnit(prepareStem("4.0×10⁵ m"), UNIT.metre), [400000]);
for (const radius of ["6.4×10⁶", "6400000"]) {
  const row = read(`A body is dropped into a tunnel through a planet of radius ${radius} m. Draw the free fall.`, "free_fall");
  assert.equal(row.slots.h, undefined, "planet radius is not drop height");
  assert.ok(row.labels.every((label) => !/^h=/.test(label)));
}
assert.equal(read("A ball is dropped from a height of 25 m. Draw the free fall.", "free_fall").slots.h, 25);
assert.equal(read("A ball is dropped from a 25 m high tower. Draw the free fall.", "free_fall").slots.h, 25);
for (const question of [
  "Draw a satellite orbit of radius 8.0×10⁶ m around Earth.",
  "Draw an electron orbit of radius 1.0×10⁻¹⁰ m.",
  "Draw a satellite with orbital radius 8.0×10⁶ m around a planet of radius 6.4×10⁶ m.",
  "A planet of radius 6.4×10⁶ m has a satellite with orbital radius 8.0×10⁶ m. Draw the orbit.",
]) {
  const row = read(question, "satellite_orbit");
  const expected = question.includes("electron") ? 1e-10 : 8e6;
  assert.equal(row.slots.radius, expected, "bind orbital radius with its stated unit, independent of planet order");
  const numericRadius = row.labels.find((label) => /^r=/.test(label));
  if (numericRadius) assert.equal(numericRadius, expected === 8e6 ? "r=8000 km" : "r=1e-13 km", "metres convert to km exactly once");
}
const planetOnly = read("A planet of radius 6400 km has a satellite. Draw its orbit.", "satellite_orbit");
assert.equal(planetOnly.slots.radius, undefined, "planet-only radius cannot label the orbit");
assert.ok(!planetOnly.labels.some((label) => /^r=/.test(label)));
assert.equal(read("Draw a satellite with orbital radius 8000 km.", "satellite_orbit").slots.radius, 8e6);
for (const [height, expectedHeight] of [["800 km", 800000], ["800000 m", 800000], ["8.0×10⁶ m", 8000000]] as const) {
  const withoutPlanet = read(`A satellite is at altitude ${height}. Draw its orbit.`, "satellite_orbit");
  assert.equal(withoutPlanet.slots.height, expectedHeight, "satellite altitude uses its required unit");
  assert.equal(withoutPlanet.slots.planetRadius, undefined);
  assert.equal(withoutPlanet.scene?.entities.find(entity => entity.id === "height")?.label, `h=${expectedHeight / 1000} km`, "height label converts SI to km once");
  assert.equal(withoutPlanet.scene?.entities.find(entity => entity.id === "radius")?.label, "r", "a display planet radius cannot authorize a derived orbit label");
  const grounded = read(`A satellite is at altitude ${height} above a planet of radius 6400 km. Draw its orbit.`, "satellite_orbit");
  assert.equal(grounded.slots.planetRadius, 6400000, "planet radius is independently source-bound");
  assert.equal(grounded.scene?.entities.find(entity => entity.id === "radius")?.label, `r=${(expectedHeight + 6400000) / 1000} km`, "derived orbital radius requires both measured operands");
}
const metrePlanet = read("A satellite has height 800000 m above the surface; the radius of the planet is 6400000 m. Draw the orbit.", "satellite_orbit");
assert.equal(metrePlanet.slots.height, 800000);
assert.equal(metrePlanet.slots.planetRadius, 6400000);
assert.equal(metrePlanet.scene?.entities.find(entity => entity.id === "radius")?.label, "r=7200 km");
for (const height of ["800", "800 m/s"]) {
  const row = read(`A satellite has height ${height}. Draw its orbit.`, "satellite_orbit");
  assert.equal(row.slots.height, undefined, "missing or incorrect altitude dimensions stay symbolic");
  assert.equal(row.scene?.entities.find(entity => entity.id === "radius")?.label, "r");
}
for (const question of [
  "Calculate the work function when light of 5 eV ejects electrons with kinetic energy 2 eV.",
  "Find the work function if photons of 6 eV eject electrons with kinetic energy 2 eV.",
  "Find the work function; photon energy is 5 eV.",
  "Find the work function when the kinetic energy is 2 eV.",
  "Find the work function for a stopping potential of 2 V.",
]) {
  const row = read(question, "photoelectric");
  assert.equal(row.slots.workFunction, undefined, "unknown work function cannot bind a competing quantity");
  assert.equal(row.scene?.entities.find((entity) => entity.id === "phi_top")?.label, "φ");
}
for (const threshold of ["maximum", "longest", "maximum allowed", "longest permitted", "maximum physically possible", "threshold", "cutoff"]) {
  const row = read(`The ${threshold} wavelength for photoemission is 600 nm and the work function is 1.5 eV.`, "photoelectric");
  assert.equal(row.slots.lambda, undefined, "threshold wavelength cannot become incident energy");
  assert.equal(row.scene?.entities.find((entity) => entity.id === "E_top")?.label, "hν");
  assert.equal(row.scene?.entities.find((entity) => entity.id === "kinetic")?.label, "K");
}
for (const source of [
  "maximum allowed wavelength is 600 nm; incident wavelength is 400 nm",
  "longest permitted wavelength is 600 nm and incident wavelength is 400 nm",
  "incident wavelength is 400 nm; maximum allowed wavelength is 600 nm",
  "maximum efficiency is desired, but incident wavelength is 400 nm",
]) {
  const row = read(`Photoelectric emission: ${source}; work function is 2 eV.`, "photoelectric");
  assert.equal(row.slots.lambda, 400, "threshold modifiers must stop at a quantity or clause boundary");
  assert.equal(row.scene?.entities.find((entity) => entity.id === "E_top")?.label, "hν=3.1 eV");
}
for (const energy of ["3.2 × 10⁻¹⁹ J", "3.2e-19 J", "2 eV"]) {
  const row = read(`The work function of the metal is ${energy}; incident wavelength is 400 nm.`, "photoelectric");
  assert.ok(Math.abs(Number(row.slots.workFunction) - 2) < 0.01, "positive role-bound energies retain exponent/unit conversion");
  assert.equal(row.slots.lambda, 400);
  assert.equal(row.scene?.entities.find((entity) => entity.id === "E_top")?.label, "hν=3.1 eV");
}
console.log("archetype number-role review gates passed");
