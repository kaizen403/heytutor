/**
 * Free PR #160 gate: a written ampere label must not become the wire's area.
 *
 * The five Ohm examples have independently worked voltage truth 36 V.
 * Preservation fixtures pin main's existing public behavior outside that
 * source-grounded current / area collision. No general unit or CAS change is
 * implied by those fixtures. Imports use source so RED requires no build.
 */
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  validateTurnPlanV3,
  type TurnPlanQuantityV3,
  type TurnPlanV3,
} from "../../src/contracts/contractsV3";

type Spelling = "X" | "named";
interface Input {
  readonly id: string;
  readonly symbol: string;
  readonly value: number;
  readonly unit: string;
  readonly sourceText: string;
}
interface PreservedOutcome {
  readonly rawValid: boolean;
  readonly reconciledValid: boolean;
  readonly reconciledValue: number;
}
interface AmpereAreaFixture {
  readonly id: string;
  readonly givens: readonly Input[];
  readonly priorDerived: readonly Input[];
  readonly question: string;
  readonly target: string;
  readonly unit: string;
  readonly value: number;
  readonly sourceText: string;
  readonly kind: "right" | "wrong" | "preserve";
  readonly preserved?: PreservedOutcome;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function input(id: string, symbol: string, value: number, unit: string, sourceText = `${symbol} = ${value} ${unit}`): Input {
  return { id, symbol, value, unit, sourceText };
}

const area = input("area", "A", 0.8, "mm²");
const resistance = input("resistance", "R", 12, "Ω");
const current = input("max_current", "I_max", 3, "A");
const collision = [area, resistance, current];

function questionFor(givens: readonly Input[], target: string): string {
  return `Given ${givens.map((given) => `${given.symbol} = ${given.value} ${given.unit}`).join(", ")}, find ${target}.`;
}

function ohm(id: string, sourceText: string, value: number, kind: "right" | "wrong"): AmpereAreaFixture {
  return { id, givens: collision, priorDerived: [], question: questionFor(collision, "V"),
    target: "V", unit: "V", value, sourceText, kind };
}

function preserve(
  id: string,
  givens: readonly Input[],
  sourceText: string,
  value: number,
  unit = "V",
  target = "V",
  preserved: PreservedOutcome = { rawValid: true, reconciledValid: true, reconciledValue: value },
  priorDerived: readonly Input[] = [],
  question = questionFor(givens, target),
): AmpereAreaFixture {
  return { id, givens, priorDerived, question, target, unit, value, sourceText, kind: "preserve", preserved };
}

export const ampereAreaFixtures: readonly AmpereAreaFixture[] = freezeDeep([
  ohm("ohm-parenthesized", "V = (3.0 A)(12 Ω) = 36 V", 36, "right"),
  ohm("ohm-parenthesized-current", "V = (3 A)*R = 36 V", 36, "right"),
  ohm("ohm-spaced-current", "V = 3 A*R = 36 V", 36, "right"),
  ohm("ohm-wrong-37", "V = (3 A)(12 Ω) = 37 V", 37, "wrong"),
  ohm("ohm-wrong-28.8", "V = 3 A*12 = 28.8 V", 28.8, "wrong"),

  // A remains a numeric area variable in genuine algebra, even when a
  // matching current is also supplied and the target is voltage.
  preserve("area-explicit-product", collision, "V = 3*A = 2.4 V", 2.4),
  preserve("area-glued-product", collision, "V = 3A = 2.4 V", 2.4),
  preserve("area-continuing-product", [...collision, input("coefficient", "B", 2, "")], "V = 3 A B = 4.8 V", 4.8),
  preserve("area-denominator", collision, "V = 3*R/A = 45 V", 45),
  preserve("resistivity-area", [input("rho", "rho", 2, "Ω m"), input("length", "L", 2, "m"), input("area", "A", 0.8, "m²"), current],
    "R_wire = rho*L/A = 5 Ω", 5, "Ω", "R_wire"),

  preserve("no-given-current", [area, resistance], "V = 3 A*R = 36 V", 36, "V", "V",
    { rawValid: false, reconciledValid: false, reconciledValue: 36 }),
  preserve("derived-only-current", [area, resistance], "V = 3 A*R = 36 V", 36, "V", "V",
    { rawValid: false, reconciledValid: false, reconciledValue: 36 },
    [input("derived_current", "I_max", 3, "A")]),
  preserve("unrelated-target", collision, "E = 3 A*R = 28.8 J", 28.8, "J", "E"),
  preserve("unrelated-target-unit", collision, "V = 3 A*R = 28.8 J", 28.8, "J"),
  preserve("no-area-collision", [resistance, current], "V = 3 A*R = 36 V", 36),
  preserve("non-area-A", [input("length", "A", 0.8, "m"), resistance, current], "V = 3 A*R = 28.8 V", 28.8),
  preserve("different-current-number", [area, resistance, input("max_current", "I_max", 2, "A")], "V = 3 A*R = 28.8 V", 28.8),
  preserve("ungrounded-given-current", [area, resistance, input("max_current", "I_max", 3, "A", "current selected by planner")],
    "V = 3 A*R = 28.8 V", 28.8, "V", "V", undefined, [], questionFor([area, resistance], "V")),
  preserve("mismatched-given-current", [area, resistance, input("max_current", "I_max", 3, "A", "I_max = 2 A")],
    "V = 3 A*R = 28.8 V", 28.8, "V", "V", undefined, [], questionFor([area, resistance, input("max_current", "I_max", 2, "A")], "V")),
  preserve("duplicate-area-symbol", [area, input("other_area", "A", 0.6, "mm²"), resistance, current], "V = 3 A*R = 21.6 V", 21.6),
  preserve("duplicate-current-symbol", [area, resistance, current, input("other_current", "I_max", 4, "A")], "V = 3 A*R = 28.8 V", 28.8),
  preserve("prefixed-current", [area, resistance, input("max_current", "I_max", 3, "mA")], "V = 3 A*R = 28.8 V", 28.8),
  preserve("negative-label-unmatched", collision, "V = -3 A*R = -28.8 V", -28.8),
]);

// Complete public diagnostic parity captured on the restored main behavior,
// before the fix. Every preservation plan was returned completely unchanged
// and had zero reconciliations. Only these fixed issue/decline records varied.
export const ampereAreaBaselineDetails = freezeDeep({
  invalidIssues: {
    "no-given-current": [{
      code: "source_text_arithmetic_invalid", path: "derived[0].sourceText",
      message: "an independently checkable calculation in sourceText is arithmetically incorrect",
    }],
    "derived-only-current": [{
      code: "source_text_arithmetic_invalid", path: "derived[1].sourceText",
      message: "an independently checkable calculation in sourceText is arithmetically incorrect",
    }],
  },
  declinedCaseIds: [
    "area-explicit-product", "area-continuing-product", "area-denominator",
    "unrelated-target", "unrelated-target-unit", "different-current-number",
    "ungrounded-given-current", "mismatched-given-current", "duplicate-area-symbol",
    "duplicate-current-symbol", "prefixed-current", "negative-label-unmatched",
  ],
});

export function makeAmpereAreaPlan(test: AmpereAreaFixture, spelling: Spelling): TurnPlanV3 {
  const symbol = spelling === "X" ? "X" : test.target;
  return freezeDeep({
    schemaVersion: "turn-plan/v3",
    question: test.question,
    givens: test.givens.map((given) => ({ ...given, provenance: "given" })),
    unknowns: [{ id: "answer", symbol, unit: test.unit }],
    derived: [
      ...test.priorDerived.map((quantity) => ({ ...quantity, provenance: "derived" as const })),
      { id: "answer", symbol, unit: test.unit, value: test.value,
        sourceText: test.sourceText, provenance: "derived",
        dependsOn: [...test.givens, ...test.priorDerived].map((quantity) => quantity.id) },
    ],
    qualitativeClaims: [],
    lawIds: ["ohms_law"],
    assumptions: [],
    visualRequirement: "optional",
  } satisfies TurnPlanV3);
}

export function ampereAreaRepresentsTruth(quantity: TurnPlanQuantityV3 | undefined): boolean {
  return quantity !== undefined && quantity.unit === "V" && Math.abs(quantity.value - 36) <= 1e-9;
}

const failures: string[] = [];
let checks = 0;
let plans = 0;
function check(condition: boolean, name: string, message: string): void {
  checks += 1;
  if (!condition) failures.push(`${name}: ${message}`);
}

for (const test of ampereAreaFixtures) {
  for (const spelling of ["X", "named"] as const) {
    plans += 1;
    const name = `${test.id}/${spelling}`;
    const plan = makeAmpereAreaPlan(test, spelling);
    const before = JSON.stringify(plan);
    try {
      const raw = validateTurnPlanV3(plan, plan.question);
      const reconciled = reconcileTurnPlanV3ExplicitArithmetic(plan);
      const after = validateTurnPlanV3(reconciled.plan, plan.question);
      const result = (reconciled.plan as TurnPlanV3).derived.at(-1);
      if (process.argv.includes("--baseline")) console.log(JSON.stringify({ name, rawValid: raw.valid,
        rawIssues: raw.issues, rawValue: raw.plan?.derived.at(-1)?.value,
        rawUnit: raw.plan?.derived.at(-1)?.unit, reconciledValid: after.valid,
        reconciledIssues: after.issues, reconciled,
        reconciledPlanMatchesInput: JSON.stringify(reconciled.plan) === before }));
      if (test.kind === "preserve") {
        const expected = test.preserved;
        check(expected !== undefined && raw.valid === expected.rawValid, `${name}/raw-baseline`,
          `expected valid ${expected?.rawValid}, got ${raw.valid}`);
        check(expected !== undefined && after.valid === expected.reconciledValid, `${name}/reconciled-baseline`,
          `expected valid ${expected?.reconciledValid}, got ${after.valid}`);
        check(expected !== undefined && result?.value === expected.reconciledValue && result?.unit === test.unit,
          `${name}/value-baseline`, `expected ${expected?.reconciledValue} ${test.unit}, got ${result?.value} ${result?.unit}`);
        const expectedIssues = Object.entries(ampereAreaBaselineDetails.invalidIssues)
          .find(([id]) => id === test.id)?.[1] ?? [];
        const expectedDeclines = ampereAreaBaselineDetails.declinedCaseIds.includes(test.id)
          ? [{ quantityId: "answer", reason: "mixed_units" }] : [];
        check(JSON.stringify(raw.issues) === JSON.stringify(expectedIssues), `${name}/raw-issues-baseline`,
          `expected ${JSON.stringify(expectedIssues)}, got ${JSON.stringify(raw.issues)}`);
        check(JSON.stringify(after.issues) === JSON.stringify(expectedIssues), `${name}/reconciled-issues-baseline`,
          `expected ${JSON.stringify(expectedIssues)}, got ${JSON.stringify(after.issues)}`);
        check(raw.valid ? JSON.stringify(raw.plan) === before : raw.plan === null,
          `${name}/raw-plan-baseline`, "raw validation changed the full plan or returned an invalid plan");
        check(JSON.stringify(reconciled.plan) === before, `${name}/full-reconciled-plan-baseline`,
          "reconciliation changed the full baseline plan");
        check(after.valid ? JSON.stringify(after.plan) === before : after.plan === null,
          `${name}/validated-reconciled-plan-baseline`, "validation changed the full reconciled plan or returned an invalid plan");
        check(JSON.stringify(reconciled.reconciliations) === "[]", `${name}/reconciliations-baseline`,
          `expected [], got ${JSON.stringify(reconciled.reconciliations)}`);
        check(JSON.stringify(reconciled.declined) === JSON.stringify(expectedDeclines), `${name}/declines-baseline`,
          `expected ${JSON.stringify(expectedDeclines)}, got ${JSON.stringify(reconciled.declined)}`);
      } else {
        if (test.kind === "right") {
          check(raw.valid, `${name}/raw`, `correct 36 V rejected: ${raw.issues.map((issue) => issue.code).join(", ")}`);
          check(after.valid, `${name}/reconciled`, `correct 36 V rejected: ${after.issues.map((issue) => issue.code).join(", ")}`);
          check(ampereAreaRepresentsTruth(result), `${name}/preserve-right`, `36 V became ${result?.value} ${result?.unit}`);
        } else {
          check(!raw.valid, `${name}/raw`, `wrong ${test.value} V admitted`);
          const truthful = ampereAreaRepresentsTruth(result);
          check(!after.valid || truthful, `${name}/reject-or-correct`, `wrong ${result?.value} ${result?.unit} admitted`);
          check(result?.value === test.value || truthful, `${name}/no-third-wrong`,
            `${test.value} V became different wrong ${result?.value} ${result?.unit}`);
        }
        if (after.valid) check(ampereAreaRepresentsTruth(after.plan?.derived.at(-1)), `${name}/admitted-value`,
          `admitted ${after.plan?.derived.at(-1)?.value} ${after.plan?.derived.at(-1)?.unit}, truth 36 V`);
      }
      check(JSON.stringify(plan) === before, `${name}/immutable-input`, "validation or reconciliation mutated the plan");
    } catch (error) {
      failures.push(`${name}/exception: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`Ampere/area gate RED: ${failures.length} failures across ${checks} checks, ${plans} plans, ${ampereAreaFixtures.length} frozen fixtures.`);
  process.exitCode = 1;
} else {
  console.log(`Ampere/area gate GREEN: ${checks} checks, ${plans} plans, ${ampereAreaFixtures.length} frozen fixtures.`);
}
