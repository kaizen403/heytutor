/**
 * Numeric authority for plain-English resistor circuits.
 *
 * The exact dc_network solver only admits formal assertion documents, so an
 * ordinary stem ("Three resistors of 2 Ω, 3 Ω and 6 Ω in parallel across a
 * 6 V battery") reached the teaching stream with whatever current the planner
 * model wrote. Here the circuit the resistor_network archetype draws for the
 * stem (read without the turn plan, so no model scalar feeds it) is solved by
 * exact nodal analysis, and the turn plan's circuit quantities are checked
 * against that solution. Only a value whose symbol binds without doubt to a
 * drawn quantity (I_2, R_eq, I_total, emf) is corrected; an unbound value is
 * kept only when it equals some recomputed value of its class. The archetype draws only arrangements the stem fixes, so
 * a grouping it cannot read, or a source with internal resistance, gets no
 * figure and no authority at all.
 */
import { attemptArchetypeScene } from "../archetypes";
import { numbersWithUnit, UNIT } from "../archetypes/slots";
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";

type Rational = { n: bigint; d: bigint };

export interface CircuitValue {
  exact: string;
  value: number;
}

export interface StatedCircuitResistor {
  /** Figure id and label, R1… in stem order (R when there is one). */
  id: string;
  name: string;
  resistance: CircuitValue;
  current?: CircuitValue;
  voltage?: CircuitValue;
  power?: CircuitValue;
}

export interface StatedCircuitSolution {
  /** Archetype figure this solution belongs to. */
  topology: string;
  equivalentResistance: CircuitValue;
  sourceVoltage?: CircuitValue;
  /** Current leaving the source's positive plate. */
  sourceCurrent?: CircuitValue;
  resistors: StatedCircuitResistor[];
  ammeter?: CircuitValue;
  voltmeter?: CircuitValue;
  power?: CircuitValue;
}

export interface CircuitAuthorityIssue {
  code: "circuit_value_corrected" | "circuit_value_unbound" | "circuit_value_withdrawn" | "circuit_given_conflict" | "circuit_value_added";
  quantityId: string;
  message: string;
}

export interface CircuitAuthorityResult {
  plan: TurnPlanV3;
  solution: StatedCircuitSolution;
  issues: CircuitAuthorityIssue[];
}

const ZERO: Rational = { n: 0n, d: 1n };
const ONE: Rational = { n: 1n, d: 1n };

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
function rational(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new Error("zero denominator");
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(n, d) || 1n;
  return { n: n / divisor, d: d / divisor };
}
const add = (a: Rational, b: Rational): Rational => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational): Rational => add(a, { n: -b.n, d: b.d });
const mul = (a: Rational, b: Rational): Rational => rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational): Rational => rational(a.n * b.d, a.d * b.n);

/** Stem decimals are exact: 0.5 is 1/2, not a float. */
function decimal(value: number): Rational {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`unsupported literal ${text}`);
  const fraction = match[3] ?? "";
  return rational(BigInt(`${match[1]}${match[2]}${fraction}`), 10n ** BigInt(fraction.length));
}
function out(value: Rational): CircuitValue {
  return { exact: value.d === 1n ? String(value.n) : `${value.n}/${value.d}`, value: Number(value.n) / Number(value.d) };
}

type Branch = { id: string; kind: "resistor" | "source" | "wire" | "open"; from: string; to: string; value: Rational };

/**
 * Exact modified nodal analysis of the drawn netlist. Wires and ammeters are
 * zero-volt branches, a voltmeter is an open branch, the source fixes
 * V(start) - V(end) (its long plate is drawn at the start).
 */
