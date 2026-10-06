/**
 * Ohm's law topic readiness gate (physics/12, natural student stems).
 *
 * Runs the same synthesis the tutor falls back to and checks the figure
 * against independent expectations: exactly the stated resistors with their
 * stated values, the stated source value, the topology, meter placement, and
 * that the source's positive plate drives current the way the sense mark
 * points. Stems the engine cannot draw whole must decline.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-ohm-ready.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyStatedCircuitAuthority, solveStatedResistorCircuit } from "../../src/ir/statedCircuitAuthority";
import { applySourceQuantityAuthority } from "../../src/ir/sourceQuantityAuthority";
import { detectArchetype } from "../../src/archetypes/detect";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { SceneDocument } from "../../src/types";

type Symbol = { id: string; symbol: string; start: string; end: string };

function draw(question: string) {
  return synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
}
function symbols(document: SceneDocument): Symbol[] {
  return document.constructions.filter((construction) => construction.operator === "symbol").map((construction) => ({
    id: construction.outputs[0]!,
    symbol: String(construction.inputs.symbol),
    start: String(construction.inputs.start),
    end: String(construction.inputs.end),
  }));
}
function label(document: SceneDocument, id: string): string | undefined {
  return document.entities.find((entity) => entity.id === id)?.label;
}
function x(document: SceneDocument, id: string): number {
  const place = document.constructions.find((construction) => construction.operator === "point" && construction.outputs[0] === id);
  assert.ok(place, `point ${id}`);
  return Number(place.inputs.x);
}

let checks = 0;
const check = (name: string, run: () => void): void => {
  run();
  checks += 1;
  console.log(`ok ${name}`);
};

interface Case {
  name: string;
  question: string;
  resistors: string[];
  source: string | null;
  topology: "series" | "parallel" | "tree";
  ammeter?: boolean;
  voltmeter?: boolean;
  /** Independent oracle for the narration (not drawn): source current in A. */
  current?: number;
}

// Expected values are hand computed from the stem, not read from the engine.
const CASES: Case[] = [
  { name: "single resistor", question: "A 12 V battery is connected across a 6 Ω resistor. Find the current through the resistor.",
    resistors: ["R=6Ω"], source: "12 V", topology: "series", current: 2 },
  { name: "series pair", question: "Two resistors of 4 Ω and 6 Ω are connected in series to a 10 V battery. Find the current in the circuit.",
    resistors: ["R1=4Ω", "R2=6Ω"], source: "10 V", topology: "series", current: 1 },
  { name: "parallel three", question: "Three resistors of 2 Ω, 3 Ω and 6 Ω are connected in parallel across a 6 V battery. Find the total current drawn.",
    resistors: ["R1=2Ω", "R2=3Ω", "R3=6Ω"], source: "6 V", topology: "parallel", current: 6 },
  { name: "series with parallel group", question: "A 3 Ω resistor is connected in series with a parallel combination of 6 Ω and 3 Ω resistors across a 10 V battery. Find the current from the battery.",
    resistors: ["R1=3Ω", "R2=6Ω", "R3=3Ω"], source: "10 V", topology: "tree", current: 2 },
  { name: "meters on one resistor", question: "A resistor of 10 Ω is connected to a 5 V cell. An ammeter is connected in series and a voltmeter across the resistor. Find the ammeter and voltmeter readings.",
    resistors: ["R=10Ω"], source: "5 V", topology: "series", ammeter: true, voltmeter: true, current: 0.5 },
  { name: "identical parallel", question: "Three identical resistors each of 6 Ω are connected in parallel across a 12 V battery. Find the current drawn from the battery.",
    resistors: ["R1=6Ω", "R2=6Ω", "R3=6Ω"], source: "12 V", topology: "parallel", current: 6 },
];

for (const item of CASES) {
  check(item.name, () => {
    const result = draw(item.question);
    assert.ok(result, "drawn");
    assert.equal(result.family, "circuit_network");
    const document = result.document;
    const all = symbols(document);
    const resistors = all.filter((entry) => entry.symbol === "resistor");
    assert.deepEqual(resistors.map((entry) => label(document, entry.id)), item.resistors, "exactly the stated resistors with their values");
    const battery = all.filter((entry) => entry.symbol === "battery");
    if (item.source) {
      assert.equal(battery.length, 1, "one source");
      assert.equal(label(document, battery[0]!.id), item.source);
      // Long plate (positive) sits at the symbol's start; it must face the
      // left return wire so current enters the network on the left, the way
      // the sense mark on R1 (start to end, left to right) points.
      assert.ok(x(document, battery[0]!.start) < x(document, battery[0]!.end), "positive plate faces the left wire");
      const sense = document.annotations.find((annotation) => annotation.kind === "sense");
      assert.ok(sense, "current sense mark");
      const senseOn = resistors.find((entry) => entry.id === sense.targetIds[0]);
      assert.ok(senseOn && x(document, senseOn.start) < x(document, senseOn.end), "sense runs left to right");
    }
    const pairs = new Set(resistors.map((entry) => `${entry.start}|${entry.end}`));
    if (item.topology === "series") assert.equal(pairs.size, resistors.length, "series resistors occupy distinct node pairs");
    if (item.topology === "parallel") assert.equal(pairs.size, 1, "parallel resistors share one terminal pair");
    if (item.topology === "tree") assert.equal(pairs.size, resistors.length, "a laid out tree gives every resistor its own terminals");
    const ammeter = all.find((entry) => entry.symbol === "ammeter");
    const voltmeter = all.find((entry) => entry.symbol === "voltmeter");
    assert.equal(Boolean(ammeter), Boolean(item.ammeter), "ammeter only when stated");
    assert.equal(Boolean(voltmeter), Boolean(item.voltmeter), "voltmeter only when stated");
    if (voltmeter) assert.ok(resistors.some((entry) => entry.start === voltmeter.start && entry.end === voltmeter.end), "voltmeter across the resistor");
    if (ammeter) assert.ok(!resistors.some((entry) => [entry.start, entry.end].includes(ammeter.start) && [entry.start, entry.end].includes(ammeter.end)), "ammeter in the line, not across a resistor");
    assert.equal(document.quantities.length, item.resistors.length, "only stated resistances become quantities");
    // Numeric authority: the exact solve of the drawn circuit gives the
    // hand-computed source current.
    const solution = solveStatedResistorCircuit(item.question);
    assert.ok(solution, "drawn circuit is solved");
    assert.equal(solution.sourceCurrent?.value, item.current, "source current matches the hand oracle");
  });
}

