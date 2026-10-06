/** Actual run9 responses plus independent complete-source/IR trust controls.
 * Offline admission seams only: this gate never calls a provider or database. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as source from "../../../../packages/scene-engine/src/index";
import * as built from "../../../../packages/scene-engine/dist/index.js";
import { normalizeProblemIRModelOutput, bindProblemIRToTurnPlan } from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { StoredTurn } from "../../lib/boards/boardsClient";

type EngineApi = Pick<typeof source,
  "LocalDeterministicSolverProvider" | "verifyTurnPlanAgainstSolver" | "compileSceneDocument"
  | "validateProblemIR" | "validateTurnPlanV3" | "readSectionFormulaSource" | "synthesizeFamilyScene"
  | "visualObligationIssues" | "checkVisualObligations" | "deriveVisualObligations" | "sectionFormulaScene">;
type Fixture = { question: string; problem: source.ProblemIR | null; plan: source.TurnPlanV3; oracle: number[] };
type Capture = { name: string; question: string; rawIR: unknown; runtimeIR: source.ProblemIR; canonicalPlan: source.TurnPlanV3; oracle: number[] };
const captureFile = new URL("../../../../packages/scene-engine/scripts/verify/fixtures/w2-section-run9-actual-fullir.json", import.meta.url);
const captures = (JSON.parse(readFileSync(captureFile, "utf8")) as { captures: Capture[] }).captures;
let cases = 0, seamChecks = 0;

async function boundaries(api: EngineApi, fixture: Fixture, document: source.SceneDocument, accepted: boolean, label: string, geometryAccepted = accepted) {
  const { question, problem, plan } = fixture;
  const solver = problem ? await new api.LocalDeterministicSolverProvider().solve(problem) : null;
  const audit = problem && solver ? api.verifyTurnPlanAgainstSolver(problem, solver, plan, question) : null;
  const artifacts: source.SceneArtifactsV3 = {
    schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR: problem, solverResult: solver, solverAuthority: audit,
    representationTier: "exact_verified", nonMetric: false, candidates: [], selectedCandidateId: null,
    selectionReason: "run9 section offline gate", diagramResultStatus: "ready", proofObligations: [],
    budgets: { deadlineMs: 120000, planMs: 0, candidatesMs: 0 },
  };
  const turn: StoredTurn = {
    id: "offline-run9", question, rawResponse: "", orderIndex: 0, speedMultiplier: 2, traceId: null,
    segments: [], sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated",
    sceneEngineVersion: null, validationReport: null,
  };
  const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: document, sceneArtifacts: artifacts, visualStatus: "validated", segments: [] });
  const flags = [
    api.compileSceneDocument(document, { sourceAuthority: { question, problemIR: problem } }).ok,
    liveSceneSaveFailure({ document, question, turnPlan: plan, problemIR: problem, tier: "exact_verified" }) === null,
    saved.ok, sourceCheckedStoredTurn(turn).visualStatus === "validated", restoreVerifiedPresentationFromTurn(turn) !== null,
  ];
  assert.deepEqual(flags, [geometryAccepted,accepted,accepted,accepted,accepted], `${label}: compiler/live/save/read/restore`);
  if (accepted && audit) assert.equal(audit.status, "verified", `${label}: actual solver audit`);
  if (accepted && saved.ok) assert.deepEqual(saved.value.sceneArtifacts?.turnPlan, plan, `${label}: save preserves the actual Plan`);
  seamChecks += flags.length; cases++;
}


async function main(){
 for(const [name,api] of [["source",source],["built",built]] as const){
  for(const capture of captures){
   const checked=api.validateProblemIR(normalizeProblemIRModelOutput(capture.rawIR,capture.question,capture.canonicalPlan),capture.question);
   assert.ok(checked.problem);assert.deepEqual(bindProblemIRToTurnPlan(checked.problem,capture.canonicalPlan),capture.runtimeIR);
   const fixture:Fixture={question:capture.question,problem:capture.runtimeIR,plan:capture.canonicalPlan,oracle:capture.oracle};
   const before=structuredClone(fixture);
   const scene=api.synthesizeFamilyScene({question:fixture.question,turnPlan:fixture.plan,problemIR:fixture.problem});
   assert.ok(scene,`${name}/${capture.name}: unchanged actual IR`);assert.equal(scene.tier,"exact_verified");
   const reading=api.readSectionFormulaSource(fixture.question);assert.equal(reading.status,"ok");
   if(reading.status==="ok")assert.deepEqual([reading.source.point.x,reading.source.point.y],fixture.oracle);
   const line=capture.runtimeIR.entities.find(row=>row.kind==="line")!;
   assert.equal(scene.document.entities.find(row=>row.id==="seg_join")?.provenance?.sourceLabel,line.label);
   assert.equal(scene.document.entities.find(row=>row.id==="seg_join")?.label,"AB");
   assert.deepEqual(api.visualObligationIssues(capture.runtimeIR,scene.document),[]);
   await boundaries(api,fixture,scene.document,true,`${name}/${capture.name}`);
   assert.deepEqual(fixture,before,"caller immutable");
   for(const variant of ["missing-endpoint-proof","moved-endpoint","foreign-support","missing-required","missing-reveal","wrong-caption"]){
    const doc=structuredClone(scene.document);
    if(variant==="missing-endpoint-proof")doc.assertions=doc.assertions.filter(row=>!(["on","incident"].includes(row.predicate)&&row.entities.includes("pt_B")));
    if(variant==="moved-endpoint")doc.constructions.find(row=>row.id==="place_b")!.inputs.x=999;
    if(variant==="foreign-support")doc.constructions.find(row=>row.id==="join")!.inputs.end="pt_P";
    if(variant==="missing-required")doc.requiredEntityIds=doc.requiredEntityIds.filter(id=>id!=="pt_B");
    if(variant==="missing-reveal")for(const group of doc.revealGroups)group.entityIds=group.entityIds.filter(id=>id!=="pt_B");
    if(variant==="wrong-caption")doc.annotations.find(row=>row.id==="coordinates_pt_P")!.text="P=(99,99)";
    // External run9 has no endpoint incidence constraints; absence of an
    // unrequested proof is not an omission. Its source-bound geometry still passes.
    if(variant==="missing-endpoint-proof"&&capture.name==="external")continue;
    await boundaries(api,fixture,doc,false,`${name}/${capture.name}/${variant}`);
   }
   for(const change of ["foreign-line","partial-join","extra-ask","foreign-relation"]){
    const bad=structuredClone(fixture);const ir=bad.problem!;
    if(change==="foreign-line")ir.entities.find(row=>row.kind==="line")!.label="AC";
    if(change==="partial-join"){
     const f=ir.facts.find(row=>row.kind==="requested")!;f.evidence.quote=capture.name==="midpoint"?"midpoint P":"point P";
     f.evidence.start=bad.question.indexOf(f.evidence.quote);f.evidence.end=f.evidence.start+f.evidence.quote.length;
    }
    if(change==="extra-ask")ir.facts.push({...ir.facts[0]!,id:"extraAsk",statement:"Find midpoint Z",kind:"requested"});
    if(change==="foreign-relation")ir.constraints.push({id:"foreign",kind:"parallel",entityIds:[line.id,line.id],evidenceFactIds:[ir.facts[0]!.id]});
    assert.equal(api.validateProblemIR(ir,bad.question).valid,true,`${change}: schema`);
    assert.equal(api.sectionFormulaScene(bad.question,ir),null,`${name}/${capture.name}/${change}`);
    await boundaries(api,bad,scene.document,false,`${name}/${capture.name}/${change}`);
   }
   const stale=structuredClone(fixture);stale.plan.derived[0]!.value=999;
   await boundaries(api,stale,scene.document,false,`${name}/${capture.name}/stale`,true);
  }
  for(const q of [
   "Find the point P which externally divides the line segment joining A(1,2) and B(4,5) in the ratio 2:1.",
   "Find the point P which divides the line segment joining A(1,2) and B(4,5) in the ratio 2:1 externally.",
   "Find the point P which internally divides the line segment joining A(2,-1) and B(8,5) in the ratio 1:2.",
   "Find the point P which divides the line segment joining A(2,-1) and B(8,5) in the ratio 1:2 internally."]){
   const reading=api.readSectionFormulaSource(q);assert.equal(reading.status,"ok");
   if(reading.status==="ok")assert.deepEqual([reading.source.point.x,reading.source.point.y],q.includes("external")?[7,8]:[4,1]);
   const doc=api.sectionFormulaScene(q);assert.ok(doc);assert.equal(api.compileSceneDocument(doc).ok,true);
  }
  assert.equal(api.readSectionFormulaSource("In what ratio does P(4,5) divide externally the line segment joining A(2,3) and B(8,9)?").status,"inconsistent");
  assert.equal(api.readSectionFormulaSource("Find the point P which externally divides the line segment joining A(1,2) and B(4,5) in the ratio 2:1 externally.").status,"declined");
  // Exercise the shared relation check with no source regeneration shortcut.
  const ir=structuredClone(captures[1]!.runtimeIR),doc=api.synthesizeFamilyScene({question:ir.question,problemIR:ir,turnPlan:captures[1]!.canonicalPlan})!.document;
  doc.assertions=doc.assertions.filter(row=>!(row.predicate==="on"&&row.entities.includes("pt_B")));
  doc.assertions.push({id:"broad",predicate:"on",entities:["pt_A","seg_join","pt_B"],severity:"fatal"});
  assert.ok(api.visualObligationIssues(ir,doc).some(row=>row.code==="missing_spatial_relation"),"broad assertion cannot prove third operand");
 }
 console.log(`PASS ${cases} run9 whole-IR cases; ${seamChecks} trust-boundary checks, source/public ESM; no native credit`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
