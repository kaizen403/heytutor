import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {LocalDeterministicSolverProvider, synthesizeFamilyScene, verifyTurnPlanAgainstSolver, applyStatedCircuitAuthority, type ProblemIR, type TurnPlanV3, type SceneArtifactsV3} from "@heytutor/scene-engine";
import {liveSceneSaveFailure} from "../../lib/scene/sceneSaveAdmission";
import {canonicalizeTurnSceneMetadata} from "../../lib/scene/turnScenePersistence";
import {sourceCheckedStoredTurn} from "../../lib/scene/storedSceneSource";
import {restoreVerifiedPresentationFromTurn} from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type {StoredTurn} from "../../lib/boards/boardsClient";
const load=<T>(path:string):T=>JSON.parse(readFileSync(new URL(`../../../../packages/scene-engine/scripts/verify/fixtures/w2-ohm/${path}.json`,import.meta.url),"utf8"));
async function main() {
for (const name of ["meters","tree"]) {
 const problem=load<ProblemIR>(`w1-ohm-${name}-normalized-problem-ir`);
 const captured=load<TurnPlanV3>(`w1-ohm-${name}-${name==="tree"?"captured-planning-plan":"captured-plan"}`);
 const plan=applyStatedCircuitAuthority(problem.question,captured,{requireBoundClaims:true})!.plan;
 const scene=synthesizeFamilyScene({question:problem.question,turnPlan:plan,problemIR:problem});assert.ok(scene);
 const solver=await new LocalDeterministicSolverProvider().solve(problem);
 const audit=verifyTurnPlanAgainstSolver(problem,solver,plan,problem.question);
 assert.equal(audit.status,name==="meters"?"not_applicable":"verified",JSON.stringify(audit));
 assert.equal(liveSceneSaveFailure({document:scene.document,question:problem.question,turnPlan:plan,problemIR:problem,tier:scene.tier}),null);
 const artifacts:SceneArtifactsV3={schemaVersion:"scene-artifacts/v3",turnPlan:plan,problemIR:problem,solverResult:solver,solverAuthority:audit,representationTier:scene.tier,nonMetric:scene.nonMetric,candidates:[],selectedCandidateId:null,selectionReason:scene.reason,diagramResultStatus:"ready",proofObligations:[],budgets:{deadlineMs:120000,planMs:0,candidatesMs:0}};
 const saved=await canonicalizeTurnSceneMetadata({question:problem.question,sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]});
 assert.ok(saved.ok,saved.ok?"":saved.error);
 const turn:StoredTurn={id:"offline",question:problem.question,rawResponse:"",orderIndex:0,speedMultiplier:1,traceId:null,segments:[],sceneDocument:scene.document,sceneArtifacts:artifacts,visualStatus:"validated",sceneEngineVersion:null,validationReport:null};
 assert.equal(sourceCheckedStoredTurn(turn).visualStatus,"validated");
 assert.ok(restoreVerifiedPresentationFromTurn(turn));
 console.log(`PASS ${name}: actual whole IR live admission and offline save/read/restore`);
}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