type Quantity = TurnPlanV3["derived"][number];
const plan = (question: string, givens: Quantity[], derived: Quantity[]): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, givens, derived,
  unknowns: derived.map((quantity) => ({ id: quantity.id, symbol: quantity.symbol, unit: quantity.unit })),
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
} as TurnPlanV3);
const q = (id: string, symbol: string, value: number, unit: string, provenance: Quantity["provenance"] = "derived"): Quantity =>
  ({ id, symbol, value, unit, provenance } as Quantity);
const value = (result: ReturnType<typeof applyStatedCircuitAuthority>, id: string): number | undefined =>
  result?.plan.derived.find((quantity) => quantity.id === id)?.value;

check("authority: series current corrected, R_eq added", () => {
  const question = "Two resistors of 4 Ω and 6 Ω are connected in series to a 10 V battery. Find the current in the circuit.";
  const result = applyStatedCircuitAuthority(question, plan(question, [q("R1", "R_1", 4, "Ω", "given"), q("R2", "R_2", 6, "Ω", "given"), q("V", "V", 10, "V", "given")], [q("I", "I", 1.2, "A")]));
  assert.ok(result);
  assert.equal(value(result, "I"), 1, "I = 10/(4+6) = 1 A");
  assert.equal(value(result, "circuit_R_eq"), 10);
  assert.ok(result.issues.some((issue) => issue.code === "circuit_value_corrected"));
});

check("authority: parallel branch currents by figure index; unbound symbols untouched", () => {
  const question = "Three resistors of 2 Ω, 3 Ω and 6 Ω are connected in parallel across a 6 V battery. Find the total current drawn.";
  const result = applyStatedCircuitAuthority(question, plan(question, [], [
    q("I2", "I_2", 3, "A"), q("Ibranch", "I_branch", 1, "A"), q("Ix", "I_x", 5, "A"), q("Itot", "I_total", 7, "A"), q("Req", "R_eq", 1, "Ω"), q("Ibare", "I", 4, "A"),
  ]));
  assert.ok(result);
  assert.equal(value(result, "I2"), 2, "I_2 = 6/3 = 2 A through R2");
  assert.equal(value(result, "Ibranch"), 1, "unbound, but R3's recomputed current: left as written");
  assert.equal(value(result, "Ix"), undefined, "unbound and 5 A is no recomputed current: withdrawn");
  assert.equal(value(result, "Itot"), 6, "I_total = 6 A");
  assert.equal(value(result, "Req"), 1);
  assert.equal(value(result, "Ibare"), undefined, "a bare I in a parallel circuit is unbound; 4 A is no recomputed current");
});

check("authority: rounded thirds agree, conflicting given withdrawn", () => {
  const question = "A 3 Ω resistor is connected in series with a parallel combination of 6 Ω and 3 Ω resistors across a 10 V battery. Find the current from the battery.";
  const result = applyStatedCircuitAuthority(question, plan(question, [q("Rx", "R", 5, "Ω", "given")], [
    q("I2", "I_2", 0.67, "A"), q("I3", "I_3", 1.33, "A"), q("I", "I_source", 2.5, "A"),
  ]));
  assert.ok(result);
  assert.equal(value(result, "I2"), 0.67, "2/3 A written 0.67 stands");
  assert.equal(value(result, "I3"), 1.33, "4/3 A written 1.33 stands");
  assert.equal(value(result, "I"), 2, "I_source = 10/(3 + 2) = 2 A");
  assert.equal(result.plan.givens.length, 0, "5 Ω is not a stated resistance");
});

