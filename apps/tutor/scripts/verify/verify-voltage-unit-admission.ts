/**
 * Authored voltage-unit collision controls through the built package exports.
 * Run after building scene-engine and tutor-core:
 * pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-voltage-unit-admission.ts
 * No model, HTTP, database, scene rendering, or historical student content.
 */
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  validateTurnPlanV3,
  type TurnPlanQuantityV3,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { parseTurnPlanV3Content, type TurnPlanV3ParseTrace } from "@heytutor/tutor-core";

const failures: string[] = [];
let checks = 0;
let cases = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  checks++;
  if (!condition) failures.push(`${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
}

function close(actual: unknown, expected: number): boolean {
  return typeof actual === "number" && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

function given(id: string, symbol: string, value: number, unit: string, sourceText: string): TurnPlanQuantityV3 {
  return { id, symbol, value, unit, sourceText, provenance: "given" };
}

function planFor(
  question: string,
  givens: TurnPlanQuantityV3[],
  symbol: string,
  value: number,
  unit: string,
  sourceText: string,
): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, givens,
    unknowns: [{ id: "answer", symbol, unit }],
    derived: [{ id: "answer", symbol, value, unit, sourceText, provenance: "derived", dependsOn: givens.map((entry) => entry.id) }],
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "optional",
  };
}

function observe(name: string, plan: TurnPlanV3) {
  const before = JSON.stringify(plan);
  const raw = validateTurnPlanV3(plan, plan.question);
  const arithmetic = reconcileTurnPlanV3ExplicitArithmetic(plan);
  const reconciled = arithmetic.plan as TurnPlanV3;
  const validation = validateTurnPlanV3(reconciled, plan.question);
  const trace: TurnPlanV3ParseTrace = {};
  const live = parseTurnPlanV3Content(JSON.stringify(plan), plan.question, trace);
  check(`${name}: boundary calls preserve the input object`, JSON.stringify(plan) === before);
  check(`${name}: reconcile preserves source-bound givens`, JSON.stringify(reconciled.givens) === JSON.stringify(plan.givens));
  check(`${name}: live parser preserves source-bound givens`, live === null || JSON.stringify(live.givens) === JSON.stringify(plan.givens));
  cases++;
  const detail = { rawIssues: raw.issues.map((issue) => issue.code), changes: arithmetic.reconciliations,
    reconciledValue: reconciled.derived[0]?.value, liveValue: live?.derived[0]?.value ?? null, liveIssues: trace.issues?.map((issue) => issue.code) };
  return { raw, arithmetic, reconciled, validation, live, trace, detail };
}

function right(name: string, plan: TurnPlanV3, expected: number): void {
  const result = observe(name, plan);
  check(`${name}: raw validation accepts the right value`, result.raw.valid, result.raw.issues);
  check(`${name}: reconcile retains the right value`, close(result.reconciled.derived[0]?.value, expected), result.detail);
  check(`${name}: reconciled plan validates`, result.validation.valid, result.validation.issues);
  check(`${name}: live admission retains the right value`, close(result.live?.derived[0]?.value, expected), result.detail);
  check(`${name}: correct source text remains intact`, result.reconciled.derived[0]?.sourceText === plan.derived[0]?.sourceText);
}

function wrong(name: string, plan: TurnPlanV3, expected: number): void {
  const result = observe(name, plan);
  check(`${name}: raw validation cannot admit the wrong value`, !result.raw.valid, result.raw.issues);
  check(`${name}: reconcile rejects or corrects to the truth`, !result.validation.valid || close(result.reconciled.derived[0]?.value, expected), result.detail);
  check(`${name}: live admission rejects or corrects to the truth`, result.live === null || close(result.live.derived[0]?.value, expected), result.detail);
  const source = result.live?.derived[0]?.sourceText ?? "";
  const original = plan.derived[0]?.sourceText ?? "";
  check(`${name}: correction preserves the written substitution`, result.live === null || source.slice(0, source.lastIndexOf("=")) === original.slice(0, original.lastIndexOf("=")), source);
  check(`${name}: correction updates the measured conclusion`, result.live === null || source.trim().endsWith(`${expected} ${plan.derived[0]?.unit}`), source);
  check(`${name}: corrected live plan validates`, result.live === null || validateTurnPlanV3(result.live, plan.question).valid);
}

const QUESTION = "Given a 12 V source labelled V and two series resistors R1 = 2 Ω and R2 = 4 Ω, find the current I.";
const CIRCUIT = [given("V", "V", 12, "V", "V = 12 V"), given("R1", "R1", 2, "Ω", "R1 = 2 Ω"), given("R2", "R2", 4, "Ω", "R2 = 4 Ω")];

// V may be bound by its quantity ID, symbol, or preserved source assignment.
for (const [binding, voltage] of [
  ["id", given("V", "emf", 12, "V", "12 V")],
  ["symbol", given("voltage", "V", 12, "V", "12 V")],
  ["source-alias", given("voltage", "emf", 12, "V", "V = 12 V")],
] as const) for (const symbol of ["I", "X"]) for (const source of ["I = V/(R1 + R2) = 12 V / 6 Ω", "I = 12 V / 6 Ω"]) {
  const givens = [voltage, ...CIRCUIT.slice(1)];
  right(`series/${binding}/${symbol}/${source}/right`, planFor(QUESTION, givens, symbol, 2, "A", `${source} = 2 A`), 2);
  wrong(`series/${binding}/${symbol}/${source}/wrong`, planFor(QUESTION, givens, symbol, 24, "A", `${source} = 24 A`), 2);
}

// A genuine factor containing V retains its given value. It is not a unit label.
for (const symbol of ["I", "X"]) for (const product of ["2*V", "2 × V", "2(V)"]) {
  right(`voltage-product/${symbol}/${product}/right`, planFor(QUESTION, CIRCUIT, symbol, 4, "A", `I = ${product}/(R1 + R2) = 4 A`), 4);
  wrong(`voltage-product/${symbol}/${product}/wrong`, planFor(QUESTION, CIRCUIT, symbol, 2, "A", `I = ${product}/(R1 + R2) = 2 A`), 4);
}
right("voltage-product/non-numeric-factor", planFor(QUESTION, [...CIRCUIT, given("k", "k", 2, "", "k = 2")], "I", 4, "A", "I = k V/(R1 + R2) = 4 A"), 4);

for (const symbol of ["I", "X"]) {
  const correct = planFor(QUESTION, CIRCUIT, symbol, 2, "A", "I = V/(R1 + R2) = 12 V / 6 Ω = 2 A");
  correct.qualitativeClaims = [{ id: "current", claim: `${symbol} = 2 A`, expected: true, relatedQuantityIds: ["answer"] }];
  right(`claim/${symbol}/correct`, correct, 2);
  for (const value of [2, 24]) {
    const stale = structuredClone(correct);
    stale.derived[0]!.value = value;
    stale.derived[0]!.sourceText = `I = V/(R1 + R2) = 12 V / 6 Ω = ${value} A`;
    stale.qualitativeClaims[0]!.claim = `${symbol} = 24 A`;
    const result = observe(`claim/${symbol}/stale-${value}`, stale);
    check(`claim/${symbol}/stale-${value}: stale claim blocks live admission`, result.live === null, result.detail);
    check(`claim/${symbol}/stale-${value}: claim mismatch remains explicit`, result.validation.issues.some((issue) => issue.code === "claim_quantity_mismatch"), result.validation.issues);
    check(`claim/${symbol}/stale-${value}: reconcile does not silently rewrite the claim`, JSON.stringify(result.reconciled.qualitativeClaims) === JSON.stringify(stale.qualitativeClaims));
  }
}

// These authored scope controls are pinned to main 4ab84cd2, not requests to
// broaden this repair to other unit collisions or mixed-unit interpretation.
const scopeControls = [
  { name: "force-g-to-kg", question: "Given m = 250 g and a = 4 m/s^2, find F.", givens: [given("m", "m", 250, "g", "m = 250 g"), given("a", "a", 4, "m/s^2", "a = 4 m/s^2")], symbol: "F", unit: "N", right: 1, wrong: 1000, rightSource: "F = m*a = 0.25 kg × 4 m/s^2 = 1 N", wrongSource: "F = m*a = 250 kg × 4 m/s^2 = 1000 N" },
  { name: "energy-cm-to-m", question: "Given m = 2 kg, g = 9.8 m/s^2 and h = 80 cm, find PE.", givens: [given("m", "m", 2, "kg", "m = 2 kg"), given("g", "g", 9.8, "m/s^2", "g = 9.8 m/s^2"), given("h", "h", 80, "cm", "h = 80 cm")], symbol: "PE", unit: "J", right: 15.68, wrong: 1568, rightSource: "PE = m*g*h = 2 kg × 9.8 m/s^2 × 0.8 m = 15.68 J", wrongSource: "PE = m*g*h = 2 kg × 9.8 m/s^2 × 80 m = 1568 J" },
  { name: "capacitor-microfarad", question: "Given C = 4 μF and V = 6 V, find Q.", givens: [given("C", "C", 4, "μF", "C = 4 μF"), given("V", "V", 6, "V", "V = 6 V")], symbol: "Q", unit: "C", right: 0.000024, wrong: 24, rightSource: "Q = C*V = 4e-6 F × 6 V = 0.000024 C", wrongSource: "Q = C*V = 4 F × 6 V = 24 C" },
  { name: "current-milliampere", question: "Given V = 12 V and series resistors R1 = 100 Ω and R2 = 300 Ω, find I in mA.", givens: [given("V", "V", 12, "V", "V = 12 V"), given("R1", "R1", 100, "Ω", "R1 = 100 Ω"), given("R2", "R2", 300, "Ω", "R2 = 300 Ω")], symbol: "I", unit: "mA", right: 30, wrong: 40, rightSource: "I = V/(R1+R2) = 12/(100+300) = 0.03 A = 30 mA", wrongSource: "I = V/(R1+R2) = 12/(100+300) = 0.04 A = 40 mA" },
];
for (const control of scopeControls) for (const symbol of [control.symbol, "X"]) for (const isRight of [true, false]) {
  const name = `main-scope/${control.name}/${symbol}/${isRight ? "right" : "wrong"}`;
  const value = isRight ? control.right : control.wrong;
  const source = isRight ? control.rightSource : control.wrongSource;
  const input = planFor(control.question, control.givens, symbol, value, control.unit, source);
  const result = observe(name, input);
  const corrected = !isRight && control.name === "current-milliampere";
  const accepted = isRight || corrected;
  check(`${name}: raw decision stays pinned`, result.raw.valid === isRight, result.detail);
  check(`${name}: raw issue stays pinned`, JSON.stringify(result.raw.issues.map((issue) => issue.code)) === JSON.stringify(isRight ? [] : ["source_text_arithmetic_invalid"]), result.raw.issues);
  check(`${name}: reconciled value stays pinned`, close(result.reconciled.derived[0]?.value, corrected ? control.right : value), result.detail);
  check(`${name}: reconciled decision stays pinned`, result.validation.valid === accepted, result.validation.issues);
  check(`${name}: live result stays pinned`, accepted ? close(result.live?.derived[0]?.value, control.right) : result.live === null, result.detail);
  check(`${name}: source stays pinned`, result.reconciled.derived[0]?.sourceText === (corrected ? control.rightSource : source));
}

if (failures.length > 0) {
  console.error(`voltage-unit admission RED: ${failures.length}/${checks} checks failed across ${cases} authored plans`);
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`voltage-unit admission GREEN: ${checks} checks across ${cases} authored plans (raw validation, reconciliation, built live parser; no scene/save/teaching replay)`);
}
