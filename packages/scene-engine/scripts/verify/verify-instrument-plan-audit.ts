/** Synthetic, authored instrument-law fixtures; no historical student question or model reply. */
import assert from "node:assert/strict";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { auditInstrumentTurnPlanV3 as auditInstrument } from "../../src/physics/instrumentPlanAudit";

let auditCalls = 0;
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function auditInstrumentTurnPlanV3(plan: TurnPlanV3) {
  const before = JSON.stringify(plan);
  const result = auditInstrument(deepFreeze(plan));
  auditCalls++;
  assert.equal(result.plan, plan, "every outcome retains the same input reference");
  assert.equal(JSON.stringify(plan), before, "every outcome preserves deep input bytes");
  return result;
}

function fixture(total = 2000, series = 1992): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question: "An authored conversion fixture.", visualRequirement: "required",
    givens: [
      { id: "coil_current", symbol: "I_g", value: 1.5, unit: "mA", provenance: "given" },
      { id: "coil_resistance", symbol: "R_g", value: 8, unit: "Ω", provenance: "given" },
      { id: "range", symbol: "V", value: 3, unit: "V", provenance: "given" },
    ],
    unknowns: [{ id: "series", symbol: "R_s", unit: "Ω" }],
    derived: [
      { id: "total", symbol: "R_total", value: total, unit: "Ω", provenance: "derived" },
      { id: "series", symbol: "R_s", value: series, unit: "Ω", provenance: "derived" },
    ],
    qualitativeClaims: [], lawIds: ["galvanometer_to_voltmeter"], assumptions: [],
  };
}

const wrong = fixture(6, -2);
const original = JSON.stringify(wrong);
const audit = auditInstrumentTurnPlanV3(wrong);
assert.equal(audit.plan, wrong, "report-only audit preserves the exact plan reference");
assert.equal(JSON.stringify(wrong), original, "report-only audit preserves every original field");
assert.deepEqual(audit.results.map(({ totalResistanceOhms, seriesResistanceOhms }) =>
  [totalResistanceOhms, seriesResistanceOhms]), [[2000, 1992]], "mA conversion precedes the independent law");
assert.deepEqual(audit.inconsistencies.map(({ role, expectedOhms }) => [role, expectedOhms]),
  [["total_resistance", 2000], ["series_resistance", 1992]], "both wrong outputs are reported, never corrected");

const roundedSeries = fixture(428.57142857142856, 420.57);
roundedSeries.givens[0]!.value = 7;
roundedSeries.derived[1]!.sourceText = "R_s = 3/(7e-3)-8 ≈ 420.57 Ω";
assert.equal(auditInstrumentTurnPlanV3(roundedSeries).inconsistencies.length, 0,
  "a correct series answer explicitly written to two decimals retains its source precision");
for (const [value, unit, sourceText] of [
  [420.57, "Ω", "R_s = 3/(7e-3)-8 ≈ 0.42057 kΩ"],
  [0.42057, "kΩ", "R_s = 3/(7e-3)-8 ≈ 420.57 Ω"],
  [420.57, "Ω", "R_s = 3/(7e-3)-8 ≈ 4.2057e2Ω"],
] as const) {
  const input = structuredClone(roundedSeries);
  input.derived[1] = { ...input.derived[1]!, value, unit, sourceText };
  assert.equal(auditInstrumentTurnPlanV3(input).inconsistencies.length, 0,
    "explicit scale and exponent preserve the same final written-place precision in ohms");
}
for (const [value, sourceText, reason] of [
  [420.56, "R_s = 3/(7e-3)-8 ≈ 420.56 Ω", "a wrong rounded answer lies outside its half written place"],
  [420.58, "R_s = 3/(7e-3)-8 ≈ 420.58 Ω", "the neighboring wrong rounded answer is also refused"],
  [420.57, undefined, "a raw rounded scalar alone never grants a new tolerance"],
  [400, "R_s = 3/(7e-3)-8 ≈ 4e2 Ω", "one significant figure cannot authorize a coarse answer"],
  [420.57, "R_total = 3/(7e-3)-8 ≈ 420.57 Ω", "another output's assignment cannot authorize this output"],
  [420.574, "R_s = 3/(7e-3)-8 ≈ 420.57 Ω", "the source's rounded literal cannot forgive a different raw plan scalar"],
  [420.57, "R_s = 3/(7e-3)-8 ≈ 420.57000 Ω", "finer written precision is not silently discarded"],
  [420.57, "R_s = 3/(7e-3)-8 ≈ 420.57 V", "a wrong source dimension is not resistance evidence"],
  [-420.57, "R_s = 3/(7e-3)-8 ≈ -420.57 Ω", "precision never forgives a negative resistance"],
] as const) {
  const input = structuredClone(roundedSeries);
  input.derived[1] = { ...input.derived[1]!, value, sourceText };
  assert.equal(auditInstrumentTurnPlanV3(input).inconsistencies.length, 1, reason);
}
const outsideHalfPlace = structuredClone(roundedSeries);
outsideHalfPlace.givens[2]!.value = 3.000025007;
outsideHalfPlace.derived[0]!.value = 428.575001;
assert.equal(auditInstrumentTurnPlanV3(outsideHalfPlace).inconsistencies.length, 1,
  "a result just outside the source's half written-place boundary remains wrong");
