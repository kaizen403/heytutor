import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

const original = JSON.parse(readFileSync(new URL("../../../../packages/scene-engine/scripts/verify/fixtures/linear-region-scalar-recordings.json", import.meta.url), "utf8"))
  .find((row: { probeId: string }) => row.probeId.includes("separated-boolean-union")) as { question: string; turnPlan: TurnPlanV3 };
let checks = 0;
const select = (plan: TurnPlanV3) => selectProductionScene({ question: original.question, turnPlan: plan, solverAuthorityBlocked: false });
assert.equal(select(original.turnPlan).visualStatus, "validated", "Symbolic set, original coefficients and finite boundaries stay admitted without IR"); checks++;
for (const provenance of ["given", "intermediate", "unknown"] as const) for (const value of [99, -1]) {
  const plan = structuredClone(original.turnPlan);
  plan.unknowns = plan.unknowns.filter(quantity => quantity.id !== "s");
  if (provenance === "given") plan.givens.push({ id: "s", symbol: "S", value, provenance: "given", sourceText: `S=${value}` });
  else {
    plan.derived.push({ id: "s", symbol: "S", value, provenance: "derived" });
    if (provenance === "unknown") plan.unknowns.push({ id: "s", symbol: "S" });
  }
  for (const shape of ["valid", "malformed-version", "conflicting-arithmetic"] as const) {
    const changed = structuredClone(plan);
    if (shape === "malformed-version") Reflect.set(changed, "schemaVersion", "turn-plan/unsupported");
    if (shape === "conflicting-arithmetic") {
      const quantity = provenance === "given" ? changed.givens.at(-1)! : changed.derived.at(-1)!;
      quantity.sourceText = `S=${value + 1}`;
    }
    const before = JSON.stringify(changed), selection = select(changed);
    assert.equal(selection.representation, null, `${provenance}/${shape} S=${value}: ${selection.reason}`);
    assert.equal(selection.visualStatus, "retry_required");
    assert.match(selection.reason, /linear_source_plan_set_scalar/);
    assert.equal(JSON.stringify(changed), before); checks += 4;
  }
}
console.log(`linear source set admission: ${checks} checks through the actual selector, no IR/provider`);
