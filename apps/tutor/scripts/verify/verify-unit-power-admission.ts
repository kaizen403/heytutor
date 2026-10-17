/**
 * Authored controls for the small unit-power/grouped-denominator repair.
 * Source seam: atomic admission versus unchanged legacy public exports.
 * Main-accepted outcomes stay byte identical, including existing rewrites;
 * only a newly admitted plan must be identical to the original input.
 * Optional --live:
 * the built tutor-core parser, so build drawing/scene-engine/tutor-core first.
 * pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-unit-power-admission.ts --live
 * --source-root=/absolute/tree supports an old tree without modifying either tree.
 * --report-baseline prints public-boundary observations for the review companions.
 * No historical questions/plans, model, network, database, rendering, or saves.
 */
import { build } from "esbuild";
import { createRequire, Module } from "node:module";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TurnPlanQuantityV3, TurnPlanV3 } from "@heytutor/scene-engine";
import type { TurnPlanV3ParseTrace } from "@heytutor/tutor-core";

type SceneAPI = Pick<typeof import("@heytutor/scene-engine"), "validateTurnPlanV3" | "reconcileTurnPlanV3ExplicitArithmetic" | "admitTurnPlanV3">;
type LegacyObservation = {
  raw: ReturnType<SceneAPI["validateTurnPlanV3"]>;
  arithmetic: ReturnType<SceneAPI["reconcileTurnPlanV3ExplicitArithmetic"]>;
  validation: ReturnType<SceneAPI["validateTurnPlanV3"]>;
};
type LiveObservation = { live: TurnPlanV3 | null; trace: TurnPlanV3ParseTrace; legacy: LegacyObservation };
type Baseline = { raw: boolean; valid: boolean; value: number; source: string; live: number | null };
type Fixture = { name: string; plan: TurnPlanV3; accepts: boolean; allowDecline?: boolean; baseline?: Baseline | "pending";
  truth?: { value: number; source: string }; knownWrongLegacy?: { value: number; source: string }; requiresLegacyRejection?: boolean };
const fixtures: Fixture[] = [];
const failures: string[] = [];
let checks = 0;
const liveEnabled = process.argv.includes("--live");
const reportBaseline = process.argv.includes("--report-baseline");
const ownRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const sourceRoot = resolve(process.argv.find((arg) => arg.startsWith("--source-root="))?.slice(14) ?? ownRoot);

