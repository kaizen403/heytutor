/** Harness 5: source-bound bridge lengths and partial instrument givens. */
import assert from "node:assert/strict";
import { detectArchetype } from "../../src/archetypes/detect";
import { generatorFor } from "../../src/archetypes/generators";
import type { ArchetypeId } from "../../src/archetypes/catalog";
function scene(question: string, id: ArchetypeId) {
  const match = detectArchetype(question, { plannerArchetype: id });
  assert.ok(match);
  const document = generatorFor(id)!({ question, slots: match.slots, sources: match.sources, quantities: [], schematic: true });
  assert.ok(document);
  return { match, document };
}
for (const [id, question] of [
  ["meter_bridge", "Draw a metre bridge with a uniform 100 cm wire and explain how the balance point is found"],
  ["potentiometer", "Draw a potentiometer with a wire of length 10 m and find the balancing length for a 1.5 V cell"],
] as const) {
  const { match, document } = scene(question, id);
  assert.equal(match.slots.balance, undefined, "wire length and voltage are not balance lengths");
  assert.equal(document.entities.find(e => e.id === "J")?.label, "J");
  assert.ok(!document.quantities.some(q => q.id === "l"));
}
for (const [question, expectedLength, expectedTotal] of [
  ["In a potentiometer the balance point is at 240 cm on a 400 cm wire. Draw the circuit.", 240, 400],
  ["In a potentiometer with a wire of length 10 m the balancing length is 2.4 m. Draw the circuit.", 240, 1000],
  ["In a potentiometer the balancing length is 240 cm on a 40 m wire. Draw the circuit.", 240, 4000],
  ["In a potentiometer the balancing length is 2 cm on a 5 cm wire. Draw the circuit.", 2, 5],
  ["In a potentiometer the balance point is at 25 cm on a 1/2 m wire. Draw the circuit.", 25, 50],
  ["In a potentiometer the balance point is at 25 cm on a 4×10^2 cm wire. Draw the circuit.", 25, 400],
  ["In a potentiometer the balance point is at 1/4 m on a 1/2 m wire. Draw the circuit.", 25, 50],
] as const) {
  const { match, document } = scene(question, "potentiometer");
  assert.equal(match.slots.balance, expectedLength);
  assert.equal(match.slots.wireLength, expectedTotal, "wire lengths use the catalog's centimetre unit");
  assert.equal(document.entities.find(e => e.id === "J")?.label, `J (${expectedLength} cm)`);
  const jockey = document.constructions.find(c => c.outputs.includes("J"));
  assert.equal(jockey?.inputs.x, 10 * expectedLength / expectedTotal, "numeric label and contact geometry describe the same balance");
}
for (const id of ["meter_bridge", "potentiometer"] as const) {
  const document = generatorFor(id)!({ question: `Draw ${id}`, slots: { balance: 140 }, sources: { balance: "stem" }, quantities: [], schematic: true })!;
  assert.equal(document.entities.find(e => e.id === "J")?.label, "J", "out-of-range sourced balance cannot label a fallback location");
  assert.ok(!document.quantities.some(q => q.id === "l"), "a fallback must not publish a different balance as its physical quantity");
  const positive = scene(`Draw a ${id === "meter_bridge" ? "metre bridge" : "potentiometer"} with balance point at 40 cm.`, id);
  assert.equal(positive.document.entities.find(e => e.id === "J")?.label, "J (40 cm)");
}
const partial = scene("Draw a vernier calliper with main scale reading 23 mm and the 4th vernier division coinciding.", "vernier_calliper");
assert.equal(partial.match.slots.mainScaleReading, 23);
assert.equal(partial.match.slots.vernierDivision, 4);
assert.equal(partial.match.slots.leastCount, undefined);
assert.equal(partial.document.entities.find(e => e.id === "reading_note")?.label, "MSR + VSD × LC", "MSR and VSD alone do not authorize a numeric reading");
assert.equal(partial.document.entities.find(e => e.id === "coincide_mark")?.label, "coincidence");
assert.equal(partial.document.entities.find(e => e.id === "lc_note")?.label, "LC");
const complete = scene("Draw a vernier calliper with main scale reading 23 mm, least count 0.1 mm and the 4th vernier division coinciding.", "vernier_calliper");
assert.equal(complete.document.entities.find(e => e.id === "reading_note")?.label, "= 23.4 mm");
console.log("bridge/source and partial vernier givens gates passed");
