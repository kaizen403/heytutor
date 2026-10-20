/**
 * Adversarial floor set: synthetic questions (no recorded student text) with
 * plausible turn plans and ProblemIRs, including the review's counter-examples
 * for #245 and ProblemIRs with the mistakes a model makes. Each case says
 * whether the floor must draw or decline; drawn cases are also judged blind.
 */
import type { ExpressionNodeIR, ProblemIR } from "../../../src/index";

export type FloorCaseKind = "circuit" | "body" | "graph" | "withdrawn" | "unstructured";

export interface FloorCase {
  id: string;
  kind: FloorCaseKind;
  question: string;
  turnPlan: Record<string, unknown>;
  problemIR: ProblemIR | null;
  expect: "draw" | "decline";
  /** Texts that must be on the board when it draws. */
  shows?: string[];
  /** Texts that must never be on the board. */
  never?: string[];
  why: string;
}

/** A tiny parser from "x^2-4*x+5" to the ProblemIR expression tree (explicit products only). */
function parse(source: string): ExpressionNodeIR {
  const tokens = source.replace(/\s+/g, "").match(/\d+(?:\.\d+)?|[A-Za-z_]+|[-+*/^()]/g) ?? [];
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++]!;
  const primary = (): ExpressionNodeIR => {
    const token = next();
    if (token === "(") { const inner = sum(); next(); return inner; }
    if (token === "-") return { kind: "unary", operator: "-", operand: power() };
    if (/^\d/.test(token)) return { kind: "number", value: Number(token) };
    if (["sin", "cos", "tan", "sqrt", "abs", "exp", "ln", "log"].includes(token)) {
      next();
      const argument = sum();
      next();
      return { kind: "call", function: token as "sin", argument };
    }
    if (token === "pi" || token === "e") return { kind: "constant", name: token };
    return { kind: "variable", name: token };
  };
  const power = (): ExpressionNodeIR => {
    const base = primary();
    if (peek() === "^") { next(); return { kind: "binary", operator: "^", left: base, right: power() }; }
    return base;
  };
  const product = (): ExpressionNodeIR => {
    let left = power();
    while (peek() === "*" || peek() === "/") { const operator = next() as "*" | "/"; left = { kind: "binary", operator, left, right: power() }; }
    return left;
  };
  const sum = (): ExpressionNodeIR => {
    let left = product();
    while (peek() === "+" || peek() === "-") { const operator = next() as "+" | "-"; left = { kind: "binary", operator, left, right: product() }; }
    return left;
  };
  return sum();
}

class IR {
  private readonly ir: ProblemIR;
  constructor(readonly question: string) {
    this.ir = { schemaVersion: "problem-ir/v1", id: "adversarial", question, facts: [], entities: [], expressions: [], constraints: [], representationIntents: [], solveRequests: [] };
  }
  fact(id: string, quote: string, kind: "given" | "requested" = "given"): this {
    const start = this.question.indexOf(quote);
    if (start < 0) throw new Error(`fixture quote is not in the question: ${quote}`);
    this.ir.facts.push({ id, kind, statement: quote, evidence: { source: "question", start, end: start + quote.length, quote } });
    return this;
  }
  entity(id: string, kind: ProblemIR["entities"][number]["kind"], label: string | undefined, facts: string[]): this {
    this.ir.entities.push({ id, kind, ...(label ? { label } : {}), evidenceFactIds: facts });
    return this;
  }
  /** A component joined to two node points. */
  join(component: string, a: string, b: string, facts: string[]): this {
    this.ir.constraints.push({ id: `join_${component}`, kind: "connected", entityIds: [component, a, b], evidenceFactIds: facts });
    return this;
  }
  relate(id: string, kind: "incident" | "parallel" | "perpendicular" | "connected" | "inside", entityIds: string[], facts: string[]): this {
    this.ir.constraints.push({ id, kind, entityIds, evidenceFactIds: facts });
    return this;
  }
  number(id: string, value: number, facts: string[]): this {
    this.ir.expressions.push({ id, valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: facts });
    return this;
  }
  fn(id: string, source: string, facts: string[]): this {
    this.ir.expressions.push({ id, valueType: "function", root: parse(source), evidenceFactIds: facts });
    return this;
  }
  intent(kind: ProblemIR["representationIntents"][number]["kind"], entityIds: string[], facts: string[]): this {
    this.ir.representationIntents.push({ id: `intent_${this.ir.representationIntents.length + 1}`, kind, entityIds, evidenceFactIds: facts } as ProblemIR["representationIntents"][number]);
    return this;
  }
  build(): ProblemIR {
    return structuredClone(this.ir);
  }
}

function plan(question: string, givens: Array<[string, number, string | undefined, string]>, unknowns: Array<[string, string?]> = []) {
  return {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
    givens: givens.map(([symbol, value, unit, sourceText], index) => ({ id: `g${index + 1}`, symbol, value, ...(unit ? { unit } : {}), sourceText, provenance: "given" })),
    unknowns: unknowns.map(([symbol, unit], index) => ({ id: `u${index + 1}`, symbol, ...(unit ? { unit } : {}) })),
    derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
  };
}

const cases: FloorCase[] = [];
const add = (item: FloorCase) => cases.push(item);

