import { strict as assert } from "node:assert";
import { levelRelationSource } from "../../src/physics/levelRelationSource";
import { detectArchetype } from "../../src/archetypes/detect";
const { synthesizeFamilyScene, synthesizeLastResortScene } = process.argv.includes("--compiled-boundary") ? await import("../../dist/index.js") : await import("../../src/index");

const emit = "A hydrogen atom emits a photon during the transition from n=3 to n=2. Draw the energy level diagram.";
const absorb = "A hydrogen atom absorbs a photon during the transition from n=2 to n=3. Draw the energy level diagram.";
for (const question of [emit, absorb, "A hydrogen atom emits a photon during the transition from n=12 to n=3.", "A hydrogen atom absorbs a photon during the transition from n=3 to n=12."]) {
  const relation = levelRelationSource(question)!;
  assert.ok(relation);
  const scene = synthesizeFamilyScene({ question, families: ["energy_level"] });
  assert.ok(scene, question);
  assert.equal(scene.nonMetric, true);
  assert.notEqual(scene.tier, "exact_verified");
  assert.equal(scene.document.quantities.length, 0);
  assert.ok(scene.document.entities.some((e) => e.label === `n=${relation.from}`));
  assert.ok(scene.document.entities.some((e) => e.label === `n=${relation.to}`));
  const transition = scene.document.constructions.find((c) => c.outputs.includes("level_relation"))!;
  assert.equal(transition.operator, "vector");
  assert.equal(transition.inputs.start, `level_${relation.from}_center`);
  assert.equal(transition.inputs.end, `level_${relation.to}_center`);
  assert.ok(scene.renderScene.caption?.includes("not to scale"));
  const arrow = scene.renderScene.primitives.find((primitive) => primitive.entityId === "level_relation" && primitive.kind === "vector")!;
  assert.ok(arrow);
  const screenDelta = arrow.points.at(-1)!.y - arrow.points[0].y;
  assert.ok(relation.from! > relation.to! ? screenDelta > 0 : screenDelta < 0, "Physical energy ordering must survive canvas y-down projection");
  const detected = detectArchetype(question);
  assert.equal(detected?.id, "bohr_transition");
  assert.equal(detected!.slots.from, relation.from);
  assert.equal(detected!.slots.to, relation.to);
}
for (const [name, finalN] of [["Lyman", 1], ["Balmer", 2], ["Paschen", 3], ["Brackett", 4], ["Pfund", 5], ["Humphreys", 6]] as const) {
  const question = `Draw the energy level diagram for the ${name} series of the hydrogen atom.`;
  const source = levelRelationSource(question)!;
  assert.equal(source.lower, finalN);
  assert.equal(source.upper, finalN + 1);
  assert.equal(source.from, null);
  assert.equal(source.to, null);
  const scene = synthesizeLastResortScene({ question, families: ["energy_level"] });
  assert.ok(scene, name);
  assert.equal(scene.tier, "question_representation");
  assert.ok(scene.document.entities.some((e) => e.label === `n=${finalN}`));
  assert.ok(scene.document.entities.some((e) => e.label === `n=${finalN + 1},${finalN + 2},...`));
  assert.equal(scene.document.constructions.find((c) => c.outputs.includes("level_relation"))?.operator, "segment");
  assert.ok(scene.renderScene.primitives.length > 0);
}
const unsupported = [emit + " The preceding statement is false.", `The statement '${emit}' is false.`,
  '"' + absorb + '"', emit + " Also draw the orbit radius and all scattering paths.",
  emit.replace("n=3 to n=2", "n=2 to n=3"), absorb.replace("n=2 to n=3", "n=3 to n=2"),
  emit.replace("n=3", "n=65"), emit.replace("n=3", "n=2"), emit.replace("hydrogen", "helium")];
for (const question of unsupported) {
  assert.equal(levelRelationSource(question), null);
  assert.equal(synthesizeFamilyScene({ question, families: ["energy_level"] }), null, question);
  assert.equal(synthesizeLastResortScene({ question, families: ["energy_level"] }), null, question);
}
console.log(JSON.stringify({ gate: "HEY88-source-level-relations", directedExamples: 4, indexedCollections: 6, atomicDeclines: unsupported.length, metricEnergyAndSourceCohortReadiness: "not_claimed" }));
