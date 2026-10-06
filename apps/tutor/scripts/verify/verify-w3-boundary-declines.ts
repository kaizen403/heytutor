import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as engine from "@heytutor/scene-engine";
import * as source from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import * as built from "../../../../packages/tutor-core/dist/index.js";
import {runScenePlanningOverlap} from "../../features/tutor-session/lib/scene/planningOverlap";
import {withdrawDeclinedProblemAuthority} from "../../features/tutor-session/lib/turn/declinedProblemAuthority";
import {liveSceneSaveFailure} from "../../lib/scene/sceneSaveAdmission";
import {canonicalizeTurnSceneMetadata} from "../../lib/scene/turnScenePersistence";
import {sourceCheckedStoredTurn} from "../../lib/scene/storedSceneSource";
import {restoreVerifiedPresentationFromTurn} from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type {StoredTurn} from "../../lib/boards/boardsClient";
type Profile={question:string;problem:engine.ProblemIR;plan:engine.TurnPlanV3;earlyPlan?:engine.TurnPlanV3;name?:string};
const fixtures=JSON.parse(readFileSync(new URL("../../../../packages/scene-engine/scripts/verify/fixtures/w3-boundary-declines.json",import.meta.url),"utf8")) as {profiles:Profile[];rawControls:Profile[]};
let checks=0;
function equal(a:unknown,b:unknown,message:string){assert.deepEqual(a,b,message);checks++;}
async function fetchOutcome(api:typeof source|typeof built,c:Profile){
 return api.planProblemAuthorityV1(c.question,c.plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(c.problem)}}]}),{status:200})});
}
async function missingPlan(c:Profile){
 const scene=engine.synthesizeFamilyScene({question:c.question,problemIR:c.problem,turnPlan:c.plan});assert(scene);
 const artifacts:engine.SceneArtifactsV3={schemaVersion:"scene-artifacts/v3",problemIR:c.problem,representationTier:"exact_verified",nonMetric:true,candidates:[],diagramResultStatus:"ready"};
 const turn:StoredTurn={id:"offline-missing-plan",question:c.question,rawResponse:"",orderIndex:0,speedMultiplier:2,traceId:null,segments:[],sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",sceneEngineVersion:null,validationReport:null};
 const saved=await canonicalizeTurnSceneMetadata({question:c.question,sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]});
 equal([engine.validateSceneDocument(scene.document,{sourceAuthority:{question:c.question,problemIR:c.problem}}).report.valid,
 engine.compileSceneDocument(scene.document,{sourceAuthority:{question:c.question,problemIR:c.problem}}).ok,
 liveSceneSaveFailure({document:scene.document,question:c.question,problemIR:c.problem,turnPlan:null,tier:"exact_verified"})===null,
 saved.ok,sourceCheckedStoredTurn(turn).visualStatus==="validated",restoreVerifiedPresentationFromTurn(turn)!==null],Array(6).fill(false),"missing actualPlan declines all six boundaries");
 equal(engine.synthesizeFamilyScene({question:c.question,problemIR:c.problem}),null,"missingPlan cannot synthesize a whole turn");
}
async function main(){
 for(const [mode,api] of [["source",source],["built",built]] as const){
  for(const bad of fixtures.profiles){
   const before=structuredClone(bad),outcome=await fetchOutcome(api,bad);assert(outcome&&"status" in outcome);
   equal(outcome.status,"source_declined",`${mode}: actual rejected IR differs from unavailable`);
   equal(outcome.rawProblemIR,bad.problem,"entire original raw input retained");
   const early=engine.applySourceQuantityAuthority({...bad.plan,derived:bad.plan.derived.map(row=>({...row,value:777}))},null,bad.question).plan;
   equal(early.derived[0]?.value,bad.plan.derived[0]?.value,"independent source correction alone is not whole-IR authority");
   let unavailableCalls=0,authorityCalls=0;
   const planning=await runScenePlanningOverlap({turnPlan:early,problemAuthority:Promise.resolve(null),speculationAllowed:false,speculationEnabled:false,plannerStartedAt:Date.now(),deadlineMs:1000,
    deriveGate:()=>({shouldPlanExactScene:false,shouldAttemptLlmScene:false,families:[],archetypeId:null,request:{}}),
    applyAuthority:(plan,authority)=>{authorityCalls++;return {turnPlan:plan,authority}},
    applyUnavailableAuthority:plan=>{unavailableCalls++;return withdrawDeclinedProblemAuthority(plan,outcome)},
    fastFigureBlocked:()=>true,selectFast:()=>null,planScene:async()=>null,revalidate:async result=>result});
   equal([planning.turnPlan.derived.length,planning.turnPlan.unknowns.length,planning.turnPlan.qualitativeClaims.length],[0,0,0],"actual rejected graph withdraws final numeric/unknown/claim rows");
   equal([unavailableCalls,authorityCalls],[1,0],"final refusal delivered exactly once before final gates");
   const saved=await canonicalizeTurnSceneMetadata({question:bad.question,visualStatus:"text_only",segments:[],sceneDocument:null,sceneArtifacts:{schemaVersion:"scene-artifacts/v3",turnPlan:planning.turnPlan,problemIRRejection:outcome,candidates:[],diagramResultStatus:"text_only"}});
   assert(saved.ok);equal(saved.value.sceneArtifacts?.problemIRRejection,outcome,"refusal evidence survives text-only save without becoming authority");
   equal(bad,before,"input unchanged");
   const positive=structuredClone(bad);positive.problem.facts.find(fact=>fact.kind==="requested")!.statement=positive.problem.facts.find(fact=>fact.kind==="requested")!.evidence.quote;
   const accepted=await fetchOutcome(api,positive);assert(accepted&&!("status" in accepted));equal(accepted.audit.status,"verified","normal positive exact arithmetic");equal(accepted.problemIR,positive.problem,"whole positive graph unchanged");
   await missingPlan(positive);
  }
  for(const control of fixtures.rawControls){
   const before=structuredClone(control),outcome=await fetchOutcome(api,control);assert(outcome&&"status" in outcome,control.name);
   equal(outcome.rawProblemIR,control.problem,`${mode}: unconsumed raw field/request/binding cannot disappear`);equal(control,before,"raw caller immutable");
  }
  const positive=structuredClone(fixtures.profiles[1]!);
  positive.problem.facts.find(fact=>fact.kind==="requested")!.statement=positive.problem.facts.find(fact=>fact.kind==="requested")!.evidence.quote;
  for(const content of ["null","not JSON"]){
   const refused=await api.planProblemAuthorityV1(positive.question,positive.plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200})});
   assert(refused&&"status" in refused);
   equal(refused.rawProblemIR,null,"original null/unparseable refusal is retained without fake IR");
   const cleaned=withdrawDeclinedProblemAuthority(positive.plan,refused);
   equal([cleaned.derived.length,cleaned.unknowns.length,cleaned.qualitativeClaims.length],[0,0,0],`${mode}: explicit refusal status overrides early null correction`);
  }
  for(const [kind,expr] of [["function","(2+x)^6.000000000000000001"],["scalar","240+1e-999"],["scalar","240.000000000000000001"]] as const){
   const raw=structuredClone(positive.problem) as unknown as {expressions:Array<Record<string,unknown>>};
   const expression=raw.expressions.find(row=>row.valueType===kind)!;
   delete expression.root;expression.expr=expr;
   const refused=await api.planProblemAuthorityV1(positive.question,positive.plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(raw)}}]}),{status:200})});
   assert(refused&&"status" in refused);
   equal(refused.status,"source_declined",`${mode}: numeric compact lexeme cannot round into authority`);
   equal(refused.rawProblemIR,raw,"complete original compact input retained");
  }
  for(const placement of ["root","derived","unknown","given"] as const){
   const bad=structuredClone(positive.plan);
   if(placement==="given")bad.givens.push({id:"actual_exponent",symbol:"n",value:6,unit:"1",provenance:"given",sourceText:"(2+x)^6"});
   equal(engine.finiteBinomialPlanIssues(positive.question,positive.problem,bad),[],"Plan mutation begins with an independently valid source control");
   const row=placement==="root"?bad:placement==="derived"?bad.derived[0]!:placement==="unknown"?bad.unknowns[0]!:bad.givens[0]!;
   (row as unknown as Record<string,unknown>).extraObligations=["Find another coefficient and prove its sign"];
   const refused=await api.planProblemAuthorityV1(positive.question,bad,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(positive.problem)}}]}),{status:200})});
   assert(refused&&"status" in refused);
   equal(refused.rawTurnPlan,bad,`${mode}: complete refused caller Plan is evidence, not a pruned source permission`);
   const cleaned=withdrawDeclinedProblemAuthority(bad,refused);
   equal([cleaned.derived.length,cleaned.unknowns.length,cleaned.qualitativeClaims.length],[0,0,0],"unmodeled actual Plan never retains final numeric authority");
   const saved=await canonicalizeTurnSceneMetadata({question:positive.question,visualStatus:"text_only",segments:[],sceneDocument:null,sceneArtifacts:{schemaVersion:"scene-artifacts/v3",turnPlan:cleaned,problemIRRejection:refused,candidates:[],diagramResultStatus:"text_only"}});
   assert(saved.ok);equal(saved.value.sceneArtifacts?.problemIRRejection?.rawTurnPlan,bad,"original whole Plan survives bounded refusal persistence");
  }
 }
 console.log(`PASS ${checks} typed rejection, complete raw graph, overlap withdrawal and mandatory Plan TS/public ESM controls; no native credit`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