check("authority: meter readings", () => {
  const question = "A resistor of 10 Ω is connected to a 5 V cell. An ammeter is connected in series and a voltmeter across the resistor. Find the ammeter and voltmeter readings.";
  const result = applyStatedCircuitAuthority(question, plan(question, [], [q("A", "I_A", 2, "A")]));
  assert.ok(result);
  assert.equal(value(result, "A"), 0.5, "ammeter = 5/10");
  assert.equal(value(result, "circuit_voltmeter"), 5, "the plan lacked the voltmeter reading, so it is added");
  assert.equal(value(result, "circuit_I"), undefined, "source current already present as the ammeter's 0.5 A");
});

check("authority: bare V and P in a multi-resistor circuit are never rewritten", () => {
  const question = "Two resistors of 4 ohm and 12 ohm are connected in parallel across a 6 V cell. An ammeter measures the total current. Find its reading.";
  const result = applyStatedCircuitAuthority(question, plan(question, [], [q("I1", "I_1", 1.5, "A"), q("P", "P", 99, "W"), q("Vr", "V", 7, "V"), q("Pt", "P_total", 10, "W")]));
  assert.ok(result);
  assert.equal(value(result, "I1"), 1.5, "6/4");
  assert.equal(value(result, "P"), undefined, "bare P unbound and 99 W is no recomputed power: withdrawn");
  assert.equal(value(result, "Vr"), undefined, "bare V unbound and 7 V is no recomputed voltage: withdrawn");
  assert.equal(value(result, "Pt"), 12, "P_total = 6 V x 2 A");
});

// Reviewer repro (fb64e214 note): an unbound wrong value must not reach narration.
check("review repro: unbound P = 99 W withdrawn, P_total 24 W added; correct unbound values stand", () => {
  const question = "Two resistors of 2 Ω and 4 Ω are connected in series across a 12 V battery. Find the power drawn.";
  const wrong = applyStatedCircuitAuthority(question, plan(question, [], [q("P", "P", 99, "W")]));
  assert.ok(wrong);
  // "Find the power drawn" asks for the total power and P is the plan's
  // requested unknown, so it binds and is corrected (no longer only withdrawn).
  assert.equal(value(wrong, "P"), 24, "99 W corrected to P_total = 12 V x 2 A");
  assert.equal(value(wrong, "circuit_P"), undefined, "nothing to add");
  const unrequested = applyStatedCircuitAuthority(question, { ...plan(question, [], [q("P", "P", 99, "W")]), unknowns: [] });
  assert.equal(value(unrequested, "P"), undefined, "a 99 W the plan does not request is withdrawn");
  assert.equal(value(unrequested, "circuit_P"), 24, "P_total added");
  // Correct unbound values: whole power 24 W, R1's 8 W (2^2 x 2), R2's 16 W, V across R2 = 8 V, a 4 Ω resistance.
  const right = applyStatedCircuitAuthority(question, plan(question, [], [
    q("P", "P", 24, "W"), q("Pa", "P_a", 8, "W"), q("Pb", "P_b", 16, "W"), q("Vx", "V_x", 8, "V"), q("Ry", "R_y", 4, "Ω"),
  ]));
  assert.ok(right);
  for (const [id, expected] of [["P", 24], ["Pa", 8], ["Pb", 16], ["Vx", 8], ["Ry", 4]] as const) assert.equal(value(right, id), expected, id);
  assert.equal(value(right, "circuit_P"), undefined, "24 W already present");
  assert.ok(!right.issues.some((issue) => issue.code === "circuit_value_withdrawn" || issue.code === "circuit_value_corrected"));
});

// Review #9 (cead3106): the plan's answer to the question's ask binds to that one quantity.
check("asked battery current binds the requested bare I: a branch value is corrected", () => {
  // 2 || 3 || 6 at 6 V: branches 3, 2, 1 A; battery 6 A
  const question = "Three resistors of 2 Ω, 3 Ω and 6 Ω are connected in parallel across a 6 V battery. Find the current drawn from the battery.";
  const result = applyStatedCircuitAuthority(question, plan(question, [], [q("I", "I", 3, "A")]));
  assert.ok(result);
  assert.equal(value(result, "I"), 6, "3 A is R1's current, not the battery's");
  assert.equal(value(result, "circuit_I"), undefined, "the answer already holds 6 A");
  assert.ok(result.issues.some((issue) => issue.code === "circuit_value_corrected"));
  const right = applyStatedCircuitAuthority(question, plan(question, [], [q("I", "I", 6, "A")]));
  assert.equal(value(right, "I"), 6);
  assert.ok(!right!.issues.some((issue) => issue.code === "circuit_value_corrected"), "a correct answer is untouched");
});

check("asked voltage across one series resistor binds: the other resistor's drop is corrected", () => {
  // 4 + 6 at 10 V: 1 A, drops 4 V and 6 V
  const question = "Two resistors of 4 Ω and 6 Ω are connected in series across a 10 V battery. Find the potential difference across the 6 Ω resistor.";
  const drawn = draw(question);
  assert.deepEqual(symbols(drawn!.document).filter((entry) => entry.symbol === "resistor").map((entry) => label(drawn!.document, entry.id)), ["R1=4Ω", "R2=6Ω"],
    "\"across the 6 Ω resistor\" refers back; it is not a third resistor");
  const result = applyStatedCircuitAuthority(question, plan(question, [], [q("V", "V", 4, "V")]));
  assert.equal(value(result, "V"), 6, "4 V is the 4 Ω resistor's drop");
  const right = applyStatedCircuitAuthority(question, plan(question, [], [q("V", "V", 6, "V")]));
  assert.equal(value(right, "V"), 6);
});