// ---------- circuits that must draw ----------
{
  const q = "A 9 V supply and two 4.7 kΩ resistors are connected in series. Find the voltage across each resistor.";
  add({ id: "circuit-divider-nodes", kind: "circuit", question: q, expect: "draw", shows: ["9 V", "4.7 kΩ"], never: ["4.5 V"], why: "series loop from node joins, one value shared by the counted pair",
    turnPlan: plan(q, [["V", 9, "V", "9 V supply"], ["R", 4.7, "kΩ", "two 4.7 kΩ resistors"]], [["V_R", "V"]]),
    problemIR: new IR(q).fact("f1", "9 V supply").fact("f2", "two 4.7 kΩ resistors").fact("f3", "connected in series")
      .entity("sup", "component", "supply", ["f1"]).entity("r1", "component", "resistor", ["f2"]).entity("r2", "component", "resistor", ["f2"])
      .entity("n1", "point", undefined, ["f3"]).entity("n2", "point", undefined, ["f3"]).entity("n3", "point", undefined, ["f3"])
      .join("sup", "n1", "n2", ["f3"]).join("r1", "n2", "n3", ["f3"]).join("r2", "n3", "n1", ["f3"])
      .number("e1", 9, ["f1"]).number("e2", 4.7, ["f2"]).intent("network", ["sup", "r1", "r2"], ["f3"]).build() });
}
{
  const q = "Two resistors of 6 Ω and 3 Ω are connected in parallel across a 9 V cell. Find the current from the cell.";
  add({ id: "circuit-parallel-cell", kind: "circuit", question: q, expect: "draw", shows: ["6 Ω", "3 Ω", "9 V"], never: ["2 Ω", "4.5 A"], why: "two-node ladder from node joins",
    turnPlan: plan(q, [["R_1", 6, "Ω", "6 Ω"], ["R_2", 3, "Ω", "3 Ω"], ["V", 9, "V", "9 V cell"]], [["I", "A"]]),
    problemIR: new IR(q).fact("f1", "6 Ω").fact("f2", "3 Ω").fact("f3", "9 V cell").fact("f4", "connected in parallel across")
      .entity("r1", "component", undefined, ["f1"]).entity("r2", "component", undefined, ["f2"]).entity("cell", "component", "cell", ["f3"])
      .entity("a", "point", undefined, ["f4"]).entity("b", "point", undefined, ["f4"])
      .join("r1", "a", "b", ["f4"]).join("r2", "a", "b", ["f4"]).join("cell", "a", "b", ["f4"])
      .number("e1", 6, ["f1"]).number("e2", 3, ["f2"]).number("e3", 9, ["f3"]).intent("network", ["r1", "r2", "cell"], ["f4"]).build() });
}
{
  const q = "A 6 Ω resistor and a 3 Ω resistor are connected in parallel. This combination is connected to a 12 V battery through a 2 Ω resistor.";
  const base = () => new IR(q).fact("f1", "A 6 Ω resistor").fact("f2", "a 3 Ω resistor").fact("f3", "12 V battery").fact("f4", "a 2 Ω resistor")
    .fact("f5", "connected in parallel").fact("f6", "This combination is connected to a 12 V battery through")
    .entity("r6", "component", "resistor", ["f1"]).entity("r3", "component", "resistor", ["f2"]).entity("bat", "component", "battery", ["f3"])
    .entity("r2", "component", "resistor", ["f4"]).number("e1", 6, ["f1"]).number("e2", 3, ["f2"]).number("e3", 12, ["f3"]).number("e4", 2, ["f4"]);
  const givens: Array<[string, number, string, string]> = [["R_1", 6, "Ω", "6 Ω"], ["R_2", 3, "Ω", "3 Ω"], ["V", 12, "V", "12 V battery"], ["R_3", 2, "Ω", "2 Ω"]];
  add({ id: "circuit-mixed-through", kind: "circuit", question: q, expect: "draw", shows: ["6 Ω", "3 Ω", "2 Ω", "12 V"], why: "review case 3 with a correct ProblemIR: 2 Ω in series, 6 Ω and 3 Ω across one pair",
    turnPlan: plan(q, givens), problemIR: base().entity("p", "point", undefined, ["f6"]).entity("r", "point", undefined, ["f6"]).entity("s", "point", undefined, ["f5"])
      .join("bat", "p", "r", ["f6"]).join("r2", "r", "s", ["f6"]).join("r6", "s", "p", ["f5"]).join("r3", "s", "p", ["f5"])
      .intent("network", ["r6", "r3", "bat", "r2"], ["f5"]).build() });
  add({ id: "circuit-mixed-through-wrong-ir", kind: "circuit", question: q, expect: "decline", why: "review case 3: a ProblemIR that puts all three resistors across the battery contradicts \"through\"",
    turnPlan: plan(q, givens), problemIR: base().entity("p", "point", undefined, ["f5"]).entity("r", "point", undefined, ["f5"])
      .join("bat", "p", "r", ["f5"]).join("r2", "p", "r", ["f5"]).join("r6", "p", "r", ["f5"]).join("r3", "p", "r", ["f5"])
      .intent("network", ["r6", "r3", "bat", "r2"], ["f5"]).build() });
  add({ id: "circuit-mixed-no-nodes", kind: "circuit", question: q, expect: "decline", why: "review case 3: a connection list with no nodes does not state the topology",
    turnPlan: plan(q, givens), problemIR: base().relate("c1", "connected", ["bat", "r2", "r6", "r3"], ["f6"]).intent("network", ["r6", "r3", "bat", "r2"], ["f5"]).build() });
}
{
  const q = "A resistor R = 20 Ω and an inductor L = 50 mH are connected in series with an ac source. Find the impedance.";
  add({ id: "circuit-rl-series", kind: "circuit", question: q, expect: "decline", why: "the engine's inductor glyph reads as a resistor, so no inductor is drawn yet",
    turnPlan: plan(q, [["R", 20, "Ω", "R = 20 Ω"], ["L", 50, "mH", "L = 50 mH"]], [["Z", "Ω"]]),
    problemIR: new IR(q).fact("f1", "R = 20 Ω").fact("f2", "L = 50 mH").fact("f3", "ac source").fact("f4", "connected in series")
      .entity("r", "component", "R", ["f1"]).entity("l", "component", "L", ["f2"]).entity("src", "component", "ac source", ["f3"])
      .entity("a", "point", undefined, ["f4"]).entity("b", "point", undefined, ["f4"]).entity("c", "point", undefined, ["f4"])
      .join("src", "a", "b", ["f4"]).join("r", "b", "c", ["f4"]).join("l", "c", "a", ["f4"])
      .number("e1", 20, ["f1"]).number("e2", 50, ["f2"]).intent("network", ["r", "l", "src"], ["f4"]).build() });
}
{
  const q = "A 12 V battery is connected in series with a 4 Ω resistor and an 8 Ω resistor. A voltmeter is connected across the 8 Ω resistor.";
  add({ id: "circuit-voltmeter-across", kind: "circuit", question: q, expect: "decline", why: "the engine's meter glyph has no V and open leads, so no meter is drawn yet",
    turnPlan: plan(q, [["V", 12, "V", "12 V battery"], ["R_1", 4, "Ω", "4 Ω"], ["R_2", 8, "Ω", "8 Ω"]], [["V_2", "V"]]),
    problemIR: new IR(q).fact("f1", "12 V battery").fact("f2", "a 4 Ω resistor").fact("f3", "an 8 Ω resistor").fact("f4", "A voltmeter is connected across")
      .fact("f5", "connected in series").entity("bat", "component", "battery", ["f1"]).entity("r4", "component", "resistor", ["f2"])
      .entity("r8", "component", "resistor", ["f3"]).entity("vm", "component", "voltmeter", ["f4"])
      .entity("a", "point", undefined, ["f5"]).entity("b", "point", undefined, ["f5"]).entity("c", "point", undefined, ["f5"])
      .join("bat", "a", "b", ["f5"]).join("r4", "b", "c", ["f5"]).join("r8", "c", "a", ["f5"]).join("vm", "c", "a", ["f4"])
      .number("e1", 12, ["f1"]).number("e2", 4, ["f2"]).number("e3", 8, ["f3"]).intent("network", ["bat", "r4", "r8", "vm"], ["f5"]).build() });
}
{
  const q = "A 6 V cell, a 3 Ω resistor and an ammeter are connected in series. What does the ammeter read?";
  add({ id: "circuit-ammeter-series", kind: "circuit", question: q, expect: "decline", why: "the engine's meter glyph has no A and open leads, so no meter is drawn yet",
    turnPlan: plan(q, [["V", 6, "V", "6 V cell"], ["R", 3, "Ω", "3 Ω"]], [["I", "A"]]),
    problemIR: new IR(q).fact("f1", "6 V cell").fact("f2", "a 3 Ω resistor").fact("f3", "an ammeter").fact("f4", "connected in series")
      .entity("cell", "component", "cell", ["f1"]).entity("r", "component", "resistor", ["f2"]).entity("am", "component", "ammeter", ["f3"])
      .entity("a", "point", undefined, ["f4"]).entity("b", "point", undefined, ["f4"]).entity("c", "point", undefined, ["f4"])
      .join("cell", "a", "b", ["f4"]).join("r", "b", "c", ["f4"]).join("am", "c", "a", ["f4"])
      .number("e1", 6, ["f1"]).number("e2", 3, ["f2"]).intent("network", ["cell", "r", "am"], ["f4"]).build() });
}
{
  const q = "Explain a parallel circuit made of two capacitors.";
  const nodes = (ir: IR) => ir.entity("a", "point", undefined, ["f2"]).entity("b", "point", undefined, ["f2"]);
  add({ id: "circuit-two-capacitors", kind: "circuit", question: q, expect: "decline", why: "review case 1: two source-less parts across one pair look like a series loop",
    turnPlan: plan(q, []), problemIR: nodes(new IR(q).fact("f1", "two capacitors").fact("f2", "parallel circuit")
      .entity("c1", "component", "capacitor", ["f1"]).entity("c2", "component", "capacitor", ["f1"]))
      .join("c1", "a", "b", ["f2"]).join("c2", "a", "b", ["f2"]).intent("network", ["c1", "c2"], ["f2"]).build() });
  add({ id: "circuit-two-capacitors-as-resistors", kind: "circuit", question: q, expect: "decline", why: "review case 1: a ProblemIR naming resistors for a capacitor question",
    turnPlan: plan(q, []), problemIR: nodes(new IR(q).fact("f1", "two capacitors").fact("f2", "parallel circuit")
      .entity("r1", "component", "R1", ["f1"]).entity("r2", "component", "R2", ["f1"]).entity("bat", "component", "battery", ["f2"]))
      .join("r1", "a", "b", ["f2"]).join("r2", "a", "b", ["f2"]).join("bat", "a", "b", ["f2"]).intent("network", ["r1", "r2", "bat"], ["f2"]).build() });
}
{
  const q = "A 10 μF capacitor is connected to a 12 V battery. Find the charge on it.";
  add({ id: "circuit-capacitor-battery", kind: "circuit", question: q, expect: "draw", shows: ["10 μF", "12 V"], never: ["120 μC"], why: "a capacitor across a battery",
    turnPlan: plan(q, [["C", 10, "μF", "10 μF capacitor"], ["V", 12, "V", "12 V battery"]], [["Q", "C"]]),
    problemIR: new IR(q).fact("f1", "10 μF capacitor").fact("f2", "12 V battery").fact("f3", "is connected to")
      .entity("cap", "component", "capacitor", ["f1"]).entity("bat", "component", "battery", ["f2"])
      .entity("a", "point", undefined, ["f3"]).entity("b", "point", undefined, ["f3"])
      .join("cap", "a", "b", ["f3"]).join("bat", "a", "b", ["f3"]).number("e1", 10, ["f1"]).number("e2", 12, ["f2"])
      .intent("network", ["cap", "bat"], ["f3"]).build() });
}
{
  const q = "Five resistors of 2 Ω each are connected in series with a 10 V battery. Find the current.";
  const parts = ["r1", "r2", "r3", "r4", "r5"];
  const full = new IR(q).fact("f1", "Five resistors of 2 Ω each").fact("f2", "10 V battery").fact("f3", "connected in series")
    .entity("bat", "component", "battery", ["f2"]);
  parts.forEach((id) => full.entity(id, "component", "resistor", ["f1"]));
  ["n0", "n1", "n2", "n3", "n4", "n5"].forEach((id) => full.entity(id, "point", undefined, ["f3"]));
  full.join("bat", "n0", "n1", ["f3"]);
  parts.forEach((id, index) => full.join(id, `n${index + 1}`, index === 4 ? "n0" : `n${index + 2}`, ["f3"]));
  const givens: Array<[string, number, string, string]> = [["R", 2, "Ω", "2 Ω each"], ["V", 10, "V", "10 V battery"]];
  add({ id: "circuit-five-resistors", kind: "circuit", question: q, expect: "draw", shows: ["2 Ω", "10 V"], never: ["1 A"], why: "review case 2 with all five resistors in the ProblemIR",
    turnPlan: plan(q, givens), problemIR: full.number("e1", 2, ["f1"]).number("e2", 10, ["f2"]).intent("network", ["bat", ...parts], ["f3"]).build() });
  add({ id: "circuit-five-as-one", kind: "circuit", question: q, expect: "decline", why: "review case 2: \"five resistors\" with one resistor in the ProblemIR",
    turnPlan: plan(q, givens), problemIR: new IR(q).fact("f1", "Five resistors of 2 Ω each").fact("f2", "10 V battery").fact("f3", "connected in series")
      .entity("bat", "component", "battery", ["f2"]).entity("r", "component", "resistor", ["f1"]).entity("a", "point", undefined, ["f3"]).entity("b", "point", undefined, ["f3"])
      .join("bat", "a", "b", ["f3"]).join("r", "a", "b", ["f3"]).number("e1", 2, ["f1"]).number("e2", 10, ["f2"]).intent("network", ["bat", "r"], ["f3"]).build() });
}