const roundedTinyWrong = fixture(2e-15, 1e-15);
roundedTinyWrong.givens[0] = { ...roundedTinyWrong.givens[0]!, value: 1, unit: "A" };
roundedTinyWrong.givens[1]!.value = 2e-16;
roundedTinyWrong.givens[2]!.value = 2e-15;
roundedTinyWrong.derived[1]!.sourceText = "R_s = 2e-15/1-2e-16 ≈ 1.00e-15 Ω";
assert.equal(auditInstrumentTurnPlanV3(roundedTinyWrong).inconsistencies.length, 1,
  "source precision has no absolute floating-slack floor that forgives wrong tiny outputs");
const roundedTinyZero = structuredClone(roundedTinyWrong);
roundedTinyZero.derived[1]!.value = 0;
roundedTinyZero.derived[1]!.sourceText = "R_s = 2e-15/1-2e-16 ≈ 0.00 Ω";
assert.equal(auditInstrumentTurnPlanV3(roundedTinyZero).inconsistencies.length, 1,
  "a rounded zero cannot hide a nonzero independently solved resistance");

for (const [unit, value] of [["A", 0.0015], ["mA", 1.5], ["μA", 1500], ["µA", 1500], ["uA", 1500], ["nA", 1.5e6]] as const) {
  const input = fixture();
  input.givens[0] = { ...input.givens[0]!, value, unit };
  const observed = auditInstrumentTurnPlanV3(input);
  assert.equal(observed.results.length, 1, "explicit current units remain independently convertible");
  assert.equal(observed.inconsistencies.length, 0, "SI-equivalent inputs never create mismatches");
  assert.equal(observed.declined.length, 0);
  assert(Math.abs(observed.results[0]!.totalResistanceOhms - 2000) < 1e-9);
  assert(Math.abs(observed.results[0]!.seriesResistanceOhms - 1992) < 1e-9);
}
const scaled = fixture(2, 1.992);
scaled.givens[1] = { ...scaled.givens[1]!, value: 0.008, unit: "kΩ" };
scaled.givens[2] = { ...scaled.givens[2]!, value: 3000, unit: "mV" };
scaled.derived.forEach((quantity) => { quantity.unit = "kΩ"; });
assert.equal(auditInstrumentTurnPlanV3(scaled).inconsistencies.length, 0, "input and output units convert independently");
assert.equal(auditInstrumentTurnPlanV3(scaled).declined.length, 0);
for (const law of ["galvanometer-to-voltmeter", "voltmeter_conversion", "galvanometer_to_voltmeter_conversion"]) {
  const input = fixture(); input.lawIds = [law];
  assert.deepEqual(auditInstrumentTurnPlanV3(input).checkedLawIds, ["galvanometer_to_voltmeter"],
    "only exact allowlisted conversion tags have the same law meaning");
}

const badSign = fixture(); badSign.givens[0]!.sign = "negative";
assert(auditInstrumentTurnPlanV3(badSign).declined.some((entry) => entry.reason === "invalid_given_sign"),
  "a source input contradicting its own sign is never used to certify outputs");