check("asked total current in a mixed tree binds: a branch current is corrected", () => {
  // 3 + (6 || 3) at 10 V: R_eq 5 Ω, battery 2 A, branches 2/3 and 4/3 A
  const question = "A 3 Ω resistor is connected in series with a parallel combination of 6 Ω and 3 Ω resistors across a 10 V battery. Find the total current.";
  const result = applyStatedCircuitAuthority(question, plan(question, [], [q("I", "I", 1.33, "A")]));
  assert.equal(value(result, "I"), 2, "4/3 A is a branch current");
  // A value the plan does not request keeps the class rule: 1.33 A is a real branch current, so it stands.
  const aside = applyStatedCircuitAuthority(question, { ...plan(question, [], [q("I", "I", 2, "A"), q("Ib", "I_b", 1.33, "A")]), unknowns: [{ id: "I", symbol: "I", unit: "A" }] });
  assert.equal(value(aside, "I"), 2);
  assert.equal(value(aside, "Ib"), 1.33);
});

check("an ask the reader cannot pin to one quantity binds nothing", () => {
  // two 3 Ω resistors in the tree: "across the 3 Ω resistor" names neither one
  const question = "A 3 Ω resistor is connected in series with a parallel combination of 6 Ω and 3 Ω resistors across a 10 V battery. Find the potential difference across the 3 Ω resistor.";
  const result = applyStatedCircuitAuthority(question, plan(question, [], [q("V", "V", 4, "V")]));
  assert.equal(value(result, "V"), 4, "4 V is a recomputed drop; unbound, it stands");
});

check("unbound wrong values of each recomputed class are withdrawn", () => {
  const question = "A 3 Ω resistor is connected in series with a parallel combination of 6 Ω and 3 Ω resistors across a 10 V battery. Find the current from the battery.";
  // Recomputed: currents 2, 2/3, 4/3; voltages 10, 6, 4; resistances 3, 6, 3, 5; power 20, 12, 8/3, 16/3.
  const result = applyStatedCircuitAuthority(question, plan(question, [], [
    q("Ia", "I_a", 1, "A"), q("Va", "V_a", 5, "V"), q("Ra", "R_a", 2, "Ω"), q("Pa", "P_a", 30, "W"),
    q("Ib", "I_b", 0.67, "A"), q("Vb", "V_b", 4, "V"), q("Rb", "R_b", 5, "Ω"), q("Pb", "P_b", 12, "W"),
  ]));
  assert.ok(result);
  for (const id of ["Ia", "Va", "Ra", "Pa"]) assert.equal(value(result, id), undefined, `${id} withdrawn`);
  for (const [id, expected] of [["Ib", 0.67], ["Vb", 4], ["Rb", 5], ["Pb", 12]] as const) assert.equal(value(result, id), expected, `${id} stands`);
});

check("without a stated source voltage, unbound currents are not judged", () => {
  const question = "Two resistors of 3 Ω and 6 Ω are connected in parallel. Find the equivalent resistance.";
  const result = applyStatedCircuitAuthority(question, plan(question, [], [q("I", "I", 9, "A"), q("R", "R", 7, "Ω")]));
  assert.ok(result);
  assert.equal(value(result, "I"), 9, "no current is recomputed, so none is withdrawn");
  assert.equal(value(result, "R"), 2, "the asked equivalent resistance: R is the requested unknown, 7 Ω corrected to 3 || 6 = 2 Ω");
  const unrequested = applyStatedCircuitAuthority(question, { ...plan(question, [], [q("R", "R", 7, "Ω")]), unknowns: [] });
  assert.equal(value(unrequested, "R"), undefined, "unrequested, 7 Ω is no recomputed resistance (3, 6, 2): withdrawn");
});

// Reviewer repros (reviews/ohm.md): a correct plan must never be rewritten.
check("review repro: 4 Ω parallel with (2 Ω + 2 Ω) is read as 4 || (2 + 2), and correct values stand", () => {
  const question = "A 4 Ω resistor is connected in parallel with a series combination of 2 Ω and 2 Ω across a 6 V battery. Find the equivalent resistance.";
  const solution = solveStatedResistorCircuit(question);
  assert.ok(solution);
  assert.equal(solution.equivalentResistance.value, 2, "4 || (2 + 2) = 2 Ω, not (4 || 2) + 2");
  const result = applyStatedCircuitAuthority(question, plan(question, [], [
    q("Req", "R_eq", 2, "Ω"), q("I", "I_total", 3, "A"), q("I1", "I_1", 1.5, "A"), q("I2", "I_2", 2, "A"), q("V", "V", 6, "V"),
  ]));
  assert.ok(result);
  assert.equal(value(result, "Req"), 2);
  assert.equal(value(result, "I"), 3);
  assert.equal(value(result, "I1"), 1.5, "6/4 through the 4 Ω branch");
  assert.equal(value(result, "I2"), 1.5, "6/(2+2) through R2, corrected from 2");
  assert.equal(value(result, "V"), 6, "bare V never rewritten");
  assert.equal(result.issues.filter((issue) => issue.code === "circuit_value_corrected").length, 1);
});

