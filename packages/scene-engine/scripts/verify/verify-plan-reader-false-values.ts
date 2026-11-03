/**
 * The plan reader never turns a right value into a false one, and a chain it
 * cannot read two ways at once is refused, not trusted.
 *
 * Reconcile overwrites a value only when the written arithmetic computes it.
 * These rows hold the misreadings that used to overwrite right values:
 * - a degree mark outside a trig argument read as radians (70 became 1.2217);
 * - a unit letter read as the bound symbol of the same name (11 A became 132);
 * - a later statement about something else (x took the next quantity's value);
 * - an equation read as equal to its own answer ("2x + 3 = 11, so x = 4").
 * A result in degrees is now read in degrees. The other shapes are not
 * overwritten: the plan's value stands and validation holds it to the same
 * reading, so a disagreement refuses the plan. Refused is a safe result here,
 * because a refused plan still teaches a text lesson.
 * `stays`: accepted with this value. `refusedOr`: refused, or holding the truth.
 * `refused`: never accepted.
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
    derived: [{ id: "target", symbol: row.symbol ?? row.source.split(/[=≈]/, 1)[0]!.trim().split(/\s+/).at(-1)!, value: row.value, ...(row.unit ? { unit: row.unit } : {}), sourceText: row.source, provenance: "derived" }],
    qualitativeClaims: [], lawIds: ["law"], assumptions: [], visualRequirement: "optional",
  };
  const reconciled = reconcileTurnPlanV3ExplicitArithmetic(raw);
  const validated = validateTurnPlanV3(reconciled.plan, QUESTION);
  const final = validated.plan?.derived[0]?.value ?? null;
  const text = (reconciled.plan as { derived: Array<{ sourceText: string }> }).derived[0]?.sourceText;
  return { accepted: validated.valid, final, text, codes: validated.issues.map((issue) => issue.code) };
}
const close = (first: number | null, second: number) => first !== null && Math.abs(first - second) <= Math.max(1e-6, Math.abs(second) * 1e-6);
/** Accepted, holding exactly this value. */
function stays(name: string, row: Row, value = row.value): void {
  const result = read(row);
  check(`${name}: ${row.source}`, result.accepted && close(result.final, value), { expected: value, ...result });
}
/** Refused, or corrected to the true value. Never accepted with anything else. */
function refusedOr(name: string, row: Row, truth: number): void {
  const result = read(row);
  check(`${name}: ${row.source}`, !result.accepted || close(result.final, truth), { truth, ...result });
}
/** Must be refused outright. */
function refused(name: string, row: Row): void {
  const result = read(row);
  check(`${name}: ${row.source}`, !result.accepted, result);
}

const ANGLES: Array<[string, number, string?]> = [["A", 50, "°"], ["B", 60, "°"]];

// A degree mark outside a trig argument labels the number.
for (const unit of ["°", "deg", "degrees", "degree"]) {
  stays("degree marks", { source: "C = 180° − 50° − 60° = 70°", value: 70, unit, givens: ANGLES });
  stays("degree words", { source: "C = 180 degrees − 50 degrees − 60 degrees = 70 degrees", value: 70, unit, givens: ANGLES });
  stays("degree abbreviation", { source: "C = 180 deg − 110 deg = 70 deg", value: 70, unit, givens: ANGLES });
  stays("marks beside bound angles", { source: "C = 180° − A − B = 70°", value: 70, unit, givens: ANGLES });
  stays("angle sum solved", { source: "A + B + C = 180°, so C = 70°", value: 70, unit, givens: ANGLES });
  stays("plain chain unchanged", { source: "C = 180 − 50 − 60 = 70°", value: 70, unit, givens: ANGLES });
  refusedOr("false chain, marks", { source: "C = 180° − 50° − 60° = 80°", value: 80, unit, givens: ANGLES }, 70);
  refusedOr("false chain, bound", { source: "C = 180° − A − B = 80°", value: 80, unit, givens: ANGLES }, 70);
  refusedOr("false chain, plain", { source: "C = 180 − 50 − 60 = 80°", value: 80, unit, givens: ANGLES }, 70);
  refusedOr("declared differs from a true chain", { source: "C = 180° − 50° − 60° = 70°", value: 80, unit, givens: ANGLES }, 70);
  refused("true value against a false chain", { source: "C = 180° − 50° − 60° = 80°", value: 70, unit, givens: ANGLES });
}
stays("right triangle", { source: "φ = 90° − 22.62° = 67.38°", value: 67.38, unit: "°" });
stays("division in degrees", { source: "x = 360°/5 = 72°", value: 72, unit: "°" });
stays("bracket in degrees", { source: "x = (180° − 50°)/2 = 65°", value: 65, unit: "°" });
stays("product in degrees", { source: "x = 2 × 30° = 60°", value: 60, unit: "°" });
stays("recorded prism shape", { source: "δ = A + B - C = 60° + 60° - 60° = 60°", value: 60, unit: "deg", givens: [["A", 60, "deg"], ["B", 60, "deg"], ["C", 60, "deg"]] });

