import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { SceneDocument } from "../../src/types";

/** Measurement diagnostic: long exact-name support remains unimplemented.
 * Deliberately exits 1 for missing capabilities; not an admission gate or READY receipt. */
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
check("full actual IR exact positive through synthesis", () => {
  const full = synthesizeFamilyScene({ question: entry.question, turnPlan: entry.turnPlan, problemIR });
  assert.ok(full, "full actual IR must produce a figure");
  assert.ok(checkVisualObligations(obligations, full.document).satisfied);
});
check("long exact physical names survive live pruning and normalization", () => {
  const validated = validateSceneDocument(pruneDeadSceneEntities(exact as unknown as Record<string, unknown>));
  assert.ok(validated.document, JSON.stringify(validated.report.issues));
  const audit = checkVisualObligations(obligations, validated.document);
  assert.equal(audit.satisfied, true, JSON.stringify(audit.missing));
});
check("long exact physical names render even without live pruning", () => {
  const validated = validateSceneDocument(exact);
  assert.ok(validated.document, JSON.stringify(validated.report.issues));
  const audit = checkVisualObligations(obligations, validated.document);
  console.log("normalized full-IR identity audit:", JSON.stringify(audit));
  assert.equal(audit.satisfied, true, JSON.stringify(audit.missing));
  const compiled = compileSceneDocument(validated.document);
  console.log("long-name compile issues:", JSON.stringify(compiled.report.issues));
  assert.ok(compiled.ok && compiled.renderScene);
  for (const label of problemIR.entities.map((row) => row.label)) {
    assert.ok(compiled.renderScene.primitives.some((row) => row.kind === "label" && row.text === label));
  }
});
for (const [sourceId, sceneId] of [["proj", "O"], ["traj", "trajectory"]]) check(`long-name callout renders full attached text: ${sourceId}`, () => {
  const changed = structuredClone(scene.document);
  changed.annotations.push(
    { id: "projectile_name", kind: "callout", targetIds: ["O"], text: problemIR.entities.find((row) => row.id === "proj")!.label },
    { id: "trajectory_name", kind: "callout", targetIds: ["trajectory"], text: problemIR.entities.find((row) => row.id === "traj")!.label },
  );
  const validated = validateSceneDocument(changed);
  assert.ok(validated.document);
  const compiled = compileSceneDocument(validated.document);
  assert.ok(compiled.ok && compiled.renderScene);
  const label = problemIR.entities.find((row) => row.id === sourceId)!.label;
  assert.ok(compiled.renderScene.primitives.some((row) => row.kind === "label" && row.entityId === sceneId && row.text === label),
    `exact attached text absent: ${label}; caption=${compiled.renderScene.caption}`);
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
assert.equal(JSON.stringify(problemIR), snapshot, "actual source IR must remain unchanged");
console.log(JSON.stringify({ passed, failed: failures.length, failures }));
if (failures.length) process.exitCode = 1;
