/**
 * The plan reader must not write a value from a chain it is known to misread.
 *
 * Reconcile overwrites a value with the arithmetic it reads in the source text.
 * On these chains that reading can be wrong with no sign of it in the number:
 * - a degree mark outside a trig argument is read as radians (70 became 1.2217);
 * - a unit letter spelled like a bound symbol multiplies (11 A became 132);
 * - a later statement about something else (x took the next quantity's value);
 * - an equation read as equal to its own answer ("2x + 3 = 11, so x = 4" became 0.5).
 * This does not change the reading. Such a chain never writes, and validation
 * refuses the plan unless the reading agrees with the plan's value. So every plan
 * either holds what the reader held before, or is refused. A refused plan still
 * teaches a text lesson, without its figure or number checks. Right plans in these
 * shapes are refused too, and that cost is known.
 *
 * `same`: accepted holding this value, what the reader always did. `refused`: never accepted.
 */
import { reconcileTurnPlanV3ExplicitArithmetic, validateTurnPlanV3 } from "../../src/contracts/contractsV3";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) return;
  failures += 1;
  console.error(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
}

interface Row { source: string; value: number; unit?: string; symbol?: string; givens?: Array<[string, number, string?]> }

const QUESTION = "A synthetic plan reader row.";
function read(row: Row) {
  const raw = {
    schemaVersion: "turn-plan/v3", question: QUESTION,
    givens: (row.givens ?? []).map(([id, value, unit]) => ({ id, symbol: id, value, ...(unit ? { unit } : {}), provenance: "given" })),
    unknowns: [{ id: "target", symbol: "target", ...(row.unit ? { unit: row.unit } : {}) }],
    derived: [{ id: "target", symbol: row.symbol ?? (/^\s*([\p{L}][\p{L}\p{N}_]*)\s*[=≈]/u.exec(row.source)?.[1] ?? "x"), value: row.value, ...(row.unit ? { unit: row.unit } : {}), sourceText: row.source, provenance: "derived" }],
    qualitativeClaims: [], lawIds: ["law"], assumptions: [], visualRequirement: "optional",
  };
  const validated = validateTurnPlanV3(reconcileTurnPlanV3ExplicitArithmetic(raw).plan, QUESTION, { freshFromModel: true });
  return { accepted: validated.valid, final: validated.plan?.derived[0]?.value ?? null, codes: validated.issues.map((issue) => issue.code) };
}
const close = (first: number | null | undefined, second: number) =>
  first !== null && first !== undefined && Math.abs(first - second) <= Math.max(1e-6, Math.abs(second) * 1e-6);
function same(name: string, row: Row, value = row.value): void {
  const result = read(row);
  check(`${name}: ${row.source}`, result.accepted && close(result.final, value), { expected: value, ...result });
}
function refused(name: string, row: Row): void {
  const result = read(row);
  check(`${name}: ${row.source}`, !result.accepted, result);
}

const ANGLES: Array<[string, number, string?]> = [["A", 50, "°"], ["B", 60, "°"]];
const VOLTS: Array<[string, number, string?]> = [["V", 12, "V"]];
const MASS: Array<[string, number, string?]> = [["m", 2, "kg"]];

// A degree mark in arithmetic: refused, right or false, never written.
for (const unit of ["°", "deg", "degrees", "degree"]) {
  refused("right chain", { source: "C = 180° − 50° − 60° = 70°", value: 70, unit, symbol: "C", givens: ANGLES });
  refused("right chain, words", { source: "C = 180 degrees − 50 degrees − 60 degrees = 70 degrees", value: 70, unit, symbol: "C", givens: ANGLES });
  refused("right chain, abbreviation", { source: "C = 180 deg − 110 deg = 70 deg", value: 70, unit, symbol: "C", givens: ANGLES });
  refused("right chain, bound angles", { source: "C = 180° − A − B = 70°", value: 70, unit, symbol: "C", givens: ANGLES });
  refused("false chain", { source: "C = 180° − 50° − 60° = 80°", value: 80, unit, symbol: "C", givens: ANGLES });
  refused("false value on a right chain", { source: "C = 180° − 50° − 60° = 70°", value: 80, unit, symbol: "C", givens: ANGLES });
  refused("right value on a false chain", { source: "C = 180° − 50° − 60° = 80°", value: 70, unit, symbol: "C", givens: ANGLES });
}
for (const [name, source, value, unit] of [
  ["right triangle", "φ = 90° − 22.62° = 67.38°", 67.38, "°"],
  ["division", "x = 360°/5 = 72°", 72, "°"],
  ["bracket", "x = (180° − 50°)/2 = 65°", 65, "°"],
  ["product", "x = 2 × 30° = 60°", 60, "°"],
  ["no spaces", "x = 180°-50°-60° = 70°", 70, "°"],
  ["mark beside trig", "x = 90° × sin(30°) = 45°", 45, "°"],
  ["an arrow to a false value", "θ = 180° − 30° → 5 rad", 5, "rad"],
  ["a semicolon before a false value", "θ = 180° − 30°; 5 rad", 5, "rad"],
  ["a false value repeated from the chain", "s = 6 m × 30°", 6, "m"],
  ["a false value on a radian chain", "θ = 180° − 30° = 2 rad", 2, "rad"],
  ["a mark with its own conversion", "θ = 60° × π/180 = 1.047 rad", 1.047, "rad"],
  ["no unit, false value", "C = 180° − 50°", 99, undefined],
] as const) refused(name, { source, value, ...(unit ? { unit } : {}) });
refused("a bound angle and a mark, in different units", { source: "B = A + 30° = 90°", value: 90, unit: "°", symbol: "B", givens: [["A", 1.0472]] });

