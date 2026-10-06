import assert from "node:assert/strict";
import { buildUniformCircularSourceFallback, compileSceneDocument, synthesizeFamilyScene, verifyTurnPlanAgainstSolver, validateUniformCircularSourceInputs, type SceneArtifactsV3 } from "@heytutor/scene-engine";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { StoredTurn } from "../../lib/boards/boardsClient";
const questions = [
  "A stone moves in a horizontal circle of radius 0.8 m with a period of 2 s. Find its speed and centripetal acceleration.",
  "A car moves on a circular track of radius 50 m at a constant speed of 20 m/s. Find its centripetal acceleration and time for one revolution.",
  "A bead moves at a constant speed of 40 cm/s in a circle of radius 2 cm. Find its centripetal acceleration and time for one revolution.",
  "A particle moves in a horizontal circle of radius 1/2 m with a period of 4 s. Find its speed and centripetal acceleration.",
  "A body moves clockwise at a constant speed of 6 m/s in a circle of radius 12 m. Find its angular speed and centripetal acceleration.",
];
async function main() {
for (const question of questions) {
  const source = await buildUniformCircularSourceFallback(question);
  assert.ok(source);
  const scene = synthesizeFamilyScene({ question, turnPlan: source.turnPlan, problemIR: source.problemIR });
  assert.ok(scene, question);
  const audit = verifyTurnPlanAgainstSolver(source.problemIR, source.solverResult, source.turnPlan, question);
  assert.equal(audit.status, "verified");
  const artifacts: SceneArtifactsV3 = { schemaVersion: "scene-artifacts/v3", turnPlan: source.turnPlan,
    problemIR: source.problemIR, solverResult: source.solverResult,
    solverAuthority: audit,
    representationTier: scene.tier, nonMetric: scene.nonMetric, candidates: [], selectedCandidateId: null,
    selectionReason: scene.reason, diagramResultStatus: "ready", proofObligations: [],
    budgets: { deadlineMs: 120000, planMs: 0, candidatesMs: 0 },
  };
  assert.equal(compileSceneDocument(scene.document, { sourceAuthority: {question, problemIR: source.problemIR} }).ok, true);
  assert.equal(liveSceneSaveFailure({document:scene.document, question, problemIR:source.problemIR,turnPlan:source.turnPlan,tier:scene.tier}), null);
  const changed = structuredClone(scene.document);
  const derived = changed.quantities.find(row => row.id === "a_c")!;
  assert.equal(typeof derived.value, "number");
  derived.value = (derived.value as number) * (1 + Number.EPSILON);
  assert.deepEqual(validateUniformCircularSourceInputs(changed, question), []);
  const saved = await canonicalizeTurnSceneMetadata({question,sceneDocument:changed,sceneArtifacts:artifacts,visualStatus:"validated",segments:[]});
  assert.ok(saved.ok, saved.ok ? "" : JSON.stringify(saved));
  if (!saved.ok) continue;
  assert.equal(saved.value.sceneDocument?.quantities.find(row => row.id === "a_c")?.value,
    scene.document.quantities.find(row => row.id === "a_c")?.value);
  const turn: StoredTurn = {id:"offline",question,rawResponse:"",orderIndex:0,speedMultiplier:1,traceId:null,segments:[],
    sceneDocument:changed,sceneArtifacts:artifacts,visualStatus:"validated",sceneEngineVersion:null,validationReport:null};
  const checked = sourceCheckedStoredTurn(turn);
  assert.equal(checked.visualStatus, "validated");
  assert.equal(checked.sceneDocument && (checked.sceneDocument as typeof changed).quantities.find(row=>row.id==="a_c")?.value,
    scene.document.quantities.find(row=>row.id==="a_c")?.value);
  const restored = restoreVerifiedPresentationFromTurn(turn);
  assert.ok(restored, question);
  assert.ok(restored.diagram.promptAddon?.includes("Actual compiled marks"));
  const forged = structuredClone(changed);
  forged.quantities.find(row=>row.id==="a_c")!.value = 999;
  assert.equal(sourceCheckedStoredTurn({...turn,sceneDocument:forged}).visualStatus,"retry_required");
  assert.equal(restoreVerifiedPresentationFromTurn({...turn,sceneDocument:forged}),null);
  assert.equal(restoreVerifiedPresentationFromTurn({...turn,question:question.replace(/radius/,"diameter")}),null);
  const extra = structuredClone(source.problemIR);
  extra.entities.push({...extra.entities[0]!,id:"secondActor",label:"bus"});
  assert.equal(compileSceneDocument(scene.document,{sourceAuthority:{question,problemIR:extra}}).ok,false);
}
console.log("W2 source lifecycle: 5 whole-IR UCM controls, canonical save/read/restore and forgery declines passed (offline; no DB or student claim)");

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
