/**
 * Authored source-input authority controls; no captured student content or I/O.
 * Source: pnpm --filter @heytutor/tutor exec tsx --tsconfig ../../packages/tutor-core/tsconfig.json scripts/verify/verify-unit-source-corrections.ts
 * Add --live after building scene-engine and tutor-core to check compiled admission.
 */
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  validateTurnPlanV3,
  type TurnPlanV3,
} from "../../../../packages/scene-engine/src/contracts/contractsV3";

async function main(): Promise<void> {
  const liveParse = process.argv.includes("--live")
    ? (await import("@heytutor/tutor-core")).parseTurnPlanV3Content : null;
  const failures: string[] = [];
  let checks = 0;
  let cases = 0;
  function check(name: string, condition: boolean, detail?: unknown): void {
    checks++;
    if (!condition) failures.push(`${name}: ${JSON.stringify(detail)}`);
  }
  function plan(area: boolean, sourceText: string, question: string): TurnPlanV3 {
    return {
      schemaVersion: "turn-plan/v3", question,
      givens: [
        ...(area ? [{ id: "A", symbol: "A", value: 0.8, unit: "mm²", provenance: "given" as const, sourceText: "A = 0.8 mm²" }] : []),
        { id: "I", symbol: "I", value: 3, unit: "A", provenance: "given", sourceText: "I = 3 A" },
        { id: "R", symbol: "R", value: 12, unit: "Ω", provenance: "given", sourceText: "R = 12 Ω" },
      ],
      unknowns: [{ id: "voltage", symbol: "V", unit: "V" }],
      derived: [{ id: "V", symbol: "V", value: 36, unit: "V", provenance: "derived", sourceText, dependsOn: ["I", "R"] }],
      qualitativeClaims: [], lawIds: ["ohms_law"], assumptions: [], visualRequirement: "none",
    };
  }
  function observe(name: string, input: TurnPlanV3, mustDecline: boolean, truth = 36): void {
    cases++;
    const before = JSON.stringify(input);
    const raw = validateTurnPlanV3(input, input.question);
    const reconciled = reconcileTurnPlanV3ExplicitArithmetic(input).plan as TurnPlanV3;
    const validated = validateTurnPlanV3(reconciled, input.question);
    const live = liveParse?.(JSON.stringify(input), input.question) ?? null;
    const detail = { raw: raw.valid, rawIssues: raw.issues.map((issue) => issue.code),
      reconciled: reconciled.derived[0]?.value, reconciledIssues: validated.issues.map((issue) => issue.code), live: live?.derived[0]?.value };
    check(`${name}/input immutable`, JSON.stringify(input) === before);
    check(`${name}/question bytes`, reconciled.question === input.question);
    check(`${name}/given bytes`, JSON.stringify(reconciled.givens) === JSON.stringify(input.givens));
    check(`${name}/derived bytes`, JSON.stringify(reconciled.derived) === JSON.stringify(input.derived), detail);
    check(`${name}/raw ${mustDecline ? "declines" : "accepts"}`, raw.valid !== mustDecline, detail);
    check(`${name}/reconciled ${mustDecline ? "declines" : "accepts"}`, validated.valid !== mustDecline, detail);
    if (liveParse) {
      check(`${name}/live ${mustDecline ? "declines" : "accepts"}`, mustDecline ? live === null : live?.derived[0]?.value === truth, detail);
      check(`${name}/live question and given bytes`, live === null ||
        (live.question === input.question && JSON.stringify(live.givens) === JSON.stringify(input.givens)));
    }
  }
  // Every previously reported unreadable measurement, plus relative changes.
  const corrections = [
    "actual current is “4 A”", "actual current is \"4 A\"", "actual current is [4 A]",
    "actual current is 4 A’", "actual current is 4 A—find V", "actual current is 4 A…",
    "actual current is 4\\,A", "actual current is 4 \\mathrm{A}", "actual current is 4 \\times 10^{0} A",
    "actual current is four amperes", "actual current is four amps", "actual current is 4",
    "actual current is 4 C/s", "actual current is 4 C s⁻¹", "actual current is 10³ A",
    "actual resistance is sixteen ohms", "actual resistance is 16 V/A", "actual resistance is 16 Ω",
    "the current is doubled", "the current is twice that",
    "I is quadrupled", "R is halved", "I is quartered", "I is septendecupled",
    "I = 4 A", "R = 16 Ω", "actual current is 4 × 10⁰ A", "actual current is 4 A",
  ];
  const sources = ["V = 3 A * R = 36 V", "V = I R = (3 A)(12 Ω) = 36 V",
    "V = I R = 3 A × 12 Ω = 36 V", "V = I*R = 36 V"];
  for (const area of [true, false]) {
    const givens = `Given ${area ? "A = 0.8 mm², " : ""}I = 3 A, R = 12 Ω.`;
    for (const correction of corrections) {
      const questions = [
        `${givens} Correction: ${correction}. Find V.`,
        `${givens} The ${correction}. Find V.`,
        `${givens} Find V. Correction: ${correction}.`,
        `${givens} Find V if ${correction}.`,
      ];
      for (const [placement, question] of questions.entries()) for (const [spelling, source] of sources.entries()) {
        observe(`correction/${area ? "area" : "no-area"}/${correction}/${placement}/${spelling}`, plan(area, source, question), true);
      }
    }
    for (const [name, question] of [
      ["plain", `${givens} Find V.`],
      ["comma", `${givens.slice(0, -1)}, find V in V.`],
      ["request-first", `Find V. ${givens}`],
      ["reordered", `Given R = 12 Ω, ${area ? "A = 0.8 mm², " : ""}I = 3 A. Calculate V.`],
    ]) for (const [spelling, source] of sources.entries()) {
      observe(`grounded/${area ? "area" : "no-area"}/${name}/${spelling}`, plan(area, source, question!), false);
    }
  }
  for (const declaration of ["Let I = 3 A, R = 12 Ω.", "I = 3 A, R = 12 Ω."]) {
    for (const correction of ["I is quadrupled", "R is halved", "actual current is four amperes"]) {
      observe(`input-block/${declaration}/${correction}`, plan(false, "V = I*R = 36 V", `${declaration} ${correction}. Find V.`), true);
    }
  }
  observe("drawing-cannot-assert-input", plan(false, "V = I*R = 36 V",
    "Given I = 3 A, R = 12 Ω. Draw a 4 A actual current. Find V."), true);
  const introductions = [
    "The circuit has I = 3 A and R = 12 Ω.",
    "Given a current I = 3 A and resistance R = 12 Ω.",
    "In this circuit, I = 3 A and R = 12 Ω.",
    "For I = 3 A and R = 12 Ω,",
    "Suppose I = 3 A, R = 12 Ω.",
    "A wire carries 3 A through a 12 Ω resistance.",
  ];
  for (const introduction of introductions) for (const source of sources) {
    observe(`introduction/${introduction}/grounded/${source}`, plan(false, source, `${introduction} Find V.`), false);
    for (const correction of corrections) {
      observe(`introduction/${introduction}/${correction}/${source}`,
        plan(false, source, `${introduction} ${correction}. Find V.`), true);
    }
  }
  for (const [current, resistance] of [["i_current", "R_wire"], ["I1", "r"], ["current", "resistance"]]) {
    const renamed = plan(false, `V = ${current}*${resistance} = 36 V`,
      `The circuit has ${current} = 3 A and ${resistance} = 12 Ω. ${current} is septendecupled. Find V.`);
    renamed.givens[0] = { ...renamed.givens[0]!, id: current!, symbol: current!, sourceText: `${current} = 3 A` };
    renamed.givens[1] = { ...renamed.givens[1]!, id: resistance!, symbol: resistance!, sourceText: `${resistance} = 12 Ω` };
    renamed.derived[0]!.dependsOn = [current!, resistance!];
    observe(`renamed/${current}/${resistance}`, renamed, true);
  }
  for (const assertion of ["The current is quadrupled from 3 A", "The resistance is halved from 12 Ω",
    "The 3 A current is quadrupled", "The current of 3 A is septendecupled through the 12 Ω resistance"]) {
    observe(`prose/matching-old-measurement/${assertion}`, plan(false, "V = I*R = 36 V",
      `A wire carries 3 A through a 12 Ω resistance. ${assertion}. Find V.`), true);
  }
  for (const assertion of ["It is quadrupled", "This is septendecupled", "The value is halved",
    "The throughput is quadrupled", "The flow is quartered", "Its magnitude changes by a factor of four"]) {
    for (const before of [false, true]) observe(`prose/unread-assertion/${before}/${assertion}`,
      plan(false, "V = I*R = 36 V", before
        ? `${assertion}. A wire carries 3 A through a 12 Ω resistance. Find V.`
        : `A wire carries 3 A through a 12 Ω resistance. ${assertion}. Find V.`), true);
  }
  for (const request of ["Find V once the current quadruples", "Find V once it quadruples",
    "Find V as the flow becomes fourfold", "Compute V following a quadrupling of its value"]) {
    observe(`prose/unread-query/${request}`, plan(false, "V = I*R = 36 V",
      `A wire carries 3 A through a 12 Ω resistance. ${request}.`), true);
  }
  const incompleteDeclarations = [
    "With the current quadrupled, Given I = 3 A, R = 12 Ω. Find V.",
    "Given with the current quadrupled I = 3 A, R = 12 Ω. Find V.",
    "Given I = 3 A with current quadrupled, R = 12 Ω. Find V.",
    "Given I = 3 A, with current quadrupled, R = 12 Ω. Find V.",
    "Given I = 3 A, R = 12 Ω with current quadrupled. Find V.",
    "Given I = 3 A, R = 12 Ω. With current quadrupled, find V.",
    "Do not use I = 3 A or R = 12 Ω. Find V.",
    "Given I = 3 A (not the actual current), R = 12 Ω. Find V.",
    "I = 3 A and R = 12 Ω are obsolete values. Find V.",
    "Do not use 3 A or 12 Ω. Find V.",
    "3 A and 12 Ω are obsolete values. Find V.",
    "Ignore 3 A and 12 Ω. Find V.",
    "With its magnitude quadrupled a wire carries 3 A through a 12 Ω resistance. Find V.",
    "A wire no longer carries 3 A through a 12 Ω resistance. Find V.",
    "Not 3 A through 12 Ω resistance. Find V.",
    "The current is quadrupled. Find V.",
    "It is quadrupled. Find V.",
  ];
  for (const question of incompleteDeclarations) for (const source of sources) {
    observe(`incomplete-declaration/${question}/${source}`, plan(false, source, question), true);
  }
  const series: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3",
    question: "Given V = 12 V and series resistors R1 = 100 Ω and R2 = 300 Ω, find I in mA.",
    givens: [["V", 12, "V"], ["R1", 100, "Ω"], ["R2", 300, "Ω"]].map(([id, value, unit]) => ({
      id: String(id), symbol: String(id), value: Number(value), unit: String(unit),
      provenance: "given", sourceText: `${id} = ${value} ${unit}`,
    })),
    unknowns: [{ id: "answer", symbol: "I", unit: "mA" }],
    derived: [{ id: "answer", symbol: "I", value: 30, unit: "mA", provenance: "derived",
      sourceText: "I = V/(R1+R2) = 12/(100+300) = 0.03 A = 30 mA", dependsOn: ["V", "R1", "R2"] }],
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none",
  };
  observe("publication/current-milliampere/right", series, false, 30);
  const wrongSeries = structuredClone(series);
  wrongSeries.derived[0]!.value = 40;
  wrongSeries.derived[0]!.sourceText = "I = V/(R1+R2) = 12/(100+300) = 0.04 A = 40 mA";
  const correctedSeries = reconcileTurnPlanV3ExplicitArithmetic(wrongSeries).plan as TurnPlanV3;
  check("publication/current-milliampere/wrong raw declines", !validateTurnPlanV3(wrongSeries, wrongSeries.question).valid);
  check("publication/current-milliampere/repairs 40 to 30", correctedSeries.derived[0]?.value === 30);
  check("publication/current-milliampere/repaired source", correctedSeries.derived[0]?.sourceText === series.derived[0]?.sourceText);
  check("publication/current-milliampere/repaired accepts", validateTurnPlanV3(correctedSeries, wrongSeries.question).valid);
  for (const area of [false, true]) for (const query of ["Compute I = 4 A", "Solve I = 4 A, then Find V", "Find I*0+4 A = I", "Determine R+0 = 16 Ω", "Evaluate 16 Ω = R+0"]) {
    const givens = `Given ${area ? "A = 0.8 mm², " : ""}I = 3 A, R = 12 Ω.`;
    observe(`query-cannot-reassign/${area}/${query}`, plan(area, "V = I*R = 36 V", `${givens} ${query}. Find V.`), true);
  }
  console.log(`Unit source corrections: ${checks - failures.length}/${checks} checks, ${cases} authored plans${liveParse ? ", including live admission" : ", source only"}.`);
  if (failures.length) {
    failures.slice(0, 24).forEach((failure) => console.error(`FAIL ${failure}`));
    if (failures.length > 24) console.error(`... ${failures.length - 24} further failures`);
    process.exitCode = 1;
  }
}

void main();
