/** Synthetic regressions for production diagram admission; no model or student data. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument, validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

type Quantity = TurnPlanV3["givens"][number];
const given = (id: string, value: number, unit: string): Quantity => ({ id, symbol: id, value, unit, provenance: "given" });
function plan(question: string, givens: Quantity[], derived: TurnPlanV3["derived"] = []): TurnPlanV3 {
  const result = validateTurnPlanV3({ schemaVersion: "turn-plan/v3", question, givens, derived,
    unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" }, question);
  assert(result.plan, JSON.stringify(result.issues));
  return result.plan;
}
const policy = { preferPlanner: true, allowedFigureSources: ["planner", "verified_recovery", "text_only"] as const,
  allowVerifiedSourceRecovery: true };
async function checkSaved(question: string, turnPlan: TurnPlanV3) {
  const result = selectProductionScene({ question, turnPlan, problemIR: null, policy });
  assert(result.representation, result.reason);
  assert(compileSceneDocument(result.representation.sceneDocument).ok);
  const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: result.representation.sceneDocument,
    visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan,
      representationTier: result.representation.tier, nonMetric: result.representation.nonMetric,
      diagramResultStatus: "ready" }, segments: [] });
  assert(saved.ok, saved.ok ? "saved" : saved.error);
  return result;
}

async function main() {
  const question = "Three resistors of 3 ohm, 6 ohm and 9 ohm are connected in parallel. Find the equivalent resistance.";
  const raw = { ...plan(question, [given("r1", 3, "Ω"), given("r2", 6, "Ω"), given("r3", 9, "Ω")]),
    derived: [{ id: "req", symbol: "R_eq", value: 18 / 11, unit: "Ω", provenance: "derived",
      sourceText: "1/R_eq = 1/3 + 1/6 + 1/9 = 11/18 Ω⁻¹; R_eq = 18/11 Ω ≈ 1.6363636363636365 Ω" }] };
  for (const inverseUnit of ["Ω⁻¹", "Ω^-1", "Ω^(-1)"]) {
    const checked = validateTurnPlanV3({ ...raw, derived: raw.derived.map((d) => ({ ...d, sourceText: d.sourceText.replace("Ω⁻¹", inverseUnit) })) }, question);
    assert(checked.valid, `correct reciprocal chain with ${inverseUnit}: ${JSON.stringify(checked.issues)}`);
  }
  const groupedReciprocal = validateTurnPlanV3({ ...raw, derived: raw.derived.map((d) => ({ ...d,
    sourceText: d.sourceText.replace("11/18 Ω⁻¹", "(11/18 Ω^-1)") })) }, question);
  assert(groupedReciprocal.valid, "unit exponent stripping must preserve the surrounding arithmetic parentheses");
  const validatedCircuit = validateTurnPlanV3(raw, question);
  await checkSaved(question, validatedCircuit.plan!);
  const wrong = validateTurnPlanV3({ ...raw, derived: raw.derived.map((d) => ({ ...d, sourceText: d.sourceText.replace("11/18", "13/18") })) }, question);
  assert(!wrong.valid, "wrong reciprocal equation must remain rejected");
  console.log("reciprocal arithmetic: correct unit powers pass, conflicting equation fails");

  const projectile = "A ball is thrown horizontally at 8 m/s from a cliff 45 m high. Take g = 10 m/s^2. Find the horizontal range.";
  const projectilePlan = plan(projectile, [given("u", 8, "m/s"), given("h", 45, "m"), given("g", 10, "m/s^2")],
    [{ ...given("x", 24, "m"), provenance: "derived", sourceText: "x = 8*3 = 24 m" }]);
  const flight = await checkSaved(projectile, projectilePlan);
  assert(flight.representation!.renderScene.primitives.some((p) => "text" in p && p.text === "R=24 m"), "explicit gravity controls range");
  const stale = selectProductionScene({ question: projectile, turnPlan: { ...projectilePlan,
    derived: [{ ...projectilePlan.derived[0]!, value: 25, sourceText: "x" }] }, problemIR: null, policy });
  assert.equal(stale.representation, null, "stale range must not pair with a correct figure");
  console.log("projectile: explicit gravity controls geometry; stale plan remains rejected");

  const mirror = "An object is placed 30 cm in front of a concave mirror of focal length 12 cm. Find the image distance and magnification.";
  const mirrorPlan = plan(mirror, [given("u", 30, "cm"), given("f", 12, "cm")],
    [{ ...given("v", 20, "cm"), provenance: "derived" }, { id: "m", symbol: "m", value: -2 / 3, provenance: "derived" }]);
  await checkSaved(mirror, mirrorPlan);
  const signed = { ...mirrorPlan, givens: mirrorPlan.givens.map((g) => ({ ...g, value: -g.value, sign: "negative" as const })),
    derived: mirrorPlan.derived.map((d) => d.id === "v" ? { ...d, value: -20, sign: "negative" as const } : d) };
  await checkSaved(mirror, signed);
  for (const bad of [
    { ...mirrorPlan, derived: mirrorPlan.derived.map((d) => d.id === "v" ? { ...d, value: 22 } : d) },
    { ...mirrorPlan, derived: mirrorPlan.derived.map((d) => d.id === "v" ? { ...d, sign: "positive" as const } : d) },
    { ...mirrorPlan, derived: mirrorPlan.derived.map((d) => d.id === "m" ? { ...d, value: 2 / 3 } : d) },
  ]) assert.equal(selectProductionScene({ question: mirror, turnPlan: bad, problemIR: null, policy }).representation, null,
    "wrong image magnitude/sign or magnification is not recoverable");
  console.log("optics: magnitudes and Cartesian convention save; contradictory numeric authority stays blocked");

  const friction = "A 3 kg block is pulled across a rough horizontal floor by a 15 N force. The coefficient of kinetic friction is 0.2. Draw the forces.";
  const frictionPlan = plan(friction, [given("m", 3, "kg"), given("F", 15, "N")]);
  const source = await checkSaved(friction, frictionPlan);
  const mismatched = structuredClone(source.representation!.sceneDocument);
  mismatched.source.question = "A different block on a different surface.";
  const repaired = selectProductionScene({ question: friction, turnPlan: frictionPlan, problemIR: null,
    candidate: { ...mismatched }, policy });
  assert(repaired.candidateValidation?.valid, "mismatched scene is locally valid, reproducing final admission boundary");
  assert.equal(repaired.droppedCandidate?.code, "source_question_mismatch");
  assert(repaired.representation);
  assert.equal(repaired.representation.sceneDocument.source.question, friction);
  assert.notEqual(repaired.representation.figureSource, "planner", "recovery keeps actual source provenance");
  assert.equal(mismatched.source.question, "A different block on a different surface.", "original provenance is never rewritten");
  const forgedFast = selectProductionScene({ question: friction, turnPlan: frictionPlan, problemIR: null,
    fastRepresentation: source.representation!, policy });
  assert.equal(forgedFast.representation, null, "trusted regeneration exception cannot admit a caller-supplied fast representation");
  const solverBlocked = selectProductionScene({ question: friction, turnPlan: frictionPlan, problemIR: null,
    solverAuthorityBlocked: true, policy });
  assert.equal(solverBlocked.representation, null, "verified recovery cannot bypass solver authority");

  const vectors = "Draw the vectors a = (2, 1) and b = (-1, 3), and find the angle between them using the dot product.";
  const vectorPlan = plan(vectors, []);
  const recoveredVectors = await checkSaved(vectors, vectorPlan);
  assert.equal(recoveredVectors.representation!.figureSource, "family");
  assert.equal(recoveredVectors.representation!.tier, "qualitative_verified", "recovery never upgrades qualitative geometry to exact");
  for (const path of ["../../features/tutor-session/hooks/turn/useQuestionHandler.ts", "../lecture-lab/lecturePipeline.ts"]) {
    const consumer = readFileSync(new URL(path, import.meta.url), "utf8");
    assert(consumer.includes("allowVerifiedSourceRecovery: true"), `${path}: live and lab explicitly enable verified source recovery`);
  }
  console.log("strict recovery: source provenance, family tier, solver and caller-supplied-scene boundaries hold");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
