/** Source operators retain complete valid inputs independently of routing vocabulary. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import { isChemistryStem } from "../../src/chemistry/classify";
import { buildKineticsScene, kineticsFromStem, solveKinetics } from "../../src/chemistry/kinetics";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import fixtures from "./fixtures/chemistry-f4-source-availability.json";

interface Gold {
  id: string; question: string; kind: string; draw?: boolean; chemistry?: boolean;
  heatJ?: number; T1K?: number; T2K?: number; ratio?: number; activationEnergyJMol?: number;
}
const results = (fixtures as Gold[]).map(gold => {
  try {
    if (gold.kind === "subject") {
      assert.equal(isChemistryStem(gold.question), gold.chemistry);
    } else {
      const document = gold.kind === "thermal"
        ? buildChemicalThermodynamicsScene(gold.question, [], false)
        : buildKineticsScene(gold.question, [], false);
      assert.equal(!!document, gold.draw, "complete valid source must remain available");
      if (document) {
        assert.equal(document.source.question, gold.question);
        const compiled = compileSceneDocument(document);
        assert.ok(compiled.ok && compiled.renderScene, "ordinary compile is mandatory");
        if (gold.heatJ !== undefined) {
          assert.ok(compiled.renderScene.primitives.some(mark => mark.text?.includes(`q=${gold.heatJ} J`)));
          assert.equal(synthesizeFamilyScene({ question: gold.question })?.family, "chem_thermo");
        }
        if (gold.kind === "kinetics") {
          const spec = kineticsFromStem(gold.question); assert.ok(spec?.arrhenius);
          const solution = solveKinetics(spec);
          assert.equal(spec.arrhenius.T1, gold.T1K);
          assert.equal(solution.T2, gold.T2K);
          assert.equal(spec.arrhenius.ratio, gold.ratio);
          if (gold.activationEnergyJMol !== undefined) {
            assert.ok(solution.Ea !== null && Math.abs(solution.Ea - gold.activationEnergyJMol) < 0.001);
          }
        }
      } else {
        const ordinary = synthesizeFamilyScene({ question: gold.question });
        if (gold.kind === "thermal") assert.equal(ordinary, null, "no fallback may replace an invalid thermal source");
        else assert.notEqual(ordinary?.family, "chem_kinetics", "a mathematical source supplies no chemistry ownership");
      }
    }
    return { id: gold.id, passed: true };
  } catch (error) { return { id: gold.id, passed: false, error: String(error) }; }
});
const report = { passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
const out = process.argv[process.argv.indexOf("--out") + 1];
if (process.argv.includes("--out")) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
process.exitCode = report.failed ? 1 : 0;