function solveNetlist(nodes: string[], branches: Branch[]): { potentials: Map<string, Rational>; currents: Map<string, Rational> } {
  const reference = nodes[0]!;
  const free = nodes.filter((id) => id !== reference);
  const fixed = branches.filter((branch) => branch.kind === "source" || branch.kind === "wire");
  const size = free.length + fixed.length;
  const rows = Array.from({ length: size }, () => Array.from({ length: size + 1 }, () => ZERO));
  const index = new Map(free.map((id, position) => [id, position]));
  const stamp = (row: number | undefined, column: number | undefined, value: Rational): void => {
    if (row !== undefined && column !== undefined) rows[row]![column] = add(rows[row]![column]!, value);
  };
  for (const branch of branches) {
    const from = index.get(branch.from);
    const to = index.get(branch.to);
    if (branch.kind === "resistor") {
      const g = div(ONE, branch.value);
      stamp(from, from, g); stamp(to, to, g);
      stamp(from, to, { n: -g.n, d: g.d }); stamp(to, from, { n: -g.n, d: g.d });
    } else if (branch.kind !== "open") {
      const row = free.length + fixed.indexOf(branch);
      stamp(from, row, ONE); stamp(to, row, { n: -1n, d: 1n });
      stamp(row, from, ONE); stamp(row, to, { n: -1n, d: 1n });
      stamp(row, size, branch.value);
    }
  }
  for (let column = 0, rank = 0; column < size; column += 1) {
    const pivot = rows.findIndex((row, position) => position >= rank && row[column]!.n !== 0n);
    if (pivot < 0) throw new Error("circuit is underdetermined");
    [rows[rank], rows[pivot]] = [rows[pivot]!, rows[rank]!];
    const divisor = rows[rank]![column]!;
    rows[rank] = rows[rank]!.map((value) => div(value, divisor));
    for (let other = 0; other < size; other += 1) {
      if (other === rank || rows[other]![column]!.n === 0n) continue;
      const factor = rows[other]![column]!;
      rows[other] = rows[other]!.map((value, position) => sub(value, mul(factor, rows[rank]![position]!)));
    }
    rank += 1;
  }
  const potentials = new Map<string, Rational>([[reference, ZERO], ...free.map((id, position): [string, Rational] => [id, rows[position]![size]!])]);
  const currents = new Map<string, Rational>();
  for (const branch of branches) {
    const drop = sub(potentials.get(branch.from)!, potentials.get(branch.to)!);
    currents.set(branch.id, branch.kind === "resistor" ? div(drop, branch.value)
      : branch.kind === "open" ? ZERO
        : rows[free.length + fixed.indexOf(branch)]![size]!);
  }
  return { potentials, currents };
}

/**
 * Solve the resistor circuit the archetype draws for this stem, or null when
 * no resistor_network figure is drawn (the archetype declined or another
 * figure owns the stem). Read from the stem alone.
 */