check("review repro: internal resistance declines figure and authority", () => {
  const question = "A cell of emf 9 V and internal resistance 1 Ω is connected to an external resistor of 2 Ω. Find the current and the terminal voltage.";
  const drawn = draw(question);
  assert.ok(!drawn || symbols(drawn.document).every((entry) => entry.symbol !== "resistor"), "internal resistance is not drawn as an external resistor");
  const correct = plan(question, [], [q("I", "I", 3, "A"), q("V", "V", 6, "V")]);
  assert.equal(applyStatedCircuitAuthority(question, correct), null, "terminal voltage 6 V is never rewritten to the emf");
});

check("review repro: control series 2 Ω + 4 Ω at 12 V keeps I and adds R_eq", () => {
  const question = "Two resistors of 2 Ω and 4 Ω are connected in series to a 12 V battery. Find the current.";
  const result = applyStatedCircuitAuthority(question, plan(question, [], [q("I", "I", 2, "A")]));
  assert.ok(result);
  assert.equal(value(result, "I"), 2);
  assert.equal(value(result, "circuit_R_eq"), 6);
  assert.ok(!result.issues.some((issue) => issue.code === "circuit_value_corrected"));
});

check("review repro: ohm written as a word, any case, is read", () => {
  const result = draw("A 12 V battery is connected across a 6 Ohm resistor. Find the current.");
  assert.ok(result);
  const resistors = symbols(result.document).filter((entry) => entry.symbol === "resistor");
  assert.deepEqual(resistors.map((entry) => label(result.document, entry.id)), ["R=6Ω"]);
});

// Secondary review #7 (615b59c5): one arrangement word must not hide a grouping.
check("grouping cue routes a parallel-only stem through the reader: end to end is series", () => {
  // N8: (2 + 4) || 3 = 2 Ω, 6/2 = 3 A
  const question = "A 2 Ω resistor and a 4 Ω resistor are joined end to end, and this combination is connected in parallel with a 3 Ω resistor across a 6 V battery. Find the current drawn from the battery.";
  assert.equal(detectArchetype(question)?.slots.tree, "P(S(0,1),2)");
  const solution = solveStatedResistorCircuit(question);
  assert.ok(solution && solution.equivalentResistance.value === 2 && solution.sourceCurrent?.value === 3);
  const result = applyStatedCircuitAuthority(question, plan(question, [], [q("Req", "R_eq", 2, "Ω"), q("I", "I", 3, "A")]));
  assert.ok(result);
  assert.equal(value(result, "Req"), 2, "correct R_eq stands");
  assert.equal(value(result, "I"), 3, "correct I stands");
  assert.ok(!result.issues.some((issue) => issue.code === "circuit_value_corrected" || issue.code === "circuit_value_withdrawn"));
  // (6 + 3) || 9 = 4.5 Ω, 9/4.5 = 2 A: a closed "joined end to end" group attaches once without a scope
  const closed = "Resistors of 6 Ω and 3 Ω joined end to end are connected in parallel with a 9 Ω resistor across a 9 V battery. Find the current.";
  assert.equal(detectArchetype(closed)?.slots.tree, "P(S(0,1),2)");
  assert.equal(solveStatedResistorCircuit(closed)?.sourceCurrent?.value, 2);
  // A grouping cue on a plain parallel stem still reads three lanes: 2 || 3 || 6 = 1 Ω, 6 A
  const flat = "Three resistors of 2 Ω, 3 Ω and 6 Ω are connected together in parallel across a 6 V battery. Find the current that flows from the battery.";
  assert.equal(detectArchetype(flat)?.slots.topology, "parallel");
  assert.equal(solveStatedResistorCircuit(flat)?.sourceCurrent?.value, 6);
});

check("deictic 'in this circuit' is not a grouping cue", () => {
  // 2 + 4 = 6 Ω at 12 V: 2 A (secondary review #7 note)
  const question = "In this circuit, a 2 Ω and a 4 Ω resistor are connected, with a 12 V battery, in series. Find the current.";
  assert.equal(detectArchetype(question)?.slots.topology, "series");
  assert.equal(solveStatedResistorCircuit(question)?.sourceCurrent?.value, 2);
  // "this combination" and "this arrangement" still group
  assert.equal(detectArchetype("In this circuit, a combination of 2 Ω and 4 Ω resistors is connected in parallel with a 3 Ω resistor across a 6 V battery.")?.slots.topology, "ambiguous");
  assert.equal(detectArchetype("A 2 Ω and a 4 Ω resistor are joined, and this arrangement is in parallel with a 3 Ω resistor across a 6 V battery.")?.slots.topology, "ambiguous");
});