{
  const q = "A resistor R = 20 Ω is connected across a 10 V battery. Find the current.";
  add({ id: "circuit-symbol-named", kind: "circuit", question: q, expect: "draw", shows: ["20 Ω", "10 V"], never: ["0.5 A"], why: "a part named by its quantity symbol carries its value once",
    turnPlan: plan(q, [["R", 20, "Ω", "R = 20 Ω"], ["V", 10, "V", "10 V battery"]], [["I", "A"]]),
    problemIR: new IR(q).fact("f1", "R = 20 Ω").fact("f2", "10 V battery").fact("f3", "is connected across")
      .entity("r", "component", "R", ["f1"]).entity("bat", "component", "battery", ["f2"]).entity("a", "point", undefined, ["f3"]).entity("b", "point", undefined, ["f3"])
      .join("r", "a", "b", ["f3"]).join("bat", "a", "b", ["f3"]).number("e1", 20, ["f1"]).number("e2", 10, ["f2"]).intent("network", ["r", "bat"], ["f3"]).build() });
}

// ---------- circuits that must decline ----------
{
  const q = "Why are the lamps in a house connected in a parallel circuit?";
  add({ id: "circuit-house-lamps", kind: "circuit", question: q, expect: "decline", why: "review case 1: lamps of no stated count",
    turnPlan: plan(q, []), problemIR: new IR(q).fact("f1", "the lamps in a house").fact("f2", "connected in a parallel circuit")
      .entity("l1", "component", "lamp", ["f1"]).entity("l2", "component", "lamp", ["f1"]).entity("a", "point", undefined, ["f2"]).entity("b", "point", undefined, ["f2"])
      .join("l1", "a", "b", ["f2"]).join("l2", "a", "b", ["f2"]).intent("network", ["l1", "l2"], ["f2"]).build() });
}
{
  const q = "A 6 V battery, a switch and a 2 Ω resistor are in series. Find the current when the switch is closed.";
  add({ id: "circuit-switch", kind: "circuit", question: q, expect: "decline", why: "a switch has no faithful floor glyph state",
    turnPlan: plan(q, [["V", 6, "V", "6 V battery"], ["R", 2, "Ω", "2 Ω"]]),
    problemIR: new IR(q).fact("f1", "6 V battery").fact("f2", "a switch").fact("f3", "a 2 Ω resistor").fact("f4", "are in series")
      .entity("bat", "component", "battery", ["f1"]).entity("sw", "component", "switch", ["f2"]).entity("r", "component", "resistor", ["f3"])
      .entity("a", "point", undefined, ["f4"]).entity("b", "point", undefined, ["f4"]).entity("c", "point", undefined, ["f4"])
      .join("bat", "a", "b", ["f4"]).join("sw", "b", "c", ["f4"]).join("r", "c", "a", ["f4"]).number("e1", 6, ["f1"]).number("e2", 2, ["f3"])
      .intent("network", ["bat", "sw", "r"], ["f4"]).build() });
}
{
  const q = "A diode and a 1 kΩ resistor are connected in series to a 5 V battery. Find the current.";
  add({ id: "circuit-diode", kind: "circuit", question: q, expect: "decline", why: "a diode is not drawn by the floor",
    turnPlan: plan(q, [["R", 1, "kΩ", "1 kΩ"], ["V", 5, "V", "5 V battery"]]),
    problemIR: new IR(q).fact("f1", "A diode").fact("f2", "a 1 kΩ resistor").fact("f3", "5 V battery").fact("f4", "connected in series")
      .entity("d", "component", "diode", ["f1"]).entity("r", "component", "resistor", ["f2"]).entity("bat", "component", "battery", ["f3"])
      .entity("a", "point", undefined, ["f4"]).entity("b", "point", undefined, ["f4"]).entity("c", "point", undefined, ["f4"])
      .join("bat", "a", "b", ["f4"]).join("d", "b", "c", ["f4"]).join("r", "c", "a", ["f4"]).number("e1", 1, ["f2"]).number("e2", 5, ["f3"])
      .intent("network", ["d", "r", "bat"], ["f4"]).build() });
}
{
  const q = "The positive terminal of a 9 V battery is connected to a 3 Ω resistor, and the resistor returns to the negative terminal.";
  add({ id: "circuit-polarity", kind: "circuit", question: q, expect: "decline", why: "a stated polarity is not drawn",
    turnPlan: plan(q, [["V", 9, "V", "9 V battery"], ["R", 3, "Ω", "3 Ω"]]),
    problemIR: new IR(q).fact("f1", "9 V battery").fact("f2", "a 3 Ω resistor").fact("f3", "is connected to")
      .entity("bat", "component", "battery", ["f1"]).entity("r", "component", "resistor", ["f2"]).entity("a", "point", undefined, ["f3"]).entity("b", "point", undefined, ["f3"])
      .join("bat", "a", "b", ["f3"]).join("r", "a", "b", ["f3"]).number("e1", 9, ["f1"]).number("e2", 3, ["f2"]).intent("network", ["bat", "r"], ["f3"]).build() });
}
{
  const q = "In a balanced Wheatstone arrangement, resistors of 2 Ω, 4 Ω, 3 Ω and 6 Ω form a loop ABCD, a 5 Ω resistor joins B and D, and a 6 V battery joins A and C.";
  const ir = new IR(q).fact("f1", "resistors of 2 Ω, 4 Ω, 3 Ω and 6 Ω form a loop ABCD").fact("f2", "a 5 Ω resistor joins B and D").fact("f3", "a 6 V battery joins A and C");
  ["A", "B", "C", "D"].forEach((id) => ir.entity(id, "point", id, ["f1"]));
  ir.entity("rab", "component", undefined, ["f1"]).entity("rbc", "component", undefined, ["f1"]).entity("rcd", "component", undefined, ["f1"]).entity("rda", "component", undefined, ["f1"])
    .entity("rbd", "component", "resistor", ["f2"]).entity("bat", "component", "battery", ["f3"])
    .join("rab", "A", "B", ["f1"]).join("rbc", "B", "C", ["f1"]).join("rcd", "C", "D", ["f1"]).join("rda", "D", "A", ["f1"]).join("rbd", "B", "D", ["f2"]).join("bat", "A", "C", ["f3"])
    .number("e1", 5, ["f2"]).number("e2", 6, ["f3"]).intent("network", ["rab", "rbc", "rcd", "rda", "rbd", "bat"], ["f1"]);
  add({ id: "circuit-bridge", kind: "circuit", question: q, expect: "decline", why: "a bridge is not one loop", turnPlan: plan(q, [["R_5", 5, "Ω", "5 Ω"], ["V", 6, "V", "6 V battery"]]), problemIR: ir.build() });
}
{
  const q = "Two 1.5 V cells and a 3 Ω resistor are connected in series. Find the current.";
  add({ id: "circuit-two-cells", kind: "circuit", question: q, expect: "decline", why: "two sources are not drawn by the floor",
    turnPlan: plan(q, [["E", 1.5, "V", "1.5 V cells"], ["R", 3, "Ω", "3 Ω"]]),
    problemIR: new IR(q).fact("f1", "Two 1.5 V cells").fact("f2", "a 3 Ω resistor").fact("f3", "connected in series")
      .entity("c1", "component", "cell", ["f1"]).entity("c2", "component", "cell", ["f1"]).entity("r", "component", "resistor", ["f2"])
      .entity("a", "point", undefined, ["f3"]).entity("b", "point", undefined, ["f3"]).entity("c", "point", undefined, ["f3"])
      .join("c1", "a", "b", ["f3"]).join("c2", "b", "c", ["f3"]).join("r", "c", "a", ["f3"]).number("e1", 1.5, ["f1"]).number("e2", 3, ["f2"])
      .intent("network", ["c1", "c2", "r"], ["f3"]).build() });
}
{
  const q = "In a circuit, V reads 5 V across a 10 Ω resistor. Find the current.";
  add({ id: "circuit-ambiguous-v", kind: "circuit", question: q, expect: "decline", why: "a part named only V with a voltage could be a source or a meter",
    turnPlan: plan(q, [["V", 5, "V", "5 V"], ["R", 10, "Ω", "10 Ω"]]),
    problemIR: new IR(q).fact("f1", "V reads 5 V").fact("f2", "a 10 Ω resistor").fact("f3", "across")
      .entity("v", "component", "V", ["f1"]).entity("r", "component", "resistor", ["f2"]).entity("a", "point", undefined, ["f3"]).entity("b", "point", undefined, ["f3"])
      .join("v", "a", "b", ["f3"]).join("r", "a", "b", ["f3"]).number("e1", 5, ["f1"]).number("e2", 10, ["f2"]).intent("network", ["v", "r"], ["f3"]).build() });
}
{
  const q = "Two resistors, the first 4 Ω and the second 6 Ω, are in series with a 10 V battery. Find the current.";
  add({ id: "circuit-unused-names", kind: "circuit", question: q, expect: "decline", why: "the ProblemIR names R1 and R2, which the question never uses",
    turnPlan: plan(q, [["R_1", 4, "Ω", "4 Ω"], ["R_2", 6, "Ω", "6 Ω"], ["V", 10, "V", "10 V battery"]]),
    problemIR: new IR(q).fact("f1", "the first 4 Ω").fact("f2", "the second 6 Ω").fact("f3", "10 V battery").fact("f4", "are in series")
      .entity("r1", "component", "R1", ["f1"]).entity("r2", "component", "R2", ["f2"]).entity("bat", "component", "battery", ["f3"])
      .entity("a", "point", undefined, ["f4"]).entity("b", "point", undefined, ["f4"]).entity("c", "point", undefined, ["f4"])
      .join("bat", "a", "b", ["f4"]).join("r1", "b", "c", ["f4"]).join("r2", "c", "a", ["f4"]).number("e1", 4, ["f1"]).number("e2", 6, ["f2"]).number("e3", 10, ["f3"])
      .intent("network", ["r1", "r2", "bat"], ["f4"]).build() });
}
{
  const q = "A 10 μF part and a 12 V battery are connected together. Find the stored charge.";
  add({ id: "circuit-glyph-conflict", kind: "circuit", question: q, expect: "decline", why: "named a resistor but bound to microfarads",
    turnPlan: plan(q, [["C", 10, "μF", "10 μF"], ["V", 12, "V", "12 V battery"]]),
    problemIR: new IR(q).fact("f1", "A 10 μF part").fact("f2", "12 V battery").fact("f3", "connected together")
      .entity("p", "component", "resistor", ["f1"]).entity("bat", "component", "battery", ["f2"]).entity("a", "point", undefined, ["f3"]).entity("b", "point", undefined, ["f3"])
      .join("p", "a", "b", ["f3"]).join("bat", "a", "b", ["f3"]).number("e1", 10, ["f1"]).number("e2", 12, ["f2"]).intent("network", ["p", "bat"], ["f3"]).build() });
}
{
  const q = "A 4 Ω resistor and a 6 Ω resistor are connected first in series and then in parallel across a 12 V source.";
  add({ id: "circuit-series-then-parallel-one-ir", kind: "circuit", question: q, expect: "decline", why: "the ProblemIR states only the series arrangement; the question also states parallel",
    turnPlan: plan(q, [["R_1", 4, "Ω", "4 Ω"], ["R_2", 6, "Ω", "6 Ω"], ["V", 12, "V", "12 V source"]]),
    problemIR: new IR(q).fact("f1", "A 4 Ω resistor").fact("f2", "a 6 Ω resistor").fact("f3", "12 V source").fact("f4", "first in series")
      .entity("r4", "component", "resistor", ["f1"]).entity("r6", "component", "resistor", ["f2"]).entity("src", "component", "source", ["f3"])
      .entity("a", "point", undefined, ["f4"]).entity("b", "point", undefined, ["f4"]).entity("c", "point", undefined, ["f4"])
      .join("src", "a", "b", ["f4"]).join("r4", "b", "c", ["f4"]).join("r6", "c", "a", ["f4"]).number("e1", 4, ["f1"]).number("e2", 6, ["f2"]).number("e3", 12, ["f3"])
      .intent("network", ["r4", "r6", "src"], ["f4"]).build() });
}
{
  const q = "A 9 V supply and two 4.7 kΩ resistors in series. Find the voltage at the midpoint.";
  add({ id: "circuit-divider-no-nodes", kind: "circuit", question: q, expect: "decline", why: "the usual model ProblemIR: components with no stated nodes",
    turnPlan: plan(q, [["V_s", 9, "V", "9 V supply"], ["R_1", 4.7, "kΩ", "two 4.7 kΩ resistors"], ["R_2", 4.7, "kΩ", "two 4.7 kΩ resistors"]], [["V_m", "V"]]),
    problemIR: new IR(q).fact("f1", "9 V supply").fact("f2", "two 4.7 kΩ resistors").fact("f3", "Find the voltage at the midpoint", "requested")
      .entity("supply", "component", "9 V supply", ["f1"]).entity("r1", "component", "4.7 kΩ resistor", ["f2"]).entity("r2", "component", "4.7 kΩ resistor", ["f2"])
      .entity("midpoint", "point", "midpoint", ["f3"]).intent("network", ["supply", "r1", "r2", "midpoint"], ["f2"]).build() });
}
{
  const q = "Three identical cells and a 5 Ω resistor are connected in series. Find the current if each cell gives 1.5 V.";
  add({ id: "circuit-three-cells-as-one", kind: "circuit", question: q, expect: "decline", why: "three cells stated, one in the ProblemIR",
    turnPlan: plan(q, [["R", 5, "Ω", "5 Ω"], ["E", 1.5, "V", "1.5 V"]]),
    problemIR: new IR(q).fact("f1", "Three identical cells").fact("f2", "a 5 Ω resistor").fact("f3", "connected in series")
      .entity("cell", "component", "cell", ["f1"]).entity("r", "component", "resistor", ["f2"]).entity("a", "point", undefined, ["f3"]).entity("b", "point", undefined, ["f3"])
      .join("cell", "a", "b", ["f3"]).join("r", "a", "b", ["f3"]).number("e1", 5, ["f2"]).intent("network", ["cell", "r"], ["f3"]).build() });
}
{
  const q = "Two long straight wires carrying currents of 3 A and 4 A cross at right angles, and the shortest distance between them is 5 cm.";
  add({ id: "withdrawn-crossing-wires", kind: "withdrawn", question: q, expect: "decline", why: "review case 11: wires are not circuit parts",
    turnPlan: plan(q, [["I_1", 3, "A", "3 A"], ["I_2", 4, "A", "4 A"], ["d", 5, "cm", "5 cm"]]),
    problemIR: new IR(q).fact("f1", "currents of 3 A and 4 A").fact("f2", "cross at right angles").entity("w1", "component", "wire", ["f1"]).entity("w2", "component", "wire", ["f1"])
      .relate("p1", "perpendicular", ["w1", "w2"], ["f2"]).intent("field", ["w1", "w2"], ["f2"]).build() });
}

