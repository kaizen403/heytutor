/** A conceptual unused constant is not numerical source authority. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { detectArchetype } from "../../src/archetypes/detect";
import { generatorFor } from "../../src/archetypes/generators";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import fixture from "./fixtures/chemistry-f4-symbolic-planck.json";
const results = fixture.map(gold => {
  const source = readRadiationSource(gold.question);
  const match = detectArchetype(gold.question, { plannerArchetype: "photoelectric" });
  const direct = match ? generatorFor("photoelectric")!({ question: gold.question,
    slots: { ...match.slots, workFunction: 99, photonEnergy: 888, lambda: 1, stoppingPotential: 77 }, sources: match.sources,
    quantities: [], schematic: true }) : null;
  const docs = [direct, synthesizeFamilyScene({ question: gold.question })?.document ?? null, synthesizeLastResortScene({ question: gold.question })?.document ?? null];
  const records = docs.map(document => ({ document, compiled: document ? compileSceneDocument(document) : null }));
  try {
    const draw = "publicDraw" in gold.expected && gold.expected.publicDraw === true;
    for (const { document, compiled } of records) {
      assert.equal(!!document, draw); if (!document) continue;
      assert.ok(compiled?.ok && compiled.renderScene); assert.equal(document.source.question, gold.question);
      assert.equal(document.source.nonMetric, true); assert.deepEqual(document.quantities, []);
      const text = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []);
      for (const mark of ["hν", "φ", "K"]) assert.ok(text.includes(mark));
      assert.ok(text.includes("if hν > φ") && text.includes("not to scale"));
      assert.ok(!text.some(label => /\d/.test(label)), "no borrowed slots, numeric defaults or physical ticks");
    }
    if (draw) assert.ok(source.status === "symbolic" && source.missing === "unused_planck_constant");
    else assert.equal(source.status, "declined");
    return { id: gold.id, passed: true, source, records };
  } catch (error) { return { id: gold.id, passed: false, error: String(error), source, records }; }
});
const report = { passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, results };
if (process.argv.includes("--out")) writeFileSync(process.argv[process.argv.indexOf("--out") + 1]!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, failures: results.filter(result => !result.passed).map(({ id, error }) => ({ id, error })) }));
process.exitCode = report.failed ? 1 : 0;
