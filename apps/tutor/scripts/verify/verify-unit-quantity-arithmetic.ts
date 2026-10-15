/**
 * Authored number/unit versus variable controls, no captured student content.
 * Source: pnpm --filter @heytutor/tutor exec tsx --tsconfig ../../packages/tutor-core/tsconfig.json scripts/verify/verify-unit-quantity-arithmetic.ts
 * Add --live after building scene-engine and tutor-core to check compiled admission.
 * No network, provider, database, scene rendering, or persistence.
 */
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  validateTurnPlanV3,
  type TurnPlanQuantityV3,
  type TurnPlanV3,
} from "../../../../packages/scene-engine/src/contracts/contractsV3";

async function main(): Promise<void> {
  const liveParse = process.argv.includes("--live")
    ? (await import("@heytutor/tutor-core")).parseTurnPlanV3Content
    : null;
  const failures: string[] = [];
  let checks = 0;
  let cases = 0;
  type Given = readonly [symbol: string, value: number, unit: string];

  function check(name: string, condition: boolean, detail?: unknown): void {
    checks++;
    if (!condition) failures.push(`${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
  function close(actual: unknown, expected: number): boolean {
    return typeof actual === "number" && Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
  }
  function plan(givens: readonly Given[], symbol: string, unit: string, value: number, sourceText: string): TurnPlanV3 {
    const quantities: TurnPlanQuantityV3[] = givens.map(([key, number, label]) => ({
      id: key, symbol: key, value: number, unit: label, sourceText: `${key} = ${number} ${label}`, provenance: "given",
    }));
    return {
      schemaVersion: "turn-plan/v3", question: `Given ${quantities.map((entry) => entry.sourceText).join(", ")}, find ${symbol} in ${unit}.`,
      givens: quantities, unknowns: [{ id: "answer", symbol, unit }],
      derived: [{ id: "answer", symbol, value, unit, sourceText, provenance: "derived", dependsOn: quantities.map((entry) => entry.id) }],
      qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "optional",
    };
  }
  function observe(name: string, input: TurnPlanV3) {
    cases++;
    const before = JSON.stringify(input);
    const raw = validateTurnPlanV3(input, input.question);
    const arithmetic = reconcileTurnPlanV3ExplicitArithmetic(input);
    const reconciled = arithmetic.plan as TurnPlanV3;
    const validation = validateTurnPlanV3(reconciled, input.question);
    const live = liveParse?.(JSON.stringify(input), input.question) ?? null;
    check(`${name}: preserves input`, JSON.stringify(input) === before);
    check(`${name}: preserves given values and source text`, JSON.stringify(reconciled.givens) === JSON.stringify(input.givens));
    if (liveParse) check(`${name}: live preserves givens`, live === null || JSON.stringify(live.givens) === JSON.stringify(input.givens));
    const detail = { raw: raw.issues.map((issue) => issue.code), reconciled: reconciled.derived[0]?.value,
      reconciledIssues: validation.issues.map((issue) => issue.code), live: live?.derived[0]?.value ?? null };
    return { raw, reconciled, validation, live, detail };
  }
  function right(name: string, input: TurnPlanV3, truth: number): void {
    const result = observe(name, input);
    check(`${name}: raw accepts truth`, result.raw.valid, result.detail);
    check(`${name}: reconciliation retains truth`, close(result.reconciled.derived[0]?.value, truth), result.detail);
    check(`${name}: reconciliation validates`, result.validation.valid, result.detail);
    check(`${name}: retains correct source`, result.reconciled.derived[0]?.sourceText === input.derived[0]?.sourceText, result.detail);
    if (liveParse) check(`${name}: live retains truth`, close(result.live?.derived[0]?.value, truth), result.detail);
  }
  function wrong(name: string, input: TurnPlanV3, truth: number): void {
    const result = observe(name, input);
    check(`${name}: raw rejects wrong arithmetic`, !result.raw.valid, result.detail);
    check(`${name}: reconciliation rejects or retains truth`, !result.validation.valid || close(result.reconciled.derived[0]?.value, truth), result.detail);
    const prefix = (source: string | undefined) => source?.slice(0, source.lastIndexOf("="));
    check(`${name}: reconciliation preserves written operands`, prefix(result.reconciled.derived[0]?.sourceText) === prefix(input.derived[0]?.sourceText), result.detail);
    if (liveParse) {
      check(`${name}: live rejects or retains truth`, result.live === null || close(result.live.derived[0]?.value, truth), result.detail);
      check(`${name}: live preserves written operands`, result.live === null || prefix(result.live.derived[0]?.sourceText) === prefix(input.derived[0]?.sourceText), result.detail);
      check(`${name}: admitted result validates`, result.live === null || validateTurnPlanV3(result.live, input.question).valid, result.detail);
    }
  }
  function pair(name: string, givens: readonly Given[], symbol: string, unit: string, stem: string, truth: number, error: number): TurnPlanV3 {
    const correct = plan(givens, symbol, unit, truth, `${stem} = ${truth} ${unit}`);
    right(`${name}/right`, correct, truth);
    wrong(`${name}/wrong`, plan(givens, symbol, unit, error, `${stem} = ${error} ${unit}`), truth);
    return correct;
  }
  function decline(name: string, input: TurnPlanV3): void {
    const result = observe(name, input);
    check(`${name}: raw rejects contradictory source`, !result.raw.valid, result.detail);
    check(`${name}: reconciliation preserves declined value and source`, JSON.stringify(result.reconciled.derived) === JSON.stringify(input.derived), result.detail);
    check(`${name}: declined plan stays rejected`, !result.validation.valid, result.detail);
    if (liveParse) check(`${name}: live rejects declined source`, result.live === null, result.detail);
  }

  const circuit: readonly Given[] = [["V", 12, "V"], ["R", 6, "Ω"]];
  const core = [
    ["plain-current", circuit, "I", "A", "I = 12 V / 6 Ω", 2, 24],
    ["decimal-current", [["V", 1.5, "V"], ["R", 3, "Ω"]], "I", "A", "I = V/R = 1.5 V / 3 Ω", 0.5, 0.75],
    ["prefixed-current", [["V", 2, "kV"], ["R", 4, "kΩ"]], "I", "A", "I = V/R = 2 kV / 4 kΩ", 0.5, 5],
    ["voltage-target", [["I", 2, "A"], ["R", 6, "Ω"]], "V", "V", "V = I R = 2 A × 6 Ω", 12, 10],
    ["heater-power", [["V", 230, "V"], ["I", 2, "A"]], "P", "W", "P = V I = 230 V × 2 A", 460, 105800],
    ["milliamp-current", [["V", 12, "V"], ["R", 400, "Ω"]], "I", "mA", "I = V/R = 12 V / 400 Ω = 0.03 A", 30, 360],
    ["resistance", [["V", 12, "V"], ["I", 2, "A"]], "R", "Ω", "R = V/I = 12 V / 2 A", 6, 72],
    ["double-voltage", [["V", 12, "V"], ["R", 8, "Ω"]], "I", "A", "I = 2V/R = 24 V / 8 Ω", 3, 36],
    ["grouped-series", [["V", 12, "V"], ["R1", 2, "Ω"], ["R2", 4, "Ω"]], "I", "A", "I = V/(R1 + R2) = 12 V / (2 Ω + 4 Ω)", 2, 24],
    ["voltage-square", circuit, "P", "W", "P = V^2/R = (12 V)^2 / 6 Ω", 24, 3456],
  ] satisfies Array<[string, readonly Given[], string, string, string, number, number]>;
  for (const [name, givens, symbol, unit, stem, truth, error] of core) pair(`review-core/${name}`, givens, symbol, unit, stem, truth, error);
  wrong("review-core/plain-current/other-wrong", plan(circuit, "I", "A", 3, "I = 12 V / 6 Ω = 3 A"), 2);
  wrong("review-core/heater-power/other-wrong", plan([["V", 230, "V"], ["I", 2, "A"]], "P", "W", 46, "P = V I = 230 V × 2 A = 46 W"), 460);

  // Space-separated quantities remain literal measurements even if the given V differs.
  pair("boundary/separated-two-volts", [["V", 12, "V"], ["R", 4, "Ω"]], "I", "A", "I = 2 V/(4 Ω)", 0.5, 6);
  // Compact 2V is a genuine variable product; matching 12V is the supplied quantity.
  pair("boundary/compact-variable-product", [["V", 12, "V"], ["R", 4, "Ω"]], "I", "A", "I = 2V/(4 Ω)", 6, 0.5);
  pair("boundary/compact-matching-quantity", circuit, "I", "A", "I = 12V/6Ω", 2, 24);
  for (const product of ["2*V", "2 × V", "2(V)"]) pair(`boundary/explicit-product/${product}`, circuit, "I", "A", `I = ${product}/(6 Ω)`, 4, 2);
  // A pure compound-unit restatement is not independently checked arithmetic.
  // Keep its positive control; the negative pair has an explicit operation.
  right("boundary/typed-compound-force/measurement", plan([["m", 2, "kg"], ["a", 1, "m/s^2"]], "F", "N", 2, "F = 2 kg m/s^2 = 2 N"), 2);
  pair("boundary/typed-compound-force", [["m", 2, "kg"], ["a", 1, "m/s^2"]], "F", "N", "F = 1*(2 kg m/s^2)", 2, 4);
  pair("boundary/compact-coherent-given", [["V", 12000, "mV"], ["R", 6, "Ω"]], "I", "A", "I = 12V/6Ω", 2, 24);
  // Compact mg is a product of declared symbols; spaced mg is milligrams.
  const massGravity: readonly Given[] = [["m", 2, "kg"], ["g", 9.8, "m/s²"]];
  pair("boundary/prefix-shadow/compact-product", massGravity, "F", "N", "F = 0.5mg/1", 9.8, 0.0000005);
  pair("boundary/prefix-shadow/spaced-measurement", massGravity, "M", "kg", "M = 1*(0.5 mg)", 0.0000005, 9.8);
  pair("boundary/prefix-shadow/spaced-measurement-division", massGravity, "M", "kg", "M = 1*(0.5 mg)/1", 0.0000005, 9.8);

  // Genuine spaced coefficient products are formulas, even when every bound
  // variable also spells a physical unit or a case-insensitive unit alias.
  const symbolicProducts = [
    ["capacitor-energy", [["C", 4, "F"], ["V", 6, "V"]], "U", "U = 1/2 C V^2", 72, 0.5],
    ["energy-offset", [["m", 2, "kg"], ["V", 6, "m/s"], ["E0", 5, "J"]], "E", "E = 0.5 m V^2 + E0", 41, 5.5],
    ["potential-energy", [["m", 2, "kg"], ["g", 9.8, "m/s^2"], ["h", 3, "m"]], "PE", "PE = 0.5 m g h / 1", 29.4, 1.8],
    ["kinetic-energy", [["m", 2, "kg"], ["V", 6, "m/s"]], "KE", "KE = 0.5 m V^2 / 1", 36, 0.5],
  ] satisfies Array<[string, readonly Given[], string, string, number, number]>;
  for (const [name, givens, symbol, stem, truth, error] of symbolicProducts) pair(`review-blocker/symbolic-product/${name}`, givens, symbol, "J", stem, truth, error);
  for (const product of ["C*V²", "C × V²"]) pair(`review-blocker/coefficient-operators/${product}`, [["C", 4, "F"], ["V", 6, "V"]], "U", "J", `U = 1/2 ${product}`, 72, 0.5);
  pair("review-blocker/coefficient-operators/kinetic-energy", [["m", 2, "kg"], ["V", 6, "m/s"]], "E", "J", "E = 0.5 m*V²", 36, 0.5);
  pair("review-blocker/coefficient-operators/compact-kinetic-energy", [["m", 2, "kg"], ["V", 6, "m/s"]], "E", "J", "E = .5m*V²", 36, 0.5);
  pair("review-blocker/unit-named-products/work", [["N", 20, "N"], ["m", 5, "m"]], "W", "J", "W = 1/2 N m", 50, 0.5);
  pair("review-blocker/unit-named-products/power", [["V", 12, "V"], ["A", 2, "A"]], "P", "W", "P = 1/2 V A", 12, 0.5);

  // Explicit conversion factors already convert the given's declared number.
  right("review-blocker/explicit-conversion/speed", plan([["v0", 36, "km/h"], ["t", 2, "s"]], "D", "m", 20, "D = v0*1000/3600*(2 s) = 20 m"), 20);
  right("review-blocker/explicit-conversion/length", plan([["l", 200, "cm"], ["b", 3, "m"]], "L", "m", 5, "L = l/100 + 3 m = 5 m"), 5);
  wrong("review-blocker/explicit-conversion/length-wrong", plan([["l", 200, "cm"], ["b", 3, "m"]], "L", "m", 3.02, "L = l/100 + 3 m = 3.02 m"), 5);
  const scaleBar = plan([["m", 2, "kg"], ["g", 9.8, "m/s²"], ["h", 3, "m"]], "PE", "J", 58.8, "PE = m*g*h = 2 kg*9.8 m/s²*3 m = 58.8 J");
  scaleBar.question += " Draw a 1 m scale bar.";
  right("review-blocker/unrelated-scale-bar", scaleBar, 58.8);

  // Normalizing operands to metres must not turn 0.05 metres into 0.05 cm.
  pair("review-blocker/coherent-result/mixed-literal-units", [["a", 2, "cm"], ["b", 3, "m"]], "L", "m", "L = 2 cm + 3 m", 3.02, 5);
  const lengths: readonly Given[] = [["a", 2, "cm"], ["b", 3, "cm"]];
  pair("review-blocker/prefixed-output", lengths, "L", "cm", "L = 2 cm + 3 cm", 5, 0.05);
  pair("review-p1/binding-with-literal-unit", [["a", 2, "cm"]], "L", "cm", "L = a + 3 mm", 2.3, 5);
  pair("review-p1/binding-with-literal-unit/subtract", [["a", 2, "cm"]], "L", "cm", "L = a - 3 mm", 1.7, -1);
  pair("review-p1/binding-with-literal-unit/metres", [["a", 2, "cm"]], "L", "m", "L = a + 3 mm", 0.023, 0.05);
  pair("review-p1/binding-with-literal-unit/grams", [["a", 2, "kg"]], "M", "kg", "M = a + 3 g", 2.003, 5);
  pair("review-p1/binding-with-literal-unit/coherent-output", [["a", 2, "cm"]], "L", "m", "L = a + 3 m", 3.02, 5);
  wrong("review-p1/uncertified-multiple-conversion", plan([["l", 200, "cm"]], "L", "m", 3.04,
    "L = 2*l/100 + 3 m = 3.04 m"), 7);
  for (const member of ["a + 3 mm + 0", "1*a + 3 mm", "2*a + 3 mm", "a + 0.003 m"]) {
    const truth = member.startsWith("2*") ? 4.3 : 2.3;
    const error = member.startsWith("2*") ? 7 : member.includes("0.003") ? 2.003 : 5;
    pair(`review-p1/binding-with-literal-unit/neutral/${member}`, [["a", 2, "cm"]], "L", "cm", `L = ${member}`, truth, error);
  }
  pair("review-blocker/prefixed-output/mixed-binding", lengths, "L", "cm", "L = a + 3 cm", 5, 2.03);
  wrong("review-blocker/prefixed-output/mixed-binding-false-coherent-label", plan(lengths, "L", "cm", 0.05, "L = a + 3 cm = 0.05 cm"), 5);
  wrong("review-blocker/prefixed-output/correct-value-wrong-source", plan(lengths, "L", "cm", 5, "L = 2 cm + 3 cm = 0.05 cm"), 5);
  wrong("review-blocker/prefixed-output/correct-source-wrong-value", plan(lengths, "L", "cm", 0.05, "L = 2 cm + 3 cm = 5 cm"), 5);

  // #160 backs off when the supplied current conflicts with the question's
  // correction; another numeric reader must not authorize the stale product.
  for (const correction of ["4 A", "4e0 A", "4 × 10⁰ A", "4 amperes"]) {
    const stale = plan([["A", 0.8, "mm²"], ["I", 3, "A"], ["R", 12, "Ω"]], "V", "V", 36, "V = 3 A * R = 36 V");
    stale.question = `Given A = 0.8 mm², I = 3 A, R = 12 Ω. Correction: actual current is ${correction}. Find V.`;
    decline(`review-blocker/corrected-current/${correction}`, stale);
  }
  const crossedCurrent = plan([["A", 0.8, "mm²"], ["I", 3, "A"], ["R", 12, "Ω"]], "V", "V", 36, "V = 3 A × R = 36 V");
  crossedCurrent.question = "Given A = 0.8 mm², I = 3 A, R = 12 Ω. Actual current is 4 A. Find V.";
  decline("review-blocker/corrected-current/product-cross", crossedCurrent);

  // Ungrouped rational units cannot authorize a partial denominator reading.
  const lengthsForInverse: readonly Given[] = [["u", 24, "cm"], ["f", 8, "cm"]];
  for (const inverseUnit of ["cm⁻¹", "cm^-1", "cm^(-1)"]) for (const value of [12, 833.333]) {
    const inverse = plan(lengthsForInverse, "v", "cm", value, `1/v = 1/8 − 1/24 = 1/12 ${inverseUnit}`);
    inverse.question = "Given the lengths u = 24 cm and f = 8 cm, solve 1/v = 1/f - 1/u, then compute the dimensionless ratio -v/u.";
    inverse.unknowns[0]!.id = inverse.derived[0]!.id = "v";
    inverse.unknowns.push({ id: "ratio", symbol: "m" });
    inverse.derived.push({ id: "ratio", symbol: "m", value: -0.5, sourceText: "m = -v/u = -12/24 = -0.5", provenance: "derived", dependsOn: ["v", "u"] });
    decline(`review-blocker/rational-quantity/${inverseUnit}/${value}`, inverse);
  }
  pair("review-blocker/rational-quantity/grouped-denominators", lengthsForInverse, "v", "cm", "v = 1/(1/(8 cm)-1/(24 cm))", 12, 833.333);
  // Positive spaced fractions are whole quantities; only inverse labels back off.
  pair("review-blocker/rational-quantity/milliamp-fraction", [["x", 1, "mA"]], "I", "mA", "I = 1/2 mA", 0.5, 500);
  pair("review-blocker/rational-quantity/centimetre-fraction", [["x", 1, "cm"]], "L", "cm", "L = 1/2 cm", 0.5, 50);
  pair("review-blocker/rational-quantity/volt-fraction", [["V", 12, "V"]], "U", "V", "U = 1/2 V", 0.5, 6);
  const scalarPrefixes = [
    ["superscript-scientific", "1×10⁻³/2mA", 0.0005, 500],
    ["ascii-scientific", "1×10^-3/2mA", 0.0005, 500],
    ["grouped-power-scientific", "1×10^(-3)/2mA", 0.0005, 500],
    ["exponent-scientific", "1e-3/2mA", 0.0005, 500],
    ["grouped-scalar", "(2+3)/2mA", 2.5, 2500000],
    ["power-scalar", "2^3/4mA", 2, 1000.519995],
    ["root-scalar", "sqrt(4)/2mA", 1, 1000000],
  ] as const;
  for (const [name, scalar, truth, error] of scalarPrefixes) pair(`review-blocker/rational-quantity/${name}`, [["x", 1, "mA"]], "I", "mA", `I = ${scalar}`, truth, error);
  pair("review-blocker/signed-unit/addition", [["a", 2, "cm"], ["b", 3, "cm"]], "L", "cm", "L = 2cm+3cm", 5, 6);
  pair("review-blocker/signed-unit/subtraction", [["V", 12, "V"]], "U", "V", "U = 12 V-2 V", 10, -24);
  const poweredVoltage: readonly Given[] = [["V", 12, "V"], ["n", 2, ""], ["R", 6, "Ω"]];
  for (const expression of ["12V^n/R", "12V^(n)/R"]) pair(`review-blocker/powered-coefficient/${expression}`, poweredVoltage, "P", "W", `P = ${expression}`, 288, 24);
  pair("review-blocker/powered-coefficient/numeric-power", poweredVoltage, "P", "W", "P = 12V^2/R", 288, 2);
  pair("review-blocker/powered-coefficient/grouped-quantity", poweredVoltage, "P", "W", "P = (12V)^n/R", 24, 288);
  const partialInverse = plan(lengthsForInverse, "v", "cm", 12, "1/v = 1/(16/2cm)-1/(48/2cm)=1/12cm⁻¹");
  partialInverse.question = "Given the lengths u = 24 cm and f = 8 cm, solve 1/v = 1/f - 1/u, then compute the dimensionless ratio -v/u.";
  partialInverse.unknowns[0]!.id = partialInverse.derived[0]!.id = "v";
  partialInverse.unknowns.push({ id: "ratio", symbol: "m" });
  partialInverse.derived.push({ id: "ratio", symbol: "m", value: -0.5, sourceText: "m = -v/u = -12/24 = -0.5", provenance: "derived", dependsOn: ["v", "u"] });
  decline("review-blocker/rational-quantity/partial-inverse-prefix", partialInverse);
  for (const inverseUnit of ["cm⁻¹", "cm^-1", "cm^(-1)", "cm^(−1)"]) {
    for (const value of [12, 833.333]) {
      const grounded = structuredClone(partialInverse);
      grounded.derived[0]!.value = value;
      grounded.derived[0]!.sourceText = `1/v = 1/f − 1/u = 1/8 − 1/24 = 1/12${inverseUnit}`;
      const name = `review-blocker/rational-quantity/grounded/${inverseUnit}/${value}`;
      if (value === 12) right(name, grounded, 12); else wrong(name, grounded, 12);
      const reconciled = reconcileTurnPlanV3ExplicitArithmetic(grounded).plan as TurnPlanV3;
      check(`${name}: admitted ratio retains independently known truth`, !validateTurnPlanV3(reconciled, grounded.question).valid || close(reconciled.derived[1]?.value, -0.5));
    }
    pair(`review-blocker/inverse-unit-literal/${inverseUnit}`, [["x", 1, "cm^-1"]], "K", "cm^-1", `K = 1*(12 ${inverseUnit})`, 12, 0.0833);
  }
  const incidental = structuredClone(partialInverse);
  incidental.derived[0]!.sourceText = "1/v = 1/8 − 1/24 = 1/12cm⁻¹; f = 8 cm";
  decline("review-blocker/rational-quantity/incidental-binding", incidental);
  const untrusted = structuredClone(partialInverse);
  untrusted.question = "Given u = 24 cm and an unverified derived focal length f, solve 1/v = 1/f - 1/u and compute -v/u.";
  untrusted.givens = untrusted.givens.filter((entry) => entry.id !== "f");
  untrusted.derived[0]!.sourceText = "1/v = 1/f − 1/u = 1/8 − 1/24 = 1/12cm⁻¹";
  untrusted.derived.push({ id: "f", symbol: "f", value: 8, unit: "cm", sourceText: "8 cm", provenance: "derived", dependsOn: ["u"] });
  decline("review-blocker/rational-quantity/untrusted-binding", untrusted);

  // Unit labels collide with given aliases m, g, C and V. Symbolic laws must
  // retain authority when substituted operands contain an incorrect unit scale.
  const controls = [
    ["force-grams", [["m", 250, "g"], ["a", 4, "m/s^2"]], "F", "N", 1, 1000, "F = m*a = 0.25 kg × 4 m/s^2", "F = m*a = 250 kg × 4 m/s^2"],
    ["energy-centimetres", [["m", 2, "kg"], ["g", 9.8, "m/s^2"], ["h", 80, "cm"]], "PE", "J", 15.68, 1568, "PE = m*g*h = 2 kg × 9.8 m/s^2 × 0.8 m", "PE = m*g*h = 2 kg × 9.8 m/s^2 × 80 m"],
    ["capacitor-microfarads", [["C", 4, "μF"], ["V", 6, "V"]], "Q", "C", 0.000024, 24, "Q = C*V = 4e-6 F × 6 V", "Q = C*V = 4 F × 6 V"],
  ] satisfies Array<[string, readonly Given[], string, string, number, number, string, string]>;
  for (const [name, givens, symbol, unit, truth, error, correctStem, wrongStem] of controls) for (const target of [symbol, "X"]) {
    const correctSource = `${correctStem} = ${truth} ${unit}`;
    right(`unit-scale/${name}/${target}/right`, plan(givens, target, unit, truth, correctSource), truth);
    wrong(`unit-scale/${name}/${target}/wrong-substitution`, plan(givens, target, unit, error, `${wrongStem} = ${error} ${unit}`), truth);
    if (target === symbol) {
      wrong(`unit-scale/${name}/${target}/correct-source-wrong-value`, plan(givens, target, unit, error, correctSource), truth);
      wrong(`unit-scale/${name}/${target}/wrong-source-correct-value`, plan(givens, target, unit, truth, `${wrongStem} = ${error} ${unit}`), truth);
    }
  }
  // The review core also pins consistency separately from the stated conclusion.
  for (const [name, givens, symbol, unit, stem, truth, error] of core) {
    wrong(`consistency/${name}/correct-source-wrong-value`, plan(givens, symbol, unit, error, `${stem} = ${truth} ${unit}`), truth);
    wrong(`consistency/${name}/wrong-source-correct-value`, plan(givens, symbol, unit, truth, `${stem} = ${error} ${unit}`), truth);
  }
  for (const [name, givens, symbol, unit, stem, truth, error] of core) for (const value of [truth, error]) {
    const stale = plan(givens, symbol, unit, value, `${stem} = ${value} ${unit}`);
    stale.qualitativeClaims = [{ id: "stale", claim: `${symbol} = ${error} ${unit}`, expected: true, relatedQuantityIds: ["answer"] }];
    const result = observe(`stale-claim/${name}/${value}`, stale);
    check(`stale-claim/${name}/${value}: raw rejects stale arithmetic or claim`, !result.raw.valid, result.detail);
    check(`stale-claim/${name}/${value}: reconciled claim remains rejected`, !result.validation.valid, result.detail);
    check(`stale-claim/${name}/${value}: preserves claim`, JSON.stringify(result.reconciled.qualitativeClaims) === JSON.stringify(stale.qualitativeClaims));
    if (liveParse) check(`stale-claim/${name}/${value}: live rejects`, result.live === null, result.detail);
  }

  // The power belongs to the entire unit atom, not to its numeric measurement.
  for (const inverseSecond of ["s⁻¹", "s^-1", "s^(-1)"]) {
    pair(`production/powered-unit/whole-inverse-second/${inverseSecond}`, [["t", 2, "s"]], "f", "Hz", `f = 2*(6 ${inverseSecond})`, 12, 24);
  }
  for (const accelerationUnit of ["m s⁻²", "m s^-2", "m s^(-2)"]) {
    pair(`production/powered-unit/acceleration/${accelerationUnit}`, [["t", 2, "s"]], "a", "m/s^2", `a = 2*(3 ${accelerationUnit})`, 6, 18);
  }
  for (const energyUnit of ["kg m² s⁻²", "kg m^2 s^-2", "kg m^(2) s^(-2)"]) {
    pair(`production/powered-unit/compound-energy/${energyUnit}`, [["t", 2, "s"]], "E", "J", `E = 2*(3 ${energyUnit})`, 6, 18);
  }
  for (const inverseOhm of ["Ω⁻¹", "Ω^-1", "Ω^(-1)"]) {
    pair(`production/powered-unit/whole-inverse-ohm/${inverseOhm}`, [["R", 2, "Ω"]], "G", "Ω^-1", `G = 2*(3 ${inverseOhm})`, 6, 18);
  }

  // Parallel-circuit reciprocal evidence is independently exact: 1/2 + 1/4
  // + 1/6 = 11/12, hence R_eq = 12/11 Ω. Keep every written operand intact.
  const parallelResistors: readonly Given[] = [["R1", 2, "Ω"], ["R2", 4, "Ω"], ["R3", 6, "Ω"]];
  for (const inverseOhm of ["Ω⁻¹", "Ω^-1", "Ω^(-1)"]) {
    const reciprocal = `1/R_eq = 1/2 + 1/4 + 1/6 = 11/12 ${inverseOhm}`;
    right(`production/parallel/reciprocal/${inverseOhm}/right`, plan(parallelResistors, "R_eq", "Ω", 12 / 11, reciprocal), 12 / 11);
    wrong(`production/parallel/reciprocal/${inverseOhm}/wrong`, plan(parallelResistors, "R_eq", "Ω", 1 / 132, `1/R_eq = 1/2 + 1/4 + 1/6 = 132 ${inverseOhm}`), 12 / 11);
    right(`production/parallel/reciprocal-plus-result/${inverseOhm}/right`, plan(parallelResistors, "R_eq", "Ω", 12 / 11, `${reciprocal}; R_eq = 12/11 Ω`), 12 / 11);
    wrong(`production/parallel/reciprocal-plus-result/${inverseOhm}/wrong`, plan(parallelResistors, "R_eq", "Ω", 132, `${reciprocal}; R_eq = 132 Ω`), 12 / 11);
  }
  pair("production/parallel/grouped-current", [["V", 12, "V"], ["R_eq", 12 / 11, "Ω"]], "I_total", "A", "I_total = 12 V/(12/11 Ω)", 11, 132);
  pair("production/parallel/grouped-prefixed-current", [["V", 12, "V"], ["R_eq", 12 / 11, "kΩ"]], "I_total", "A", "I_total = 12 V/(12/11 kΩ)", 0.011, 11);
  for (const scalar of ["(12/11)", "((12/11))", "(6+6)/11", "sqrt(144)/11", "(sqrt(144)/11)"]) {
    pair(`production/parallel/grouped-scalar/${scalar}`, [["V", 12, "V"], ["R_eq", 12 / 11, "kΩ"]], "I_total", "A", `I_total = 12 V/(${scalar} kΩ)`, 0.011, 11);
  }
  // Unfurled fractional quantities cannot fall back to a raw-unit guess.
  // Independently grouping each measured scalar remains supported.
  for (const value of [0.0075, 0.75]) {
    decline(`rational-sum/unfolded/${value}`, plan([["a", 1, "cm"]], "L", "m", value, `L = 1/2 cm + 1/4 cm = ${value} m`));
  }
  for (const value of [0.0055, 5.5]) {
    decline(`rational-denominator/unfolded/${value}`, plan([["V", 12, "V"], ["R_eq", 12 / 11, "kΩ"]], "I_total", "A", value, `I_total = 12 V/(12/11 kΩ + 12/11 kΩ) = ${value} A`));
  }
  pair("rational-sum/grouped", [["a", 1, "cm"]], "L", "m", "L = (1/2 cm) + (1/4 cm)", 0.0075, 0.75);
  // Unread display fractions cannot choose between raw and coherent unit
  // interpretations, even when a stated answer happens to support one.
  for (const member of ["a+b", "a+b+0", "a/100+b/100"]) for (const value of [0.0075, 0.75, 0.000075]) {
    decline(`rational-sum/ambiguous-trusted-bindings/${member}/${value}`,
      plan([["a", 0.5, "cm"], ["b", 0.25, "cm"]], "L", "m", value, `L = ${member} = 1/2 cm + 1/4 cm = ${value} m`));
  }
  right("rational-sum/coherent-prefixed-output",
    plan([["a", 0.5, "m"], ["b", 0.25, "m"]], "L", "cm", 75, "L = a+b = 1/2 m + 1/4 m = 75 cm"), 75);
  decline("rational-sum/false-prefixed-output",
    plan([["a", 0.5, "m"], ["b", 0.25, "m"]], "L", "cm", 0.75, "L = a+b = 1/2 m + 1/4 m = 0.75 cm"));
  pair("rational-denominator/grouped", [["V", 12, "V"], ["R_eq", 12 / 11, "kΩ"]], "I_total", "A", "I_total = 12 V/((12/11 kΩ) + (12/11 kΩ))", 0.0055, 5.5);
  for (const unit of ["cm⁻¹", "cm^-1", "cm^(-1)", "cm^(−1)"]) {
    for (const [numerator, truth] of [["(1)", 0.5], ["sqrt(4)", 1], ["(2+3)", 2.5], ["pi", Math.PI / 2], ["2sqrt(4)", 2],
      ["(2×3)", 3], ["(2·3)", 3], ["(2⋅3)", 3], ["(√4)", 1], ["(sqrt(4)×3)", 3], ["(1×10^-3)", 0.0005]] as const) {
      for (const value of [truth, truth * 0.0001]) {
        decline(`rational-inverse/grouped-numerator/${unit}/${numerator}/${value}`,
          plan([["x", 1, "cm^-1"]], "K", "cm^-1", value, `K = ${numerator}/2 ${unit} = ${value} ${unit}`));
      }
    }
  }

  if (failures.length) {
    console.error(`unit-quantity arithmetic RED: ${failures.length}/${checks} checks across ${cases} authored plans (${liveParse ? "source + compiled live" : "source"})`);
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log(`unit-quantity arithmetic GREEN: ${checks} checks across ${cases} authored plans (${liveParse ? "source + compiled live" : "source"}; no scene/save/teaching replay)`);
  }
}

void main();
