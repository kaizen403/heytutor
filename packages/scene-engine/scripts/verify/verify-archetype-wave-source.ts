/** PR #201: named wave modes must select that geometry or decline. Offline. */
import assert from "node:assert/strict";
import { detectArchetype } from "../../src/archetypes/detect";
import { generatorFor } from "../../src/archetypes/generators";
import { parseMathExpression } from "../../src/math/expression";

function read(question: string) {
  const match = detectArchetype(question, { plannerArchetype: "standing_wave" });
  assert.ok(match, question);
  return { match, scene: generatorFor("standing_wave")!({ question, slots: match.slots, sources: match.sources, quantities: [], schematic: true }) };
}
const stringCases = [
  ["Draw a third-harmonic standing wave on a string", 3],
  ["Draw the second-harmonic standing wave on a string", 2],
  ["Draw the standing wave on a string vibrating in its third mode", 3],
  ["Draw a 0.50 m string fixed at both ends with a stated fourth-harmonic frequency", 4],
  ["Draw the 3rd harmonic standing wave on a string fixed at both ends", 3],
  ["Draw the third overtone of a string fixed at both ends", 4],
  ["Draw the standing wave for n = 3 on a string fixed at both ends", 3],
  ["Draw the standing wave with three loops on a stretched string", 3],
  ["Draw a standing wave with 4 loops on a string", 4],
  ["Draw a standing wave on a string with n = 3.", 3],
  ["Draw a standing wave on a string: n=2. Mark the nodes.", 2],
  ["Draw a standing wave on a string (n=4).", 4],
  ["Draw a third‑harmonic standing wave on a string", 3],
  ["Draw a second–harmonic standing wave on a string", 2],
  ["Draw a standing wave in the fundamental mode on a string", 1],
  ["Draw the third harmonic on a string with fundamental frequency 100 Hz", 3],
  // A mode word with no number of its own refers back to the mode already read.
  // Real eval row physics|10|standing-waves-harmonics-and-beats|q2, verbatim.
  ["A.50 m string fixed at both ends has fourth-harmonic frequency 400 Hz. Its largest displacement amplitude in that mode is 1.0 mm. Determine wave speed,wavelength,node and antinode counts and spacings, and write a standing-wave equation with an antinode at maximum positive displacement at t=0. Find maximum particle acceleration and the lowest allowed frequency when the string tension is quadrupled without changing length or linear density.", 4],
  ["A string vibrates in its third harmonic. Sketch this mode and mark the nodes.", 3],
  ["A string vibrates in the second harmonic. How many loops are there? Draw the standing wave.", 2],
  ["Explain standing waves in strings, fundamental mode, and harmonics.", 1],
] as const;
for (const [question, n] of stringCases) {
  const { match, scene } = read(question);
  assert.equal(match.slots.harmonic, n, question);
  assert.equal(match.sources.harmonic, "stem", question);
  assert.ok(scene, question);
  assert.equal(scene.entities.find((entity) => entity.id === "wave")?.label, `n=${n}`, question);
  assert.equal(scene.entities.filter((entity) => /^node\d+$/.test(entity.id)).length, n + 1, question);
  assert.equal(scene.entities.filter((entity) => /^antinode\d+$/.test(entity.id)).length, n, question);
  const curve = scene.constructions.find((item) => item.id === "make_wave")!;
  const f = parseMathExpression(String(curve.inputs.expression));
  const length = Number(curve.inputs.xMax);
  for (let k = 0; k <= n; k++) assert.ok(Math.abs(f.evaluate(k * length / n)) < 1e-8, `${question}: exact node ${k}`);
  for (let k = 0; k < n; k++) assert.ok(Math.abs(Math.abs(f.evaluate((k + 0.5) * length / n)) - 1) < 1e-8, `${question}: exact antinode ${k}`);
}
for (const [question, n, closed] of [
  ["Draw the third harmonic in a pipe closed at one end", 3, true],
  ["Draw the first overtone in a closed organ pipe", 3, true],
  ["Draw the second overtone in a closed pipe", 5, true],
  ["Draw the third mode in a pipe with one end closed", 5, true],
  ["Draw the third-harmonic standing wave in an open pipe", 3, false],
  ["Draw the first overtone of an open organ pipe", 2, false],
  ["Draw the third harmonic of open organ pipes", 3, false],
  ["Draw the fundamental in a pipe open at both ends", 1, false],
] as const) {
  const { match, scene } = read(question);
  assert.equal(match.slots.harmonic, n, question);
  assert.equal(match.slots.ends, closed ? "closed_open" : "open", question);
  assert.ok(scene, question);
  assert.equal(scene.entities.find((entity) => entity.id === "wave")?.label, `n=${n}`, question);
  const curve = scene.constructions.find((item) => item.id === "make_wave")!;
  const length = Number(curve.inputs.xMax);
  const f = parseMathExpression(String(curve.inputs.expression));
  // The displacement of a closed end is zero; an open end is an antinode.
  assert.ok(Math.abs(f.evaluate(0) - (closed ? 0 : 1)) < 1e-8, `${question}: left boundary`);
  assert.ok(Math.abs(Math.abs(f.evaluate(length)) - 1) < 1e-8, `${question}: open right boundary`);
  const nodes = scene.constructions.filter((item) => /^make_node\d+$/.test(item.id));
  const antinodes = scene.constructions.filter((item) => /^make_antinode\d+$/.test(item.id));
  assert.equal(nodes.length, closed ? (n + 1) / 2 : n, `${question}: node count`);
  assert.equal(antinodes.length, closed ? (n + 1) / 2 : n + 1, `${question}: antinode count`);
  // Fixed physical sample checks catch a mislabeled odd mode even if both ends match.
  if (closed && n === 3) {
    assert.ok(Math.abs(f.evaluate(length / 3) - 1) < 1e-8, `${question}: first antinode at L/3 (3λ/4, not 5λ/4)`);
    assert.ok(Math.abs(f.evaluate(2 * length / 3)) < 1e-8, `${question}: interior node at 2L/3`);
  }
}
for (const question of [
  "Draw the third harmonic in a closed pipe with both ends closed",
  "Draw the second harmonic in a pipe closed at both ends",
  "Draw the fundamental in a pipe whose two ends are closed",
  "Draw the second harmonic in a pipe closed at one end",
  "Draw the fourth harmonic in a closed organ pipe",
  "Draw the third overtone in a closed pipe", // n=7 is outside this generator's supported range.
  "Draw the 16th harmonic on a string",
  "Draw a standing wave on a string in an eleventh mode",
  "Draw a standing wave on a string in an unfamiliar mode",
  "Draw a standing wave on a string at harmonic k",
  "Draw the standing wave for n = k on a string",
  "Draw the standing wave for n = 3.5 on a string",
  "Draw a standing wave on a string with n = 3.5.",
  "Draw a standing wave on a string with n = 2.25.",
  "Draw the standing wave for n = -3 on a string",
  "Draw the standing wave for n = 3/2 on a string",
  "Draw the standing wave for n = 3 / 2 on a string",
  "Draw the standing wave for n = 3 + 1 on a string",
  "Draw the standing wave with 3.5 loops on a string",
  "Draw the standing wave with -3 loops on a string",
  "Draw a standing wave with 1/2 loops on a string",
  "Draw a standing wave with 1 / 2 loops on a string",
  "Draw a standing wave with 2^3 loops on a string",
  "Draw a standing wave with 2 ^ 3 loops on a string",
  "Draw a standing wave with 2 + 3 loops on a string",
  "Draw a standing wave with 2 x 3 loops on a string",
  "Draw a standing wave with 2 × 3 loops on a string",
  "Draw the 1/2nd harmonic on a string",
  "Draw the 2^3rd harmonic on a string",
  "Draw the 2 + 3rd harmonic on a string",
  "Draw a standing wave with several loops on a string",
  "Draw the third harmonic and second harmonic on a string",
  "Draw the third harmonic and an unfamiliar overtone on a string",
  "Draw a standing wave in an organ pipe", // Boundary condition not given.
  "Draw standing waves in organ pipes", // Topic name does not imply fixed ends.
  "Draw a standing wave with three loops in an open pipe", // Pipe half-loop convention is ambiguous.
  // A leftover mode word that carries its own number, step or article asks for another mode.
  "A string vibrates in its third harmonic. Draw the next harmonic.",
  "A string vibrates in its third harmonic. Draw the next higher harmonic and mark its nodes.",
  "Draw the third harmonic on a string and compare it with the fifth harmonics of the same string.",
  "Draw the third and fourth harmonics on a string",
  "Draw the third harmonic on a string, then mode 5.",
  "Draw the third harmonic on a string and the harmonic k = 5",
  "Draw the third harmonic on a string and the mode with n = 5",
  "Draw the third harmonic on a string; also show a higher overtone.",
  "Draw the third harmonic on a string and all harmonics up to it",
  "A string vibrates in its third harmonic. Sketch this mode and then another mode.",
]) assert.equal(read(question).scene, null, `unread or unsupported state must decline: ${question}`);
// The reader itself marks a mode word with nothing read; the generator guard is a second layer.
for (const question of ["Draw a standing wave on a string in an unfamiliar mode", "Draw standing waves on a string and their harmonics"]) {
  assert.equal(read(question).match.slots.harmonicUnresolved, "unread", `reader marks an unread mode: ${question}`);
}
const direct = generatorFor("standing_wave")!;
assert.equal(direct({ question: "Draw the standing wave in an unknown mode on a string", slots: {}, sources: {}, quantities: [], schematic: true }), null, "direct callers cannot turn an unread mode into the fundamental");
for (const question of ["Draw a standing wave on a string", "Draw a standing wave on the first string", "Draw a standing wave on a string with fundamental frequency 100 Hz"]) {
  const { match, scene } = read(question);
  assert.equal(match.slots.harmonic, undefined, question);
  assert.equal(scene?.entities.find((entity) => entity.id === "wave")?.label, "envelope", question);
}
console.log(`archetype wave source gate: ${stringCases.length} string modes (including the verbatim fourth-harmonic eval row), 8 pipe modes, declined requests and direct/conceptual boundaries pass`);