// Marks inside a trig argument stay angles to convert.
stays("trig argument, target degrees", { source: "x = 90° × sin(30°) = 45°", value: 45, unit: "°" });
stays("bare trig argument, target degrees", { source: "x = 90° × sin 30° = 45°", value: 45, unit: "°" });
stays("nested sum in a trig argument", { source: "x = 90° × cos(30° + 30°) = 45°", value: 45, unit: "°" });
stays("no spaces around signs", { source: "x = 180°-50°-60° = 70°", value: 70, unit: "°" });
stays("two bare trig arguments", { source: "x = 100° × sin 30° cos 60° = 25°", value: 25, unit: "°" });
stays("scaled lengths beside a degree mark", { source: "x = 90° − s/r = 88°", value: 88, unit: "°", givens: [["s", 2, "cm"], ["r", 1, "cm"]] });
stays("scaled lengths of different units", { source: "x = 90° − s/r = 88°", value: 88, unit: "°", givens: [["s", 200, "cm"], ["r", 1, "m"]] });
stays("trig argument, no angle target", { source: "F = 10 sin(30°) = 5 N", value: 5, unit: "N" });
stays("bound angle in trig", { source: "F = 10 sin(A) = 5 N", value: 5, unit: "N", givens: [["A", 30, "°"]] });
stays("inverse trig target", { source: "x = arcsin(5/13) ≈ 22.62°", value: 22.61986494804, unit: "°" });
refusedOr("false trig chain", { source: "F = 10 sin(30°) = 7 N", value: 7, unit: "N" }, 5);

// A result in radians is computed in radians.
stays("radian target", { source: "θ = 180° − 30° = 150° = 2.618 rad", value: 2.617993877991, unit: "rad" });
stays("radian target, no spaces", { source: "θ = 180°-30° = 2.618 rad", value: 2.617993877991, unit: "rad" });
stays("bound radians in trig", { source: "F = 10 sin(B) = 5 N", value: 5, unit: "N", givens: [["B", Math.PI / 6, "rad"]] });
stays("radian target, no restatement", { source: "θ = 180° − 30°", value: 2.617993877991, unit: "rad" });
refusedOr("radian target, bound degrees", { source: "θ = 180° − A = 2.618 rad", value: 2.617993877991, unit: "rad", givens: [["A", 30, "°"]] }, 2.617993877991);
refusedOr("radian target, false chain", { source: "θ = 180° − 30° = 2 rad", value: 2, unit: "rad" }, 2.617993877991);
refusedOr("degree target, bound radians", { source: "x = 90° − B = 45°", value: 45, unit: "°", givens: [["B", Math.PI / 4, "rad"]] }, 45);
refusedOr("π written for a degree result", { source: "x = π/4 = 45°", value: 45, unit: "°" }, 45);
refusedOr("π with no restatement", { source: "x = π/4", value: 45, unit: "°" }, 45);
refusedOr("false π chain", { source: "x = π/4 = 30°", value: 30, unit: "°" }, 45);