// A mark that is not in arithmetic, or is a trig argument, reads as it always did.
same("plain chain", { source: "C = 180 − 50 − 60 = 70°", value: 70, unit: "°", symbol: "C", givens: ANGLES });
same("plain chain corrects a slip", { source: "C = 180 − 50 − 60 = 80°", value: 80, unit: "°", symbol: "C", givens: ANGLES }, 70);
same("trig argument", { source: "F = 10 sin(30°) = 5 N", value: 5, unit: "N", symbol: "F" });
same("bare trig argument", { source: "F = 10 sin 30° = 5 N", value: 5, unit: "N", symbol: "F" });
same("glued trig coefficient", { source: "F = 20sin(37°)", value: 12, unit: "N", symbol: "F" }, 12.0363);
same("glued trig argument", { source: "v0y = 20 sin60° = 10√3 ≈ 17.32", value: 17.32, unit: "m/s", symbol: "v0y" }, 17.320508);
same("inverse trig", { source: "x = arcsin(5/13) ≈ 22.62°", value: 22.61986494804, unit: "°" });
same("inverse trig refines", { source: "x = arctan(5/12) ≈ 22.62°", value: 22.62, unit: "°" }, 22.61986494804);
same("mark minus inverse trig", { source: "x = 90° − arctan(3/4)", value: 53.13010235416, unit: "°" });
same("a mark on a plain value", { source: "x = 30°", value: 30, unit: "°" });
same("radian chain within its precision", { source: "θ = 180° − 30° = 150° = 2.618 rad", value: 2.618, unit: "rad", symbol: "θ" });
same("a ratio of marks", { source: "x = (60°/360°) × 360 = 60°", value: 60, unit: "°" });
same("an unreadable marked left side", { source: "x + 110° = 180° (straight line), so x = 70°", value: 70, unit: "°" });

// Temperatures read as they always did. These are not angles.
for (const [name, source, value, unit] of [
  ["kelvin from celsius", "T1 = 27°C = 300 K", 300, "K"],
  ["kelvin from zero", "T = 0°C = 273 K", 273, "K"],
  ["fahrenheit from celsius", "T = 100°C = 212°F", 212, "°F"],
  ["a celsius chain", "ΔT = 100 °C − 20 °C = 80 °C", 80, "°C"],
] as const) same(name, { source, value, unit, symbol: source.split(" ", 1)[0]!, givens: [["T0", 20, "°C"]] });

