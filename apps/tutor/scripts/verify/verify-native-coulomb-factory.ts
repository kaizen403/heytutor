/** Accepted-plan native factory mapping: source and lifecycle controls. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as engine from "@heytutor/scene-engine";
import { buildSourceCertifiedScientificScene } from "../../../../packages/scene-engine/src/synthesize/sourceCertifiedScientificScene";
import { validateProductionSceneCandidate, selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredDocument } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { remainingDeferredAnnotations } from "@heytutor/drawing";
const out = dirname(fileURLToPath(import.meta.url));
interface Fixture { question: string; turnPlan: engine.TurnPlanV3; problemIR: unknown; solverResult: unknown }
const fixture: Fixture = JSON.parse(readFileSync(resolve(out, "fixtures/native-coulomb-reachability.json"), "utf8"));
interface Case { name: string; question: string; plan: engine.TurnPlanV3; expected: boolean; ir: unknown; solver: unknown }
const cases: Case[] = [];
const originalQuestion: string = fixture.question, originalPlan: engine.TurnPlanV3 = fixture.turnPlan;
const q = (plan: engine.TurnPlanV3, id: string) => plan.givens.find(row => row.id === id)!;
function scenario(name: string, mutate: (value: Case) => void = () => {}, expected = false) {
  const value: Case = { name, question: originalQuestion, plan: structuredClone(originalPlan), expected, ir: fixture.problemIR, solver: fixture.solverResult };
  mutate(value); cases.push(value);
}
scenario("captured unchanged question and plan", () => {}, true);
scenario("reordered givens", value => { value.plan.givens.reverse(); }, true);
scenario("opaque source and result ids", value => {
  const mapping: Record<string, string> = { qAlpha: "a7", qNucleus: "t4", K: "v9", ke2: "p6", rMin: "x3" };
  for (const row of [...value.plan.givens, ...value.plan.derived, ...value.plan.unknowns]) {
    row.id = mapping[row.id] ?? row.id;
    if ("dependsOn" in row && Array.isArray(row.dependsOn)) row.dependsOn = row.dependsOn.map((id: string) => mapping[id] ?? id);
  }
  for (const claim of value.plan.qualitativeClaims) if (claim.relatedQuantityIds) claim.relatedQuantityIds = claim.relatedQuantityIds.map(id => mapping[id] ?? id);
  value.ir = null; value.solver = null;
}, true);
scenario("dimensionless charge-count representation", value => { q(value.plan, "qAlpha").unit = "1"; q(value.plan, "qNucleus").unit = "1"; }, true);
scenario("explicit inferred zero in derived roster", value => {
  value.plan.derived.push({ id: "impact0", symbol: "b", value: 0, unit: "fm", sourceText: "head-on", provenance: "derived" });
}, true);
scenario("explicit inferred zero in given roster", value => {
  value.plan.givens.push({ id: "impact0", symbol: "b", value: 0, unit: "fm", sourceText: "head-on", provenance: "given" });
}, true);
scenario("unknown-only closest-approach binding", value => { value.plan.derived = []; }, true);
scenario("derived-only closest-approach binding", value => { value.plan.unknowns = []; value.ir = null; value.solver = null; }, true);
scenario("equivalent result symbol spelling", value => { value.plan.unknowns[0]!.symbol = "r_min"; }, true);
scenario("same-valued charges retain source ownership", value => {
  value.question = originalQuestion.replace("+79e nucleus", "+2e nucleus"); value.plan.question = value.question;
  q(value.plan, "qNucleus").value = 2; q(value.plan, "qNucleus").sourceText = "+2e nucleus";
  value.plan.derived[0]!.value = 1.152; value.plan.derived[0]!.sourceText = "rmin = (2 × 2 × 1.44)/5.00";
  value.plan.qualitativeClaims[0]!.expected = "The alpha turns at the computed closest approach in the disclosed point-target model.";
  value.plan.assumptions = ["The target is fixed; its finite nuclear size is not supplied."];
  value.ir = null; value.solver = null;
}, true);
for (const id of ["qAlpha", "qNucleus", "K", "ke2"]) {
  scenario(`${id}: missing source fragment`, value => { delete q(value.plan, id).sourceText; });
  scenario(`${id}: wrong source fragment`, value => { q(value.plan, id).sourceText = "not in the original question"; });
  scenario(`${id}: wrong value`, value => { q(value.plan, id).value *= 2; });
  scenario(`${id}: wrong unit`, value => { q(value.plan, id).unit = "C"; });
}
scenario("missing projectile source quantity", value => { value.plan.givens = value.plan.givens.filter(row => row.id !== "qAlpha"); });
scenario("whole-question fragment cannot identify one slot", value => { q(value.plan, "qAlpha").sourceText = originalQuestion; });
scenario("duplicate source-role alias", value => { value.plan.givens.push({ ...q(value.plan, "qAlpha"), id: "borrowed_alias", symbol: "other" }); });
scenario("source slots exchanged", value => {
  const alpha = q(value.plan, "qAlpha"), target = q(value.plan, "qNucleus"); [alpha.sourceText, target.sourceText] = [target.sourceText, alpha.sourceText];
});
scenario("same-valued bare source occurrence is ambiguous", value => {
  value.question = originalQuestion.replace("+79e nucleus", "+2e nucleus"); value.plan.question = value.question;
  q(value.plan, "qNucleus").value = 2; q(value.plan, "qNucleus").sourceText = "+2"; q(value.plan, "qAlpha").sourceText = "+2";
  value.plan.derived[0]!.value = 1.152; value.plan.derived[0]!.sourceText = "rmin = (2 × 2 × 1.44)/5.00";
  value.plan.qualitativeClaims[0]!.expected = "The alpha turns at the computed closest approach in the disclosed point-target model.";
  value.plan.assumptions = ["The target is fixed; its finite nuclear size is not supplied."];
  value.ir = null; value.solver = null;
});
scenario("single length quantity cannot identify the output", value => {
  value.plan.unknowns = [{ id: "x", symbol: "x", unit: "fm" }];
  value.plan.derived = [{ id: "x", symbol: "x", value: 45.504, unit: "fm", sourceText: "output", provenance: "derived" }];
});
scenario("stale closest approach", value => { value.plan.derived[0]!.value = 44; });
scenario("duplicate closest-approach aliases", value => { value.plan.unknowns.push({ id: "another", symbol: "closestApproach", unit: "fm" }); });
scenario("conflicting explicit result identity", value => {
  value.plan.unknowns[0]!.id = "thetaDegrees"; value.plan.derived[0]!.id = "thetaDegrees";
});
scenario("wrong output unit", value => { value.plan.unknowns[0]!.unit = "m"; value.plan.derived[0]!.unit = "m"; });
scenario("source-unstated given angle", value => { value.plan.givens.push({ id: "thetaGiven", symbol: "theta", value: 180, unit: "deg", sourceText: "head-on", provenance: "given" }); });
scenario("unused wrong given impact", value => { value.plan.givens.push({ id: "badImpact", symbol: "b", value: 3, unit: "fm", sourceText: "head-on", provenance: "given" }); });
scenario("unused wrong derived impact", value => { value.plan.derived.push({ id: "badImpact", symbol: "b", value: 3, unit: "fm", sourceText: "head-on", provenance: "derived" }); });
scenario("extra unrelated given cannot be ignored", value => { value.plan.givens.push({ id: "unprovedRadius", symbol: "R_N", value: 7, unit: "fm", sourceText: "outside the nucleus", provenance: "given" }); });
scenario("restated source cannot replace original", value => { value.plan.question = originalQuestion.replace("5.00 MeV", "6.00 MeV"); });
scenario("quoted source remains unproved", value => { value.question = `"${originalQuestion}"`; value.plan.question = value.question; value.ir = null; value.solver = null; });
scenario("finite radius remains unproved", value => { value.question += " The nuclear radius is 7 fm."; value.plan.question = value.question; value.ir = null; value.solver = null; });
for (const symbol of ["r_{min}", "closestApproach", "distance of closest approach", "closest distance"]) {
  scenario(`whole supported output name ${symbol}`, value => {
    value.plan.unknowns[0]!.symbol = symbol; value.plan.derived[0]!.symbol = symbol;
    value.ir = null; value.solver = null;
  }, true);
}
for (const symbol of ["rᵐⁱⁿ", "ｒｍｉｎ", "RMIN", "r^min", "r_m_i_n", "\\hat{r}_{min}", "\\bar{r}_{min}"]) {
  scenario(`distinct output notation ${symbol}`, value => {
    value.plan.unknowns[0]!.symbol = symbol; value.plan.derived[0]!.symbol = symbol;
    value.ir = null; value.solver = null;
  });
}
for (const source of ["k E²", "K e²", "K E²", "KE²", "ke²", "k e^2"]) {
  scenario(`original coupling mathematical case ${source}`, value => {
    value.question = value.question.replace("k e²", source); value.plan.question = value.question;
    for (const row of value.plan.givens) if (row.sourceText) row.sourceText = row.sourceText.replace("k e²", source);
    value.ir = null; value.solver = null;
  }, ["ke²", "k e^2"].includes(source));
}

const answers = (text: unknown) => typeof text === "string" && /r_?min|θ\s*=|turning point/i.test(text);
async function main() {
  const rows: unknown[] = [], failures: string[] = [], canonicalPlanDeltas: unknown[] = [];
  for (const test of cases) {
    const before = JSON.stringify(test.plan), result = buildSourceCertifiedScientificScene(test.question, test.plan);
    assert.equal(Boolean(result), test.expected, `${test.name}: bounded factory projection`);
    assert.equal(JSON.stringify(test.plan), before, `${test.name}: plan immutable`);
    if (!result) { rows.push({ name: test.name, expected: false, built: false }); continue; }
    assert.equal(result.document.source.question, test.question);
    const family = engine.synthesizeFamilyScene({ question: test.question, turnPlan: test.plan, problemIR: null });
    assert(family?.document.constructions.some(construction => construction.operator === "rutherford_scattering"), `${test.name}: public family entry forwards accepted plan`);
    for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const)
      for (const yieldPolicy of ["off", "verified_parts"] as const) {
        const document = structuredClone(result.document), label = `${test.name}/${tier}/${yieldPolicy}`;
        document.source.representationTier = tier; document.source.nonMetric = tier !== "exact_verified";
        if (yieldPolicy === "verified_parts") document.source.diagramYieldPolicy = yieldPolicy;
        else delete document.source.diagramYieldPolicy;
        const parsedIR = test.ir == null ? null : engine.validateProblemIR(test.ir, test.question).problem;
        const candidate = validateProductionSceneCandidate({ candidate: { ...document }, question: test.question, turnPlan: test.plan, problemIR: test.ir, yieldPolicy });
        if (!candidate.valid) failures.push(`${label}: candidate ${candidate.errors.map(issue => issue.code).join(",")}`);
        const selections = [false, true].map(preferPlanner => selectProductionScene({ question: test.question, turnPlan: test.plan, problemIR: parsedIR,
          candidate: { ...document }, candidateValidation: candidate, fastRepresentation: null, completionEnabled: false, policy: { preferPlanner } }));
        for (const selection of selections) if (!selection.representation?.sceneDocument.constructions.some(construction => construction.operator === "rutherford_scattering")) failures.push(`${label}: final selection`);
        const compiled = engine.compileSceneDocument(document, { figureConsistency: true });
        if (!compiled.ok || !compiled.renderScene) throw Error(`${label}: source/native compile failed`);
        assert(compiled.report.issues.some(issue => issue.code === "coulomb_finite_body_unproved"), `${label}: finite-radius warning retained`);
        const live = buildVerifiedDiagramPresentation(document, compiled.renderScene, { originalQuestion: test.question, turnPlan: test.plan });
        const turn = { question: test.question, sceneDocument: document, visualStatus: "validated" as const, segments: [], sceneArtifacts: {
          schemaVersion: engine.SCENE_ARTIFACTS_V3_VERSION, turnPlan: test.plan, representationTier: tier, nonMetric: tier !== "exact_verified",
          figureSource: "planner" as const, diagramResultStatus: "ready" as const, candidates: [], problemIR: test.ir, solverResult: test.solver } };
        const saveFailure = liveSceneSaveFailure({ document, question: test.question, turnPlan: test.plan, tier, problemIR: test.ir });
        const canonical = await canonicalizeTurnSceneMetadata(turn, { curveLabelsEnabled: false });
        const read = Boolean(sourceCheckedStoredDocument(document, turn)), restored = restoreVerifiedPresentationFromTurn(turn);
        if (saveFailure || !canonical.ok || !read || !restored) failures.push(`${label}: lifecycle ${saveFailure ?? (!canonical.ok ? canonical.error : "read/restore")}`);
        if (canonical.ok) {
          const stored = { ...canonical.value, question: test.question };
          if (!sourceCheckedStoredDocument(stored.sceneDocument, stored) || !restoreVerifiedPresentationFromTurn(stored)) failures.push(`${label}: canonical read/restore`);
          const storedPlan = stored.sceneArtifacts?.turnPlan;
          if (JSON.stringify(storedPlan) !== before) {
            canonicalPlanDeltas.push({ name: test.name, tier, yieldPolicy, input: test.plan, stored: storedPlan });
            assert.notEqual(test.name, "captured unchanged question and plan", `${label}: actual captured plan must remain byte-equivalent`);
            assert(storedPlan, `${label}: canonical plan exists`);
            assert.deepEqual({ ...storedPlan, unknowns: [] }, { ...test.plan, unknowns: [] }, `${label}: only unknown inventory may normalize`);
            for (const unknown of test.plan.unknowns) assert(storedPlan.unknowns.some(row => row.id === unknown.id && row.unit === unknown.unit), `${label}: unknown identity/unit retained`);
          }
        }
        const visible = new Set(live.diagram.reveals.flatMap(reveal => reveal.commandIndices));
        assert(!live.diagram.commands.some((command, index) => visible.has(index) && answers(command.text)), `${label}: native computed labels not in setup`);
        assert.equal(remainingDeferredAnnotations(structuredClone(live.diagram)).filter(command => answers(command.text)).length, 3, `${label}: computed labels retain teaching-complete release`);
        assert.equal(JSON.stringify(test.plan), before, `${label}: plan remains unchanged`);
        rows.push({ name: test.name, tier, yieldPolicy, built: true, candidateValid: candidate.valid,
          selectionNative: selections.map(selection => selection.representation?.figureSource ?? null), saveFailure,
          canonical: canonical.ok, read, restore: Boolean(restored) });
      }
  }
  const reportPath = process.argv.find(value => value.startsWith("--report="))?.slice(9);
  if (reportPath) writeFileSync(reportPath, JSON.stringify({ cases: cases.length, positives: cases.filter(test => test.expected).length,
    rows: rows.length, failures, canonicalPlanDeltas, results: rows }, null, 2) + "\n");
  console.log(JSON.stringify({ cases: cases.length, rows: rows.length, failures: failures.slice(0, 15), failureCount: failures.length }, null, 2));
  assert.equal(failures.length, 0);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