{
  const q = "A 6 V battery, a capacitor and a 2 Ω resistor are connected in series. Find the final charge.";
  add({ id: "circuit-missing-capacitor", kind: "circuit", question: q, expect: "decline", why: "the ProblemIR drops the stated capacitor",
    turnPlan: plan(q, [["V", 6, "V", "6 V battery"], ["R", 2, "Ω", "2 Ω"]]),
    problemIR: new IR(q).fact("f1", "6 V battery").fact("f2", "a 2 Ω resistor").fact("f3", "connected in series")
      .entity("bat", "component", "battery", ["f1"]).entity("r", "component", "resistor", ["f2"]).entity("a", "point", undefined, ["f3"]).entity("b", "point", undefined, ["f3"])
      .join("bat", "a", "b", ["f3"]).join("r", "a", "b", ["f3"]).number("e1", 6, ["f1"]).number("e2", 2, ["f2"]).intent("network", ["bat", "r"], ["f3"]).build() });
}
{
  const q = "A capacitor C = 10 μF and a resistor R = 5 Ω are connected in series to a 12 V battery.";
  add({ id: "circuit-mislabelled-part", kind: "circuit", question: q, expect: "decline", why: "a part named R bound to microfarads: name and unit disagree",
    turnPlan: plan(q, [["C", 10, "μF", "C = 10 μF"], ["R", 5, "Ω", "R = 5 Ω"], ["V", 12, "V", "12 V battery"]]),
    problemIR: new IR(q).fact("f1", "C = 10 μF").fact("f2", "R = 5 Ω").fact("f3", "12 V battery").fact("f4", "connected in series")
      .entity("p1", "component", "R", ["f1"]).entity("p2", "component", "resistor", ["f2"]).entity("bat", "component", "battery", ["f3"])
      .entity("a", "point", undefined, ["f4"]).entity("b", "point", undefined, ["f4"]).entity("c", "point", undefined, ["f4"])
      .join("bat", "a", "b", ["f4"]).join("p1", "b", "c", ["f4"]).join("p2", "c", "a", ["f4"])
      .number("e1", 10, ["f1"]).number("e2", 5, ["f2"]).number("e3", 12, ["f3"]).intent("network", ["p1", "p2", "bat"], ["f4"]).build() });
}