// A unit label spelled like a bound quantity: refused unless the reading agrees.
for (const [name, row] of [
  ["recorded shape", { source: "I = 12 V/(12/11) = 11 A", value: 11, unit: "A", symbol: "I", givens: VOLTS }],
  ["glued", { source: "I = 12V/(12/11) = 11 A", value: 11, unit: "A", symbol: "I", givens: VOLTS }],
  ["nothing stated", { source: "I = 12 V/(12/11)", value: 11, unit: "A", symbol: "I", givens: VOLTS }],
  ["false result", { source: "I = 12 V/(12/11) = 99 A", value: 99, unit: "A", symbol: "I", givens: VOLTS }],
  ["false value, nothing stated", { source: "I = 12 V/(12/11)", value: 99, unit: "A", symbol: "I", givens: VOLTS }],
  ["a mass symbol", { source: "a = 3 m × 3 m = 9 m^2", value: 9, unit: "m^2", symbol: "a", givens: MASS }],
  ["a mass symbol, false result", { source: "a = 3 m × 3 m = 12 m^2", value: 12, unit: "m^2", symbol: "a", givens: MASS }],
  ["a label beside a bare number", { source: "y = 3 m + 2 = 5", value: 5, symbol: "y", givens: [["m", 4]] }],
] as Array<[string, Row]>) refused(name, row);
same("a real product with a star", { source: "x = 2 * V = 24 V", value: 24, unit: "V", givens: VOLTS });
same("a real product with a space", { source: "x = 2 V = 24 V", value: 24, unit: "V", givens: VOLTS });
same("friction", { source: "f = 0.2 N = 6.4 N", value: 6.4, unit: "N", symbol: "f", givens: [["N", 32, "N"]] });
same("weight", { source: "W = 2 m g = 40 N", value: 40, unit: "N", symbol: "W", givens: [["m", 2, "kg"], ["g", 10, "m/s^2"]] });
same("symbols alone", { source: "I = V/R = 12/6 = 2 A", value: 2, unit: "A", symbol: "I", givens: [["V", 12, "V"], ["R", 6, "Ω"]] });
same("a volt and ohm quotient, bracketed", { source: "I = 12 V/(12/11 Ω) = 11 A", value: 11, unit: "A", symbol: "I", givens: VOLTS });
same("a volt and ohm sum", { source: "I = 12 V/(2 Ω + 4 Ω) = 2 A", value: 2, unit: "A", symbol: "I", givens: VOLTS });
same("a compound unit beside a mass symbol", { source: "d = 2 m/s × 3 s = 6 m", value: 6, unit: "m", symbol: "d", givens: MASS });
same("a volt and ohm quotient", { source: "I = 12 V/(2 Ω) = 6 A", value: 6, unit: "A", symbol: "I", givens: VOLTS });
same("a product before another symbol corrects a slip", { source: "F = 3 m a = 12 N", value: 12, unit: "N", symbol: "F", givens: [["m", 2, "kg"], ["a", 4, "m/s^2"]] }, 24);

// A later statement about something else never writes, however close it is.
for (const source of [
  "x = 5, SP = 0.96 × 5 = 4.8", "x = 5.0, SP = 0.96 × 5 = 4.8", "x = 5 and SP = 0.96 × 5 = 4.8", "x = 5. SP = 0.96 × 5 = 4.8",
  "x = 18000, SP = 0.9 × 18000 = 16200", "x = 18000, selling price = 0.9 × 18000 = 16200", "x = 18000 so SP = 0.9 × 18000 = 16200", "x = 18000 where SP = 0.9 × 18000 = 16200", "x = 18000. SP = 0.9 × 18000 = 16200",
  "x = 3 × 4 = 12, y = 12 + 1 = 13",
]) {
  const value = Number(/x = (\d+(?:\.\d+)?)/.exec(source)?.[1] ?? 12);
  refused("another statement", { source, value: source.startsWith("x = 3") ? 12 : value });
}
refused("another statement, near y", { source: "x = 8, y = 0.95 × 8 = 7.6", value: 8 });
{
  // A stored plan was accepted when saved. Reopening it does not apply the fresh plan check.
  const stored = { schemaVersion: "turn-plan/v3", question: QUESTION, givens: [], unknowns: [{ id: "C", symbol: "C", unit: "°" }], derived: [{ id: "C", symbol: "C", value: 70, unit: "°", sourceText: "C = 180° − 50° − 60°", provenance: "derived" }], qualitativeClaims: [], lawIds: ["law"], assumptions: [], visualRequirement: "optional" };
  const fresh = validateTurnPlanV3(stored, QUESTION, { freshFromModel: true }).valid;
  const reopened = validateTurnPlanV3(stored, QUESTION);
  check("a stored plan is judged as it was, a fresh one is not", !fresh && reopened.issues.every((issue) => issue.code !== "reading_in_doubt"), { fresh, issues: reopened.issues });
}
same("a chain about the target still refines", { source: "x = 2 × 2.48 = 4.96", value: 5 }, 4.96);
same("a chain about the target still refines decimals", { source: "x = 3 × 1.7321 = 5.1963", value: 5.2 }, 5.1963);
same("a restatement of the target", { source: "x = 2 × 2.48 = 4.96, so x = 4.96", value: 5 }, 4.96);
same("a running value", { source: "v = 0 + 2 × 3 = 6, then v = 6 + 1 × 2 = 8", value: 8, symbol: "v" });
same("a running value after a sentence", { source: "x = 5 + 2 = 7. Then x = 7 + 1 = 8", value: 8 });
same("a reciprocal chain then its answer", { source: "1/v = 1/15 - 1/20 = 1/60, so v = 60", value: 60, symbol: "v" });

