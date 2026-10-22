/** Verified source chemical identities, relations and assumptions remain visible. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { normalizeTutorQuestion } from "../../../tutor-core/src/text/questionText";
import { readSourceLawGraph } from "../../src/chemistry/sourceLawGraph";
import { buildSourceLawGraphFigure } from "../../src/chemistry/lawGraphFigure";
import { sourceLawContextInkIssue, verifySourceLawContextInk } from "../../src/chemistry/sourceLawContext";
import type { SceneDocument, RenderScene } from "../../src/types";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileForLab } from "../chemistry-lab/lab";
import fixture from "./fixtures/chemistry-law-context-fidelity.json";
import expressionFixture from "./fixtures/chemistry-law-expression-identity.json";
const results = fixture.rows.flatMap(gold => ["adapter", "strict", "ordinary", "lastResort"].map(route => {
 const question = normalizeTutorQuestion(gold.question); let actual: unknown = null; let error: string | null = null;
 try {
  const read = readSourceLawGraph(question, "chem_solutions");
  const candidate = route === "adapter" ? read.state === "valid" ? buildSourceLawGraphFigure(read.model,question) : null
   : route === "strict" ? buildSolutionsGraphScene(question, [], false)
    : (route === "ordinary" ? synthesizeFamilyScene : synthesizeLastResortScene)({ question });
  const document = candidate ? "document" in candidate ? candidate.document : candidate : null;
  const compiled = document ? compileForLab(document) : null;
  actual = { read, document, compiled };
  assert.equal(!!document, gold.draw, "whole scientifically supported source model");
  if (document) {
   assert.ok(compiled?.ok && compiled.renderScene, "ordinary validation/compilation");
   assert.equal(document.source.question, question);
   const visible = compiled.renderScene.primitives.filter(p => p.kind === "label" || p.kind === "dimension").map(p => p.text ?? "").join(" ").replace(/\s+/g, " ");
   const flat = visible.replace(/\s/g, "");
   for (const fact of gold.mustShow) assert.ok(flat.includes(fact.replace(/\s/g, "")), `required actual visible source fact missing: ${fact}`);
  }
 } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
 return { id: gold.id, route, question, expectedDraw: gold.draw, passed: error === null, error, actual };
}));
function seed(kind: string): {question:string;document:SceneDocument;paint:RenderScene} {
 const gold=fixture.rows.find(r=>r.draw&&r.kind===kind)!;
 const question=normalizeTutorQuestion(gold.question),read=readSourceLawGraph(question,"chem_solutions");
 assert.ok(read.state==="valid");
 const document=buildSourceLawGraphFigure(read.model,question);assert.ok(document);
 const compiled=compileForLab(document);assert.ok(compiled.ok&&compiled.renderScene);
 return {question,document,paint:compiled.renderScene};
}
const common=seed("common-ion"), acid=seed("ideal-acid");
function replaceLabel(document:SceneDocument,contains:string,value:string):void {
 const entity=document.entities.find(e=>e.kind==="label"&&e.label?.includes(contains));assert.ok(entity,contains);
 entity.label=value;
 const construction=document.constructions.find(c=>c.outputs.includes(entity.id));assert.ok(construction);
 construction.inputs.text=value;
}
function removeLabel(document:SceneDocument,contains:string):void {
 const entity=document.entities.find(e=>e.kind==="label"&&e.label?.includes(contains));assert.ok(entity,contains);
 document.entities=document.entities.filter(e=>e.id!==entity.id);
 document.constructions=document.constructions.filter(c=>!c.outputs.includes(entity.id));
 document.requiredEntityIds=document.requiredEntityIds.filter(id=>id!==entity.id);
 document.revealGroups.forEach(g=>g.entityIds=g.entityIds.filter(id=>id!==entity.id));
}
const mutations=fixture.mutations.map(gold=>{
 const document=structuredClone(common.document),paint=structuredClone(common.paint);
 let usePaint=false;
 switch(gold.id) {
  case "raw-cross-species-label":replaceLabel(document,"AgCl(s)","AgBr(s)");break;
  case "raw-wrong-ion-charge":replaceLabel(document,"Ag+(aq)","Ag2+(aq)");break;
  case "raw-missing-context":removeLabel(document,"equilibrium");break;
  case "raw-wrong-context-relation":replaceLabel(document,"s(C+s)","s(C-s)=K_sp");break;
  case "raw-source-question-mismatch":document.source.question=common.question.replaceAll("AgCl","AgBr").replaceAll("NaCl","NaBr");break;
  case "model-forged-context":(document.source.sourceLawGraph as {chemicalContext:{cation:{charge:number}}}).chemicalContext.cation.charge=2;break;
  case "model-changed-physical-relation":{
   const model=document.source.sourceLawGraph as {curves:Array<{relation:{product:number}}>};model.curves[0]!.relation.product*=2;
   const curve=document.constructions.find(c=>c.operator==="function_curve")!;curve.inputs.expression=`(${String(curve.inputs.expression)})+0.15`;
   document.assertions=document.assertions.filter(a=>a.predicate!=="function_value");break;
  }
  case "paint-cross-species":paint.primitives.find(p=>p.text?.includes("Ag+(aq)"))!.text="Ag2+(aq)";usePaint=true;break;
  case "paint-invisible-context":{
   const p=paint.primitives.find(p=>p.text?.includes("equilibrium"))!;p.provenance={...p.provenance,opacity:0};usePaint=true;break;
  }
  default:throw new Error(`unimplemented frozen mutation ${gold.id}`);
 }
 return [false,true].map(jsonReopen=>{
  const raw=jsonReopen?JSON.parse(JSON.stringify(document)) as SceneDocument:document;
  const actualPaint=usePaint?(jsonReopen?JSON.parse(JSON.stringify(paint)) as RenderScene:paint):undefined;
  const ordinary=compileForLab(raw),issue=sourceLawContextInkIssue(raw,common.question,actualPaint);
  const valid=issue===null;
  return {id:gold.id,jsonReopen,expectedValid:gold.expectedValid,passed:valid===gold.expectedValid,valid,issue,ordinary,document:raw,suppliedPaint:actualPaint};
 });
}).flat();
const extra: Array<{id:string;passed:boolean;[key:string]:unknown}>=[];
for(const kind of ["point","segment","dimension"]){
 const raw=structuredClone(common.document),id=`extra_${kind}`;
 if(kind==="point") {
  raw.entities.push({id,kind:"point",role:"foreign chemical claim",label:"Ag2+"});
  raw.constructions.push({id:`make_${id}`,operator:"point",inputs:{x:18,y:-4},outputs:[id]});
 } else {
  const anchor=raw.entities.find(e=>e.kind==="point")!.id;
  raw.entities.push({id,kind,role:"foreign chemical claim",label:"Ag2+"});
  raw.constructions.push({id:`make_${id}`,operator:kind==="segment"?"segment":"dimension",inputs:{start:anchor,end:anchor,text:"Ag2+"},outputs:[id]});
 }
 raw.requiredEntityIds.push(id);raw.revealGroups[0]!.entityIds.push(id);
 const issue=sourceLawContextInkIssue(raw,common.question);
 extra.push({id:`raw-extra-${kind}-foreign-species`,passed:issue!==null,issue,ordinary:compileForLab(raw),document:raw});
}
for(const [id,contains,replacement] of [["raw-hcl-wrong-balance","[H+]=C","[H+]=2C"],["raw-hcl-missing-qualification","water ionisation",""]]){
 const raw=structuredClone(acid.document);
 if(replacement)replaceLabel(raw,contains!,replacement);else removeLabel(raw,contains!);
 const issue=sourceLawContextInkIssue(raw,acid.question);extra.push({id:id!,passed:issue!==null,issue,ordinary:compileForLab(raw),document:raw});
}
const reopen=JSON.parse(JSON.stringify(common.document)) as SceneDocument;
extra.push({id:"legitimate-json-roundtrip",passed:verifySourceLawContextInk(reopen,common.question,common.paint)});
const commonRead=readSourceLawGraph(common.question,"chem_solutions");assert.ok(commonRead.state==="valid");
const otherQuestion=common.question.replaceAll("AgCl","AgBr").replaceAll("NaCl","NaBr");
const other=buildSolutionsGraphScene(otherQuestion,[],false),otherPaint=compileForLab(other);
extra.push({id:"stale-valid-model-external-question",passed:buildSourceLawGraphFigure(commonRead.model,otherQuestion)===null&&!!other&&other.source.question===otherQuestion&&otherPaint.ok&&otherPaint.labels.some(t=>t.includes("AgBr(s)"))&&!otherPaint.labels.some(t=>t.includes("AgCl(s)")),document:other,ordinary:otherPaint});
assert.equal(common.question,normalizeTutorQuestion(expressionFixture.questions["common-ion"]));
assert.equal(acid.question,normalizeTutorQuestion(expressionFixture.questions["ideal-acid"]));
const expressionMutations=expressionFixture.rows.flatMap(gold=>{
 const source=gold.kind==="common-ion"?common:acid,raw=structuredClone(source.document);
 const construction=raw.constructions.find(c=>c.operator==="function_curve")!;
 if(gold.replacement)construction.inputs.expression=gold.replacement;
 else if(gold.addition)construction.inputs.expression=`(${String(construction.inputs.expression)})+${gold.addition}`;
 return[false,true].map(jsonReopen=>{
  const document=jsonReopen?JSON.parse(JSON.stringify(raw))as SceneDocument:raw;
  const issue=sourceLawContextInkIssue(document,source.question),valid=issue===null;
  return{id:gold.id,jsonReopen,valid,issue,passed:valid===gold.expectedValid,ordinary:compileForLab(document),document};
 });
});
const all=[...results,...mutations,...extra,...expressionMutations];
const report={passed:all.filter(r=>r.passed).length,failed:all.filter(r=>!r.passed).length,results,mutations,extra,expressionMutations};
const out=process.argv.indexOf("--out");
if(out>=0)writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
for(const row of all.filter(r=>!r.passed))console.error(row.id,JSON.stringify("error"in row?row.error:row));
console.log(JSON.stringify({passed:report.passed,failed:report.failed,sourceCases:results.length,mutationCases:mutations.length,extraCases:extra.length}));
if(report.failed)process.exitCode=1;