{
  const q = "A capacitor of 10 μF and a resistor of 5 Ω are connected in series to a 12 V battery.";
  add({ id: "circuit-swapped-parts", kind: "circuit", question: q, expect: "decline", why: "the ProblemIR swaps the capacitor and resistor names against their units",
    turnPlan: plan(q, [["C", 10, "μF", "10 μF"], ["R", 5, "Ω", "5 Ω"], ["V", 12, "V", "12 V battery"]]),
    problemIR: new IR(q).fact("f1", "A capacitor of 10 μF").fact("f2", "a resistor of 5 Ω").fact("f3", "12 V battery").fact("f4", "connected in series")
      .entity("p1", "component", "resistor", ["f1"]).entity("p2", "component", "capacitor", ["f2"]).entity("bat", "component", "battery", ["f3"])
      .entity("a", "point", undefined, ["f4"]).entity("b", "point", undefined, ["f4"]).entity("c", "point", undefined, ["f4"])
      .join("bat", "a", "b", ["f4"]).join("p1", "b", "c", ["f4"]).join("p2", "c", "a", ["f4"])
      .number("e1", 10, ["f1"]).number("e2", 5, ["f2"]).number("e3", 12, ["f3"]).intent("network", ["p1", "p2", "bat"], ["f4"]).build() });
}

