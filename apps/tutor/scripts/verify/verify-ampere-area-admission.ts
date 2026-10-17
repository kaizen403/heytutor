/** The narrow ampere/area fix through the same public parser used live. */
import assert from "node:assert/strict";
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  validateTurnPlanV3,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { parseTurnPlanV3Content } from "@heytutor/tutor-core";
import {
  ampereAreaFixtures,
  ampereAreaRepresentsTruth,
  makeAmpereAreaPlan,
} from "../../../../packages/scene-engine/scripts/verify/verify-turn-plan-ampere-area";

let checks = 0;
for (const test of ampereAreaFixtures) {
  for (const spelling of ["X", "named"] as const) {
    const plan = makeAmpereAreaPlan(test, spelling);
    const before = JSON.stringify(plan);
    const admitted = parseTurnPlanV3Content(before, plan.question);
    if (test.kind === "right") {
      assert(
        admitted,
        `${test.id}/${spelling}: correct plan rejected at public parser`,
      );
      assert(
        ampereAreaRepresentsTruth(admitted.derived.at(-1)),
        `${test.id}/${spelling}: admitted wrong value`,
      );
    } else if (test.kind === "wrong") {
      assert(
        admitted === null || ampereAreaRepresentsTruth(admitted.derived.at(-1)),
        `${test.id}/${spelling}: wrong result admitted`,
      );
    } else {
      assert.equal(
        admitted !== null,
        test.preserved?.reconciledValid,
        `${test.id}/${spelling}: parser baseline changed`,
      );
      if (admitted) {
        assert.equal(
          admitted.derived.at(-1)?.value,
          test.preserved?.reconciledValue,
        );
        assert.equal(admitted.derived.at(-1)?.unit, test.unit);
      }
    }
    assert.equal(
      JSON.stringify(plan),
      before,
      `${test.id}/${spelling}: input mutated`,
    );
    checks += 1;
  }
}
// Independent values and all supported multiplication spellings. The fixed
// voltage is 2 A × 5 Ω = 10 V; changing area must never change that result.
for (const area of [0.2, 1.7, 9]) {
  for (const operator of ["*", "×", "·", "⋅"]) {
    for (const value of [10, 17]) {
      for (const sourceMode of [
        "freeform-baseline",
        "explicit-givens",
      ] as const) {
        const question =
          sourceMode === "freeform-baseline"
            ? `A wire has area A = ${area} mm², resistance R = 5 Ω, and current I = 2 A. Find its voltage.`
            : `Given A = ${area} mm², R = 5 Ω, I = 2 A. Find its voltage.`;
        const plan: TurnPlanV3 = {
          schemaVersion: "turn-plan/v3",
          question,
          visualRequirement: "optional",
          givens: [
            {
              id: "area",
              symbol: "A",
              value: area,
              unit: "mm²",
              provenance: "given",
            },
            {
              id: "current",
              symbol: "I",
              value: 2,
              unit: "A",
              provenance: "given",
            },
            {
              id: "resistance",
              symbol: "R",
              value: 5,
              unit: "Ω",
              provenance: "given",
            },
          ],
          unknowns: [{ id: "answer", symbol: "V", unit: "V" }],
          derived: [
            {
              id: "answer",
              symbol: "V",
              value,
              unit: "V",
              provenance: "derived",
              sourceText: `V = (2 A) ${operator} (5 Ω) = ${value} V`,
            },
          ],
          qualitativeClaims: [],
          lawIds: ["ohms_law"],
          assumptions: [],
        };
        const before = JSON.stringify(plan);
        const raw = validateTurnPlanV3(plan);
        const reconciled = reconcileTurnPlanV3ExplicitArithmetic(plan);
        const validated = validateTurnPlanV3(reconciled.plan);
        const admitted = parseTurnPlanV3Content(before, question);
        if (sourceMode === "freeform-baseline") {
          // Independent merge-base replay pins all 24 original freeform cases.
          // The existing wrong17 admission is parked, never claimed as fixed.
          const baselineValid = area === 1.7 && value === 17;
          assert.equal(raw.valid, baselineValid);
          assert.equal(validated.valid, baselineValid);
          assert.equal(JSON.stringify(reconciled.plan), before);
          assert.equal(admitted !== null, baselineValid);
          if (admitted) assert.equal(admitted.derived[0]?.value, value);
        } else {
          assert.equal(raw.valid, value === 10);
          assert(validated.valid && validated.plan);
          assert.equal(validated.plan.derived[0]?.value, 10);
          assert(admitted);
          assert.equal(admitted.derived[0]?.value, 10);
          assert.equal(admitted.derived[0]?.unit, "V");
        }
        assert.equal(JSON.stringify(plan), before);
        checks += 1;
      }
    }
  }
}
// A scientific numeric atom must not become an unrelated e0 binding.
for (const value of [6, 24]) {
  const question = "Given A = 0.8 mm², I = 3 A, R = 2 Ω, e0 = 4. Find V.";
  const plan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3",
    question,
    visualRequirement: "optional",
    givens: [
      { id: "area", symbol: "A", value: 0.8, unit: "mm²", provenance: "given" },
      { id: "current", symbol: "I", value: 3, unit: "A", provenance: "given" },
      {
        id: "resistance",
        symbol: "R",
        value: 2,
        unit: "Ω",
        provenance: "given",
      },
      { id: "decoy", symbol: "e0", value: 4, provenance: "given" },
    ],
    unknowns: [{ id: "answer", symbol: "V", unit: "V" }],
    derived: [
      {
        id: "answer",
        symbol: "V",
        value,
        unit: "V",
        provenance: "derived",
        sourceText: `V = 3e0 A * 2e0 Ω = ${value} V`,
      },
    ],
    qualitativeClaims: [],
    lawIds: ["ohms_law"],
    assumptions: [],
  };
  const before = JSON.stringify(plan);
  // A fourth numeric source clause is outside the three-assignment recovery.
  // Its unread meaning cannot authorize a scientific atom or a stale product.
  assert.equal(validateTurnPlanV3(plan).valid, false);
  assert.equal(parseTurnPlanV3Content(before, question), null);
  assert.equal(JSON.stringify(plan), before);
  checks += 1;
}
console.log(`Ampere/area public admission: ${checks} plans pass.`);