export function solveStatedResistorCircuit(question: string): StatedCircuitSolution | null {
  const attempt = attemptArchetypeScene({ question, turnPlan: null });
  if (attempt.scene?.archetype !== "resistor_network") return null;
  const { document } = attempt.scene;
  const slots = attempt.match!.slots;
  const values = Array.isArray(slots.resistors) ? (slots.resistors as unknown[]).filter((item): item is number => typeof item === "number") : [];
  const symbols = document.constructions.filter((construction) => construction.operator === "symbol");
  const resistorSymbols = symbols.filter((construction) => construction.inputs.symbol === "resistor");
  if (resistorSymbols.length === 0 || values.length !== resistorSymbols.length) return null;
  const emf = attempt.match!.sources.emf === "stem" && typeof slots.emf === "number" ? decimal(slots.emf) : null;
  const battery = symbols.find((construction) => construction.inputs.symbol === "battery");
  const nodes = document.constructions.filter((construction) => construction.operator === "point").map((construction) => construction.outputs[0]!);
  const branches: Branch[] = [];
  resistorSymbols.forEach((construction, position) => branches.push({
    id: construction.outputs[0]!, kind: "resistor", from: String(construction.inputs.start), to: String(construction.inputs.end), value: decimal(values[position]!),
  }));
  for (const construction of symbols) {
    const symbol = construction.inputs.symbol;
    if (symbol === "resistor" || symbol === "battery") continue;
    if (symbol !== "ammeter" && symbol !== "voltmeter") return null;
    branches.push({ id: construction.outputs[0]!, kind: symbol === "ammeter" ? "wire" : "open", from: String(construction.inputs.start), to: String(construction.inputs.end), value: ZERO });
  }
  for (const construction of document.constructions.filter((item) => item.operator === "connect")) {
    branches.push({ id: construction.outputs[0]!, kind: "wire", from: String(construction.inputs.start), to: String(construction.inputs.end), value: ZERO });
  }
  // The source drives the drawn loop. Without a stated voltage a unit source
  // still fixes the equivalent resistance; without any source a stated
  // current through one resistor fixes its voltage.
  const drive = emf ?? ONE;
  let ends: [string, string];
  if (battery) {
    branches.push({ id: battery.outputs[0]!, kind: "source", from: String(battery.inputs.start), to: String(battery.inputs.end), value: drive });
    ends = [String(battery.inputs.start), String(battery.inputs.end)];
  } else {
    // No source drawn: probe between the network's outer terminals.
    const first = resistorSymbols[0]!;
    const last = resistorSymbols.at(-1)!;
    ends = [String(first.inputs.start), String(last.inputs.end)];
    branches.push({ id: "probe", kind: "source", from: ends[0], to: ends[1], value: ONE });
  }
  const used = new Set(branches.flatMap((branch) => [branch.from, branch.to]));
  const solved = solveNetlist(nodes.filter((id) => used.has(id)), branches);
  const sourceId = battery ? battery.outputs[0]! : "probe";
  // Current out of the positive plate is the negative of the branch current
  // the nodal system assigns from start to end through the source.
  const sourceCurrent = { n: -solved.currents.get(sourceId)!.n, d: solved.currents.get(sourceId)!.d };
  if (sourceCurrent.n <= 0n) return null;
  const equivalentResistance = div(drive, sourceCurrent);
  const known = Boolean(battery && emf);
  const statedCurrent = !battery && resistorSymbols.length === 1 ? numbersWithUnit(question, UNIT.ampere) : [];
  const singleCurrent = statedCurrent.length === 1 ? decimal(statedCurrent[0]!) : null;
  const scale = known ? ONE : singleCurrent ? div(singleCurrent, sourceCurrent) : null;
  const resistors: StatedCircuitResistor[] = resistorSymbols.map((construction, position) => {
    const id = construction.outputs[0]!;
    const current = solved.currents.get(id)!;
    const branch = branches.find((item) => item.id === id)!;
    return {
      id,
      name: resistorSymbols.length === 1 ? "R" : `R${position + 1}`,
      resistance: out(branch.value),
      ...(scale ? {
        current: out(mul(current, scale)),
        voltage: out(mul(mul(current, branch.value), scale)),
        power: out(mul(mul(mul(current, scale), mul(current, scale)), branch.value)),
      } : {}),
    };
  });
  const meter = (symbol: string): CircuitValue | undefined => {
    if (!scale) return undefined;
    const construction = symbols.find((item) => item.inputs.symbol === symbol);
    if (!construction) return undefined;
    if (symbol === "ammeter") return out(mul(solved.currents.get(construction.outputs[0]!)!, scale));
    const drop = sub(solved.potentials.get(String(construction.inputs.start))!, solved.potentials.get(String(construction.inputs.end))!);
    return out(mul(drop, scale));
  };
  const sourceVoltage = known ? drive : singleCurrent ? mul(singleCurrent, equivalentResistance) : null;
  const totalCurrent = known ? sourceCurrent : singleCurrent;
  const ammeter = meter("ammeter");
  const voltmeter = meter("voltmeter");
  return {
    topology: String(slots.topology ?? "series"),
    equivalentResistance: out(equivalentResistance),
    ...(sourceVoltage ? { sourceVoltage: out(sourceVoltage) } : {}),
    ...(totalCurrent ? { sourceCurrent: out(totalCurrent) } : {}),
    resistors,
    ...(ammeter ? { ammeter: { ...ammeter, value: Math.abs(ammeter.value), exact: ammeter.exact.replace(/^-/, "") } } : {}),
    ...(voltmeter ? { voltmeter: { ...voltmeter, value: Math.abs(voltmeter.value), exact: voltmeter.exact.replace(/^-/, "") } } : {}),
    ...(sourceVoltage && totalCurrent ? { power: out(mul(sourceVoltage, totalCurrent)) } : {}),
  };
}

type Dimension = "current" | "voltage" | "resistance" | "power";

const UNIT_SCALE: Record<string, [Dimension, number]> = {
  a: ["current", 1], amp: ["current", 1], ampere: ["current", 1], amperes: ["current", 1], ma: ["current", 1e-3], ua: ["current", 1e-6], "µa": ["current", 1e-6],
  v: ["voltage", 1], volt: ["voltage", 1], volts: ["voltage", 1], mv: ["voltage", 1e-3], kv: ["voltage", 1e3],
  ohm: ["resistance", 1], ohms: ["resistance", 1], "ω": ["resistance", 1], kohm: ["resistance", 1e3], "kω": ["resistance", 1e3], mohm: ["resistance", 1e6], "mω": ["resistance", 1e6],
  w: ["power", 1], watt: ["power", 1], watts: ["power", 1], mw: ["power", 1e-3], kw: ["power", 1e3],
};

