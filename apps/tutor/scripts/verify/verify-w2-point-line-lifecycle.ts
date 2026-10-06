import assert from "node:assert/strict";
import {pointLineSourceDocument,LocalDeterministicSolverProvider,verifyTurnPlanAgainstSolver,synthesizeFamilyScene,compileSceneDocument,type ProblemIR,type TurnPlanV3,type SceneArtifactsV3} from "@heytutor/scene-engine";
import {liveSceneSaveFailure} from "../../lib/scene/sceneSaveAdmission";
import {canonicalizeTurnSceneMetadata} from "../../lib/scene/turnScenePersistence";
import {sourceCheckedStoredTurn} from "../../lib/scene/storedSceneSource";
import {restoreVerifiedPresentationFromTurn} from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type {StoredTurn} from "../../lib/boards/boardsClient";
async function main() {
 let checks=0;
 for (const combined of [false,true]) {
  const question=`Find the ${combined?"distance and ":""}perpendicular foot Q of P(0,0) from 3x+4y-25=0.`;
  const pQuote="P(0,0)",lQuote="3x+4y-25=0";
  const problem:ProblemIR={schemaVersion:"problem-ir/v1",id:"projection",question,facts:[
   {id:"p",kind:"given",statement:pQuote,evidence:{source:"question",quote:pQuote,start:question.indexOf(pQuote),end:question.indexOf(pQuote)+pQuote.length}},
   {id:"l",kind:"given",statement:lQuote,evidence:{source:"question",quote:lQuote,start:question.indexOf(lQuote),end:question.indexOf(lQuote)+lQuote.length}},
   {id:"ask",kind:"requested",statement:question,evidence:{source:"question",quote:question,start:0,end:question.length}},
  ],entities:[{id:"P",kind:"point",label:"P",evidenceFactIds:["p"]},{id:"L",kind:"line",label:"L",evidenceFactIds:["l"]},{id:"Q",kind:"point",label:"Q",evidenceFactIds:["ask"]}],expressions:[],constraints:[],representationIntents:[{id:"projection",kind:"graph",entityIds:["P","L","Q"],evidenceFactIds:["p","l","ask"]}],solveRequests:[]};
  const plan:TurnPlanV3={schemaVersion:"turn-plan/v3",question,givens:[],derived:[],unknowns:[],qualitativeClaims:[],assumptions:[],lawIds:[],visualRequirement:"required"};
  for (const [symbol,value] of [["xQ",3],["yQ",4],...(combined?[["d",5]]:[])] as Array<[string,number]>) {
   problem.expressions.push({id:`expr_${symbol}`,valueType:"scalar",root:{kind:"number",value},evidenceFactIds:["p","l","ask"]});
   problem.solveRequests.push({id:`solve_${symbol}`,kind:"evaluate",expressionId:`expr_${symbol}`,resultBinding:{turnPlanQuantityId:symbol,symbol,unit:"1",evidenceFactIds:["ask"]}});
   plan.derived.push({id:symbol,symbol,value,unit:"1",provenance:"derived"});plan.unknowns.push({id:symbol,symbol,unit:"1"});
  }
  const snapshot=structuredClone(problem);
  problem.constraints.push({id:"foot_on_source",kind:"incident",entityIds:["Q","L"],evidenceFactIds:["l","ask"]});
  assert.ok(pointLineSourceDocument(question,problem));
  const scene=synthesizeFamilyScene({question,turnPlan:plan,problemIR:problem});assert.ok(scene);
  const solver=await new LocalDeterministicSolverProvider().solve(problem),audit=verifyTurnPlanAgainstSolver(problem,solver,plan,question);assert.equal(audit.status,"verified");
  const artifacts:SceneArtifactsV3={schemaVersion:"scene-artifacts/v3",turnPlan:plan,problemIR:problem,solverResult:solver,solverAuthority:audit,representationTier:scene.tier,nonMetric:scene.nonMetric,candidates:[],selectedCandidateId:null,selectionReason:scene.reason,diagramResultStatus:"ready",proofObligations:[],budgets:{deadlineMs:120000,planMs:0,candidatesMs:0}};
  const saved=await canonicalizeTurnSceneMetadata({question,sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]});assert.ok(saved.ok,saved.ok?"":saved.error);
  const turn:StoredTurn={id:"offline",question,rawResponse:"",orderIndex:0,speedMultiplier:1,traceId:null,segments:[],sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",sceneEngineVersion:null,validationReport:null};
  assert.equal(sourceCheckedStoredTurn(turn).visualStatus,"validated");assert.ok(restoreVerifiedPresentationFromTurn(turn));assert.deepEqual({...problem,constraints:[]},snapshot);checks++;
  const bad=structuredClone(scene.document);
  if (combined) bad.annotations=[];
  else bad.entities.find(row=>row.id==="Q")!.label="H";
  assert.equal((await canonicalizeTurnSceneMetadata({question,sceneDocument:bad,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]})).ok,false);checks++;
  const wrongIR=structuredClone(problem);wrongIR.solveRequests[0]!.resultBinding!.unit="m";
  assert.equal(pointLineSourceDocument(question,wrongIR),null);
  assert.equal(compileSceneDocument(scene.document,{sourceAuthority:{question,problemIR:wrongIR}}).ok,false);
  assert.ok(liveSceneSaveFailure({document:scene.document,question,turnPlan:plan,problemIR:wrongIR,tier:scene.tier}));
  const wrongArtifacts={...artifacts,problemIR:wrongIR};
  assert.equal((await canonicalizeTurnSceneMetadata({question,sceneDocument:scene.document,sceneArtifacts:wrongArtifacts,visualStatus:"validated",segments:[]})).ok,false);
  const wrongTurn={...turn,sceneArtifacts:wrongArtifacts};assert.equal(sourceCheckedStoredTurn(wrongTurn).visualStatus,"retry_required");assert.equal(restoreVerifiedPresentationFromTurn(wrongTurn),null);checks++;
 }
 console.log(`PASS ${checks} full-IR foot-only/combined offline persistence controls; no student acceptance`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
