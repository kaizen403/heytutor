/** Complete original van't Hoff factor owners at direct and ordinary seams. */
import assert from "node:assert/strict";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

const frozen = "Calculate the freezing point depression of a solution with molality 0.1 mol/kg, K_f = 1.86 K kg/mol and i = unknown.";
const shift = (owner: string) => `Calculate the freezing point depression of a solution with molality 0.1 mol/kg, K_f = 1.86 K kg/mol and ${owner}.`;
const massShift = (owner: string) => `3 g of a nonvolatile solute dissolved in 100 g of water lowers the freezing point by 0.5 K; K_f = 1.86 K kg/mol${owner ? ` and ${owner}` : ""}. Calculate its molar mass.`;
const rejects = [
  ["recorded-unknown-i", frozen],
  ["own-unknown-1", "Find the freezing point depression for molality 0.1 mol/kg and K_f = 1.86 K kg/mol. The factor i is unknown."],
  ["own-unknown-2", "A solution has molality 0.1 mol/kg and K_f = 1.86 K kg/mol. Calculate its freezing point depression; i: unknown."],
  ["own-unknown-3", "Calculate boiling point elevation with molality 0.1 mol/kg, K_b = 0.52 K kg/mol, i = not determined."],
  ["own-unknown-4", "Calculate osmotic pressure for concentration 0.1 mol/L at 300 K with R = 0.0821 L atm/(mol K); i is not provided."],
  ["own-unknown-5", "A solute of true molar mass 180 g/mol dissociates into 2 particles with alpha = 0.5 and i = unknown. Calculate apparent molar mass."],
  ["own-repeat-1", shift("i = unknown; i = 2")],
  ["own-repeat-2", shift("i = 2; i is unknown")],
  ["own-repeat-3", shift("i = 2; i = 3")],
  ["own-repeat-4", shift("i = 2; i = 2 K")],
  ["own-repeat-5", shift("i = 2 K; i = 2")],
  ["own-damaged-1", shift("i = 1e-")],
  ["own-damaged-2", shift("i = 2 K")],
  ["own-damaged-3", shift("i = 2foo")],
  ["own-damaged-4", shift("i = NaN")],
  ["own-damaged-5", shift("i = 0")],
  ["own-mass-1", massShift("i = unknown")],
  ["own-mass-2", massShift("i = 2; i = unknown")],
  ["own-mass-3", massShift("i = 1; i = 2")],
  ["own-mass-4", "A solute of true molar mass 60 g/mol associates as 2 monomers with alpha = 0.8 and i = unknown. Calculate apparent molar mass."],
  ["own-mass-5", "A solute of true molar mass 180 g/mol dissociates into 2 particles with alpha = 0.5 and i = 1.5; i = unknown. Calculate apparent molar mass."],
] as const;

type Supported = {
  id: string; question: string; label: string; factor: number; value: number;
  kind: "shift" | "osmotic" | "apparent_mass" | "shift_mass";
};
const supported: readonly Supported[] = [
  {id:"valid-equals",question:shift("i = 2"),label:"dTf=0.372 K",factor:2,value:0.372,kind:"shift"},
  {id:"valid-prose",question:shift("i is 2"),label:"dTf=0.372 K",factor:2,value:0.372,kind:"shift"},
  {id:"valid-colon",question:shift("i: 2"),label:"dTf=0.372 K",factor:2,value:0.372,kind:"shift"},
  {id:"valid-scientific",question:shift("i = 2.0e0"),label:"dTf=0.372 K",factor:2,value:0.372,kind:"shift"},
  {id:"valid-agreeing",question:shift("i = 2; i is 2.0"),label:"dTf=0.372 K",factor:2,value:0.372,kind:"shift"},
  {id:"valid-below-one",question:shift("i = 0.5"),label:"dTf=0.093 K",factor:0.5,value:0.093,kind:"shift"},
  {id:"unstated-factor",question:"Calculate the freezing point depression of a solution with molality 0.1 mol/kg and K_f = 1.86 K kg/mol.",label:"dTf=0.186 K",factor:1,value:0.186,kind:"shift"},
  {id:"valid-osmotic",question:"Calculate osmotic pressure for concentration 0.1 mol/L at 300 K with R = 0.0821 L atm/(mol K); i = 2.",label:"pi=4.926 atm",factor:2,value:4.926,kind:"osmotic"},
  {id:"unstated-osmotic",question:"Calculate osmotic pressure for concentration 0.1 mol/L at 300 K with R = 0.0821 L atm/(mol K).",label:"pi=2.463 atm",factor:1,value:2.463,kind:"osmotic"},
  {id:"valid-apparent-mass",question:"A solute of true molar mass 180 g/mol dissociates into 2 particles with alpha = 0.5 and i = 1.5. Calculate apparent molar mass.",label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"unstated-derived-factor",question:"A solute of true molar mass 180 g/mol dissociates into 2 particles with alpha = 0.5. Calculate apparent molar mass.",label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"unstated-shift-mass",question:massShift(""),label:"M=111.6 g/mol",factor:1,value:111.6,kind:"shift_mass"},
  {id:"valid-shift-mass",question:massShift("i = 2; i = 2.0"),label:"M=223.2 g/mol",factor:2,value:223.2,kind:"shift_mass"},
];

