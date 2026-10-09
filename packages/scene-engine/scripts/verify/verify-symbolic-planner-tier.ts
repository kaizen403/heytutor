import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument, displayedSceneQuantityTexts, tierForForeignDocument, validateSceneDocument, validateSceneQuantityAgreement, type TurnPlanV3 } from "../../src/index";

const regressions = readFileSync(new URL("../../../../data/diagram-eval/v1/production-regressions.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map((line) => JSON.parse(line));
const regression = regressions.find((row) => row.id === "production|physics|projectile-range-max-angle");
assert.equal(typeof regression?.question, "string", "authored production projectile regression must remain in the bank");
const question: string = regression.question;
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [{ id: "u", symbol: "u" }, { id: "theta", symbol: "θ" }],
  derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
};
// Oracle only: a representative parabola, with no source measurement claims.
const fixture = JSON.parse(readFileSync(new URL("../../../../data/diagram-eval/v1/exemplars/physics/projectile-motion--1.json", import.meta.url), "utf8")).sceneDocument;
fixture.source = { question, representationTier: "qualitative_verified", nonMetric: true };
fixture.quantities = [];
for (const entity of fixture.entities) {
  if (entity.id === "velocity") entity.label = "u";
  if (entity.id === "angle") entity.label = "θ";
}
const validated = validateSceneDocument(fixture);
assert.ok(validated.document, JSON.stringify(validated.report.issues));
const document = validated.document;
for (const label of regression.must_label) {
  assert.ok(document.entities.some((entity) => entity.label === label), `production symbol ${label} must be displayed`);
}
assert.deepEqual(validateSceneQuantityAgreement(document.quantities, plan, displayedSceneQuantityTexts(document)), []);
assert.ok(compileSceneDocument(document).ok, "symbol-only representative must compile");
assert.equal(tierForForeignDocument(document).tier, "qualitative_verified", "normalized geometry proofs must not upgrade symbols to numeric authority");
for (const text of ["u=20 m/s", "u=.7 m/s", "g=9.8 m/s^2", "θ=40°", "R=40 m"]) {
  assert.ok(validateSceneQuantityAgreement([], plan, [text]).some((issue) => issue.code === "displayed_quantity_unverified"), `stock value ${text} must reject`);
}
assert.ok(validateSceneQuantityAgreement([{ id: "u", value: 20, unit: "m/s" }], plan).some((issue) => issue.code === "scene_quantity_unverified"));
const numericPlan = { ...plan, givens: [
  { id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" as const },
  { id: "g", symbol: "g", value: 9.8, unit: "m/s^2", provenance: "given" as const },
  { id: "wavelength", symbol: "λ", value: 500, unit: "nm", provenance: "given" as const },
  { id: "length", symbol: "L", value: 1, unit: "Mm", provenance: "given" as const },
  { id: "slow", symbol: "v", value: 0.5, unit: "m/s", provenance: "given" as const },
] };
assert.deepEqual(validateSceneQuantityAgreement([], numericPlan, ["u=2000 cm/s", "u=+20 m s^-1", "v=.5 m/s", "g=9.8 m/s²", "λ=5e-7 m", "L=1000 km"]), []);
// A model may lower its tier, never grant itself exact authority.
const noProof = { ...document, source: { question, representationTier: "exact_verified", nonMetric: false }, assertions: [] };
assert.equal(tierForForeignDocument(noProof).tier, "qualitative_verified");
console.log("symbolic planner tier: symbol-only compile, qualitative ceiling, and stock-value rejection passed");
