/** Whole compound roles, fixed/parameterized source contracts, and genuinely
 * requested unknowns remain separate from supplied-invalid declarations. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { detectArchetype } from "../../src/archetypes/detect";
import { generatorFor } from "../../src/archetypes/generators";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import { buildKineticsScene, kineticsFromStem, solveKinetics } from "../../src/chemistry/kinetics";
import { compileSceneDocument } from "../../src/compile/compiler";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";
import fixtures from "./fixtures/chemistry-f4-fronted-source-roles.json";
interface Gold { id: string; group: string; question: string; draw?: boolean; neutralDraw?: boolean; halfLife?: number; requested?: number; fraction?: number;
  archetype?: string; heatJ?: number; photonEnergyEV?: number; kineticEV?: number }
const close = (actual: number, expected: number): void => assert.ok(Number.isFinite(actual)
  && Math.abs(actual - expected) <= Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-12), `${actual} != ${expected}`);
const text = (document: SceneDocument, question: string): string[] => {
  assert.equal(document.source.question, question);
  const compiled = compileSceneDocument(document); assert.ok(compiled.ok && compiled.renderScene);
  return compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []);
};
const results = (fixtures as Gold[]).map(gold => {
  try {
    const ordinary = synthesizeFamilyScene({ question: gold.question });
    const lastResort = synthesizeLastResortScene({ question: gold.question });
    if (gold.group === "fronted") {
      const direct = buildKineticsScene(gold.question, [], false);
      for (const [route, document] of [["direct", direct], ["ordinary", ordinary?.document], ["lastResort", lastResort?.document]] as const) {
        const neutral = gold.neutralDraw && route !== "direct";
        assert.equal(!!document, neutral || gold.draw);
        if (!document) continue;
        const labels = text(document, gold.question);
        if (neutral) {
          assert.equal(document.source.sourceModel, "mathematical_fraction_decay");
          assert.equal(document.source.chemistryFamily, undefined);
          assert.ok(labels.includes("First-order law"));
          assert.ok(!labels.some(label => /N2O5|N2Q5/.test(label)), "no validated species identity");
          close(document.quantities.find(quantity => quantity.id === "requested_fraction")!.value, gold.fraction!);
          close(document.quantities.find(quantity => quantity.id === "requested_time")!.value, gold.requested!);
        }
        const spec = kineticsFromStem(gold.question); assert.ok(spec);
        const solved = solveKinetics(spec); close(solved.tHalf!, gold.halfLife!); assert.equal(solved.timeUnit, "min");
        close(Math.exp(-solved.k! * gold.requested!), gold.fraction!);
        assert.ok(labels.some(label => label.replace(/\s/g, "").includes(`${gold.requested}min`)), "actual requested time paint");
        assert.ok(labels.some(label => label === "1/8" || label.includes("0.125")), "actual source fraction paint");
        assert.ok(document.assertions.some(check => check.predicate === "function_value" && check.severity === "fatal"));
      }
    } else if (gold.group === "facade") {
      const direct = buildAtomicRadiationScene(gold.question, [], false);
      assert.equal(!!direct, gold.draw);
      const source = readRadiationSource(gold.question);
      if (gold.draw) {
        assert.ok(direct); text(direct, gold.question);
        assert.equal(source.status, "source");
        if (source.status === "source") assert.equal(source.model.constantAuthority, "atomic_reference");
      } else { assert.equal(source.status, "declined"); assert.equal(ordinary, null); assert.equal(lastResort, null); }
    } else if (gold.group === "symbolic_phi") {
      const match = detectArchetype(gold.question, { plannerArchetype: "photoelectric" }); assert.ok(match);
      assert.equal(match.slots.workFunction, undefined);
      const scene = generatorFor("photoelectric")!({ question: gold.question, slots: match.slots, sources: match.sources, quantities: [], schematic: true });
      assert.ok(scene); assert.equal(scene.entities.find(entity => entity.id === "phi_top")?.label, "φ");
      assert.ok(!scene.quantities.some(quantity => quantity.symbol === "phi"), "no invented numeric work function");
      text(scene, gold.question);
    } else if (gold.group === "excluded") {
      for (const result of [ordinary, lastResort]) {
        assert.equal(!!result, gold.draw);
        if (!result) continue;
        assert.equal(result.document.source.archetype, gold.archetype); text(result.document, gold.question);
      }
    } else if (gold.group === "capacity") {
      const direct = buildChemicalThermodynamicsScene(gold.question, [], false);
      assert.equal(!!direct, gold.draw);
      if (direct) assert.ok(text(direct, gold.question).some(label => label.includes(`q=${gold.heatJ} J`)));
    } else {
      assert.equal(gold.group, "parameterized");
      const source = readRadiationSource(gold.question); assert.ok(source.status === "source" && source.model.kind === "photoelectric");
      assert.equal(source.model.constantAuthority, "source_parameterized");
      close(source.model.photonEnergyEV, gold.photonEnergyEV!); close(source.model.kineticEV!, gold.kineticEV!);
      const direct = buildAtomicRadiationScene(gold.question, [], false); assert.ok(direct); text(direct, gold.question);
      for (const result of [ordinary, lastResort]) { assert.ok(result); text(result.document, gold.question); }
    }
    return { id: gold.id, passed: true };
  } catch (error) { return { id: gold.id, passed: false, error: String(error) }; }
});
const report = { passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, results };
if (process.argv.includes("--out")) writeFileSync(process.argv[process.argv.indexOf("--out") + 1]!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report)); process.exitCode = report.failed ? 1 : 0;
