import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import * as engine from "@heytutor/scene-engine";
import {liveSceneSaveFailure} from "../../lib/scene/sceneSaveAdmission";
import {canonicalizeTurnSceneMetadata} from "../../lib/scene/turnScenePersistence";
import {sourceCheckedStoredTurn} from "../../lib/scene/storedSceneSource";
import {restoreVerifiedPresentationFromTurn} from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type {StoredTurn} from "../../lib/boards/boardsClient";
async function main(){
 const cases=JSON.parse(readFileSync(resolve("../../packages/scene-engine/scripts/verify/fixtures/w2-circle-source/authored-full-ir.json"),"utf8")) as Array<{problem:engine.ProblemIR}>;
 let checks=0;
 // The historical captured planner has distinct unknown/derived IDs. Its
 // authored full IR intentionally has no evaluate requests; do not let the
 // empty request loop skip the trust-boundary negatives.
 const captured=JSON.parse(readFileSync(resolve("../../packages/scene-engine/scripts/verify/fixtures/w2-circle-source/captured-batch6a-plan.json"),"utf8")) as engine.TurnPlanV3;
 const corrected=engine.applyCircleSourceAuthority(captured.question,captured,cases[0]!.problem)!.plan;

 for(const {problem} of cases){
  const question=problem.question,solver=await new engine.LocalDeterministicSolverProvider().solve(problem);
  let plan:engine.TurnPlanV3={schemaVersion:"turn-plan/v3",question,givens:[],derived:[],unknowns:[],qualitativeClaims:[],assumptions:[],lawIds:[],visualRequirement:"required"};
  for(const request of problem.solveRequests){
   const binding=request.resultBinding!;
   const value=solver.values.find(row=>row.requestId===request.id)!;
   assert.ok(typeof value.approximate==="number");
   plan.unknowns.push({id:binding.turnPlanQuantityId,symbol:binding.symbol,unit:binding.unit});
   plan.derived.push({id:binding.turnPlanQuantityId,symbol:binding.symbol,value:value.approximate!,unit:binding.unit,provenance:"derived"});
  }
  if(question===captured.question) plan=structuredClone(corrected);
  const scene=engine.synthesizeFamilyScene({question,turnPlan:plan,problemIR:problem});assert.ok(scene,question);
  const audit=engine.verifyTurnPlanAgainstSolver(problem,solver,plan,question);
  assert.equal(audit.status,problem.solveRequests.length?"verified":"not_applicable");
  assert.equal(liveSceneSaveFailure({document:scene.document,question,turnPlan:plan,problemIR:problem,tier:scene.tier}),null,question);
  const artifacts:engine.SceneArtifactsV3={schemaVersion:"scene-artifacts/v3",turnPlan:plan,problemIR:problem,solverResult:solver,solverAuthority:audit,representationTier:scene.tier,nonMetric:scene.nonMetric,candidates:[],selectedCandidateId:null,selectionReason:scene.reason,diagramResultStatus:"ready",proofObligations:[],budgets:{deadlineMs:120000,planMs:0,candidatesMs:0}};
  const saved=await canonicalizeTurnSceneMetadata({question,sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]});assert.ok(saved.ok,saved.ok?"":saved.error);
  const turn:StoredTurn={id:"offline",question,rawResponse:"",orderIndex:0,speedMultiplier:2,traceId:null,segments:[],sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",sceneEngineVersion:null,validationReport:null};
  assert.equal(sourceCheckedStoredTurn(turn).visualStatus,"validated");assert.ok(restoreVerifiedPresentationFromTurn(turn));checks++;
  const sourceOnly=engine.synthesizeFamilyScene({question});assert.ok(sourceOnly);
  assert.equal(engine.compileSceneDocument(sourceOnly.document,{sourceAuthority:{question,problemIR:undefined}}).ok,true);
  assert.equal(liveSceneSaveFailure({document:sourceOnly.document,question,turnPlan:null,tier:sourceOnly.tier}),null);checks++;
  if(plan.unknowns.length){
   for(const defect of ["unknown-unit","unknown-role","stale-value"]){
    const badPlan=structuredClone(plan);
    if(defect==="unknown-unit") badPlan.unknowns[0]!.unit="m";
    if(defect==="unknown-role") badPlan.unknowns[0]!.symbol="speed";
    if(defect==="stale-value") badPlan.derived[0]!.value+=1;
    for(const withIR of [true,false]){
     const candidate:engine.SynthesizedFamilyScene=withIR?scene:sourceOnly;
     const raw=withIR?problem:undefined;
     const badArtifacts={...artifacts,turnPlan:badPlan,problemIR:raw};
     assert.ok(liveSceneSaveFailure({document:candidate.document,question,turnPlan:badPlan,problemIR:raw,tier:candidate.tier}),defect);
     assert.equal((await canonicalizeTurnSceneMetadata({question,sceneDocument:candidate.document,sceneArtifacts:badArtifacts,visualStatus:"validated",segments:[]})).ok,false,defect);
     const badTurn={...turn,sceneDocument:candidate.document,sceneArtifacts:badArtifacts};assert.equal(sourceCheckedStoredTurn(badTurn).visualStatus,"retry_required",defect);assert.equal(restoreVerifiedPresentationFromTurn(badTurn),null,defect);checks++;
    }
   }
  }
  const bad=structuredClone(scene.document);bad.requiredEntityIds.pop();
  assert.ok(liveSceneSaveFailure({document:bad,question,turnPlan:plan,problemIR:problem,tier:scene.tier}));
  assert.equal(sourceCheckedStoredTurn({...turn,sceneDocument:bad}).visualStatus,"retry_required");assert.equal(restoreVerifiedPresentationFromTurn({...turn,sceneDocument:bad}),null);checks++;
 }
 console.log(`PASS ${checks} authored full-IR circle offline trust/lifecycle controls; no student acceptance`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
