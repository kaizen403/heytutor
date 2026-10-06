import assert from "node:assert/strict";
import {opticalConjugateDocument,readOpticalConjugateSource,LocalDeterministicSolverProvider,verifyTurnPlanAgainstSolver,type ProblemIR,type TurnPlanV3,type SceneArtifactsV3} from "@heytutor/scene-engine";
import {liveSceneSaveFailure} from "../../lib/scene/sceneSaveAdmission";
import {canonicalizeTurnSceneMetadata} from "../../lib/scene/turnScenePersistence";
import {sourceCheckedStoredTurn} from "../../lib/scene/storedSceneSource";
import {restoreVerifiedPresentationFromTurn} from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type {StoredTurn} from "../../lib/boards/boardsClient";
async function main() {
 let checks=0;
 for (const device of ["mirror","lens"]) for (const kind of ["concave","convex"]) {
  const question=`An object is placed 300 mm in front of a ${kind} ${device} of focal length 0.1 m. Find the image distance and magnification.`;
  const source=readOpticalConjugateSource(question)!;
  const setup=question.slice(0,question.indexOf("Find"));
  const problem:ProblemIR={schemaVersion:"problem-ir/v1",id:"concept",question,facts:[
   {id:"setup",kind:"given",statement:setup,evidence:{source:"question",quote:setup,start:0,end:setup.length}},
   {id:"ask",kind:"requested",statement:source.request,evidence:{source:"question",quote:source.request,start:setup.length,end:question.length}},
  ],entities:[{id:"sourceObject",kind:"body",label:"object",evidenceFactIds:["setup"]},{id:"sourceDevice",kind:"body",label:device,evidenceFactIds:["setup"]}],expressions:[],constraints:[],solveRequests:[],representationIntents:[{id:"apparatus",kind:"apparatus",entityIds:["sourceObject","sourceDevice"],evidenceFactIds:["setup"]}]};
  const plan:TurnPlanV3={schemaVersion:"turn-plan/v3",question,givens:[{id:"u",symbol:"u",value:300,unit:"mm",sourceText:"300 mm",provenance:"given"},{id:"f",symbol:"f",value:0.1,unit:"m",sourceText:"0.1 m",provenance:"given"}],derived:[{id:"v",symbol:"v",value:source.v,unit:"cm",provenance:"derived",dependsOn:["u","f"]}],unknowns:[{id:"v",symbol:"v",unit:"cm"}],qualitativeClaims:[],assumptions:[],lawIds:[],visualRequirement:"required"};
  const document=opticalConjugateDocument(question,plan,problem)!;assert.ok(document);
  const input={document,question,turnPlan:plan,problemIR:problem,tier:"question_representation" as const};
  assert.equal(liveSceneSaveFailure(input),null);
  const solver=await new LocalDeterministicSolverProvider().solve(problem),audit=verifyTurnPlanAgainstSolver(problem,solver,plan,question);
  assert.equal(audit.status,"not_applicable","conceptual IR has no numeric requests: not a solver certificate");
  const artifacts:SceneArtifactsV3={schemaVersion:"scene-artifacts/v3",turnPlan:plan,problemIR:problem,solverResult:solver,solverAuthority:audit,representationTier:input.tier,nonMetric:true,candidates:[],selectedCandidateId:null,selectionReason:"source conjugates",diagramResultStatus:"ready",proofObligations:[],budgets:{deadlineMs:120000,planMs:0,candidatesMs:0}};
  const saved=await canonicalizeTurnSceneMetadata({question,sceneDocument:document,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]});assert.ok(saved.ok,saved.ok?"":saved.error);
  const turn:StoredTurn={id:"offline",question,rawResponse:"",orderIndex:0,speedMultiplier:1,traceId:null,segments:[],sceneDocument:document,sceneArtifacts:artifacts,visualStatus:"validated",sceneEngineVersion:null,validationReport:null};
  assert.equal(sourceCheckedStoredTurn(turn).visualStatus,"validated");assert.ok(restoreVerifiedPresentationFromTurn(turn));checks++;
  for (const field of ["u","f","v","unknown"] as const) {
   const bad=structuredClone(plan);
   if (field==="unknown") bad.unknowns[0]!.unit="V";
   else if (field==="v") bad.derived[0]!.value=-source.v;
   else bad.givens.find(row=>row.id===field)!.value=999;
   assert.ok(liveSceneSaveFailure({...input,turnPlan:bad}));checks++;
  }
  for (const field of ["value","required","reveal"] as const) {
   const bad=structuredClone(document);
   if (field==="value") bad.quantities.find(row=>row.id==="v")!.value=999;
   else if (field==="required") bad.requiredEntityIds.pop();
   else bad.revealGroups[0]!.entityIds.pop();
   assert.ok(liveSceneSaveFailure({...input,document:bad}));
   assert.equal((await canonicalizeTurnSceneMetadata({question,sceneDocument:bad,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]})).ok,false);
   const badTurn={...turn,sceneDocument:bad};assert.equal(sourceCheckedStoredTurn(badTurn).visualStatus,"retry_required");assert.equal(restoreVerifiedPresentationFromTurn(badTurn),null);checks++;
  }
 }
 console.log(`PASS ${checks} offline optical conjugate seams; numeric full IR and student evidence remain pending`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