function dimensionOf(unit: string | undefined): [Dimension, number] | null {
  if (!unit) return null;
  const key = unit.trim().replace(/\s+/g, "");
  // "MΩ" and "mΩ" differ only by case; Ω units keep their prefix case.
  if (key === "MΩ") return ["resistance", 1e6];
  return UNIT_SCALE[key.toLowerCase()] ?? null;
}

/**
 * The drawn quantity a plan symbol binds to without doubt, or undefined.
 * Bound: I_2 / V_2 / R_2 (the figure's R2), I_A and V_V (the meters),
 * R_eq / R_total, I_total / I_source / I_main, E / ε / emf / V_source, P_total,
 * and a bare I only where one current flows through every part. A bare V, a
 * bare R or P in a multi-resistor circuit, or any other name is not bound:
 * "V" may be a terminal voltage, a drop across one part, or the source.
 */
function boundValue(solution: StatedCircuitSolution, dimension: Dimension, symbol: string): CircuitValue | undefined {
  const key = symbol.normalize("NFKC").replace(/\\(?:mathrm|text|operatorname)\s*/g, "").replace(/[{}\\\s]/g, "");
  const single = solution.resistors.length === 1;
  const oneLoop = single || solution.topology === "series";
  const part = /^([IVR])_?R?_?(\d)$/i.exec(key);
  if (part) {
    const resistor = solution.resistors[Number(part[2]) - 1];
    const letter = part[1]!.toUpperCase();
    if (!resistor) return undefined;
    if (dimension === "current" && letter === "I") return resistor.current;
    if (dimension === "voltage" && letter === "V") return resistor.voltage;
    if (dimension === "resistance" && letter === "R") return resistor.resistance;
    return undefined;
  }
  if (dimension === "current" && /^I_?A$|^I_?ammeter$|^ammeter/i.test(key)) return solution.ammeter;
  if (dimension === "voltage" && /^V_?V$|^V_?voltmeter$|^voltmeter/i.test(key)) return solution.voltmeter;
  if (dimension === "resistance") {
    if (/^R_?(?:eq|equiv|equivalent|total|tot|net|eff|effective)$/i.test(key)) return solution.equivalentResistance;
    return single && /^R$/.test(key) ? solution.resistors[0]!.resistance : undefined;
  }
  if (dimension === "current") {
    if (/^I_?(?:total|tot|net|main|source|src|battery|cell|drawn)$/i.test(key)) return solution.sourceCurrent;
    return oneLoop && /^I$/.test(key) ? solution.sourceCurrent : undefined;
  }
  if (dimension === "voltage") {
    return /^(?:E|ε|emf|EMF|V_?(?:emf|source|src|battery|cell|supply))$/.test(key) ? solution.sourceVoltage : undefined;
  }
  return /^P_?(?:total|tot|net|source|battery|supplied)$/i.test(key) || (single && /^P$/.test(key)) ? solution.power : undefined;
}

/**
 * The one drawn quantity each question asks for, by class. "Find the current
 * drawn from the battery" asks for the source current, not any current;
 * "the potential difference across the 6 Ω resistor" for that resistor's
 * drop when exactly one drawn resistor has that value. A class asked twice,
 * or asked in words this does not read, is absent.
 */
