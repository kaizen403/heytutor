import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import * as built from "@heytutor/scene-engine";
import * as source from "../../../../packages/scene-engine/src/index";
import {liveSceneSaveFailure} from "../../lib/scene/sceneSaveAdmission";
import {canonicalizeTurnSceneMetadata} from "../../lib/scene/turnScenePersistence";
import {sourceCheckedStoredTurn} from "../../lib/scene/storedSceneSource";
import {restoreVerifiedPresentationFromTurn} from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type {StoredTurn} from "../../lib/boards/boardsClient";
async function main() {
 const fixture=JSON.parse(readFileSync(resolve("../../packages/scene-engine/scripts/verify/fixtures/w2-section-matrix/section-w2-live-external.json"),"utf8")) as {question:string;problem:built.ProblemIR;plan:built.TurnPlanV3};
 let checks=0;
 for (const api of [source,built]) {
  const {question,problem,plan}=fixture,snapshot=structuredClone(fixture);
  const scene:built.SynthesizedFamilyScene|null=api.synthesizeFamilyScene({question,turnPlan:plan,problemIR:problem});assert.ok(scene);
  const sourceLine=scene.document.entities.find(row=>row.label==="segment AB")!;assert.equal(sourceLine.kind,"line");
  assert.ok(scene.document.assertions.some(row=>row.predicate==="on" && row.entities.includes(sourceLine.id)));
  assert.equal(api.compileSceneDocument(scene.document,{sourceAuthority:{question,problemIR:problem}}).ok,true);
  const solver=await new api.LocalDeterministicSolverProvider().solve(problem),audit=api.verifyTurnPlanAgainstSolver(problem,solver,plan,question);assert.equal(audit.status,"verified");
  const artifacts:built.SceneArtifactsV3={schemaVersion:"scene-artifacts/v3",turnPlan:plan,problemIR:problem,solverResult:solver,solverAuthority:audit,representationTier:scene.tier,nonMetric:scene.nonMetric,candidates:[],selectedCandidateId:null,selectionReason:scene.reason,diagramResultStatus:"ready",proofObligations:[],budgets:{deadlineMs:120000,planMs:0,candidatesMs:0}};
  assert.equal(liveSceneSaveFailure({document:scene.document,question,turnPlan:plan,problemIR:problem,tier:scene.tier}),null);
  const saved=await canonicalizeTurnSceneMetadata({question,sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]});assert.ok(saved.ok,saved.ok?"":saved.error);
  const turn:StoredTurn={id:"offline",question,rawResponse:"",orderIndex:0,speedMultiplier:2,traceId:null,segments:[],sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",sceneEngineVersion:null,validationReport:null};
  assert.equal(sourceCheckedStoredTurn(turn).visualStatus,"validated");assert.ok(restoreVerifiedPresentationFromTurn(turn));assert.deepEqual(fixture,snapshot);checks++;
  for (const defect of ["line-evidence","foreign-line","physical-point","line-proof"] as const) {
   const badIR:built.ProblemIR=structuredClone(problem),badDoc:built.SceneDocument=structuredClone(scene.document);
   if (defect==="line-evidence") badIR.entities.find(row=>row.id==="segAB")!.evidenceFactIds=["fP"];
   if (defect==="foreign-line") badIR.entities.find(row=>row.id==="segAB")!.label="CD";
   if (defect==="physical-point") badDoc.constructions.find(row=>row.operator==="section_point")!.inputs.n=2;
   if (defect==="line-proof") badDoc.assertions=badDoc.assertions.filter(row=>row.id!=="section_on_source_line");
   if (defect==="line-evidence" || defect==="foreign-line") assert.equal(api.synthesizeFamilyScene({question,turnPlan:plan,problemIR:badIR}),null);
   assert.equal(api.compileSceneDocument(badDoc,{sourceAuthority:{question,problemIR:badIR}}).ok,false);
   assert.ok(liveSceneSaveFailure({document:badDoc,question,turnPlan:plan,problemIR:badIR,tier:scene.tier}));checks++;
  }
 }
 console.log(`PASS ${checks} captured whole-IR section compiler/live/offline persistence controls; fresh student rerun required`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
