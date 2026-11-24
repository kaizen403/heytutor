/** Public acquisition must preserve source truth before a candidate exists. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
  compileSceneDocument, SCENE_ARTIFACTS_V3_VERSION, synthesizeFamilyScene, synthesizeLastResortScene,
  validateProblemIR, validatePlanOwnedSceneTruth, type FigureSource, type ProblemIR,
  type SceneDocument, type TurnPlanV3,
} from "@heytutor/scene-engine";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { getSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { buildSourceCertifiedScientificScene } from "../../../../packages/scene-engine/src/synthesize/sourceCertifiedScientificScene";
import { readOriginalCoulombModel } from "../../../../packages/scene-engine/src/physics/sourceCoulombObligation";
import {
  selectProductionFastRepresentation, selectProductionNativeSourceRepresentation, selectProductionScene,
  validateProductionSceneCandidate,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { sourceCheckedStoredDocument, storedTurnSourceIssues } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

interface Fixture { question: string; turnPlan: TurnPlanV3; problemIR: unknown; solverResult: unknown }
interface Cases { sources: Array<{ term: string; expected: boolean }>; alternatives: string[] }
const fixture: Fixture = JSON.parse(readFileSync(new URL("./fixtures/native-coulomb-acquisition.json", import.meta.url), "utf8"));
const cases: Cases = JSON.parse(readFileSync(new URL("./fixtures/native-coulomb-acquisition-cases.json", import.meta.url), "utf8"));
const allowedFigureSources: FigureSource[] = ["native_source", "fast_family", "family", "archetype", "matrix_source", "linear_source", "source_grounded", "verified_recovery"];
const inventory = (plan: TurnPlanV3) => ({ givens: plan.givens.map(row => {
  const given = { ...row }; delete given.sourceText; return given;
}), derived: plan.derived, unknowns: plan.unknowns });

async function audit(document: SceneDocument, question: string, turnPlan: TurnPlanV3, tier: "exact_verified" | "qualitative_verified" | "question_representation", problemIR: ProblemIR | null, expected: boolean, figureSource: FigureSource = "native_source") {
  const validation = validateProductionSceneCandidate({ question, turnPlan, candidate: { ...document }, problemIR });
  assert.equal(validation.valid, expected, "fresh candidate source authority");
  assert.equal(liveSceneSaveFailure({ document, question, turnPlan, tier, problemIR }) === null, expected, "direct save source authority");
  const compiled = compileSceneDocument(document, { figureConsistency: true });
  const presentation = compiled.renderScene ? buildVerifiedDiagramPresentation(document, compiled.renderScene,
    { originalQuestion: question, turnPlan }) : null;
  const segments = (presentation?.introSegments ?? []).map((segment, orderIndex) => ({ orderIndex,
    narration: segment.narration, spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }) }));
  const turn = { question, visualStatus: "validated" as const, sceneDocument: document, segments, sceneArtifacts: {
    schemaVersion: SCENE_ARTIFACTS_V3_VERSION, representationTier: tier, nonMetric: tier !== "exact_verified",
    figureSource, diagramResultStatus: "ready" as const, turnPlan,
    ...(problemIR ? { problemIR, solverResult: fixture.solverResult } : {}),
  } };
  const saved = await canonicalizeTurnSceneMetadata(turn, { curveLabelsEnabled: false });
  assert.equal(saved.ok, expected, `canonical source authority: ${JSON.stringify(saved.ok ? null : saved)}`);
  assert.equal(Boolean(sourceCheckedStoredDocument(document, turn)), expected, "stored source authority");
  assert.equal(Boolean(restoreVerifiedPresentationFromTurn(turn)), expected, "direct restore source authority");
  if (saved.ok) {
    assert(saved.value.sceneDocument, "successful diagram save retains the scene");
    const canonical = { ...saved.value, question };
    assert(sourceCheckedStoredDocument(saved.value.sceneDocument, canonical), `canonical read: ${JSON.stringify(storedTurnSourceIssues(saved.value.sceneDocument as SceneDocument, canonical))}`);
    const restored = restoreVerifiedPresentationFromTurn(canonical);
    assert(restored && presentation, "canonical restore");
    assert.deepEqual(restored.diagram.commands, presentation.diagram.commands, "native/fallback ordered ink survives canonical replay");
    assert.deepEqual(saved.value.sceneArtifacts?.turnPlan, turnPlan, "accepted plan is preserved");
  }
  return validation;
}

async function main() {
  const checked = validateProblemIR(fixture.problemIR, fixture.question);
  assert(checked.valid && checked.problem);
  const originalPlan = JSON.stringify(fixture.turnPlan);
  const positive = selectProductionNativeSourceRepresentation(fixture.question, fixture.turnPlan, checked.problem);
  assert(positive && positive.figureSource === "native_source", "actual captured e-unit plan reaches explicit native acquisition");
  const rows: unknown[] = [];
  for (const source of cases.sources) {
    const question = fixture.question.replace("k e²", source.term), turnPlan = structuredClone(fixture.turnPlan);
    turnPlan.question = question;
    for (const row of turnPlan.givens) if (row.sourceText) row.sourceText = row.sourceText.replace("k e²", source.term);
    assert.deepEqual(inventory(turnPlan), inventory(fixture.turnPlan), "only original question and matching coupling quote change");
    const planBytes = JSON.stringify(turnPlan);
    // Changed sources deliberately have no retained IR/solver from the old question.
    const problemIR: ProblemIR | null = source.term === "k e²" ? checked.problem : null;
    const input: { question: string; turnPlan: TurnPlanV3; problemIR: ProblemIR | null } = { question, turnPlan, problemIR };
    assert.equal(Boolean(readOriginalCoulombModel(question)), source.expected, source.term);
    assert.equal(Boolean(buildSourceCertifiedScientificScene(question)), source.expected, `${source.term}: independent factory`);
    assert.equal(Boolean(buildSourceCertifiedScientificScene(question, turnPlan)), source.expected, `${source.term}: accepted-plan factory`);
    const family = synthesizeFamilyScene(input), lastResort = synthesizeLastResortScene(input);
    const fast = selectProductionFastRepresentation(input);
    const fallback = selectProductionFastRepresentation({ ...input, nativeSourceFallback: true });
    const native = selectProductionNativeSourceRepresentation(question, turnPlan, problemIR);
    if (!source.expected) {
      assert.equal(family, null, `${source.term}: family cannot restore an unsupported coupling`);
      assert.equal(lastResort, null, `${source.term}: legacy/last resort cannot restore numerical authority`);
      assert.equal(fast, null, `${source.term}: ordinary fast acquisition`);
      assert.equal(fallback, null, `${source.term}: ordinary fast plus native fallback`);
      assert.equal(native, null, `${source.term}: explicit native acquisition`);
      for (const families of [["point_field"], ["point_field", "energy_level"]]) {
        const alternatives = { ...input, families };
        assert.equal(synthesizeFamilyScene(alternatives), null, `${source.term}: supplied family roster cannot restore authority`);
        assert.equal(synthesizeLastResortScene(alternatives), null, `${source.term}: supplied legacy roster cannot restore authority`);
        assert.equal(selectProductionFastRepresentation(alternatives), null, `${source.term}: ordinary fast family roster`);
        assert.equal(selectProductionFastRepresentation({ ...alternatives, nativeSourceFallback: true }), null,
          `${source.term}: fast/native fallback family roster`);
      }
    } else {
      assert(family);
      assert(family.document.constructions.some(step => step.operator === "rutherford_scattering"));
      assert(!family.document.quantities.some(row => row.id === "b" || row.id === "impactParameter"), "no invented head-on quantity");
      if (problemIR) assert(native && fallback, "ordinary fallback and explicit native acquisition both succeed");
    }
    for (const preferPlanner of [false, true]) for (const mode of ["ordinary", "native_fallback", "explicit_native"] as const) {
      const pick = mode === "ordinary" ? fast : mode === "native_fallback" ? fallback : native;
      const result = selectProductionScene({ ...input, candidate: null, fastRepresentation: pick, completionEnabled: false,
        policy: { preferPlanner, allowedFigureSources } });
      if (!source.expected) assert.equal(result.representation, null, `${source.term}/${mode}/${preferPlanner}: final fallback`);
      if (source.term === "k e²" && mode !== "ordinary") assert(result.representation, "valid acquired native scene survives both final policies");
      if (result.representation) {
        const selected = result.representation;
        assert(!validatePlanOwnedSceneTruth(selected.sceneDocument, turnPlan).some(issue => issue.severity === "fatal"));
        await audit(selected.sceneDocument, question, turnPlan, selected.tier, problemIR, true, selected.figureSource);
        const compiled = compileSceneDocument(selected.sceneDocument, { figureConsistency: true });
        assert(compiled.ok && compiled.renderScene);
        assert(compiled.renderScene.primitives.some(p => typeof p.text === "string" && /45\.504\s*fm/.test(p.text)), "actual source-computed distance");
        assert(compiled.report.issues.some(issue => issue.code === "coulomb_finite_body_unproved"), "no finite radius is supplied");
      }
      rows.push({ source: source.term, mode, preferPlanner, selected: Boolean(result.representation) });
    }
    if (!source.expected) for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
      const cached = structuredClone(positive.sceneDocument);
      cached.source.question = question; cached.source.representationTier = tier; cached.source.nonMetric = tier !== "exact_verified";
      await audit(cached, question, turnPlan, tier, null, false);
    }
    assert.equal(JSON.stringify(turnPlan), planBytes, "acquisition and persistence must not rewrite accepted scalars");
  }
  for (const question of cases.alternatives) {
    const turnPlan = createFallbackTurnPlanV3(question), input = { question, turnPlan, problemIR: null };
    const fast = selectProductionFastRepresentation(input);
    assert(fast?.figureSource === "fast_family", "an independent valid alternative is preserved");
    for (const preferPlanner of [false, true]) {
      const result = selectProductionScene({ ...input, fastRepresentation: fast, completionEnabled: false,
        policy: { preferPlanner, allowedFigureSources } });
      assert(result.representation, "valid alternative reaches final selection");
      await audit(result.representation.sceneDocument, question, turnPlan, result.representation.tier, null, true, result.representation.figureSource);
      rows.push({ alternative: question, preferPlanner, source: result.representation.figureSource });
    }
  }
  assert.equal(JSON.stringify(fixture.turnPlan), originalPlan);
  const report = { sources: cases.sources.length, alternatives: cases.alternatives.length, rows: rows.length, allPassed: true,
    purpose: "Offline source/acquisition/persistence regression; no generated chapter or runtime acceptance", results: rows };
  const path = process.argv.find(value => value.startsWith("--report="))?.slice(9);
  if (path) writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log(`verify-native-coulomb-acquisition: ${rows.length} acquisition/final rows PASS`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
