/** Original E/K/stopping-voltage declarations stay in the verified picture. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { chemistryQuantityInventoryOwned } from "../../src/chemistry/quantityReader";
import { generatorFor } from "../../src/archetypes/generators";
import { detectArchetype } from "../../src/archetypes/detect";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene,synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import fixture from "./fixtures/chemistry-f4-photoelectron-source-inventory.json";
interface Gold{id:string;question:string;draw:boolean;E?:number|null;K?:number|null;Vstop?:number|null;numericPhi?:boolean}
const results=(fixture as Gold[]).map(gold=>{try{
 const source=readRadiationSource(gold.question);
 const match=detectArchetype(gold.question,{plannerArchetype:'photoelectric'});assert.ok(match);
 const document=generatorFor('photoelectric')!({question:gold.question,slots:{...match.slots,workFunction:99,photonEnergy:888,lambda:1},sources:{...match.sources,workFunction:'stem',photonEnergy:'stem',lambda:'stem'},quantities:[],schematic:true});
 const docs=[document,synthesizeFamilyScene({question:gold.question})?.document,synthesizeLastResortScene({question:gold.question})?.document];
 for(const doc of docs){assert.equal(!!doc,gold.draw);if(!doc)continue;const c=compileSceneDocument(doc);assert.ok(c.ok&&c.renderScene);const text=c.renderScene.primitives.flatMap(p=>p.text?[p.text]:[]).join(' ');
  assert.equal(doc.source.question,gold.question);const quantity=(symbol:string)=>doc.quantities.find(q=>q.symbol===symbol);
  if(gold.E==null)assert.equal(quantity('E'),undefined);else assert.equal(quantity('E')?.value,Number(gold.E.toFixed(6)));
  if(gold.K==null)assert.equal(quantity('K'),undefined);else{assert.equal(quantity('K')?.value,gold.K);assert.ok(text.includes(`K=${gold.K}`));}
  if(gold.Vstop!=null){assert.equal(quantity('Vstop')?.value,gold.Vstop);assert.ok(text.includes(`Vstop=${gold.Vstop}`));}
  if(!gold.numericPhi)assert.equal(quantity('phi'),undefined);
 }
 if(gold.draw){assert.ok(source.status==='source'||source.status==='symbolic');const bindings=source.status==='source'?source.model.bindings:source.bindings;
  if(gold.E!=null){const energy=source.status==='source'&&source.model.kind==='photoelectric'?source.model.photonEnergyEV:source.status==='symbolic'&&source.missing==='work_function'?source.photonEnergyEV:null;assert.ok(energy!==null&&Math.abs(energy-gold.E)<1e-12,'unrounded source energy');}
  assert.ok(chemistryQuantityInventoryOwned(gold.question,'energy',bindings.filter(b=>b.reading.dimension==='energy').map(b=>({reading:b.reading,owner:b.role}))));
  for(const b of bindings)assert.equal(gold.question.slice(b.reading.source.span.start,b.reading.source.span.end),b.reading.source.text);
 }else assert.equal(source.status,'declined');
 return{id:gold.id,passed:true};
}catch(error){return{id:gold.id,passed:false,error:String(error)};}});
const report={passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};if(process.argv.includes('--out'))writeFileSync(process.argv[process.argv.indexOf('--out')+1]!,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;
