/** Dormant public API contracts; no live/capture/storage or original-oracle acceptance. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  buildSourceBoundNeutralComparison, prepareNeutralComparison,
  prepareSourceBoundChemistryStructure, compileSceneDocument,
  type SceneDocument, type RenderScene,
} from "../../src/index";

const rows:Array<{id:string;passed:boolean;error?:string}>=[];
function check(id:string,fn:()=>void):void {
  try { fn();rows.push({id,passed:true}); }
  catch(error){rows.push({id,passed:false,error:String(error)});}
}
function source(question:string) {
  const result=buildSourceBoundNeutralComparison({originalQuestion:question});
  assert.equal(result.status,"verified",JSON.stringify(result));
  assert.ok(result.status==="verified");
  const ordinary=compileSceneDocument(result.document);
  assert.ok(ordinary.ok&&ordinary.renderScene,JSON.stringify(ordinary.report.issues));
  assert.deepEqual(ordinary.renderScene,result.renderScene);
  return result;
}
const publicQuestions=["Compare butanal and butan-2-one.","Compare ethanol and propan-1-ol."];
for(const question of publicQuestions){
  check("whole-source graph, owner names and structural symbols: "+question,()=>{
    const result=source(question);
    assert.equal(result.originalQuestion,question);assert.equal(result.document.source.question,question);
    assert.equal(result.proof.sourceBindings.length,2);
    assert.ok(result.labels.some(label=>label.kind==="structure_symbol"&&label.text===(question.includes("ethanol")?"OH":"O")));
    for(const binding of result.proof.sourceBindings)assert.equal(question.slice(binding.source.start,binding.source.end),binding.source.text);
    for(const binding of result.labels){
      assert.ok(result.renderScene.primitives.some(p=>p.id===binding.primitiveId&&p.entityId===binding.entityId&&p.text===binding.text&&p.groupId===binding.groupId));
      assert.equal(question.slice(binding.sourceArgument.start,binding.sourceArgument.end),binding.sourceArgument.text);
    }
    const names=result.labels.filter(label=>label.kind==="complete_source_name_line");
    assert.deepEqual([...new Set(names.map(label=>label.sourceArgument.text))].sort(),result.proof.sourceBindings.map(binding=>binding.source.text).sort());
  });
  check("JSON raw and compiled witness recomputed: "+question,()=>{
    const result=source(question);const rawDocument:unknown=JSON.parse(JSON.stringify(result.document));const compiledWitness:unknown=JSON.parse(JSON.stringify(result.renderScene));
    const prepared=prepareSourceBoundChemistryStructure({originalQuestion:question,rawDocument,compiledWitness});
    assert.equal(prepared.status,"verified");assert.ok(prepared.status==="verified");assert.deepEqual(prepared.renderScene,result.renderScene);
    assert.equal(prepareNeutralComparison({originalQuestion:question,rawDocument,compiledWitness}).status,"verified");
  });
}
const baseQuestion=publicQuestions[0]!,base=source(baseQuestion);
for(const originalQuestion of [undefined,"Compare butanal and propan-2-one."," "+baseQuestion,baseQuestion+"\u200b","Compare $butanal$ and butan-2-one."])check("external source mismatch cannot gain document authority: "+String(originalQuestion),()=>{
  assert.equal(prepareSourceBoundChemistryStructure({originalQuestion:originalQuestion as string,rawDocument:base.document,compiledWitness:base.renderScene}).status,"declined");
});
for(const [id,mutate] of [
  ["source question",(d:SceneDocument)=>{d.source.question="Compare ethanol and propan-1-ol.";}],
  ["O symbol",(d:SceneDocument)=>{const e=d.entities.find(e=>e.label==="O");assert.ok(e);e.label="N";}],
  ["complete name",(d:SceneDocument)=>{const e=d.entities.find(e=>e.label==="butanal");assert.ok(e);e.label="ethanol";}],
  ["bond endpoint",(d:SceneDocument)=>{const c=d.constructions.find(c=>c.operator==="segment");assert.ok(c);c.inputs.end=c.inputs.start;}],
  ["missing required mark",(d:SceneDocument)=>{d.requiredEntityIds.pop();}],
  ["duplicate mark",(d:SceneDocument)=>{d.entities.push(structuredClone(d.entities[0]!));}],
  ["renamed group",(d:SceneDocument)=>{d.revealGroups[0]!.id="trusted_cache";}],
  ["forged proof",(d:SceneDocument)=>{d.source.cachedProof={version:"neutral-comparison-source-proof/v1",verified:true};}],
  ["physical quantity",(d:SceneDocument)=>{d.quantities.push({id:"T",value:300,unit:"K"});}],
  ["physical caption",(d:SceneDocument)=>{d.annotations.push({id:"metric",kind:"callout",targetIds:[],text:"T=300 K"});}],
] as const)check("raw scope mutation declines: "+id,()=>{
  const document=structuredClone(base.document);mutate(document);
  assert.equal(prepareSourceBoundChemistryStructure({originalQuestion:baseQuestion,rawDocument:document,compiledWitness:base.renderScene}).status,"declined");
});
for(const [id,mutate] of [
  ["point",(s:RenderScene)=>{s.primitives[0]!.points[0]!.x+=1;}],
  ["label",(s:RenderScene)=>{const p=s.primitives.find(p=>p.kind==="label");assert.ok(p);p.text="trusted";}],
  ["primitive id",(s:RenderScene)=>{s.primitives[0]!.id="trusted";}],
  ["group",(s:RenderScene)=>{s.primitives[0]!.groupId="trusted";}],
  ["duplicate",(s:RenderScene)=>{s.primitives.push(structuredClone(s.primitives[0]!));}],
  ["drop",(s:RenderScene)=>{s.primitives.pop();}],
  ["bounds",(s:RenderScene)=>{const p=s.primitives.find(p=>p.kind==="label");assert.ok(p);p.provenance={...p.provenance,labelBounds:{x:0,y:0,width:1,height:1}};}],
  ["style",(s:RenderScene)=>{s.primitives[0]!.provenance={...s.primitives[0]!.provenance,unprovedStyle:true};}],
] as const)check("cached witness mutation cannot authorize ink: "+id,()=>{
  const witness=structuredClone(base.renderScene);mutate(witness);
  assert.equal(prepareSourceBoundChemistryStructure({originalQuestion:baseQuestion,rawDocument:base.document,compiledWitness:witness}).status,"declined");
});
for(const question of [
  "Compare butanal and unknownium.","Compare unknownium compound and mysteryol compound.",
  "Compare ethanol and benzene.","Compare ethanol and propan-1-ol at 300 K.",
  "Compare ethanol oxidation and propan-1-ol.","Compare ethanol and propan-1-ol and explain their boiling points.",
  "Compare ethanol and ethanol."," Compare ethanol and propan-1-ol.",
  "Compare ethanol and propan-1-ol","Compare ethanol and propan-1-ol?","Compare\u200b ethanol and propan-1-ol.",
])check("recognized unsupported complete request declines atomically: "+question,()=>{
  assert.equal(buildSourceBoundNeutralComparison({originalQuestion:question}).status,"declined");
});
check("erased raw footprint cannot hide a supported external request",()=>{
  const empty={...structuredClone(base.document),entities:[],constructions:[],requiredEntityIds:[],revealGroups:[],teachingTimeline:[]};
  assert.equal(prepareSourceBoundChemistryStructure({originalQuestion:baseQuestion,rawDocument:empty}).status,"declined");
});
check("erased raw footprint cannot hide a wholly unresolved comparison request",()=>{
  const empty={...structuredClone(base.document),entities:[],constructions:[],requiredEntityIds:[],revealGroups:[],teachingTimeline:[]};
  assert.equal(prepareSourceBoundChemistryStructure({originalQuestion:"Compare unknownium compound and mysteryol compound.",rawDocument:empty}).status,"declined");
});
for(const originalQuestion of ["Compare ethanol and propan-1-ol","Compare ethanol and propan-1-ol?","Compare\u200b ethanol and propan-1-ol."])check("preparation also refuses unsupported recognized request with no raw footprint: "+originalQuestion,()=>{
  const empty={...structuredClone(base.document),entities:[],constructions:[],requiredEntityIds:[],revealGroups:[],teachingTimeline:[]};
  assert.equal(prepareSourceBoundChemistryStructure({originalQuestion,rawDocument:empty}).status,"declined");
});
check("compiler recomputes forged structural metadata instead of trusting it",()=>{
  const document=structuredClone(base.document);
  document.source.chemistryRepresentation={version:"chemistry-representation/v1",species:[],structuralEntityIds:[],structuralQuantities:[],structuralTexts:[]};
  const result=compileSceneDocument(document);assert.equal(result.ok,false);assert.equal(result.renderScene,null);
  assert.ok(result.report.issues.some(issue=>issue.code==="chemistry_representation_invalid"&&issue.severity==="fatal"));
});
for(const question of ["Draw the skeletal structure of ethanol."," Draw the skeletal structure of ethanol.","Draw the oxidation of ethanol to ethanal.","Draw the Lewis structure of NH3.","Draw a projectile trajectory."])check("unrelated producer input remains not applicable: "+question,()=>{
  assert.equal(buildSourceBoundNeutralComparison({originalQuestion:question}).status,"not_applicable");
});
for(const originalQuestion of ["Compare reflection and refraction","Compare reflection and refraction.","Compare linear and quadratic functions","Compare linear and quadratic functions.","Compare compound interest and simple interest.","Compare compound lenses and simple lenses.","Compare O2 and H2 molecules of an ideal gas at equal temperature.","Compare O2 and H2 molecules of an ideal gas at equal temperature. Draw a P-V diagram.","Compare unknownium and mysteryol."])check("nonchemistry comparison retains both producer and preparation disposition: "+originalQuestion,()=>{
  assert.equal(buildSourceBoundNeutralComparison({originalQuestion}).status,"not_applicable");
  const empty={...structuredClone(base.document),source:{question:originalQuestion},entities:[],constructions:[],requiredEntityIds:[],revealGroups:[],teachingTimeline:[]};
  assert.equal(prepareSourceBoundChemistryStructure({originalQuestion,rawDocument:empty}).status,"not_applicable");
});
const result={scope:"dormant_public_engine_API_only",passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,rows,oldSixFullActivationGates:"DEFERRED_UNAVAILABLE_NOT_EXECUTED"};
const output=process.argv.indexOf("--out");if(output>=0)writeFileSync(process.argv[output+1]!,JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(result));process.exitCode=result.failed?1:0;
