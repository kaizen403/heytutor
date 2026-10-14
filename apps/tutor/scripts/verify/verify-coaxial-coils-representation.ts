import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  coaxialCoilsDocument,
  coaxialCoilsRepresentationRejection,
  readCoaxialCoilsSource,
  synthesizeCoaxialCoilsRepresentation,
} from "../../../../packages/scene-engine/src/physics/coaxialCoilsRepresentation";
import { demandRejection, sceneDemand } from "../../../../packages/scene-engine/src/synthesize/sceneDemand";
import { renderSceneSvg } from "../../../../packages/scene-engine/scripts/lib/renderSceneSvg";
import { planSceneDocumentWithRepair, repairSceneDocument } from "../../../../packages/tutor-core/src/planners/scenePlannerV2";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

// Synthetic independently phrased sources; no production text or identifiers.
const sources = [
  "Two co-axial solenoids are labelled primary and secondary. Explain what happens in the secondary when the primary circuit is opened, then compare alternating primary current.",
  "A pair of coils share a common axis. The first is the primary and the second the secondary. The secondary circuit stays open. Discuss the induced emf.",
  "There are 2 coaxial coils: secondary and primary. Show the setup without assuming a winding sense or dimensions.",
  "Two solenoids have the same axis, named secondary and primary. Compare constant and changing primary currents.",
];
const output = process.argv.includes("--render") ? resolve("../../.context/monitor/coaxial-coils") : null;
if (output) mkdirSync(output, { recursive: true });
let checks = 0;
for (const [index, question] of sources.entries()) {
  const source = readCoaxialCoilsSource(question);
  assert(source, `synthetic ${index}: explicit component/name/axis source must bind`);
  const figure = synthesizeCoaxialCoilsRepresentation(question);
  assert(figure, `synthetic ${index}: source-bound apparatus must compile`);
  assert.equal(figure.tier, "question_representation");
  assert.equal(figure.nonMetric, true);
  assert.equal(figure.document.quantities.length, 0, "an apparatus sketch supplies no numeric physical authority");
  assert.equal(demandRejection(figure.document, sceneDemand(question)), null, "representation retains relevance guards");
  assert.deepEqual(figure.document.entities.filter((entity) => entity.kind === "polyline").map((entity) => entity.id), ["primary", "secondary"]);
  assert(!figure.document.constructions.some((construction) => ["connect", "symbol", "vector", "solenoid_field", "flux_sinusoid"].includes(construction.operator)), "no circuit closure, direction, field or invented state");
  assert(!figure.document.entities.some((entity) => entity.role.includes("charge") || entity.role.includes("resistor")));
  assert.equal(figure.document.source.representationTier, "question_representation");
  assert.equal(figure.document.source.nonMetric, true);
  assert(figure.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "primary"));
  assert(figure.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "secondary"));
  for (const primitive of figure.renderScene.primitives) for (const point of primitive.points) {
    assert(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert(point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700, "every source representation stays within the diagram zone");
  }
  assert.throws(() => coaxialCoilsDocument(question, { ...source, evidence: [] }), /source binding failed/, "a caller cannot forge source evidence");
  assert.equal(coaxialCoilsRepresentationRejection(figure.document, question), null, "the canonical factory graph passes independent source admission");
  const altered = structuredClone(figure.document);
  const winding = altered.constructions.find((construction) => construction.outputs.includes("primary"))!;
  const points = winding.inputs.points as number[][];
  points[0]![0] += 1;
  assert.equal(coaxialCoilsRepresentationRejection(altered, question), "coaxial_coils_source_mismatch", "normalization cannot excuse changed apparatus geometry");
  if (output) writeFileSync(resolve(output, `synthetic-${index + 1}.svg`), renderSceneSvg(figure.renderScene, {
    title: `Synthetic coaxial-coil apparatus ${index + 1}`,
    subtitle: "Question representation; no physical dimensions, winding sense, connectivity or electromagnetic values",
  }));
  checks += 16;
}
for (const question of [
  "Explain magnetic induction.",
  "Two solenoids named primary and secondary are present.",
  "Two non-coaxial coils are named primary and secondary.",
  "Two coils named primary and secondary are not on the same axis.",
  "Three coaxial solenoids are primary, secondary and tertiary.",
  "Two perpendicular coils named primary and secondary have a common axis in a different example.",
  "A primary resistor and secondary resistor are connected to a source.",
  "Two coaxial sources named primary and secondary are point charges.",
  "Two coaxial coils are primary and secondary, with the primary inside the secondary.",
  "Two coils named primary and secondary share a common axis in one setup but have different axes here.",
  "Two coaxial coils are unnamed. Compare primary batteries with secondary batteries.",
  "Two coils named primary and secondary have no common axis, but a coaxial pair appears in the textbook.",
  "Two coils named primary and secondary are present. A different coaxial pair is described in an example.",
  "Two coils are primary and secondary without a common axis.",
  "Two coaxial coils are present. A primary school and a secondary school are nearby.",
  "Two coaxial coils are present. The primary is a battery and the secondary is a resistor.",
  "Two coaxial rods and coils have primary and secondary contacts.",
  "Two coaxial coils are present. A second pair of coils is named primary and secondary.",
  "Two coaxial coils are labelled primary and secondary, but they have no common axis.",
  "Two coaxial coils are labelled primary and secondary. They do not share a common axis.",
]) {
  assert.equal(readCoaxialCoilsSource(question), null, "missing or contradictory source facts cannot borrow this apparatus");
  assert.equal(synthesizeCoaxialCoilsRepresentation(question), null);
  checks += 2;
}

