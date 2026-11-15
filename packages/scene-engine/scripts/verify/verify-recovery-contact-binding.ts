import assert from "node:assert/strict";
import { SceneBuilder } from "../../src/archetypes/document";
import { validateTurnPlanSceneProofs, type TurnPlanV3 } from "../../src/contracts/contractsV3";

// The straight support and loop meet at P. Explicit proof ownership beats
// geometric coincidence; neither a false acceptance nor refusal is allowed.
const scene = new SceneBuilder("A body contacts a straight support where it intersects a loop.", "explicit support ownership", "synthetic");
scene.point("O", { x: 0, y: 0 }, "centre");
scene.point("P", { x: 0, y: 2 }, "contact");
scene.point("A", { x: -1, y: 1 }, "support start");
scene.point("B", { x: 1, y: 3 }, "support end");
scene.circle("loop", "O", 2, "circular track");
scene.segment("incline", "A", "B", "straight support incline");
scene.vector("normal", "P", { direction: { x: 0, y: -1 }, length: 1 }, "normal reaction", "N");
scene.assert("bound_support", "perpendicular", ["normal", "incline"]);
scene.group("setup", ["O", "P", "A", "B", "loop", "incline", "normal"], "contact");
const document = scene.build();
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: String(document.source.question), givens: [], derived: [], unknowns: [], lawIds: [], qualitativeClaims: [], assumptions: [], visualRequirement: "required" };
const errors = (value = document) => validateTurnPlanSceneProofs(value, plan).filter(i => i.code === "physical_direction_relation_failed");
assert(errors().some(i => i.entityIds?.includes("incline")), "a radial loop normal cannot ignore its explicitly bound straight support");
const correct = structuredClone(document);
correct.constructions.find(c => c.outputs.includes("normal"))!.inputs.direction = [1, -1];
assert.deepEqual(errors(correct), [], "the correct straight-support normal is not held to the incidental loop");
const tangent = structuredClone(correct);
tangent.constructions.find(c => c.outputs.includes("A"))!.inputs.x = 0;
tangent.constructions.find(c => c.outputs.includes("B"))!.inputs.x = 0;
tangent.constructions.find(c => c.outputs.includes("normal"))!.inputs.direction = [1, 0];
assert.deepEqual(errors(tangent), [], "a normal tangent to the loop can belong to the explicitly bound vertical support");
const relation = structuredClone(document);
relation.assertions = relation.assertions.filter(a => a.id !== "bound_support");
relation.relations.push({ id: "support_relation", predicate: "perpendicular", entities: ["incline", "normal"] });
assert(errors(relation).some(i => i.entityIds?.includes("incline")), "explicit relation targets retain ownership in reversed order");
const unbound = structuredClone(document);
unbound.assertions = unbound.assertions.filter(a => a.id !== "bound_support");
assert.deepEqual(errors(unbound), [], "the original unique incident loop inference remains available without a binding");
const conflicting = structuredClone(correct);
conflicting.assertions.push({ id: "also_loop", predicate: "perpendicular", entities: ["normal", "loop"], expected: true, severity: "fatal" });
assert(errors(conflicting).some(i => i.entityIds?.includes("loop")), "every explicit support is checked; a second binding cannot disappear");
const circleBound = structuredClone(document);
circleBound.assertions.find(a => a.id === "bound_support")!.entities = ["normal", "loop"];
assert.deepEqual(errors(circleBound), [], "an explicit circular support also owns its relation");
const unrelated = structuredClone(document);
unrelated.entities = unrelated.entities.filter(e => e.id !== "loop");
unrelated.constructions = unrelated.constructions.filter(c => !c.outputs.includes("loop"));
unrelated.assertions = unrelated.assertions.filter(a => a.id !== "bound_support");
unrelated.constructions.find(c => c.outputs.includes("normal"))!.inputs.direction = [0, -1];
unrelated.entities.push({ id: "groundA", kind: "point" }, { id: "groundB", kind: "point" }, { id: "ground", kind: "segment" });
unrelated.constructions.push(
  { id: "makeGA", operator: "point", inputs: { x: -2, y: -3, coordinateSpace: "world" }, outputs: ["groundA"] },
  { id: "makeGB", operator: "point", inputs: { x: 2, y: -3, coordinateSpace: "world" }, outputs: ["groundB"] },
  { id: "makeG", operator: "segment", inputs: { start: "groundA", end: "groundB" }, outputs: ["ground"] },
);
unrelated.assertions.push({ id: "unrelated_angle", predicate: "perpendicular", entities: ["normal", "ground"], expected: true, severity: "fatal" });
assert(errors(unrelated).some(i => i.entityIds?.includes("incline")), "an unrelated angle proof is not a new contact binding");
const otherContact = structuredClone(unrelated);
otherContact.constructions.find(c => c.outputs.includes("groundA"))!.inputs = { x: 0, y: 1, coordinateSpace: "world" };
otherContact.constructions.find(c => c.outputs.includes("groundB"))!.inputs = { x: 0, y: 3, coordinateSpace: "world" };
otherContact.constructions.find(c => c.outputs.includes("normal"))!.inputs.direction = [1, 0];
assert.deepEqual(errors(otherContact), [], "a second straight support incident at the origin owns an explicit binding");
const extension = structuredClone(otherContact);
extension.constructions.find(c => c.outputs.includes("groundA"))!.inputs.y = -3;
extension.constructions.find(c => c.outputs.includes("groundB"))!.inputs.y = -1;
assert(errors(extension).some(i => i.entityIds?.includes("incline")), "incidence on a finite segment's extension is not contact");
console.log("contact binding: explicit straight support wins over incidental circles; inferred loop contacts remain checked");