function given(symbol: string, value: number, unit: string): TurnPlanQuantityV3 {
  return { id: symbol, symbol, value, unit, sourceText: `${symbol} = ${value} ${unit}`, provenance: "given" };
}
function plan(question: string, givens: TurnPlanQuantityV3[], symbol: string, value: number, unit: string, sourceText: string): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, givens,
    unknowns: [{ id: "answer", symbol, unit }],
    derived: [{ id: "answer", symbol, value, unit, sourceText, provenance: "derived", dependsOn: givens.map((entry) => entry.id) }],
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "optional" };
}
function pair(name: string, input: TurnPlanV3, wrong: number, strict = true): void {
  fixtures.push({ name: `${name}/right`, plan: input, accepts: true });
  const incorrect = structuredClone(input);
  const result = incorrect.derived[0]!;
  result.sourceText = result.sourceText!.replace(/([=≈]\s*)[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?=\s|$)(?=[^=;]*$)/i,
    (_match, prefix: string) => `${prefix}${wrong}`);
  result.value = wrong;
  // Recorded on main a0a029cb at both seams: legacy explicit arithmetic
  // repairs these conclusions. The two exceptions are pinned below.
  const expected = input.derived[0]!;
  fixtures.push({ name: `${name}/wrong`, plan: incorrect, accepts: false,
    ...(!strict ? { baseline: { raw: false, valid: true, value: expected.value, source: expected.sourceText!, live: expected.value } } : {}) });
}
function pin(name: string, baseline: Baseline | "pending"): void {
  const fixture = fixtures.find((entry) => entry.name === name);
  if (!fixture) throw new Error(`Unknown authored baseline ${name}`);
  fixture.baseline = baseline;
}
function pinKnownWrongLegacy(name: string, value: number, source: string): void {
  const fixture = fixtures.find((entry) => entry.name === name);
  if (!fixture) throw new Error(`Unknown legacy-wrong fixture ${name}`);
  fixture.knownWrongLegacy = { value, source };
}
function check(name: string, condition: boolean, detail?: unknown): void {
  checks++;
  if (!condition) failures.push(`${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
}
function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function close(left: unknown, right: number): boolean {
  return typeof left === "number" && Math.abs(left - right) <= 1e-10 * Math.max(Math.abs(right), 1e-12);
}

const resistors = [given("R1", 2, "Ω"), given("R2", 4, "Ω"), given("R3", 6, "Ω")];
const parallel = "Resistors R1 = 2 Ω, R2 = 4 Ω and R3 = 6 Ω are connected in parallel. Find their equivalent resistance.";
// Review Problem 1 under the 17 Oct 13:00 steer: preserve every legacy
// acceptance byte for byte, including legacy precision rewrites. Wrong
// inputs repaired by legacy are compatibility controls, not new rejections.
const roundedReview = [
  { name: "parallel-0.917", input: plan(parallel, resistors, "R_eq", 1.09, "Ω",
    "1/R_eq = 1/2 + 1/4 + 1/6 = 0.917 Ω⁻¹; R_eq = 1.09 Ω"), wrong: 10.9 },
  { name: "parallel-approx-0.92", input: plan(parallel, resistors, "R_eq", 1.09, "Ω",
    "1/R_eq = 1/2 + 1/4 + 1/6 ≈ 0.92 Ω⁻¹; R_eq ≈ 1.09 Ω"), wrong: 10.9 },
  { name: "parallel-3-and-4", input: plan("Resistors R1 = 3 Ω and R2 = 4 Ω are connected in parallel. Find R.",
    [given("R1", 3, "Ω"), given("R2", 4, "Ω")], "R", 1.71, "Ω", "1/R = 1/3 + 1/4 = 0.583 Ω⁻¹; R = 1.71 Ω"), wrong: 17.1 },
  { name: "wave-number-12.566", input: plan("A wave has wavelength λ = 0.5 m. Find its wave number k.",
    [given("λ", 0.5, "m")], "k", 12.566, "m⁻¹", "k = 2π/λ = 2 × 3.1416 / 0.5 = 12.566 m⁻¹"), wrong: 125.66 },
  { name: "wave-number-12.57", input: plan("A wave has wavelength λ = 0.5 m. Find its wave number k.",
    [given("λ", 0.5, "m")], "k", 12.57, "m⁻¹", "k = 2π/λ = 2π/0.5 = 12.57 m⁻¹"), wrong: 125.7 },
  { name: "centripetal-33.3", input: plan("An object moves at v = 10 m/s on a circle of radius r = 3 m. Find a.",
    [given("v", 10, "m/s"), given("r", 3, "m")], "a", 33.3, "m s⁻²", "a = v²/r = 10²/3 = 33.3 m s⁻²"), wrong: 333 },
  { name: "optical-power-3.33", input: plan("A lens has focal length f = 0.3 m. Find its power P.",
    [given("f", 0.3, "m")], "P", 3.33, "m⁻¹", "P = 1/f = 1/0.3 = 3.33 m⁻¹"), wrong: 33.3 },
  { name: "frequency-33.3", input: plan("An oscillator has period T = 0.03 s. Find its frequency f.",
    [given("T", 0.03, "s")], "f", 33.3, "s⁻¹", "f = 1/T = 1/0.03 = 33.3 s⁻¹"), wrong: 333 },
];
for (const { name, input, wrong } of roundedReview) pair(`review-180/problem-1/${name}`, input, wrong);

const parallelCurrentQuestion = "Resistors R1 = 2 Ω, R2 = 4 Ω and R3 = 6 Ω are connected in parallel across 12 V. Find R_eq and the total current I_total.";
function parallelCurrent(sourceText: string, resistance = 1.09): TurnPlanV3 {
  const input = plan(parallelCurrentQuestion, [...resistors, given("V", 12, "V")], "R_eq", resistance, "Ω", sourceText);
  input.unknowns[0]!.id = "R_eq";
  input.derived[0]!.id = "R_eq";
  input.unknowns.push({ id: "I_total", symbol: "I_total", unit: "A" });
  input.derived.push({ id: "I_total", symbol: "I_total", value: 11, unit: "A", provenance: "derived",
    sourceText: "I_total = V/R_eq = 12/(12/11) = 11 A", dependsOn: ["V", "R_eq"] });
  return input;
}
// Problem 1 row 2 must accept both derived quantities, not merely tolerate
// rejection. Legacy's complete outcome, including both derived rows, wins.
fixtures.push({ name: "review-180/problem-1/rounded-parallel-with-current", accepts: true,
  plan: parallelCurrent("1/R_eq = 1/2 + 1/4 + 1/6 = 0.917 Ω⁻¹; R_eq = 1.09 Ω") });
// Problem 2 allows a refusal when legacy rejects. A newly accepted plan may
// not rewrite either derived row, including the current after rounded R_eq.
for (const unit of ["Ω⁻¹", "Ω^-1"]) for (const resistance of [1.09, 1.0909]) {
  const input = parallelCurrent(`1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 ${unit}; R_eq = 12/11${resistance === 1.09 ? " Ω" : ""} ≈ ${resistance} Ω`, resistance);
  fixtures.push({ name: `review-180/problem-2/${unit}/${resistance}`, accepts: true, allowDecline: true, plan: input });
}
// Both quantities need the fallback: a standalone grouped quotient may be
// accepted by the old path, so that fixture alone cannot guard this reader.
const groupedFallback = parallelCurrent("1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 Ω⁻¹; R_eq = 12/11 Ω", 12 / 11);
groupedFallback.derived[1]!.sourceText = "I_total = 12 V/(12/11 Ω) = 11 A";
fixtures.push({ name: "fallback-composite/grouped-current/unchanged", plan: groupedFallback,
  accepts: true, requiresLegacyRejection: true });
for (const [verdict, value] of [["right", 60], ["wrong", 600]] as const) {
  const reciprocalFallback = structuredClone(groupedFallback);
  reciprocalFallback.question = `${parallel} An oscillator has f0 = 120 Hz and reference period T = 1 s. Find half f0.`;
  reciprocalFallback.givens = [...resistors, given("f0", 120, "Hz"), given("T", 1, "s")];
  reciprocalFallback.derived[0]!.dependsOn = resistors.map((entry) => entry.id);
  reciprocalFallback.unknowns[1] = { id: "f", symbol: "f", unit: "Hz" };
  reciprocalFallback.derived[1] = { id: "f", symbol: "f", value, unit: "Hz", provenance: "derived",
    sourceText: `f = (120 1/s)/2 = ${value} Hz`, dependsOn: ["f0"] };
  fixtures.push({ name: `fallback-composite/reciprocal-unit/${verdict}`, plan: reciprocalFallback,
    accepts: verdict === "right", requiresLegacyRejection: true });
}

// These wrong rows may not be newly admitted. Any legacy acceptance retains
// exactly legacy's verdict, corrections and output, rather than a new repair.
fixtures.push({ name: "review-180/problem-1/wrong-intensity", accepts: false,
  plan: plan("A source supplies P = 100 W over area A = 4 m². Find intensity I.",
    [given("P", 100, "W"), given("A", 4, "m²")], "I", 50, "W m⁻²", "I = P/A = 100 W / 4 m² = 50 W m⁻²") });
fixtures.push({ name: "review-180/problem-1/wrong-wave-number", accepts: false,
  plan: plan("A wave has wavelength λ = 0.5 m. Find its wave number k.", [given("λ", 0.5, "m")],
    "k", 1.2566, "m⁻¹", "k = 2π/λ = 2 × 3.1416 / 0.5 = 1.2566 m⁻¹") });
fixtures.push({ name: "review-180/problem-1/wrong-moment-of-inertia", accepts: false,
  plan: plan("A point mass M = 2 kg is at radius r = 0.5 m. Find its moment of inertia I.",
    [given("M", 2, "kg"), given("r", 0.5, "m")], "I", 1, "kg m²", "I = M r² = 2 kg × (0.5 m)² = 1 kg m²") });

// Review Problem 3: preserve correct legacy acceptances. A scaled reading
// legacy rejected may still be declined; this is not a new conversion reader.
const scaledReview = [
  { name: "wire-area", input: plan("A wire has ρ = 1.7e-8 Ω m, L = 2 m and A = 0.5 mm². Find R.",
    [given("ρ", 1.7e-8, "Ω m"), given("L", 2, "m"), given("A", 0.5, "mm²")], "R", 0.068, "Ω",
    "R = 1.7e-8 × 2 / 0.5 mm² = 0.068 Ω"), wrong: 0.68 },
  { name: "wire-area-measured-products", input: plan("A wire has ρ = 1.7e-8 Ω m, L = 2 m and A = 0.5 mm². Find R.",
    [given("ρ", 1.7e-8, "Ω m"), given("L", 2, "m"), given("A", 0.5, "mm²")], "R", 0.068, "Ω",
    "R = (1.7 × 10⁻⁸ Ω m)(2 m)/(0.5 mm²) = 0.068 Ω"), wrong: 0.68 },
  { name: "pressure-area", input: plan("A force F = 600 N acts on area A = 300 cm². Find pressure P.",
    [given("F", 600, "N"), given("A", 300, "cm²")], "P", 20000, "Pa",
    "P = 600 N / 300 cm² = 20000 Pa"), wrong: 2 },
  { name: "volume-from-area", input: plan("A prism has area A = 0.5 mm² and length L = 2 m. Find V.",
    [given("A", 0.5, "mm²"), given("L", 2, "m")], "V", 0.000001, "m³",
    "V = 0.5 mm² × 2 m = 0.000001 m³"), wrong: 1 },
  { name: "doubled-area", input: plan("An area A = 0.5 mm² has reference length L = 2 m. Find twice its area A2 in m².",
    [given("A", 0.5, "mm²"), given("L", 2, "m")], "A2", 1e-6, "m²",
    "A2 = 2 × 0.5 mm² = 1e-6 m²"), wrong: 1 },
  { name: "doubled-volume", input: plan("A volume V0 = 50 cm³ has reference length x = 1 m. Find twice its volume V in m³.",
    [given("V0", 50, "cm³"), given("x", 1, "m")], "V", 1e-4, "m³",
    "V = 2 × 50 cm³ = 0.0001 m³"), wrong: 100 },
  { name: "greptile-km-area", input: plan("Given A0 = 4 km² and d = 2 km, find half the area S in m².",
    [given("A0", 4, "km²"), given("d", 2, "km")], "S", 2000000, "m²",
    "S = (4 km²) / 2 = 2000000 m²"), wrong: 2 },
  { name: "reciprocal-megaohm", input: plan("Given G0 = 4 MΩ⁻¹ and R = 1 Ω, find half the conductance G in Ω⁻¹.",
    [given("G0", 4, "MΩ⁻¹"), given("R", 1, "Ω")], "G", 2e-6, "Ω⁻¹",
    "G = 4 MΩ⁻¹ / 2 = 0.000002 Ω⁻¹"), wrong: 2 },
];
for (const { name, input, wrong } of scaledReview) {
  pair(`review-180/problem-3/${name}`, input, wrong);
  fixtures.find((entry) => entry.name === `review-180/problem-3/${name}/right`)!.allowDecline = true;
}
// The review measured these wrong legacy results. The new policy preserves
// them; they are explicitly NOT counted as corrected or newly supported.
pinKnownWrongLegacy("review-180/problem-3/greptile-km-area/wrong", 8, "S = (4 km²) / 2 = 8 m²");
pinKnownWrongLegacy("review-180/problem-3/reciprocal-megaohm/wrong", 0.5, "G = 4 MΩ⁻¹ / 2 = 2 Ω⁻¹");

// A whole plan rejected by legacy must not use the new coherent resistance
// reading to launder an unrelated wrong scaled result into admission. Unlike
// the legacy-wrong pins above, these exercise the actual fallback branch.
for (const scaled of [
  { name: "km-area", question: "An area A0 = 4 km² has reference distance d = 2 km. Also find half the area S in m².",
    givens: [given("A0", 4, "km²"), given("d", 2, "km")], symbol: "S", unit: "m²", correct: 2000000, wrong: 2,
    source: (value: number) => `S = (4 km²) / 2 = ${value} m²` },
  { name: "inverse-megaohm", question: "A conductance G0 = 4 MΩ⁻¹ has reference resistance R0 = 1 Ω. Also find half the conductance G in Ω⁻¹.",
    givens: [given("G0", 4, "MΩ⁻¹"), given("R0", 1, "Ω")], symbol: "G", unit: "Ω⁻¹", correct: 0.000002, wrong: 2,
    source: (value: number) => `G = 4 MΩ⁻¹ / 2 = ${value} Ω⁻¹` },
  { name: "bound-voltage-powered-product", question: "The resistors are connected across V = 12 V. Also find the total current I_total.",
    givens: [given("V", 12, "V")], symbol: "I_total", unit: "A", correct: 11, wrong: 132,
    source: (value: number) => `I_total = 12 V × 11/12 Ω⁻¹ = ${value} A` },
  { name: "bound-voltage-symbolic-product", question: "The resistors are connected across V = 12 V. Also find the total current I_total.",
    givens: [given("V", 12, "V")], symbol: "I_total", unit: "A", correct: 11, wrong: 132,
    source: (value: number) => `I_total = 12 V × (1/R_eq) = ${value} A` },
]) {
  for (const [verdict, value] of [["right", scaled.correct], ["wrong", scaled.wrong]] as const) {
    const input = plan(`${parallel} ${scaled.question}`, [...resistors, ...scaled.givens], "R_eq", 12 / 11, "Ω",
      `1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 Ω⁻¹; R_eq = ${12 / 11} Ω`);
    input.unknowns[0]!.id = "R_eq";
    input.derived[0]!.id = "R_eq";
    input.unknowns.push({ id: "scaled_result", symbol: scaled.symbol, unit: scaled.unit });
    input.derived.push({ id: "scaled_result", symbol: scaled.symbol, value, unit: scaled.unit,
      provenance: "derived", sourceText: scaled.source(value), dependsOn: [
        ...scaled.givens.map((entry) => entry.id), ...(scaled.symbol === "I_total" ? ["R_eq"] : []),
      ] });
    fixtures.push({ name: `fallback-composite/${scaled.name}/${verdict}`, plan: input,
      accepts: verdict === "right", allowDecline: verdict === "right", requiresLegacyRejection: true });
  }
}

// Ten additional independently worked pairs vary the operands, precision,
// power sign and prefix. Scaled fallback-only right rows may be declined;
// the coherent production/unit-power controls below remain mandatory.
const additionalPairs = [
  { name: "rounded-circle-area", input: plan("A circle has radius r = 2 m. Find area A.", [given("r", 2, "m")],
    "A", 12.57, "m²", "A = π r² = 3.1416 × 2² = 12.57 m²"), wrong: 125.7 },
  { name: "rounded-parallel-7-and-11", input: plan("Resistors R1 = 7 Ω and R2 = 11 Ω are connected in parallel. Find R.",
    [given("R1", 7, "Ω"), given("R2", 11, "Ω")], "R", 4.28, "Ω", "1/R = 1/7 + 1/11 = 0.2338 Ω⁻¹; R = 4.28 Ω"), wrong: 42.8 },
  { name: "rounded-centripetal", input: plan("An object moves at v = 9 m/s on a circle of radius r = 7 m. Find a.",
    [given("v", 9, "m/s"), given("r", 7, "m")], "a", 11.6, "m s⁻²", "a = v²/r = 9²/7 = 11.6 m s⁻²"), wrong: 116 },
  { name: "rounded-frequency", input: plan("An oscillator has period T = 0.07 s. Find frequency f.", [given("T", 0.07, "s")],
    "f", 14.29, "s⁻¹", "f = 1/T = 1/0.07 = 14.29 s⁻¹"), wrong: 142.9 },
  { name: "quarter-cm-area", input: plan("Given A0 = 100 cm² and d = 1 cm, find one quarter of the area S in m².",
    [given("A0", 100, "cm²"), given("d", 1, "cm")], "S", 0.0025, "m²", "S = (100 cm²)/4 = 0.0025 m²"), wrong: 25 },
  { name: "third-cm-volume", input: plan("Given V0 = 750 cm³ and d = 1 cm, find one third of volume V in m³.",
    [given("V0", 750, "cm³"), given("d", 1, "cm")], "V", 0.00025, "m³", "V = (750 cm³)/3 = 0.00025 m³"), wrong: 250 },
  { name: "sixth-mm-area", input: plan("Given A0 = 18 mm² and d = 1 mm, find one sixth of area S in m².",
    [given("A0", 18, "mm²"), given("d", 1, "mm")], "S", 3e-6, "m²", "S = (18 mm²)/6 = 0.000003 m²"), wrong: 3 },
  { name: "third-inverse-cm-area", input: plan("Given K0 = 6 cm⁻² and d = 1 cm, find one third of K0 in m⁻².",
    [given("K0", 6, "cm⁻²"), given("d", 1, "cm")], "K", 20000, "m⁻²", "K = (6 cm⁻²)/3 = 20000 m⁻²"), wrong: 2 },
  { name: "quarter-inverse-cm", input: plan("Given k0 = 12 cm⁻¹ and d = 1 cm, find one quarter of k0 in m⁻¹.",
    [given("k0", 12, "cm⁻¹"), given("d", 1, "cm")], "k", 300, "m⁻¹", "k = (12 cm⁻¹)/4 = 300 m⁻¹"), wrong: 3 },
  { name: "half-km-volume", input: plan("Given V0 = 0.004 km³ and d = 1 km, find half the volume V in m³.",
    [given("V0", 0.004, "km³"), given("d", 1, "km")], "V", 2000000, "m³", "V = (0.004 km³)/2 = 2000000 m³"), wrong: 0.002 },
];
for (const { name, input, wrong } of additionalPairs) {
  pair(`additional/${name}`, input, wrong);
  if (/[ckm]m[²³⁻]/u.test(input.derived[0]!.sourceText ?? "")) {
    fixtures.find((entry) => entry.name === `additional/${name}/right`)!.allowDecline = true;
  }
}

// Scaled powers without a fully established conversion may be declined, but
// must never be rewritten into unscaled coefficients or a different source.
// In particular, 4 km² / 2 is NOT 2 m². A textual result unit cannot restore
// the factor lost by erasing an operand's unit.
for (const [base, label, answerUnit, correct] of [
  ["km", "km²", "m^2", 2000000],
  ["km", "km^2", "m^2", 2000000],
  ["km", "km⁻²", "m^-2", 0.000002],
  ["km", "km^(-2)", "m^-2", 0.000002],
  ["cm", "cm²", "m^2", 0.0002],
  ["cm", "cm^-2", "m^-2", 20000],
  ["km", "1/km", "m^-1", 0.002],
  ["cm", "1/cm", "m^-1", 200],
  ["km s^-1", "km s⁻¹", "m/s", 2000],
] as const) {
  for (const [verdict, value] of [["correct-but-unproven", correct], ["wrong", 2]] as const) {
    fixtures.push({ name: `scaled-power/${label}/${verdict}`, accepts: verdict === "correct-but-unproven",
      ...(verdict === "correct-but-unproven" ? { allowDecline: true } : {}),
      plan: plan(`Given d = 4 ${base}, evaluate half of the measured expression in ${answerUnit}.`,
        [given("d", 4, base)], "S", value, answerUnit, `S = (4 ${label}) / 2 = ${value} ${answerUnit}`) });
  }
}
pair("scaled-base/coherent-zero-power", plan("Given d = 4 km, evaluate (4 km^0)/2.",
  [given("d", 4, "km")], "S", 2, "", "S = (4 km^0)/2 = 2"), 3);
// Whole measured members retain the existing typed conversion path. The
// exception is not permission to compare their bare coefficients as equal.
pair("scaled-base/whole-measured-conversion", plan("A surface has area 2 km². Express its area in m².",
  [given("A0", 2, "km²")], "S", 2000000, "m²", "S = 2 km² = 2000000 m²"), 2);
pin("scaled-base/whole-measured-conversion/right", { raw: true, valid: true, value: 2000000,
  source: "S = 2 km² = 2000000 m²", live: 2000000 });
// Main already accepts this wrong typed restatement. Preserve the observation;
// this admission-only patch does not claim a general unit-conversion repair.
pin("scaled-base/whole-measured-conversion/wrong", { raw: true, valid: true, value: 2,
  source: "S = 2 km² = 2 m²", live: 2 });
fixtures.push({ name: "scaled-base/nonisolated-target/wrong", accepts: false,
  plan: plan("Given d = 4 km, solve the area relation in m².", [given("d", 4, "km")],
    "S", 2, "m²", "2*S = 4 km²; S = 2 m²") });
fixtures.push({ name: "main/terminal-rational-reciprocal", accepts: true,
  plan: plan("A lens has f = 15 cm and u = -20 cm. Find v from the lens equation.",
    [given("f", 15, "cm"), given("u", -20, "cm")], "v", 60, "cm",
    "1/v = 1/f + 1/u = 1/60 cm⁻¹; v = 60 cm") });
fixtures.push({ name: "main/whole-scaled-compound", accepts: true,
  plan: plan("State S = 2 km² s^-1, with reference length d = 4 km.",
    [given("d", 4, "km")], "S", 2, "km² s^-1", "S = 2 km² s^-1") });
fixtures.push({ name: "scaled-base/unknown-case/wrong", accepts: false,
  plan: plan("Given d = 4 km, evaluate half its squared-unit expression in m².",
    [given("d", 4, "km")], "S", 2, "m^2", "S = (4 KM²)/2 = 2 m^2") });
for (const unit of ["Ω⁻¹", "Ω^-1", "Ω^(-1)", "Ω^ -1", "Ω^( -1 )", "1/Ω"]) {
  pair(`unit-power/${unit}`, plan(parallel, resistors, "R_eq", 12 / 11, "Ω",
    `1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 ${unit}; R_eq = ${12 / 11} Ω`), 12);
}
fixtures.push({ name: "unit-power/coarse-bare-assertion/wrong", accepts: false,
  plan: plan(parallel, resistors, "R_eq", 1.4, "Ω", "1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 Ω⁻¹; R_eq = 1") });
pair("unit-power/s⁻¹", plan("An oscillator has frequency 120 s⁻¹. Find half its frequency.", [given("f0", 120, "s⁻¹")],
  "f", 60, "Hz", "f = 120 s⁻¹ / 2 = 60 Hz"), 600);
for (const unit of ["m s⁻²", "m s^-2"]) {
  pair(`unit-power/${unit}`, plan("Given m = 2 kg, displacement s = 4 m and F = 6 N, find acceleration a.",
    [given("m", 2, "kg"), given("s", 4, "m"), given("F", 6, "N")], "a", 3, "m/s^2",
    `a = F/m = 6 N / 2 kg = 3 ${unit}`), 30);
  pair(`unit-power/${unit}/arithmetic`, plan("Given a0 = 6 m/s^2, m = 2 kg and displacement s = 4 m, find half a0.",
    [given("a0", 6, "m/s^2"), given("m", 2, "kg"), given("s", 4, "m")], "a", 3, "m/s^2",
    `a = (6 ${unit}) / 2 = 3 m/s^2`), 30);
  // An arithmetic member with bound m/s retains main's reading. This repair
  // does not infer physical ownership of ambiguous coefficient-variable ink.
  const legacyCompound = { raw: false, valid: true, value: 0.375,
    source: `a = (6 ${unit}) / 2 = 0.375 m/s^2`, live: 0.375 };
  pin(`unit-power/${unit}/arithmetic/right`, legacyCompound);
  pin(`unit-power/${unit}/arithmetic/wrong`, legacyCompound);
  pair(`unit-power/${unit}/unbound-arithmetic`, plan("Given a0 = 6 m/s², find half a0.",
    [given("a0", 6, "m/s²")], "a", 3, "m/s^2", `a = (6 ${unit}) / 2 = 3 m/s^2`), 30);
  const boundQuestion = "Given m = 2 m and s = 4 s, evaluate a = (6 m s^-2)/2.";
  const boundGivens = [given("m", 2, "m"), given("s", 4, "s")];
  const boundSource = `a = (6 ${unit}) / 2 = 0.375 m/s^2`;
  fixtures.push({ name: `main/compound-same-dimension/${unit}/right`, accepts: true,
    plan: plan(boundQuestion, boundGivens, "a", 0.375, "m/s^2", boundSource) });
  fixtures.push({ name: `main/compound-same-dimension/${unit}/wrong`, accepts: false, truth: { value: 0.375, source: boundSource },
    plan: plan(boundQuestion, boundGivens, "a", 3, "m/s^2", `a = (6 ${unit}) / 2 = 3 m/s^2`) });
}
// A bound s remains a quantity in s^2 even when another given uses s⁻¹.
const squareGivens = [given("s", 4, "m"), given("f0", 120, "s⁻¹")];
const squareQuestion = "Given s = 4 m and f0 = 120 s⁻¹, find X = (2 s^2)/2.";
const squareSource = "X = (2 s^2)/2 = 16 m^2";
fixtures.push({ name: "main/bound-squared/right", accepts: true, plan: plan(squareQuestion, squareGivens, "X", 16, "m^2", squareSource) });
fixtures.push({ name: "main/bound-squared/wrong", accepts: false, truth: { value: 16, source: squareSource },
  plan: plan(squareQuestion, squareGivens, "X", 1, "m^2", "X = (2 s^2)/2 = 1 m^2") });
// Exact known ASCII m^-1 keeps main's observed rounding at both public seams.
const rydberg = { ...given("R_H", 10970000, "m^-1"), id: "R" };
fixtures.push({ name: "main/rydberg-ascii-rounded", accepts: true, baseline: "pending",
  plan: plan("For hydrogen use R_H = 10970000 m^-1 and a transition from ni = 3 to nf = 2. Find lambda in nm.",
    [rydberg, given("ni", 3, ""), given("nf", 2, "")], "lambda", 656.3, "nm",
    "1/lambda = R(1/2^2 - 1/3^2) = 1.097e7*(5/36) = 1.5236e6 m^-1; lambda = 6.563e-7 m = 656.3 nm") });
pin("main/rydberg-ascii-rounded", { raw: true, valid: true, value: 656.3354603463993,
  source: "1/lambda = R(1/2^2 - 1/3^2) = 1.097e7*(5/36) = 1.5236e6 m^-1; lambda = 6.56335460346e-7 m = 656.335460346 nm", live: 656.3354603463993 });
const circuit = [given("V", 12, "V"), given("R_eq", 12 / 11, "Ω")];
const currentQuestion = "A 12 V source is connected to an equivalent resistance of 12/11 Ω. Find the current I.";
for (const symbol of ["I", "X"]) {
  pair(`grouped-denominator/${symbol}`, plan(currentQuestion, circuit, symbol, 11, "A", "I = 12 V/(12/11 Ω) = 11 A"), 132);
}
// Grammar-edge controls are observations of main, not new supported readings.
const groupedEdges = [
  { name: "mismatched-voltage", voltage: 12, resistance: 12 / 11, resistanceUnit: "Ω", value: 55 / 6, unit: "A", source: "I = 10 V/(12/11 Ω) = 9.166666666666666 A" },
  { name: "zero-voltage", voltage: 0, resistance: 12 / 11, resistanceUnit: "Ω", value: 0, unit: "A", source: "I = 0 V/(12/11 Ω) = 0 A" },
  { name: "negative-resistance", voltage: 12, resistance: -12 / 11, resistanceUnit: "Ω", value: -11, unit: "A", source: "I = 12 V/(-12/11 Ω) = -11 A" },
  { name: "zero-resistance", voltage: 12, resistance: 0, resistanceUnit: "Ω", value: 0, unit: "A", source: "I = 12 V/(0 Ω) = 0 A" },
  { name: "division-by-zero-in-fraction", voltage: 12, resistance: 1, resistanceUnit: "Ω", value: 0, unit: "A", source: "I = 12 V/(12/0 Ω) = 0 A" },
  { name: "prefixed-denominator", voltage: 12, resistance: 4, resistanceUnit: "kΩ", value: 3, unit: "mA", source: "I = 12 V/(4 kΩ) = 3 mA" },
];
for (const edge of groupedEdges) fixtures.push({ name: `main/grouped-boundary/${edge.name}`, accepts: true, baseline: "pending",
  plan: plan(`Given V = ${edge.voltage} V and R = ${edge.resistance} ${edge.resistanceUnit}, find I.`,
    [given("V", edge.voltage, "V"), given("R", edge.resistance, edge.resistanceUnit)], "I", edge.value, edge.unit, edge.source) });
pair("grouped-denominator/negative-voltage", plan("Given V = -12 V and R = 12/11 Ω, find I.",
  [given("V", -12, "V"), given("R", 12 / 11, "Ω")], "I", -11, "A", "I = -12 V/(12/11 Ω) = -11 A"), 132);
// Source-main observations; native main's public package exports must agree.
const edgeBaselines: Array<[string, boolean, number, string]> = [
  ["mismatched-voltage", false, 110.00000000000001, "I = 10 V/(12/11 Ω) = 110 A"],
  ["zero-voltage", true, 0, "I = 0 V/(12/11 Ω) = 0 A"],
  ["negative-resistance", false, -132, "I = 12 V/(-12/11 Ω) = -132 A"],
  ["zero-resistance", true, 0, "I = 12 V/(0 Ω) = 0 A"],
  ["division-by-zero-in-fraction", true, 0, "I = 12 V/(12/0 Ω) = 0 A"],
  ["prefixed-denominator", false, 36, "I = 12 V/(4 kΩ) = 36 mA"],
];
for (const [name, raw, value, source] of edgeBaselines) pin(`main/grouped-boundary/${name}`, { raw, valid: true, value, source, live: value });

// Every explicitly listed Problem 1 wording. These right values and source
// strings were accepted unchanged on main a0a029cb; no new question grammar.
const irQuestions = [
  "A 12 Ω resistor carries a current of 3 A. What is the voltage across it?",
  "A current of 3 A flows through a 12 Ω resistor. Find the potential difference across it.",
  "Given I = 3 A, R = 12 Ω. What is V?",
  "Find V when I = 3 A and R = 12 Ω.",
  "If I = 3 A and R = 12 Ω, find V.",
  "Given I = 3 A, R = 12 Ω. Find the voltage across the resistor.",
];
for (const [index, question] of irQuestions.entries()) {
  pair(`main/problem-1/IR-${index}`, plan(question, [given("I", 3, "A"), given("R", 12, "Ω")],
    "V", 36, "V", "V = I R = 3 × 12 = 36 V"), 37, false);
}
const reviewControls = [
  plan("A current of 2 A flows through a 10 Ω resistor. Find the power dissipated.", [given("I", 2, "A"), given("R", 10, "Ω")], "P", 40, "W", "P = I^2 R = 2^2 × 10 = 40 W"),
  plan("Given I = 2 A, R = 10 Ω. Find the power dissipated.", [given("I", 2, "A"), given("R", 10, "Ω")], "P", 40, "W", "P = I^2 R = 2^2 × 10 = 40 W"),
  plan("An electric iron of resistance 20 Ω takes a current of 5 A. Calculate the heat developed in 30 s.", [given("I", 5, "A"), given("R", 20, "Ω"), given("t", 30, "s")], "H", 15000, "J", "H = I^2 R t = 5^2 × 20 × 30 = 15000 J"),
  plan("A 4 kΩ resistor carries 3 mA. Find V.", [given("I", 3, "mA"), given("R", 4, "kΩ")], "V", 12, "V", "V = IR = 3 mA × 4 kΩ = 12 V"),
  plan("A battery of emf 12 V and internal resistance 1 Ω delivers 2 A. Find the terminal voltage.", [given("E", 12, "V"), given("r", 1, "Ω"), given("I", 2, "A")], "V", 10, "V", "V = E - I r = 12 - 2 × 1 = 10 V"),
];
for (const [index, input] of reviewControls.entries()) pair(`main/problem-1/other-${index}`, input, input.derived[0]!.value * 2, false);

// Problem 2a: a bound quantity after a spaced coefficient is not a unit.
const heightQuestion = "A ball is thrown straight up at 14 m/s. Find the maximum height (g = 9.8 m/s²).";
const heightGivens = [given("u", 14, "m/s"), given("g", 9.8, "m/s^2")];
const capacitor = [given("C", 2, "μF"), given("Q", 0.0002, "C"), given("V", 100, "V")];
const energyQuestion = "Given C = 2 μF, Q = 0.0002 C and V = 100 V, find the stored energy U.";
const coefficients = [
  plan(heightQuestion, heightGivens, "h", 10, "m", "h = u^2/(2 g) = 14^2/(2 × 9.8) = 10 m"),
  plan(heightQuestion, heightGivens, "h", 10, "m", "h = u^2/(2 g) = 10 m"),
  plan(energyQuestion, capacitor, "U", 0.01, "J", "U = Q^2/(2 C) = (2e-4)^2/(2 × 2e-6) = 0.01 J"),
  plan("Given m = 1000 kg, u = 20 m/s and F = 5000 N, find stopping distance s.", [given("m", 1000, "kg"), given("u", 20, "m/s"), given("F", 5000, "N")], "s", 40, "m", "s = m u^2/(2 F) = 1000 × 400/10000 = 40 m"),
  plan("Given L = 0.5 m and v = 100 m/s, find f.", [given("L", 0.5, "m"), given("v", 100, "m/s")], "f", 100, "Hz", "f = v/(2 L) = 100/(2 × 0.5) = 100 Hz"),
  plan("Given T = 20 N and θ = 30°, find W.", [given("T", 20, "N"), given("θ", 30, "degree")], "W", 34.64, "N", "W = 2 T cos θ = 2 × 20 × cos(30°) = 34.64 N"),
];
for (const [index, input] of coefficients.entries()) pair(`main/problem-2a/${index}`, input, input.derived[0]!.value * 2, false);
pin("main/problem-2a/2/wrong", { raw: false, valid: false, value: 0.02,
  source: "U = Q^2/(2 C) = (2e-4)^2/(2 × 2e-6) = 0.02 J", live: null });
const cosineSource = "W = 2 T cos θ = 2 × 20 × cos(30°) = 34.6410161514 N";
pin("main/problem-2a/5/right", { raw: true, valid: true, value: 34.64101615137755, source: cosineSource, live: 34.64101615137755 });
pin("main/problem-2a/5/wrong", { raw: false, valid: true, value: 34.64101615137755, source: cosineSource, live: 34.64101615137755 });
fixtures.push({ name: "main/problem-2a/wrong-energy-2e-8", accepts: false,
  plan: plan(energyQuestion, capacitor, "U", 2e-8, "J", "U = Q^2/(2 C) = 2e-8 J") });

// Problem 2b: preserve main's interpretation of these prefixed result forms.
const fractions = [
  plan("Given V = 12 V and R = 4 kΩ, find I.", [given("V", 12, "V"), given("R", 4, "kΩ")], "I", 3, "mA", "I = 12/4 kΩ = 3 mA"),
  plan("Given V = 5 V and R = 2.5 kΩ, find I.", [given("V", 5, "V"), given("R", 2.5, "kΩ")], "I", 2, "mA", "I = 5/2.5 kΩ = 2 mA"),
  plan("Given V = 12 V and I = 3 mA, find R.", [given("V", 12, "V"), given("I", 3, "mA")], "R", 4, "kΩ", "R = 12/3 mA = 4 kΩ"),
  plan("Given d = 100 km and t = 2 h, find v.", [given("d", 100, "km"), given("t", 2, "h")], "v", 50, "km/h", "v = 100/2 h = 50 km/h"),
];
for (const [index, input] of fractions.entries()) pair(`main/problem-2b/${index}`, input, input.derived[0]!.value * 2, false);

// #169 voltage/unit boundary: both named and anonymous targets, literal V
// labels beside a bound voltage, and genuine multiplication by voltage.
const seriesQuestion = "Given V = 12 V, R1 = 2 Ω and R2 = 4 Ω in series, find I.";
const series = [given("V", 12, "V"), given("R1", 2, "Ω"), given("R2", 4, "Ω")];
for (const symbol of ["I", "X"]) {
  fixtures.push({ name: `main/169/volt-label/${symbol}`, accepts: true,
    plan: plan(seriesQuestion, series, symbol, 2, "A", "I = V/(R1 + R2) = 12 V / 6 Ω = 2 A") });
  fixtures.push({ name: `main/169/voltage-product/${symbol}`, accepts: true,
    plan: plan(seriesQuestion, series, symbol, 4, "A", "I = 2*V/(R1 + R2) = 4 A") });
  fixtures.push({ name: `main/169/voltage-square/${symbol}`, accepts: true,
    plan: plan("Given V = 12 V and R = 6 Ω, find P.", [given("V", 12, "V"), given("R", 6, "Ω")], symbol, 24, "W", "P = V^2/R = (12 V)^2 / 6 Ω = 24 W") });
}

// An unpowered prefixed force must not lose its scale just because another
// derived row made the whole plan eligible for the unit-power fallback.
for (const scaledForce of [
  { name: "unpowered-kilonewton-pressure", question: "A force F = 600 kN acts over area A = 300 m². Also find pressure P in Pa.",
    givens: [given("F", 600, "kN"), given("A", 300, "m²")], symbol: "P", unit: "Pa",
    source: (value: number) => `P = 600 kN / 300 m² = ${value} Pa` },
  { name: "nonisolated-kilonewton-force", question: "A force F = 4 kN satisfies 2*G = F. Also find G in N.",
    givens: [given("F", 4, "kN")], symbol: "G", unit: "N",
    source: (value: number) => `2*G = 4 kN; G = ${value} N` },
]) {
  for (const [verdict, value] of [["right", 2000], ["wrong", 2]] as const) {
    const input = plan(`${parallel} ${scaledForce.question}`, [...resistors, ...scaledForce.givens], "R_eq", 12 / 11, "Ω",
      `1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 Ω⁻¹; R_eq = ${12 / 11} Ω`);
    input.unknowns[0]!.id = "R_eq";
    input.derived[0]!.id = "R_eq";
    input.unknowns.push({ id: "scaled_force_result", symbol: scaledForce.symbol, unit: scaledForce.unit });
    input.derived.push({ id: "scaled_force_result", symbol: scaledForce.symbol, value, unit: scaledForce.unit,
      provenance: "derived", sourceText: scaledForce.source(value), dependsOn: scaledForce.givens.map((entry) => entry.id) });
    fixtures.push({ name: `fallback-composite/${scaledForce.name}/${verdict}`, plan: input,
      accepts: verdict === "right", allowDecline: verdict === "right", requiresLegacyRejection: true });
  }
}

// Symbolic bindings must not prove one unit scale while a newly read sibling
// uses another. The complete legacy-rejected plan still needs coherent proof.
for (const [verdict, value] of [["right", 2000], ["wrong", 2]] as const) {
  const input = plan(`${parallel} A force F = 600 kN acts over area A = 300 m². Also find pressure P in Pa.`,
    [...resistors, given("F", 600, "kN"), given("A", 300, "m²")], "R_eq", 12 / 11, "Ω",
    `1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 Ω⁻¹; R_eq = ${12 / 11} Ω`);
  input.unknowns[0]!.id = "R_eq";
  input.derived[0]!.id = "R_eq";
  input.unknowns.push({ id: "pressure_result", symbol: "P", unit: "Pa" });
  input.derived.push({ id: "pressure_result", symbol: "P", value, unit: "Pa", provenance: "derived",
    sourceText: `P = F/A = ${value} Pa`, dependsOn: ["F", "A"] });
  fixtures.push({ name: `fallback-composite/symbolic-kilonewton-pressure/${verdict}`, plan: input,
    accepts: verdict === "right", allowDecline: verdict === "right", requiresLegacyRejection: true });
}
// A proved resistance cannot admit an extra unsupported quantity. This is a
// proof-completeness control; no oracle claims that the arbitrary 999 is right.
// Legacy strips long alphabetic labels case-insensitively; the fallback's
// refusal must cover the same spelling, without interpreting KN as a new unit.
for (const suffix of ["right", "wrong"]) {
  const original = fixtures.find((fixture) => fixture.name === `fallback-composite/unpowered-kilonewton-pressure/${suffix}`)!;
  const variant = structuredClone(original);
  variant.name = `fallback-composite/unpowered-kilonewton-case/${suffix}`;
  variant.plan.derived[1]!.sourceText = variant.plan.derived[1]!.sourceText!.replace("kN", "KN");
  fixtures.push(variant);
}
const unprovedExtra = plan(parallel, resistors, "R_eq", 12 / 11, "Ω",
  `1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 Ω⁻¹; R_eq = ${12 / 11} Ω`);
unprovedExtra.unknowns[0]!.id = "R_eq";
unprovedExtra.derived[0]!.id = "R_eq";
unprovedExtra.unknowns.push({ id: "unproved_extra", symbol: "z", unit: "m" });
unprovedExtra.derived.push({ id: "unproved_extra", symbol: "z", value: 999, unit: "m",
  provenance: "derived", dependsOn: [] });
fixtures.push({ name: "fallback-composite/unproved-extra-quantity", plan: unprovedExtra,
  accepts: false, requiresLegacyRejection: true });
const assertedExtra = structuredClone(unprovedExtra);
assertedExtra.derived[1]!.sourceText = "z = 999 m";
fixtures.push({ name: "fallback-composite/asserted-not-computed-extra", plan: assertedExtra,
  accepts: false, requiresLegacyRejection: true });

// The three review wrong-rounding controls also need a legacy-rejected whole
// plan: standalone legacy repair must not mask an unsafe fallback tolerance.
for (const rounding of [
  { name: "moment-of-inertia", question: "A point mass M = 2 kg is at radius r = 0.5 m. Also find moment of inertia I.",
    givens: [given("M", 2, "kg"), given("r", 0.5, "m")], symbol: "I", unit: "kg m²", correct: 0.5, wrong: 1,
    source: (value: number) => `I = M r² = 2 kg × (0.5 m)² = ${value} kg m²` },
  { name: "wave-number", question: "A wave has wavelength λ = 0.5 m. Also find its wave number k.",
    givens: [given("λ", 0.5, "m")], symbol: "k", unit: "m⁻¹", correct: 12.566, wrong: 1.2566,
    source: (value: number) => `k = 2π/λ = 2 × 3.1416 / 0.5 = ${value} m⁻¹` },
  { name: "intensity", question: "A source supplies P = 100 W over area A = 4 m². Also find intensity I.",
    givens: [given("P", 100, "W"), given("A", 4, "m²")], symbol: "I", unit: "W m⁻²", correct: 25, wrong: 50,
    source: (value: number) => `I = P/A = 100 W / 4 m² = ${value} W m⁻²` },
]) {
  for (const [verdict, value] of [["right", rounding.correct], ["wrong", rounding.wrong]] as const) {
    const input = plan(`${parallel} ${rounding.question}`, [...resistors, ...rounding.givens], "R_eq", 12 / 11, "Ω",
      `1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 Ω⁻¹; R_eq = ${12 / 11} Ω`);
    input.unknowns[0]!.id = "R_eq";
    input.derived[0]!.id = "R_eq";
    input.unknowns.push({ id: "rounding_result", symbol: rounding.symbol, unit: rounding.unit });
    input.derived.push({ id: "rounding_result", symbol: rounding.symbol, value, unit: rounding.unit,
      provenance: "derived", sourceText: rounding.source(value), dependsOn: rounding.givens.map((entry) => entry.id) });
    fixtures.push({ name: `fallback-composite/rounding-${rounding.name}/${verdict}`, plan: input,
      accepts: verdict === "right", allowDecline: verdict === "right", requiresLegacyRejection: true });
  }
}

async function sourceAPI(): Promise<SceneAPI> {
  const entry = resolve(sourceRoot, "packages/scene-engine/src/index.ts");
  const { outputFiles } = await build({
    stdin: { contents: `
      import * as scene from ${JSON.stringify(entry)};
      export const validateTurnPlanV3 = scene.validateTurnPlanV3;
      export const reconcileTurnPlanV3ExplicitArithmetic = scene.reconcileTurnPlanV3ExplicitArithmetic;
      const atomicAdmission = Reflect.get(scene, "admitTurnPlanV3");
      export function admitTurnPlanV3(input, question) {
        if (typeof atomicAdmission === "function") return atomicAdmission(input, question);
        // An old --source-root remains measurable and goes RED on new support.
        const arithmetic = reconcileTurnPlanV3ExplicitArithmetic(input);
        return { arithmetic, validation: validateTurnPlanV3(arithmetic.plan, question) };
      }
    `, resolveDir: sourceRoot, loader: "ts" },
    bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
    alias: { "@heytutor/drawing": resolve(sourceRoot, "packages/drawing/src/index.ts") },
    tsconfigRaw: { compilerOptions: {} }, logLevel: "silent",
  });
  const compiled = new Module(entry);
  compiled.filename = entry;
  compiled.require = createRequire(entry);
  (compiled as Module & { _compile: (source: string, filename: string) => void })._compile(outputFiles[0]!.text, entry);
  return compiled.exports as SceneAPI;
}

function nativeLiveObservations(): LiveObservation[] {
  const packages = Object.fromEntries(["drawing", "scene-engine", "tutor-core"].map((name) =>
    [`@heytutor/${name}`, pathToFileURL(resolve(ownRoot, `packages/${name}/dist/index.js`)).href]));
  // No inherited tsx loader or tsconfig paths: this one batched process loads
  // the real built packages, including transitive public package imports.
  const source = `
    import { readFileSync } from "node:fs";
    import { registerHooks } from "node:module";
    console.log = (...args) => console.error(...args);
    const packages = ${JSON.stringify(packages)};
    registerHooks({ resolve(specifier, context, nextResolve) {
      return packages[specifier] ? { url: packages[specifier], shortCircuit: true } : nextResolve(specifier, context);
    } });
    const { parseTurnPlanV3Content } = await import(packages["@heytutor/tutor-core"]);
    const { validateTurnPlanV3, reconcileTurnPlanV3ExplicitArithmetic } = await import(packages["@heytutor/scene-engine"]);
    const plans = JSON.parse(readFileSync(0, "utf8"));
    const results = plans.map((plan) => {
      const trace = {};
      const live = parseTurnPlanV3Content(JSON.stringify(plan), plan.question, trace);
      // Same built legacy exports, on the parser's actual normalized input.
      // This checks the selected trace without claiming a historical parser
      // oracle; independent frozen-main live goldens remain a separate replay.
      const normalized = trace.normalized ?? plan;
      const raw = validateTurnPlanV3(normalized, plan.question);
      const arithmetic = reconcileTurnPlanV3ExplicitArithmetic(normalized);
      const validation = validateTurnPlanV3(arithmetic.plan, plan.question);
      return { live, trace, legacy: { raw, arithmetic, validation } };
    });
    process.stdout.write(JSON.stringify(results));
  `;
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    input: JSON.stringify(fixtures.map((fixture) => fixture.plan)), encoding: "utf8", env: environment, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new Error(`Native built parser failed: ${result.error?.message ?? result.stderr}`);
  const observations = JSON.parse(result.stdout) as LiveObservation[];
  if (observations.length !== fixtures.length) throw new Error("Native parser returned an incomplete fixture batch");
  return observations;
}

async function verify(): Promise<void> {
  const api = await sourceAPI();
  const built = liveEnabled ? nativeLiveObservations() : undefined;
  let legacyAccepted = 0;
  let newlyAccepted = 0;
  let knownWrongLegacy = 0;
  for (const [index, fixture] of fixtures.entries()) {
    const { name, plan: input } = fixture;
    const before = JSON.stringify(input);
    const raw = api.validateTurnPlanV3(input, input.question);
    const legacyArithmetic = api.reconcileTurnPlanV3ExplicitArithmetic(input);
    const legacyPlan = legacyArithmetic.plan as TurnPlanV3;
    const legacyValidation = api.validateTurnPlanV3(legacyPlan, input.question);
    const { arithmetic, validation } = api.admitTurnPlanV3(input, input.question);
    const reconciled = arithmetic.plan as TurnPlanV3;
    const trace = built?.[index]?.trace ?? {};
    const live = built?.[index]?.live;
    const observation = { raw: raw.valid, valid: legacyValidation.valid, value: legacyPlan.derived[0]!.value,
      source: legacyPlan.derived[0]!.sourceText!, live: live?.derived[0]?.value ?? null };
    const detail = { legacy: observation, selectedValid: validation.valid,
      selectedDerived: reconciled.derived, rawIssues: raw.issues.map((issue) => issue.code), changes: arithmetic.reconciliations,
      liveIssues: trace.issues?.map((issue) => issue.code) };
    check(`${name}: calls preserve input`, JSON.stringify(input) === before);
    check(`${name}: givens remain source-bound`, equal(reconciled.givens, input.givens) && (!live || equal(live.givens, input.givens)), detail);
    if (fixture.requiresLegacyRejection) {
      check(`${name}: tripwire genuinely enters the legacy-rejected fallback`, !legacyValidation.valid, detail);
    }
    if (fixture.truth) {
      const truthful = (result: TurnPlanV3) => close(result.derived[0]?.value, fixture.truth!.value) && result.derived[0]?.sourceText === fixture.truth!.source;
      check(`${name}: legacy raw validation rejects the wrong scalar`, !raw.valid, detail);
      check(`${name}: legacy reconciliation rejects or retains the pinned truth`, !legacyValidation.valid || truthful(legacyPlan), detail);
      check(`${name}: selected admission rejects or retains the known truth`, !validation.valid || truthful(reconciled), detail);
      if (built) check(`${name}: native admission rejects or retains the known truth`, live === null || (live !== undefined && truthful(live)), detail);
    }
    if (fixture.baseline) {
      if (reportBaseline) console.log(`BASELINE ${name} ${JSON.stringify(observation)}`);
      if (fixture.baseline === "pending") {
        check(`${name}: main baseline must be pinned before claiming coverage`, false, detail);
      } else {
        check(`${name}: legacy validation and reconciliation stay pinned`, equal({ ...observation, live: null }, { ...fixture.baseline, live: null }), detail);
        if (built) {
          check(`${name}: built live baseline stays pinned`, observation.live === fixture.baseline.live && (!live || live.derived[0]?.sourceText === fixture.baseline.source), detail);
          const parsedResult = (trace.arithmetic?.plan as TurnPlanV3 | undefined)?.derived[0];
          check(`${name}: built reconciliation stays pinned even on rejection`, parsedResult?.value === fixture.baseline.value && parsedResult.sourceText === fixture.baseline.source, detail);
        }
      }
    }
    if (fixture.knownWrongLegacy) {
      knownWrongLegacy++;
      check(`${name}: known wrong legacy output remains explicitly pinned, not claimed fixed`, legacyValidation.valid
        && close(legacyPlan.derived[0]?.value, fixture.knownWrongLegacy.value)
        && legacyPlan.derived[0]?.sourceText === fixture.knownWrongLegacy.source, detail);
    }
    const permitsAdmission = (valid: boolean): boolean => valid === fixture.accepts
      || (fixture.accepts && fixture.allowDecline === true && !valid);
    if (legacyValidation.valid) {
      legacyAccepted++;
      // The unchanged old exports are the compatibility seam. Independent
      // frozen-main replay still establishes that these exports match main.
      check(`${name}: selected arithmetic is byte identical to accepted legacy`, equal(arithmetic, legacyArithmetic), detail);
      check(`${name}: selected validation is byte identical to accepted legacy`, equal(validation, legacyValidation), detail);
    } else {
      check(`${name}: fallback admission follows the authored acceptance boundary`, permitsAdmission(validation.valid), detail);
      if (validation.valid) {
        newlyAccepted++;
        check(`${name}: a newly accepted whole plan remains exactly as written`, equal(arithmetic.plan, input)
          && equal(validation.plan, input) && arithmetic.reconciliations.length === 0, detail);
      }
    }
    if (built) {
      const nativeLegacy = built[index]!.legacy;
      check(`${name}: built parser records atomic admission`, live !== undefined && Boolean(trace.arithmetic) && !trace.parseError, detail);
      if (fixture.requiresLegacyRejection) {
        check(`${name}: native tripwire genuinely enters the legacy-rejected fallback`, !nativeLegacy.validation.valid, detail);
      }
      if (nativeLegacy.validation.valid) {
        check(`${name}: native accepted-legacy arithmetic is byte identical`, equal(trace.arithmetic, nativeLegacy.arithmetic), detail);
        check(`${name}: native accepted-legacy validation plan stays identical before optics`, equal(trace.preOptics, nativeLegacy.validation.plan), detail);
        check(`${name}: native retains legacy admission unless the unchanged optics audit rejects`, live !== null
          || Boolean(trace.optics?.inconsistencies.length), detail);
      } else {
        check(`${name}: native fallback follows the authored acceptance boundary`, live !== undefined && permitsAdmission(live !== null), detail);
        if (live) {
          check(`${name}: native newly accepted whole admission plan stays unchanged`, Boolean(trace.arithmetic)
            && equal(trace.arithmetic!.plan, trace.normalized)
            && equal(trace.preOptics, trace.normalized)
            && trace.arithmetic!.reconciliations.length === 0, detail);
          check(`${name}: native newly accepted values and sources match every original derived row`, equal(live.derived, input.derived), detail);
        }
      }
    }
  }
  if (failures.length) {
    console.error(`unit-power admission RED: ${failures.length}/${checks} checks failed across ${fixtures.length} authored plans`);
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else console.log(`unit-power admission GREEN: ${checks} checks across ${fixtures.length} authored plans; ${legacyAccepted} legacy acceptances preserved, ${newlyAccepted} newly accepted unchanged, ${knownWrongLegacy} known wrong legacy outputs preserved (not fixes) (source public API${built ? ", native built live parser" : "; add --live for native built parser"})`);
}
void verify().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
