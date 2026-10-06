import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as E from '@heytutor/scene-engine';
import {selectVerifiedRepresentation as select} from '../../features/tutor-session/lib/scene/representationFallback';
import {liveSceneSaveFailure as live} from '../../lib/scene/sceneSaveAdmission';
const out='/Users/kaizen/heytutor-claude-coord/reviews/w2-matrix-selection-fix-20261006';
const a=JSON.parse(readFileSync(new URL('../../../../packages/scene-engine/fixtures/matrix-products-live-20261006/actual-runtime.json',import.meta.url),'utf8'));
const prepared=E.prepareMatrixProductSourceAuthority(a.question,a.plan,a.problemIR)!;
const results=[];
for(const variant of ['control','noIR','noPlan','missingDependency','missingGiven','extraGraph','extraChannel','emptyRefusalPlan','omittedRequiredRaw'] as const){
 const plan=structuredClone(prepared.plan),ir=structuredClone(a.problemIR),doc=structuredClone(prepared.document);
 if(variant==='missingDependency')delete plan.derived[0].dependsOn;
 if(variant==='missingGiven')plan.givens.shift();
 if(variant==='extraGraph')ir.expressions.push({id:'unconsumed',valueType:'scalar',root:{kind:'number',value:99},evidenceFactIds:[ir.facts[0].id]});
 if(variant==='extraChannel')ir.hiddenAsk='determinant A';
 if(variant==='emptyRefusalPlan'){plan.givens=[];plan.derived=[];plan.unknowns=[];plan.qualitativeClaims=[];plan.lawIds=[];plan.assumptions=[];}
 if(variant==='omittedRequiredRaw')doc.requiredEntityIds.pop();
 const p=variant==='noPlan'?null:plan,problem=variant==='noIR'||variant==='emptyRefusalPlan'?null:ir;
 const rawCompile=E.compileSceneDocument(doc,{sourceAuthority:{question:a.question,problemIR:problem,turnPlan:p}});
 const bare=E.compileSceneDocument(doc);
 const selected=select({question:a.question,turnPlan:p,problemIR:problem,exact:variant==='omittedRequiredRaw'?{sceneDocument:doc,renderScene:bare.renderScene!,validationReport:bare.report}:null});
 const result={variant,strictCompiled:rawCompile.ok,selectedTier:selected.tier,selectedEntities:selected.sceneDocument.entities.map(e=>e.label),selectedPrimitives:selected.renderScene.primitives.length,selectedReason:selected.reason,selectedCentral:E.validateSceneSourceAuthority(selected.sceneDocument,a.question,problem,p).map(i=>i.code),liveFailure:live({document:selected.sceneDocument,question:a.question,problemIR:problem,turnPlan:p,tier:selected.tier})};
 if(variant==='control')assert(rawCompile.ok);
 else assert.equal(rawCompile.ok,false,`${variant}: strict source context rejects`);
 if(['missingDependency','extraChannel','emptyRefusalPlan'].includes(variant)){
  assert.equal(selected.renderScene.primitives.length,0,`${variant}: whole caller refusal produces no selected diagram`);
 }
 if(variant==='missingGiven')assert.equal(selected.renderScene.primitives.length,0,'missing given still rejected by existing plan validator');
 results.push(result);
}
writeFileSync(`${out}/selection-${process.argv.includes('--esm')?'esm':'source'}.json`,JSON.stringify(results,null,2));
console.log(`PASS ${results.length} complete matrix caller selection controls and negatives`);
