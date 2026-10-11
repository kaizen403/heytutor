/** PR137 public-source regressions at real family and ordinary compiler seams. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { kineticsFromStem, solveKinetics, buildKineticsScene } from "../../src/chemistry/kinetics";
import { parseCellNotation, cellEmf, buildElectrochemScene } from "../../src/chemistry/electrochemistry";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { readChemistryArrheniusEquation, parseChemistryScalar, readChemistryQuantity, chemistryCanonicalValuesAgree } from "../../src/chemistry/quantityReader";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

import { buildUnitCellScene } from "../../src/chemistry/unitCell";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { buildChemicalThermodynamicsScene } from "../../src/chemistry/chemicalThermodynamics";
import type { ChemPlanQuantity } from "../../src/chemistry/sceneKit";

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

const output=process.argv.indexOf("--out");
const result={passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,rows};
if(output>=0)writeFileSync(process.argv[output+1]!,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({passed:result.passed,failed:result.failed}));
process.exitCode=result.failed?1:0;
