import { strict as assert } from "node:assert";
import type { SceneDocument, TurnPlanV3 } from "../../src/index";
const engine = process.argv.includes("--compiled-boundary") ? await import("../../dist/index.js") : await import("../../src/index");

const question = "In Cartesian coordinates, A=(0,0), B=(3,4). Show the distance AB.";
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
function document(a: unknown = { x: 0, y: 0 }, b: unknown = { x: 3, y: 4 }, stem = question): SceneDocument {
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source input control" }, source: { question: stem }, quantities: [], entities: [{ id: "distance", kind: "segment", role: "distance AB" }], constructions: [{ id: "makeDistance", operator: "coordinate_distance", inputs: { a, b }, outputs: ["distance"] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ["distance"], revealGroups: [{ id: "distanceGroup", entityIds: ["distance"], dependsOn: [], narrationCue: "distance" }], teachingTimeline: [] };
}
let checks = 0;
function accepted(doc: SceneDocument, stem = question): void {
  assert.deepEqual(engine.validateCoordinateDistanceSourceInputs(doc, stem), []); checks++;
  assert.equal(engine.validateTurnPlanSceneProofs(doc, { ...plan, question: stem }).filter((issue) => issue.severity === "fatal").length, 0); checks++;
}
function rejected(doc: SceneDocument, ...stems: [unknown?]): void {
  const stem = stems.length > 0 ? stems[0] : question;
  const issues = engine.validateCoordinateDistanceSourceInputs(doc, stem);
  assert.ok(issues.some((issue) => issue.severity === "fatal"), `Expected source decline: ${String(stem)}`); checks++;
}
accepted(document());
accepted(document([0, 0], [3, 4]));
accepted(document({ x: 3, y: 4 }, { x: 0, y: 0 }));
accepted(document({ x: "0", y: "0" }, { x: { value: 3 }, y: { value: 4 } }));
const refs = document({ x: "ax", y: "ay" }, { x: "bx", y: "by" });
refs.quantities = [{ id: "ax", value: 0 }, { id: "ay", value: 0 }, { id: "bx", value: 3 }, { id: "by", value: 4 }];
accepted(refs);
const badRef = structuredClone(refs); badRef.quantities[2]!.value = 6; rejected(badRef);
const inline = structuredClone(refs); inline.constructions[0]!.inputs.b = { x: 6, y: 4 }; rejected(inline);
const originalCompile = engine.compileSceneDocument(inline);
assert.equal(originalCompile.ok, true); checks++;
assert.ok(originalCompile.renderScene!.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "d≈7.211")); // sqrt(52) is rounded, so the engine says ≈ checks++;
assert.ok(engine.validateTurnPlanSceneProofs(inline, plan).some((issue) => issue.code === "coordinate_source_mismatch")); checks++;
assert.ok(engine.validateTurnPlanSceneProofs(inline, null).some((issue) => issue.code === "coordinate_source_mismatch")); checks++;
rejected(document({ x: 3, y: 0 }, { x: 6, y: 4 }));
assert.equal(Math.hypot(6 - 3, 4), 5); checks++;
rejected(document({ x: 0, y: 0 }, { x: 4, y: 3 }));
const named = document("A", "B");
named.constructions.unshift({ id: "Apoint", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["A"] }, { id: "Bpoint", operator: "point", inputs: { x: 3, y: 4, coordinateSpace: "world" }, outputs: ["B"] });
accepted(named);
const swappedNames = structuredClone(named); swappedNames.constructions[0]!.inputs = { x: 3, y: 4 }; swappedNames.constructions[1]!.inputs = { x: 0, y: 0 }; rejected(swappedNames);
const canvas = structuredClone(named); canvas.constructions[0]!.inputs.coordinateSpace = "canvas"; rejected(canvas);
const duplicate = structuredClone(refs); duplicate.quantities.push({ id: "bx", value: 6 }); rejected(duplicate);
const unit = structuredClone(refs); unit.quantities[2]!.unit = "cm"; rejected(unit);
const numericShadow = document({ x: 0, y: 0 }, { x: "3", y: 4 }); numericShadow.quantities = [{ id: "3", value: 6, unit: "cm" }]; rejected(numericShadow);
for (const stem of [
  `The statement "${question}" is false.`, `Suppose someone said: ${question}`, `${question} However, B is not (3,4).`, `${question} Is that true?`, `${question} Ignore the given coordinates.`, question.replace("Show the distance AB", "Is B=(3,4)"), question.replace("B=(3,4)", "C=(3,4)"), question.replace("distance AB", "distance AA"), question.replace("B=(3,4)", "A=(3,4)"), question.replace("Cartesian", "polar"), question.replace("B=(3,4)", "B=(3,4) metres"), question.replace("B=(3,4)", "B=(3,4,5)"), question.replace("B=(3,4)", "B=(3e-13,4)"), question.replace("B=(3,4)", "B=(3e13,4)"), undefined, null, 3,
]) rejected(document(), stem);
let reads = 0;
const getter = Object.defineProperty({ y: 4 }, "x", { enumerable: true, get() { reads++; return 3; } });
rejected(document({ x: 0, y: 0 }, getter)); assert.equal(reads, 0); checks++;
rejected(document({ x: 0, y: 0 }, Object.create({ x: 3, y: 4 })));
const symbol = { x: 3, y: 4, [Symbol("scope")]: true }; rejected(document({ x: 0, y: 0 }, symbol));
const sparse = [3, 4]; delete sparse[0]; rejected(document([0, 0], sparse));
rejected(document({ x: false, y: 0 }, { x: 3, y: 4 }));
rejected(document({ x: 0, y: 0 }, { x: "ax+3", y: 4 }));
let seed = 871;
for (let i = 0; i < 257; i++) {
  const next = () => { seed = (seed * 48271) % 2147483647; return seed % 101 - 50; };
  const a = { x: next(), y: next() }; const b = { x: next(), y: next() };
  const stem = `In Cartesian coordinates, P1=(${a.x},${a.y}); Q2=(${b.x},${b.y}). Calculate the distance between Q2 and P1.`;
  accepted(document(a, b, stem), stem);
  rejected(document(a, { x: b.x + 1, y: b.y }, stem), stem);
  rejected(document({ x: a.x + 1, y: a.y }, { x: b.x + 1, y: b.y }, stem), stem);
}
console.log(JSON.stringify({ gate: "HEY88-coordinate-source-binding", checks, withheldSyntheticPairs: 257, numericCompilePreserved: true, sourceCohortAndTopicAcceptance: "not_claimed" }));