// ---------- bodies ----------
{
  const q = "A 5 kg block rests on a rough plane inclined at 30° to the horizontal. Find the friction force.";
  const base = (angleFact: string[]) => new IR(q).fact("f1", "5 kg block").fact("f2", "rough plane inclined at 30° to the horizontal").fact("f3", "rests on")
    .entity("block", "body", "block", ["f1", ...(angleFact.includes("block") ? ["f2"] : [])]).entity("plane", "region", "rough plane", angleFact.includes("block") ? ["f3"] : ["f2"])
    .number("e1", 5, ["f1"]).number("e2", 30, ["f2"]).intent("free_body", ["block", "plane"], ["f3"]);
  const givens: Array<[string, number, string, string]> = [["m", 5, "kg", "5 kg block"], ["θ", 30, "°", "inclined at 30°"]];
  add({ id: "body-incline", kind: "body", question: q, expect: "draw", shows: ["θ = 30°", "m = 5 kg"], why: "angle bound to the plane, measured from the horizontal",
    turnPlan: plan(q, givens, [["f", "N"]]), problemIR: base([]).relate("on1", "incident", ["block", "plane"], ["f3"]).build() });
  add({ id: "body-incline-no-incidence", kind: "body", question: q, expect: "decline", why: "the ProblemIR never states the block is on the plane",
    turnPlan: plan(q, givens), problemIR: base([]).build() });
  add({ id: "body-angle-on-block", kind: "body", question: q, expect: "decline", why: "the angle is bound to the block, not the plane",
    turnPlan: plan(q, givens), problemIR: base(["block"]).relate("on1", "incident", ["block", "plane"], ["f3"]).build() });
}
{
  const q = "A 5 kg block rests on a smooth plane inclined at 30° to the vertical. Find the normal reaction.";
  add({ id: "body-incline-vertical", kind: "body", question: q, expect: "decline", why: "review case 5 for bodies: the angle is measured from the vertical",
    turnPlan: plan(q, [["m", 5, "kg", "5 kg block"], ["θ", 30, "°", "30°"]]),
    problemIR: new IR(q).fact("f1", "5 kg block").fact("f2", "smooth plane inclined at 30° to the vertical").fact("f3", "rests on")
      .entity("block", "body", "block", ["f1"]).entity("plane", "region", "smooth plane", ["f2"]).relate("on1", "incident", ["block", "plane"], ["f3"])
      .number("e1", 5, ["f1"]).number("e2", 30, ["f2"]).intent("free_body", ["block", "plane"], ["f3"]).build() });
}
{
  const q = "A 2 kg box is at rest on a horizontal floor. Draw the forces on it.";
  add({ id: "body-level-floor", kind: "body", question: q, expect: "draw", shows: ["m = 2 kg"], why: "a box on a level floor",
    turnPlan: plan(q, [["m", 2, "kg", "2 kg box"]]),
    problemIR: new IR(q).fact("f1", "2 kg box").fact("f2", "horizontal floor").fact("f3", "at rest on")
      .entity("box", "body", "box", ["f1"]).entity("floor", "region", "horizontal floor", ["f2"]).relate("on1", "incident", ["box", "floor"], ["f3"])
      .number("e1", 2, ["f1"]).intent("free_body", ["box", "floor"], ["f3"]).build() });
}
{
  const q = "A 5 kg block on a 30° incline is held by a string parallel to the incline. Find the tension.";
  add({ id: "body-string", kind: "body", question: q, expect: "decline", why: "a string is not drawn by the floor",
    turnPlan: plan(q, [["m", 5, "kg", "5 kg block"], ["θ", 30, "°", "30° incline"]]),
    problemIR: new IR(q).fact("f1", "5 kg block").fact("f2", "30° incline").fact("f3", "on a")
      .entity("block", "body", "block", ["f1"]).entity("incline", "region", "incline", ["f2"]).relate("on1", "incident", ["block", "incline"], ["f3"])
      .number("e1", 5, ["f1"]).number("e2", 30, ["f2"]).intent("free_body", ["block", "incline"], ["f3"]).build() });
}
{
  const q = "A 5 kg block on a 30° incline slides down. Find its acceleration.";
  add({ id: "body-shared-quote", kind: "body", question: q, expect: "decline", why: "mass and angle share one quote, so the angle cannot be bound; a level surface would be false",
    turnPlan: plan(q, [["m", 5, "kg", "5 kg"], ["θ", 30, "°", "30°"]]),
    problemIR: new IR(q).fact("f1", "A 5 kg block on a 30° incline").entity("block", "body", "block", ["f1"]).entity("incline", "region", "incline", ["f1"])
      .relate("on1", "incident", ["block", "incline"], ["f1"]).number("e1", 5, ["f1"]).number("e2", 30, ["f1"]).intent("free_body", ["block", "incline"], ["f1"]).build() });
}
{
  const q = "Two blocks of 2 kg and 3 kg lie in contact on a smooth horizontal table. A 10 N force pushes the 2 kg block.";
  add({ id: "body-two-blocks", kind: "body", question: q, expect: "decline", why: "two bodies are not drawn by the floor",
    turnPlan: plan(q, [["m_1", 2, "kg", "2 kg"], ["m_2", 3, "kg", "3 kg"], ["F", 10, "N", "10 N force"]]),
    problemIR: new IR(q).fact("f1", "2 kg and 3 kg").fact("f2", "smooth horizontal table").fact("f3", "lie in contact on")
      .entity("a", "body", "block", ["f1"]).entity("b", "body", "block", ["f1"]).entity("table", "region", "table", ["f2"])
      .relate("on1", "incident", ["a", "table"], ["f3"]).intent("free_body", ["a", "table"], ["f3"]).build() });
}
{
  const q = "A ball is projected from level ground with a speed of 20 m/s at 30° above the horizontal. Find its range.";
  add({ id: "body-projectile-tagged-free-body", kind: "withdrawn", question: q, expect: "decline", why: "a ProblemIR that tags a projectile as a free body: the ball is not resting",
    turnPlan: plan(q, [["u", 20, "m/s", "speed of 20 m/s"], ["θ", 30, "°", "30°"]], [["R", "m"]]),
    problemIR: new IR(q).fact("f1", "A ball").fact("f2", "level ground").fact("f3", "projected from")
      .entity("ball", "body", "ball", ["f1"]).entity("ground", "region", "level ground", ["f2"]).relate("on1", "incident", ["ball", "ground"], ["f3"])
      .intent("free_body", ["ball", "ground"], ["f3"]).build() });
}

