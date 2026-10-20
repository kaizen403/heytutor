import assert from "node:assert/strict";
import { SCENE_ENGINE_VERSION, compileSceneDocument, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
const question = "A projectile is launched from a 15 m platform at 20 m/s and 30 degrees above horizontal, with g = 10 m/s^2. Show its maximum height H above level ground.";
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [
  { id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given", sourceText: "20 m/s" },
  { id: "h0", symbol: "h0", value: 15, unit: "m", provenance: "given", sourceText: "15 m platform" },
  { id: "theta", symbol: "theta", value: 30, unit: "degree", provenance: "given", sourceText: "30 degrees above horizontal" },
  { id: "g", symbol: "g", value: 10, unit: "m/s^2", provenance: "given", sourceText: "g = 10 m/s^2" }],
  derived: [{ id: "maximum_height", symbol: "H", value: 20, unit: "m", provenance: "derived" }], unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
const ids = ["path", "launch", "range", "height"];
const doc: SceneDocument = { schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "computed flight measurements" }, quantities: [],
  entities: [{ id: "path", kind: "polyline", role: "trajectory" }, { id: "launch", kind: "vector", role: "launch velocity" }, { id: "range", kind: "dimension", role: "horizontal range", label: "R" }, { id: "height", kind: "dimension", role: "maximum height above level ground", label: "H" }],
  constructions: [{ id: "shot", operator: "projectile_trajectory", inputs: { speed: 20, launchAngleDeg: 30, gravity: 10, initialHeight: 15, displayScale: 1, showMeasurements: true }, outputs: ids }],
  relations: [], assertions: [], annotations: [], requiredEntityIds: ids, revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "flight" }], teachingTimeline: [] };
