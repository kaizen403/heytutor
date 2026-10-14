import assert from "node:assert/strict";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import { deriveSceneGate, selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { runScenePlanningOverlap } from "../../features/tutor-session/lib/scene/planningOverlap";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

// Independently phrased fixtures. Production sources stay in ignored context.
const fixtures = [
  { question: "Explain the probability interpretation of a quantum wavefunction.", claim: "The probability density is the squared modulus of the wavefunction.", expected: "Probability density equals modulus squared." },
  { question: "Explain constructors and object initialization.", claim: "A constructor is invoked when an instance is created.", expected: "Constructors initialize the state of a new object during instance creation." },
  { question: "Explain blood circulation through the human heart.", claim: "Trace blood flow through the chambers and both circuits.", expected: "Body to right atrium to right ventricle to lungs to left atrium to left ventricle to body; pulmonary and systemic circulation." },
  { question: "Explain neuronal action potentials.", claim: "Explain an action potential in successive stages.", expected: "At rest, then depolarization as Na+ enters, repolarization as K+ leaves, hyperpolarization, and restoration of the resting state." },
  { question: "Explain mutual induction in two coaxial solenoids labelled primary and secondary.", claim: "The primary and secondary coils share an axis.", expected: "Two coils, primary and secondary, are coaxial." },
];

async function main() {
  for (const fixture of fixtures) {
    const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: fixture.question, visualRequirement: "required",
      givens: [], unknowns: [], derived: [], assumptions: [], lawIds: [],
      qualitativeClaims: [{ id: "relation", claim: fixture.claim, expected: fixture.expected }] };
    assert(validateTurnPlanV3(plan, fixture.question).plan);
    const fast = selectFastVerifiedRepresentation({ question: fixture.question, turnPlan: plan });
    assert(fast, "symbolic source relationships should avoid unnecessary scene-model requests");
    assert.equal(fast.tier, "question_representation");
    let requests = 0;
    const planning = await runScenePlanningOverlap({ turnPlan: plan, problemAuthority: null, speculationAllowed: false,
      plannerStartedAt: Date.now(), deadlineMs: 5000,
      deriveGate: p => deriveSceneGate({ question: fixture.question, turnPlan: p, problemIR: null }),
      applyAuthority: p => ({ turnPlan: p, authority: null }), fastFigureBlocked: () => false,
      selectFast: p => selectFastVerifiedRepresentation({ question: fixture.question, turnPlan: p }),
      planScene: async () => { requests++; return null; }, revalidate: async result => result });
    assert(planning.fast);
    assert.equal(requests, 0, "the live planning seam must not pay for a scene already computed from source");
    const selected = selectProductionScene({ question: fixture.question, turnPlan: plan, problemIR: null, fastRepresentation: fast });
    assert.equal(selected.visualStatus, "validated"); assert.equal(selected.saveFailure, null);
    const presentation = buildVerifiedDiagramPresentation(fast.sceneDocument, fast.renderScene, { figureFamily: fast.family });
    assert(presentation.diagram.promptAddon?.includes("Explain these limits"), "narration must retain the component's limits");
    const metadata = { question: fixture.question, sceneDocument: fast.sceneDocument, visualStatus: "validated" as const,
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready", turnPlan: plan,
        representationTier: fast.tier, nonMetric: true, figureSource: fast.figureSource },
      segments: [{ orderIndex: 0, narration: "Synthetic teaching", spokenText: "Synthetic teaching", command: null }] };
    const saved = await canonicalizeTurnSceneMetadata(metadata);
    assert(saved.ok, "the actually taught source component must pass server persistence");
    const changed = structuredClone(metadata);
    const vector = changed.sceneDocument.constructions.find(c => c.operator === "vector");
    if (vector) [vector.inputs.start, vector.inputs.end] = [vector.inputs.end, vector.inputs.start];
    else changed.sceneDocument.source.sourceEvidence = [];
    const rejected = await canonicalizeTurnSceneMetadata(changed);
    assert.equal(rejected.ok, false, "edited source evidence or relation direction must fail server persistence");
  }
  console.log("Failure representation live planning, prompt limits, persistence and mutations passed (5 sources, zero paid requests)");
}
void main();
