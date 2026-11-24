/** The original captured plan must reach native ink without rewriting its physics. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
  compileSceneDocument, SCENE_ARTIFACTS_V3_VERSION, validatePlanOwnedSceneTruth, validateProblemIR,
  type SceneDocument, type TurnPlanV3, type ProblemIR,
} from "@heytutor/scene-engine";
import { getSegmentCommands, remainingDeferredAnnotations, serializeSegmentCommands, takeDeferredAnnotations } from "@heytutor/drawing";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { sourceCheckedStoredDocument } from "../../lib/scene/storedSceneSource";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

interface Fixture {
  question: string;
  turnPlan: TurnPlanV3;
  problemIR: unknown;
  solverResult: unknown;
  cases: Array<{ name: string; document: SceneDocument; expected: { candidateValid: boolean } }>;
}
const fixture: Fixture = JSON.parse(readFileSync(new URL("./fixtures/native-coulomb-reachability.json", import.meta.url), "utf8"));
const tiers = ["exact_verified", "qualitative_verified", "question_representation"] as const;
const answerText = (text: unknown) => typeof text === "string" && /r_?min|45\.504|θ\s*=\s*180|turning point/i.test(text);

async function main() {
  const rows: Array<{ name: string; tier: string; yieldPolicy: string; accepted: boolean; selected: number }> = [];
  assert.equal(fixture.question, fixture.turnPlan.question);
  assert.equal(fixture.turnPlan.givens.find(quantity => quantity.id === "qAlpha")?.unit, "e");
  assert(![...fixture.turnPlan.givens, ...fixture.turnPlan.derived].some(quantity => quantity.symbol === "b"));
  assert.equal(fixture.cases.filter(entry => entry.expected.candidateValid === true).length, 1,
    "the portable roster must retain its positive unchanged-plan case");
  assert.equal(fixture.cases.filter(entry => entry.expected.candidateValid === false).length, 5,
    "the portable roster must retain all five refusal controls");
  const originalPlan = JSON.stringify(fixture.turnPlan);
  const problem = validateProblemIR(fixture.problemIR, fixture.question);
  assert(problem.valid && problem.problem, "retain the captured original-source ProblemIR");
  const cases: Array<Fixture["cases"][number] & { plan: TurnPlanV3; question?: string }> =
    fixture.cases.map(entry => ({ ...entry, plan: fixture.turnPlan }));
  const native = fixture.cases[0]!.document;
  for (const text of ["Attraction", "No repulsion", "The force points inward", "No collision; the force points inward"]) {
    const document = structuredClone(native);
    document.annotations.push({ id: "falseModel", kind: "callout", targetIds: [document.entities[0]!.id], text });
    cases.push({ name: `contrary model: ${text}`, document, expected: { candidateValid: false }, plan: fixture.turnPlan });
  }
  const chargeLabels = structuredClone(native);
  chargeLabels.annotations.push({ id: "firstCharge", kind: "callout", targetIds: [chargeLabels.entities[0]!.id], quantityId: "qAlpha" },
    { id: "secondCharge", kind: "callout", targetIds: [chargeLabels.entities[0]!.id], quantityId: "qNucleus" });
  cases.push({ name: "source charge callouts in e", document: chargeLabels, expected: { candidateValid: true }, plan: fixture.turnPlan });
  const planSymbols = structuredClone(chargeLabels);
  for (const id of ["qAlpha", "qNucleus"]) planSymbols.quantities.find(quantity => quantity.id === id)!.symbol =
    fixture.turnPlan.givens.find(quantity => quantity.id === id)!.symbol;
  cases.push({ name: "source charge callouts retain qα and qN", document: planSymbols,
    expected: { candidateValid: true }, plan: fixture.turnPlan });
  for (const symbol of ["qN", "qα", "K"]) {
    const document = structuredClone(planSymbols);
    document.quantities.find(quantity => quantity.id === (symbol === "qα" ? "qNucleus" : "qAlpha"))!.symbol = symbol;
    cases.push({ name: `bound row cannot borrow ${symbol}`, document, expected: { candidateValid: false }, plan: fixture.turnPlan });
  }
  const energyLabel = structuredClone(native);
  energyLabel.quantities.find(quantity => quantity.id === "K")!.symbol = "K";
  energyLabel.annotations.push({ id: "sourceEnergy", kind: "callout", targetIds: [energyLabel.entities[0]!.id], quantityId: "K" });
  cases.push({ name: "source energy callout retains K", document: energyLabel, expected: { candidateValid: true }, plan: fixture.turnPlan });
  for (const symbol of ["q²", "\\hat{q_N}", "\\overline{q_N}", "q₂"]) {
    const document = structuredClone(planSymbols);
    document.quantities.find(quantity => quantity.id === "qNucleus")!.symbol = symbol;
    cases.push({ name: `complete math symbol ${symbol}`, document, expected: { candidateValid: symbol === "q₂" }, plan: fixture.turnPlan });
  }
  const indexedCoupling = structuredClone(native);
  indexedCoupling.quantities.find(quantity => quantity.id === "ke2")!.symbol = "k_e²";
  indexedCoupling.annotations.push({ id: "badCouplingNotation", kind: "callout", targetIds: [indexedCoupling.entities[0]!.id], quantityId: "ke2" });
  cases.push({ name: "indexed k is not k times e squared", document: indexedCoupling, expected: { candidateValid: false }, plan: fixture.turnPlan });
  for (const text of ["qN=7⁹ e", "qN=\\hat{79} e", "q_N=79 e"]) {
    const document = structuredClone(native);
    document.annotations.push({ id: "mathLiteral", kind: "callout", targetIds: [document.entities[0]!.id], text });
    cases.push({ name: `literal math preserves operators ${text}`, document, expected: { candidateValid: text === "q_N=79 e" }, plan: fixture.turnPlan });
  }
  for (const text of ["Z=79 e", "qN/e=79 e", "Z=79", "qN/e=79", "qN/e=79 1", "\\hat{E}=5 MeV", "\\bar{E}=5 MeV", "e=5 MeV"]) {
    const document = structuredClone(native);
    document.annotations.push({ id: "chargeConventionOrDecoration", kind: "callout", targetIds: [document.entities[0]!.id], text });
    cases.push({ name: `literal type convention ${text}`, document,
      expected: { candidateValid: ["Z=79", "qN/e=79", "qN/e=79 1"].includes(text) }, plan: fixture.turnPlan });
  }
  for (const [from, to, expected] of [
    ["k e²", "k E²", false], ["k e²", "K e²", false], ["k e²", "K E²", false], ["k e²", "KE²", false],
    ["k e²", "ke²", true], ["k e²", "k e^2", true], ["Use k e²", "USE k e²", true],
    ["+2e alpha", "+2E alpha", false], ["+79e nucleus", "+79E nucleus", false],
  ] as const) {
    const question = fixture.question.replace(from, to), plan = structuredClone(fixture.turnPlan), document = structuredClone(native);
    assert.notEqual(question, fixture.question, `source case control ${to}`);
    plan.question = question; document.source.question = question;
    for (const quantity of plan.givens) if (quantity.sourceText) quantity.sourceText = quantity.sourceText.replace(from, to);
    cases.push({ name: `original-source mathematical case ${to}`, document, expected: { candidateValid: expected }, plan, question });
  }
  const forged = structuredClone(native), forgedPlan = structuredClone(fixture.turnPlan);
  forged.constructions[0]!.inputs.resultBindings = { closestApproach: "rMin", thetaDegrees: "thetaGiven" };
  forgedPlan.givens.push({ id: "thetaGiven", symbol: "theta", value: 180, unit: "deg", provenance: "given", sourceText: "theta=180deg" });
  cases.push({ name: "unstated given cannot release computed angle", document: forged,
    expected: { candidateValid: false }, plan: forgedPlan });
  for (const extra of [
    { id: "unusedImpact", symbol: "b", value: 3, unit: "fm", sourceText: "head-on" },
    { id: "unusedEnergy", symbol: "E", value: 6, unit: "MeV", sourceText: fixture.turnPlan.givens.find(quantity => quantity.id === "K")!.sourceText },
    { id: "unusedCharge", symbol: "qα", value: 3, unit: "e", sourceText: fixture.turnPlan.givens.find(quantity => quantity.id === "qAlpha")!.sourceText },
    { id: "unusedCoupling", symbol: "ke²", value: 2, unit: "MeV fm", sourceText: fixture.turnPlan.givens.find(quantity => quantity.id === "ke2")!.sourceText },
    { id: "trueImpact", symbol: "b", value: 0, unit: "fm", sourceText: "head-on" },
    { id: "falseEnergyName", symbol: "K", value: 0, unit: "fm", sourceText: "head-on" },
    { id: "falseEnergyFromCharge", symbol: "K", value: 2, unit: "e", sourceText: fixture.turnPlan.givens.find(quantity => quantity.id === "qAlpha")!.sourceText },
    { id: "falseAtomicNumberUnit", symbol: "Z", value: 79, unit: "e", sourceText: fixture.turnPlan.givens.find(quantity => quantity.id === "qNucleus")!.sourceText },
  ]) {
    const plan = structuredClone(fixture.turnPlan);
    plan.givens.push({ ...extra, provenance: "given" });
    cases.push({ name: extra.id, document: structuredClone(native), expected: { candidateValid: extra.id === "trueImpact" }, plan });
  }
  for (const unit of ["MeV fm kg", "MeV fm s", "MeV fm s^-1", "keV pm kg"]) {
    const plan = structuredClone(fixture.turnPlan);
    plan.givens.push({ id: "extraCoupling", symbol: "ke²", value: 1.44, unit,
      sourceText: fixture.turnPlan.givens.find(quantity => quantity.id === "ke2")!.sourceText, provenance: "given" });
    cases.push({ name: `complete coupling dimension: ${unit}`, document: structuredClone(native), expected: { candidateValid: false }, plan });
  }
  for (const entry of cases) for (const tier of tiers) for (const yieldPolicy of ["off", "verified_parts"] as const) {
    const document = structuredClone(entry.document);
    const plan = entry.plan, planBefore = JSON.stringify(plan);
    const question = entry.question ?? fixture.question;
    const caseProblem: ProblemIR | null = question === fixture.question ? problem.problem : null;
    document.source.representationTier = tier;
    document.source.nonMetric = tier !== "exact_verified";
    if (yieldPolicy === "verified_parts") document.source.diagramYieldPolicy = yieldPolicy;
    else delete document.source.diagramYieldPolicy;
    const inputBefore = JSON.stringify(document);
    const expected = entry.expected.candidateValid;
    assert.equal(typeof expected, "boolean", `${entry.name}: invalid fixture expectation`);
    const context = `${entry.name}/${tier}/${yieldPolicy}`;
    const candidate = validateProductionSceneCandidate({ candidate: { ...document }, question,
      turnPlan: plan, problemIR: caseProblem, yieldPolicy });
    assert.equal(candidate.valid, expected, `${context}: candidate`);
    const compiled = compileSceneDocument(document, { figureConsistency: true });
    const live = compiled.renderScene ? buildVerifiedDiagramPresentation(document, compiled.renderScene,
      { originalQuestion: question, turnPlan: plan }) : null;
    const sceneArtifacts: {
      schemaVersion: typeof SCENE_ARTIFACTS_V3_VERSION; representationTier: typeof tier;
      nonMetric: boolean; figureSource: "planner"; diagramResultStatus: "ready";
      turnPlan: TurnPlanV3; problemIR?: ProblemIR; solverResult?: unknown;
    } = { schemaVersion: SCENE_ARTIFACTS_V3_VERSION, representationTier: tier,
      nonMetric: tier !== "exact_verified", figureSource: "planner" as const, diagramResultStatus: "ready" as const,
      turnPlan: plan, ...(caseProblem ? { problemIR: caseProblem, solverResult: fixture.solverResult } : {}) };
    const segments = (live?.introSegments ?? []).map((segment, orderIndex) => ({ orderIndex,
      narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }) }));
    const turn: { question: string; sceneDocument: SceneDocument; sceneArtifacts: typeof sceneArtifacts; segments: typeof segments } =
      { question, sceneDocument: document, sceneArtifacts, segments };
    const saved = await canonicalizeTurnSceneMetadata({ ...turn, visualStatus: "validated" }, { curveLabelsEnabled: false });
    const saveFailure = liveSceneSaveFailure({ document, question,
      turnPlan: plan, tier, problemIR: caseProblem });
    assert.equal(saveFailure === null, expected, `${context}: save admission`);
    assert.equal(saved.ok, expected, `${context}: canonical save`);
    assert.equal(Boolean(sourceCheckedStoredDocument(document, turn)), expected, `${context}: stored source`);
    assert.equal(Boolean(restoreVerifiedPresentationFromTurn(turn)), expected, `${context}: direct restore`);
    if (expected) {
      assert(compiled.ok && compiled.renderScene && live && saved.ok, context);
      assert(compiled.report.issues.some(issue => issue.code === "coulomb_finite_body_unproved"),
        `${context}: no radius is invented for the requested finite-nucleus exterior`);
      const restoredTurn = { ...saved.value, question };
      assert(sourceCheckedStoredDocument(saved.value.sceneDocument, restoredTurn), `${context}: canonical read`);
      const restored = restoreVerifiedPresentationFromTurn(restoredTurn);
      assert(restored, `${context}: canonical restore`);
      assert.equal(JSON.stringify(saved.value.sceneArtifacts?.turnPlan), planBefore, `${context}: captured plan unchanged`);
      assert.deepEqual(restored.diagram.commands, live.diagram.commands, `${context}: ordered restored ink`);
      if (entry.name.includes("source charge callouts")) {
        const ink = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text.replace(/\s/g, "")] : []);
        const first = document.quantities.find(quantity => quantity.id === "qAlpha")!.symbol;
        const second = document.quantities.find(quantity => quantity.id === "qNucleus")!.symbol;
        assert(ink.includes(`${first}=2e`) && ink.includes(`${second}=79e`), `${context}: actual bound charge symbols and values`);
      }
      for (const presentation of [live, restored]) {
        const diagram = structuredClone(presentation.diagram);
        const visibleIndices = new Set(diagram.reveals.flatMap(reveal => reveal.commandIndices));
        assert(!diagram.commands.some((command, index) => visibleIndices.has(index) && answerText(command.text)),
          `${context}: no computed native label during setup`);
        const focus = takeDeferredAnnotations(diagram, { entityIds: document.requiredEntityIds });
        assert(!focus.some(command => answerText(command.text)), `${context}: focus cannot release answers`);
        const released = remainingDeferredAnnotations(diagram).filter(command => answerText(command.text));
        assert.equal(released.length, 3, `${context}: all three native computed labels release after teaching`);
      }
    }
    let selected = 0;
    for (const preferPlanner of [false, true]) {
      const result = selectProductionScene({ question, turnPlan: plan,
        problemIR: caseProblem, candidate: { ...document }, candidateValidation: candidate,
        fastRepresentation: null, completionEnabled: false, policy: { preferPlanner } });
      if (expected) assert(result.representation?.sceneDocument.constructions.some(construction => construction.operator === "rutherford_scattering"),
        `${context}: native final selection/${preferPlanner}`);
      if (result.representation) {
        selected++;
        // A later source-proved fallback may replace a refused candidate. It
        // must pass the same truth/save boundary instead of certifying bad ink.
        assert(!validatePlanOwnedSceneTruth(result.representation.sceneDocument, plan).some(issue => issue.severity === "fatal"),
          `${context}: final source truth/${preferPlanner}`);
        assert.equal(liveSceneSaveFailure({ document: result.representation.sceneDocument, question,
          turnPlan: plan, tier: result.representation.tier, problemIR: caseProblem }), null,
        `${context}: final save authority/${preferPlanner}`);
      }
    }
    assert.equal(JSON.stringify(document), inputBefore, `${context}: candidate immutable`);
    assert.equal(JSON.stringify(plan), planBefore, `${context}: scenario plan immutable`);
    assert.equal(JSON.stringify(fixture.turnPlan), originalPlan, `${context}: original plan immutable`);
    rows.push({ name: entry.name, tier, yieldPolicy, accepted: candidate.valid, selected });
  }
  const report = { capturedFixtures: fixture.cases.length, fixtures: cases.length, rows: rows.length, allPassed: true, results: rows,
    purpose: "Source/native lifecycle regression; not a generated-lecture or chapter accuracy score." };
  const reportPath = process.argv.find(value => value.startsWith("--report="))?.slice(9);
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`verify-native-coulomb-reachability: ${rows.length} source/lifecycle rows pass`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