// An angle with no declared unit is read by what the chain states.
stays("no unit, degrees stated", { source: "C = 180° − 50° = 130°", value: 130 });
stays("no unit, radians stated", { source: "x = 90° − 30° = 1.0472", value: 1.0472 }, 1.0471975511966);
refusedOr("no unit, nothing stated", { source: "C = 180° − 50°", value: 130 }, 130);
refused("no unit, nothing stated, false value", { source: "C = 180° − 50°", value: 99 });

// Temperatures are not angles.
stays("celsius chain", { source: "ΔT = 100 °C − 20 °C = 80 °C", value: 80, unit: "°C" });
stays("celsius glued", { source: "ΔT = 100°C − 20°C = 80°C", value: 80, unit: "°C" });
refusedOr("celsius, false result", { source: "ΔT = 100°C − 20°C = 70°C", value: 70, unit: "°C" }, 80);
refusedOr("celsius, false result, spaced", { source: "ΔT = 100 °C − 20 °C = 70 °C", value: 70, unit: "°C" }, 80);

// A number then a letter that is also a bound symbol has two readings.
const VOLTS: Array<[string, number, string?]> = [["V", 12, "V"]];
refusedOr("unit label over symbol, recorded shape", { source: "I = 12 V/(12/11) = 11 A", value: 11, unit: "A", givens: VOLTS }, 11);
refusedOr("unit label over symbol, ohm", { source: "I = 12 V/(12/11 Ω) = 11 A", value: 11, unit: "A", givens: VOLTS }, 11);
refusedOr("unit label over symbol, sum", { source: "I = 12 V/(2 Ω + 4 Ω) = 2 A", value: 2, unit: "A", givens: VOLTS }, 2);
refusedOr("unit label, nothing stated", { source: "I = 12 V/(12/11)", value: 11, unit: "A", givens: VOLTS }, 11);
refusedOr("unit label over a mass symbol", { source: "a = 3 m × 3 m = 9 m^2", value: 9, unit: "m^2", givens: [["m", 2, "kg"]] }, 9);
stays("compound unit over a symbol", { source: "d = 2 m/s × 3 s = 6 m", value: 6, unit: "m", givens: [["m", 2, "kg"]] });
refusedOr("glued unit label", { source: "I = 12V/(12/11) = 11 A", value: 11, unit: "A", givens: VOLTS }, 11);
stays("a real product written with a star", { source: "x = 2 * V = 24 V", value: 24, unit: "V", givens: VOLTS });
stays("a real product written with a space", { source: "x = 2 V = 24 V", value: 24, unit: "V", givens: VOLTS });
stays("a real product, friction", { source: "f = 0.2 N = 6.4 N", value: 6.4, unit: "N", givens: [["N", 32, "N"]] });
stays("a real product, weight", { source: "W = 2 m g = 40 N", value: 40, unit: "N", givens: [["m", 2, "kg"], ["g", 10, "m/s^2"]] });
stays("symbols alone", { source: "I = V/R = 12/6 = 2 A", value: 2, unit: "A", givens: [["V", 12, "V"], ["R", 6, "Ω"]] });
refused("false result, volts", { source: "I = 12 V/(12/11) = 99 A", value: 99, unit: "A", givens: VOLTS });
refused("false result, metres", { source: "a = 3 m × 3 m = 12 m^2", value: 12, unit: "m^2", givens: [["m", 2, "kg"]] });
refused("false value, nothing stated", { source: "I = 12 V/(12/11)", value: 99, unit: "A", givens: VOLTS });
refused("right value against a false chain", { source: "I = 12 V/(12/11) = 99 A", value: 11, unit: "A", givens: VOLTS });
refusedOr("false value, true chain", { source: "I = 12 V/(12/11) = 11 A", value: 99, unit: "A", givens: VOLTS }, 11);