// An equation that computes nothing, then its answer: refused, never read against the answer.
refused("equation then answer", { source: "2x + 3 = 11, so x = 4", value: 4 });
refused("equation then a false answer", { source: "2x + 3 = 11, so x = 5", value: 5 });
refused("equation then answer, hence", { source: "3x = 12, hence x = 4", value: 4 });
refused("angle sum then answer", { source: "A + B + C = 180°, so C = 70°", value: 70, unit: "°", symbol: "C", givens: ANGLES });
refused("false answer, unknown on both sides", { source: "5x − 3 = 2x + 9, so x = 5", value: 5 });
same("a power and its root", { source: "x² = 9, so x = 3", value: 3 });
same("factorised roots", { source: "(x − 2)(x − 3) = 0, so x = 2 or x = 3", value: 3 });
same("listed roots", { source: "x = -2 or x = 3", value: 3 });
same("thousands commas", { source: "x = 40,000 × 11/20 = 22,000", value: 22000 });
same("a thousands comma with a unit later", { source: "d = 3 × 1,500 m = 4,500 m", value: 4500, unit: "m", symbol: "d" });

// A plan of several quantities: no refused value may reach a later one.
function chain(rows: Array<{ id: string; value: number; unit?: string; source: string }>, givens: Array<[string, number, string?]> = []) {
  const raw = {
    schemaVersion: "turn-plan/v3", question: QUESTION,
    givens: givens.map(([id, value, unit]) => ({ id, symbol: id, value, ...(unit ? { unit } : {}), provenance: "given" })),
    unknowns: rows.map((row) => ({ id: row.id, symbol: row.id, ...(row.unit ? { unit: row.unit } : {}) })),
    derived: rows.map((row, index) => ({ id: row.id, symbol: row.id, value: row.value, ...(row.unit ? { unit: row.unit } : {}), sourceText: row.source, provenance: "derived", dependsOn: rows.slice(0, index).map((earlier) => earlier.id) })),
    qualitativeClaims: [], lawIds: ["law"], assumptions: [], visualRequirement: "optional",
  };
  const validated = validateTurnPlanV3(reconcileTurnPlanV3ExplicitArithmetic(raw).plan, QUESTION, { freshFromModel: true });
  return { accepted: validated.valid, values: Object.fromEntries((validated.plan?.derived ?? []).map((quantity) => [quantity.id, quantity.value])) };
}
{
  const result = chain([
    { id: "x", value: 5, unit: "m", source: "x = 5 m, y = 0.998 × 5 = 4.99 m" },
    { id: "W", value: 500, unit: "J", source: "W = m × g × x = 2 × 10 × 4.99 = 99.8 J" },
  ], [["m", 2, "kg"], ["g", 10, "m/s^2"]]);
  check("a false value after a refused statement never stands", !result.accepted, result);
}
{
  const result = chain([
    { id: "As", value: 25.7, unit: "cm^2", source: "As = (60°/360°) × π × r^2 = 25.7 cm^2" },
    { id: "At", value: 21.22, unit: "cm^2", source: "At = 0.5 × r^2 × sin(60°) = 21.22 cm^2" },
    { id: "Ag", value: 4.44, unit: "cm^2", source: "Ag = As − At = 4.44 cm^2" },
  ], [["r", 7, "cm"]]);
  check("a rounded sector stays what the reader held", result.accepted && close(result.values.Ag, 4.4387176116), result);
}
{
  const result = chain([
    { id: "L", value: 7.3, unit: "cm", source: "L = (60°/360°) × 2π × r" },
    { id: "P", value: 28.66, unit: "cm", source: "P = 2 × r + L = 14 + 7.33 = 21.33 cm" },
  ], [["r", 7, "cm"]]);
  check("a false value after a rounded arc is corrected", result.accepted && close(result.values.P, 21.330382858376), result);
}

if (failures > 0) {
  console.error(`plan reader false values: ${failures} failed`);
  process.exit(1);
}
console.log("plan reader false values: all rows passed");
