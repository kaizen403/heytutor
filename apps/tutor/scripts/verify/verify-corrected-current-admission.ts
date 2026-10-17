import assert from "node:assert/strict";
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  validateTurnPlanV3,
  type TurnPlanV3,
} from "../../../../packages/scene-engine/src/contracts/contractsV3";

// Authored public Ohm's-law examples; no captured questions or model calls.
const question = (correction: string, quantity = "current") =>
  `Given A = 0.8 mm², I = 3 A, R = 12 Ω. Correction: actual ${quantity} is ${correction}. Find V.`;

function candidate(text: string, current = 3, voltage = 36): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3",
    question: text,
    givens: [
      { id: "A", symbol: "A", value: 0.8, unit: "mm²", provenance: "given", sourceText: "A = 0.8 mm²" },
      { id: "I", symbol: "I", value: current, unit: "A", provenance: "given", sourceText: `I = ${current} A` },
      { id: "R", symbol: "R", value: 12, unit: "Ω", provenance: "given", sourceText: "R = 12 Ω" },
    ],
    unknowns: [{ id: "voltage", symbol: "V", unit: "V" }],
    derived: [{
      id: "V", symbol: "V", value: voltage, unit: "V", provenance: "derived",
      sourceText: `V = ${current} A * R = ${voltage} V`, dependsOn: ["I", "R"],
    }],
    qualitativeClaims: [],
    lawIds: ["ohms_law"],
    assumptions: [],
    visualRequirement: "none",
  };
}

let passed = 0;
const failures: string[] = [];
function check(name: string, test: () => void): void {
  try {
    test();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const corrections: ReadonlyArray<readonly [string, string, number | null, string?]> = [
  ["plain", "4 A", 48],
  ["ASCII zero power", "4 × 10^0 A", 48],
  ["ASCII positive power", "0.4 × 10^+1 A", 48],
  ["ASCII negative power", "40 × 10^-1 A", 48],
  ["ASCII power with Unicode minus", "40 × 10^−1 A", 48],
  ["superscript zero", "4 × 10⁰ A", 48],
  ["superscript positive power", "0.4 × 10⁺¹ A", 48],
  ["superscript negative power", "40 × 10⁻¹ A", 48],
  ["e zero exponent", "4e0 A", 48],
  ["e positive exponent", "0.4e+1 A", 48],
  ["e negative exponent", "40e-1 A", 48],
  ["e exponent with Unicode minus", "40e−1 A", 48],
  ["prefixed superscript measurement", "4 × 10⁰ mA", 0.048],
  ["prefixed ASCII measurement", "4 × 10^0 mA", 0.048],
  ["prefixed e measurement", "4e0 mA", 0.048],
  ["overflow e measurement", "4e309 A", null],
  ["overflow ASCII power measurement", "4 × 10^309 A", null],
  ["overflow prefixed measurement", "4e309 mA", null],
  ["overflow resistance measurement", "1e309 Ω", null, "resistance"],
];
for (const [name, correction, expectedVoltage, quantity] of corrections) {
  const stale = candidate(question(correction, quantity));
  for (const [seam, raw] of [
    ["validate", stale],
    ["reconcile then validate", reconcileTurnPlanV3ExplicitArithmetic(stale).plan],
  ] as const) {
    check(`corrected ${name} / ${seam}`, () => {
      const admitted = validateTurnPlanV3(raw, stale.question);
      assert.ok(!admitted.valid || (expectedVoltage !== null &&
        admitted.plan?.derived.find((quantity) => quantity.id === "V")?.value === expectedVoltage),
        "conflicting measurement must reject the candidate or support the corrected voltage");
    });
  }
}

const controls = [
  ["matching plain current", candidate(question("3 A")), 36],
  ["matching superscript zero", candidate(question("3 × 10⁰ A")), 36],
  ["matching ASCII zero power", candidate(question("3 × 10^0 A")), 36],
  ["matching superscript positive power", candidate(question("0.3 × 10⁺¹ A")), 36],
  ["matching superscript negative power", candidate(question("30 × 10⁻¹ A")), 36],
  ["matching e zero exponent", candidate(question("3e0 A")), 36],
  ["matching e Unicode minus", candidate(question("30e−1 A")), 36],
  ["spaced ampere-second measurement", candidate("Given A = 0.8 mm², I = 3 A, R = 12 Ω. The delivered charge is 5 A s. Find V."), 36],
  ["spaced ohm-second measurement", candidate("Given A = 0.8 mm², I = 3 A, R = 12 Ω. The resistance-time integral is 5 Ω s. Find V."), 36],
  ["scientific ampere-second measurement", candidate("Given A = 0.8 mm², I = 3 A, R = 12 Ω. The delivered charge is 4 × 10⁰ A s. Find V."), 36],
  ["actual bound 4 A", candidate("Given A = 0.8 mm², I = 4 A, R = 12 Ω. Find V.", 4, 48), 48],
  ["actual bound scientific 4 A", candidate("Given A = 0.8 mm², I = 4 A, R = 12 Ω. Correction: actual current is 4 × 10⁰ A. Find V.", 4, 48), 48],
] as const;
for (const [name, supported, expectedVoltage] of controls) {
  check(`${name} / validate`, () => {
    const admitted = validateTurnPlanV3(supported, supported.question);
    assert.equal(admitted.valid, true, JSON.stringify(admitted.issues));
    assert.equal(admitted.plan?.derived.find((quantity) => quantity.id === "V")?.value, expectedVoltage);
  });
  check(`${name} / reconcile then validate`, () => {
    const wrongDeclared = { ...supported, derived: supported.derived.map((quantity) => ({ ...quantity, value: 999 })) };
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(wrongDeclared);
    const admitted = validateTurnPlanV3(reconciled.plan, supported.question);
    assert.equal(admitted.valid, true, JSON.stringify(admitted.issues));
    assert.equal(admitted.plan?.derived.find((quantity) => quantity.id === "V")?.value, expectedVoltage);
  });
}

async function finish(): Promise<void> {
  if (process.argv.includes("--live")) {
    // Run with tutor-core's tsconfig so package aliases resolve to built exports.
    const { parseTurnPlanV3Content } = await import("../../../../packages/tutor-core/dist/index.js");
    for (const [name, correction, expectedVoltage, quantity] of corrections) {
      check(`corrected ${name} / built live parser`, () => {
        const stale = candidate(question(correction, quantity));
        const admitted = parseTurnPlanV3Content(JSON.stringify(stale), stale.question);
        assert.ok(admitted === null || admitted.derived.find((quantity) => quantity.symbol === "V")?.value === expectedVoltage,
          "live parser must reject the stale candidate or admit the corrected voltage");
      });
    }
    for (const [name, supported, expectedVoltage] of controls) {
      check(`${name} / built live parser`, () => {
        const admitted = parseTurnPlanV3Content(JSON.stringify(supported), supported.question);
        assert.notEqual(admitted, null, "live parser must retain the supported current reading");
        assert.equal(admitted?.derived.find((quantity) => quantity.symbol === "V")?.value, expectedVoltage);
      });
    }
  }
  console.log(`Corrected current admission: ${corrections.length} corrections, ${controls.length} controls; ${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.error(failure);
  if (failures.length > 0) process.exitCode = 1;
}
void finish().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