check("grouping cue with an unstated inner arrangement declines figure and authority", () => {
  for (const question of [
    // N9: the 2 Ω and 4 Ω combination's own arrangement is not stated
    "A combination of 2 Ω and 4 Ω resistors is connected in parallel with a 3 Ω resistor across a 6 V battery. Find the current.",
    // the symmetric series-only case
    "A combination of 6 Ω and 3 Ω resistors is connected in series with a 2 Ω resistor across a 12 V battery. Find the current.",
    // "connected together" says nothing about the pair's arrangement
    "A 2 Ω resistor and a 4 Ω resistor are connected together, and this combination is connected in parallel with a 3 Ω resistor across a 6 V battery.",
    // "a pair of" with one value names two resistors the grammar cannot place
    "A pair of 4 Ω resistors in parallel is connected in series with a 2 Ω resistor across a 6 V battery.",
    // a "group" whose members are not arranged
    "A group of 3 Ω and 6 Ω resistors is connected in parallel with a 2 Ω resistor across a 6 V battery.",
  ]) {
    assert.equal(solveStatedResistorCircuit(question), null, question);
    assert.equal(applyStatedCircuitAuthority(question, plan(question, [], [q("Req", "R_eq", 2, "Ω"), q("I", "I", 3, "A")])), null, question);
    const drawn = draw(question);
    assert.ok(!drawn || drawn.family !== "circuit_network" || symbols(drawn.document).every((entry) => entry.symbol !== "resistor"), `no figure: ${question}`);
  }
});

check("an explicit 'this combination' scopes a second attachment", () => {
  // (3 + 2) || 5 = 2.5 Ω, 10/2.5 = 4 A (secondary review #7 passed check)
  const question = "A 3 Ω resistor is connected in series with a 2 Ω resistor, and this combination is connected in parallel with a 5 Ω resistor across a 10 V battery. Find the current.";
  assert.equal(detectArchetype(question)?.slots.tree, "P(S(0,1),2)");
  const solution = solveStatedResistorCircuit(question);
  assert.ok(solution && solution.equivalentResistance.value === 2.5 && solution.sourceCurrent?.value === 4);
  const scoped = "A 3 Ω resistor is connected in series with a 2 Ω resistor and the whole combination is connected in parallel with a 5 Ω resistor across a 10 V battery.";
  assert.equal(detectArchetype(scoped)?.slots.tree, "P(S(0,1),2)", "the whole combination");
});

// Structural reader: explicit series/parallel trees from the stem's clause.
// R_eq and source current are hand computed; the figure must solve to them.
const TREES: Array<[string, string, number, number]> = [
  ["Resistors of 2 Ω and 4 Ω are connected in series, and this combination is connected in parallel with a 6 Ω resistor across a 12 V battery. Find the current drawn.",
    "P(S(0,1),2)", 3, 4], // (2+4) || 6 = 3 Ω, 12/3 = 4 A
  ["A series combination of 1 Ω and 2 Ω is connected in parallel with a series combination of 3 Ω and 3 Ω across a 9 V battery. Find the current.",
    "P(S(0,1),S(2,3))", 2, 4.5], // 3 || 6 = 2 Ω, 9/2 A
  ["A parallel combination of 6 Ω and 3 Ω is connected in series with a 4 Ω resistor across a 12 V battery. Find the current.",
    "S(P(0,1),2)", 6, 2], // 2 + 4 = 6 Ω
  ["Two resistors of 6 Ω and 3 Ω are connected in parallel and in series with a 2 Ω resistor across a 12 V battery. Find the current.",
    "S(P(0,1),2)", 4, 3], // 2 + 2 = 4 Ω
  ["Resistors of 12 Ω and 4 Ω are connected in parallel, and this combination is connected in series with a parallel combination of 6 Ω and 6 Ω across a 12 V battery. Find the current.",
    "S(P(0,1),P(2,3))", 6, 2], // 3 + 3 = 6 Ω
  ["A 3 Ω resistor is connected in series with a parallel combination of 6 Ω and 3 Ω resistors across a 10 V battery. Find the current from the battery.",
    "S(0,P(1,2))", 5, 2], // 3 + 2 = 5 Ω
];
for (const [question, shape, req, current] of TREES) {
  check(`tree ${shape}: R_eq ${req} Ω, I ${current} A`, () => {
    assert.equal(detectArchetype(question)?.slots.tree, shape, "bound tree");
    const result = draw(question);
    assert.ok(result && result.family === "circuit_network", "drawn");
    const resistors = symbols(result.document).filter((entry) => entry.symbol === "resistor");
    assert.equal(resistors.length, shape.match(/\d/g)!.length, "every stated resistance drawn once");
    for (const entry of resistors) assert.ok(x(result.document, entry.start) < x(result.document, entry.end), "left to right");
    const solution = solveStatedResistorCircuit(question);
    assert.ok(solution);
    assert.ok(Math.abs(solution.equivalentResistance.value - req) < 1e-12, `R_eq ${solution.equivalentResistance.value}`);
    assert.ok(Math.abs((solution.sourceCurrent?.value ?? NaN) - current) < 1e-12, `I ${solution.sourceCurrent?.value}`);
    for (const primitive of result.renderScene.primitives) {
      for (const point of primitive.points) assert.ok(point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700, "inside the diagram zone");
    }
  });
}