// A comma before a new statement ends the one before it.
refusedOr("next quantity after a comma", { source: "x = 23375, SP = 0.9 × 23375 = 21037.5", value: 23375 }, 23375);
refusedOr("words as the next head", { source: "x = 23375, selling price = 0.9 × 23375 = 21037.5", value: 23375 }, 23375);
refusedOr("three statements", { source: "v = 3, t = 2, d = 3 × 2 = 6", value: 6, symbol: "d" }, 6);
refusedOr("own arithmetic first", { source: "x = 3 × 4 = 12, y = 12 + 1 = 13", value: 12 }, 12);
refusedOr("false own arithmetic first", { source: "x = 3 × 4 = 13, y = 13 + 1 = 14", value: 13 }, 12);
refusedOr("a false value before another statement", { source: "x = 3 × 4 = 13, y = 5 + 1 = 6", value: 13 }, 12);
refusedOr("connector and", { source: "x = 23375 and SP = 0.9 × 23375 = 21037.5", value: 23375 }, 23375);
refusedOr("connector so", { source: "x = 23375 so SP = 0.9 × 23375 = 21037.5", value: 23375 }, 23375);
refusedOr("connector where", { source: "x = 23375 where SP = 0.9 × 23375 = 21037.5", value: 23375 }, 23375);
refusedOr("sentence end", { source: "x = 23375. SP = 0.9 × 23375 = 21037.5", value: 23375 }, 23375);
stays("an implicit product is not a new name", { source: "x = 3 SP = 12", value: 12, givens: [["SP", 4]] });
stays("equations then the value", { source: "0.9x = 1.1y and x + y = 42500, so x = 23375", value: 23375 });
refused("declared value against its statement", { source: "x = 23375, SP = 0.9 × 23375 = 21037.5", value: 99 });
refusedOr("declared value against its arithmetic", { source: "x = 3 × 4 = 12, y = 1", value: 13 }, 12);
stays("thousands comma", { source: "x = 42,500 × 11/20 = 23,375", value: 23375 });
stays("comma inside a function", { source: "x = max(2, y = 3) = 3", value: 3 });
stays("coordinates", { source: "P = (2, 3), Q = (4, 5), d = 2 + 2 = 4", value: 4 });
refusedOr("a list of answers says nothing about either", { source: "x = 23375, y = 0.9 × 23375 = 21037.5, x = 21037.5", value: 23375 }, 23375);
stays("roots joined by and", { source: "x = 2 and x = 3", value: 3 });
stays("roots joined by a comma", { source: "x = 2, x = 3", value: 3 });
stays("times joined by and", { source: "t = 2 s and t = 6 s", value: 6, unit: "s" });
refusedOr("a restatement against its own arithmetic", { source: "x = 3 × 4 = 12, x = 13", value: 12 }, 12);
refused("a far restatement against its own arithmetic", { source: "x = 3 × 4 = 12, x = 30", value: 12 });
refusedOr("a false restatement of a true chain", { source: "x = 3 × 4 = 12, x = 13", value: 13 }, 12);
refusedOr("a rough restatement of the result", { source: "T = 2 × 2904.09 = 5808.18, T = 5807.9", value: 5808.18 }, 5808.18);

