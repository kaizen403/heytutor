/** Actual source/read/compile sign-region obligations, not caption-note credit. */
import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {normalizeTutorQuestion} from "../../../tutor-core/src/text/questionText";
import {buildMeasuredGibbsGraph,verifyMeasuredGibbsRegionInk} from "../../src/chemistry/gibbsLaw";
import {buildThermoGraphScene} from "../../src/chemistry/thermoGraphs";
import {synthesizeFamilyScene,synthesizeLastResortScene} from "../../src/synthesize/familyScene";
import {compileForLab} from "../chemistry-lab/lab";
import type {SceneDocument,RenderScene} from "../../src/types";
import fixture from "./fixtures/chemistry-gibbs-sign-region-fidelity.json";
import affineFixture from "./fixtures/chemistry-gibbs-affine-identity.json";
const results=fixture.rows.flatMap(gold=>["adapter","strict","ordinary","lastResort"].map(route=>{
 const question=normalizeTutorQuestion(gold.question);let error:string|null=null;let actual:unknown=null;
 try{
  const result=route==="adapter"?buildMeasuredGibbsGraph(question,[]):route==="strict"?buildThermoGraphScene(question,[],false):(route==="ordinary"?synthesizeFamilyScene:synthesizeLastResortScene)({question});
  const document=result?"document"in result?result.document:result:null,compiled=compileForLab(document);actual={document,compiled};
  assert.equal(!!document,gold.draw);
  if(document){
   assert.ok(compiled.ok&&compiled.renderScene);
   const model=document.source.sourceLawGraph as {regions?:Array<{domain:[number,number];label:string;meaning:string}>};
   assert.deepEqual(model.regions?.map(r=>[...r.domain,r.meaning]),gold.regions,"source-computed clipped sign intervals");
   for(const region of gold.regions){
    const text=region[2]==="positive"?"ΔG > 0":"ΔG < 0";
    assert.ok(compiled.labels.includes(text),"actual sign-region text must be painted, notes do not count");
   }
  }
 }catch(e){error=e instanceof Error?e.message:String(e);}
 return{id:gold.id,route,question,passed:error===null,error,actual};
}));
const question=normalizeTutorQuestion(fixture.rows[0]!.question),seed=buildMeasuredGibbsGraph(question,[]);assert.ok(seed);
const painted=compileForLab(seed);assert.ok(painted.ok&&painted.renderScene);
function label(document:SceneDocument):string {
 const e=document.entities.find(e=>e.kind==="label"&&e.label==="ΔG > 0");assert.ok(e);return e.id;
}
const mutations=fixture.mutations.flatMap(gold=>{
 const document=structuredClone(seed),paint=structuredClone(painted.renderScene);let external=question,usePaint=false;
 const id=label(document);
 switch(gold.id){
  case "raw-reversed-sign-label":{
   document.entities.find(e=>e.id===id)!.label="ΔG < 0";
   document.constructions.find(c=>c.outputs.includes(id))!.inputs.text="ΔG < 0";break;
  }
  case "raw-missing-sign-label":document.entities=document.entities.filter(e=>e.id!==id);document.constructions=document.constructions.filter(c=>!c.outputs.includes(id));document.requiredEntityIds=document.requiredEntityIds.filter(e=>e!==id);document.revealGroups.forEach(g=>g.entityIds=g.entityIds.filter(e=>e!==id));break;
  case "raw-foreign-sign-annotation":document.annotations.push({id:"foreign_sign",kind:"callout",targetIds:[],text:"ΔG < 0 throughout"});break;
  case "model-forged-regions":(document.source.sourceLawGraph as {regions:Array<{meaning:string}>}).regions[0]!.meaning="negative";break;
  case "model-forged-slope":(document.source.sourceLawGraph as {curves:Array<{relation:{slope:number}}>}).curves[0]!.relation.slope*=-1;break;
  case "paint-reversed-sign-label":paint.primitives.find(p=>p.entityId===id&&p.kind==="label")!.text="ΔG < 0";usePaint=true;break;
  case "paint-missing-sign-label":paint.primitives=paint.primitives.filter(p=>p.entityId!==id);usePaint=true;break;
  case "external-wrong-domain":external=question.replace("200 to 450","250 to 450");break;
  default:throw new Error(`unimplemented frozen mutation ${gold.id}`);
 }
 return [false,true].map(jsonReopen=>{
  const raw=jsonReopen?JSON.parse(JSON.stringify(document))as SceneDocument:document;
  const native=usePaint?(jsonReopen?JSON.parse(JSON.stringify(paint))as RenderScene:paint):undefined;
  const valid=verifyMeasuredGibbsRegionInk(raw,external,native);
  return{id:gold.id,jsonReopen,valid,passed:valid===gold.expectedValid,ordinary:compileForLab(raw),document:raw,suppliedPaint:native};
 });
});
const reopened=JSON.parse(JSON.stringify(seed))as SceneDocument;
const positive={id:fixture.positiveMutation.id,passed:verifyMeasuredGibbsRegionInk(reopened,question,painted.renderScene)};
const warped=structuredClone(seed),curve=warped.constructions.find(c=>c.operator==="function_curve")!;
curve.inputs.expression=`(${String(curve.inputs.expression)})+1e-4*x*(x-2)*(x-4)*(x-6)*(x-8)*(x-3.2)`;
const ordinary=compileForLab(warped),withoutOnlyNewAssertions=structuredClone(warped);
withoutOnlyNewAssertions.assertions=withoutOnlyNewAssertions.assertions.filter(a=>!a.id.startsWith("gibbs_sign_region_"));
const oldOrdinary=compileForLab(withoutOnlyNewAssertions),privateValid=verifyMeasuredGibbsRegionInk(warped,question);
const midpoint={id:"between-old-samples-affine-curve-tamper",passed:!ordinary.ok&&oldOrdinary.ok&&!privateValid,ordinary,withoutOnlyNewAssertions:oldOrdinary,privateValid,document:warped};
assert.equal(question,affineFixture.sourceQuestion,"independently frozen source law");
const affineMutations=affineFixture.rows.flatMap(gold=>{
 const raw=structuredClone(seed),construction=raw.constructions.find(c=>c.operator==="function_curve")!;
 construction.inputs.expression=gold.expression;
 return [false,true].map(jsonReopen=>{
  const document=jsonReopen?JSON.parse(JSON.stringify(raw))as SceneDocument:raw;
  const valid=verifyMeasuredGibbsRegionInk(document,question),ordinary=compileForLab(document);
  return{id:gold.id,jsonReopen,expectedValid:gold.expectedValid,valid,passed:valid===gold.expectedValid,ordinary,document};
 });
});
const all=[...results,...mutations,positive,midpoint,...affineMutations];
const report={passed:all.filter(r=>r.passed).length,failed:all.filter(r=>!r.passed).length,results,mutations,positive,midpoint,affineMutations};
const out=process.argv.indexOf("--out");if(out>=0)writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
for(const row of all.filter(r=>!r.passed))console.error(row.id,JSON.stringify("error"in row?row.error:row));
console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