const nonfinite = fixture(); nonfinite.derived[0]!.value = Number.NaN;
assert(auditInstrumentTurnPlanV3(nonfinite).declined.some((entry) => entry.reason === "invalid_output_value"),
  "non-finite outputs never pass a NaN comparison");
const tiny = fixture(6e-15, -2e-15);
tiny.givens[1]!.value = 8e-15; tiny.givens[2]!.value = 3e-15;
assert.equal(auditInstrumentTurnPlanV3(tiny).inconsistencies.length, 2,
  "the numeric comparison has no absolute floor that accepts wrong tiny values");

const mixedLaw = fixture(); mixedLaw.lawIds.push("ammeter_conversion");
assert(auditInstrumentTurnPlanV3(mixedLaw).declined.some((entry) => entry.reason === "ambiguous_law"),
  "conflicting conversion-law tags cannot choose a circuit arrangement");
const conflictingRole = fixture();
conflictingRole.givens[0]!.id = "galvanometer_resistance";
conflictingRole.givens.splice(1, 1);
assert(auditInstrumentTurnPlanV3(conflictingRole).declined.some((entry) => entry.reason === "conflicting_role"),
  "an id and symbol claiming different roles never choose a role by unit");
const badOutputSign = fixture(); badOutputSign.derived[1]!.sign = "negative";
assert(auditInstrumentTurnPlanV3(badOutputSign).declined.some((entry) => entry.reason === "invalid_output_sign"),
  "an output contradicting its own sign is not considered checked");

const words = fixture();
words.givens[0]!.unit = "milliamperes"; words.givens[1]!.unit = "ohms"; words.givens[2]!.unit = "volts";
assert.equal(auditInstrumentTurnPlanV3(words).declined.length, 0, "explicit spelled units are independently recognized");
const collapsed = fixture(0, 0);
collapsed.givens[0]!.value = 1e300; collapsed.givens[0]!.unit = "A";
collapsed.givens[1]!.value = 0; collapsed.givens[2]!.value = Number.MIN_VALUE;
assert(auditInstrumentTurnPlanV3(collapsed).declined.some((entry) => entry.reason === "non_finite_result"),
  "positive finite givens whose ratio underflows cannot certify zero resistance");
const assumed = fixture(); assumed.givens[0]!.provenance = "assumed";
assert(auditInstrumentTurnPlanV3(assumed).declined.some((entry) => entry.reason === "invalid_given_provenance"),
  "only actual structured givens can be law inputs");

for (const laws of [[], ["ohms_law"], ["ammeter_conversion"], ["galvanometer_to_ammeter"], ["voltmeter_conversion_with_shunt"]]) {
  const input = fixture(6, -2); input.lawIds = laws;
  const observed = auditInstrumentTurnPlanV3(input);
  assert.deepEqual([observed.results, observed.checkedLawIds, observed.inconsistencies, observed.declined], [[], [], [], []],
    "question words and generic or different laws never activate this audit");
}
for (let index = 0; index < 3; index++) {
  const input = fixture(); input.givens.splice(index, 1);
  const observed = auditInstrumentTurnPlanV3(input);
  assert(observed.declined.some((entry) => entry.reason === "missing_given"));
  assert.equal(observed.results.length, 0, "missing inputs never receive computed authority");
  const duplicate = fixture(); duplicate.givens.push({ ...duplicate.givens[index]!, id: `duplicate${index}` });
  const ambiguous = auditInstrumentTurnPlanV3(duplicate);
  assert(ambiguous.declined.some((entry) => entry.reason === "ambiguous_given"));
  assert.equal(ambiguous.results.length, 0, "even equal repeated input roles are ambiguous");
}
for (const [index, unit] of [[0, undefined], [0, "MA"], [0, "V"], [1, "Ω^-1"], [2, "watts"]] as const) {
  const input = fixture(); input.givens[index]!.unit = unit;
  const observed = auditInstrumentTurnPlanV3(input);
  assert(observed.declined.some((entry) => entry.reason === "unsupported_given_unit"));
  assert.equal(observed.results.length, 0, "unsupported dimensions/prefixes never become guessed SI values");
}
for (const [index, value] of [[0, 0], [0, -1.5], [1, -8], [2, 0], [2, -3], [0, Number.NaN], [2, Infinity]] as const) {
  const input = fixture(); input.givens[index]!.value = value;
  assert(auditInstrumentTurnPlanV3(input).declined.some((entry) => entry.reason === "invalid_given_value"));
}
const belowDrop = fixture(); belowDrop.givens[2]!.value = 0.003;
assert(auditInstrumentTurnPlanV3(belowDrop).declined.some((entry) => entry.reason === "range_below_galvanometer_drop"));
const overflow = fixture(); overflow.givens[0]!.value = Number.MIN_VALUE; overflow.givens[0]!.unit = "A";
assert(auditInstrumentTurnPlanV3(overflow).declined.some((entry) => entry.reason === "non_finite_result"));
const zeroSeries = fixture(8, 0); zeroSeries.givens[2]!.value = 0.012;
assert.equal(auditInstrumentTurnPlanV3(zeroSeries).inconsistencies.length, 0, "zero added resistance is a valid limiting case");