check("unbound groupings decline (figure and authority)", () => {
  for (const question of [
    // two readings: P(2, S(3, 6)) or S(P(2, 3), 6)
    "A 2 Ω resistor in parallel with 3 Ω and 6 Ω in series is connected to a 6 V battery. Find the current.",
    // a bare pair "in series with" a third that is itself "in parallel with" a fourth
    "A 2 Ω resistor and a 3 Ω resistor are in series with a 6 Ω resistor which is in parallel with a 4 Ω resistor across a 6 V battery.",
    // the 3 Ω resistance is named twice; the clause is not one tree
    "A 2 Ω resistor and a 3 Ω resistor are in parallel, and a 6 Ω resistor is in series with the 3 Ω resistor, across a 6 V battery.",
    // three levels deep
    "A 2 Ω resistor is connected in series with a parallel combination of 3 Ω and 6 Ω, and this combination is connected in parallel with a 4 Ω resistor across an 8 V battery.",
    // words outside the closed grammar
    "A 5 Ω resistor is connected between A and B in parallel with a series combination of 2 Ω and 3 Ω across a 10 V battery.",
    // two arrangements, not one tree
    "Three resistors of 2 Ω, 3 Ω and 6 Ω are connected in series and parallel across a 6 V battery.",
    // no arrangement word at all
    "Resistors of 2 Ω and 3 Ω are connected to a 5 V battery. Find the current.",
    // Secondary review #7 BLOCK 1: "which" may bind the 6 Ω (2 + (6 || 3) = 4 Ω) or the chain ((2 + 6) || 3)
    "A 2 Ω resistor is connected in series with a 6 Ω resistor which is in parallel with a 3 Ω resistor across a 12 V battery. Find the current.",
    // Secondary review #7 BLOCK 2: 4 + (6 || 3) = 6 Ω or (4 + 6) || 3 = 30/13 Ω
    "A 4 Ω resistor in series with a 6 Ω resistor in parallel with a 3 Ω resistor is connected to a 12 V battery. Find the current.",
    // chained the other way: (2 || 3) + 6 = 7.2 Ω or 2 || (3 + 6) = 18/11 Ω
    "A 2 Ω resistor in parallel with a 3 Ω resistor in series with a 6 Ω resistor is connected across a 6 V battery. Find the current.",
    // "that" relative clause: 1 + (4 || 4) = 3 Ω or (1 + 4) || 4 = 20/9 Ω
    "A 1 Ω resistor is joined in series with a 4 Ω resistor that is in parallel with another 4 Ω resistor across a 6 V battery.",
    // a comma does not scope a second attachment: 5 + (10 || 10) or (5 + 10) || 10
    "A 5 Ω resistor is connected in series with a 10 Ω resistor, in parallel with a 10 Ω resistor, across a 10 V battery.",
    // a bare "it" could be the 3 Ω or the pair
    "A 6 Ω resistor is in series with a 3 Ω resistor and it is in parallel with a 2 Ω resistor across a 6 V battery.",
  ]) {
    assert.equal(solveStatedResistorCircuit(question), null, question);
    assert.equal(applyStatedCircuitAuthority(question, plan(question, [], [q("I", "I_total", 1, "A")])), null, question);
    const drawn = draw(question);
    assert.ok(!drawn || drawn.family !== "circuit_network" || symbols(drawn.document).every((entry) => entry.symbol !== "resistor")
      || /series and parallel/.test(question), `no guessed mixed figure: ${question}`);
  }
});

check("authority: declined circuits leave the plan alone", () => {
  const question = "Five resistors of 1 Ω, 2 Ω, 3 Ω, 4 Ω and 5 Ω are connected in series to a 15 V battery. Find the current.";
  assert.equal(applyStatedCircuitAuthority(question, plan(question, [], [q("I", "I", 1, "A")])), null);
});

// The live turn must apply this authority after the ProblemIR reconciliation
// and before the plan becomes authoritative for the scene and the teaching
// prompt. Both anchors are required; a missing one fails, not passes.
check("authority is wired into the live turn", () => {
  const source = readFileSync(new URL("../../../../apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts", import.meta.url), "utf8");
  const start = source.indexOf("turnPlan = reconcileTurnPlanWithSolver(");
  // The circuit authority runs through the one shared source quantity seam.
  const call = source.indexOf("applySourceQuantityAuthority(turnPlan, ");
  const assign = source.indexOf("turnPlan = sourceAuthority.plan;");
  const end = source.indexOf("const authoritativeTurnPlan = turnPlan;");
  const teaching = source.indexOf("buildTurnTeachingPrompt({");
  assert.ok(start > 0 && call > start && assign > call && end > assign && teaching > end, "order: solver reconcile < source quantity authority < authoritative plan < teaching prompt");
  assert.equal(source.indexOf("applySourceQuantityAuthority(", call + 1), -1, "exactly one live call site");
  // The seam must still apply the circuit authority, with the same result.
  const question = "A 4 Ω resistor and a 6 Ω resistor are connected in series across a 10 V battery. Find the current.";
  const turnPlan = plan(question, [q("R1", "R_1", 4, "Ω", "given"), q("R2", "R_2", 6, "Ω", "given"), q("V", "V", 10, "V", "given")], [q("I", "I", 1.2, "A")]);
  const direct = applyStatedCircuitAuthority(question, turnPlan);
  const seam = applySourceQuantityAuthority(turnPlan, null, question);
  assert.ok(direct && seam.outcomes.some((outcome) => outcome.topic === "physics|12|ohms-law-and-resistance"), "circuit authority is registered in the seam");
  assert.deepEqual(seam.plan, direct.plan, "the seam returns the circuit authority's plan unchanged");
});

