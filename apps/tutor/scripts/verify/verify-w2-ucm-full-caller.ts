import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProblemIRModelOutput } from "../../../../packages/tutor-core/src/planners/problemPlannerV1";
import { validateProblemIR, applySourceQuantityAuthority, synthesizeFamilyScene, validateSceneSourceAuthority, compileSceneDocument, uniformCircularCallerIssues } from "@heytutor/scene-engine";
import { rawStoredTurnSourceIssues } from "../../lib/scene/storedSceneSource";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
let checks = 0;
for (const name of ["car", "stone", "clockwise"]) {
  const c = JSON.parse(readFileSync(new URL(`../../../../packages/scene-engine/scripts/verify/fixtures/w2-ucm-live-20261006/w2-ucm-${name}.json`, import.meta.url), "utf8"));
  const checked = validateProblemIR(normalizeProblemIRModelOutput(c.rawIRs[0], c.question, c.canonicalPlan), c.question);
  assert.ok(checked.problem);
  const problem = checked.problem;
  const plan = applySourceQuantityAuthority(c.canonicalPlan, problem, c.question).plan;
  const scene = synthesizeFamilyScene({ question: c.question, turnPlan: plan, problemIR: problem });
  assert.ok(scene);
  for (const variant of ["control", "extraForce", "stale", "noPlan", "noIR", "emptyPlan", "renamedBinding", "renamedUnknown", "wrongSymbol", "wrongUnit", "falseClaim", "falseFact"] as const) {
    const actualPlan = structuredClone(plan);
    if (variant === "extraForce") actualPlan.unknowns.push({ id: "extraForce", symbol: "F", unit: "N" });
    if (variant === "stale") actualPlan.derived[0]!.value += 1;
    const actualProblem = structuredClone(problem);
    if (variant === "emptyPlan") { actualPlan.givens=[]; actualPlan.derived=[]; actualPlan.unknowns=[]; actualPlan.assumptions=[]; actualPlan.qualitativeClaims=[]; }
    if (variant === "renamedBinding") actualProblem.solveRequests[0]!.resultBinding!.turnPlanQuantityId="otherRequestedId";
    if (variant === "renamedUnknown") { const old=actualPlan.unknowns[0]!.id; actualPlan.unknowns[0]!.id="renamed"; actualPlan.derived.find(row=>row.id===old)!.id="renamed"; }
    if (variant === "wrongSymbol") actualProblem.solveRequests[0]!.resultBinding!.symbol="unbound";
    if (variant === "wrongUnit") actualProblem.solveRequests[0]!.resultBinding!.unit="N";
    if (variant === "falseClaim") actualPlan.qualitativeClaims.push({id:"false",claim:"Acceleration is zero because speed is constant",expected:true});
    if (variant === "falseFact") actualProblem.facts.find(row=>row.kind==="given")!.statement="The body travels on a straight line";
    const retainedProblem=variant === "noIR" ? null : actualProblem;
    const retainedPlan = variant === "noPlan" ? null : actualPlan;
    const admission: Parameters<typeof liveSceneSaveFailure>[0] = { document: scene.document, question: c.question, turnPlan: retainedPlan, problemIR: retainedProblem, tier: "qualitative_verified" as const };
    const stored: Parameters<typeof restoreVerifiedDiagramFromTurn>[0] = { question: c.question, sceneDocument: scene.document, sceneArtifacts: { turnPlan: retainedPlan, problemIR: retainedProblem, representationTier: "qualitative_verified" as const } };
    const expected = variant === "control";
    if (expected && liveSceneSaveFailure(admission)) console.log(name, liveSceneSaveFailure(admission));
    assert.equal(liveSceneSaveFailure(admission) === null, expected, `${name}/${variant}/live`);
    assert.equal(sceneSaveAdmissionFailure(admission) === null, expected, `${name}/${variant}/save`);
    assert.equal(rawStoredTurnSourceIssues(scene.document, stored).every(row => row.severity !== "fatal"), expected, `${name}/${variant}/read`);
    assert.equal(restoreVerifiedDiagramFromTurn(stored) !== null, expected, `${name}/${variant}/restore`);
    assert.equal(uniformCircularCallerIssues(c.question,retainedProblem,retainedPlan).length===0, expected, `${name}/${variant}/caller`);
    assert.equal(validateSceneSourceAuthority(scene.document,c.question,retainedProblem,retainedPlan).every(row=>row.severity!=="fatal"), expected, `${name}/${variant}/central`);
    const compiled=compileSceneDocument(scene.document,{sourceAuthority:{question:c.question,problemIR:retainedProblem,turnPlan:retainedPlan}});
    assert.equal(compiled.ok,expected,`${name}/${variant}/compile`);
    if(!expected) assert.equal(compiled.renderScene,null);
    assert.equal(!!synthesizeFamilyScene({question:c.question,turnPlan:retainedPlan,problemIR:retainedProblem}),expected,`${name}/${variant}/family`);
    checks += 8;
  }
}
console.log(`${checks} full actual UCM caller authority checks passed`);