let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; assert(value, message); }
const raw = doc as unknown as Record<string, unknown>;
const good = validateProductionSceneCandidate({ question, turnPlan: plan, candidate: raw });
check(good.valid && good.value, JSON.stringify(good.errors));
const selected = selectProductionScene({ question, turnPlan: plan, problemIR: null, candidateValidation: good, policy: { preferPlanner: true, allowedFigureSources: ["planner", "text_only"] } });
check(selected.representation?.figureSource === "planner" && selected.saveFailure === null, "source-backed H=20 draws and passes normal save admission");
const rise = structuredClone(doc); rise.constructions[0]!.inputs.heightReference = "launch";
check(!validateProductionSceneCandidate({ question, turnPlan: plan, candidate: rise as unknown as Record<string, unknown> }).valid, "rise5 cannot use H above-ground label");
rise.entities[3]!.label = "Δh";
check(!validateProductionSceneCandidate({ question, turnPlan: plan, candidate: rise as unknown as Record<string, unknown> }).valid, "a false above-ground role cannot rename a rise");
rise.entities[3]!.role = "maximum rise above launch";
check(validateProductionSceneCandidate({ question, turnPlan: plan, candidate: rise as unknown as Record<string, unknown> }).valid, "a distinct maximum-rise symbol remains supported");
for (const yieldPolicy of ["off", "verified_parts"] as const) {
  const reverse = structuredClone(doc); reverse.entities[3]!.label = "Δh";
  check(!validateProductionSceneCandidate({ question, turnPlan: plan, candidate: reverse as unknown as Record<string, unknown>, yieldPolicy }).valid,
    "ground height cannot acquire a rise symbol under either policy");
  reverse.entities[3]!.label = "H";
  reverse.annotations.push({ id: "reverse", kind: "label", targetIds: ["height"], text: "Δh" });
  check(!validateProductionSceneCandidate({ question, turnPlan: plan, candidate: reverse as unknown as Record<string, unknown>, yieldPolicy }).valid,
    "an annotation cannot replace ground height with rise");
  const wrongLabel = structuredClone(rise); wrongLabel.entities[3]!.label = "H";
  check(!validateProductionSceneCandidate({ question, turnPlan: plan, candidate: wrongLabel as unknown as Record<string, unknown>, yieldPolicy }).valid,
    "yield's arbitrary-symbol relaxation cannot relabel rise as H");
  check(liveSceneSaveFailure({ document: wrongLabel, question, turnPlan: plan, tier: "qualitative_verified" }) !== null, "shared save refuses a relabelled measurement");
  for (const kind of ["label", "callout", "brace", "badge", "polarity", "spin"] as const) {
    for (const labelMode of ["append", "replace"] as const) {
      const annotated = structuredClone(rise);
      annotated.annotations.push({ id: "height_label", kind, targetIds: ["height"], text: "H", ...(labelMode === "append" ? { labelMode } : {}) });
      check(!validateProductionSceneCandidate({ question, turnPlan: plan, candidate: annotated as unknown as Record<string, unknown>, yieldPolicy }).valid,
        "a conflicting append/replacing annotation cannot change measurement meaning");
      check(liveSceneSaveFailure({ document: annotated, question, turnPlan: plan, tier: "qualitative_verified" }) !== null, "shared save also refuses symbolic annotation substitution");
    }
  }
  const matching = structuredClone(rise);
  matching.annotations.push({ id: "rise_label", kind: "label", targetIds: ["height"], text: "Δh" });
  check(validateProductionSceneCandidate({ question, turnPlan: plan, candidate: matching as unknown as Record<string, unknown>, yieldPolicy }).valid,
    "matching native measurement annotation remains supported");
  matching.annotations[0]!.kind = "brace";
  check(validateProductionSceneCandidate({ question, turnPlan: plan, candidate: matching as unknown as Record<string, unknown>, yieldPolicy }).valid,
    "a brace with the same Δh owner text remains supported");
  for (const kind of ["badge", "polarity", "spin"] as const) {
    matching.annotations[0]!.kind = kind;
    check(!validateProductionSceneCandidate({ question, turnPlan: plan, candidate: matching as unknown as Record<string, unknown>, yieldPolicy }).valid,
      "truncated/split annotation text cannot establish a scalar measurement label");
  }
}
for (const symbol of ["H", "R"]) {
  const stale: TurnPlanV3 = { ...plan, derived: [{ id: "stale", symbol, value: 5, unit: "m", provenance: "derived" }] };
  const validation = validateProductionSceneCandidate({ question, turnPlan: stale, candidate: raw });
  check(!validation.valid && validation.errors.some(issue => issue.code === "projectile_measurement_plan_mismatch"), "generated H/R values cannot coexist with stale named plan scalars");
  check(liveSceneSaveFailure({ document: doc, question, turnPlan: stale, tier: "qualitative_verified" })?.includes("projectile_measurement_plan_mismatch"), "direct save applies the same generated-measurement authority audit");
}
const centimetres: TurnPlanV3 = { ...plan, derived: [{ id: "height_cm", symbol: "H", value: 2000, unit: "cm", provenance: "derived" }] };
check(validateProductionSceneCandidate({ question, turnPlan: centimetres, candidate: raw }).valid, "equivalent plan units compare as physical height");
async function verifyPersistence(): Promise<void> {
  const representation = selected.representation!;
  const metadata = { question, sceneDocument: representation.sceneDocument, sceneEngineVersion: SCENE_ENGINE_VERSION,
    validationReport: representation.validationReport, visualStatus: "validated" as const,
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: plan, representationTier: "qualitative_verified",
      nonMetric: true, candidates: [], diagramResultStatus: "ready" }, segments: [] };
  const saved = await canonicalizeTurnSceneMetadata(metadata);
  check(saved.ok, `native measurements persist: ${saved.ok ? "" : saved.error}`);
  const reopened = await canonicalizeTurnSceneMetadata({ question, ...saved.value });
  check(reopened.ok && reopened.value.sceneDocument, "persisted measurements rebuild on reopen");
  const compiled = compileSceneDocument(reopened.value.sceneDocument);
  check(compiled.ok && JSON.stringify(compiled.renderScene?.primitives) === JSON.stringify(representation.renderScene.primitives), "server rebuild keeps the measured geometry byte-identical");
  const stale = { ...metadata, sceneArtifacts: { ...metadata.sceneArtifacts,
    turnPlan: { ...plan, derived: [{ id: "maximum_height", symbol: "H", value: 5, unit: "m", provenance: "derived" }] } } };
  const rejected = await canonicalizeTurnSceneMetadata(stale);
  check(!rejected.ok && rejected.code === "scene_admission_failed", "actual persistence boundary refuses a stale generated measurement");
  const forged = structuredClone(metadata); forged.sceneDocument = structuredClone(rise);
  forged.sceneDocument.annotations.push({ id: "false_height", kind: "brace", targetIds: ["height"], text: "H" });
  const rejectedLabel = await canonicalizeTurnSceneMetadata(forged);
  check(!rejectedLabel.ok, "actual persistence boundary refuses a brace renaming rise as ground height");
}
void verifyPersistence().then(() => console.log(`projectile measurement admission: ${checks} checks passed`)).catch(error => { console.error(error); process.exitCode = 1; });
