import assert from "node:assert/strict";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { readMassMolaritySource, massMolarityProblem, buildMassMolarityScene } from "../../src/chemistry/massMolarity";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../src/ir/solver";

const examples = [
  ["Find the molarity of a solution containing 5.85 g of NaCl in 500 mL of solution.", 5.85/(22.990+35.45)/0.5],
  ["Find the molarity of a solution containing 0.00585 kg of NaCl in 0.5 L of solution.", 5.85/58.44/0.5],
  ["A solution contains 18.015 g of H2O in 2 L of solution. Find its molarity.", 0.5],
  ["A solution contains 7.4092 g of Ca(OH)2 in 100 cm^3 of solution. Find its molarity.", 1],
  ["Find the molarity of a solution containing 0.180156 g of C₆H₁₂O₆ in 1 dm^3 of solution.", 0.001],
] as const;
async function main() {
  for (const [question,expected] of examples) {
    const result = synthesizeFamilyScene({ question });
    assert(result, "mass + formula + solution volume must compose a source-bound molarity figure");
    assert.equal(result.family, "chem_solutions");
    assert.equal(result.tier,"qualitative_verified");
    const compiled = compileSceneDocument(result.document);
    assert(compiled.ok && compiled.renderScene);
    assert(compiled.renderScene.primitives.flatMap(p=>p.points).every(p=>p.x>=400 && p.x<=1160 && p.y>=0 && p.y<=700));
    assert(Math.abs(readMassMolaritySource(question)!.concentration-expected)<1e-10);
    const problem = massMolarityProblem(question)!;
    const solved = await new LocalDeterministicSolverProvider().solve(problem);
    assert.equal(solved.status,"solved");
    assert(validateSolverResult(solved,problem).valid);
    assert(Math.abs(Number(solved.values[0]!.approximate)-expected)<1e-10);
    const tampered = structuredClone(solved); tampered.values[0]!.approximate=42;
    assert.equal(validateSolverResult(tampered,problem).valid,false);
    const answer = {id:"molarity",symbol:"c",value:expected,unit:"mol/L",origin:"derived" as const};
    assert(buildMassMolarityScene(question,[answer]));
    assert.equal(buildMassMolarityScene(question,[{...answer,value:expected*2}]),null);
    assert.equal(buildMassMolarityScene(question,[{...answer,symbol:"n",unit:"mol"}]),null);
    assert.equal(buildMassMolarityScene(question,[{...answer,unit:"kg"}]),null);
  }
  const base = examples[0][0];
  const negatives = [
    base.replace("5.85 g", "unknown g"), base.replace("5.85 g", "-5.85 g"), base.replace("5.85 g", "0 g"),
    base.replace("5.85 g", "5.85 kg/m^3"), base.replace("NaCl", "solute"), base.replace("NaCl", "nacl"),
    base.replace("NaCl", "NaCl and KCl"), base.replace("NaCl", "NaCl·2H2O"),
    base.replace("500 mL", "0 mL"), base.replace("500 mL", "500 ML"), base.replace("500 mL", "500 mL/s"),
    base.replace("of solution.", "of solvent."), base.replace("of solution.", "of water."),
    base.replace("5.85 g of NaCl", "5.85 g of NaCl and 2 g of KCl"),
    base+" The molar mass is 40 g/mol.", base+" The solute mass is unreadable.",
    base+" The molarity is 1 mol/L.", base+" It is not a solution.",
  ];
  for (const question of negatives) {
    assert.equal(readMassMolaritySource(question),null,question);
    const result = synthesizeFamilyScene({question});
    assert(!result || result.document.source.sourceModel!=="formula_mass_molarity/v1",question);
  }
  console.log(`mass-molarity: ${examples.length} source/compile/solver cases, 20 stale-role/unit checks and ${negatives.length} source negatives passed`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
