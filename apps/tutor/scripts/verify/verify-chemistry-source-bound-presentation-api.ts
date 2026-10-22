/** Explicit dormant API contracts; legacy/live/storage consumers remain unactivated. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { getSegmentCommands } from "@heytutor/drawing";
import { buildSourceBoundNeutralComparison, compileSceneDocument, type SceneDocument, type RenderScene } from "@heytutor/scene-engine";
import { buildSourceBoundChemistryPresentation, buildVerifiedDiagramPresentation, NeutralPanelPresentationDeclined } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

const rows:Array<{id:string;passed:boolean;error?:string}>=[];
function check(id:string,fn:()=>void):void {try{fn();rows.push({id,passed:true});}catch(error){rows.push({id,passed:false,error:String(error)});}}
function source(question:string){
  const result=buildSourceBoundNeutralComparison({originalQuestion:question});assert.ok(result.status==="verified",JSON.stringify(result));
  const compiled=compileSceneDocument(result.document);assert.ok(compiled.ok&&compiled.renderScene);assert.deepEqual(compiled.renderScene,result.renderScene);return result;
}
function refused(document:SceneDocument,render:RenderScene,originalQuestion:string|undefined):void {
  assert.throws(()=>buildSourceBoundChemistryPresentation(document,render,{originalQuestion:originalQuestion as string}),error=>error instanceof NeutralPanelPresentationDeclined&&error.code==="neutral_panel_declined"&&error.issues.length>0);
}
for(const question of ["Compare butanal and butan-2-one.","Compare ethanol and propan-1-ol."]){
  check("real factory, ordinary compiler and explicit complete opening: "+question,()=>{
    const built=source(question);const presentation=buildSourceBoundChemistryPresentation(built.document,built.renderScene,{originalQuestion:question});
    const opening=presentation.introSegments.flatMap(getSegmentCommands);
    assert.equal(presentation.diagram.commands.length,built.renderScene.primitives.length);assert.equal(opening.length,presentation.diagram.commands.length);
    for(const primitive of built.renderScene.primitives){
      const commands=presentation.diagram.commands.filter(command=>command.semanticRef?.primitiveId===primitive.id&&command.semanticRef.entityId===primitive.entityId);assert.equal(commands.length,1);
      const command=commands[0]!;assert.equal(opening.filter(c=>c.semanticRef?.primitiveId===primitive.id&&c.semanticRef.entityId===primitive.entityId).length,1);
      if(primitive.kind==="label"){assert.equal(command.type,"LABEL");assert.equal(command.text,primitive.text);const bound=primitive.provenance?.labelBounds as {x:number;y:number};assert.deepEqual(command.params,[bound.x+4,bound.y+4,24]);}
      else if(primitive.kind==="line")assert.deepEqual(command.params,primitive.points.flatMap(point=>[point.x,point.y]));
    }
    assert.ok(opening.every(command=>command.type!=="WRITE"&&command.type!=="CLEAR"));
    assert.deepEqual(built.document,source(question).document);
  });
  check("JSON explicit preparation has identical geometry/order/reveal: "+question,()=>{
    const built=source(question);const expected=buildSourceBoundChemistryPresentation(built.document,built.renderScene,{originalQuestion:question});
    assert.deepEqual(buildSourceBoundChemistryPresentation(JSON.parse(JSON.stringify(built.document)) as SceneDocument,JSON.parse(JSON.stringify(built.renderScene)) as RenderScene,{originalQuestion:question}),expected);
  });
  check("legacy dormant entry is callable without external source: "+question,()=>{
    const built=source(question);const legacy=buildVerifiedDiagramPresentation(built.document,built.renderScene);
    assert.ok(legacy.diagram.commands.length>0);assert.deepEqual(legacy,buildVerifiedDiagramPresentation(built.document,built.renderScene,{}));
    // This is legacy API preservation, not student-board acceptance for its deferred labels.
    assert.ok(legacy.diagram.deferredAnnotations?.some(entry=>entry.commands.some(command=>command.type==="LABEL")));
  });
}
const question="Compare ethanol and propan-1-ol.",base=source(question);
for(const originalQuestion of [undefined,"",question+" "," "+question,question+"\u200b","Compare ethanol and butan-1-ol.","Compare $ethanol$ and propan-1-ol."])check("missing/changed external source has typed scoped refusal: "+String(originalQuestion),()=>refused(base.document,base.renderScene,originalQuestion));
for(const [id,mutate] of [
  ["OH owner symbol",(d:SceneDocument)=>{const e=d.entities.find(e=>e.label==="OH");assert.ok(e);e.label="H";}],
  ["name",(d:SceneDocument)=>{const e=d.entities.find(e=>e.label==="ethanol");assert.ok(e);e.label="methanol";}],
  ["source question",(d:SceneDocument)=>{d.source.question="Compare ethanol and butan-1-ol.";}],
  ["forged proof",(d:SceneDocument)=>{d.source.acceptedProof={version:"neutral-comparison-source-proof/v1",verified:true};}],
  ["group ownership",(d:SceneDocument)=>{d.revealGroups[0]!.entityIds.pop();}],
  ["raw label coordinate",(d:SceneDocument)=>{const c=d.constructions.find(c=>c.operator==="point");assert.ok(c);c.inputs.x=99;}],
] as const)check("raw structural mutation never reaches transport: "+id,()=>{
  const document=structuredClone(base.document);mutate(document);refused(document,base.renderScene,question);
});
for(const [id,mutate] of [
  ["coordinates",(s:RenderScene)=>{s.primitives[0]!.points[0]!.x+=1;}],
  ["text",(s:RenderScene)=>{const p=s.primitives.find(p=>p.kind==="label");assert.ok(p);p.text="trusted cache";}],
  ["bounds",(s:RenderScene)=>{const p=s.primitives.find(p=>p.kind==="label");assert.ok(p);p.provenance={...p.provenance,labelBounds:{x:0,y:0,width:1,height:1}};}],
  ["style",(s:RenderScene)=>{s.primitives[0]!.provenance={...s.primitives[0]!.provenance,forgedStyle:true};}],
  ["duplicate",(s:RenderScene)=>{s.primitives.push(structuredClone(s.primitives[0]!));}],
  ["order",(s:RenderScene)=>{s.primitives.reverse();}],
] as const)check("cached render mutation cannot become verified opening ink: "+id,()=>{
  const render=structuredClone(base.renderScene);mutate(render);refused(base.document,render,question);
});
check("canonical footprint erased from raw remains scoped by external source",()=>{
  const document={...structuredClone(base.document),entities:[],constructions:[],requiredEntityIds:[],revealGroups:[],teachingTimeline:[]};refused(document,base.renderScene,question);
});
for(const originalQuestion of ["Compare unknownium compound and mysteryol compound.","Compare ethanol and propan-1-ol","Compare ethanol and propan-1-ol?","Compare\u200b ethanol and propan-1-ol."])check("recognized unsupported external request cannot escape typed refusal by erasing raw footprint: "+originalQuestion,()=>{
  const document={...structuredClone(base.document),entities:[],constructions:[],requiredEntityIds:[],revealGroups:[],teachingTimeline:[]};refused(document,base.renderScene,originalQuestion);
});
function ordinaryFixture():{document:SceneDocument;render:RenderScene}{
  const document:SceneDocument={schemaVersion:"scene-document/v2",visualDecision:{mode:"scene",reason:"independent ordinary transport control"},source:{question:"Draw an ordinary segment between A and B."},quantities:[],entities:[{id:"a",kind:"point",role:"start"},{id:"b",kind:"point",role:"end"},{id:"ab",kind:"segment",role:"edge"},{id:"name",kind:"label",role:"name",label:"AB"}],constructions:[{id:"a_make",operator:"point",inputs:{x:0,y:0,coordinateSpace:"world"},outputs:["a"]},{id:"b_make",operator:"point",inputs:{x:2,y:1,coordinateSpace:"world"},outputs:["b"]},{id:"line_make",operator:"segment",inputs:{start:"a",end:"b"},outputs:["ab"]},{id:"name_make",operator:"label",inputs:{target:"ab",text:"AB"},outputs:["name"]}],relations:[],assertions:[],annotations:[],requiredEntityIds:["a","b","ab","name"],revealGroups:[{id:"frame",entityIds:["a","b","ab","name"],dependsOn:[],narrationCue:"the edge AB"}],teachingTimeline:[{id:"reveal_frame",action:"reveal",targetId:"frame",dependsOn:[],narrationIntent:"the edge AB"}]};
  const result=compileSceneDocument(document);assert.ok(result.ok&&result.renderScene,JSON.stringify(result.report.issues));return {document,render:result.renderScene};
}
for(const layout of ["standard","code_lesson"] as const)check("not-applicable explicit entry retains ordinary transport: "+layout,()=>{
  const fixture=ordinaryFixture();const legacy=buildVerifiedDiagramPresentation(fixture.document,fixture.render,{layout});
  assert.deepEqual(buildSourceBoundChemistryPresentation(fixture.document,fixture.render,{layout,originalQuestion:fixture.document.source.question as string}),legacy);
});
for(const originalQuestion of ["Compare reflection and refraction","Compare reflection and refraction.","Compare linear and quadratic functions","Compare linear and quadratic functions.","Compare compound interest and simple interest.","Compare compound lenses and simple lenses.","Compare O2 and H2 molecules of an ideal gas at equal temperature.","Compare O2 and H2 molecules of an ideal gas at equal temperature. Draw a P-V diagram."])check("nonchemistry comparison preserves both actual presentation entries: "+originalQuestion,()=>{
  const fixture=ordinaryFixture();fixture.document.source.question=originalQuestion;
  const compiled=compileSceneDocument(fixture.document);assert.ok(compiled.ok&&compiled.renderScene);
  for(const layout of ["standard","code_lesson"] as const)assert.deepEqual(buildSourceBoundChemistryPresentation(fixture.document,compiled.renderScene,{layout,originalQuestion}),buildVerifiedDiagramPresentation(fixture.document,compiled.renderScene,{layout}));
});
const result={scope:"dormant_explicit_presentation_API_only",passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,rows,legacyLiveStorageAndSixOriginalOracles:"DEFERRED_UNAVAILABLE_NOT_EXECUTED"};
const output=process.argv.indexOf("--out");if(output>=0)writeFileSync(process.argv[output+1]!,JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(result));process.exitCode=result.failed?1:0;
