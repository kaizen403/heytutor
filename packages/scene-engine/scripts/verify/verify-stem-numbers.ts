/**
 * Stem number reader regression gate (integrator owned, 4 Oct 2026).
 *
 * The archetype slot readers once read the denominator of "1/2 m/s^2" as an
 * acceleration of 2, which drew an exact SUVAT figure with v = 12 instead of 6.
 * A fraction, a mixed number or a vulgar fraction must read as its value; a
 * number inside another token (a denominator, an exponent, a subscript) must
 * never be read as a value of its own.
 */
import assert from "node:assert/strict";
import {
  UNIT,
  firstNumberWithUnit,
  lengthAfterInCm,
  numberAfter,
  numberBefore,
  numbersWithUnit,
  parseStemNumber,
  prepareStem,
  STEM_NUMBER,
  TUPLE_COMPONENT_NUMBER,
} from "../../src/archetypes/slots";

let checks = 0;
function same(actual: unknown, expected: unknown, label: string): void {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

const withUnit: [string, RegExp, number[]][] = [
  // Fractions and mixed numbers read as their value.
  ["accelerates uniformly at 1/2 m/s^2 for 4 s", UNIT.accel, [0.5]],
  ["a circle of radius 1/2 m", UNIT.metre, [0.5]],
  ["a uniform speed of 1/2 m/s", UNIT.speed, [0.5]],
  ["for 1 1/2 s", UNIT.second, [1.5]],
  ["a speed of 3 / 4 m/s", UNIT.speed, [0.75]],
  ["a rod of ½ m", UNIT.metre, [0.5]],
  ["after 2½ s", UNIT.second, [2.5]],
  ["a retardation of -1/2 m/s^2", UNIT.accel, [-0.5]],
  // A zero denominator is not a value.
  ["a speed of 3/0 m/s", UNIT.speed, []],
  // Ordinary values are unchanged.
  ["moving at 10 m/s accelerates at 2 m/s^2 for 4 s", UNIT.speed, [10]],
  ["moving at 10 m/s accelerates at 2 m/s^2 for 4 s", UNIT.accel, [2]],
  ["moving at 10 m/s accelerates at 2 m/s^2 for 4 s", UNIT.second, [4]],
  ["a height of 1.5 m and 20 m", UNIT.metre, [1.5, 20]],
  ["a distance of 2 x 10^3 m", UNIT.metre, [2000]],
  ["a distance of 2×10^-3 m", UNIT.metre, [0.002]],
  ["a charge of 3e-6 C", UNIT.coulomb, [3e-6]],
  ["angles 30° and 45 degrees", UNIT.degree, [30, 45]],
  ["a 12 V battery and a 6 Ω resistor", UNIT.ohm, [6]],
  // A number inside another token is never a value of its own.
  ["an acceleration of 2 m/s^2 s", UNIT.second, []],
  ["R1 2 Ω", UNIT.ohm, [2]],
  ["x2 m", UNIT.metre, []],
  ["10.5 s", UNIT.second, [10.5]],
];
for (const [stem, unit, expected] of withUnit) {
  same(numbersWithUnit(prepareStem(stem), unit), expected, `numbersWithUnit(${JSON.stringify(stem)})`);
}

same(firstNumberWithUnit("a cart at 4 m/s with 1/2 m/s^2", UNIT.accel), 0.5, "firstNumberWithUnit fraction");
same(numberAfter("acceleration of 1/2 m/s^2", /acceleration/), 0.5, "numberAfter fraction");
same(numberAfter("acceleration of 1 1/2 m/s^2", /acceleration/), 1.5, "numberAfter mixed number");
same(numberAfter("focal length 10", /focal length/), 10, "numberAfter plain");
same(numberBefore("1/2 m from the mirror", /m from the mirror/), 0.5, "numberBefore fraction");
same(numberBefore("an object 30 cm from a mirror", /cm from a mirror/), 30, "numberBefore plain");
same(lengthAfterInCm("focal length of 1/2 m", /focal length/), 50, "lengthAfterInCm fraction");
same(lengthAfterInCm("object distance is 0.2 m", /object distance/), 20, "lengthAfterInCm decimal");
// A full stop or comma after a number ends it; it is not a decimal point.
same(numberAfter("The refractive index of glass is 1.5.", /refractive index of glass is/), 1.5, "numberAfter sentence end");
same(numberAfter("The refractive index is 2. Find", /refractive index is/), 2, "numberAfter integer sentence end");
same(numbersWithUnit("Angles are 30°, 45°.", UNIT.degree), [30, 45], "numbersWithUnit comma and full stop");

// Thousands separators (shared fix, 4 Oct 2026): "1,000 m" once read as 0.
// A comma and exactly three digits with no space groups a number; a bracket
// holding only the grouped literal is ambiguous with a coordinate pair and
// reads as nothing; any other comma between digits is a list.
const grouped: [string, RegExp, number[]][] = [
  ["a track of 1,000 m", UNIT.metre, [1000]],
  ["a mass of 12,500.5 kg", UNIT.kilogram, [12500.5]],
  ["a distance of 1,000,000 m", UNIT.metre, [1000000]],
  ["a depth of -1,250 m", UNIT.metre, [-1250]],
  ["a car covers 1,000 m.", UNIT.metre, [1000]],
  ["it runs 2,500 m, then 300 m.", UNIT.metre, [2500, 300]],
  ["a span (1,000 m) wide", UNIT.metre, [1000]],
  // Ambiguous with a coordinate pair: neither 1 nor 0 nor 1000.
  ["the point (1,000) m", UNIT.metre, []],
  ["the entry [2,000] m", UNIT.metre, []],
  // Lists: parts read separately, never as a grouped number.
  ["values 2,3 m", UNIT.metre, [3]],
  ["values 12,34 m", UNIT.metre, [34]],
  ["values 1, 000 m", UNIT.metre, [0]],
  // A malformed group is not a number, and not its tail either.
  ["a length of 1,0000 m", UNIT.metre, []],
  // A numeric tuple in brackets reads nothing: never 1500 and 2 (reviewer, 565386b8).
  ["the point (1,500,2) m", UNIT.metre, []],
  ["the point (2,3) m", UNIT.metre, []],
];
for (const [stem, unit, expected] of grouped) {
  same(numbersWithUnit(prepareStem(stem), unit), expected, `numbersWithUnit(${JSON.stringify(stem)})`);
}
same(numberAfter("The distance is 1,000.", /distance is/), 1000, "numberAfter grouped sentence end");
same(numberAfter("The distance is 1,000. Then it stops", /distance is/), 1000, "numberAfter grouped full stop mid text");
same(numberAfter("The refractive index of glass is 1.5.", /refractive index of glass is/), 1.5, "numberAfter decimal sentence end unchanged");
same(parseStemNumber("12,500.5"), 12500.5, "parseStemNumber grouped decimal");
same(parseStemNumber("1,0000"), null, "parseStemNumber malformed group");
same(numberAfter("The length is 1,0000 m", /length is/), null, "numberAfter malformed group reads nothing, not 1");
same(numberAfter("The coordinates are (1,500,2).", /coordinates are/), null, "numberAfter numeric triple reads nothing");
same(numberAfter("A span (1,000 m) wide", /span/), 1000, "numberAfter bracket with a unit still groups");

// The exported grammar is the same one, for generators that read their own roles.
const own = new RegExp(`${STEM_NUMBER}\\s*(?:m\\s*\\/\\s*s\\s*\\^\\s*2)`, "gi");
same([..."at 1/2 m/s^2 then 3 m/s^2".matchAll(own)].map((m) => parseStemNumber(m[1]!)), [0.5, 3], "STEM_NUMBER fraction");
same(parseStemNumber("2 1/4"), 2.25, "parseStemNumber mixed number");
same(parseStemNumber("7/0"), null, "parseStemNumber zero denominator");

// A tuple reader that matches the whole bracket reads its components.
const pair = new RegExp(`\\(\\s*${TUPLE_COMPONENT_NUMBER}\\s*,\\s*${TUPLE_COMPONENT_NUMBER}\\s*\\)`);
for (const [text, expected] of [["P = (2, 0) m", [2, 0]], ["at (2,0)", [2, 0]], ["(-1/2, 3.5)", [-0.5, 3.5]], ["(1, 000)", [1, 0]]] as const) {
  const match = pair.exec(text);
  same(match ? [parseStemNumber(match[1]!), parseStemNumber(match[2]!)] : null, expected, `tuple components ${text}`);
}

console.log(`stem numbers verified: ${checks} fraction, mixed number, token boundary and unchanged value checks`);
