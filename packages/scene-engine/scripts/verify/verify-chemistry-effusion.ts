import assert from "node:assert/strict";
import { inferChemistryFamilies } from "../../src/chemistry";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { readEffusionSource, effusionProblem, buildEffusionScene, claimsEffusion } from "../../src/chemistry/effusion";
import { LocalDeterministicSolverProvider, validateSolverResult } from "../../src/ir/solver";
const context="At the same temperature and pressure, gases A and B effuse through the same porous membrane. The molar mass of A is 4 g/mol. ";
const ask=" Calculate the molar mass of B.";
const base=context+"The effusion rate ratio r_A/r_B = 2."+ask;
const samples=(va:string,ta:string,vb:string,tb:string)=>context+`A ${va} sample of A takes ${ta} to effuse. A ${vb} sample of B takes ${tb} to effuse.`+ask;
async function main() {
  for (const question of ["Pleural effusion: discuss diagnosis and treatment.","A patient has pericardial effusion.","Explain joint effusion after an injury."]) {
    assert.equal(claimsEffusion(question),false,"clinical fluid effusion is not a gas comparison");
    assert(!inferChemistryFamilies(question).includes("chem_effusion"));
  }
  const examples: [string,number][]=[];
  for (const mass of [4,28,44]) for (const ratio of [0.5,2,3]) for (const mode of ["rate","time"] as const) for (const reverse of [false,true]) {
    const value=reverse?1/ratio:ratio;
    const terms=mode==="rate"?`The effusion rate ratio r_${reverse?"B":"A"}/r_${reverse?"A":"B"}`:`For equal gas volumes, the effusion time ratio t_${reverse?"B":"A"}/t_${reverse?"A":"B"}`;
    const question=context.replace("4 g/mol",`${mass} g/mol`)+`${terms} = ${value}.`+ask;
    examples.push([question,mass*(mode==="rate"?ratio:1/ratio)**2]);
  }
  examples.push([base.replace("4 g/mol","0.004 kg/mol"),16],
    [samples("1.5 L","290 s","1.5 dm^3","1085 s"),4*(1085/290)**2],
    [samples("1500 mL","1 min","3 L","120 s"),4],
    [samples("2 L","1 min","500 mL","0.5 h"),57600],
    ["At the same temperature and pressure, gases He and X effuse through the same porous membrane. The molar mass of He is 4.0026 g/mol. A 1.5 L sample of He takes 290 s to effuse. A 1.5 L sample of X takes 1085 s to effuse. Calculate the molar mass of X.",4.0026*(1085/290)**2]);
  for (const [question,expected] of examples) {
    const result=synthesizeFamilyScene({question});
    assert(result,"equal-condition effusion data must produce its own source-bound comparison figure");
    assert.equal(result.family,"chem_effusion");
    assert.equal(result.tier,"qualitative_verified");
    const compiled=compileSceneDocument(result.document);
    assert(compiled.ok && compiled.renderScene);
    assert(compiled.renderScene.primitives.flatMap(p=>p.points).every(p=>p.x>=400 && p.x<=1160 && p.y>=0 && p.y<=700));
    assert(Math.abs(readEffusionSource(question)!.unknownMass-expected)<1e-9);
    const problem=effusionProblem(question)!;
    const solved=await new LocalDeterministicSolverProvider().solve(problem);
    assert.equal(solved.status,"solved");
    assert(validateSolverResult(solved,problem).valid);
    assert(Math.abs(Number(solved.values[0]!.approximate)-expected)<1e-9);
    const planned={id:"unknown_mass",symbol:`M_${readEffusionSource(question)!.unknownGas}`,unit:"g/mol",value:expected,origin:"derived" as const};
    assert(buildEffusionScene(question,[planned],false));
    assert(buildEffusionScene(question,[{...planned,value:Number(expected.toPrecision(3))}],false));
    assert.equal(buildEffusionScene(question,[{id:"known_mass",symbol:`M_${readEffusionSource(question)!.knownGas}`,unit:"g/mol",value:readEffusionSource(question)!.molarMass.value*1.01,origin:"given"}],false),null,"known mass is independently bound; rounding is not given authority");
    assert.equal(buildEffusionScene(question,[{...planned,value:expected*2}],false),null);
    assert.equal(buildEffusionScene(question,[{...planned,symbol:"M_A"}],false),null);
    assert.equal(buildEffusionScene(question,[{...planned,unit:"mol/L"}],false),null);
    assert.equal(buildEffusionScene(question,[{...planned,symbol:"M_C"}],false),null);
  }
  const original="At a specific temperature and pressure, it takes 290 s for a 1.5 dm^3 sample of He to effuse through a porous membrane. Under similar conditions, if 1.5 dm^3 of an unknown gas “X” takes 1085 s to effuse, calculate the molar mass of gas “X”.";
  const negatives=[original,base.replace("same temperature","different temperature"),base.replace("same temperature and pressure","similar conditions"),
    base.replace("same porous membrane","a porous membrane"),base.replace("same temperature and pressure","same temperature"),
    base.replace("r_A/r_B","r_A/r_C"),base.replace("of B.","of A."),base.replace("= 2.","= -2."),base.replace("= 2.","= 0."),
    base.replace("= 2.","= 2 s."),base.replace("= 2.","= 2 L/s."),base.replace("4 g/mol","4 g"),base.replace("4 g/mol","unknown g/mol"),
    base.replace("4 g/mol","-4 g/mol"),base.replace("4 g/mol","4 kg/mol/s"),base+" The pressure differs.",base+" M_B = 1 g/mol.",
    base.replace("The effusion rate ratio r_A/r_B","The effusion time ratio t_A/t_B"),
    samples("1 L","unknown s","1 L","2 s"),samples("1 L","0 s","1 L","2 s"),
    samples("1 L/s","1 s","1 L","2 s"),samples("1 L","1 S","1 L","2 s"),
    samples("1 L","1 min","1 L","2 min")+" The volumes are different."];
  for (const question of negatives) {
    assert.equal(readEffusionSource(question),null,question);
    const result=synthesizeFamilyScene({question});
    assert.equal(result,null,"invalid effusion source must not borrow an unrelated figure: "+question);
  }
  // A reciprocal relation is valid but must produce the reciprocal answer;
  // accepting the forward answer would silently flip Graham's law.
  assert.equal(buildEffusionScene(base.replace("r_A/r_B","r_B/r_A"),[{id:"unknown_mass",symbol:"M_B",unit:"g/mol",value:16,origin:"derived"}],false),null);
  console.log(`effusion: ${examples.length} source/compile/solver cases, ${examples.length*5+1} stale/role/unit/ratio controls and ${negatives.length} source negatives passed`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
