import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as engine from "@heytutor/scene-engine";
import * as source from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import {parseTurnPlanV3Content as parseSourcePlan} from "../../../../packages/tutor-core/src/planners/turnPlannerV3";
import * as built from "@heytutor/tutor-core";
import {runScenePlanningOverlap} from "../../features/tutor-session/lib/scene/planningOverlap";
import {withdrawDeclinedProblemAuthority} from "../../features/tutor-session/lib/turn/declinedProblemAuthority";
import {buildTurnTeachingPrompt} from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import {canonicalizeTurnSceneMetadata} from "../../lib/scene/turnScenePersistence";
import {selectVerifiedRepresentation} from "../../features/tutor-session/lib/scene/representationFallback";
const load=(file:string)=>JSON.parse(readFileSync(new URL(`../../../../packages/scene-engine/scripts/verify/fixtures/w2-ucm-derived-text-20261006/${file}.json`,import.meta.url),"utf8"));
let checks=0;const equal=(a:unknown,b:unknown,label:string)=>{assert.deepEqual(a,b,label);checks++;};
for(const name of ["car","stone","clockwise"]){
 const c=load(`${name}-false-text-repro`),{question,problemIR,turnPlan}=c;
 const before=structuredClone(c);
 for(const [mode,api] of [["source",source],["built",built]] as const){
  const parsed=(mode==="source"?parseSourcePlan:built.parseTurnPlanV3Content)(JSON.stringify(turnPlan),question);
  equal(parsed,turnPlan,`${mode}: actual original Plan text retained before reconciliation`);
  const early=api.refuseUniformCircularPlan(question,turnPlan);assert(early);
  equal(early.rawTurnPlan,turnPlan,`${mode}: absent/failed IR still refuses full original Plan`);
  const noIRPlan=withdrawDeclinedProblemAuthority(turnPlan,early);
  equal(noIRPlan.derived,[],`${mode}: unavailable solver cannot preserve rejected text as authority`);
  const outcome=await api.planProblemAuthorityV1(question,turnPlan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(problemIR)}}]}),{status:200})});
  assert(outcome&&"status" in outcome);
  equal([outcome.status,outcome.rawProblemIR,outcome.rawTurnPlan],["source_declined",problemIR,turnPlan],`${mode}: typed API refusal retains full original false text and IR`);
  // Question-alone planning can return numeric solver results. The shared live
  // and lecture hook must refuse the original Plan BEFORE reconciliation.
  const pending=await api.planProblemAuthorityV1(question,null,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(problemIR)}}]}),{status:200})});
  assert(pending&&!("status" in pending));
  const refusal=api.refuseProblemAuthorityForPlan(question,turnPlan,pending);assert(refusal);
  equal([refusal.rawProblemIR,refusal.rawTurnPlan],[problemIR,turnPlan],`${mode}: final callback keeps whole rejected caller`);
  let applied=0;
  const planning=await runScenePlanningOverlap({turnPlan,problemAuthority:Promise.resolve(pending),speculationAllowed:false,speculationEnabled:false,plannerStartedAt:Date.now(),deadlineMs:1000,
   deriveGate:()=>({shouldPlanExactScene:false,shouldAttemptLlmScene:false,families:[],archetypeId:null,request:{}}),
   applyAuthority:(plan,authority)=>{applied++;const rejected=api.refuseProblemAuthorityForPlan(question,plan,authority);assert(rejected);return {turnPlan:withdrawDeclinedProblemAuthority(plan,rejected),authority:null};},
   fastFigureBlocked:()=>true,selectFast:()=>null,planScene:async()=>null,revalidate:async result=>result});
  equal([applied,planning.authority,planning.turnPlan.givens,planning.turnPlan.derived,planning.turnPlan.unknowns,planning.turnPlan.qualitativeClaims],[1,null,[],[],[],[]],`${mode}: terminal refusal has no solver or numeric authority`);
  const prompt=buildTurnTeachingPrompt({question,diagramPromptAddon:"",turnPlan:planning.turnPlan,solverProjection:null,codeLesson:null,isDsa:false,familiarity:"revision",fastMode:false});
  equal(turnPlan.derived.every((row:engine.TurnPlanQuantityV3)=>!JSON.stringify(prompt).includes(row.sourceText??"__absent__")),true,`${mode}: rejected worked text excluded from authoritative teaching`);
  const saved=await canonicalizeTurnSceneMetadata({question,visualStatus:"text_only",sceneDocument:null,segments:[],sceneArtifacts:{schemaVersion:"scene-artifacts/v3",turnPlan:planning.turnPlan,problemIR:null,solverResult:null,solverAuthority:null,problemIRRejection:refusal,candidates:[],diagramResultStatus:"text_only"}});assert(saved.ok);
  equal([saved.value.sceneArtifacts?.problemIRRejection?.rawProblemIR,saved.value.sceneArtifacts?.problemIRRejection?.rawTurnPlan],[problemIR,turnPlan],`${mode}: full original refusal survives normal text-only save`);
  equal(saved.value.sceneDocument,null,`${mode}: no figure saved`);
  let selected:ReturnType<typeof selectVerifiedRepresentation>|null=null;try{selected=selectVerifiedRepresentation({question,turnPlan:planning.turnPlan,problemIR:null,families:[]});}catch{}
  equal(!!selected?.renderScene?.primitives?.length,false,`${mode}: terminal empty envelope cannot regain a circular figure`);
 }
 equal(c,before,"caller inputs immutable");
}
// A separately authored positive full caller, then unknown obligations at
// every input channel. No original unsafe stone control is rewritten.
const independent=load("independent-1");
const normal=await source.planProblemAuthorityV1(independent.question,independent.canonicalPlan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(independent.rawIRs[0])}}]}),{status:200})});
assert(normal&&!("status" in normal));
const scene=engine.synthesizeFamilyScene({question:independent.question,problemIR:normal.problemIR,turnPlan:independent.canonicalPlan});assert(scene);
const mutations:[string,(ir:engine.ProblemIR,plan:engine.TurnPlanV3)=>void][]=[
 ["root",ir=>{(ir as unknown as Record<string,unknown>).hiddenAsk="Find a force";}],
 ["fact",ir=>{(ir.facts[0] as unknown as Record<string,unknown>).hiddenAsk="Find a force";}],
 ["AST",ir=>{(ir.expressions[0]!.root as unknown as Record<string,unknown>).hiddenAsk="Find a force";}],
 ["binding",ir=>{(ir.solveRequests[0]!.resultBinding as unknown as Record<string,unknown>).hiddenAsk="Find a force";}],
 ["Plan",(_ir,plan)=>{(plan as unknown as Record<string,unknown>).hiddenAsk="Find a force";}],
 ["PlanRow",(_ir,plan)=>{(plan.derived[0] as unknown as Record<string,unknown>).hiddenAsk="Find a force";}],
];
for(const [name,mutate] of mutations){
 const problem=structuredClone(normal.problemIR),plan=structuredClone(independent.canonicalPlan);mutate(problem,plan);
 const sourceAuthority={question:independent.question,problemIR:problem,turnPlan:plan};
 equal(engine.uniformCircularCallerIssues(independent.question,problem,plan).length>0,true,`${name}: original unknown obligation refuses`);
 equal(engine.validateSceneDocument(scene.document,{sourceAuthority}).report.valid,false,`${name}: structural caller context refuses`);
 const compiled=engine.compileSceneDocument(scene.document,{sourceAuthority});equal([compiled.ok,compiled.renderScene],[false,null],`${name}: atomically no compiled partial figure`);
 for(const [mode,api] of [["source",source],["built",built]] as const){
  const refused=await api.planProblemAuthorityV1(independent.question,plan,{proxyUrl:"https://offline.invalid",timeoutMs:3000,fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(problem)}}]}),{status:200})});
  assert(refused&&"status" in refused);equal([refused.rawProblemIR,refused.rawTurnPlan],[problem,plan],`${mode}/${name}: full original refused obligations retained`);
 }
}
console.log(`PASS ${checks} typed UCM API/final-hook refusal, teaching exclusion, opaque full-original persistence and caller-bound selection`);