// Plan derived values must not become resistors or a source label.
check("derived plan values are not drawn", () => {
  const question = "Three resistors of 2 Ω, 3 Ω and 6 Ω are connected in parallel across a 6 V battery. Find the total current drawn.";
  const turnPlan = {
    givens: [
      { id: "R1", symbol: "R_1", value: 2, unit: "Ω" }, { id: "R2", symbol: "R_2", value: 3, unit: "Ω" },
      { id: "R3", symbol: "R_3", value: 6, unit: "Ω" }, { id: "V", symbol: "V", value: 6, unit: "V" },
    ],
    derived: [{ id: "R_eq", symbol: "R_eq", value: 1, unit: "Ω" }, { id: "I", symbol: "I", value: 6, unit: "A" }],
  };
  const result = synthesizeFamilyScene({ question, turnPlan });
  assert.ok(result);
  assert.equal(symbols(result.document).filter((entry) => entry.symbol === "resistor").length, 3);
});

check("current-only stem draws no invented source", () => {
  const result = draw("A current of 2 A flows through a 5 Ω resistor. Find the potential difference across it.");
  assert.ok(result);
  const all = symbols(result.document);
  assert.deepEqual(all.map((entry) => entry.symbol), ["resistor"]);
  assert.equal(label(result.document, all[0]!.id), "R=5Ω");
});

check("series then parallel keeps two views of the stated pair", () => {
  const result = draw("Two resistors of 4 Ω and 6 Ω are connected first in series and then in parallel. Find the equivalent resistance in each case.");
  assert.ok(result);
  assert.equal(symbols(result.document).filter((entry) => entry.symbol === "resistor").length, 4, "two resistors in each of two views");
});

// Integrator report: valueless concept stems keep a labelled schematic with no values and no authority.
check("valueless concept stems draw labelled schematics, never values", () => {
  const internal = draw("Draw a labelled diagram for EMF, potential difference, and internal resistance of a cell.");
  assert.ok(internal && internal.family === "circuit_network");
  const parts = symbols(internal.document);
  assert.deepEqual(parts.map((entry) => `${entry.symbol}:${label(internal.document, entry.id)}`).sort(), ["battery:E", "resistor:R", "resistor:r"], "cell E with internal r, external R");
  const box = internal.document.annotations.find((annotation) => annotation.kind === "enclose");
  assert.ok(box && box.targetIds.includes("battery") && box.targetIds.includes("r_internal") && !box.targetIds.includes("R1"), "dashed outline holds E and r only");
  assert.equal(internal.document.quantities.length, 0, "no values");
  const mixed = draw("Draw a labelled diagram for Mixed series-parallel resistor networks.");
  assert.ok(mixed && mixed.family === "circuit_network");
  assert.deepEqual(symbols(mixed.document).filter((entry) => entry.symbol === "resistor").map((entry) => label(mixed.document, entry.id)), ["R1", "R2", "R3"]);
  assert.equal(mixed.document.quantities.length, 0);
  const both = draw("Draw a labelled diagram for Series and parallel combinations of resistors. Draw the circuit with named resistors and the source.");
  assert.ok(both && symbols(both.document).filter((entry) => entry.symbol === "resistor").length >= 4, "a series view and a parallel view");
  for (const question of [
    "Draw a labelled diagram for EMF, potential difference, and internal resistance of a cell.",
    "Draw a labelled diagram for Mixed series-parallel resistor networks.",
  ]) assert.equal(applyStatedCircuitAuthority(question, plan(question, [], [q("I", "I", 2, "A")])), null, "no values, no authority");
});

// Declines: drawing these whole is not supported, and a cut-down or guessed
// network would be a wrong figure.
const DECLINES: Array<[string, string]> = [
  ["five resistors", "Five resistors of 1 Ω, 2 Ω, 3 Ω, 4 Ω and 5 Ω are connected in series to a 15 V battery. Find the current."],
  ["four parallel lanes", "Four resistors of 2 Ω, 4 Ω, 6 Ω and 12 Ω are connected in parallel across a 12 V battery. Find the current drawn from the battery."],
  ["stated count disagrees with values", "Three resistors of 2 Ω and 4 Ω are connected in series across a 6 V battery. Find the current."],
  ["voltmeter across one of a series pair", "Two resistors of 4 Ω and 6 Ω are in series with a 10 V battery and a voltmeter across the 6 Ω resistor. Find the voltmeter reading."],
  ["branch ammeter in a parallel group", "Two resistors of 4 Ω and 12 Ω are connected in parallel across a 6 V cell with an ammeter in series with the 4 Ω resistor. Find its reading."],
];
for (const [name, question] of DECLINES) {
  check(`declines: ${name}`, () => {
    const result = draw(question);
    const resistors = result ? symbols(result.document).filter((entry) => entry.symbol === "resistor").length : 0;
    assert.ok(!result || result.family !== "circuit_network" || resistors === 0, `expected no circuit figure, got ${result?.family} with ${resistors} resistors`);
  });
}

console.log(`\nverify-ohm-ready: ${checks} checks passed`);
