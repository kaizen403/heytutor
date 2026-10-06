import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as engine from "@heytutor/scene-engine";
import {planProblemAuthorityV1,inferSceneCapabilities} from "@heytutor/tutor-core";
import {planProblemAuthorityV1 as sourcePlanProblemAuthorityV1} from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import {liveSceneSaveFailure} from "../../lib/scene/sceneSaveAdmission";
import {canonicalizeTurnSceneMetadata} from "../../lib/scene/turnScenePersistence";
import {sourceCheckedStoredTurn} from "../../lib/scene/storedSceneSource";
import {restoreVerifiedPresentationFromTurn} from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type {StoredTurn} from "../../lib/boards/boardsClient";

const actual=JSON.parse(readFileSync(new URL("../../../../packages/scene-engine/fixtures/matrix-products-live-20261006/actual-runtime.json",import.meta.url),"utf8")) as {question:string;plan:engine.TurnPlanV3;problemIR:engine.ProblemIR;rawProblemResponse:unknown};
let checks=0;
function equal(value:unknown,expected:unknown,label:string){assert.deepEqual(value,expected,label);checks++;}
const original=structuredClone(actual);
const correction=engine.applySourceQuantityAuthority(actual.plan,null,actual.question);
const evidence=correction.outcomes.find(row=>row.sourcePlanCorrection)?.sourcePlanCorrection;
assert(evidence);
equal(evidence.audit.withdrawn,actual.plan.givens,"both original scalar placeholders remain in the audit");
equal(evidence.sourceAliases.map(row=>[row.numericScalarAuthority,Object.hasOwn(row,"value")]),[[false,false],[false,false]],"aliases are explicitly nonnumeric");
equal(engine.applySourceQuantityAuthority(correction.plan,actual.problemIR,actual.question).plan,correction.plan,"final actual IR correction idempotent");
const plan=correction.plan;
const scene=engine.synthesizeFamilyScene({question:actual.question,turnPlan:plan,problemIR:actual.problemIR});assert(scene);
equal(scene.tier,"qualitative_verified","product numeric exactness does not make table spacing metric");
equal(engine.synthesizeFamilyScene({question:actual.question,turnPlan:actual.plan,problemIR:actual.problemIR}),null,"family cannot repair late placeholders after teaching");
const api=await planProblemAuthorityV1(actual.question,plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(actual.problemIR)}}]}),{status:200})});
assert(api && !("status" in api));
equal(api.problemIR,actual.problemIR,"normal API retains complete fact-only graph unchanged");
equal([api.solverResult.status,api.solverResult.values.length,api.audit.status,api.projection],["solved",0,"not_applicable",null],"fact-only graph does not invent a generic scalar solution");
const compact=await planProblemAuthorityV1(actual.question,plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(actual.rawProblemResponse)}}]}),{status:200})});
assert(compact && !("status" in compact));
for(const key of ["facts","entities","expressions","constraints","representationIntents","solveRequests"] as const)equal(compact.problemIR[key],actual.problemIR[key],`compact original ${key} retained with only wire-syntax lifting`);
for(const raw of [actual.problemIR,actual.rawProblemResponse]){
 const sourceOutcome=await sourcePlanProblemAuthorityV1(actual.question,plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(raw)}}]}),{status:200})});
 assert(sourceOutcome && !("status" in sourceOutcome));
 equal(sourceOutcome.problemIR,raw===actual.problemIR?api.problemIR:compact.problemIR,"source/public ESM preserve identical entire graph");
 equal([sourceOutcome.audit.status,sourceOutcome.projection],["not_applicable",null],"source has no fabricated numeric projection");
}
const sourcePlanEvidence=JSON.stringify(evidence);
for(const variant of ["control","noIR","noPlan","missingGiven","duplicateGiven","missingDependencies","emptyDependencies","subsetDependencies","duplicateDependencies","wrongEntry","missingRequest","falseFact","extraIRChannel","placeholderPlan","injectedCell"]){
 const p=structuredClone(plan),ir=structuredClone(actual.problemIR),doc=structuredClone(scene.document);
 if(variant==="missingGiven")p.givens.shift();
 if(variant==="duplicateGiven")p.givens.push({...p.givens[0]!});
 if(variant==="missingDependencies")delete p.derived[0]!.dependsOn;
 if(variant==="emptyDependencies")p.derived[0]!.dependsOn=[];
 if(variant==="subsetDependencies")p.derived[0]!.dependsOn=[p.derived[0]!.dependsOn![0]!];
 if(variant==="duplicateDependencies")p.derived[0]!.dependsOn!.push(p.derived[0]!.dependsOn![0]!);
 if(variant==="wrongEntry")p.derived[0]!.value=99;
 if(variant==="missingRequest")ir.facts.pop();
 if(variant==="falseFact")ir.facts[0]!.statement="A=[[9,2],[3,4]]";
 if(variant==="extraIRChannel")Object.assign(ir,{hiddenRequest:"determinant A"});
 if(variant==="injectedCell")doc.quantities.push({id:"AB11",value:99});
 const retainedPlan=variant==="noPlan"?null:variant==="placeholderPlan"?actual.plan:p;
 const retainedIR=variant==="noIR"?null:ir;
 const context={question:actual.question,problemIR:retainedIR,turnPlan:retainedPlan};
 const expected=variant==="control";
 equal(engine.validateSceneDocument(doc,{sourceAuthority:context}).report.valid,expected,`${variant}/structural`);
 const compiled=engine.compileSceneDocument(doc,{sourceAuthority:context});
 equal(compiled.ok,expected,`${variant}/compile`);if(!expected)equal(compiled.renderScene,null,`${variant}/no partial ink`);
 equal(engine.validateSceneSourceAuthority(doc,actual.question,retainedIR,retainedPlan).length===0,expected,`${variant}/central`);
 equal(liveSceneSaveFailure({document:doc,...context,tier:"qualitative_verified"})===null,expected,`${variant}/live and save`);
 const artifacts:engine.SceneArtifactsV3={schemaVersion:"scene-artifacts/v3",turnPlan:retainedPlan,problemIR:retainedIR,solverResult:retainedIR?api.solverResult:null,solverAuthority:api.audit,sourcePlanEvidence,representationTier:"qualitative_verified",nonMetric:true,candidates:[],diagramResultStatus:"ready"};
 const turn:StoredTurn={id:"matrix-offline",question:actual.question,rawResponse:"",orderIndex:0,speedMultiplier:2,traceId:null,segments:[],sceneDocument:doc,sceneArtifacts:artifacts,visualStatus:"validated",sceneEngineVersion:null,validationReport:null};
 const saved=await canonicalizeTurnSceneMetadata({question:actual.question,sceneDocument:doc,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]});
 equal(saved.ok,expected,`${variant}/server persistence`);
 equal(sourceCheckedStoredTurn(turn).visualStatus==="validated",expected,`${variant}/raw stored read`);
 equal(restoreVerifiedPresentationFromTurn(turn)!==null,expected,`${variant}/restore`);
 if(saved.ok){
  equal(saved.value.sceneArtifacts?.sourcePlanEvidence,sourcePlanEvidence,"audited correction evidence retained outside scene/Plan authority");
  equal(saved.value.sceneArtifacts?.problemIR,actual.problemIR,"whole original fact-only graph survives persistence");
 }
 if(variant!=="injectedCell")equal(inferSceneCapabilities(actual.question,{turnPlan:retainedPlan??undefined,problemIR:retainedIR}).hasSourceProgram,expected,`${variant}/executed availability`);
 if(["missingRequest","falseFact","extraIRChannel"].includes(variant)){
  const refused=await planProblemAuthorityV1(actual.question,plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(ir)}}]}),{status:200})});
  assert(refused && "status" in refused);equal(refused.rawProblemIR,ir,`${variant}/normal API retains all refusal obligations`);
 }
}
equal(actual,original,"caller inputs unchanged throughout");
console.log(`PASS ${checks} actual matrix full-IR/Plan/normal API/availability/live/save/read/restore checks; student pending`);
