/** PR137 public-source regressions at real family and ordinary compiler seams. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { kineticsFromStem, solveKinetics, buildKineticsScene } from "../../src/chemistry/kinetics";
import { parseCellNotation, cellEmf, buildElectrochemScene } from "../../src/chemistry/electrochemistry";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { resolveChemistryGiven, readChemistryArrheniusEquation, parseChemistryScalar, readChemistryQuantity, chemistryCanonicalValuesAgree } from "../../src/chemistry/quantityReader";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

import { buildUnitCellScene } from "../../src/chemistry/unitCell";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import type { ChemPlanQuantity } from "../../src/chemistry/sceneKit";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

const rows: Array<{id:string; passed:boolean; error?:string}> = [];
function check(id:string, test:()=>void):void {
  try { test(); rows.push({id,passed:true}); console.log(`PASS ${id}`); }
  catch (error) { rows.push({id,passed:false,error:String(error)}); console.error(`FAIL ${id}: ${error}`); }
}
function near(actual:unknown, expected:number):void {
  assert.ok(typeof actual === "number" && Number.isFinite(actual));
  assert.ok(Math.abs(actual-expected) <= Math.max(Math.abs(expected)*1e-10,1e-14),`${actual} != ${expected}`);
}
function compiled(document:SceneDocument|null) {
  assert.ok(document,"family declined");
  const valid = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
  assert.ok(valid.document,JSON.stringify(valid.report.issues));
  const result = compileSceneDocument(valid.document);
  assert.ok(result.ok && result.renderScene,JSON.stringify(result.report.issues));
  return {document,render:result.renderScene, labels:result.renderScene.primitives.filter(p=>p.kind === "label").map(p=>p.text)};
}
check("Arrhenius whole equation coefficient",()=>{
  const question="For an Arrhenius reaction, ln k = 5 - 2000/T. Draw its Arrhenius plot.";
  const spec=kineticsFromStem(question); assert.ok(spec?.arrhenius);
  near(spec.arrhenius.statedSlope?.b,2000); near(solveKinetics(spec).Ea,16628);
  assert.ok(spec.arrhenius.statedSlope);
  assert.equal(spec.arrhenius.statedSlope.natural,true);
  compiled(buildKineticsScene(question,[],false));
});
check("Unicode supplied electrode potential overrides table",()=>{
  const question="Draw the cell Zn | Zn2+ || Cu2+ | Cu. E°(Cu²⁺/Cu) = 0.52 V.";
  const spec=parseCellNotation(question); assert.ok(spec);
  near(spec.cathode.e0,.52); assert.equal(spec.cathode.potentialSource,"stem");
  near(cellEmf(spec)?.e0,1.28); compiled(buildElectrochemScene(question,[],false));
});
check("Temperature delta is not an absolute starting temperature",()=>{
  const question="An Arrhenius reaction's rate constant doubles when temperature rises by 10 K from 300 K. Draw its Arrhenius plot.";
  const spec=kineticsFromStem(question); assert.ok(spec?.arrhenius);
  near(spec.arrhenius.T1,300); near(spec.arrhenius.T2,310);
  near(solveKinetics(spec).Ea,53594.27863033097);
  const result=compiled(buildKineticsScene(question,[],false));
  near(result.document.quantities.find(q=>q.id==="T1")?.value,300);
  near(result.document.quantities.find(q=>q.id==="T2")?.value,310);
});
check("Distinct forward and backward activation roles",()=>{
  const question="Draw an energy profile. The forward activation energy is 60 kJ/mol and the backward activation energy is 80 kJ/mol.";
  const result=compiled(buildThermoGraphScene(question,[],false));
  near(result.document.quantities.find(q=>q.id==="Ea_forward")?.value,60);
  near(result.document.quantities.find(q=>q.id==="Ea_backward")?.value,80);
  near(result.document.quantities.find(q=>q.id==="dH")?.value,-20);
});
check("Complete Gibbs point and calculated units",()=>{
  const question="Draw the Gibbs energy graph for ΔH = 100000 kJ/mol and ΔS = 200 J/(mol K). Calculate ΔG at 300 K.";
  const result=compiled(buildThermoGraphScene(question,[],false));
  near(result.document.quantities.find(q=>q.id==="dH")?.value,100000);
  near(result.document.quantities.find(q=>q.id==="dG")?.value,99940);
  assert.ok(result.labels.join("").replace(/\s+/g,"").includes("ΔH=100000kJ/mol"),JSON.stringify(result.labels));
  assert.ok(result.labels.join("").replace(/\s+/g,"").includes("ΔG=99940.0kJ/mol"),JSON.stringify(result.labels));
});
for (const notation of ["E°(Cu²⁺/Cu)", "E₀(Cu2+/Cu)", "E°(Cu2+/Cu)"]) {
  for (const tail of [" = 1e- V.", " = 0.52 V. " + notation + " = 0.62 V."]) check("Invalid supplied potential cannot fall back: "+notation+tail,()=>{
    const question="Draw the cell Zn | Zn2+ || Cu2+ | Cu. "+notation+tail;
    assert.equal(parseCellNotation(question),null);
    assert.equal(buildElectrochemScene(question,[],false),null);
    assert.equal(buildElectrochemScene(question,[],true),null);
  });
}
for(const notation of ["E₀(Cu2+/Cu)","E°(Cu2+/Cu)","Cu²⁺ + 2e⁻ → Cu, E°"]) check("Original potential syntax and source spans: "+notation,()=>{
  const question="Draw the cell Zn | Zn2+ || Cu2+ | Cu. "+notation+" = 0.52 V.";
  const spec=parseCellNotation(question); assert.ok(spec);
  near(spec.cathode.e0,.52); near(cellEmf(spec)?.e0,1.28);
  assert.equal(spec.cathode.potentialSourceText,"0.52 V");
  const span=spec.cathode.potentialSourceSpan; assert.ok(span);
  assert.equal(question.slice(span.start,span.end),"0.52 V");
  const result=compiled(buildElectrochemScene(question,[],false));
  near(result.document.quantities.find(q=>q.id==="E0_cell")?.value,1.28);
});
for (const [expression,expected] of [["log k = 5 - 2000/T",38287.38492630499],["ln k = -5 - 2×10^3 K/T",16628],["k = A e^(-2000/T)",16628],["k = A e(-2000/T)",16628],["k = A e^-2000/T",16628],["k = A e -2000/T",16628]] as const) check("Complete finite Arrhenius expression: "+expression,()=>{
  const question="For an Arrhenius reaction, "+expression+". Draw its Arrhenius plot.";
  const spec=kineticsFromStem(question); assert.ok(spec); near(solveKinetics(spec).Ea,expected);
  compiled(buildKineticsScene(question,[],false));
});
for(const expression of ["ln k = 5 - 2000e-/T","ln k = 5 - 2000/T²","ln k = 5 - 2000/T/s","ln k = 5 - 2000/T.foo","ln k = 1e999 - 2000/T","ln k = 1e-999 - 2000/T","ln k = 1/0 - 2000/T","log k = 1/0 - 2000/T","ln k = 5 - 1e-999/T","ln k = 5 - 2000/T + 1","k = A e^(-2000/T"]) check("Invalid complete expression atomically declines: "+expression,()=>{
  const question="For an Arrhenius reaction, "+expression+". Draw its Arrhenius plot.";
  assert.equal(kineticsFromStem(question),null); assert.equal(buildKineticsScene(question,[],false),null);
});
for(const question of [
 "An Arrhenius reaction's rate constant doubles when temperature is raised by 10 K from 300 K. Draw its Arrhenius plot.",
 "An Arrhenius reaction's rate constant doubles from 300 K when temperature rises by 10 K. Draw its Arrhenius plot.",
 "An Arrhenius reaction's rate constant doubles when temperature rises by 10 °C from 300 K. Draw its Arrhenius plot.",
])check("Original absolute and delta source roles: "+question,()=>{
 const spec=kineticsFromStem(question); assert.ok(spec?.arrhenius); near(spec.arrhenius.T1,300); near(spec.arrhenius.T2,310);
 compiled(buildKineticsScene(question,[],false));
});
check("Celsius absolute conversion without delta offset",()=>{
 const question="An Arrhenius reaction's rate constant doubles when temperature rises by 10 K from 25 °C. Draw its Arrhenius plot.";
 const spec=kineticsFromStem(question);assert.ok(spec?.arrhenius);near(spec.arrhenius.T1,298.15);near(spec.arrhenius.T2,308.15);
 compiled(buildKineticsScene(question,[],false));
});
for(const tail of ["rises by 1e- K from 300 K","rises by 10 K","rises by 10 K from 300 K to 320 K"])check("Invalid/ungrounded delta cannot supply absolute temperature: "+tail,()=>{
 const question="An Arrhenius reaction's rate constant doubles when temperature "+tail+". Draw its Arrhenius plot.";
 assert.equal(buildKineticsScene(question,[],false),null);
});
for(const energies of [
 "The backward activation energy is 80 kJ/mol and the forward activation energy is 60000 J/mol.",
 "The activation energy of the forward reaction is 60 kJ/mol and the activation energy of the reverse reaction is 80 kJ/mol.",
])check("Direction-specific energies in either order/conversion: "+energies,()=>{
 const result=compiled(buildThermoGraphScene("Draw an energy profile. "+energies,[],false));
 near(result.document.quantities.find(q=>q.id==="Ea_forward")?.value,60);near(result.document.quantities.find(q=>q.id==="Ea_backward")?.value,80);near(result.document.quantities.find(q=>q.id==="dH")?.value,-20);
 assert.ok(!JSON.stringify(result.document.annotations).includes("/mol/mol"));
});
for(const energies of [
 "The forward activation energy is 60 kJ/mol; the forward activation energy is 70 kJ/mol; the backward activation energy is 80 kJ/mol.",
 "The backward activation energy is 80 kJ/mol; the backward activation energy is 90 kJ/mol; the forward activation energy is 60 kJ/mol.",
 "The forward activation energy is 1e- kJ/mol; the backward activation energy is 80 kJ/mol.",
 "The backward activation energy is 1e- kJ/mol; the forward activation energy is 60 kJ/mol.",
])check("Same activation role conflict/damage: "+energies,()=>assert.equal(buildThermoGraphScene("Draw an energy profile. "+energies,[],false),null));
for(const entropy of [100,-100])check("Both Gibbs branches retain complete compiled quantities: "+entropy,()=>{
 const question=`Draw the Gibbs energy graph for ΔH = 100000 kJ/mol and ΔS = ${entropy} J/(mol K). Calculate ΔG at 300 K.`;
 const result=compiled(buildThermoGraphScene(question,[],false));
 const expected=entropy>0?99970:100030;
 near(result.document.quantities.find(q=>q.id==="dG")?.value,expected);
 const ink=result.labels.join("").replace(/\s+/g,"");
 assert.ok(ink.includes("ΔH=100000kJ/mol"));assert.ok(ink.includes(`ΔG=${expected}.0kJ/mol`));
 assert.ok(result.labels.every(label=>typeof label === "string" && label.length<=16),JSON.stringify(result.labels));
});
check("Ordinary short enthalpy label retains exact spacing",()=>{
 const result=compiled(buildThermoGraphScene("For a reaction ΔH = 40 kJ/mol and ΔS = 100 J K−1 mol−1. Above what temperature will the reaction become spontaneous?",[],false));
 assert.ok(result.labels.includes("ΔH = 40 kJ/mol"),JSON.stringify(result.labels));
 near(result.document.quantities.find(q=>q.id==="dH")?.value,40);
});
check("One complete molar unit in profile caption",()=>{
 const result=compiled(buildThermoGraphScene("Draw an energy profile: forward activation energy is 60 kJ/mol and ΔH = -20 kJ/mol.",[],false));
 const caption=result.document.annotations.find(a=>a.id==="figure_caption")?.text;assert.ok(caption);
 assert.ok(caption.includes("60 kJ/mol")); assert.ok(caption.includes("80 kJ/mol")); assert.ok(!caption.includes("/mol/mol"));
});
check("Expression binding retains original complete span without relaxing literals",()=>{
 const question="Original equation: ln k = 5 - 2000/T. Draw the Arrhenius plot.";
 const read=readChemistryArrheniusEquation(question);assert.ok(read.ok);
 near(read.reading.coefficient.value,2000);assert.equal(read.reading.coefficient.text,"2000");
 assert.equal(question.slice(read.reading.coefficient.span.start,read.reading.coefficient.span.end),"2000");
 assert.equal(read.reading.source.text,"ln k = 5 - 2000/T");
 assert.equal(question.slice(read.reading.source.span.start,read.reading.source.span.end),read.reading.source.text);
 assert.equal(parseChemistryScalar(question,read.reading.coefficient.span).ok,false);
});
check("A newline separates ordinary equation context",()=>{
 const question="For an Arrhenius reaction\nln k = 5 - 2000/T. Draw its Arrhenius plot.";
 const read=readChemistryArrheniusEquation(question); assert.ok(read.ok);
 assert.equal(read.reading.source.text,"ln k = 5 - 2000/T");
 const spec=kineticsFromStem(question);assert.ok(spec);near(solveKinetics(spec).Ea,16628);
 compiled(buildKineticsScene(question,[],false));
});
for(const expression of ["αln k = 5 - 2000/T", "ln k = 5 - 2000/Tα", "ln k = 5 - 2000/T ÷2", "ln k = 5 - 2000/T ∕2", "𝛼ln k = 5 - 2000/T", "ln k = 5 - 2000/T𝛼"])check("Complete Unicode expression boundary: "+expression,()=>{
 const question="For an Arrhenius reaction, "+expression+". Draw its Arrhenius plot.";
 assert.equal(readChemistryArrheniusEquation(question).ok,false);
 assert.equal(kineticsFromStem(question),null);
 assert.equal(buildKineticsScene(question,[],false),null);
});
check("Delta given keeps the original unit/source span",()=>{
 const question="Temperature rises by 10 °C from 300 K.";
 const read=readChemistryQuantity({question,after:/rises by/,dimension:"temperature_delta"});assert.ok(read.ok);
 near(read.reading.value,10);assert.equal(read.reading.source.text,"10 °C");
 assert.equal(question.slice(read.reading.source.span.start,read.reading.source.span.end),"10 °C");
});

// PR137 role agreement: generic activation energy describes the forward
// barrier only when the independently stated explicit-forward given agrees.
for(const energies of [
 "Activation energy is 50 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol. Activation energy is 50 kJ/mol.",
 "Activation energy is 50000 J/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy is 50 kJ. Forward activation energy is 50 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy is 1e- kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy is 1e999 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy is 50 kJ/mol and activation energy is 60 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Ea = 50 kJ/mol. Ea(forward) = 60 kJ/mol and Ea(backward) = 80 kJ/mol.",
 "Energy of activation is 50 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "ACTIVATION ENERGY IS 50 kJ/mol. FORWARD ACTIVATION ENERGY IS 60 kJ/mol AND BACKWARD ACTIVATION ENERGY IS 80 kJ/mol.",
])check("Generic versus forward role conflict/damage: "+energies,()=>{
 const question="Draw an energy profile. "+energies;
 assert.equal(buildThermoGraphScene(question,[],false),null);
 assert.equal(buildThermoGraphScene(question,[],true),null);
});
for(const [energies,forward,backward] of [
 ["Activation energy is 60 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",60,80],
 ["Activation energy is 60000 J/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",60,80],
 ["Activation energy is 60 kJ/mol. Forward activation energy is 60000 J/mol and backward activation energy is 80 kJ/mol.",60,80],
 ["Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol. Activation energy is 60 kJ/mol.",60,80],
 ["Activation energy is 50 kJ/mol and backward activation energy is 80 kJ/mol.",50,80],
 ["Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",60,80],
 ["Activation energy is 60 kJ. Forward activation energy is 60 kJ and backward activation energy is 80 kJ.",60,80],
 ["Activation energy is 60 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 40 kJ/mol.",60,40],
 ["Ea = 60 kJ/mol. Ea(forward) = 60 kJ/mol and Ea(backward) = 80 kJ/mol.",60,80],
] as const)check("Independent generic/forward agreement compiles: "+energies,()=>{
 const result=compiled(buildThermoGraphScene("Draw an energy profile. "+energies,[],false));
 near(result.document.quantities.find(q=>q.id==="Ea_forward")?.value,forward);
 near(result.document.quantities.find(q=>q.id==="Ea_backward")?.value,backward);
 near(result.document.quantities.find(q=>q.id==="dH")?.value,forward-backward);
});
check("Derived planner energy never replaces agreeing original role givens",()=>{
 const question="Draw an energy profile. Activation energy is 60 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.";
 const result=compiled(buildThermoGraphScene(question,[{id:"Ea",symbol:"E_a",value:999,unit:"kJ/mol",origin:"derived"}],false));
 near(result.document.quantities.find(q=>q.id==="Ea_forward")?.value,60);
 near(result.document.quantities.find(q=>q.id==="dH")?.value,-20);
});
check("Given planner energy must still match its exact original source span",()=>{
 const question="Draw an energy profile. Activation energy is 60 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.";
 const start=question.lastIndexOf("60 kJ/mol"),sourceText="60 kJ/mol",sourceSpan={start,end:start+sourceText.length};
 const given={id:"Ea",symbol:"E_a",value:61,unit:"kJ/mol",origin:"given" as const,sourceSpan,sourceText};
 assert.equal(buildThermoGraphScene(question,[given],false),null);
 const result=compiled(buildThermoGraphScene(question,[{...given,value:60}],false));
 near(result.document.quantities.find(q=>q.id==="Ea_forward")?.value,60);
});

// PR137 connected role givens retain one source cue for validation and reads.
for(const energies of [
 "Activation energy of the reaction is 60 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy for the reaction is 60 kJ/mol. Forward activation energy is 60000 J/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy of reaction is 60000 J/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol. Activation energy for reaction is 60 kJ/mol.",
 "Activation energy of the reaction: 60 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy for the reaction = 60 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "ACTIVATION ENERGY OF THE REACTION IS 60 kJ/mol. FORWARD ACTIVATION ENERGY IS 60 kJ/mol AND BACKWARD ACTIVATION ENERGY IS 80 kJ/mol.",
 "Activation energy of the reaction is 60 kJ. Forward activation energy is 60000 J and backward activation energy is 80 kJ.",
])check("Connected agreeing role givens compile: "+energies,()=>{
 const result=compiled(buildThermoGraphScene("Draw an energy profile. "+energies,[],false));
 near(result.document.quantities.find(q=>q.id==="Ea_forward")?.value,60);
 near(result.document.quantities.find(q=>q.id==="Ea_backward")?.value,80);
 near(result.document.quantities.find(q=>q.id==="dH")?.value,-20);
});
for(const energies of [
 "Activation energy of the reaction is 4e- kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy for the reaction is 1e999 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy of the reaction is 60 kJ/mol/s. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy for the reaction is 60 kg. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy of the reaction is 50 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol. Activation energy for the reaction is 50 kJ/mol.",
 "Activation energy of the reaction is 50 kJ/mol. Activation energy of the reaction is 60 kJ/mol. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Activation energy of the reaction is 60 kJ. Forward activation energy is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Forward activation energy for the reaction is 4e- kJ/mol. Activation energy of the reaction is 60 kJ/mol and backward activation energy is 80 kJ/mol.",
 "Backward activation energy of the reaction is 4e- kJ/mol. Activation energy of the reaction is 60 kJ/mol and forward activation energy is 60 kJ/mol.",
 "Activation energy of the reaction is 60 kJ/mol. Forward activation energy for the reaction is 70 kJ/mol and backward activation energy is 80 kJ/mol.",
])check("Connected role conflict/damage atomically declines: "+energies,()=>{
 const question="Draw an energy profile. "+energies;
 assert.equal(buildThermoGraphScene(question,[],false),null);
 assert.equal(buildThermoGraphScene(question,[],true),null);
});

// Export-only shared agreement control: these values have no source authority.
for(const [actual,expected,agrees] of [
 [0,0,true], [0,1e-12,false], [-1e-12,1e-12,false], [1e-100,2e-100,false],
 [1e-100,1.0000000005e-100,true], [60,60+5e-8,true], [60,60+7e-8,false], [60,60,true],
 [Number.NaN,60,false], [Infinity,Infinity,false], [-Infinity,-Infinity,false], [60,Infinity,false],
] as const)check(`Shared canonical agreement: ${actual} / ${expected}`,()=>{
 assert.equal(chemistryCanonicalValuesAgree(actual,expected),agrees);
});


// PR137 coordinator public wording controls: the question remains the numeric authority.
for (const [question,expected] of [
 ["The edge length of an fcc unit cell is 508 pm. If the radius of the cation is 110 pm, what is the radius of the anion?",508],
 ["In an fcc lattice the edge length of the unit cell is 400 pm and the radius of the atom is 141 pm.",400],
 ["The edge length of an fcc unit cell is 408 pm. Draw the unit cell.",408],
] as const)check("Original connected unit-cell edge: "+question,()=>{
 const r=compiled(buildUnitCellScene(question,[],false));
 assert.ok(r.document.annotations.some(a=>a.text?.includes(`a = ${expected}`)),JSON.stringify(r.document.annotations));
});
for(const edge of ["1e- pm","400 kelvin","400 pm; edge length of the unit cell is 500 pm"])check("Damaged supplied edge never derives replacement: "+edge,()=>{
 assert.equal(buildUnitCellScene("Draw an fcc unit cell. The edge length of the unit cell is "+edge+" and the radius of the atom is 141 pm.",[],false),null);
});
for(const [tail,expected] of [
 ["Zn2+ concentration is 0.1 M and Cu2+ = 0.01 M",1.0705],
 ["[Zn2+] = 0.1 M and Cu2+ is 0.001 M",1.0409],
 ["Zn2+ = 0.1 M and Cu2+ ions are 0.01 M",1.0705],
 ["[Zn2+] = 0.1 M and [Cu2+] = 0.01 M",1.0705],
 ["Zn²⁺ concentration is 0.1 M and Cu²⁺ ions are 0.01 M",1.0705],
] as const)check("Named ion concentration role: "+tail,()=>{
 const q="Calculate the emf of a Daniell cell at 298 K when "+tail+".";
 const spec=parseCellNotation(q);assert.ok(spec);near(cellEmf(spec)?.e,expected);
 const result=compiled(buildElectrochemScene(q,[],false));assert.ok(!JSON.stringify(result.document).includes("NaN"));
});
for(const tail of ["Zn2+ concentration is 1e- M and Cu2+=0.01 M", "[Zn2+]=0.1 M and [Zn2+]=0.2 M and Cu2+=0.01 M", "Zn2+ concentration is 0.1 kg and Cu2+=0.01 M"])check("Named ion damage/duplicate cannot use one molar default: "+tail,()=>assert.equal(parseCellNotation("Calculate emf of a Daniell cell at 298 K when "+tail+"."),null));
check("Capitalized Volt produces finite stated emf",()=>{
 const q="The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 Volt at 298 K.";
 const spec=parseCellNotation(q);assert.ok(spec);near(spec.statedE,1.13);
 const r=compiled(buildElectrochemScene(q,[],false));assert.ok(r.document.annotations.some(a=>a.text?.includes("1.13 V")));assert.ok(!JSON.stringify(r.document).includes("NaN"));
});
for(const tail of ["1e- Volt", "1.13 Voltsjunk", "Infinity Volt", "1.13 kg", "1e- V"])check("Present malformed emf cannot enter caption: "+tail,()=>assert.equal(buildElectrochemScene("The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is "+tail+" at 298 K.",[],false),null));
for(const constant of ["1 x 10-5", "1 × 10⁻⁵", "1e-", "2", "-1e-5", "1e-5; Ka=2e-5"])check("Present invalid Ka forbids species table and qualitative fallback: "+constant,()=>{
 const q="50 mL of 0.1 M CH3COOH (Ka = "+constant+") is titrated with 0.1 M NaOH.";
 assert.equal(buildSolutionsGraphScene(q,[],false),null);assert.equal(buildSolutionsGraphScene(q,[],true),null);
});
check("Valid supplied Ka overrides table pKa",()=>{
 const r=compiled(buildSolutionsGraphScene("50 mL of 0.1 M CH3COOH (Ka=1e-5) is titrated with 0.1 M NaOH.",[],false));
 assert.ok(r.document.annotations.some(a=>a.text?.includes("pKa = 5")));assert.ok(!JSON.stringify(r.document.annotations).includes("4.76"));
});
check("Plural temperatures do not imply rate ratio two",()=>{
 const q="The rate constants of a reaction at two temperatures, 300 K and 310 K, are 2.0 × 10^-2 s^-1 and 7.0 × 10^-2 s^-1. Calculate the activation energy.";
 assert.equal(kineticsFromStem(q),null);assert.equal(buildKineticsScene(q,[],false),null);
});
check("Preposed temperature rise has delta role",()=>{
 const q="The rate of a reaction doubles for a 10 K rise in temperature from 300 K. Calculate the activation energy.";
 const spec=kineticsFromStem(q);assert.ok(spec?.arrhenius);near(spec.arrhenius.T1,300);near(spec.arrhenius.T2,310);near(solveKinetics(spec).Ea,53594.27863033097);compiled(buildKineticsScene(q,[],false));
});
for(const [q,half,fraction] of [
 ["For a first order reaction with half life 20 min, find [A]/[A]0 at t = 60 min.",20,.125],
 ["The half life of this first order reaction is 69.3 s. What fraction remains after 200 s?",69.3,Math.exp(-Math.LN2*200/69.3)],
] as const)check("Half-life owner stops before subsequent equation: "+q,()=>{
 const spec=kineticsFromStem(q);assert.ok(spec);near(spec.tHalf,half);near(solveKinetics(spec).remainingAtTimes[0]?.remaining,fraction);compiled(buildKineticsScene(q,[],false));
});
for(const tail of ["half life of this first order reaction is 1e- min", "half life 20 min; half life is 30 min"])check("Half-life invalid owner remains fatal: "+tail,()=>assert.equal(buildKineticsScene("For a first order reaction with "+tail+", find fraction after 60 min.",[],false),null));
const numericFamilies: Array<[string,string,(q:string,g:ChemPlanQuantity[],s:boolean)=>SceneDocument|null]> = [
 ["thermo","Draw an energy profile: activation energy is 50 kJ/mol and ΔH=-20 kJ/mol.",buildThermoGraphScene],
 ["kinetics","A first order reaction has half life 20 min. Find fraction remaining after 60 min.",buildKineticsScene],
 ["cell","Draw a Daniell cell at 298 K with Zn2+=0.1 M and Cu2+=0.01 M.",buildElectrochemScene],
 ["unitcell","Draw an fcc unit cell with edge length 400 pm.",buildUnitCellScene],
 ["solutions","50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH.",buildSolutionsGraphScene],
 ["radiation","For an atomic electron, work function is 2 eV and frequency is 9.65×10^14 Hz. Draw the photoelectric energy balance.",buildAtomicRadiationScene],
 ["chemicalthermo","The equilibrium constant of a reaction at 298 K is 1.8e-5. Calculate ΔG°.",buildChemicalThermodynamicsScene],
];
for(const [id,q,builder] of numericFamilies)for(const sourceText of ["T = 25","Ea = 50","not quoted in source"])check("Unbound planner prose has no family authority: "+id+sourceText,()=>{
 const plain=compiled(builder(q,[],false));
 const plan=compiled(builder(q,[{id:"T",symbol:"T",value:Infinity,unit:"nonsense",origin:"given",sourceText}],false));
 assert.deepEqual(plan.document,plain.document);
});
check("Small thermodynamic K is not printed as zero",()=>{
 const r=compiled(buildChemicalThermodynamicsScene("The equilibrium constant of a reaction at 298 K is 1.8 × 10^-5. Calculate ΔG°.",[],false));
 assert.ok(r.labels.some(l=>l?.includes("1.8e-5")),JSON.stringify(r.labels));assert.ok(!r.labels.includes("K=0.00"));
});
check("Profile energy labels retain complete physical units",()=>{
 const r=compiled(buildThermoGraphScene("Draw the energy profile for a reaction with ΔH = −92.4 kJ/mol and Ea = 150 kJ/mol.",[],false));
 const text=r.labels.join(" ");assert.ok(!text.includes("kJ/mo ")&&!/kJ\/$/.test(text));assert.ok(text.includes("kJ/mol"));
 assert.ok(r.labels.join("").replace(/\s/g,"").includes("ΔH=−92.4kJ/mol"),JSON.stringify(r.labels));
});
check("Standard degree enthalpy and entropy retain source roles",()=>{
 const r=compiled(buildThermoGraphScene("ΔH° = -92 kJ/mol and ΔS° = -199 J/(mol K). Draw ΔG vs T.",[],false));
 near(r.document.quantities.find(q=>q.id==="dH")?.value,-92);
});
check("Given molar mass is not an apparent-mass request",()=>{
 const q="Calculate the depression in freezing point of 5.85 g NaCl (molar mass 58.5 g/mol) in 500 g water, i=2, Kf=1.86 K kg mol-1.";
 const doc=buildSolutionLessonScene(q,[],false); if(doc){const r=compiled(doc);assert.ok(!r.labels.some(l=>l?.startsWith("M'=")));}else assert.equal(doc,null);
});
check("Connected work-function role and separate photon energy",()=>{
 const q="For an atomic electron, the work function of potassium is 2.25 eV and photon energy is 3 eV. Draw the photoelectric energy balance.";
 const r=compiled(buildAtomicRadiationScene(q,[],false));assert.ok(r.labels.includes("phi=2.25 eV"));assert.ok(r.labels.includes("K=0.75 eV"));
});
for(const q of ["Draw an energy profile. The activation energy for this reaction is 75 kJ/mol and ΔH=-20 kJ/mol.","For an Arrhenius reaction the activation energy of the reaction is 50 kJ/mol at 300 K. Draw ln k versus 1/T."])check("Connected activation owner does not stop inside this: "+q,()=>compiled(q.includes("Arrhenius")?buildKineticsScene(q,[],false):buildThermoGraphScene(q,[],false)));
for(const q of ["For an atomic electron, work function is 2 eV and photon energy is 3 eV. h=6.626 × 10^-34 J s. Draw the photoelectric diagram.","Draw a Daniell cell at 298 K. F=96485 C/mol."])check("Rounded constant remains explicitly unsupported: "+q,()=>assert.equal(q.includes("atomic")?buildAtomicRadiationScene(q,[],false):buildElectrochemScene(q,[],false),null));


check("Converted Celsius labels retain centikelvin precision",()=>{
 const r=compiled(buildKineticsScene("An Arrhenius reaction's rate constant doubles from 27 °C to 37 °C. Draw its Arrhenius plot.",[],false));
 near(r.document.quantities.find(q=>q.id==="T1")?.value,300.15);near(r.document.quantities.find(q=>q.id==="T2")?.value,310.15);
 assert.ok(r.labels.some(l=>l?.includes("300.15")),JSON.stringify(r.labels));assert.ok(r.labels.some(l=>l?.includes("310.15")),JSON.stringify(r.labels));
});
check("Raoult display retains common declared kPa with values converted together",()=>{
 const r=compiled(buildSolutionsGraphScene("Draw the Raoult graph for an ideal solution. Vapour pressures of pure A and B are 40 kPa and 20 kPa. Mole fraction of A is 0.5.",[],false));
 const text=r.labels.join(" ")+JSON.stringify(r.document.annotations);assert.ok(text.includes("kPa"),text);assert.ok(!text.includes("300.025"),text);
});
check("Raw kinetics chemical role is case independent",()=>{
 const r=compiled(buildKineticsScene("For an Arrhenius reaction the Rate constant doubles at 300 K and 310 K. Draw the graph of ln k versus 1/T.",[],false));
 near(r.document.quantities.find(q=>q.id==="T1")?.value,300);
});
check("Unsupported scalar OCR never falls back to default half life",()=>{
 for(const scalar of ["2.5 × 10⁻³","2.5 x 10-3"]){
  assert.equal(buildKineticsScene(`A first order reaction has rate constant ${scalar} s^-1. Find the half life.`,[],false),null);
 }
});


check("Uppercase equilibrium K cannot become a kinetic rate or hide half-life",()=>{
 const q="A first order reaction has half life 20 min. An unrelated equilibrium has K = 4. Find fraction remaining after 60 min.";
 const spec=kineticsFromStem(q);assert.ok(spec);near(spec.tHalf,20);assert.equal(spec.k,null);near(solveKinetics(spec).remainingAtTimes[0]?.remaining,.125);compiled(buildKineticsScene(q,[],false));
});
for(const role of ["Rate constant","RATE CONSTANT","k"])check("Rate words ignore case and lower k retains units: "+role,()=>{
 const q=`For a first order reaction ${role} = 0.01 s^-1. An unrelated equilibrium has K = 4. Find half life.`;
 const spec=kineticsFromStem(q);assert.ok(spec);near(spec.k,.01);compiled(buildKineticsScene(q,[],false));
 assert.equal(buildKineticsScene(`For a first order reaction ${role} = 1e- s^-1. An unrelated equilibrium has K = 4. Find half life.`,[],false),null);
});


for(const connector of ["=",":","is"])check("Connected declared emf damage cannot use calculated fallback: "+connector,()=>{
 const prefix="The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu ";
 assert.equal(parseCellNotation(prefix+connector+" 1e- Volt at 298 K."),null);
 assert.equal(parseCellNotation(prefix+connector+" 1e- Volt."),null);
 assert.equal(parseCellNotation(prefix+connector+" 1.13 kg."),null);
 const good=prefix+connector+" 1.13 Volt at 298 K.";const spec=parseCellNotation(good);assert.ok(spec);near(spec.statedE,1.13);compiled(buildElectrochemScene(good,[],false));
});
for(const [constant,shouldCompile] of [["Ka=1e-5; pKa=4",false],["pKa=4; Ka=1e-5",false],["Ka=1e-5; pKa=5",true],["pKa=5; Ka=1e-5",true]] as const)check("Independent Ka and pKa representations agree: "+constant,()=>{
 const q="50 mL of 0.1 M CH3COOH ("+constant+") is titrated with 0.1 M NaOH.";
 if(shouldCompile)compiled(buildSolutionsGraphScene(q,[],false));else assert.equal(buildSolutionsGraphScene(q,[],false),null);
});


for(const zinc of ["[Zn2+ = 0.1 M","Zn2+] = 0.1 M"])check("Malformed ion bracket cannot become unbracketed source: "+zinc,()=>{
 assert.equal(parseCellNotation("Calculate emf of a Daniell cell at 298 K when "+zinc+" and Cu2+=0.01 M."),null);
});


check("Born Haber declared step energies retain full molar units",()=>{
 const q="Draw the Born Haber cycle for KCl. Bond dissociation enthalpy of Cl2 is 242 kJ/mol and lattice enthalpy of KCl is -717 kJ/mol.";
 const r=compiled(buildThermoGraphScene(q,[],false));
 assert.ok(r.labels.includes("kJ/mol"),JSON.stringify(r.labels));assert.ok(!r.labels.some(l=>l?.endsWith("kJ/")),JSON.stringify(r.labels));
});


check("Long activation energy label never truncates its molar unit",()=>{
 const r=compiled(buildThermoGraphScene("Draw an energy profile: activation energy is 12345 kJ/mol and ΔH = -2000 kJ/mol.",[],false));
 near(r.document.quantities.find(q=>q.id==="Ea_forward")?.value,12345);
 const text=r.labels.join(" ");assert.ok(text.includes("12300"),JSON.stringify(r.labels));assert.ok(text.includes("kJ/mol"));assert.ok(!r.labels.some(l=>l?.endsWith("kJ/")));
});


// Same observed voltage role agrees independently of distinct standard voltage.
for(const tail of ["emf=1.13 Volt; emf=1.20 Volt.","emf=1.20 Volt; emf=1.13 Volt.","emf=1.13 Volt; emf=1.13 V; emf=1.20 Volt."])check("Contradictory observed emf atomically declines: "+tail,()=>{
 const question="Daniell cell at 298 K. "+tail;
 assert.equal(parseCellNotation(question),null);assert.equal(buildElectrochemScene(question,[],false),null);assert.equal(buildElectrochemScene(question,[],true),null);
});
check("Agreeing observed emf retains original value across unit spelling",()=>{
 const question="Daniell cell at 298 K. emf=1.13 Volt; emf=1.13 V.";
 const spec=parseCellNotation(question);assert.ok(spec);near(spec.statedE,1.13);compiled(buildElectrochemScene(question,[],false));
});
for(const tail of ["standard emf=1.10 V; emf=1.13 V.","emf=1.13 V; standard emf=1.10 V.","standard cell potential=1.10 V; emf=1.13 V.","standard electrode potential of the cell=1.10 V; emf=1.13 V."])check("Distinct standard and observed emf owners remain independent: "+tail,()=>{
 const question="Daniell cell at 298 K. "+tail;const spec=parseCellNotation(question);assert.ok(spec);near(spec.statedE0,1.10);near(spec.statedE,1.13);compiled(buildElectrochemScene(question,[],false));
});
for(const tail of ["standard emf=1.10 V; standard emf=1.20 V; emf=1.13 V.","standard emf=1.20 V; standard emf=1.10 V; emf=1.13 V.","emf=1e- Volt; emf=1.13 V.","emf=1.13 V; emf=1e- Volt."])check("Same-role standard conflict and observed damage stay fatal: "+tail,()=>{
 const question="Daniell cell at 298 K. "+tail;assert.equal(parseCellNotation(question),null);assert.equal(buildElectrochemScene(question,[],false),null);
});


// Bounded Gibbs equilibrium-constant ownership; no planner prose supplies values.
for(const [role,t,k,expectedG] of [
 ["The equilibrium constant of a reaction at 275 K is 12.",275,12,"-5.681"],
 ["The equilibrium constant for this reaction at 315.5 K = 0.4.",315.5,.4,"2.403"],
 ["The equilibrium constant of a reaction at 325 K: 2.5.",325,2.5,"-2.476"],
 ["The equilibrium constant of a reaction at 275 kelvin is 12.",275,12,"-5.681"],
] as const)check("Connected Gibbs constant owns its value after temperature: "+role,()=>{
 const question=role+" R = 8.314 J K^-1 mol^-1. Draw the standard Gibbs energy relation.";
 const givens:ChemPlanQuantity[]=[{id:"T",symbol:"T",value:t,unit:"K",origin:"given",sourceText:`T = ${t}`},{id:"K",symbol:"K",value:k,unit:"1",origin:"given",sourceText:`K = ${k}`},{id:"R",symbol:"R",value:8.314,unit:"J/(mol K)",origin:"given",sourceText:"R = 8.314 J/(mol K)"}];
 const result=compiled(buildChemicalThermodynamicsScene(question,givens,false));
 assert.ok(result.labels.includes("dGo="+expectedG),JSON.stringify(result.labels));
 assert.ok(result.labels.includes("K="+k.toFixed(2)),JSON.stringify(result.labels));assert.ok(result.labels.includes(`T=${t} K`));
 assert.deepEqual(result.document,buildChemicalThermodynamicsScene(question,[],false));
 const ordinary=synthesizeFamilyScene({question,turnPlan:{givens}});assert.ok(ordinary);assert.equal(ordinary.family,"chem_thermo");const ordinaryResult=compiled(ordinary.document);
 assert.ok(ordinaryResult.labels.includes("dGo="+expectedG));assert.ok(ordinaryResult.labels.includes("K="+k.toFixed(2)));assert.ok(ordinaryResult.labels.includes(`T=${t} K`));
});
check("Qualitative less-than-one clause is not another numeric constant",()=>{
 const question="The equilibrium constant of a reaction at 275 K is 12. R = 8.314 J K^-1 mol^-1. Draw the standard Gibbs energy relation and discuss a reaction whose equilibrium constant is less than 1.";
 const result=compiled(buildChemicalThermodynamicsScene(question,[],false));assert.ok(result.labels.includes("dGo=-5.681"));assert.ok(result.labels.includes("K=12.00"));
 const ordinary=synthesizeFamilyScene({question});assert.ok(ordinary);assert.equal(ordinary.family,"chem_thermo");
});
for(const value of ["4e-","1e999","0","-2","12 J","unknown","","12; equilibrium constant of the reaction at 275 K is 13","13; equilibrium constant of the reaction at 275 K is 12","12; equilibrium constant of the reaction at 275 K is 12"])check("Present invalid or repeated Gibbs K cannot fall back to stated Gibbs energy: "+value,()=>{
 const question="The equilibrium constant of a reaction at 275 K is "+value+". Standard Gibbs energy ΔG° = -5 kJ/mol. Draw the equilibrium relation.";
 assert.equal(buildChemicalThermodynamicsScene(question,[],false),null);assert.equal(buildChemicalThermodynamicsScene(question,[],true),null);
 assert.equal(synthesizeFamilyScene({question,families:["chem_thermo"]}),null);
});
check("Absent K still derives from independently stated Gibbs energy",()=>{
 const question="Standard Gibbs energy ΔG° = -5 kJ/mol at 275 K. Draw the equilibrium relation.";
 const result=compiled(buildChemicalThermodynamicsScene(question,[],false));assert.ok(result.labels.includes("dGo=-5.000"));assert.ok(synthesizeFamilyScene({question}));
});


// Every explicit Gibbs K owner is counted, including missing-valued occurrences.
for(const tail of [
 "Equilibrium constant is unknown; equilibrium constant is 12.",
 "Equilibrium constant is 12; equilibrium constant is unknown.",
 "Equilibrium constant is ; equilibrium constant is 12.",
 "Equilibrium constant is 12; equilibrium constant is .",
 "Equilibrium constant of this reaction and its reaction quotient is 2.",
 "Equilibrium constant for this reaction whose reaction quotient is 2.",
])check("Damaged or mixed Gibbs constant owners never supply a fallback: "+tail,()=>{
 const question="At 275 K. "+tail+" Standard Gibbs energy ΔG° = -5 kJ/mol. Draw the equilibrium relation.";
 assert.equal(buildChemicalThermodynamicsScene(question,[],false),null);assert.equal(buildChemicalThermodynamicsScene(question,[],true),null);assert.equal(synthesizeFamilyScene({question,families:["chem_thermo"]}),null);
});
check("Finite Gibbs inputs cannot publish overflowed derived energy",()=>{
 const question="At 1e307 K. Equilibrium constant is 10. Draw the equilibrium relation.";
 assert.equal(buildChemicalThermodynamicsScene(question,[],false),null);assert.equal(synthesizeFamilyScene({question,families:["chem_thermo"]}),null);
});


// Independently stated K and Gibbs energy must describe the same relation.
for(const gValue of ["-5681.366318742795 J/mol","-5.681366318742795 kJ/mol"])for(const reverse of [false,true])check("Canonical Gibbs/K dual-source agreement: "+gValue+" / "+reverse,()=>{
 const roles=["Equilibrium constant of this reaction is 12.","Standard Gibbs energy ΔG° = "+gValue+"."];if(reverse)roles.reverse();
 const question="At 275 K. "+roles.join(" ")+" Draw the equilibrium relation.";
 const result=compiled(buildChemicalThermodynamicsScene(question,[],false));assert.ok(result.labels.includes("dGo=-5.681"));assert.ok(result.labels.includes("K=12.00"));
 const ordinary=synthesizeFamilyScene({question});assert.ok(ordinary);assert.equal(ordinary.family,"chem_thermo");const live=compiled(ordinary.document);assert.ok(live.labels.includes("dGo=-5.681"));assert.ok(live.labels.includes("K=12.00"));
});
for(const gValue of ["-5 kJ/mol","5.681366318742795 kJ/mol","-5681.366318742795 kJ/mol"])for(const reverse of [false,true])check("Incompatible Gibbs/K dual givens refuse: "+gValue+" / "+reverse,()=>{
 const roles=["Equilibrium constant of this reaction is 12.","Standard Gibbs energy ΔG° = "+gValue+"."];if(reverse)roles.reverse();
 const question="At 275 K. "+roles.join(" ")+" Draw the equilibrium relation.";assert.equal(buildChemicalThermodynamicsScene(question,[],false),null);assert.equal(buildChemicalThermodynamicsScene(question,[],true),null);assert.equal(synthesizeFamilyScene({question,families:["chem_thermo"]}),null);
});
for(const gValue of ["4e- kJ/mol","1e999 kJ/mol","-5 J","unknown","","unknown; ΔG° = -5681.366318742795 J/mol","-5681.366318742795 J/mol; ΔG° = unknown"])check("Present damaged Gibbs energy cannot become K-derived energy: "+gValue,()=>{
 const question="At 275 K. Equilibrium constant is 12. Standard Gibbs energy ΔG° = "+gValue+". Draw the equilibrium relation.";
 assert.equal(buildChemicalThermodynamicsScene(question,[],false),null);assert.equal(buildChemicalThermodynamicsScene(question,[],true),null);assert.equal(synthesizeFamilyScene({question,families:["chem_thermo"]}),null);
});


// Public real-wording plans cite complete scalars before original physical units.
for(const suffix of [""," and discuss a reaction whose equilibrium constant is less than 1"])check("Literal R prefix retains ordinary compiled Gibbs relation: "+suffix,()=>{
 const question="The equilibrium constant of a reaction at 285 K is 7. R = 8.314 J K^-1 mol^-1. Draw the standard Gibbs energy relation"+suffix+".";
 const givens:ChemPlanQuantity[]=[{id:"T",symbol:"T",value:285,unit:"K",origin:"given",sourceText:"T = 285"},{id:"K",symbol:"K",value:7,unit:"1",origin:"given",sourceText:"K = 7"},{id:"R",symbol:"R",value:8.314,unit:"J K^-1 mol^-1",origin:"given",sourceText:"R = 8.314"}];
 const r=resolveChemistryGiven({question,after:/\bR\s*=/,dimension:"gas_constant",targetUnit:"J/(mol K)",aliases:["R"],quantities:givens});assert.ok(r.ok);near(r.reading.value,8.314);assert.equal(r.reading.source.text,"8.314 J K^-1 mol^-1");assert.equal(r.reading.source.kind,"plan_given");
 const direct=compiled(buildChemicalThermodynamicsScene(question,givens,false));const expected=(-8.314*285*Math.log(7)/1000).toFixed(3);assert.ok(direct.labels.includes("dGo="+expected));assert.ok(direct.labels.includes("K=7.00"));assert.ok(direct.labels.includes("T=285 K"));
 const ordinary=synthesizeFamilyScene({question,turnPlan:{givens}});assert.ok(ordinary);assert.equal(ordinary.family,"chem_thermo");const live=compiled(ordinary.document);assert.ok(live.labels.includes("dGo="+expected));assert.ok(live.labels.includes("K=7.00"));assert.ok(live.labels.includes("T=285 K"));
});
for(const [value,unit] of [[42,"kJ/mol"],[42000,"J/mol"]] as const)check("Complete Ea scalar prefix preserves canonical energy: "+value+unit,()=>{
 const question="Draw an energy profile. Ea = 42 kJ/mol.";const givens:ChemPlanQuantity[]=[{id:"Ea",symbol:"Ea",value,unit,origin:"given",sourceText:"Ea = 42"}];
 const read=resolveChemistryGiven({question,after:/Ea\s*=/,dimension:"molar_energy",targetUnit:"kJ/mol",aliases:["Ea"],quantities:givens});assert.ok(read.ok);near(read.reading.value,42);assert.equal(read.reading.source.kind,"plan_given");assert.equal(read.reading.rawUnit,"kJ/mol");
 const direct=compiled(buildThermoGraphScene(question,givens,false));near(direct.document.quantities.find(q=>q.id==="Ea_forward")?.value,42);assert.ok(direct.labels.some(l=>typeof l==="string"&&l.includes("42")&&l.includes("kJ/mol")));
 const ordinary=synthesizeFamilyScene({question,turnPlan:{givens}});assert.ok(ordinary);assert.equal(ordinary.family,"chem_thermo");near(compiled(ordinary.document).document.quantities.find(q=>q.id==="Ea_forward")?.value,42);
});
for(const [sourceText,value,unit,span] of [
 ["R = 8.314",9,"J K^-1 mol^-1",false],
 ["R = 8.314",8.314,"K",false],
 ["R = 8.31",8.314,"J K^-1 mol^-1",false],
 ["R = 8.314 J",8.314,"J K^-1 mol^-1",false],
 ["R = 8.314",8.314,"J K^-1 mol^-1",true],
] as const)check("Bound R damage or mismatch cannot be masked by default: "+sourceText+value+unit+span,()=>{
 const question="The equilibrium constant of a reaction at 285 K is 7. R = 8.314 J K^-1 mol^-1. Draw the standard Gibbs relation.";const start=question.indexOf(sourceText);const given:ChemPlanQuantity={id:"R",symbol:"R",value,unit,origin:"given",sourceText,...(span?{sourceSpan:{start,end:start+sourceText.length}}:{})};
 assert.equal(buildChemicalThermodynamicsScene(question,[given],false),null);assert.equal(synthesizeFamilyScene({question,turnPlan:{givens:[given]},families:["chem_thermo"]}),null);
});
for(const value of ["8.314 J K^-1 mol^-", "8.314 J K^-1 mol^-1 s", "8.314 J K^-1 mo"])check("Truncated original R unit never receives planner unit authority: "+value,()=>{
 const question="The equilibrium constant of a reaction at 285 K is 7. R = "+value+". Draw the standard Gibbs relation.";const given:ChemPlanQuantity={id:"R",symbol:"R",value:8.314,unit:"J K^-1 mol^-1",origin:"given",sourceText:"R = 8.314"};assert.equal(buildChemicalThermodynamicsScene(question,[given],false),null);assert.equal(synthesizeFamilyScene({question,turnPlan:{givens:[given]},families:["chem_thermo"]}),null);
});
check("Nonliteral R prose cannot override original source or gain provenance",()=>{
 const question="The equilibrium constant of a reaction at 285 K is 7. R = 8.314 J K^-1 mol^-1. Draw the standard Gibbs relation.";const givens:ChemPlanQuantity[]=[{id:"R",symbol:"R",value:999,unit:"K",origin:"given",sourceText:"R = 8.314 elsewhere"}];
 const read=resolveChemistryGiven({question,after:/\bR\s*=/,dimension:"gas_constant",aliases:["R"],quantities:givens});assert.ok(read.ok);near(read.reading.value,8.314);assert.equal(read.reading.source.kind,"stem_given");assert.equal(read.reading.source.planQuantityId,undefined);compiled(buildChemicalThermodynamicsScene(question,givens,false));assert.ok(synthesizeFamilyScene({question,turnPlan:{givens}}));
});
check("Duplicate original R remains unsupported even with ambiguous free citation",()=>{
 const question="The equilibrium constant of a reaction at 285 K is 7. R = 8.314 J K^-1 mol^-1; R = 8.314 J K^-1 mol^-1. Draw the standard Gibbs relation.";const givens:ChemPlanQuantity[]=[{id:"R",symbol:"R",value:999,unit:"K",origin:"given",sourceText:"R = 8.314"}];assert.equal(buildChemicalThermodynamicsScene(question,givens,false),null);assert.equal(synthesizeFamilyScene({question,turnPlan:{givens},families:["chem_thermo"]}),null);
});

// BEGIN PR137 V8: request predicates are not numeric equilibrium assignments.
function v8GibbsPositive(question:string, gJ:number, temperature:number, givens:ChemPlanQuantity[]=[]):void {
 const k=Math.exp(-gJ/(8.314*temperature));assert.ok(Number.isFinite(k)&&k>0);
 const kLabel="K="+(Math.abs(k)<.01||Math.abs(k)>=1e6?k.toExponential(3).replace(/0+e/,"e").replace(/\.e/,"e"):k.toFixed(2));
 const expected=["dGo="+(gJ/1000).toFixed(3),"kJ/mol",kLabel,"dGo=-RT lnK",`T=${temperature} K`];
 for(const schematic of [false,true]){
  const direct=compiled(buildChemicalThermodynamicsScene(question,givens,schematic));
  assert.deepEqual(direct.labels,expected);assert.equal(direct.document.source?.question,question);
  assert.ok(direct.labels.every(label=>typeof label==="string"&&!/NaN|Infinity/.test(label)));
 }
 const ordinary=synthesizeFamilyScene({question,turnPlan:{givens}});assert.ok(ordinary);assert.equal(ordinary.family,"chem_thermo");
 const live=compiled(ordinary.document);assert.deepEqual(live.labels,expected);assert.equal(live.document.source?.question,question);
}
function v8GibbsDecline(question:string,givens:ChemPlanQuantity[]=[]):void {
 assert.equal(buildChemicalThermodynamicsScene(question,givens,false),null);
 assert.equal(buildChemicalThermodynamicsScene(question,givens,true),null);
 assert.equal(synthesizeFamilyScene({question,turnPlan:{givens},families:["chem_thermo"]}),null);
}
const v8InverseG="Standard Gibbs energy ΔG° = +7.2 kJ/mol at 315 K. Draw the equilibrium relation. R = 8.314 J K^-1 mol^-1.";
for(const predicate of ["required","needed","requested"])for(const owner of ["a numerical K","the equilibrium constant"])for(const terminal of [".",""])check("Bare Gibbs request predicate retains finite inverse K: "+owner+predicate+terminal,()=>{
 const question=v8InverseG+" Only if "+owner+" is "+predicate+terminal;
 v8GibbsPositive(question,7200,315);
 const direct=compiled(buildChemicalThermodynamicsScene(question,[],false));
 const baseline=compiled(buildChemicalThermodynamicsScene(v8InverseG,[],false));assert.deepEqual(direct.render.primitives,baseline.render.primitives);
});
check("Bare Gibbs request retains original source-bound R prefix plan",()=>{
 const question=v8InverseG+" Only if a numerical K is needed.";
 const givens:ChemPlanQuantity[]=[{id:"R",symbol:"R",value:8.314,unit:"J K^-1 mol^-1",origin:"given",sourceText:"R = 8.314"},{id:"T",symbol:"T",value:315,unit:"K",origin:"given",sourceText:"T = 315"}];
 const r=resolveChemistryGiven({question,after:/\bR\s*=/,dimension:"gas_constant",targetUnit:"J/(mol K)",aliases:["R"],quantities:givens});assert.ok(r.ok);near(r.reading.value,8.314);assert.equal(r.reading.source.kind,"plan_given");assert.equal(r.reading.source.text,"8.314 J K^-1 mol^-1");
 v8GibbsPositive(question,7200,315,givens);
});
for(const reverse of [false,true])check("Actual K assignment and a bare request keep canonical agreement: "+reverse,()=>{
 const gJ=-8.314*315*Math.log(2);const roles=["Equilibrium constant is 2.","Only if a numerical K is required."];if(reverse)roles.reverse();
 const question=`Standard Gibbs energy ΔG° = ${gJ} J/mol at 315 K. `+roles.join(" ")+" Draw the equilibrium relation.";v8GibbsPositive(question,gJ,315);
});
for(const tail of [
 "K is required to be 5.","K is required = 5.","K is required 5.","K is required 1e-.",
 "K is needed to be 5.","K is requested = 4e-.","K is requested 5.",
 "K is required, 5.","K is needed; K = unknown.","K is required: 5.",
 "K = required.","K: requested.","K is unknown.","K = unknown.","K is 4e-.","K is 5.",
 "K is 2; K is 3.","K is 2; K is 2.","K is required. K is unknown.","K is unknown. K is required.",
])check("Gibbs request numeric/damaged continuation cannot disappear: "+tail,()=>{
 v8GibbsDecline(v8InverseG+" "+tail);
});
for(const gValue of ["1e307","-1e307"])check("Finite given Gibbs energy cannot publish nonfinite or zero inverse K: "+gValue,()=>{
 v8GibbsDecline(`Standard Gibbs energy ΔG° = ${gValue} J/mol at 315 K. Draw the equilibrium relation. Only if a numerical K is required.`);
});
check("Bare K request cannot hide a bound R prefix conflict",()=>{
 const question=v8InverseG+" Only if a numerical K is required.";
 v8GibbsDecline(question,[{id:"R",symbol:"R",value:9,unit:"J K^-1 mol^-1",origin:"given",sourceText:"R = 8.314"}]);
});
// END PR137 V8: request predicates are not numeric equilibrium assignments.

// BEGIN PR137 V9: original Unicode charged phases and lowercase Arrhenius source.
function v9CellPositive(question:string):void {
 const spec=parseCellNotation(question);assert.ok(spec,"original complete ion notation must parse");
 assert.equal(spec.anode.couple,"Zn2+/Zn");assert.equal(spec.cathode.couple,"Cu2+/Cu");
 near(spec.anode.concentrations["Zn2+"],.1);near(spec.cathode.concentrations["Cu2+"],.01);near(cellEmf(spec)?.q,10);near(cellEmf(spec)?.e,1.0705);
 const direct=compiled(buildElectrochemScene(question,[],false));near(direct.document.quantities.find(q=>q.id==="E_cell")?.value,1.0705);
 assert.ok(direct.labels.includes("Zn^(2+)") && direct.labels.includes("Cu^(2+)"));assert.ok(direct.labels.includes("0.1 M") && direct.labels.includes("0.01 M"));
 const ordinary=synthesizeFamilyScene({question});assert.ok(ordinary?.renderScene,"ordinary family synthesis declined");assert.equal(ordinary.family,"chem_electrochem");near(ordinary.document.quantities.find(q=>q.id==="E_cell")?.value,1.0705);
}
for(const notation of [
 "Zn | Zn²⁺(0.1 M) || Cu²⁺(0.01 M) | Cu",
 "Zn | Zn2+(0.1 M) || Cu²⁺(0.01 M) | Cu",
 "Zn | Zn²⁺(aq, 0.1 M) || Cu2+(aq, 0.01 M) | Cu",
 "Zn | Zn²⁺(aq, 0.1 M) ‖ Cu²⁺(aq, 0.01 M) | Cu",
 "Zn | Zn2+(0.1 M) || Cu2+(0.01 M) | Cu",
 "Zn | Zn^(2+)(0.1 M) || Cu^(2+)(0.01 M) | Cu",
])check("Complete raw charged cell phase and owner parity: "+notation,()=>v9CellPositive("Draw the cell "+notation+"."));
for(const ion of ["Zn²⁺⁺","Zn²⁺x","Zn³⁺","Zn²+","Zn⁰⁺","Zn²⁺/s","Zn²⁺_x","Zn^(2+","Zn^2+)"])check("Malformed or unsupported original charged phase cannot default: "+ion,()=>{
 const question="Draw the Daniell cell Zn | "+ion+"(0.1 M) || Cu²⁺(0.01 M) | Cu.";
 assert.equal(parseCellNotation(question),null);assert.equal(buildElectrochemScene(question,[],false),null);assert.equal(buildElectrochemScene(question,[],true),null);assert.equal(synthesizeFamilyScene({question}),null);
});
for(const phase of ["Zn²⁺(0.1 M), Zn²⁺(0.2 M)","Zn²⁺(1e- M)"])check("Unicode ion concentration conflict/damage cannot named-fallback: "+phase,()=>{
 const question="Draw the Daniell cell Zn | "+phase+" || Cu²⁺(0.01 M) | Cu.";assert.equal(parseCellNotation(question),null);assert.equal(buildElectrochemScene(question,[],false),null);assert.equal(synthesizeFamilyScene({question}),null);
});
check("Equivalent repeated Unicode concentration retains complete owner",()=>v9CellPositive("Draw the cell Zn | Zn²⁺(0.1 M), Zn²⁺(1e-1 M) || Cu²⁺(0.01 M) | Cu."));
for(const [expression,expected] of [["ln k = 5 - 2000/t",16628],["log k = 5 - 2000/t",38287.38492630499],["k = A e^(-2000/t)",16628],["k = A e(-2000/t)",16628],["k = A e^-2000/t",16628],["ln k = 5 - 2×10^3 K/t",16628]] as const)check("Lowercase original temperature equation compiles: "+expression,()=>{
 const question="For an Arrhenius reaction, "+expression+". Draw the Arrhenius plot.";
 const read=readChemistryArrheniusEquation(question);assert.ok(read.ok);assert.equal(question.slice(read.reading.coefficient.span.start,read.reading.coefficient.span.end),read.reading.coefficient.text);
 const spec=kineticsFromStem(question);assert.ok(spec);near(solveKinetics(spec).Ea,expected);const direct=compiled(buildKineticsScene(question,[],false));const expectedCaption=expression.startsWith("log")?"E_a = 38.3 kJ/mol":"E_a = 16.6 kJ/mol";assert.ok(direct.document.annotations.some(a=>a.text?.includes(expectedCaption)));
 const ordinary=synthesizeFamilyScene({question});assert.ok(ordinary?.renderScene);assert.equal(ordinary.family,"chem_kinetics");assert.ok(ordinary.document.annotations.some(a=>a.text?.includes(expectedCaption)));
});
for(const expression of ["ln k = 5 - 2000/t2","ln k = 5 - 2000/t^2","ln k = 5 - 2000/tα","ln k = 5 - 2000/t ÷2","ln k = 5 - 2000/t ∕2","ln k = 5 - 2000/t; ln k = 5 - 2000/T"])check("Lowercase expression cannot hide unknown term: "+expression,()=>{
 const question="For an Arrhenius reaction, "+expression+". Draw the Arrhenius plot.";assert.equal(readChemistryArrheniusEquation(question).ok,false);assert.equal(kineticsFromStem(question),null);assert.equal(buildKineticsScene(question,[],false),null);
});
// END PR137 V9: original Unicode charged phases and lowercase Arrhenius source.

// BEGIN PR137 V9 REPAIR3: complete bare cathode ends phase scanning before metadata.
const v9r3Potentials = "E°(Zn^2+/Zn) = -0.76 V, E°(Cu^2+/Cu) = +0.34 V and 2.303RT/F = 0.059 V.";
for (const question of [
 "Find the emf at 298 K of Zn | Zn^2+ (1.0 M) || Cu^2+ (0.01 M) | Cu. " + v9r3Potentials,
 "Zn | Zn^2+ (1.0 M) || Cu^2+ (0.01 M) | Cu. " + v9r3Potentials,
 "Draw the cell Zn | Zn²⁺ (1.0 M) || Cu²⁺ (0.01 M) | Cu. " + v9r3Potentials,
 "Draw the cell Zn | Zn^(2+) (1.0 M) || Cu^(2+) (0.01 M) | Cu. " + v9r3Potentials,
 "Draw the cell Zn(s) | Zn²⁺ (1.0 M) || Cu²⁺ (0.01 M) | Cu(s). " + v9r3Potentials,
]) check("Complete bare cathode preserves independently sourced metadata: " + question, () => {
 const spec = parseCellNotation(question); assert.ok(spec);
 assert.equal(spec.anode.couple,"Zn2+/Zn"); assert.equal(spec.cathode.couple,"Cu2+/Cu");
 near(spec.anode.concentrations["Zn2+"],1); near(spec.cathode.concentrations["Cu2+"],.01);
 near(spec.anode.e0,-.76); near(spec.cathode.e0,.34); near(spec.nernstFactor,.059);
 assert.equal(spec.anode.potentialSource,"stem"); assert.equal(spec.cathode.potentialSource,"stem");
 for(const half of [spec.anode,spec.cathode]) { assert.ok(half.potentialSourceSpan); assert.equal(question.slice(half.potentialSourceSpan.start,half.potentialSourceSpan.end),half.potentialSourceText); }
 near(cellEmf(spec)?.q,100); near(cellEmf(spec)?.e,1.041);
 const direct=compiled(buildElectrochemScene(question,[],false)); near(direct.document.quantities.find(q=>q.id==="E_cell")?.value,1.041);
 const ordinary=synthesizeFamilyScene({question}); assert.ok(ordinary?.renderScene); assert.equal(ordinary.family,"chem_electrochem"); near(ordinary.document.quantities.find(q=>q.id==="E_cell")?.value,1.041);
});
for (const electrode of ["Cu²⁺","Cu⁺","Cu^2+","Cu^2+)","Cu²⁺⁺","Cu/s","Cu_x","Cuα","Cu(s)O","Cu(s))","Cu(s","Cu[aq]","Cu 2+"]) check("Incomplete cathode cannot end phase or named-fallback: " + electrode, () => {
 const question="Draw the Daniell cell Zn | Zn²⁺(0.1 M) || Cu²⁺(0.01 M) | "+electrode+". "+v9r3Potentials;
 assert.equal(parseCellNotation(question),null); assert.equal(buildElectrochemScene(question,[],false),null); assert.equal(buildElectrochemScene(question,[],true),null); assert.equal(synthesizeFamilyScene({question}),null);
});
for (const phase of ["Cu²⁺/Cu(0.01 M)","Cu³⁺(0.01 M)","Cu²⁺⁺(0.01 M)","Cu²⁺(0.01 M), Cu²⁺(0.02 M)","Cu²⁺(1e- M)"]) check("Actual ion phase remains complete even before valid cathode: " + phase, () => {
 const question="Draw the Daniell cell Zn | Zn²⁺(0.1 M) || "+phase+" | Cu. "+v9r3Potentials;
 assert.equal(parseCellNotation(question),null); assert.equal(buildElectrochemScene(question,[],false),null); assert.equal(synthesizeFamilyScene({question}),null);
});
for (const bad of ["E°(Cu^2+/Cu) = 1e- V.","E°(Cu^2+/Cu) = 0.34 V. E°(Cu^2+/Cu) = 0.52 V."]) check("Post-cathode metadata retains raw quantity failure: " + bad, () => {
 const question="Draw the cell Zn | Zn²⁺(0.1 M) || Cu²⁺(0.01 M) | Cu. "+bad;
 assert.equal(parseCellNotation(question),null); assert.equal(buildElectrochemScene(question,[],false),null); assert.equal(synthesizeFamilyScene({question}),null);
});
// END PR137 V9 REPAIR3: complete bare cathode ends phase scanning before metadata.

// BEGIN PR137 V9 REPAIR4: raw chemistry cues and immediately adjacent complete phases.
for(const notation of [
 "Zn | Zn^2+(0.1 M) || Cu^2+(0.01 M) | Cu",
 "Zn | Zn^(2+)(aq, 0.1 M) || Cu^(2+)(aq, 0.01 M) | Cu",
 "Zn | Zn^(2+)(0.1 M) || Cu²⁺(0.01 M) | Cu",
 "Zn | Zn²⁺(0.1 M) || Cu^(2+)(0.01 M) | Cu",
]) check("Original chemistry source reaches ordinary family without forced family: "+notation,()=>v9CellPositive("Draw the cell "+notation+"."));
for(const phase of ["Zn^(2+(0.1 M)","Zn^(2+)(aq, 1e- M)","Zn^(2+)(aq, 0.1 m)","Zn^(2+)(0.1 M)x"]) check("Adjacent phase proof preserves physical refusal: "+phase,()=>{
 const question="Draw the Daniell cell Zn | "+phase+" || Cu²⁺(0.01 M) | Cu.";
 assert.equal(parseCellNotation(question),null);assert.equal(buildElectrochemScene(question,[],false),null);assert.equal(synthesizeFamilyScene({question}),null);
});
// END PR137 V9 REPAIR4: raw chemistry cues and immediately adjacent complete phases.

// BEGIN PR137 V9 REPAIR6: complete anode separates preceding potential metadata.
const v9r6SnPbPotentials = "E°(Sn2+/Sn) = −0.20 V and E°(Pb2+/Pb) = −0.10 V";
for(const question of [
 "Given "+v9r6SnPbPotentials+", calculate E°cell for Sn | Sn2+ || Pb2+ | Pb.",
 "Given "+v9r6SnPbPotentials+", calculate E°cell for Sn(s) | Sn2+ || Pb2+ | Pb(s).",
 "Given E°(Sn²⁺/Sn) = −0.20 V and E°(Pb²⁺/Pb) = −0.10 V, calculate E°cell for Sn | Sn²⁺ || Pb²⁺ | Pb.",
 "Given E₀(Sn^2+/Sn) = −0.20 V and E₀(Pb^2+/Pb) = −0.10 V, calculate E°cell for Sn | Sn^2+ || Pb^2+ | Pb.",
 "Calculate E°cell for Sn | Sn2+ || Pb2+ | Pb. Given "+v9r6SnPbPotentials+".",
]) check("Complete original anode retains independently given potentials: "+question,()=>{
 const spec=parseCellNotation(question);assert.ok(spec);assert.equal(spec.anode.couple,"Sn2+/Sn");assert.equal(spec.cathode.couple,"Pb2+/Pb");
 near(spec.anode.e0,-.20);near(spec.cathode.e0,-.10);near(cellEmf(spec)?.e0,.10);
 for(const half of [spec.anode,spec.cathode]) {assert.equal(half.potentialSource,"stem");assert.ok(half.potentialSourceSpan);assert.equal(question.slice(half.potentialSourceSpan.start,half.potentialSourceSpan.end),half.potentialSourceText);}
 const direct=compiled(buildElectrochemScene(question,[],false));near(direct.document.quantities.find(q=>q.id==="E0_cell")?.value,.10);assert.ok(direct.labels.includes("Sn^(2+)") && direct.labels.includes("Pb^(2+)"));
 const ordinary=synthesizeFamilyScene({question});assert.ok(ordinary?.renderScene);assert.equal(ordinary.family,"chem_electrochem");near(ordinary.document.quantities.find(q=>q.id==="E0_cell")?.value,.10);
});
for(const electrode of ["Zn²⁺","Zn^2+","Zn^(2+)","Zn²⁺⁺","Zn/s","Zn_x","αZn","Cu/Zn","Zn(s)x","Zn(s))","(Zn)","Cu²⁺ Zn","Cu / Zn"]) check("Trailing bare electrode cannot certify a charged or incomplete suffix: "+electrode,()=>{
 const question="Given E°(Zn2+/Zn) = −0.76 V and E°(Cu2+/Cu) = +0.34 V, draw the Daniell cell "+electrode+" | Zn²⁺(0.1 M) || Cu²⁺(0.01 M) | Cu.";
 assert.equal(parseCellNotation(question),null);assert.equal(buildElectrochemScene(question,[],false),null);assert.equal(buildElectrochemScene(question,[],true),null);assert.equal(synthesizeFamilyScene({question}),null);
});
for(const metadata of ["E°(Sn2+/Sn) = 1e- V and E°(Pb2+/Pb) = −0.10 V","E°(Sn2+/Sn) = −0.20 V and E°(Sn2+/Sn) = −0.25 V and E°(Pb2+/Pb) = −0.10 V"]) check("Pre-anode potential metadata still rejects malformed/conflicting quantities: "+metadata,()=>{
 const question="Given "+metadata+", calculate E°cell for Sn | Sn2+ || Pb2+ | Pb.";assert.equal(parseCellNotation(question),null);assert.equal(buildElectrochemScene(question,[],false),null);assert.equal(synthesizeFamilyScene({question}),null);
});
// END PR137 V9 REPAIR6: complete anode separates preceding potential metadata.

// BEGIN PR137 temperature/fraction follow-up: duplicate physical givens and original-word case.
const repeatTemperatureCell="Zn | Zn2+(0.1 M) || Cu2+(0.01 M) | Cu at 310 K.";
for(const declaration of ["Temperature is 310 K.","At 310 K.","Temperature is 36.85 °C.","T = 310 K."])check("Agreeing repeated cell temperature retains numeric Nernst authority: "+declaration,()=>{
 const question=repeatTemperatureCell+" "+declaration;
 const single=parseCellNotation(repeatTemperatureCell);const spec=parseCellNotation(question);assert.ok(single&&spec);
 near(single.temperatureK,310);near(spec.temperatureK,310);assert.deepEqual(cellEmf(spec),cellEmf(single));near(cellEmf(spec)?.factor,.06151);near(cellEmf(spec)?.e,1.0692);
 for(const schematic of [false,true]){
  const direct=compiled(buildElectrochemScene(question,[],schematic));near(direct.document.quantities.find(q=>q.id==="E_cell")?.value,1.0692);assert.equal(direct.document.source?.question,question);
 }
 const ordinary=synthesizeFamilyScene({question});assert.ok(ordinary?.renderScene);assert.equal(ordinary.family,"chem_electrochem");near(ordinary.document.quantities.find(q=>q.id==="E_cell")?.value,1.0692);
});
for(const declaration of ["At 315 K.","Temperature is 315 K.","Temperature is 42 °C.","Temperature is 1e- K.","Temperature is 310 Kfoo.","Temperature is unknown.","T = . K.","T = 0 K.","T = -1 K."])check("Present conflicting or damaged cell temperature cannot use 298 K: "+declaration,()=>{
 const question=repeatTemperatureCell+" "+declaration;assert.equal(parseCellNotation(question),null);assert.equal(buildElectrochemScene(question,[],false),null);assert.equal(buildElectrochemScene(question,[],true),null);assert.equal(synthesizeFamilyScene({question}),null);
});
check("Absent cell temperature preserves the existing standard-state convention",()=>{
 const question="Draw the cell Zn | Zn2+(0.1 M) || Cu2+(0.01 M) | Cu.";const spec=parseCellNotation(question);assert.ok(spec);assert.equal(spec.temperatureK,undefined);near(cellEmf(spec)?.factor,.0591);near(cellEmf(spec)?.e,1.0705);compiled(buildElectrochemScene(question,[],false));
});
for(const [request,remaining,completion,label] of [
 ["Find when One Fourth of the initial concentration remains.",.25,null,"t_1/4"],
 ["Find when ONE FOURTH of the INITIAL concentration REMAINS.",.25,null,"t_1/4"],
 ["Find when one fOuRtH of the initial concentration ReMaInS.",.25,null,"t_1/4"],
 ["Find when QUARTER of the original concentration is LEFT.",.25,null,"t_1/4"],
 ["Find the time for THREE FOURTHS COMPLETE.",null,.75,"t_75"],
 ["Find the time for three fOuRtHs COMPLETION.",null,.75,"t_75"],
 ["Find when 25 % REMAINS.",.25,null,"t_1/4"],
 ["Find the time for 75 % COMPLETION.",null,.75,"t_75"],
 ["Find the time for 75 % cOmPlEtIoN.",null,.75,"t_75"],
] as const)check("Original kinetics fraction casing retains requested instant: "+request,()=>{
 const question="A first order reaction has half life 20 min. "+request;const spec=kineticsFromStem(question);assert.ok(spec);near(spec.tHalf,20);assert.equal(spec.timeUnit,"min");
 assert.deepEqual(spec.remainingAsked,remaining===null?[]:[remaining]);assert.deepEqual(spec.fractionsAsked,completion===null?[]:[completion]);
 const solution=solveKinetics(spec);const asked=remaining===null?solution.timesForFractions:solution.timesForRemaining;assert.equal(asked.length,1);near(asked[0]!.time,40);
 const expected=label+" = 40 min";const direct=compiled(buildKineticsScene(question,[],false));assert.ok(direct.labels.includes(expected),JSON.stringify(direct.labels));assert.equal(direct.document.source?.question,question);
 const ordinary=synthesizeFamilyScene({question});assert.ok(ordinary?.renderScene);assert.equal(ordinary.family,"chem_kinetics");assert.ok(compiled(ordinary.document).labels.includes(expected));
});
for(const word of ["YIELD","ERROR","TEMPERATURE","PURITY","EFFICIENCY"])check("Unrelated uppercase percent cannot become a decay completion: "+word,()=>{
 const question="A first order reaction has half life 20 min. The "+word+" 75 % is recorded for this REACTION. Draw the concentration curve.";const spec=kineticsFromStem(question);assert.ok(spec);assert.deepEqual(spec.fractionsAsked,[]);assert.deepEqual(spec.remainingAsked,[]);assert.deepEqual(solveKinetics(spec).timesForFractions,[]);compiled(buildKineticsScene(question,[],false));
});
for(const given of ["50 % of A is DECOMPOSED IN 20 min.","IN 20 min, the reaction is 50 % COMPLETE."])check("Original given completion spans exclude uppercase stated events: "+given,()=>{
 const question="A first order reaction has half life 20 min. "+given+" Find when 25 % REMAINS.";const spec=kineticsFromStem(question);assert.ok(spec?.completion);near(spec.completion.fraction,.5);near(spec.completion.time,20);assert.deepEqual(spec.fractionsAsked,[]);assert.deepEqual(spec.remainingAsked,[.25]);assert.deepEqual(spec.timesAsked,[]);near(solveKinetics(spec).timesForRemaining[0]?.time,40);compiled(buildKineticsScene(question,[],false));
});
// END PR137 temperature/fraction follow-up: duplicate physical givens and original-word case.

// BEGIN PR137 expanded rereview: supplied cell activities and lattice givens.
// Append before the existing result footer; original 408 assertions and reader93 stay byte-for-byte whole.
interface ExpandedEcUnitRow {
 readonly id:string; readonly question:string; readonly family:"chem_unit_cell"|"chem_electrochem";
 readonly mode:"compile"|"decline"; readonly kind?:"cell"|"electrolysis";
 readonly edgePm?:number; readonly radiusPm?:number; readonly densityGPerCm3?:number;
 readonly e0?:number; readonly n?:number; readonly q?:number; readonly activities?:Readonly<Record<string,number>>;
 readonly observedE?:number; readonly statedE0?:number; readonly expectedInk?:string;
 readonly reason?:string; readonly sourceQuestionSha256?:string;
}
const expandedEcUnitLaneRows: readonly ExpandedEcUnitRow[] = [
  {
    "id": "F1-o1",
    "question": "The edge length of an fcc unit cell is 508 pm. If the radius of the cation is 110 pm, what is the radius of the anion?",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "b9b4643a73aa15ce2ea8d840d9d43c8ccd56af1c8ced1331faf05330f315abb6",
    "edgePm": 508,
    "radiusPm": 110
  },
  {
    "id": "F1-o2",
    "question": "In an fcc lattice the edge length of the unit cell is 400 pm and the radius of the atom is 141 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "64ab49e5799f823bac576a10250c5874d72f980593fd1c39ec22c3d546ee8b4f",
    "edgePm": 400,
    "radiusPm": 141
  },
  {
    "id": "F1-o3",
    "question": "Silver crystallises in fcc lattice. If edge length of the cell is 4.07 × 10^-8 cm and density is 10.5 g cm^-3, calculate the atomic mass of silver.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "4adafd784e01333389510b04429387b5dd1a52fec182170b106ef02835b78b55",
    "edgePm": 407
  },
  {
    "id": "F1-v1",
    "question": "The edge length of the fcc unit cell of NaCl is 508 pm. If the radius of Na+ is 95 pm, find the radius of Cl-.",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "84a330773dfe62135290039506d485a2a2c0bfc9f9a2b64737a1d776905a5fd8",
    "edgePm": 508,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-v2",
    "question": "The edge length for this cubic unit cell = 4.05 Å. Aluminium forms an fcc lattice with atomic radius 125 pm.",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "865016a73cd2ce2c3c33ff12dad4c470771ed62a926c52f318d871de0809d6cb",
    "edgePm": 405,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-v3",
    "question": "Copper forms a cubic cell whose edge length is 361 pm in an fcc lattice; the atomic radius is 120 pm. Find the density if the atomic mass is 63.5 g/mol.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "910def984c2535d4f49f73229707c928075451b193f374f6efec4e4ccad3769b",
    "edgePm": 361,
    "radiusPm": 120,
    "densityGPerCm3": 8.965434865595704
  },
  {
    "id": "F1-v4",
    "question": "The edge length of a face-centered cubic unit cell of copper is 361 pm. The atomic radius of copper is 120 pm. Calculate the density if the molar mass is 63.5 g/mol.",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "8d106e657b59f9c78f380a30d1dcff14e1e614eebf5a2ca45ad0ee36db3b217e",
    "edgePm": 361,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-v5",
    "question": "The edge length of a face centred cubic unit cell of a metal is 400 pm and the radius of the atom is 150 pm.",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "c28b0f68b2927a4c5098e099b224fa470be8073388cb91f3ddb30979327bcc3e",
    "edgePm": 400,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-v6",
    "question": "The edge length of the unit cell of a bcc metal is 288 pm and its atomic radius is 120 pm.",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "37d73554da713c3399af9d2a05cf59c3c043dc8f77b17190aa34968aaf739571",
    "edgePm": 288,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-v7",
    "question": "In the fcc unit cell, the edge length in the crystal is 408 pm, and the radius of the gold atom is 150 pm. Find the density (M = 197 g/mol).",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "bba2075a4c5d3a1e333f9498730e359bbe8263a0e8c83e3c52eac1fa27a25f2f",
    "edgePm": 408,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-v8",
    "question": "An element with molar mass 2.7 × 10^-2 kg mol^-1 forms a cubic unit cell with edge length 405 pm. If its density is 2.7 × 10^3 kg m^-3, what is the nature of the cubic unit cell?",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "32bd31550b30fd01bbffb506c6e758db1889bb4fd9e544179f6686f07e6520ba",
    "edgePm": 405,
    "reason": "The source does not name a supported cubic lattice; density-to-lattice inference is unsupported, so the builder must honestly decline."
  },
  {
    "id": "F1-v9",
    "question": "A bcc metal has a cell edge of 3.5 Å and its atomic radius is 1.6 Å. Find the density if the atomic mass is 39 g/mol.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "dbf587ec108fb8a76f4d8c7fcc50a35b820d02b7066b94ebbfc2932dbf989b04",
    "edgePm": 350,
    "radiusPm": 160,
    "densityGPerCm3": 3.020992996524889
  },
  {
    "id": "F1-v10",
    "question": "The edge length of the cubic fcc cell measures 352 pm and the radius of the nickel atom is 130 pm.",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "58c739b9c8187049fea848a11af08325298b23bfa90068fa55f1426dc4dbf143",
    "edgePm": 352,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-v11",
    "question": "For an fcc crystal the unit cell edge length is about 500 pm and the radius of the atom is 150 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "0e71c1a19eaab4e9f68999f189dc93aec445271dd8e4ed57dc003fd52493c346",
    "edgePm": 500,
    "radiusPm": 150
  },
  {
    "id": "F1-v12",
    "question": "A metal crystallizes in a bcc lattice. The length of the edge of the unit cell is 287 pm and the atomic radius is 100 pm. Find the density (atomic mass 56 g/mol).",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "62c88c8bcce81c1843d59f5a8095b266838b16d45c3371d10f040342691abfdf",
    "edgePm": 287,
    "radiusPm": 100,
    "densityGPerCm3": 7.867406337644186
  },
  {
    "id": "F1-v13",
    "question": "Edge length (a) of the fcc unit cell = 400 pm; radius of atom = 150 pm; atomic mass 60 g/mol. Find the density.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "dbb467a72117585336c594ac1b3d1e0b89efa8e38eb9f6af94bd797de98a311d",
    "edgePm": 400,
    "radiusPm": 150,
    "densityGPerCm3": 6.2271670541348385
  },
  {
    "id": "F1-v14",
    "question": "An fcc metal has edge length, a = 400 pm and the radius r = 150 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "2f54ea14efa011d6c50ca86f117b45681d46b74ffc97b543348a81f253d2f278",
    "edgePm": 400,
    "radiusPm": 150
  },
  {
    "id": "F1-v15",
    "question": "The fcc unit cell of aluminium has an edge length of 405 pm. Atomic radius is 150 pm. Find density with M = 27 g/mol.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "531a02a176c26004e449ccb66f74d65ec902897854743fdefc222a88ca653186",
    "edgePm": 405,
    "radiusPm": 150,
    "densityGPerCm3": 2.699715094004164
  },
  {
    "id": "F1-v16",
    "question": "Calculate the density of an fcc metal of atomic mass 60 g/mol if its unit cell edge is 4 x 10^-8 cm and its radius is 1.5 x 10^-8 cm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "7b5ff12561ce90f9e8c93a0faac1150f57125c4dd5f55f310aa500dd29a5019d",
    "edgePm": 400,
    "radiusPm": 150,
    "densityGPerCm3": 6.2271670541348385
  },
  {
    "id": "F1-v17",
    "question": "The edge length of an fcc unit cell is 508 pm. Find the density (molar mass 58.5 g/mol, Avogadro number 6.022 × 10^23 mol^-1).",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "3233f5aee68e3df93d93877e4c6321e95977499869e001e449f4c6465d13f95a",
    "edgePm": 508,
    "densityGPerCm3": 2.9640393802240435
  },
  {
    "id": "F1-v18",
    "question": "A metal crystallizes in fcc structure with edge length of unit cell equal to 400 pm and density 6.23 g/cm3. Find the atomic mass; the atomic radius is 150 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "d6bc276b5c4b6c8cd698f16247125b50c569c13e3234b947bc9230b296ae544f",
    "edgePm": 400,
    "radiusPm": 150
  },
  {
    "id": "F1-v19",
    "question": "In a bcc unit cell the edge length is 4.29 Å. Find the radius of the sodium atom.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "4869f7c6fe7269d49b2112c0ad1ef78c28a41b4d970c17bff552b9bc3a1aa5a7",
    "edgePm": 429,
    "radiusPm": 185.76244911176207
  },
  {
    "id": "F1-v20",
    "question": "Edge length of unit cell for this bcc crystal is 3.0 Å and the radius of the atom is 1.0 Å.",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "67f7ccc7df9c5b236d9e408a7dc3d7f5128b2574f2414ec1a8304c5f2ef1ed3a",
    "edgePm": 300,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-w1",
    "question": "An fcc metal has unit cell edge length 400 pm and atomic radius 141 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "a2c35f8b20502c98e81cb4c6dd5c7d2894636d709d501024d184536fa347c6f1",
    "edgePm": 400,
    "radiusPm": 141
  },
  {
    "id": "F1-w2",
    "question": "The unit cell edge length of an fcc metal is 361 pm and its atomic radius is 128 pm. Calculate the density (atomic mass 63.5 g/mol).",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "231d864c62775aa6d84596a567de09295d497a282cfa97b978d214f0de1fad19",
    "edgePm": 361,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-w3",
    "question": "Calculate the density of a bcc metal whose unit cell edge length is 287 pm and atomic radius 124 pm (atomic mass 56 g/mol).",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "5557de223549f3a663019212d0c94f47767736fcf422ca2928970229b851995e",
    "edgePm": 287,
    "radiusPm": 124,
    "densityGPerCm3": 7.867406337644186
  },
  {
    "id": "F1-w4",
    "question": "The edge length (a) of the fcc unit cell is 400 pm and the atomic radius is 141 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "621a8357be0bc0cc8f8cc07fd9bfbb16eb436ceb2c40425d65c13b6cecec2c1c",
    "edgePm": 400,
    "radiusPm": 141
  },
  {
    "id": "F1-w5",
    "question": "Edge length of the fcc unit cell, a = 400 pm. Atomic radius = 150 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "1380fd4293c4af5772bb6e3191e132d3202bb0dbe1f58459ef73f3416173fef7",
    "edgePm": 400,
    "radiusPm": 150
  },
  {
    "id": "F1-w6",
    "question": "Edge length of an fcc unit cell: 400 pm; atomic radius: 150 pm; atomic mass: 60 g/mol. Find the density.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "62d18cd4fd4ac351843fa01c72499eed29262e4afe7e7b16bc8a3ce77e3de65e",
    "edgePm": 400,
    "radiusPm": 150,
    "densityGPerCm3": 6.2271670541348385
  },
  {
    "id": "F1-w7",
    "question": "For the fcc lattice, edge length = 4.0 × 10^-8 cm and atomic radius = 1.5 × 10^-8 cm. Find the density for M = 60 g/mol.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "5844fc5d4960d9d0061b825e26d61d29d7131daa24e8a7e6881ceec5cf7760d3",
    "edgePm": 400,
    "radiusPm": 150,
    "densityGPerCm3": 6.2271670541348385
  },
  {
    "id": "F1-w8",
    "question": "Sodium has a bcc structure with cell edge length 424 pm. Calculate the atomic radius of sodium.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "cdc2035664d0b3adf764d0a203aa89f6f8f2a939f5dbaf575996081d294e94f5",
    "edgePm": 424,
    "radiusPm": 183.597385602301
  },
  {
    "id": "F1-w9",
    "question": "Sodium has a bcc structure with unit cell edge length 424 pm. Calculate the atomic radius of sodium.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "69741b87ec9a132c1e26c5cff7743356c92a88c67ccc3a95cbf35441653bb955",
    "edgePm": 424,
    "radiusPm": 183.597385602301
  },
  {
    "id": "F1-w10",
    "question": "A unit cell of an fcc metal has edge length 0.4 nm and the radius of its atom is 0.15 nm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "8ae756b55d5dd186ba504cbd5be5475c194e5b3915c38f260479564c7ceb22b7",
    "edgePm": 400,
    "reason": "Complete original nm edge and radius declarations must bind 400 pm and 150 pm.",
    "radiusPm": 150
  },
  {
    "id": "F1-w11",
    "question": "An fcc metal with edge length 400 pm has radius 150 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "a7cd48d73411f6ae0549096d5c09a6ec386e37d66c64f050bc7040f72feb99f8",
    "edgePm": 400,
    "radiusPm": 150
  },
  {
    "id": "F1-w12",
    "question": "The fcc cell edge is 400 pm and atomic radius 150 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "63963a8bbbe35ec17c72fa84c26e437501e4c750330e759f15ee6d59e594e5e5",
    "edgePm": 400,
    "radiusPm": 150
  },
  {
    "id": "F1-w13",
    "question": "In an fcc crystal, a = 400 pm. If the atomic radius is 150 pm, find the density (M = 60 g/mol).",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "0a2e0b69e166276c9e90c9a445eb0ba214785dff77f35a43c5443b6ac17e1159",
    "edgePm": 400,
    "radiusPm": 150,
    "densityGPerCm3": 6.2271670541348385
  },
  {
    "id": "F1-w14",
    "question": "The edge length of a cubic unit cell (fcc) is 400 pm and the atomic radius is 150 pm.",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "d7c1485584b49f16f092b2c4e87eb942d3301cf48fd82ee2116e6e90e661f5fc",
    "edgePm": 400,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-w15",
    "question": "The edge length of the fcc unit cell of silver is 408.6 pm. Calculate the density of silver (atomic mass 107.9 g/mol).",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "4e92b5885b8ccefc93603d034edb7705b8b249875a71500e8957efe3abfe6a24",
    "edgePm": 408.6,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-w16",
    "question": "The edge length of a bcc unit cell of iron is 286 pm. Calculate the density of iron (atomic mass 56 g/mol).",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "bb5a7e2b60127dcb3859550356a2d2eb1632f79bcd2a08de093a05d074ec9826",
    "edgePm": 286,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F1-w17",
    "question": "Edge-length of the fcc unit cell is 400 pm and the atomic radius is 150 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "5473b772a645d966c7a27840eeab10051861db1454af602b1d2dd63bd33e26f8",
    "edgePm": 400,
    "radiusPm": 150
  },
  {
    "id": "F1-w18",
    "question": "An element crystallises in fcc lattice having edge length of 400 pm. If radius of atom is 150 pm, calculate the density (atomic mass 60 g/mol).",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "93f727ca4ab9e9b70c5371b32d73d534c83442423d78673ae92dd333d63b2a08",
    "edgePm": 400,
    "radiusPm": 150,
    "densityGPerCm3": 6.2271670541348385
  },
  {
    "id": "F1-w19",
    "question": "An element crystallises in fcc lattice with an edge of 400 pm. Its atomic radius is 150 pm and atomic mass 60 g/mol. Find the density.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "88a619ab261051225d14c5bb88d5250339718a7f174c901526e58d8728be8d6b",
    "edgePm": 400,
    "radiusPm": 150,
    "densityGPerCm3": 6.2271670541348385
  },
  {
    "id": "F1-w20",
    "question": "An fcc metal: the edge length measured by X-ray is 400 pm and the atomic radius is 150 pm.",
    "family": "chem_unit_cell",
    "mode": "decline",
    "sourceQuestionSha256": "400225481ab59a3102d4e7a4a9825a040b0b2e6a2d7e1ff9449c0b3c351b52c7",
    "edgePm": 400,
    "reason": "Explicit edge/radius declaration lacks a complete cue-owned reading; honest refusal required."
  },
  {
    "id": "F2-o1",
    "question": "Calculate the emf of a Daniell cell at 298 K in which the Zn2+ concentration is 0.1 M and Cu2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "4d83ef7c8372438b8bc0548cbcf854531a5757eb53ee86f42a19c96fa0100060",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-o2",
    "question": "Calculate the emf of a Daniell cell at 298 K when [Zn2+] = 0.1 M and Cu2+ is 0.001 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "c67dd2b3f5fc43529a41f4f03c52e2d83c507454d4e5c35efb98acdddd1c6362",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 100,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.001
    }
  },
  {
    "id": "F2-o3",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and Cu2+ ions are 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "5d36f77a44f4a2de8ed36174b1674db3a57206b68649eb95d96659ebb86b4de9",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-o4",
    "question": "Calculate the emf of a Daniell cell at 298 K when [Zn2+] = 0.1 M and [Cu2+] = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "5fbdb66e5c56dfe8be9392783424fb911b1dfdfb813e1663b879e8e44f52e07b",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v1",
    "question": "Calculate the emf of a Daniell cell at 298 K when the concentration of Zn2+ ions is 0.1 M and that of Cu2+ ions is 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "3a78c03c012586ab8788cd9103a55eba0b90bfe23a83835255aa77b73ee6ccfb",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v2",
    "question": "Calculate the emf of a Daniell cell at 298 K with Zn2+ (0.1 M) and Cu2+ (0.01 M).",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "f9d7862fabf0ce5f3230b4871b7bdce7f84fe62fbb807022d6896b31deab981e",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v3",
    "question": "Calculate the emf of a Daniell cell at 298 K with 0.1 M Zn2+ and 0.01 M Cu2+.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "f127a88a03c29f41204e32e78634cdaa407f78075618076020c6567fac554a9a",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v4",
    "question": "Calculate the emf of a Daniell cell at 298 K with 0.1 M ZnSO4 and 0.01 M CuSO4 solutions.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "6aa1c54123575e751e2f3cfcc85eda0b0ffee81e2fa0ae0e208f029db8293121",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v5",
    "question": "Calculate the emf of a Daniell cell at 298 K when [Zn²⁺] = 0.1 M and [Cu²⁺] = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "aa18cc421da9b483886672613b87d928437a7150b83403da2c4198062021c73a",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v6",
    "question": "Calculate the emf of a Daniell cell at 298 K when [Zn^2+] = 0.1 M and [Cu^2+] = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "9dda86469ad20fcdc5e8ea0b11d3b345de290a5c647f950938f7cccd40511e41",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v7",
    "question": "Calculate the emf of a Daniell cell at 298 K when [Zn+2] = 0.1 M and [Cu+2] = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "ae2b7c29a1eca904d7c916c1d91823172c700f3151246e2504e220aefdca54e5",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-v8",
    "question": "Calculate the emf of a Daniell cell at 298 K if the Zn2+ ion concentration is 0.1 M and the Cu2+ ion concentration is 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "97522ad09085c732159b2bd1a9f9bc907cae759a6c299ae765553db6eee5a4d8",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v9",
    "question": "Calculate the emf of a Daniell cell at 298 K in which the Zn2+ concentration is 0.1 M and the Cu2+ concentration is 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "f29222dc6e2e5b0b2362da25ac6a920e8c9bacc7194d5c5c41890dbb7c889e04",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v10",
    "question": "Calculate the emf of a Daniell cell at 298 K where [Zn2+] is 0.1 M and [Cu2+] is 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "b26b5f6ddd80f47c9d646be9cbd0a17c4a3650a1603d7d30278ad2525c0bd46f",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v11",
    "question": "Calculate the emf of a Daniell cell at 298 K where Zn2+ = 10^-1 M and Cu2+ = 10^-2 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "2aae253e2638eaaf3c8b7928c284804df811f538af38abceb979db02abce96b5",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v12",
    "question": "Calculate the emf of a Daniell cell at 298 K where Zn2+ = 1 x 10^-1 M and Cu2+ = 1 × 10^-2 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "4cfd5f4434f6a4ce16e228aa26374d329893ccb38c67c78432032c482b307fc3",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v13",
    "question": "Calculate the emf of a Daniell cell at 298 K where Zn2+ = 1 x 10-1 M and Cu2+ = 1 x 10-2 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "69b01065a5978efde2ce2bdba57bc5d9dacb89c087effb6d203959b89ff94554",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-v14",
    "question": "Calculate the emf of a Daniell cell at 298 K where Zn2+ = 10⁻¹ M and Cu2+ = 10⁻² M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "bf12e3df16e0c71038e4276883233c9a572a43de44d1379e0fa8228aca190f1c",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-v15",
    "question": "Calculate the emf of a Daniell cell at 298 K where the concentrations of Zn2+ and Cu2+ are 0.1 M and 0.01 M respectively.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "f3f6f51e207608fcb7c62becbd1275f67489df6594b8d053cc48be0a7d64676f",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-v16",
    "question": "Calculate the emf of a Daniell cell at 298 K where Zn2+ is 0.1 molar and Cu2+ is 0.01 molar.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "12314ed2e4aae0626fb4625b6e014da23aabaae4947f053cc81c573a1a919d04",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v17",
    "question": "Calculate the emf of a Daniell cell at 298 K when [Zn2+] = 0.1 mol/L and [Cu2+] = 0.01 mol L-1.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "7f130da633813bdc7d2da45df4d5b11bcef1288eaedbec270f6d59fa19132ec2",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v18",
    "question": "Calculate the emf of a Daniell cell at 298 K if [Cu2+] = 0.01 M and [Zn2+] = 0.1 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "077934925a4b373da498d0625f4b7b8b84df67caeab7a8eb1b9e28bbf739ef87",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v19",
    "question": "Calculate the emf of a Daniell cell at 298 K if the zinc ion concentration is 0.1 M and the copper ion concentration is 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "cb58610a798be041dcabbde8cba99555a828e337943771265f7f5f362b2933b2",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-v20",
    "question": "Calculate the emf of a Daniell cell at 298 K if Zn2+ concentration = 0.1 M and Cu2+ concentration = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "c35695ab5b14e6c7035d0887ef38035b2003c0fc7f6bc6e2e38cdcd154644833",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v21",
    "question": "Calculate the emf of a Daniell cell at 298 K with Zn2+ at 0.1 M and Cu2+ at 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "cd91536fc0746b18d5e6ba8b615bd3f3178384b5d03a91389f9de1c9f96c8189",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v22",
    "question": "Calculate the emf of a Daniell cell at 298 K where the Zn2+ (aq) concentration is 0.1 M and the Cu2+ (aq) concentration is 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "9b82d09c84b262b6ef31379236d90b45665bdd3a13831293ec8e94b7c0233375",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-v23",
    "question": "Calculate the emf of a Daniell cell at 298 K with [Zn2+]=0.1M, [Cu2+]=0.01M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "9123357b6b32955ed4c65be8e534ab7aac59164cf06b083512925d7838cd9c35",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v24",
    "question": "Calculate the emf of a Daniell cell at 298 K using Zn2+ of 0.1 M and Cu2+ of 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "56efc4f47762eb13daa12ebc7c7ef83f92d7f2cb3b93ae85207fd11f293e34cb",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v25",
    "question": "For the Daniell cell, Zn2+ = 0.1 M and Cu2+ = 0.01 M. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "23211d0d789da0f8e75d8b405422cd70148c9321bf3bcf4b1feb417312fd3ad2",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v26",
    "question": "Daniell cell: Zn | Zn2+ (0.1 M) and Cu2+ (0.01 M) | Cu. Find E.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "53a8babbf641072e4d7650898e62f408d78f2902720c563524a7932af8ce47b6",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v27",
    "question": "Calculate the emf of a Daniell cell at 298 K in which Zn2+ ions have concentration 0.1 M and Cu2+ ions have concentration 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "98cc3b0cdd31e2e61930c31de673a7b0aa1b9987cf2db6a068bfa775f8eed2fa",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v28",
    "question": "Calculate the emf of a Daniell cell at 298 K in which Zn2+ ion is 0.1 M and Cu2+ ion is 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "7477c2fe71bd29aa8467ff84e58767105948acca3dca42246850153939afb66e",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v29",
    "question": "Calculate the emf of a Daniell cell at 298 K where the molarity of Zn2+ is 0.1 M and molarity of Cu2+ is 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "25c51a2d944f9eba4ad3a7b31007171be125910c1ef4b8bd40fb5b22d9cee459",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-v30",
    "question": "Calculate the emf of a Daniell cell at 298 K where Zn2+ ion concentration and Cu2+ ion concentration are 0.1 M and 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "00e7acf3c9cebbeeebbdea017f0fc6d1a3c4fc1cc4e05774667f57013c1ec252",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-m1",
    "question": "Calculate the emf of a Daniell cell at 298 K when 0.1 M Zn2+ and Cu2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "8ca4d3ddc99816fd9615aeb5b522b17f00bb4a946ec3014a1fdb1a0954243a9f",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m2",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ of 0.1 M and Cu2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "2a380779a350e8ab090684dea85e1a2f327b25029597835a2ebd0d878650244f",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m3",
    "question": "Calculate the emf of a Daniell cell at 298 K when [Zn^2+] = 0.1 M and Cu2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "43d28771211054899f2c2a2804895f09855dc5e14ecc38e6dd0b4be2790bca51",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m4",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn+2 = 0.1 M and Cu2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "84e77801c034412c687170a72975fbf79213fd90d85c9117a36728d4ca0abdda",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-m5",
    "question": "Calculate the emf of a Daniell cell at 298 K when the zinc ion concentration is 0.1 M and Cu2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "c80440b891b1f650eac3d1b2c0ba75ecc6e6d09dafb072c66e6a7a422d426760",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-m6",
    "question": "Calculate the emf of a Daniell cell at 298 K when the concentrations of Zn2+ and Cu2+ ions are 0.1 M and 0.001 M respectively.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "5f91e7fe4f3f0090a4b90932f457e7ad4d90d26c8a0df1b8adba967976dc776f",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-m7",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ ion concentration and Cu2+ ion concentration are 0.2 M and 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "1fadc6f4b6488472aa61ed11ea4c2454d9a5e0fa0419f19a83c425b242d0880b",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-m8",
    "question": "The concentrations of Zn2+ and Cu2+ in a Daniell cell are 0.1 M and 0.01 M respectively. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "52602e3794d09d94c8d93e16de80ed2e8b6e80fbde8b078c9ee061a7a713e44c",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-m9",
    "question": "Calculate the emf of a Daniell cell at 298 K when ZnSO4 is 0.1 M and Cu2+ ions are 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "623795e86a92178fc092b66f4ee59aa77bd6b5b3862548d2544cc228e9dcfb49",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m10",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and copper sulphate solution is 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "1a4de7b47eadcb29e37598baaa5734b77e3d42b0723ef5c253f2a186f4657978",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-m11",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and CuSO4 = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "ed4377db56c31d3a72575463bccf66ad66bdc3e9230168226e900022945d0ecc",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m12",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and Cu^2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "e853f0e6b21e7993f4b434b1910ba538058d40bb1e315a0a2b9dc2c0eb8982b3",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m13",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and Cu²⁺ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "c5b3d7554f2d5fbc7198549b6279d23683d9c5f8326c61c683ecc6a6b8501dc8",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m14",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn²⁺ = 0.1 M and Cu2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "0c01fb93f55df3af5ea061e34fed19c6ca9904504ae601614c991b864a47b0cf",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m15",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and Cu++ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "f0fdffea19d5428c9a0524a5212900821a0ae4eec88250aee97457999006b97c",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m16",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and Cu(2+) = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "6227b0768a108af59092b9e2e7d7f9c370d3b8a525ecd132863d9668cbfa403e",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-m17",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and Cu^(2+) = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "4a92d86e1657a82b129701b26ba0a2b5cbf91d0559433557d18b127f0a771480",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m18",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn^(2+) = 0.1 M and Cu^(2+) = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "e50738cd358b9a48a1ae5b902f48602a0240058a1a9586cc4adfe5d5f4768df5",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m19",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M, and in the copper half cell Cu2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "ac26b98e46c7e9e2f893bac61a30fdad8979fc588c9598482a17f2875bc4e434",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m20",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and Cu2+ = 0.01 M. E°(Zn2+/Zn) = −0.76 V and E°(Cu2+/Cu) = +0.34 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "8538c7c9556b1643e43eb25809e78344550ed8dcef43965a5aa5743afe5beb94",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m21",
    "question": "Calculate the emf of a Daniell cell at 298 K when Zn2+ = 0.1 M and Cu2+ = 0.01 M. E°(Zn2+/Zn) = –0.76 V and E°(Cu2+/Cu) = 0.34 V.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "6a620a6f0026dbe41e2da09ac70ba66617a296380e404835946e39e716d575de",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F2-m22",
    "question": "Calculate the emf of the Daniell cell at 298 K if E°cell = 1.10 V and [Zn2+] = 0.1 M, [Cu2+] = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "356a362f1d5e8d9efeaa9ba3644a3662629a565abbfba6a71b30c927f0810ceb",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    },
    "statedE0": 1.1
  },
  {
    "id": "F2-m23",
    "question": "Find the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu at 298 K given E°cell = 1.10 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "0316b5bd39ab250d3b5a058deb8e418131898662dd3e49036f5d43c85959a33b",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    },
    "statedE0": 1.1
  },
  {
    "id": "F2-m24",
    "question": "Find the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu at 298 K. Given: standard emf = 1.10 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "552dabc4ea116d17dbfff075184a0f71d193d28218453a7bc8b6296f39d8f058",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    },
    "statedE0": 1.1
  },
  {
    "id": "F2-m25",
    "question": "Find the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu at 298 K if the standard emf of the cell is 1.10 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "7e6e14f2cd1a75f5e21245debadea2afae553e684e91b16359cf1688ba83fdc9",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    },
    "statedE0": 1.1
  },
  {
    "id": "F2-m26",
    "question": "Calculate the cell potential of a Daniell cell where Zn2+ = 0.1 M and Cu2+ = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "26c58d402ca2f1b241df6652795e7673f17c99580f59586ff6c3c61fb7b78102",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m27",
    "question": "Calculate the emf of a Daniell cell at 298 K with [Zn2+] = 0.1 M and [Cu2+] = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "dcb71e8688fda51d1bdfd1d4af9c6bb15239959585f6c911876aae1100174a8a",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m28",
    "question": "Calculate the emf of a Daniell cell at 298 K for [Zn2+] = 0.1 M and [Cu2+] = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "afa75710627b321e686a119dce1bbcd529d2f2f70d4e6d7f071a570e39d000e3",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m29",
    "question": "Calculate E for a Daniell cell at 298 K where [Zn2+] = 0.1 M and [Cu2+] = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "1a14db5ed90597ddd4e78080e6646151328262e6dbb602126a742bd7954c3474",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F2-m30",
    "question": "What is the emf of a Daniell cell in which [Zn2+] = 0.1 M and [Cu2+] = 0.01 M?",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "f2c4c6ef84dfaaf5717d9d14797ca3f09886b19237ae9505947b338ed677975c",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F3-o1",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 Volt at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "a7dd24e464cdc9d858408d6fb9d4e474825d710a0070aebdae8b22d51211baaa",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v1",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 Volts at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "34be7de2ac13d53678415c6bab3923c880532361be2a0a06533feefb5e525751",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v2",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 volt at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "054aa2cc764a3311024056773ef2ffb30ae70bccef62b84383c06a2a4fa2d4cd",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v3",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 V at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "229dd6e988d2cfda6cc2856402ef181bdfc89b0c93f0cef901ed048ffc9a1ff7",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v4",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 v at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "b4f837d12eff8339154309c2895c438991176a99a46a6d2459ad08fd46ecb1eb",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F3-v5",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1130 mV at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "c9e962fe6d49de09cb4d355ea3f28f639b4864522ae8750c3335173905cb9f40",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F3-v6",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13V at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "ec50fb6ca5198f80c16262f5970817ef0764672e81643d58ca26cc209c041f24",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v7",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is +1.13 V at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "3874ad7bff9358f6afca504b976420111a49b1e4d23a979af985cd2184bd4985",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v8",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 VOLT at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "353643ee6794955d9f1665f859498aab86f41553649e953edc18139aaebd2239",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "F3-v9",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 volts.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "31d430d85103056be5e8db3875caf78d67773eb5124ac2db61bec8710bed7232",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v10",
    "question": "The standard emf of the cell Zn|Zn2+||Cu2+|Cu is 1.10 Volt. Draw the cell.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "2a4be72a80ef18104b079f2bc84c7b3c32981f5e86a7e5ef03a2bf31422eb2b2",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 1,
    "activities": {},
    "statedE0": 1.1
  },
  {
    "id": "F3-v11",
    "question": "E°cell = 1.10 Volts for Zn|Zn2+||Cu2+|Cu. Draw the cell.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "4ca8f485917eb6885bd9ea268f7dda493cac3704d8cd4ddfbf095227cc621701",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 1,
    "activities": {},
    "statedE0": 1.1
  },
  {
    "id": "F3-v12",
    "question": "E°cell = 1.1 × 10^0 V for Zn|Zn2+||Cu2+|Cu. Draw the cell.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "663dc4d1cc8e7a2edab99ddf986a7aff1eb5f4dcac22991624b7c8bc96de24b1",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 1,
    "activities": {},
    "statedE0": 1.1
  },
  {
    "id": "F3-v13",
    "question": "The cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu has a voltage of 1.13 Volt.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "11aa766d4e7c0beb7388cea4c10ab6c5b4b8c96bdfffc56dc80baf540b64f94b",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v14",
    "question": "The cell potential of Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 Volt.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "787c7275933bed2fb746b2d70eca72ccdef0a79223274c0bff278e51d8d7d5c7",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v15",
    "question": "The emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu is 1.13 V. E°(Zn2+/Zn) = -0.76 Volt, E°(Cu2+/Cu) = 0.34 Volt.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "362d99816860137d67933050f6be474e01f92f4209878aeccd5b48c14779e209",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "F3-v16",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E°(Zn2+/Zn) = -0.76 Volts and E°(Cu2+/Cu) = +0.34 Volts.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "94717e42a1ef59b739931aece9113d98b99d7c898395c6da1b3abec059db0c5e",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "F3-v17",
    "question": "For the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu, emf = 1.13 Volt.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "cb167c1ab02b4ae0a2eee9aa87268be5213182dd88605b24b98ca04c236ae968",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.1,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 1
    },
    "observedE": 1.13
  },
  {
    "id": "R-1",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu, given that E°(Zn2+/Zn) = -0.76 V and E°(Cu2+/Cu) = 0.34 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "f8a3b0b771f0bf29e1aff299dda0836fed3b16791e0e30fb62bf3ff3932fef42",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "R-2",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu if E°cell = 1.10 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "4891975103592444deabaf408d875b733a1cce6dab650841ab356886efb6857d",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    },
    "statedE0": 1.1
  },
  {
    "id": "R-3",
    "question": "Calculate the emf of the following cell at 298 K: Zn|Zn2+(0.001 M)||Cu2+(0.1 M)|Cu, E°cell = 1.10 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "a6a6febbcac7ea46c1c7056b7ed919ff5579a132c5b02986f318b1d640b650fe",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 0.01,
    "activities": {
      "Zn2+": 0.001,
      "Cu2+": 0.1
    },
    "statedE0": 1.1
  },
  {
    "id": "R-4",
    "question": "Find the emf of the cell Mg|Mg2+(0.001 M)||Cu2+(0.0001 M)|Cu where E°(Mg2+/Mg) = -2.37 V and E°(Cu2+/Cu) = 0.34 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "52098ab9ed56cc7fe6fbccf9a0c00787a3b3126382cdb5c3769000585ffbc45f",
    "kind": "cell",
    "e0": 2.71,
    "n": 2,
    "q": 10,
    "activities": {
      "Mg2+": 0.001,
      "Cu2+": 0.0001
    }
  },
  {
    "id": "R-5",
    "question": "Calculate the cell potential of Ni|Ni2+(0.01 M)||Ag+(0.1 M)|Ag given E°cell = 1.05 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "3b1472acc54b30e80d0cb27d5c4937e01ccd65df830f7c7bd28037403a80e7b9",
    "kind": "cell",
    "e0": 1.05,
    "n": 2,
    "q": 1,
    "activities": {
      "Ni2+": 0.01,
      "Ag+": 0.1
    },
    "statedE0": 1.05
  },
  {
    "id": "R-6",
    "question": "Calculate the emf of the cell Ni|Ni2+(0.01 M)||Ag+(0.1 M)|Ag. E°cell = 1.05 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "9857ddfc70705b3ea05e0478faa3f843886b697d214dcb430de8326eafb83fdf",
    "kind": "cell",
    "e0": 1.05,
    "n": 2,
    "q": 1,
    "activities": {
      "Ni2+": 0.01,
      "Ag+": 0.1
    },
    "statedE0": 1.05
  },
  {
    "id": "R-7",
    "question": "What is the emf of Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu when E°cell is 1.10 V?",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "1cab8884ef08a7a223aa7699b1abf33b1ccdca1d6bd99f00e4b4d465964568a0",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    },
    "statedE0": 1.1
  },
  {
    "id": "G-1",
    "question": "Zn|Zn²⁺(0.1 M)||Cu²⁺(0.01 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "11081dfeb19a4107da87ef0ad24ef09ea4685bb1325534eeffef76be7ceb179d",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-2",
    "question": "Zn | Zn^2+ (0.1 M) || Cu^2+ (0.01 M) | Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "2463d19ab63cdc45ed8ed005b4c026d5dd7ca88ac9da531ed26d8b62984b663c",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-3",
    "question": "Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "9a8a1ef3ed1cc51fc9c9caeb1beaccc16b0a3dba5c0aad42f605ca057822c0e0",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-4",
    "question": "Zn(s)|Zn²⁺(aq, 0.1 M)||Cu²⁺(aq, 0.01 M)|Cu(s). Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "b025fdab5d6545e0a593afa465e45e9e18a3e8a644e98cae4a0e6bbcb9c5e3e7",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-5",
    "question": "Zn|Zn²⁺(0.1 M)||Cu2+(0.01 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "3a3930dcdca09d5dd7ad07644af7f2038d2b95c104a843945624d4e1a7c7d895",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-6",
    "question": "Zn|Zn2+(0.1 M)||Cu²⁺(0.01 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "603f501b275e434dc4ad3d82c3139b8652e8e113e8cdf72ff4f9707aca75cc7a",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-7",
    "question": "Zn|Zn²⁺(0.1 M)||Ag⁺(0.01 M)|Ag. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "80cf9bbe289068460e11f757242a26975c2583ca48d3a9fc3000599473b0e36b",
    "kind": "cell",
    "e0": 1.56,
    "n": 2,
    "q": 1000,
    "activities": {
      "Zn2+": 0.1,
      "Ag+": 0.01
    }
  },
  {
    "id": "G-8",
    "question": "Pt|Fe²⁺(0.1 M),Fe³⁺(0.01 M)||Ag⁺(1 M)|Ag. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "71e855446237f36be8558772939107cb911b93ad366447b10dbb5ea3a7b0588e",
    "kind": "cell",
    "e0": 0.03,
    "n": 1,
    "q": 0.1,
    "activities": {
      "Fe2+": 0.1,
      "Fe3+": 0.01,
      "Ag+": 1
    }
  },
  {
    "id": "G-9",
    "question": "Zn|Zn²⁺(0.1 M)||Cu²⁺(0.01 M)|Cu. E°(Zn²⁺/Zn) = –0.76 V and E°(Cu²⁺/Cu) = 0.34 V. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "99449fe1f43eb4c5fe9dc3236debcccd7f4b23caf5cf6dfd6594e8e7b69fbf4c",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "G-10",
    "question": "Zn|Zn²⁺(0.1 M)||Cu²⁺(0.01 M)|Cu. E°(Zn²⁺/Zn) = −0.76 V and E°(Cu²⁺/Cu) = 0.34 V. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "55425ef711fc6cff5571d3efec8f25544d214277047984d43b6e9b4c2cacba04",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-11",
    "question": "Zn|Zn^(2+)(0.1 M)||Cu^(2+)(0.01 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "60583d4dfebe1035e9ab2c27d3276c5f9ea9ecd2d548e99e6c68b37650ac48e1",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-12",
    "question": "Zn|Zn+2(0.1 M)||Cu+2(0.01 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "af36ab5354530ef376eaa17847d8b6763cb64ed7b50a7ec9bc5a000b935e25b6",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "G-13",
    "question": "Zn|Zn++(0.1 M)||Cu++(0.01 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "c9835f862b13aad6a41652356bebb1776fed3e7c275a0109af297ab57246ff6e",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-14",
    "question": "Zn | Zn2+ (0.1 M) ‖ Cu2+ (0.01 M) | Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "c83771c25192b1e409232527c13e57200d1a768d13ad633eb464c5c79bd910f4",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-15",
    "question": "Zn|Zn2+(1 x 10^-1 M)||Cu2+(1 × 10^-2 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "bcf3de22d8635a1217feee8218100127d17efb0c25cdd01237b1cb9ccaef1e4b",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-16",
    "question": "Zn|Zn2+(10⁻¹ M)||Cu2+(10⁻² M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "50508c5736495e2f8386c8a8637973bc158d34e2a34f16acdc576a745abf4fe1",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "G-17",
    "question": "Zn|Zn2+(0.1M)||Cu2+(0.01M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "1427a7cce56300ad35e5532776d897b22181441c08c6d60c283c8ff6e55c134a",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-18",
    "question": "Zn|Zn2+ (0.1 mol/L)||Cu2+ (0.01 mol dm-3)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "8380478573773efceca17e21ce8abb167dad0563b16a2cd456863c9087174222",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-19",
    "question": "Zn|ZnSO4(0.1 M)||CuSO4(0.01 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "8c7cdca09c325568e0faa1724a21fb7a4b5b6673522713b9f97ca89c41a48229",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "G-20",
    "question": "Mg|Mg²⁺(0.001 M)||Cu²⁺(0.0001 M)|Cu. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "eb8bdd3b80318ff23323303adf4b6a0ca02746bbb881c16fbca88403ad5fabd8",
    "kind": "cell",
    "e0": 2.71,
    "n": 2,
    "q": 10,
    "activities": {
      "Mg2+": 0.001,
      "Cu2+": 0.0001
    }
  },
  {
    "id": "G-21",
    "question": "Given E° values of Sn2+/Sn and Pb2+/Pb are –0.20 V and –0.10 V respectively, calculate E°cell for Sn | Sn2+ || Pb2+ | Pb.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "d42e3bf612d50b644bd742815eeaae52b8d15372695423c7c781cf64d1001213",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "G-22",
    "question": "Given E° values of Sn2+/Sn and Pb2+/Pb are −0.20 V and −0.10 V respectively, calculate E°cell for Sn | Sn2+ || Pb2+ | Pb.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "7c31ac242a3cf1a800860e6aaba1e4c7633e191ad33475d11d55b3dfa3fb9f26",
    "kind": "cell",
    "e0": 0.1,
    "n": 2,
    "q": 1,
    "activities": {}
  },
  {
    "id": "G-23",
    "question": "Given E°(Sn2+/Sn) = –0.20 V and E°(Pb2+/Pb) = –0.10 V, calculate E°cell for Sn | Sn2+ || Pb2+ | Pb.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "a121fb269601908d12647ea7aefb8ac8cf756ba1eb137b8200bedc1ae45432ad",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "G-24",
    "question": "Calculate E°cell for Sn | Sn2+ || Pb2+ | Pb. The standard reduction potentials of Sn2+/Sn and Pb2+/Pb are –0.20 V and –0.10 V.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "02f6b9e2e665f671d5470bb487dd2fe7f8b46cca10dc3e1391b48cbb5d6a1e0f",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "G-25",
    "question": "Zn|Zn²⁺(0.1 M)||H⁺(0.01 M)|H₂(1 bar)|Pt. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "483df88e2bdea2a9bf395b0177cfd967432f43bf21d47e88a7d3cbe1e506cd25",
    "kind": "cell",
    "e0": 0.76,
    "n": 2,
    "q": 1000,
    "activities": {
      "Zn2+": 0.1,
      "H+": 0.01
    }
  },
  {
    "id": "G-26",
    "question": "Cu|Cu²⁺(0.01 M)||Ag⁺(0.1 M)|Ag. Calculate the emf at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "1f44d55e5a9d6b8c1347e6eb5b02017f0a72402d2f09cf6c8765c1d9610ff0ff",
    "kind": "cell",
    "e0": 0.46,
    "n": 2,
    "q": 1,
    "activities": {
      "Cu2+": 0.01,
      "Ag+": 0.1
    }
  },
  {
    "id": "S-1",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(10⁻² M)|Cu at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "68dd8c014d835080d16bc3f9afe1273f3b2c37b02f739d52e9739274c28875c3",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "S-2",
    "question": "Calculate the emf of the cell Zn|Zn2+(10⁻¹ M)||Cu2+(0.01 M)|Cu at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "25e0d70c7d4d12ac85c78c5b139aa2bcfbf91bbf38c1db182f622c641d237d98",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "S-3",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 mM)||Cu2+(0.01 M)|Cu at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "5110b1740858207a6c5698e21be1f12b2948a5d9a9f81c1127820fea590ec6e6",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "S-4",
    "question": "Calculate the emf of the cell Zn|Zn2+ 0.1 M||Cu2+ 0.01 M|Cu at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "2242cff368e1535f764842737ab024050ffabf205a9ad8521496dec8ce99a4cf",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    },
    "reason": "The unchanged generic scalar boundary reads the ion charge plus following decimal as a signed token (+ 0.1 or + 0.01) whose original start is attached to a digit. No complete concentration source reading exists; explicitly supplied unread activities must decline, never default to 1 M. Connector/parenthesized controls preserve supported scalar and unit policies."
  },
  {
    "id": "S-5",
    "question": "Calculate the emf of a Daniell cell at 298 K when [Zn2+] = 10⁻¹ M and [Cu2+] = 0.01 M.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "a7c2807edafa0297a2619a160e2e9638757edebabe6f02259921a0986cb662d3",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M13-1",
    "question": "How much copper is deposited at the cathode when a current of 2 A is passed through CuSO4 solution for 965 s? (F = 96485 C mol-1)",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "77f47b3d234a3a1913584990ffbee94b792acd7b7475a0bb5615e3ba24c0c679",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M13-2",
    "question": "How much copper is deposited at the cathode when a current of 2 A is passed through CuSO4 solution for 965 s? (1 F = 96500 C)",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "9dc2db413f3cb6f7b94f1a36609902c40448e1269810af6ea5c5fd46fb95a948",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M13-3",
    "question": "How much copper is deposited at the cathode when a current of 2 A is passed through CuSO4 solution for 965 s?",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "b5f8b55cc766d4895308f5974e9eb32d0028a42fa738a662ba141b2d4297baec",
    "kind": "electrolysis",
    "expectedInk": "0.635 g",
    "reason": "The source omits the supported electrolysis/cell cue; the existing electrolysis adapter honestly declines this unclassified cathode request."
  },
  {
    "id": "M14-1",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E°(Zn2+/Zn) = –0.76 V.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "283232a8bdba8e13bec454e3be4267808230dd4fd5ee50b761487a4fddcf155b",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M14-2",
    "question": "Calculate the emf of the cell Zn|Zn²⁺(0.1 M)||Cu²⁺(0.01 M)|Cu at 298 K.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "fba4e43dd14da1ed0695f3368b758d88c221529ff0b19cd99db818de2f98329c",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "M14-4",
    "question": "Calculate the emf of the cell Pt|Cr2O7^2-(0.1 M),Cr3+(0.01 M),H+(1 M)||... at 298 K.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "0a2ca98019f0074b5623f01f9fbcac1a4fd6fea59506e19cf92afb137f104851",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M14-5",
    "question": "A solution of 0.1 M K2Cr2O7 is electrolysed between platinum electrodes. Draw the electrolytic cell.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "7f4d024fe67af13e917d06906d2ddb2b43b61f8ef37a9fd3ec2a45f5470cf318",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M13-d",
    "question": "A dilute solution of sulphuric acid is electrolysed using a current of 0.10 A for 2 hours to produce hydrogen and oxygen gas. Draw the cell. (F = 96485 C mol-1)",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "1ba9280dc07c25f4e9bb2196a1f64b5f6088d1300a4fff359e1ab8be711742b8",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M13-e",
    "question": "A dilute solution of sulphuric acid is electrolysed using a current of 0.10 A for 2 hours to produce hydrogen and oxygen gas. Draw the cell. (1 F = 96500 C)",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "dc39f072cef2664495ef932902d346674fc4808ecbb5bfbc96b0151ad907e3b1",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M13-f",
    "question": "A dilute solution of sulphuric acid is electrolysed using a current of 0.10 A for 2 hours to produce hydrogen and oxygen gas. Draw the cell.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "7fb2b375a24b6db643af0430c1aa269bc45da5dce69b053203c5b36296adb72e",
    "kind": "electrolysis",
    "expectedInk": "H_2"
  },
  {
    "id": "M13-g",
    "question": "CuSO4 solution is electrolysed with platinum electrodes using a current of 2 A for 965 s. Draw the cell and find the mass of copper deposited. (F = 96500 C mol-1)",
    "family": "chem_electrochem",
    "mode": "compile",
    "kind": "electrolysis",
    "expectedInk": "0.635 g",
    "sourceQuestionSha256": "c7f3ef3d666e11ddd817ab011ebf728503983eb3b217469566ef2dc0f42de91d",
    "reason": "The supported original F = 96500 C mol-1 constant is accepted; the existing electrolysis calculation must display 0.635 g."
  },
  {
    "id": "M13-h",
    "question": "CuSO4 solution is electrolysed with platinum electrodes using a current of 2 A for 965 s. Draw the cell and find the mass of copper deposited. (F = 96485 C mol-1)",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "fe51543766310717bf08bb31dfce8e3f197fb89f6acfb7a8acaa9d972169912f",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M14-a",
    "question": "Draw the cell Zn|Zn²⁺(1 M)||Cu²⁺(1 M)|Cu and find E°cell. E°(Cu²⁺/Cu) = +0.34 V, E°(Zn²⁺/Zn) = –0.76 V.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "86bdff1f8ba927f8b42b9c76885fd7098e52668146f28809f0997b4919a34295",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "M14-c",
    "question": "A solution contains 0.1 M K2Cr2O7. Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "804f97f8445f4c16c9190b65d494cc4adde75a21a26b24abc39cd273dcea2e2b",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "N-1",
    "question": "Represent the cell in which the following reaction takes place Mg(s) + 2Ag+(0.0001 M) → Mg2+(0.130 M) + 2Ag(s). Calculate its E(cell) if E°(cell) = 3.17 V.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "8411c8aa67ed406be4d8b5d4a56191866bfe98e8737ba59452757fe116e59333",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "N-2",
    "question": "Calculate the emf of the cell in which the following reaction takes place: Ni(s) + 2Ag+ (0.002 M) → Ni2+ (0.160 M) + 2Ag(s). Given that E°cell = 1.05 V.",
    "family": "chem_electrochem",
    "mode": "decline",
    "sourceQuestionSha256": "132b9f8add4dc6217f8fda27d274d95420be52a4a913f1b9dc8650cb454d2f5e",
    "reason": "Unsupported or unowned supplied activity/potential, incomplete reaction cell, or unchanged rounded-constant/unit refusal."
  },
  {
    "id": "N-3",
    "question": "Calculate the emf of the cell Mg|Mg2+(0.001 M)||Cu2+(0.0001 M)|Cu given that E°(Mg2+/Mg) = -2.37 V and E°(Cu2+/Cu) = +0.34 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "af7d6cee3707887fe79565354c3ade5d918a30fc60653cc549ffe3926b815ffd",
    "kind": "cell",
    "e0": 2.71,
    "n": 2,
    "q": 10,
    "activities": {
      "Mg2+": 0.001,
      "Cu2+": 0.0001
    }
  },
  {
    "id": "N-4",
    "question": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu at 298 K. E°(Zn2+/Zn) = -0.76 V and E°(Cu2+/Cu) = 0.34 V.",
    "family": "chem_electrochem",
    "mode": "compile",
    "sourceQuestionSha256": "10eeb83883b86feeac07e2203db24ad934dc9ad161b00162fa316e490bfe5da9",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "U-1",
    "question": "Copper crystallises in an fcc lattice with edge length 361 pm; the radius of a copper atom is 128 pm.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "56d20f4e457ed4b57046f6b76acd2d36670efc25501029d7acf574ff53edf88c",
    "edgePm": 361,
    "radiusPm": 128
  },
  {
    "id": "U-2",
    "question": "An fcc unit cell edge length is 508 pm. If the radius of the cation is 110 pm, find the radius of the anion.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "c0b4c0d85a23ab9be24bf5b184ba6e67c79e4b2d26056419a54a78a57be9a597",
    "edgePm": 508,
    "radiusPm": 110
  },
  {
    "id": "U-3",
    "question": "Gold (atomic mass 197 g/mol) crystallises in an fcc lattice. The unit cell edge length is 407 pm and the atomic radius is 144 pm. Calculate the density of gold.",
    "family": "chem_unit_cell",
    "mode": "compile",
    "sourceQuestionSha256": "02e890cf4899ab4ec1292380a428f0ef3e22046706a5992df666e2ac736576ce",
    "edgePm": 407,
    "radiusPm": 144,
    "densityGPerCm3": 19.40895882210884
  }
];
function expandedEcUnitRefusal(row:ExpandedEcUnitRow):void {
 const builder=row.family==="chem_unit_cell"?buildUnitCellScene:buildElectrochemScene;
 if(row.family==="chem_electrochem")assert.equal(parseCellNotation(row.question),null);
 assert.equal(builder(row.question,[],false),null,"direct exact figure must decline: "+row.id);
 assert.equal(builder(row.question,[],true),null,"schematic cannot turn unread givens into defaults: "+row.id);
 assert.equal(synthesizeFamilyScene({question:row.question}),null,"ordinary compiler cannot draw another figure after supplied-value refusal: "+row.id);
}
function expandedEcUnitCompile(row:ExpandedEcUnitRow):void {
 const builder=row.family==="chem_unit_cell"?buildUnitCellScene:buildElectrochemScene;
 const direct=compiled(builder(row.question,[],false));
 const ordinary=synthesizeFamilyScene({question:row.question});assert.ok(ordinary?.renderScene,"ordinary family declined: "+row.id);assert.equal(ordinary.family,row.family);
 for(const document of [direct.document,ordinary.document]) {
  for(const quantity of document.quantities)assert.ok(Number.isFinite(quantity.value),"nonfinite quantity: "+row.id);
  assert.ok(!/NaN|Infinity|∞/.test(JSON.stringify(document.annotations)),"nonfinite source ink: "+row.id);
  if(row.family==="chem_unit_cell") {
   near(document.quantities.find(q=>q.id.endsWith("_a"))?.value,row.edgePm!);
   if(row.radiusPm!==undefined)near(document.quantities.find(q=>q.id.endsWith("_r"))?.value,Number(row.radiusPm.toFixed(6)));
   if(row.densityGPerCm3!==undefined) {
    const density=document.quantities.find(q=>q.id.endsWith("_rho"))?.value;assert.ok(typeof density === "number" && Number.isFinite(density) && density>0,"finite positive stored density: "+row.id);
    near(density,Number(row.densityGPerCm3.toFixed(6)));
    assert.ok(document.annotations.some(annotation=>{
     const label=/ρ\s*=\s*([\d.e+−-]+)\s*g\/cm³/.exec(annotation.text??"");return label && Number(label[1])>0 && Number(label[1])===Number(row.densityGPerCm3!.toPrecision(3));
    }),"independent positive density caption: "+row.id);
   }
  }else if(row.kind==="cell") {
   near(document.quantities.find(q=>q.id==="E0_cell")?.value,row.e0!);
   if(Object.keys(row.activities??{}).length) {
    const expectedE=Number((row.e0!-.0591/row.n!*Math.log10(row.q!)).toFixed(4));
    near(document.quantities.find(q=>q.id==="E_cell")?.value,expectedE);
   }else assert.equal(document.quantities.find(q=>q.id==="E_cell"),undefined,"standard-only source cannot invent nonstandard E: "+row.id);
  }
 }
 if(row.kind==="cell") {
  const spec=parseCellNotation(row.question);assert.ok(spec,"original cell must parse: "+row.id);
  const emf=cellEmf(spec);assert.ok(emf);near(emf.e0,row.e0!);near(emf.n,row.n!);
  if(Object.keys(row.activities??{}).length) {near(emf.q,row.q!);near(emf.factor,.0591);}else {assert.equal(emf.e,null);assert.equal(emf.q,undefined);}
  for(const [ion,value] of Object.entries(row.activities??{}))near(({...spec.anode.concentrations,...spec.cathode.concentrations})[ion],value);
  if(row.observedE!==undefined) {
   near(spec.statedE,row.observedE);
   assert.ok(direct.labels.includes("E = 1.13 V"));
   assert.ok(direct.document.annotations.some(a=>a.text?.includes("emf 1.13 V as given in the question")));
  }else assert.equal(spec.statedE,undefined,"electrode/standard E° cannot become observed emf: "+row.id);
  if(row.statedE0!==undefined)near(spec.statedE0,row.statedE0);
 }
 if(row.expectedInk!==undefined)assert.ok((direct.labels.join(" ")+" "+direct.document.annotations.map(a=>a.text??"").join(" ")).includes(row.expectedInk));
}
for(const row of expandedEcUnitLaneRows)check("Expanded lane source oracle "+row.id+": "+row.question,()=>row.mode==="compile"?expandedEcUnitCompile(row):expandedEcUnitRefusal(row));

// Five independently written variants of each numerical ownership finding.
for(const [id,question,edgePm,radiusPm,density] of [
 ["own-edge-1","An fcc metal has a unit-cell edge length of 400 pm and an atomic radius of 150 pm. Draw its unit cell.",400,150,undefined],
 ["own-edge-2","For the fcc lattice, edge length (a) = 400 pm; atomic radius = 150 pm; atomic mass = 60 g/mol. Find the density.",400,150,4*60/((400e-10)**3*6.022e23)],
 ["own-edge-3","An fcc unit cell edge length is 508 pm. Its cation radius is 110 pm. Find the anion radius.",508,110,undefined],
 ["own-edge-4","The fcc metal has an edge-length of 0.4 nm and radius 0.15 nm. Draw the unit cell.",400,150,undefined],
 ["own-edge-5","An fcc lattice has a = 400 pm and r = 150 pm. Its molar mass is 60 g/mol. Calculate its density.",400,150,4*60/((400e-10)**3*6.022e23)],
] as const)check("Independent stated edge ownership "+id,()=>expandedEcUnitCompile({id,question,family:"chem_unit_cell",mode:"compile",edgePm,radiusPm,densityGPerCm3:density}));
for(const quantity of ["edge length (a) = unknown pm","edge length = 1e- pm","edge length = 400 pmfoo","edge length measured by diffraction is unknown pm","edge length is 400 pm; edge length is 420 pm"])check("Unread/conflicting edge cannot be derived: "+quantity,()=>expandedEcUnitRefusal({id:quantity,question:"Draw an fcc unit cell. Its "+quantity+" and its atomic radius is 150 pm.",family:"chem_unit_cell",mode:"decline"}));
check("Unstated edge is legitimately derived from source radius",()=>{
 const q="Draw an fcc unit cell with atomic radius 150 pm and calculate the edge length.";
 const direct=compiled(buildUnitCellScene(q,[],false));near(direct.document.quantities.find(x=>x.id.endsWith("_a"))?.value,Number((4*150/Math.SQRT2).toFixed(6)));
});

for(const [id,tail] of [
 ["own-ion-1","[Zn^2+] is 0.1 M while [Cu^2+] is 0.01 M"],
 ["own-ion-2","Cu2+ of 0.01 M together with 0.1 M Zn2+"],
 ["own-ion-3","Zn2+ of 0.1 mol/L and Cu2+ of 0.01 mol/L"],
 ["own-ion-4","Cu2+ has concentration 0.01 M and Zn2+ has concentration 0.1 M"],
 ["own-ion-5","ZnSO4 is 0.1 M and CuSO4 is 0.01 M"],
] as const)check("Independent original ion activity ownership "+id,()=>expandedEcUnitCompile({id,question:"Calculate the emf of a Daniell cell at 298 K when "+tail+".",family:"chem_electrochem",mode:"compile",kind:"cell",activities:{"Zn2+":.1,"Cu2+":.01},e0:1.1,n:2,q:10}));
for(const tail of [
 "Zn+2 = 0.1 M and Cu2+ = 0.01 M",
 "Zn2+ = 10⁻¹ M and Cu2+ = 0.01 M",
 "the concentrations of Zn2+ and Cu2+ are 0.1 M and 0.001 M respectively",
 "Zn2+ = 1e- M and Cu2+ = 0.01 M",
 "[Zn2+ = 0.1 M and Cu2+ = 0.01 M",
 "[[Zn2+]] = 0.1 M and Cu2+ = 0.01 M",
 "Zn2+ = 0.1 M and Zn2+ = 0.2 M and Cu2+ = 0.01 M",
 "Zn2+ = 0 M and Cu2+ = 0.01 M",
 "Zn2+ = unknown M and Cu2+ = 0.01 M",
])check("Supplied activity cannot become one-molar default: "+tail,()=>expandedEcUnitRefusal({id:tail,question:"Calculate the emf of a Daniell cell at 298 K when "+tail+".",family:"chem_electrochem",mode:"decline"}));
for(const phase of ["Zn2+(10⁻¹ M)","Zn2+(unknown)","Zn2+(1e-)","Zn2+(0.1 M)x"])check("Damaged original phase remains an atomic refusal: "+phase,()=>expandedEcUnitRefusal({id:phase,question:"Draw the galvanic cell Zn|"+phase+"||Cu2+(0.01 M)|Cu with its salt bridge.",family:"chem_electrochem",mode:"decline"}));
check("Agreeing original concentration readings remain bound",()=>expandedEcUnitCompile({id:"own-ion-agreement",question:"Draw Zn | Zn2+(0.1 M), Zn^2+(1e-1 M) || Cu2+(0.01 M) | Cu at 298 K.",family:"chem_electrochem",mode:"compile",kind:"cell",activities:{"Zn2+":.1,"Cu2+":.01},e0:1.1,n:2,q:10}));

for(const [id,question,e0,activities] of [
 ["own-electrode-1","Find the emf of Mg|Mg2+(0.001 M)||Cu2+(0.0001 M)|Cu given E°(Mg2+/Mg) = -2.37 V and E°(Cu2+/Cu) = +0.34 V.",2.71,{"Mg2+":.001,"Cu2+":.0001}],
 ["own-electrode-2","Calculate the cell potential for Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu where E°(Zn2+/Zn) = -0.76 V and E°(Cu2+/Cu) = 0.34 V.",1.1,{"Zn2+":.1,"Cu2+":.01}],
 ["own-electrode-3","Given E°(Mg2+/Mg) = -2.37 V, E°(Cu2+/Cu) = 0.34 V, draw Mg|Mg2+(0.001 M)||Cu2+(0.0001 M)|Cu and find its emf.",2.71,{"Mg2+":.001,"Cu2+":.0001}],
 ["own-electrode-4","For Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu, find the emf if E₀(Zn2+/Zn) is -0.76 V and E₀(Cu2+/Cu) is 0.34 V.",1.1,{"Zn2+":.1,"Cu2+":.01}],
 ["own-electrode-5","Calculate emf for Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. The reduction potentials are E°(Zn2+/Zn) = -0.76 V and E°(Cu2+/Cu) = 0.34 V.",1.1,{"Zn2+":.1,"Cu2+":.01}],
] as const)check("Independent electrode E° remains its own role "+id,()=>expandedEcUnitCompile({id,question,family:"chem_electrochem",mode:"compile",kind:"cell",e0,n:2,q:10,activities}));
for(const [id,tail,e0,q] of [
 ["own-standard-1","if E°cell = 1.20 V",1.2,10],
 ["own-standard-2","where E°(cell) is 1.20 V",1.2,10],
 ["own-standard-3","given that standard emf = 1.20 V",1.2,10],
 ["own-standard-4","if the standard emf of the cell is 1.20 V",1.2,10],
 ["own-standard-5","when E°cell = 1.20 V and E°cell = 1.2 V",1.2,10],
] as const)check("Independent standard E° drives Nernst, never observed E "+id,()=>expandedEcUnitCompile({id,question:"Calculate the emf of Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu "+tail+".",family:"chem_electrochem",mode:"compile",kind:"cell",e0,n:2,q,activities:{"Zn2+":.1,"Cu2+":.01},statedE0:e0}));
for(const tail of ["E°cell = 1e- V","E°cell = 1.1 V; E°cell = 1.2 V","standard emf = unknown V","E°cell = 1.10 V; E°(Zn2+/Zn) = -0.76 V; E°(Cu2+/Cu) = 0.52 V"])check("Invalid/conflicting standard-cell potential cannot disappear: "+tail,()=>expandedEcUnitRefusal({id:tail,question:"Calculate the emf of Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. "+tail+".",family:"chem_electrochem",mode:"decline"}));

for(const [id,potentials] of [
 ["own-list-1","E° values of Sn2+/Sn and Pb2+/Pb are –0.20 V and –0.10 V respectively"],
 ["own-list-2","standard reduction potentials of Sn2+/Sn and Pb2+/Pb are –0.20 V and –0.10 V"],
 ["own-list-3","electrode potentials for Sn2+/Sn, Pb2+/Pb are 1e- V and -0.10 V"],
 ["own-list-4","standard potentials for Sn2+/Sn and Pb2+/Pb are -0.20 V and -0.10 V"],
 ["own-list-5","E° values of Sn2+/Sn and Pb2+/Pb are -0.20 V and unknown V"],
] as const)check("Independent unread stated list cannot use table E° "+id,()=>expandedEcUnitRefusal({id,question:"Calculate E°cell for Sn|Sn2+||Pb2+|Pb. "+potentials+".",family:"chem_electrochem",mode:"decline"}));
check("Complete Unicode-minus potential list uses both source values",()=>expandedEcUnitCompile({id:"own-list-positive",question:"Given E° values of Sn2+/Sn and Pb2+/Pb are −0.20 V and −0.10 V respectively, calculate E°cell for Sn|Sn2+||Pb2+|Pb.",family:"chem_electrochem",mode:"compile",kind:"cell",e0:.1,n:2,q:1,activities:{}}));

for(const [id,question,radiusPm] of [
 ["own-radius-1","Copper forms an fcc lattice with edge length 361 pm; the radius of a copper atom is 128 pm.",128],
 ["own-radius-2","In the fcc lattice, edge length is 361 pm and the radius of the copper atom is 128 pm.",128],
 ["own-radius-3","Draw an fcc unit cell: a = 361 pm; atomic radius = 128 pm.",128],
 ["own-radius-4","An fcc crystal has edge-length 361 pm; its metallic radius is 0.128 nm.",128],
 ["own-radius-5","An fcc unit cell has edge length 361 pm and radius of atom 128 pm.",128],
] as const)check("Independent given radius is never replaced with derived127.6 "+id,()=>{
 expandedEcUnitCompile({id,question,family:"chem_unit_cell",mode:"compile",edgePm:361,radiusPm});
 const direct=compiled(buildUnitCellScene(question,[],false));const caption=direct.document.annotations.map(a=>a.text??"").join(" ");assert.ok(caption.includes("r = 128 pm as given"));assert.ok(!caption.includes("127.6 pm"));
});
for(const radius of ["radius of a copper atom is unknown pm","radius = 1e- pm","radius is 128 pmfoo","radius = 128 pm; radius = 129 pm"])check("Unread/conflicting radius cannot be calculated from edge: "+radius,()=>expandedEcUnitRefusal({id:radius,question:"Draw an fcc unit cell with edge length 361 pm. Its "+radius+".",family:"chem_unit_cell",mode:"decline"}));
check("Gas pressure literal ownership remains separate from ion concentration",()=>expandedEcUnitCompile({id:"own-pressure-control",question:"Draw Zn|Zn2+(0.1 M)||H+(0.01 M)|H2(0.2 bar)|Pt at 298 K.",family:"chem_electrochem",mode:"compile",kind:"cell",e0:.76,n:2,q:200,activities:{"Zn2+":.1,"H+":.01,"H2":.2}}));
check("Lowercase E° source still owns its electrode role",()=>expandedEcUnitCompile({id:"own-electrode-lowercase-control",question:"Calculate the emf of Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu given e°(Zn2+/Zn) = -0.76 V and e°(Cu2+/Cu) = 0.52 V.",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.28,n:2,q:10,activities:{"Zn2+":.1,"Cu2+":.01}}));
for(const list of ["E° values of Sn2+/Sn, Pb2+/Pb and Ag+/Ag are -0.20 V and -0.10 V and 0.80 V", "E° values of Sn2+/Sn and Pb2+/Pb are -0.20 V and -0.10 V/s"])check("Continued or extra-couple list cannot partially bind: "+list,()=>expandedEcUnitRefusal({id:list,question:"Calculate E°cell for Sn|Sn2+||Pb2+|Pb. "+list+".",family:"chem_electrochem",mode:"decline"}));
// END PR137 expanded rereview: supplied cell activities and lattice givens.
const expandedEcUnitChallenges: readonly ExpandedEcUnitRow[] = [
  {
    "id": "independent-unit-cell-edge-1",
    "question": "An fcc crystal has a unit-cell edge length of 508 pm, whereas its cation radius is 110 pm. Determine the anion radius.",
    "sourceQuestionSha256": "84997c95d765c4d20f410386e206c8ff1d93307d392f664ca4d8bf9e70ca84d4",
    "family": "chem_unit_cell",
    "mode": "compile",
    "edgePm": 508,
    "radiusPm": 110
  },
  {
    "id": "independent-unit-cell-edge-2",
    "question": "For this fcc unit cell, the edge length (a) is 400 pm; the given atomic radius is 150 pm and the atomic mass is 60 g/mol. Find the density.",
    "sourceQuestionSha256": "7780df7c1c52c92263eec91d350b4b50db8dd662146db8c8472e637025bf7020",
    "family": "chem_unit_cell",
    "mode": "compile",
    "edgePm": 400,
    "radiusPm": 150,
    "densityGPerCm3": 6.2271670541348385
  },
  {
    "id": "independent-unit-cell-edge-3",
    "question": "The lattice parameter of the fcc crystal is 400 pm. Its radius is 150 pm. Draw the unit cell using the given lattice parameter.",
    "sourceQuestionSha256": "e386b947a91182ce186171b3d8fe16cff80399df7f104ed34e5b7d9e84fb2aad",
    "family": "chem_unit_cell",
    "mode": "decline",
    "edgePm": 400,
    "radiusPm": 150
  },
  {
    "id": "independent-ion-concentration-ownership-1",
    "question": "Find the emf at 298 K for a Daniell cell when the zinc ion concentration, [Zn^2+], is 0.1 M and the copper ion concentration, [Cu^2+], is 0.01 M.",
    "sourceQuestionSha256": "aa1bfe7788587dcc4fa252315e35e4310382a4c4c98454aae1330cee1106a1c0",
    "family": "chem_electrochem",
    "mode": "decline",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "independent-ion-concentration-ownership-2",
    "question": "For the Daniell cell at 298 K, Cu2+ has concentration 0.001 M while Zn2+ has concentration 0.1 M. Calculate the emf.",
    "sourceQuestionSha256": "6ca172993c25c2bc02fb4f2ee29ccc03e5a4d481c915e3830a3ae7163abf4fa4",
    "family": "chem_electrochem",
    "mode": "compile",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 100,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.001
    }
  },
  {
    "id": "independent-ion-concentration-ownership-3",
    "question": "Calculate the emf of Zn | Zn2+(10⁻¹ M) || Cu2+(0.01 M) | Cu at 298 K.",
    "sourceQuestionSha256": "b689f4f5e599b6357e0525f98b6165433b61e05c745a5392fe1ccc0d55478249",
    "family": "chem_electrochem",
    "mode": "decline",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "independent-electrode-versus-cell-potential-1",
    "question": "E°(Mg2+/Mg) = -2.37 V and E°(Cu2+/Cu) = +0.34 V are given. Find the emf of Mg | Mg2+(0.001 M) || Cu2+(0.0001 M) | Cu at 298 K.",
    "sourceQuestionSha256": "183fc2c756a110efff4c38567445f8c6d9e3330837a8cf06ec23c6056605aae5",
    "family": "chem_electrochem",
    "mode": "compile",
    "kind": "cell",
    "e0": 2.71,
    "n": 2,
    "q": 10,
    "activities": {
      "Mg2+": 0.001,
      "Cu2+": 0.0001
    }
  },
  {
    "id": "independent-electrode-versus-cell-potential-2",
    "question": "At 298 K, calculate the emf of Zn | Zn2+(0.1 M) || Cu2+(0.01 M) | Cu. The standard cell potential E°cell is 1.10 V.",
    "sourceQuestionSha256": "9f36874405df051027496c246055491a27b5b90ad9209e552713ae28e7afdba2",
    "family": "chem_electrochem",
    "mode": "compile",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    },
    "statedE0": 1.1
  },
  {
    "id": "independent-electrode-versus-cell-potential-3",
    "question": "Given the standard electrode potentials of zinc and copper, E°(Zn2+/Zn) = -0.76 V and E°(Cu2+/Cu) = +0.34 V, find the actual cell voltage for 0.1 M Zn2+ and 0.01 M Cu2+ at 298 K.",
    "sourceQuestionSha256": "18f39550753ed8b00784be999976fe5325402ebc224c73fb4a95c75d28dfa06d",
    "family": "chem_electrochem",
    "mode": "decline",
    "kind": "cell",
    "e0": 1.1,
    "n": 2,
    "q": 10,
    "activities": {
      "Zn2+": 0.1,
      "Cu2+": 0.01
    }
  },
  {
    "id": "independent-stated-potential-no-table-default-1",
    "question": "For Sn | Sn2+ || Pb2+ | Pb, the E° values of Sn2+/Sn and Pb2+/Pb are –0.20 V and –0.10 V. Calculate the standard emf.",
    "sourceQuestionSha256": "5ec6ca3119c11f1e8fdfdb9c6db3b33db1fe3d097dacf0f8698089e3272aae55",
    "family": "chem_electrochem",
    "mode": "decline",
    "kind": "cell",
    "e0": 0.1,
    "n": 2,
    "q": 1,
    "activities": {}
  },
  {
    "id": "independent-stated-potential-no-table-default-2",
    "question": "The standard potentials are E°(Sn2+/Sn) = -0.20 V and E°(Pb2+/Pb) = -0.10 V. Calculate E°cell for Sn | Sn2+ || Pb2+ | Pb.",
    "sourceQuestionSha256": "d383455557280a81a3c81454680edad09fed80f14fdb1549add1b396d499ce51",
    "family": "chem_electrochem",
    "mode": "compile",
    "kind": "cell",
    "e0": 0.1,
    "n": 2,
    "q": 1,
    "activities": {}
  },
  {
    "id": "independent-stated-potential-no-table-default-3",
    "question": "Calculate E°cell of Sn | Sn2+ || Pb2+ | Pb, given E°(Sn2+/Sn) = unknown and E°(Pb2+/Pb) = -0.10 V.",
    "sourceQuestionSha256": "268e3c924bbab61f9d1d79a9f1533239742396273a6a39aeb4bee0204e03567d",
    "family": "chem_electrochem",
    "mode": "decline",
    "kind": "cell",
    "e0": 0.1,
    "n": 2,
    "q": 1,
    "activities": {}
  }
];
for(const row of expandedEcUnitChallenges)check("Independent reviewer source challenge "+row.id,()=>row.mode==="compile"?expandedEcUnitCompile(row):expandedEcUnitRefusal(row));
// BEGIN PR137 explicit-owner refusal addendum; append after the preserved259 block.
for(const tail of [
 "Edge length = unknown pm; edge length = 400 pm; atomic radius = 150 pm.",
 "Edge length = 400 pm; edge length = unknown pm; atomic radius = 150 pm.",
 "Edge length = unreadable pm; edge length = 400 pm; atomic radius = 150 pm.",
 "Edge length is unknown; edge length is 400 pm; atomic radius is 150 pm.",
 "Edge length is 400 pm; edge length is unreadable; atomic radius is 150 pm.",
])check("Every declared edge is validated before a valid repeat: "+tail,()=>expandedEcUnitRefusal({id:tail,question:"Draw an fcc unit cell. "+tail,family:"chem_unit_cell",mode:"decline"}));
for(const tail of [
 "Atomic radius = unknown pm; atomic radius = 128 pm; edge length = 361 pm.",
 "Atomic radius = 128 pm; atomic radius = unknown pm; edge length = 361 pm.",
 "Radius of a copper atom is unreadable pm; atomic radius is 128 pm; edge length is 361 pm.",
 "Radius is unknown; radius is 128 pm; edge length is 361 pm.",
 "Radius is 128 pm; radius is unreadable; edge length is 361 pm.",
])check("Every declared radius is validated before a valid repeat: "+tail,()=>expandedEcUnitRefusal({id:tail,question:"Draw an fcc unit cell. "+tail,family:"chem_unit_cell",mode:"decline"}));
for(const tail of [
 "Zn2+ at 0.1 kg; Cu2+ = 0.01 M.",
 "Zn2+ of 0.1 kg; Cu2+ = 0.01 M.",
 "Zn+2 = 0.1 kg; Cu2+ = 0.01 M.",
 "0.1 kg Zn2+ and Cu2+ = 0.01 M.",
 "0.1 kgfoo Zn2+ and Cu2+ = 0.01 M.",
 "Zn2+ concentration = unreadable M; Zn2+ concentration = 0.1 M; Cu2+ = 0.01 M.",
 "Zn2+ concentration = 0.1 M; Zn2+ concentration = unreadable M; Cu2+ = 0.01 M.",
 "Zn2+ at unknown; Zn2+ at 0.1 M; Cu2+ = 0.01 M.",
 "Zn2+ at 0.1 M; Zn2+ at unknown; Cu2+ = 0.01 M.",
 "Zn2+ concentration is unknown; Zn2+ concentration is 0.1 M; Cu2+ = 0.01 M.",
 "Zn2+ concentration is 0.1 M; Zn2+ concentration is unknown; Cu2+ = 0.01 M.",
])check("Every declared ion activity is validated before a valid repeat: "+tail,()=>expandedEcUnitRefusal({id:tail,question:"Calculate the emf of a Daniell cell at 298 K. "+tail,family:"chem_electrochem",mode:"decline"}));
for(const tail of [
 "standard emf = unknown V.",
 "E°cell = 1.10 V; E°cell = 1.20 V.",
 "E°cell = 1.10 V; E°(Zn2+/Zn) = -0.76 V; E°(Cu2+/Cu) = 0.52 V.",
 "Temperature is 310 K; temperature is 315 K.",
 "Temperature is unknown K; temperature is 310 K.",
 "E°cell = 1e- V.",
])check("Refused numeric cell cannot become a generic schematic: "+tail,()=>expandedEcUnitRefusal({id:tail,question:"Draw the galvanic cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu with its salt bridge. "+tail,family:"chem_electrochem",mode:"decline"}));
check("Electron coefficient remains a half-reaction coefficient, not concentration",()=>{
 const question="Draw the galvanic cell from Zn2+ + 2e- → Zn, E° = -0.76 V and Cu2+ + 2e- → Cu, E° = 0.34 V.";
 const spec=parseCellNotation(question);assert.ok(spec);near(spec.anode.e0,-.76);near(spec.cathode.e0,.34);near(cellEmf(spec)?.e0,1.1);assert.deepEqual(spec.anode.concentrations,{});assert.deepEqual(spec.cathode.concentrations,{});compiled(buildElectrochemScene(question,[],false));
});
check("Genuine generic schematic without supplied numerical owners still compiles",()=>{
 const question="Draw a galvanic cell with its salt bridge, anode and cathode.";
 assert.equal(parseCellNotation(question),null);const result=compiled(buildElectrochemScene(question,[],true));assert.ok(result.labels.includes("M")&&result.labels.includes("N"));assert.ok(!result.document.quantities.some(q=>q.id==="E_cell"||q.id==="E0_cell"));
});
check("Original scalar aliases remain bound to their same edge and radius",()=>expandedEcUnitCompile({id:"unit-alias-owner-control",question:"An fcc metal has edge length, a = 400 pm and the radius r = 150 pm.",family:"chem_unit_cell",mode:"compile",edgePm:400,radiusPm:150}));
// END PR137 explicit-owner refusal addendum.
for(const question of [
 "Draw the cell Zn | Zn2+(0.1 M) || Cu2+(0.01 M) | Cu at 310 K. Temperature is 310 K.",
 "Draw the cell Zn | Zn2+(0.1 M) || Cu2+(0.01 M) | Cu at 310 K.",
])check("Exact laneD temperature wordings retain numeric310K authority: "+question,()=>{
 const spec=parseCellNotation(question);assert.ok(spec);near(spec.temperatureK,310);near(cellEmf(spec)?.factor,.06151);near(cellEmf(spec)?.q,10);near(cellEmf(spec)?.e,1.0692);
 near(compiled(buildElectrochemScene(question,[],false)).document.quantities.find(q=>q.id==="E_cell")?.value,1.0692);
 const ordinary=synthesizeFamilyScene({question});assert.ok(ordinary?.renderScene);assert.equal(ordinary.family,"chem_electrochem");near(ordinary.document.quantities.find(q=>q.id==="E_cell")?.value,1.0692);
});
check("Exact me-confirm copper density preserves original128pm radius",()=>expandedEcUnitCompile({id:"me-confirm-1",question:"Copper crystallises in an fcc lattice with edge length 361 pm; the radius of a copper atom is 128 pm. Calculate its density (M = 63.5 g/mol).",family:"chem_unit_cell",mode:"compile",edgePm:361,radiusPm:128,densityGPerCm3:4*63.5/((361e-10)**3*6.022e23)}));

// BEGIN PR137 comma-separated supplied declarations: preserve each original owner.
for(const declaration of [
 "Edge length, unknown pm; edge length is 400 pm; atomic radius is 150 pm.",
 "Edge length is 400 pm; edge length, unknown pm; atomic radius is 150 pm.",
 "Atomic radius, unreadable pm; atomic radius is 150 pm; edge length is 400 pm.",
 "Atomic radius is 150 pm; atomic radius, unreadable pm; edge length is 400 pm.",
 "Edge length, 1e- pm; edge length is 400 pm; atomic radius is 150 pm.",
])check("Comma-separated damaged measurement cannot hide beside a good repeat: "+declaration,()=>expandedEcUnitRefusal({id:declaration,question:"Draw an fcc unit cell. "+declaration,family:"chem_unit_cell",mode:"decline"}));
for(const [question,edgePm,radiusPm] of [
 ["Draw an fcc unit cell with edge length 400 pm. Calculate its atomic radius, and explain the relation.",400,Math.SQRT2*400/4],
 ["Draw an fcc unit cell with atomic radius 150 pm. Calculate its edge length, and explain the relation.",4*150/Math.SQRT2,150],
 ["A bcc unit cell has edge length 400 pm. Find its atomic radius, then explain the body diagonal.",400,Math.sqrt(3)*400/4],
] as const)check("Requested measurement punctuation does not declare a scalar: "+question,()=>{
 const direct=compiled(buildUnitCellScene(question,[],false));const ordinary=synthesizeFamilyScene({question});assert.ok(ordinary?.renderScene);assert.equal(ordinary.family,"chem_unit_cell");
 for(const document of [direct.document,ordinary.document]){
  near(document.quantities.find(q=>q.id.endsWith("_a"))?.value,Number(edgePm.toFixed(6)));
  near(document.quantities.find(q=>q.id.endsWith("_r"))?.value,Number(radiusPm.toFixed(6)));
 }
});
// END PR137 comma-separated supplied declarations.
// BEGIN EC v5: independent source-role and complete-phase controls.
const ecV5Activities = {"Zn2+":.1,"Cu2+":.01} as const;
for(const [id,tail] of [
 ["standard-role-v5-1","standard emf = 1.10 V"],
 ["standard-role-v5-2","the standard emf of the cell is 1.10 V"],
 ["standard-role-v5-3","standard cell potential: 1.10 V"],
 ["standard-role-v5-4","E°cell = 1.10 V"],
 ["standard-role-v5-5","E°(cell) is 1.10 V"],
] as const)check("Complete standard-cell owner never becomes observed E "+id,()=>expandedEcUnitCompile({id,question:"Calculate the emf of Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu at 298 K. Given "+tail+".",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities,statedE0:1.1}));
for(const [id,given] of [
 ["observed-role-v5-1","E°cell = 1.10 V. The emf is 1.13 V"],
 ["observed-role-v5-2","standard emf = 1.10 V; observed cell potential = 1.13 V"],
 ["observed-role-v5-3","E°cell = 1.10 V. The voltage: 1.13 V"],
 ["observed-role-v5-4","standard emf is 1.10 V. The emf measured as 1.13 V"],
 ["observed-role-v5-5","E°cell = 1.10 V. The voltage of the cell measured to be 1.13 V"],
] as const)check("Independent observed emf retains source role beside standard E° "+id,()=>expandedEcUnitCompile({id,question:"Draw Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu at 298 K. "+given+".",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities,statedE0:1.1,observedE:1.13}));
for(const phase of ["Zn2+(0.1 M)x","Zn2+(0.1 M)2","Zn2+(0.1 M)⁺","Zn2+(0.1 M)^2","Zn2+(0.1 M)/s"])check("Attached original phase continuation is not a complete ion activity: "+phase,()=>expandedEcUnitRefusal({id:phase,question:"Draw the galvanic cell Zn|"+phase+"||Cu2+(0.01 M)|Cu with its salt bridge at 298 K.",family:"chem_electrochem",mode:"decline"}));
for(const [id,zinc,copper] of [
 ["phase-owner-v5-1","Zn2+(0.1 M)","Cu2+(0.01 M)"],
 ["phase-owner-v5-2","Zn2+(aq, 0.1 M)","Cu2+(aq, 0.01 M)"],
 ["phase-owner-v5-3","Zn2+(0.1 molar)","Cu2+(0.01 molar)"],
 ["phase-owner-v5-4","Zn2+(0.1 mol L-1)","Cu2+(0.01 mol/L)"],
 ["phase-owner-v5-5","Zn2+(10^(-1) M)","Cu2+(10^(-2) M)"],
] as const)check("Complete original phase preserves existing source scalar and unit grammar "+id,()=>expandedEcUnitCompile({id,question:"Calculate the emf of the cell Zn|"+zinc+"||"+copper+"|Cu at 298 K.",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities}));
for(const [id,tail] of [
 ["requested-ion-v5-1","where [Zn2+] is 0.1 M and [Cu2+] is 0.01 M"],
 ["requested-ion-v5-2","if [Cu2+]=0.01M and [Zn2+]=0.1M"],
 ["requested-ion-v5-3","with 0.01 M Cu2+ and 0.1 M Zn2+"],
 ["requested-ion-v5-4","for Zn2+ = 10^-1 M and Cu2+ = 10^-2 M"],
 ["requested-ion-v5-5","when Zn2+ is 0.1 molar and Cu2+ is 0.01 mol L-1"],
] as const)check("Requested emf does not own a following ion assignment "+id,()=>expandedEcUnitCompile({id,question:"Calculate the emf of a Daniell cell at 298 K "+tail+".",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities}));
for(const tail of [
 "Zn2+ = xyz; Zn2+ = 0.1 M; Cu2+ = 0.01 M",
 "Zn2+ = . M; Zn2+ = 0.1 M; Cu2+ = 0.01 M",
 "Cu2+ = 0.01 M; Zn2+ at unreadable; Zn2+ = 0.1 M",
 "Zn2+ concentration is unknown; Cu2+ = 0.01 M; Zn2+ = 0.1 M",
 "Zn2+ = 0.1 M; Cu2+ = . M; Cu2+ = 0.01 M",
])check("Explicit ion assignment damage cannot hide beside good repeats: "+tail,()=>expandedEcUnitRefusal({id:tail,question:"Calculate the emf of a Daniell cell at 298 K. "+tail+".",family:"chem_electrochem",mode:"decline"}));
for(const heading of [
 "Calculate emf of the following cell at 298 K: ",
 "Find the cell potential at 298 K: ",
 "Find voltage of this cell at 298 K: ",
 "Determine emf for the cell at 298 K: ",
 "Calculate the potential of the cell at 298 K: ",
])check("Question heading colon before notation never declares a voltage: "+heading,()=>expandedEcUnitCompile({id:heading,question:heading+"Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu. E°cell = 1.10 V.",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities,statedE0:1.1}));
for(const observed of ["emf is unknown V","voltage = 1e- V","cell potential: 1.13 Vfoo","emf = 1.13 V/s","emf = 1.13 V; emf = 1.14 V"])check("Genuine observed voltage owner cannot disappear into standard E°: "+observed,()=>expandedEcUnitRefusal({id:observed,question:"Draw the galvanic cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu with its salt bridge at 298 K. E°cell = 1.10 V. The "+observed+".",family:"chem_electrochem",mode:"decline"}));
// END EC v5 source-role and complete-phase controls.

// Independent reviewer: standard owner immediately before temperature uses its role.
check("Independent prose standard emf before temperature never becomes observed E",()=>expandedEcUnitCompile({id:"reviewer-standard-before-temperature",question:"For Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu, the standard emf of the cell is 1.10 V at 298 K. Calculate the emf.",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities,statedE0:1.1}));
check("Independent observed E remains distinct beside standard emf before temperature",()=>expandedEcUnitCompile({id:"reviewer-standard-observed-before-temperature",question:"For Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu, the standard emf of the cell is 1.10 V at 298 K. The observed emf is 1.13 V. Draw the cell.",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities,statedE0:1.1,observedE:1.13}));

// BEGIN EC v6: shortened observed fallback cannot discard symbolic E° owners.
for(const [id,given,e0,statedE0] of [
 ["symbolic-owner-v6-1","E°cell = 1.10 V",1.1,1.1],
 ["symbolic-owner-v6-2","E°(cell) is 1.10 V",1.1,1.1],
 ["symbolic-owner-v6-3","E₀cell = 1.10 V",1.1,1.1],
 ["symbolic-owner-v6-4","E°(Cu2+/Cu) = 0.34 V",1.1,undefined],
 ["symbolic-owner-v6-5","the standard cell potential is 1.20 V",1.2,1.2],
] as const)check("Original symbolic/prose standard owner survives before temperature "+id,()=>expandedEcUnitCompile({id,question:"For Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu, "+given+" at 298 K. Calculate the emf.",family:"chem_electrochem",mode:"compile",kind:"cell",e0,n:2,q:10,activities:ecV5Activities,statedE0}));
for(const [id,given,e0,statedE0] of [
 ["distinct-observed-v6-1","E°cell = 1.10 V",1.1,1.1],
 ["distinct-observed-v6-2","E°(cell) is 1.10 V",1.1,1.1],
 ["distinct-observed-v6-3","E₀cell = 1.10 V",1.1,1.1],
 ["distinct-observed-v6-4","E°(Cu2+/Cu) = 0.34 V",1.1,undefined],
 ["distinct-observed-v6-5","the standard cell potential is 1.20 V",1.2,1.2],
] as const)check("Genuine observed owner has a distinct source span from standard E° "+id,()=>expandedEcUnitCompile({id,question:"For Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu, "+given+" at 298 K. The observed emf is 1.13 V. Draw the cell.",family:"chem_electrochem",mode:"compile",kind:"cell",e0,n:2,q:10,activities:ecV5Activities,statedE0,observedE:1.13}));
// END EC v6 standard-span controls.

// BEGIN EC v7: agreeing repeated electrode values retain every original source owner.
const ecV7RepeatedStandards = [
 ["repeat-owner-v7-1","E°(Cu2+/Cu) = 0.34 V. E°(Cu2+/Cu) = 0.34 V",undefined],
 ["repeat-owner-v7-2","E°(Zn2+/Zn) is -0.76 V. E°(Zn2+/Zn) is -0.76 V",undefined],
 ["repeat-owner-v7-3","E° Cu2+/Cu = 0.34 V. E° Cu2+/Cu = 0.34 V",undefined],
 ["repeat-owner-v7-4","E°cell = 1.10 V. E°cell = 1.10 V",1.1],
 ["repeat-owner-v7-5","Cu2+ + 2e- → Cu, E° = 0.34 V. Cu2+ + 2e- → Cu, E° = 0.34 V",undefined],
] as const;
for(const [id,given,statedE0] of ecV7RepeatedStandards)check("Every agreeing repeated E° assignment owns its own source span "+id,()=>expandedEcUnitCompile({id,question:"For Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu, "+given+" at 298 K. Calculate the emf.",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities,statedE0}));
for(const [id,given,statedE0] of ecV7RepeatedStandards)check("Distinct observed emf survives agreeing repeated E° owners "+id,()=>expandedEcUnitCompile({id,question:"For Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu, "+given+" at 298 K. The observed emf is 1.13 V. Draw the cell.",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities,statedE0,observedE:1.13}));
// END EC v7 original-repeat owner controls.

// BEGIN EC v8: every supplied observed owner is read or refused, including repeats.
for(const tail of [
 "the emf is 1.13 V; the emf measured as 1.14 V",
 "the emf measured as unknown V",
 "the voltage measured to be 1e- V",
 "the cell potential is 1.13 V; the cell potential is measured as unreadable V",
 "the voltage is measured to be 1.13 V/s",
])check("Measured observed owner cannot disappear after a valid reading: "+tail,()=>expandedEcUnitRefusal({id:tail,question:"Draw the galvanic cell Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu with its salt bridge at 298 K. E°cell = 1.10 V. "+tail+".",family:"chem_electrochem",mode:"decline"}));
for(const tail of [
 "the emf is 1.13 V; the emf measured as 1.13 V",
 "the emf is measured as 1.13 V",
 "the voltage is measured to be 1.13 V",
 "the cell potential measured as 1.13 V; the emf is 1.13 V",
 "the voltage measured to be 1.13 V; the voltage is 1.13 V",
])check("Genuine agreeing measured observed owners retain separate E° authority: "+tail,()=>expandedEcUnitCompile({id:tail,question:"Draw Zn|Zn2+(0.1 M)||Cu2+(0.01 M)|Cu at 298 K. E°cell = 1.10 V. "+tail+".",family:"chem_electrochem",mode:"compile",kind:"cell",e0:1.1,n:2,q:10,activities:ecV5Activities,statedE0:1.1,observedE:1.13}));
// END EC v8 observed-source consistency controls.
const output=process.argv.indexOf("--out");
const result={passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,rows};
if(output>=0)writeFileSync(process.argv[output+1]!,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({passed:result.passed,failed:result.failed}));
process.exitCode=result.failed?1:0;