function near(actual: string | undefined, expected: number): void {
  assert.ok(actual !== undefined);
  const number = Number(actual);
  assert.ok(Number.isFinite(number));
  assert.ok(Math.abs(number - expected) <= Math.max(1e-12,Math.abs(expected)*1e-12),`${number} != ${expected}`);
}
function verifyDocument(document: SceneDocument | null, c: Supported): void {
  assert.ok(document);
  assert.equal(document.source?.question,c.question);
  const valid = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
  assert.ok(valid.document,JSON.stringify(valid.report.issues));
  const compiled = compileSceneDocument(valid.document);
  assert.ok(compiled.ok && compiled.renderScene,JSON.stringify(compiled.report.issues));
  const labels = compiled.renderScene.primitives.filter(p=>p.kind==="label").map(p=>p.text);
  assert.ok(labels.includes(c.label),JSON.stringify(labels));
  const caption = document.annotations.find(a=>a.id==="figure_caption");
  assert.ok(caption && typeof caption.text==="string");
  if(c.kind==="shift"){
    const equation=/ΔT_f = i K_f m = ([+\d.eE-]+) × ([+\d.eE-]+) × ([+\d.eE-]+) = ([+\d.eE-]+) K\./.exec(caption.text);
    assert.ok(equation);near(equation[1],c.factor);near(equation[2],1.86);near(equation[3],0.1);near(equation[4],c.value);
  }else if(c.kind==="osmotic"){
    const equation=/π = i c R T = ([+\d.eE-]+) × ([+\d.eE-]+) × ([+\d.eE-]+) × ([+\d.eE-]+) = ([+\d.eE-]+) atm\./.exec(caption.text);
    assert.ok(equation);near(equation[1],c.factor);near(equation[2],0.1);near(equation[3],0.0821);near(equation[4],300);near(equation[5],c.value);
  }else if(c.kind==="apparent_mass"){
    const equation=/M_apparent = M_true \/ i = ([+\d.eE-]+) \/ ([+\d.eE-]+) = ([+\d.eE-]+) g\/mol\./.exec(caption.text);
    assert.ok(equation);near(equation[1],180);near(equation[2],c.factor);near(equation[3],c.value);
  }else{
    const equation=/M = i K w × 1000 \/ \(ΔT W\) = ([+\d.eE-]+) × ([+\d.eE-]+) × ([+\d.eE-]+) × 1000 \/ \(([+\d.eE-]+) × ([+\d.eE-]+)\) = ([+\d.eE-]+) g\/mol\./.exec(caption.text);
    assert.ok(equation);near(equation[1],c.factor);near(equation[2],1.86);near(equation[3],3);near(equation[4],0.5);near(equation[5],100);near(equation[6],c.value);
  }
}