// Exercise the actual transport seam without network/paid calls: a relevance
// failure must tell repair to replace unrelated apparatus, not relabel it.
async function verifyRepairTransport(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let repairPrompt = "";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    repairPrompt = JSON.stringify(body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", source: { question: sources[0] }, visualDecision: { mode: "text_only", reason: "synthetic transport fixture" } }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await repairSceneDocument(sources[0]!, { schemaVersion: "scene-document/v2", constructions: [] }, [{
      code: "scene_relevance_rejected", message: "contradicted by resistor_chain", severity: "fatal",
    }], { proxyUrl: "http://synthetic.local/chat", timeoutMs: 1000 });
    assert(repairPrompt.includes("SOURCE RELEVANCE REBUILD"));
    assert(repairPrompt.includes("Discard the unrelated construction graph"));
    assert(repairPrompt.includes("rather than inventing numeric inputs"));
    checks += 3;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyDeclineRace(): Promise<void> {
  const question = sources[0]!;
  const source = readCoaxialCoilsSource(question)!;
  const drawable = coaxialCoilsDocument(question, source);
  const declined = { ...drawable, visualDecision: { mode: "text_only", reason: "no dimensions provided" }, entities: [], constructions: [], assertions: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "optional", givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
  const requestedDecline = validateProductionSceneCandidate({ candidate: declined, question, turnPlan: plan });
  assert.equal(requestedDecline.valid, false, "a decline must not win a requested-scene race");
  assert(requestedDecline.errors.some((error) => error.code === "planner_declined_required_scene"));
  const intentionalNone = validateProductionSceneCandidate({ candidate: declined, question, turnPlan: { ...plan, visualRequirement: "none" } });
  assert.equal(intentionalNone.valid, true, "an intentional no-figure plan remains a valid decline");
  let calls = 0;
  let repairCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const repair = JSON.stringify(JSON.parse(String(init?.body))).includes("REPAIR REQUEST");
    if (repair) repairCalls += 1;
    const first = calls === 1;
    if (!first && !repair) await new Promise((resolve) => setTimeout(resolve, 25));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(first ? declined : drawable) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await planSceneDocumentWithRepair(question,
      (candidate) => validateProductionSceneCandidate({ candidate, question, turnPlan: plan }),
      { proxyUrl: "http://synthetic.local/chat", timeoutMs: 1000 });
    assert(result?.validation.valid && result.validation.value, "the scene search must reach an honest scene after the first decline");
    assert.equal(result.validation.value.document.visualDecision.mode, "scene");
    assert(result.candidates.some((candidate) => candidate.validation.errors.some((error) => error.code === "planner_declined_required_scene")), "the rejected decline remains diagnostic evidence");
    assert(repairCalls > 0 || result.response.lane === "alternate", "repair or the slower drawable sibling must survive the decline");
    checks += 7;
  } finally {
    globalThis.fetch = originalFetch;
  }
}
void (async () => {
  await verifyRepairTransport();
  await verifyDeclineRace();
  console.log(`coaxial-coil source representations: ${checks} checks passed; 4 held-out sources, 20 refusals, relevance repair and requested-decline race; paid calls 0`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
