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

const output=process.argv.indexOf("--out");
const result={passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,rows};
if(output>=0)writeFileSync(process.argv[output+1]!,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({passed:result.passed,failed:result.failed}));
process.exitCode=result.failed?1:0;
