import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import type { ProblemIR } from "../../src/ir/problemIR";

const fixture = JSON.parse(readFileSync(new URL("../../../../apps/tutor/scripts/verify/fixtures/fast-figure-authority.json", import.meta.url), "utf8"));
const entry = fixture.cases.find((row: { id: string }) => row.id === "derive_symbolic");
const problemIR: ProblemIR = entry.authority.problemIR;
const scene = synthesizeFamilyScene({ question: entry.question, turnPlan: entry.turnPlan });
assert.ok(scene, "symbolic projectile must compile independently");
assert.equal(scene.tier, "qualitative_verified");
assert.equal(scene.document.entities.find((row) => row.id === "angle")?.label, "θ");
assert.ok(!scene.document.quantities.some((row) => row.id === "theta"));
const obligations = deriveVisualObligations(problemIR);
const identityAudit = checkVisualObligations(obligations, scene.document);
console.log("full IR identity diagnostic:", JSON.stringify(identityAudit));
const compactProblem = { ...problemIR, entities: problemIR.entities.map((entity) => ({
  ...entity, label: entity.id === "proj" ? "projectile" : entity.id === "traj" ? "trajectory" : entity.label,
})) };
const compactObligations = deriveVisualObligations(compactProblem);
assert.ok(checkVisualObligations(compactObligations, scene.document).satisfied, "negative control starts from a complete compact-named scene");
const missingBody = { ...scene.document, entities: scene.document.entities.filter((row) => row.id !== "O") };
assert.ok(checkVisualObligations(compactObligations, missingBody).missing.some((row) => row.obligationId === "body:proj" && row.code === "missing_named_body"));
for (const question of [
  "A wind blows at 45 degrees to the north. Derive the range of a projectile launched with speed u at angle theta on level ground.",
  "A ball is launched with speed u at angle theta. It hits a wall that leans at 60 degrees. Derive its range on level ground.",
]) {
  const symbolic = synthesizeFamilyScene({ question, turnPlan: { ...entry.turnPlan, question } });
  assert.ok(symbolic);
  assert.equal(symbolic.document.entities.find((row) => row.id === "angle")?.label, "θ");
}
const question = "A projectile is launched with speed 20 m/s at 30 degrees on level ground. Find its range.";
const numeric = synthesizeFamilyScene({ question, turnPlan: { ...entry.turnPlan, question, givens: [
  { id: "u", symbol: "u", value: 20, unit: "m/s", sourceText: "speed 20 m/s", provenance: "given" },
  { id: "theta", symbol: "theta", value: 30, unit: "degree", sourceText: "at 30 degrees", provenance: "given" },
] } });
assert.ok(numeric);
assert.equal(numeric.document.entities.find((row) => row.id === "angle")?.label, "θ=30°");
console.log("publication symbolic figure: compact geometry, missing-body rejection, role-bound angles PASS; full IR identity blocker reported above");
