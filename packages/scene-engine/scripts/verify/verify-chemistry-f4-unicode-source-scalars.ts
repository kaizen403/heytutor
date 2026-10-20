/** Complete source spans, never mantissa prefixes or normalized shadow text. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { parseChemistryScalar, readChemistryLiteral, readChemistryQuantity, readChemistryQuantityDeclaration } from "../../src/chemistry/quantityReader";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import golds from "./fixtures/chemistry-f4-unicode-source-scalars.json";
import prefixes from "./fixtures/chemistry-f4-unicode-prefix-tails.json";
const results = golds.map(gold=>{try{
  const question=`The work function is ${gold.literal}; incident wavelength is 400 nm.`;
  const start=question.indexOf(gold.literal),end=start+gold.literal.length;
  const declaration=readChemistryQuantityDeclaration({question,after:/work function/,dimension:"energy",targetUnit:"J",owner:"work function"});
  const literal=readChemistryLiteral({question,scalarSpan:{start,end:start+gold.literal.indexOf(" J")},dimension:"energy",targetUnit:"J"});
  assert.equal(declaration.state==="valid",gold.valid);assert.equal(literal.ok,gold.valid);
  if(gold.valid && declaration.state==="valid" && literal.ok && "value" in gold){
    assert.ok(Math.abs(declaration.reading.value/gold.value!-1)<1e-12);
    assert.deepEqual(declaration.reading.source.span,{start,end});assert.equal(declaration.reading.source.text,gold.literal);
    assert.equal(literal.reading.value,declaration.reading.value);
  }
  const chopped=readChemistryLiteral({question,scalarSpan:{start,end:start+gold.literal.indexOf(" J")},within:{start,end:start+gold.literal.indexOf(" J")},dimension:"energy",targetUnit:"J"});
  assert.equal(chopped.ok,false,"unit cannot be silently lost from closed literal");
  if(gold.literal.startsWith("10"))assert.equal(parseChemistryScalar(question,{start,end:start+2}).ok,false,"originaltail prevents prefix10");
  if(gold.id==="valid-0" || gold.id==="valid-1"){
    const source=readRadiationSource(question);assert.ok(source.status==="source" && source.model.kind==="photoelectric");
    assert.ok(Math.abs(source.model.workFunctionEV-1.997282903827444)<1e-12);
    assert.ok(Math.abs(source.model.photonEnergyEV-3.0996049608300065)<1e-12);
    for(const result of [synthesizeFamilyScene({question}),synthesizeLastResortScene({question})]){
      assert.ok(result);assert.equal(result.document.source.question,question);const c=compileSceneDocument(result.document);assert.ok(c.ok&&c.renderScene);
      assert.ok(result.document.quantities.some(q=>q.symbol==="phi" && typeof q.value==="number" && Math.abs(q.value-1.997283)<1e-12));
    }
  }
  return{id:gold.id,passed:true};
}catch(error){return{id:gold.id,passed:false,error:String(error)};}});
for(const [question,dimension,targetUnit,value] of [["Ksp = 10⁻¹⁰","dimensionless","1",1e-10],["amount = 2 × 10⁻³ mol","amount","mol",.002]] as const){
 try{const d=readChemistryQuantityDeclaration({question,after:/Ksp|amount/,dimension,targetUnit,owner:"quantity"});assert.ok(d.state==="valid");assert.ok(Math.abs(d.reading.value/value-1)<1e-12);results.push({id:question,passed:true});}catch(error){results.push({id:question,passed:false,error:String(error)});}
}
for(const gold of prefixes){try{
 const input={question:gold.question,after:/K\s*=/,dimension:"dimensionless" as const};
 const start=gold.question.indexOf("3.2"),scalarSpan={start,end:start+3};
 assert.equal(readChemistryQuantity(input).ok,false);assert.equal(readChemistryQuantityDeclaration({...input,owner:"K"}).state,"invalid");
 assert.equal(parseChemistryScalar(gold.question,scalarSpan).ok,false);assert.equal(readChemistryLiteral({...input,scalarSpan}).ok,false);
 assert.equal(readChemistryQuantity({...input,within:{start:0,end:scalarSpan.end}}).ok,false);
 results.push({id:gold.id,passed:true});
}catch(error){results.push({id:gold.id,passed:false,error:String(error)});}}
const report={passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
if(process.argv.includes("--out"))writeFileSync(process.argv[process.argv.indexOf("--out")+1]!,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
