import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileGeneratedSceneGuide, compileSceneDocument, validateTurnPlanSceneProofs, verifyGeneratedSceneGuide,
  type SceneDocument, type TurnPlanV3 } from "../../src/index";
import { buildSourceCertifiedScientificScene } from "../../src/synthesize/sourceCertifiedScientificScene";

const rows = JSON.parse(readFileSync(new URL("./fixtures/native-source-lecture.json", import.meta.url), "utf8")) as
  Array<{ name: string; question: string; turnPlan: TurnPlanV3; problemIR: unknown }>;
let checks = 0;
for (const row of rows) {
  const source = compileGeneratedSceneGuide({ question: row.question });
  assert(source.ok, `${row.name} source-only: ${JSON.stringify(source)}`); checks++;
  assert(verifyGeneratedSceneGuide({ sourceInput: { question: row.question }, guide: source.guide }).ok); checks++;
  const withPlan = compileGeneratedSceneGuide({ question: row.question, turnPlan: row.turnPlan, problemIR: row.problemIR });
  if (row.name.includes("rutherford")) {
    assert(withPlan.ok, `${row.name} original accepted physical-charge plan: ${JSON.stringify(withPlan)}`); checks++;
    const bound = withPlan.guide.sourceScene.document;
    const encounter = bound.constructions.find(construction => construction.operator === "rutherford_scattering");
    assert(encounter);
    assert.deepEqual([encounter.inputs.projectileCharge, encounter.inputs.targetCharge, encounter.inputs.energy, encounter.inputs.kEnergyLength],
      ["qAlpha", "qNucleus", "K", "ke2"], "source fields retain their original accepted-plan IDs"); checks++;
    for (const id of ["qAlpha", "qNucleus"]) assert.equal(bound.quantities.find(quantity => quantity.id === id)?.unit, "e"); checks++;
    assert.equal(encounter.inputs.impactParameter, undefined, "source-proved head-on computes zero impact without an invented b ID"); checks++;
    assert.equal((encounter.inputs.resultBindings as Record<string, unknown>).closestApproach, "rMin"); checks++;
    const proposed = buildSourceCertifiedScientificScene(row.question, row.turnPlan);
    assert(proposed && !proposed.document.quantities.some(quantity => quantity.id === "rMin" || quantity.id === "b"),
      "the factory invents neither an unknown result scalar nor an impact quantity; guide results are independently materialized later"); checks++;
    assert(source.guide.labelSlots.some(slot => slot.text === "Positive point target; size not modelled")); checks++;
    const finite = structuredClone(source.guide.sourceScene.document) as SceneDocument;
    finite.annotations.push({ id: "false_finite", kind: "callout", targetIds: ["encounter"], text: "Outside the nucleus" });
    assert(validateTurnPlanSceneProofs(finite, null).some(issue => issue.severity === "fatal" && issue.code === "coulomb_finite_body_claim_unproved")); checks++;
    const wrong = structuredClone(source.guide.sourceScene.document) as SceneDocument;
    wrong.quantities.find(quantity => quantity.id === "energy")!.value = 6;
    assert(validateTurnPlanSceneProofs(wrong, null).some(issue => issue.severity === "fatal" && issue.code === "coulomb_source_operand_unproved")); checks++;
  } else {
    assert(withPlan.ok, `${row.name} original accepted plan: ${JSON.stringify(withPlan)}`); checks++;
    assert(withPlan.guide.primitives.every(primitive => primitive.kind !== "label" || (primitive.provenance?.fontPx ?? 24) === 24)); checks++;
    const stale = structuredClone(row.turnPlan);
    if (row.name.includes("spectral")) {
      stale.givens[0]!.value = 4;
      assert(source.guide.primitives.some(p => p.kind === "label" && p.text === "Lyman")); checks++;
      assert(source.guide.primitives.some(p => p.kind === "label" && p.text === "Balmer")); checks++;
      const swapped = structuredClone(source.guide.sourceScene.document) as SceneDocument;
      const transitions = swapped.entities.filter(entity => entity.kind === "vector");
      [transitions[0]!.label, transitions[1]!.label] = [transitions[1]!.label, transitions[0]!.label];
      assert(validateTurnPlanSceneProofs(swapped, row.turnPlan).some(issue => issue.severity === "fatal" && issue.code === "energy_series_endpoint_false")); checks++;
    } else {
      stale.derived[0]!.value = 600; stale.derived[1]!.value = 10;
      assert(source.guide.primitives.some(p => p.kind === "label" && p.text === "A=10 Bq")); checks++;
      assert(source.guide.primitives.some(p => p.kind === "label" && p.text === "R=600 decays/min")); checks++;
      assert(withPlan.guide.labelSlots.filter(slot => /^(?:A|R)=/.test(slot.text)).every(slot => slot.revealAfter === "teaching_complete")); checks++;
    }
    assert(!compileGeneratedSceneGuide({ question: row.question, turnPlan: stale, problemIR: row.problemIR }).ok,
      "a source-correct figure cannot accompany stale planner scalars"); checks++;
  }
}
for (const question of [
  "Draw energy-level diagram for the Balmer series of hydrogen atom.",
  "Draw energy-level diagram for a hydrogen atom emission transition from n=4 to n=2.",
  "At an instant, lambda=3 h^-1 and N=1200 nuclei. Calculate activity in Bq and compare it with the decay rate per hour; show the two unit labels without swapping their values.",
]) {
  const result = compileGeneratedSceneGuide({ question });
  assert(result.ok, JSON.stringify(result)); checks++;
  assert(compileSceneDocument(structuredClone(result.guide.sourceScene.document) as SceneDocument, { figureConsistency: true }).ok); checks++;
}
for (const question of [
  rows[0]!.question.replace("Hydrogen", "two-electron helium"),
  rows[0]!.question.replace("n = 2", "n = -2"),
  rows[1]!.question.replace("+79e", "-79e"),
  rows[1]!.question.replace("classical heavy fixed-target approximation", "relativistic moving-target approximation"),
  rows[2]!.question.replace("N=300", "N=-300"),
  rows[2]!.question.replace("min^-1", "mm^-1"),
]) {
  assert(!compileGeneratedSceneGuide({ question }).ok, `unsupported source must decline: ${question}`); checks++;
}
console.log(`native source lecture: ${checks} checks passed; no provider calls`);