// ---------- graphs ----------
{
  const q = "Sketch the graph of y = x^2 - 4x + 5 and find its minimum value.";
  add({ id: "graph-quadratic", kind: "graph", question: q, expect: "draw", never: ["(2, 1)", "1"], why: "a stated quadratic plotted exactly; the minimum is never written",
    turnPlan: plan(q, [], [["y_min"]]),
    problemIR: new IR(q).fact("f1", "y = x^2 - 4x + 5").entity("c", "curve", undefined, ["f1"]).fn("e1", "x^2-4*x+5", ["f1"]).intent("graph", ["c"], ["f1"]).build() });
}
{
  const q = "Find the area of the region bounded by y = x and y = x^2.";
  add({ id: "graph-two-curves", kind: "graph", question: q, expect: "draw", never: ["1/6", "(1, 1)"], why: "two stated curves, each labelled on itself",
    turnPlan: plan(q, [], [["A"]]),
    problemIR: new IR(q).fact("f1", "y = x and").fact("f2", "y = x^2").entity("line", "line", undefined, ["f1"]).entity("par", "curve", undefined, ["f2"])
      .fn("e1", "x", ["f1"]).fn("e2", "x^2", ["f2"]).intent("graph", ["line", "par"], ["f1"]).build() });
}
{
  const q = "Show that f(x) = |x| is not differentiable at x = 0.";
  add({ id: "graph-abs", kind: "graph", question: q, expect: "draw", why: "a stated |x|",
    turnPlan: plan(q, []), problemIR: new IR(q).fact("f1", "f(x) = |x|").entity("c", "curve", undefined, ["f1"]).fn("e1", "abs(x)", ["f1"]).intent("graph", ["c"], ["f1"]).build() });
}
{
  const q = "Sketch y = 1/x for x > 0 and describe its asymptotes.";
  add({ id: "graph-reciprocal", kind: "graph", question: q, expect: "draw", why: "a window where the stated curve is continuous",
    turnPlan: plan(q, []), problemIR: new IR(q).fact("f1", "y = 1/x").entity("c", "curve", undefined, ["f1"]).fn("e1", "1/x", ["f1"]).intent("graph", ["c"], ["f1"]).build() });
}
{
  const q = "Sketch the graph of y = x^2 + 1.";
  add({ id: "graph-wrong-expression", kind: "graph", question: q, expect: "decline", why: "the ProblemIR expression (x^2) is not the stated equation",
    turnPlan: plan(q, []), problemIR: new IR(q).fact("f1", "y = x^2 + 1").entity("c", "curve", undefined, ["f1"]).fn("e1", "x^2", ["f1"]).intent("graph", ["c"], ["f1"]).build() });
}
{
  const q = "Plot the plane z = x + y and find where it meets the z axis.";
  add({ id: "graph-two-variables", kind: "graph", question: q, expect: "decline", why: "a two-variable expression is not a plotted curve",
    turnPlan: plan(q, []), problemIR: new IR(q).fact("f1", "z = x + y").entity("c", "curve", undefined, ["f1"]).fn("e1", "x+y", ["f1"]).intent("graph", ["c"], ["f1"]).build() });
}
{
  const q = "Sketch y = x^3 - 3x and mark where it decreases.";
  add({ id: "graph-unbound-expression", kind: "graph", question: q, expect: "decline", why: "the expression cites no fact of the curve",
    turnPlan: plan(q, []), problemIR: new IR(q).fact("f1", "y = x^3 - 3x").fact("f2", "Sketch").entity("c", "curve", undefined, ["f2"]).fn("e1", "x^3-3*x", ["f1"]).intent("graph", ["c"], ["f2"]).build() });
}
{
  const q = "Explain exponential decay using N = N0 e^(-kt).";
  add({ id: "graph-conceptual-only", kind: "graph", question: q, expect: "decline", why: "no graph intent and no single-variable expression",
    turnPlan: plan(q, []), problemIR: new IR(q).fact("f1", "N = N0 e^(-kt)").entity("c", "curve", "decay curve", ["f1"]).intent("conceptual", ["c"], ["f1"]).build() });
}

