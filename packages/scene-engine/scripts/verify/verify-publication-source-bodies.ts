import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { SceneDocument } from "../../src/types";

/** Publication source boundary: actual full-IR capacity declines are explicit;
 * positive authored profiles cannot be substituted for captured/native evidence. */
const fixture = JSON.parse(readFileSync(new URL("../../../../apps/tutor/scripts/verify/fixtures/fast-figure-authority.json", import.meta.url), "utf8"));
const entry = fixture.cases.find((row: { id: string }) => row.id === "derive_symbolic");
const problemIR: ProblemIR = entry.authority.problemIR;
const snapshot = JSON.stringify(problemIR);
const scene = synthesizeFamilyScene({ question: entry.question, turnPlan: entry.turnPlan });
assert.ok(scene, "independent symbolic geometry must compile");
const obligations = deriveVisualObligations(problemIR);
let passed = 0;
const failures: string[] = [];
function check(name: string, run: () => void) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const missing = (document: SceneDocument, id: string) => checkVisualObligations(obligations, document).missing.some(
  (row) => row.obligationId === `body:${id}` && row.code === "missing_named_body",
);
// Independent identity oracle only. This is not validated/rendered scene evidence:
// names come verbatim from the full IR, with no replacement or compacted IR.
const exact = structuredClone(scene.document);
for (const [sourceId, sceneId] of [["proj", "O"], ["traj", "trajectory"], ["ground", "ground"]]) {
  exact.entities.find((row) => row.id === sceneId)!.label = problemIR.entities.find((row) => row.id === sourceId)!.label;
}
check("exact source identity matching (document oracle only)", () => assert.ok(checkVisualObligations(obligations, exact).satisfied));
check("missing physical body", () => {
  const changed = structuredClone(exact);
  changed.entities = changed.entities.filter((row) => row.id !== "O");
  assert.ok(missing(changed, "proj"));
});
check("wrong identity despite direct source id", () => {
  const changed = structuredClone(exact);
  changed.entities.find((row) => row.id === "O")!.id = "proj";
  changed.entities.find((row) => row.id === "proj")!.label = "another projectile";
  assert.ok(missing(changed, "proj"));
});
check("unknown source name cannot match by role", () => {
  const unknown = structuredClone(problemIR);
  unknown.entities.find((row) => row.id === "proj")!.label = "unmentioned body";
  assert.ok(checkVisualObligations(deriveVisualObligations(unknown), exact).missing.some((row) => row.obligationId === "body:proj"));
});
check("two equal names require two bodies", () => {
  const competing = structuredClone(problemIR);
  competing.entities.push({ ...competing.entities.find((row) => row.id === "proj")!, id: "second" });
  competing.representationIntents[0]!.entityIds.push("second");
  const audit = checkVisualObligations(deriveVisualObligations(competing), exact);
  assert.deepEqual(audit.missing.map((row) => row.obligationId), ["body:second"]);
});
check("wrong target kind cannot carry exact name", () => {
  const changed = structuredClone(exact);
  delete changed.entities.find((row) => row.id === "O")!.label;
  changed.entities.find((row) => row.id === "trajectory")!.label = problemIR.entities.find((row) => row.id === "proj")!.label;
  assert.ok(missing(changed, "proj"));
});
check("synthetic text geometry cannot consume physical obligation", () => {
  const changed = structuredClone(exact);
  changed.entities.find((row) => row.id === "O")!.kind = "label";
  assert.ok(missing(changed, "proj"));
});
check("competing synthetic text leaves real body available", () => {
  const changed = structuredClone(exact);
  changed.entities.unshift({ id: "fake", kind: "label", role: "text", label: problemIR.entities.find((row) => row.id === "proj")!.label });
  assert.ok(checkVisualObligations(obligations, changed).satisfied);
});
check("unattached or wrong-target callout cannot satisfy missing identity", () => {
  const changed = structuredClone(scene.document);
  changed.annotations.push({ id: "name", kind: "callout", targetIds: ["trajectory"], text: problemIR.entities.find((row) => row.id === "proj")!.label });
  assert.ok(missing(changed, "proj"));
});
// Actual captured names cannot be rendered under the unchanged 16-character
// label contract. Full source completeness must decline, never erase the IR.
check("captured full IR declines an incomplete compact figure", () => {
  assert.equal(synthesizeFamilyScene({ question: entry.question, turnPlan: entry.turnPlan, problemIR }), null);
  assert.deepEqual(checkVisualObligations(obligations, scene.document).missing.map(row => row.obligationId).sort(), ["body:proj", "body:traj"]);
});
// Authored renderable-name profile, not the actual captured IR or native evidence.
// All source facts, entities, requests and intents remain; only names differ.
check("a complete renderable-name full IR has a positive path", () => {
  const renderable = structuredClone(problemIR);
  const labels = { proj: "projectile", traj: "trajectory", ground: "level ground" };
  for (const entity of renderable.entities) entity.label = labels[entity.id as keyof typeof labels];
  const full = synthesizeFamilyScene({ question: entry.question, turnPlan: entry.turnPlan, problemIR: renderable });
  assert.ok(full);
  assert.ok(checkVisualObligations(deriveVisualObligations(renderable), full.document).satisfied);
  assert.ok(full.renderScene.primitives.some(row => row.kind === "label" && row.text === "projectile"));
  assert.ok(full.renderScene.primitives.some(row => row.kind === "label" && row.text === "trajectory"));
  assert.ok(!full.renderScene.primitives.some(row => /45/.test(row.text ?? "")));
});
check("unrelated angles leave launch symbolic", () => {
  for (const question of [
    "A wind blows at 45 degrees to the north. Derive the range of a projectile launched with speed u at angle theta on level ground.",
    "A ball is launched with speed u at angle theta. It hits a wall that leans at 60 degrees. Derive its range on level ground.",
  ]) {
    const symbolic = synthesizeFamilyScene({ question, turnPlan: { ...entry.turnPlan, question } });
    assert.ok(symbolic);
    assert.equal(symbolic.document.entities.find((row) => row.id === "angle")?.label, "θ");
    assert.ok(!symbolic.document.quantities.some((row) => row.id === "theta"));
  }
});
check("numeric launch angle remains source bound", () => {
  const question = "A projectile is launched with speed 20 m/s at 30 degrees on level ground. Find its range.";
  const numeric = synthesizeFamilyScene({ question, turnPlan: { ...entry.turnPlan, question, givens: [
    { id: "u", symbol: "u", value: 20, unit: "m/s", sourceText: "speed 20 m/s", provenance: "given" },
    { id: "theta", symbol: "theta", value: 30, unit: "degree", sourceText: "at 30 degrees", provenance: "given" },
  ] } });
  assert.ok(numeric);
  assert.equal(numeric.document.entities.find((row) => row.id === "angle")?.label, "θ=30°");
});
check("unrelated conjunct angles cannot supply launch authority", () => {
  for (const continuation of ["hits a wall inclined at 30 degrees", "encounters wind directed at 30 degrees", "the angle of the wall is 30 degrees"]) {
    const question = `A projectile is launched with speed 20 m/s and ${continuation} on level ground. Find its range.`;
    const symbolic = synthesizeFamilyScene({ question });
    if (symbolic) {
      const angleLabel = symbolic.document.entities.find(row => row.id === "angle")?.label;
      assert.ok(angleLabel === undefined || angleLabel === "θ", continuation);
      assert.ok(!symbolic.document.quantities.some(row => row.id === "theta"));
    }
    const contradicted = synthesizeFamilyScene({ question, turnPlan: { ...entry.turnPlan, question, givens: [
      { id: "u", symbol: "u", value: 20, unit: "m/s", sourceText: "speed 20 m/s", provenance: "given" },
      { id: "theta", symbol: "theta", value: 30, unit: "degree", sourceText: continuation, provenance: "given" },
    ] } });
    assert.equal(contradicted, null, `${continuation}: unrelated planner angle must decline`);
  }
});
check("launch conjunctions, decimals and parentheses retain their given angle", () => {
  for (const description of ["at 20 m/s and an angle of 30 degrees", "at 20 m/s and the angle is 30 degrees", "with speed 20 m/s at (30 degrees)", "with speed 20.5 m/s at 30.5 degrees"]) {
    const question = `A projectile is launched ${description} on level ground. Find its range.`;
    const angle = description.includes("30.5") ? 30.5 : 30;
    for (const withPlan of [true, false]) {
      const numeric = synthesizeFamilyScene({ question, ...(withPlan ? { turnPlan: { ...entry.turnPlan, question, givens: [
        { id: "u", symbol: "u", value: description.includes("20.5") ? 20.5 : 20, unit: "m/s", sourceText: description, provenance: "given" },
        { id: "theta", symbol: "theta", value: angle, unit: "degree", sourceText: description, provenance: "given" },
      ] } } : {}) });
      assert.ok(numeric, `${description}: plan=${withPlan}`);
      assert.equal(numeric.document.quantities.find(row => row.id === "theta")?.value, angle);
      assert.equal(numeric.document.entities.find(row => row.id === "angle")?.label, `θ=${angle}°`);
    }
  }
});
check("computed vertical throws retain the free-fall scene", () => {
  const question = "A stone is thrown vertically upward and reaches a maximum height of 10 m.";
  const vertical = synthesizeFamilyScene({ question });
  assert.ok(vertical);
  assert.equal(vertical.document.source.archetype, "free_fall");
  assert.ok(!vertical.document.quantities.some(row => row.id === "theta"));
  assert.ok(vertical.renderScene.primitives.length > 0);
});
check("a launch from a tower cannot inherit a vertical zero-speed drop", () => {
  for (const question of [
    "A ball is projected from the top of a 20 m tower at 10 m/s.",
    "A ball is projected from the top of a 20 m tower at 10 m/s and hits a vertically standing wall.",
  ]) assert.equal(synthesizeFamilyScene({ question }), null, question);
});
assert.equal(JSON.stringify(problemIR), snapshot, "actual source IR must remain unchanged");
console.log(JSON.stringify({ passed, failed: failures.length, failures }));
if (failures.length) process.exitCode = 1;