// Shapes an independent reviewer found against an earlier version of this reader.
// Thousands commas are not boundaries.
stays("thousands with a unit later", { source: "d = 3 × 1,500 m = 4,500 m", value: 4500, unit: "m" });
stays("thousands with a word later", { source: "SP = 0.9 × 1,200 rupees = 1,080 rupees", value: 1080, unit: "rupees" });
stays("thousands in a sum", { source: "T = 500 + 1,500 m = 2,000 m", value: 2000, unit: "m" });
stays("thousands beside a symbol", { source: "W = 2 × 1,000 × g = 20,000 N", value: 20000, unit: "N", givens: [["g", 10, "m/s^2"]] });
stays("thousands in interest", { source: "SI = 12,000 × r × t/100 = 1800", value: 1800, givens: [["r", 5], ["t", 3]] });
stays("thousands converted", { source: "F = 2,000 N = 2 kN", value: 2000, unit: "N" });
// A chain that writes its own angle conversion is not converted twice.
stays("own conversion, bound degrees", { source: "θ = A × π/180 = 0.5236 rad", value: 0.5235987755983, unit: "rad", givens: [["A", 30, "°"]] });
stays("own factor, bound degrees", { source: "θ = A/57.3 = 0.5236 rad", value: 0.5235602094241, unit: "rad", givens: [["A", 30, "°"]] });
stays("own factor, bound radians", { source: "D = B × 57.3 = 60°", value: 60.00456, unit: "°", givens: [["B", 1.0472, "rad"]] });
stays("own conversion, bound radians", { source: "D = B × 180/3.1416", value: 60, unit: "°", givens: [["B", 1.0472, "rad"]] });
refusedOr("own conversion of a mark", { source: "θ = 60° × π/180 = 1.047 rad", value: 1.0471975511966, unit: "rad" }, 1.0471975511966);
refusedOr("own conversion of a mark, no angle result", { source: "s = 10 × 60° × π/180 = 10.47 cm", value: 10.471975511966, unit: "cm" }, 10.471975511966);
// Inverse trig converts its whole member.
stays("mark minus inverse trig", { source: "x = 90° − arctan(3/4)", value: 53.13010235416, unit: "°" });
stays("mark minus inverse trig, stated", { source: "x = 90° − arctan(3/4) = 53.13°", value: 53.13010235416, unit: "°" });
stays("mark minus inverse sine", { source: "θ = 180° − arcsin(0.5)", value: 150, unit: "°" });
// A number before a symbol and another symbol is a product, whatever is claimed for it.
refusedOr("product with a false result, energy", { source: "KE = 0.5 m v^2 = 4.5 J", value: 4.5, unit: "J", givens: [["m", 4, "kg"], ["v", 3, "m/s"]] }, 18);
refusedOr("product with no result, energy", { source: "KE = 0.5 m v^2", value: 4.5, unit: "J", givens: [["m", 4, "kg"], ["v", 3, "m/s"]] }, 18);
refusedOr("product with a false result, force", { source: "F = 3 m a = 12 N", value: 12, unit: "N", givens: [["m", 2, "kg"], ["a", 4, "m/s^2"]] }, 24);
refusedOr("label beside a bare number", { source: "y = 3 m + 2 = 5", value: 5, givens: [["m", 4]] }, 14);
refusedOr("label beside a bare number, length", { source: "y = 3 m + 2 = 5", value: 5, givens: [["m", 4, "m"]] }, 14);
refusedOr("a letter that is another unit", { source: "A = 0.5 × 6 h = 3 cm^2", value: 3, unit: "cm^2", givens: [["h", 5, "cm"]] }, 15);
// A conversion written with 180 is not a multiple of π.
refusedOr("own conversion with a false result", { source: "θ = 1.5 × 180/π = 1.5°", value: 1.5, unit: "°" }, 85.94366926962);
refusedOr("multiple of π", { source: "x = 2π/3 = 120°", value: 120, unit: "°" }, 120);
refusedOr("multiple of π, product", { source: "phase = 2π × 0.25 = 90°", value: 90, unit: "°" }, 90);
// A statement that updates its target supersedes the earlier one.
stays("running value", { source: "v = 0 + 2 × 3 = 6, then v = 6 + 1 × 2 = 8", value: 8 });
stays("running total", { source: "Balance = 100 − 30 = 70, so Balance = 70 + 20 = 90", value: 90 });
refusedOr("running value, false end", { source: "x = 5 + 2 = 7, then x = 7 + 1 = 99", value: 99 }, 8);
// "or" lists answers. Words that are not units do not end a statement.
stays("two roots, first", { source: "x = -2 or x = 3", value: -2 });
stays("two roots, second", { source: "x = -2 or x = 3", value: 3 });
stays("two times", { source: "t = 2 s or t = 6 s", value: 6, unit: "s" });
stays("two roots after a statement", { source: "x² = 9, so x = 3 or x = -3", value: 3, symbol: "x" });
stays("hours to minutes", { source: "t = 2 hours = 120 minutes", value: 120, unit: "minutes" });
stays("kmph to m/s", { source: "v = 36 kmph = 10 m/s", value: 10 });
stays("percent as a word", { source: "r = 8 percent = 0.08", value: 0.08 });
stays("glued product of symbols", { source: "A = 0.5 bh = 12", value: 12, givens: [["b", 4], ["h", 6]] });
stays("double of a named side", { source: "AC = 2 AB = 10", value: 10 });
stays("a label only partly readable", { source: "n = 18 g / 18 g/mol = 1 mol", value: 1, unit: "mol", givens: [["g", 10, "m/s^2"]] });
// Inputs with an angle in their unit stay as declined as they were.
stays("rate in degrees", { source: "θ = ω t = 10°", value: 10, unit: "°", givens: [["ω", 0.5, "°/min"], ["t", 20, "min"]] });
stays("degrees per length", { source: "θ = k d = 20°", value: 20, unit: "°", givens: [["k", 2, "°/cm"], ["d", 10, "cm"]] });