const rows: Array<{id:string;question:string;passed:boolean;error?:string}> = [];
function check(id: string, question: string, run: ()=>void): void {
  try{run();rows.push({id,question,passed:true});}
  catch(error){rows.push({id,question,passed:false,error:String(error)});}
}
for(const [id,question] of rejects)check(id,question,()=>{
  assert.equal(buildSolutionLessonScene(question,[],false),null);
  assert.equal(buildSolutionLessonScene(question,[],true),null);
  assert.equal(synthesizeFamilyScene({question}),null);
});
for(const c of supported)check(c.id,c.question,()=>{
  verifyDocument(buildSolutionLessonScene(c.question,[],false),c);
  verifyDocument(buildSolutionLessonScene(c.question,[],true),c);
  const ordinary=synthesizeFamilyScene({question:c.question});
  assert.ok(ordinary?.renderScene);assert.equal(ordinary.family,"chem_solutions");
  verifyDocument(ordinary.document,c);
});
// BEGIN named factor owners: retain the original34 cases as an exact prefix.
const namedRejects = [
  ["named-unknown", "A solute has true molar mass 180 g/mol and van't Hoff factor is unknown. Calculate its apparent molar mass."],
  ["named-unknown-derived", "A solute of true molar mass 180 g/mol dissociates into 2 particles with alpha = 0.5 and van’t Hoff factor (i) = unknown. Calculate apparent molar mass."],
  ["named-wrong-unit", "A solute has true molar mass 180 g/mol and van't Hoff factor is 1.5 kg. Calculate its apparent molar mass."],
  ["named-conflicting-repeat", "A solute has true molar mass 180 g/mol. Its van't Hoff factor is 1.5; van’t Hoff factor (i) = 2. Calculate apparent molar mass."],
  ["named-unread-before-valid", "A solute of true molar mass 180 g/mol dissociates into 2 particles with alpha = 0.5. Its van't Hoff factor is unknown; i = 1.5. Calculate apparent molar mass."],
] as const;
const namedSupported: readonly Supported[] = [
  {id:"named-plain",question:"A solute has true molar mass 180 g/mol and van't Hoff factor is 1.5. Calculate its apparent molar mass.",label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"named-parenthetical",question:"A solute has true molar mass 180 g/mol and van’t Hoff factor (i) = 1.5. Calculate its apparent molar mass.",label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"named-symbol",question:"A solute has true molar mass 180 g/mol and van't Hoff factor i = 1.5. Calculate its apparent molar mass.",label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"named-agreeing-repeat",question:"A solute has true molar mass 180 g/mol. Its van't Hoff factor is 1.5; i = 1.50. Calculate apparent molar mass.",label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"named-source-scope",question:"The van't Hoff factor is 1.5; the true molar mass is 180 g/mol. Calculate the apparent molar mass.",label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
];
for(const [id,question] of namedRejects)check(id,question,()=>{
  assert.equal(buildSolutionLessonScene(question,[],false),null);
  assert.equal(buildSolutionLessonScene(question,[],true),null);
  assert.equal(synthesizeFamilyScene({question}),null);
});
for(const c of namedSupported)check(c.id,c.question,()=>{
  verifyDocument(buildSolutionLessonScene(c.question,[],false),c);
  verifyDocument(buildSolutionLessonScene(c.question,[],true),c);
  const ordinary=synthesizeFamilyScene({question:c.question});
  assert.ok(ordinary?.renderScene);assert.equal(ordinary.family,"chem_solutions");
  verifyDocument(ordinary.document,c);
});
// END named factor owners: retain the original34 cases as an exact prefix.
// BEGIN requested factor owners: original44 cases and assertions remain whole.
const dissociationSource = "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5.";
const requestedFactorCases: readonly Supported[] = [
  {id:"recorded-laneD-q-cgates-9",question:"The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. Find the van't Hoff factor and the apparent molar mass.",label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"own-requested-factor-1",question:`${dissociationSource} Find the apparent molar mass and the van't Hoff factor.`,label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"own-requested-factor-2",question:`${dissociationSource} Determine the van’t Hoff factor (i) and the apparent molar mass.`,label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"own-requested-factor-3",question:`${dissociationSource} Calculate the van't Hoff factor and apparent molar mass from the given dissociation.`,label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"own-requested-factor-4",question:`${dissociationSource} Find the van't Hoff factor. Find the apparent molar mass.`,label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"own-requested-factor-5",question:`${dissociationSource} Determine apparent molar mass together with the van't Hoff factor?`,label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"own-requested-supplied-agreeing-1",question:`${dissociationSource} Find the van't Hoff factor and apparent molar mass. The van't Hoff factor is 1.5.`,label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"own-requested-supplied-agreeing-2",question:`${dissociationSource} Find the apparent molar mass using van't Hoff factor = 1.5.`,label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
  {id:"own-requested-supplied-agreeing-3",question:`${dissociationSource} The van’t Hoff factor (i) = 1.50. Find the van't Hoff factor and the apparent molar mass.`,label:"M'=120 g/mol",factor:1.5,value:120,kind:"apparent_mass"},
];
const requestedFactorRejects = [
  ["own-requested-supplied-refusal-1",`${dissociationSource} Find the van't Hoff factor and apparent molar mass. The van't Hoff factor = unknown; i = 1.5.`],
  ["own-requested-supplied-refusal-2",`${dissociationSource} Find the apparent molar mass using van't Hoff factor is unreadable.`],
  ["own-requested-supplied-refusal-3",`${dissociationSource} Find the van't Hoff factor = unknown and apparent molar mass.`],
  ["own-requested-supplied-refusal-4",`${dissociationSource} Find the van't Hoff factor 1.5 kg and apparent molar mass.`],
  ["own-requested-supplied-refusal-5",`${dissociationSource} Find the van't Hoff factor and apparent molar mass; i = 1.5; van't Hoff factor = 2.`],
  ["own-requested-supplied-refusal-6",`${dissociationSource} Find the apparent molar mass using van't Hoff factor = 1e-.`],
  ["own-requested-supplied-refusal-7",`${dissociationSource} Find the apparent molar mass using van't Hoff factor . K.`],
] as const;
function verifyRequestedFactor(document: SceneDocument | null, c: Supported): void {
  verifyDocument(document,c);
  assert.ok(document);
  const valid = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
  assert.ok(valid.document);
  const compiled = compileSceneDocument(valid.document);
  assert.ok(compiled.ok && compiled.renderScene);
  const labels = compiled.renderScene.primitives.filter(p=>p.kind==="label").map(p=>p.text);
  assert.ok(labels.includes("i=1.5"),JSON.stringify(labels));
}
for(const c of requestedFactorCases)check(c.id,c.question,()=>{
  verifyRequestedFactor(buildSolutionLessonScene(c.question,[],false),c);
  verifyRequestedFactor(buildSolutionLessonScene(c.question,[],true),c);
  const ordinary=synthesizeFamilyScene({question:c.question});
  assert.ok(ordinary?.renderScene);assert.equal(ordinary.family,"chem_solutions");
  verifyRequestedFactor(ordinary.document,c);
});
for(const [id,question] of requestedFactorRejects)check(id,question,()=>{
  assert.equal(buildSolutionLessonScene(question,[],false),null);
  assert.equal(buildSolutionLessonScene(question,[],true),null);
  assert.equal(synthesizeFamilyScene({question}),null);
});
// END requested factor owners: original44 cases and assertions remain whole.
// BEGIN supplied connector owners: original60 cases and assertions remain whole.
const suppliedConnectorRejects = [
  ["reviewer-request-connector-1",`${dissociationSource} Find the apparent molar mass using van't Hoff factor of unknown.`],
  ["reviewer-request-connector-2",`${dissociationSource} Find the apparent molar mass using van't Hoff factor with value unknown.`],
  ["reviewer-request-connector-3",`${dissociationSource} Find the apparent molar mass using van't Hoff factor of 2.`],
  ["reviewer-request-connector-4",`${dissociationSource} Find the apparent molar mass using van't Hoff factor with value 2.`],
  ["reviewer-request-connector-5",`${dissociationSource} Find the apparent molar mass using van't Hoff factor at unknown.`],
  ["own-request-connector-1",`${dissociationSource} Find the van't Hoff factor of unreadable and the apparent molar mass.`],
  ["own-request-connector-2",`${dissociationSource} Find the van't Hoff factor with value 2 and the apparent molar mass.`],
  ["own-request-connector-3",`${dissociationSource} Determine the apparent molar mass using van’t Hoff factor at 2.`],
  ["own-request-connector-4",`${dissociationSource} Calculate apparent molar mass with van't Hoff factor of unknown; i = 1.5.`],
  ["own-request-connector-5",`${dissociationSource} Find the van't Hoff factor from unknown and the apparent molar mass; i = 1.5.`],
] as const;
for(const [id,question] of suppliedConnectorRejects)check(id,question,()=>{
  assert.equal(buildSolutionLessonScene(question,[],false),null);
  assert.equal(buildSolutionLessonScene(question,[],true),null);
  assert.equal(synthesizeFamilyScene({question}),null);
});
// END supplied connector owners: original60 cases and assertions remain whole.
console.log(JSON.stringify({total:rows.length,passed:rows.filter(r=>r.passed).length,rows},null,2));
process.exitCode=rows.every(r=>r.passed)?0:1;
