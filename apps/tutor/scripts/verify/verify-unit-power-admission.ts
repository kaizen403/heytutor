/**
 * Authored controls for the small unit-power/grouped-denominator repair.
 * Source seam: public scene-engine exports bundled in memory. Optional --live:
 * the built tutor-core parser, so build drawing/scene-engine/tutor-core first.
 * pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-unit-power-admission.ts --live
 * --source-root=/absolute/tree supports an old tree without modifying either tree.
 * --report-baseline prints public-boundary observations for the review companions.
 * No historical questions/plans, model, network, database, rendering, or saves.
 */
// @ts-expect-error esbuild ships with the tsx test runner, not the app package.
import { build } from "esbuild";
import { createRequire, Module } from "node:module";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TurnPlanQuantityV3, TurnPlanV3 } from "@heytutor/scene-engine";
import type { TurnPlanV3ParseTrace } from "@heytutor/tutor-core";

type SceneAPI = Pick<typeof import("@heytutor/scene-engine"), "validateTurnPlanV3" | "reconcileTurnPlanV3ExplicitArithmetic">;
type LiveObservation = { live: TurnPlanV3 | null; trace: TurnPlanV3ParseTrace };
type Baseline = { raw: boolean; valid: boolean; value: number; source: string; live: number | null };
type Fixture = { name: string; plan: TurnPlanV3; accepts: boolean; baseline?: Baseline | "pending"; truth?: { value: number; source: string } };
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
  result.sourceText = result.sourceText!.replace(/(=\s*)[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?=\s|$)(?=[^=;]*$)/i,
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
for (const unit of ["Ω⁻¹", "Ω^-1", "Ω^(-1)", "1/Ω"]) {
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

async function sourceAPI(): Promise<SceneAPI> {
  const entry = resolve(sourceRoot, "packages/scene-engine/src/index.ts");
  const { outputFiles } = await build({
    stdin: { contents: `export { validateTurnPlanV3, reconcileTurnPlanV3ExplicitArithmetic } from ${JSON.stringify(entry)};`, resolveDir: sourceRoot, loader: "ts" },
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
    const plans = JSON.parse(readFileSync(0, "utf8"));
    const results = plans.map((plan) => {
      const trace = {};
      const live = parseTurnPlanV3Content(JSON.stringify(plan), plan.question, trace);
      return { live, trace };
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
  for (const [index, fixture] of fixtures.entries()) {
    const { name, plan: input } = fixture;
    const before = JSON.stringify(input);
    const raw = api.validateTurnPlanV3(input, input.question);
    const arithmetic = api.reconcileTurnPlanV3ExplicitArithmetic(input);
    const reconciled = arithmetic.plan as TurnPlanV3;
    const validation = api.validateTurnPlanV3(reconciled, input.question);
    const trace = built?.[index]?.trace ?? {};
    const live = built?.[index]?.live;
    const observation = { raw: raw.valid, valid: validation.valid, value: reconciled.derived[0]!.value,
      source: reconciled.derived[0]!.sourceText!, live: live?.derived[0]?.value ?? null };
    const detail = { ...observation, rawIssues: raw.issues.map((issue) => issue.code), changes: arithmetic.reconciliations,
      liveIssues: trace.issues?.map((issue) => issue.code) };
    check(`${name}: calls preserve input`, JSON.stringify(input) === before);
    check(`${name}: givens remain source-bound`, equal(reconciled.givens, input.givens) && (!live || equal(live.givens, input.givens)), detail);
    if (fixture.truth) {
      const truthful = (result: TurnPlanV3) => close(result.derived[0]?.value, fixture.truth!.value) && result.derived[0]?.sourceText === fixture.truth!.source;
      check(`${name}: raw validation rejects the wrong scalar`, !raw.valid, detail);
      check(`${name}: reconciliation rejects or retains the known truth`, !validation.valid || truthful(reconciled), detail);
      if (built) check(`${name}: native admission rejects or retains the known truth`, live === null || (live !== undefined && truthful(live)), detail);
      continue;
    }
    if (fixture.baseline) {
      if (reportBaseline) console.log(`BASELINE ${name} ${JSON.stringify(observation)}`);
      if (fixture.baseline === "pending") {
        check(`${name}: main baseline must be pinned before claiming coverage`, false, detail);
      } else {
        check(`${name}: main validation and reconciliation stay pinned`, equal({ ...observation, live: null }, { ...fixture.baseline, live: null }), detail);
        if (built) {
          check(`${name}: built live baseline stays pinned`, observation.live === fixture.baseline.live && (!live || live.derived[0]?.sourceText === fixture.baseline.source), detail);
          const parsedResult = (trace.arithmetic?.plan as TurnPlanV3 | undefined)?.derived[0];
          check(`${name}: built reconciliation stays pinned even on rejection`, parsedResult?.value === fixture.baseline.value && parsedResult.sourceText === fixture.baseline.source, detail);
        }
      }
      continue;
    }
    check(`${name}: raw admission`, raw.valid === fixture.accepts, detail);
    check(`${name}: reconciliation does not change value or source`, equal(reconciled.derived, input.derived) && arithmetic.reconciliations.length === 0, detail);
    check(`${name}: reconciled admission`, validation.valid === fixture.accepts, detail);
    if (built) {
      check(`${name}: built live admission`, fixture.accepts ? live !== null && live !== undefined : live === null, detail);
      check(`${name}: built parser never rewrites value or source`, !live || equal(live.derived, input.derived), detail);
      check(`${name}: built reconciliation preserves value or source even on rejection`, !trace.arithmetic || equal((trace.arithmetic.plan as TurnPlanV3).derived, input.derived), detail);
    }
    if (fixture.accepts) check(`${name}: accepted value remains exact`, close(reconciled.derived[0]?.value, input.derived[0]!.value), detail);
  }
  if (failures.length) {
    console.error(`unit-power admission RED: ${failures.length}/${checks} checks failed across ${fixtures.length} authored plans`);
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else console.log(`unit-power admission GREEN: ${checks} checks across ${fixtures.length} authored plans (source public API${built ? ", native built live parser" : "; add --live for native built parser"})`);
}
void verify().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
