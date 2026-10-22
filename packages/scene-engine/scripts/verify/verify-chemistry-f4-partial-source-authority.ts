/** An absent datum is symbolic, not an invented number; unused temperature
 * defaults cannot become an actual nonstandard cell voltage. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { generatorFor } from "../../src/archetypes/generators";
import { detectArchetype } from "../../src/archetypes/detect";
import { buildElectrochemScene, parseCellNotation } from "../../src/chemistry/electrochemistry";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene,synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import fixtures from "./fixtures/chemistry-f4-partial-source-authority.json";
import temperatures from "./fixtures/chemistry-f4-temperature-role-boundaries.json";
const results=fixtures.map(gold=>{try{
 const publicDocs=[synthesizeFamilyScene({question:gold.question})?.document,synthesizeLastResortScene({question:gold.question})?.document];
 if(gold.group==='photo'){
  const source=readRadiationSource(gold.question);assert.equal(source.status,gold.draw?'symbolic':'declined');
  const match=detectArchetype(gold.question,{plannerArchetype:'photoelectric'});assert.ok(match);
  for(const stale of [false,true]){
   const document=generatorFor('photoelectric')!({question:gold.question,slots:stale?{...match.slots,workFunction:9,photonEnergy:999,lambda:1}:match.slots,sources:stale?{...match.sources,workFunction:'stem',photonEnergy:'stem',lambda:'stem'}:match.sources,quantities:[],schematic:true});
   assert.equal(!!document,gold.draw);
   for(const doc of [document,...publicDocs])if(doc){
    const c=compileSceneDocument(doc);assert.ok(c.ok&&c.renderScene);assert.equal(doc.source.question,gold.question);
    assert.equal(doc.source.nonMetric,true);
    const E=doc.quantities.find(q=>q.symbol==='E');assert.ok(E&&typeof E.value==='number'&&'photonEnergyEV'in gold);assert.equal(E.value,Number(gold.photonEnergyEV!.toFixed(6)));
    assert.ok(!doc.quantities.some(q=>q.symbol==='phi'||q.symbol==='K'));
    const text=c.renderScene.primitives.flatMap(p=>p.text?[p.text]:[]).join(' ');assert.ok(text.includes('if hν > φ')&&text.includes('φ not given'));
   }
  }
 }else{
  const direct=buildElectrochemScene(gold.question,[],false);
  for(const doc of [direct,...publicDocs]){
   assert.equal(!!doc,gold.draw);if(!doc)continue;const c=compileSceneDocument(doc);assert.ok(c.ok&&c.renderScene);
   const E=doc.quantities.find(q=>q.id==='E_cell');
   if('expectedE'in gold&&gold.expectedE!==null){assert.ok(E&&typeof E.value==='number');assert.ok(Math.abs(E.value-gold.expectedE!)<1e-10);}
   else{assert.equal(E,undefined);const text=c.renderScene.primitives.flatMap(p=>p.text?[p.text]:[]).join(' ')+JSON.stringify(doc.annotations);assert.ok(!/E = 1\.07|Nernst:/.test(text));}
  }
 }
 return{id:gold.id,passed:true};
}catch(error){return{id:gold.id,passed:false,error:String(error)};}});
for(const gold of temperatures){try{const spec=parseCellNotation(gold.question);assert.equal(!!spec,"valid"in gold?gold.valid:true);if(spec)assert.equal(spec.temperatureK,undefined);results.push({id:gold.id,passed:true});}catch(error){results.push({id:gold.id,passed:false,error:String(error)});}}
const report={passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};if(process.argv.includes('--out'))writeFileSync(process.argv[process.argv.indexOf('--out')+1]!,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