function askedQuantities(question: string, solution: StatedCircuitSolution): Map<Dimension, CircuitValue> {
  const asked = new Map<Dimension, CircuitValue | null>();
  const ask = (dimension: Dimension, value: CircuitValue | undefined): void => {
    if (!value) return;
    asked.set(dimension, asked.has(dimension) ? null : value);
  };
  const stem = question.replace(/\s+/g, " ");
  const request = /\b(?:find|calculate|compute|determine|what is|how much|obtain)\b(.*)$/i.exec(stem)?.[1] ?? "";
  const byValue = (raw: string): StatedCircuitResistor | undefined => {
    const value = Number(raw);
    const matches = solution.resistors.filter((resistor) => resistor.resistance.value === value);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const OHM = String.raw`(\d+(?:\.\d+)?)\s*(?:Ω|ohms?)(?![A-Za-z0-9])`;
  for (const match of request.matchAll(new RegExp(String.raw`\b(current|potential difference|p\.?d\.?|voltage|power)\s+(?:through|across|in|dissipated in|of)\s+(?:the\s+)?${OHM}\s+resistor`, "gi"))) {
    const resistor = byValue(match[2]!);
    const word = match[1]!.toLowerCase();
    if (!resistor) continue;
    if (word === "current") ask("current", resistor.current);
    else if (word === "power") ask("power", resistor.power);
    else ask("voltage", resistor.voltage);
  }
  if (/\b(?:current|amount of current)\s+(?:drawn|supplied|delivered|taken)\s+(?:from|by)\s+(?:the\s+)?(?:battery|cell|source|supply)\b|\btotal current\b|\bcurrent (?:from|through|in) the (?:battery|cell|source|supply|main line|main circuit)\b/i.test(request)
    || (solution.topology === "series" && /\bcurrent in the circuit\b/i.test(request))) ask("current", solution.sourceCurrent);
  if (/\b(?:equivalent|total|effective|net) resistance\b/i.test(request)) ask("resistance", solution.equivalentResistance);
  if (/\btotal power\b|\bpower (?:drawn|supplied|delivered|taken)\b/i.test(request)) ask("power", solution.power);
  if (/\bammeter\b/i.test(request) && /\breading|reads?\b/i.test(request)) ask("current", solution.ammeter);
  if (/\bvoltmeter\b/i.test(request) && /\breading|reads?\b/i.test(request)) ask("voltage", solution.voltmeter);
  return new Map([...asked].filter((entry): entry is [Dimension, CircuitValue] => entry[1] !== null));
}

/** Every value of one class the drawn circuit recomputes: each part, the whole, the meters. */
function recomputedValues(solution: StatedCircuitSolution, dimension: Dimension): number[] {
  const parts = solution.resistors.map((resistor) => dimension === "current" ? resistor.current
    : dimension === "voltage" ? resistor.voltage : dimension === "resistance" ? resistor.resistance : resistor.power);
  const whole = dimension === "current" ? [solution.sourceCurrent, solution.ammeter]
    : dimension === "voltage" ? [solution.sourceVoltage, solution.voltmeter]
      : dimension === "resistance" ? [solution.equivalentResistance] : [solution.power];
  return [...parts, ...whole].filter((value): value is CircuitValue => Boolean(value)).map((value) => value.value);
}

/**
 * `stated` agrees with `solved` when equal, or when it is `solved` rounded to
 * the decimals it was written with and still carries two significant figures
 * (0.67 for 2/3 agrees; 1 for 2/3 does not).
 */
function close(solved: number, stated: number): boolean {
  if (Math.abs(solved - stated) <= 1e-9 * Math.max(1, Math.abs(solved), Math.abs(stated))) return true;
  const decimals = (String(stated).split(".")[1] ?? "").length;
  const significant = String(Math.abs(stated)).replace(".", "").replace(/^0+/, "").length;
  return significant >= 2 && Number(solved.toFixed(decimals)) === stated;
}

function fmt(value: number): string {
  return String(Number(value.toPrecision(6)));
}

/**
 * Check the turn plan's circuit quantities against the drawn circuit's exact
 * solution. Givens must be stated values; a derived value whose symbol binds
 * to a drawn quantity is corrected to it; an unbound value of a recomputed
 * class (current, voltage, resistance, power) stands only if it equals one of
 * the recomputed values, and is withdrawn otherwise. A pure function: the
 * plan in, the checked plan and its issues out.
 * The source current and equivalent resistance (and any meter
 * readings) are added when the plan lacks them, so the teaching stream always
 * holds the solved values. Null when the stem is not a drawn resistor circuit.
 */
export function applyStatedCircuitAuthority(question: string, plan: TurnPlanV3): CircuitAuthorityResult | null {
  const solution = solveStatedResistorCircuit(question);
  if (!solution) return null;
  const issues: CircuitAuthorityIssue[] = [];
  const stated = new Map<Dimension, number[]>([
    ["resistance", solution.resistors.map((resistor) => resistor.resistance.value)],
    ["voltage", solution.sourceVoltage && !/\bcurrent of\b/i.test(question) ? [solution.sourceVoltage.value] : []],
    ["current", numbersWithUnit(question, UNIT.ampere)],
  ]);
  const givens = plan.givens.filter((quantity) => {
    const dimension = dimensionOf(quantity.unit);
    if (!dimension || dimension[0] === "power") return true;
    const allowed = stated.get(dimension[0]) ?? [];
    if (allowed.some((value) => close(value, quantity.value * dimension[1]))) return true;
    issues.push({ code: "circuit_given_conflict", quantityId: quantity.id, message: `given ${quantity.symbol}=${quantity.value} ${quantity.unit} is not a value the stem states` });
    return false;
  });
  // The plan's requested unknown of an asked class is the answer to that ask:
  // it binds to the asked quantity even under a bare symbol, so a value that
  // equals some other quantity of the class (a branch current for the battery
  // current) is corrected rather than kept.
  const asked = askedQuantities(question, solution);
  const answerOf = new Map<string, CircuitValue>();
  for (const [dimension, value] of asked) {
    const answers = plan.unknowns.filter((unknown) => dimensionOf(unknown.unit)?.[0] === dimension
      || (unknown.unit === undefined && plan.derived.some((quantity) => quantity.id === unknown.id && dimensionOf(quantity.unit)?.[0] === dimension)));
    if (answers.length === 1) answerOf.set(answers[0]!.id, value);
  }
  const derived: TurnPlanQuantityV3[] = [];
  for (const quantity of plan.derived) {
    const dimension = dimensionOf(quantity.unit);
    if (!dimension) {
      derived.push(quantity);
      continue;
    }
    // A symbol bound without doubt to a drawn quantity is corrected to it; an
    // unbound one stands only if it equals a recomputed value of its class.
    const target = boundValue(solution, dimension[0], quantity.symbol) ?? answerOf.get(quantity.id);
    if (!target) {
      // Unbound but of a class the circuit recomputes: it stands only if it is
      // one of the recomputed values; otherwise it is a number the drawn
      // circuit does not have, and it is withdrawn rather than spoken.
      const recomputed = recomputedValues(solution, dimension[0]);
      if (recomputed.length === 0 || recomputed.some((value) => close(value, quantity.value * dimension[1]))) {
        derived.push(quantity);
        issues.push({ code: "circuit_value_unbound", quantityId: quantity.id, message: `${quantity.symbol} binds to no single drawn quantity but equals a recomputed one; left unchanged` });
      } else {
        issues.push({ code: "circuit_value_withdrawn", quantityId: quantity.id, message: `${quantity.symbol}=${quantity.value} ${quantity.unit} equals no recomputed ${dimension[0]} of the drawn circuit` });
      }
      continue;
    }
    const value = target.value / dimension[1];
    if (close(value, quantity.value)) {
      derived.push(quantity);
      continue;
    }
    issues.push({ code: "circuit_value_corrected", quantityId: quantity.id, message: `${quantity.symbol}: ${quantity.value} -> ${fmt(value)} ${quantity.unit}` });
    derived.push({ ...quantity, value: Number(fmt(value)), sourceText: `Circuit-verified ${quantity.symbol} = ${fmt(value)} ${quantity.unit}` });
  }
  const present = (dimension: Dimension, value: number): boolean =>
    [...givens, ...derived].some((quantity) => {
      const unit = dimensionOf(quantity.unit);
      return unit?.[0] === dimension && close(value, quantity.value * unit[1]);
    });
  const additions: Array<[string, string, CircuitValue | undefined, Dimension, string]> = [
    ["circuit_I", "I_total", solution.sourceCurrent, "current", "A"],
    ["circuit_R_eq", "R_eq", solution.resistors.length > 1 ? solution.equivalentResistance : undefined, "resistance", "Ω"],
    ["circuit_ammeter", "I_A", solution.ammeter, "current", "A"],
    ["circuit_voltmeter", "V_V", solution.voltmeter, "voltage", "V"],
    ["circuit_P", "P_total", /\bpower\b/i.test(question) ? solution.power : undefined, "power", "W"],
  ];
  for (const [id, symbol, value, dimension, unit] of additions) {
    if (!value || present(dimension, value.value) || [...givens, ...derived].some((quantity) => quantity.id === id)) continue;
    derived.push({ id, symbol, value: Number(fmt(value.value)), unit, provenance: "derived", sourceText: `Circuit-verified ${symbol} = ${fmt(value.value)} ${unit}` });
    issues.push({ code: "circuit_value_added", quantityId: id, message: `${symbol} = ${fmt(value.value)} ${unit}` });
  }
  const derivedIds = new Set(derived.map((quantity) => quantity.id));
  const givenIds = new Set(givens.map((quantity) => quantity.id));
  const unknowns = plan.unknowns.filter((unknown) => derivedIds.has(unknown.id) || givenIds.has(unknown.id) || !dimensionOf(unknown.unit));
  return { plan: { ...plan, givens, derived, unknowns }, solution, issues };
}