// An equation, then its answer. Read as one chain the left side equals the answer.
stays("equation then answer", { source: "2x + 3 = 11, so x = 4", value: 4, symbol: "x" });
stays("equation then answer, hence", { source: "3x = 12, hence x = 4", value: 4, symbol: "x" });
refusedOr("equation then a false answer", { source: "2x + 3 = 11, so x = 5", value: 5, symbol: "x" }, 4);
refusedOr("angle sum then a false answer", { source: "A + B + C = 180°, so C = 80°", value: 80, unit: "°", givens: ANGLES, symbol: "C" }, 70);
stays("reciprocal chain then its answer", { source: "1/v = 1/15 - 1/20 = 1/60, so v = 60", value: 60, symbol: "v" });
// A restatement or a running value keeps its reading.
refusedOr("restatement with a compound unit", { source: "v = u + a t = 10 + 2 × 5 = 25 m/s, so v = 25 m/s", value: 25, unit: "m/s", givens: [["u", 10, "m/s"], ["a", 2, "m/s^2"], ["t", 5, "s"]] }, 20);
refusedOr("restatement of a false product", { source: "W = F d = 99 J, so W = 99 J", value: 99, unit: "J", givens: [["F", 5, "N"], ["d", 6, "m"]] }, 30);
refusedOr("restatement after a false sum", { source: "x = A + B = 200°, so x = 200°", value: 200, unit: "°", givens: ANGLES }, 110);
stays("running value after a sentence", { source: "x = 5 + 2 = 7. Then x = 7 + 1 = 8", value: 8 });
stays("running value, capital and", { source: "x = 5 + 2 = 7. So x = 7 + 1 = 8", value: 8 });
// π and marks in chains that are right as written.
stays("arc angle with π", { source: "θ = 22/(2π × 7) × 360 = 180°", value: 180, unit: "°" }, 180.07244989826);
stays("one radian in degrees", { source: "θ = 360/(2π) ≈ 57.3°", value: 57.3, unit: "°" }, 57.29577951);
stays("trig mark beside a written conversion", { source: "v = 30 × π/180 × 2 × cos 30° = 0.907 m/s", value: 0.907, unit: "m/s" }, 0.90689968);
stays("sum with trig and a written conversion", { source: "x = sin(30 × π/180) + cos(60°) = 1", value: 1 });
refusedOr("degrees then trig through a no unit angle", { source: "θ = 90° − 30°", value: 60 }, 60);
stays("set notation", { source: "n = {a, b} = 2", value: 2, givens: [["a", 5], ["b", 7]] });
stays("connector in prose", { source: "F = m and a = 6", value: 6, givens: [["m", 2], ["a", 3]] });
refusedOr("two products, false", { source: "P = 2 m + 2 n = 12 m", value: 12, unit: "m", givens: [["m", 3, "m"], ["n", 5, "m"]] }, 16);

if (failures > 0) {
  console.error(`plan reader false values: ${failures} failed`);
  process.exit(1);
}
console.log("plan reader false values: all rows passed");