for (let index = 0; index < 2; index++) {
  const input = fixture(); input.derived.push({ ...input.derived[index]!, id: `duplicate_output${index}` });
  assert(auditInstrumentTurnPlanV3(input).declined.some((entry) => entry.reason === "ambiguous_output"));
}
const missing = fixture(6, -2); missing.derived.shift();
const missingAudit = auditInstrumentTurnPlanV3(missing);
assert(missingAudit.declined.some((entry) => entry.reason === "missing_output"));
assert.equal(missingAudit.inconsistencies.length, 1, "a missing total cannot hide a wrong present series resistance");
const outputConflict = fixture(); outputConflict.derived[0]!.id = "series_resistance";
assert(auditInstrumentTurnPlanV3(outputConflict).declined.some((entry) => entry.reason === "conflicting_role"));
for (const unit of [undefined, "unrecognized"]) {
  const input = fixture(); input.derived[1]!.unit = unit;
  assert(auditInstrumentTurnPlanV3(input).declined.some((entry) => entry.reason === "unsupported_output_unit"));
}
const wrongDimension = fixture(); wrongDimension.derived[1]!.unit = "V";
assert(auditInstrumentTurnPlanV3(wrongDimension).inconsistencies.some((entry) => entry.reason === "unit_mismatch" && entry.actualOhms === null));
const unsignedNegative = fixture(2000, -1992); unsignedNegative.derived[1]!.sign = "unsigned";
assert(auditInstrumentTurnPlanV3(unsignedNegative).inconsistencies.some((entry) => entry.reason === "sign_mismatch"),
  "unsigned must never take the absolute value of a negative resistance");
const assumedOutput = fixture(); assumedOutput.derived[1]!.provenance = "assumed";
assert(auditInstrumentTurnPlanV3(assumedOutput).declined.some((entry) => entry.reason === "invalid_output_provenance"));
const formatted = fixture(); formatted.givens[0]!.symbol = String.raw`\mathrm{I}_{g}`;
formatted.derived[1]!.symbol = String.raw`\mathrm{R}_{s}`;
assert.equal(auditInstrumentTurnPlanV3(formatted).declined.length, 0, "known formatting preserves exact role identity");
const wrongCase = fixture(); wrongCase.derived[1]!.symbol = "r_s";
assert(auditInstrumentTurnPlanV3(wrongCase).declined.some((entry) => entry.reason === "missing_output"), "symbol case is not guessed");
const milliOhms = fixture(2e6, 1.992e6); milliOhms.derived.forEach((quantity) => { quantity.unit = "mΩ"; });
assert.equal(auditInstrumentTurnPlanV3(milliOhms).inconsistencies.length, 0);
const megaOhms = fixture(0.002, 0.001992); megaOhms.derived.forEach((quantity) => { quantity.unit = "MΩ"; });
assert.equal(auditInstrumentTurnPlanV3(megaOhms).inconsistencies.length, 0, "mega and milli prefixes remain distinct");
const overflowOutput = fixture(); overflowOutput.derived[0]!.value = 1e308; overflowOutput.derived[0]!.unit = "MΩ";
assert(auditInstrumentTurnPlanV3(overflowOutput).declined.some((entry) => entry.reason === "invalid_output_value"));
console.log(`verify-instrument-plan-audit: ${auditCalls} report-only calls; explicit SI inputs and contradiction controls pass`);