// ---------- withdrawn kinds: a ProblemIR exists, the floor must still decline ----------
const withdrawn: Array<[string, string, string]> = [
  ["withdrawn-projectile-level", "Derive the formula for the range of a projectile on level ground, and show why 45° gives the maximum range.", "projectile"],
  ["withdrawn-projectile-left", "A ball is projected to the left from level ground with a speed of 20 m/s at 30° above the horizontal. Find its range.", "ball"],
  ["withdrawn-projectile-vertical", "A ball is projected from level ground with a speed of 20 m/s at an angle of 30° with the vertical. Find its range.", "ball"],
  ["withdrawn-speed-at-top", "A ball is projected from level ground at 30° above the horizontal. At its highest point its speed is 10 m/s. Find its range.", "ball"],
  ["withdrawn-optics-mixed-units", "An object is placed 0.30 m in front of a concave mirror of focal length 20 cm. Find the image distance.", "object"],
  ["withdrawn-optics-image-distance", "A concave mirror of focal length 10 cm forms a real image 30 cm from the mirror. Find the object distance.", "image"],
  ["withdrawn-optics-image-height", "A convex lens of focal length 20 cm forms an image 3 cm tall of an object placed 30 cm from the lens.", "image"],
  ["withdrawn-optics-radius", "An object is placed 30 cm in front of a concave mirror of radius of curvature 40 cm. Find the image.", "object"],
  ["withdrawn-perpendicular-wires", "Two long straight wires are 10 cm apart and perpendicular to each other, carrying 2 A and 5 A. Find the field midway.", "wire"],
  ["withdrawn-two-charges", "Two point charges of +2 μC and -3 μC are 0.10 m apart. Find the force between them.", "charge"],
  ["withdrawn-circular", "A particle moves anticlockwise around a circle of radius 5 m at a constant speed of 10 m/s. Find its acceleration.", "particle"],
  ["withdrawn-river", "A river 80 m wide flows at 3 m/s. A boat moves at 5 m/s relative to the water. Find the shortest crossing time.", "boat"],
  ["withdrawn-pv-compression", "Explain compression work for a perfect gas on a pressure-volume diagram.", "gas"],
  ["withdrawn-hess-cycle", "Explain Hess's law with an energy cycle for forming carbon dioxide.", "carbon dioxide"],
];
for (const [id, q, noun] of withdrawn) {
  add({ id, kind: "withdrawn", question: q, expect: "decline", why: "this setup has no structure-only floor kind",
    turnPlan: plan(q, []),
    problemIR: new IR(q).fact("f1", q.slice(q.indexOf(noun), q.indexOf(noun) + noun.length)).entity("o", "body", noun, ["f1"])
      .entity("p", "point", undefined, ["f1"]).relate("on1", "incident", ["o", "p"], ["f1"]).intent("conceptual", ["o"], ["f1"]).build() });
}

// ---------- no ProblemIR: no floor ----------
for (const [id, q] of [
  ["unstructured-parallel-circuit", "what is a parallel circuit"],
  ["unstructured-divider", "A 12 V battery and two 3.3 kΩ resistors in series. Find the voltage at the junction."],
  ["unstructured-incline", "A 4 kg block rests on a plane inclined at 25° to the horizontal. Find the friction."],
  ["unstructured-graph", "Sketch y = x^2 and find its minimum."],
] as const) {
  add({ id, kind: "unstructured", question: q, expect: "decline", why: "no ProblemIR, so no floor", turnPlan: plan(q, []), problemIR: null });
}

export const FLOOR_ADVERSARIAL_CASES: readonly FloorCase[] = cases;
