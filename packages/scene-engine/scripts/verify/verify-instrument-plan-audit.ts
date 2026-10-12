/** Synthetic, authored instrument-law fixtures; no historical student question or model reply. */
import assert from "node:assert/strict";
import { validateTurnPlanV3, type TurnPlanV3 } from "../../src/contracts/contractsV3";
import { auditInstrumentTurnPlanV3 as auditInstrument } from "../../src/physics/instrumentPlanAudit";

let auditCalls = 0;
let validationCalls = 0;
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
function validateInstrumentPlan(plan: TurnPlanV3) {
  const before = JSON.stringify(plan);
  const result = validateTurnPlanV3(deepFreeze(plan));
  validationCalls++;
  assert.equal(JSON.stringify(plan), before, "production validation preserves deep input bytes");
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

function textbookFixture(current = "I_g", resistance = "R_g", range = "V", series = "R_s"): TurnPlanV3 {
  const input = fixture();
  input.givens[0] = { ...input.givens[0]!, symbol: current, value: 5 };
  input.givens[1] = { ...input.givens[1]!, symbol: resistance };
  input.givens[2] = { ...input.givens[2]!, symbol: range, value: 10 };
  input.unknowns[0] = { ...input.unknowns[0]!, symbol: series };
  input.derived[1] = { ...input.derived[1]!, symbol: series };
  return input;
}

for (const [current, resistance, range, series] of [
  ["I_g", "G", "V", "R_s"], ["I_g", "R_g", "V", "R"],
  ["I_g", "R_g", "V", "R_series"], ["I_g", "R_g", "V_max", "R_s"],
  ["I_g", "R_G", "V", "R_s"], ["i_g", "R_g", "V", "R_s"],
  ["i_g", "G", "V_max", "R"], ["I_g", "R_G", "V_max", "R_series"],
] as const) {
  const correct = textbookFixture(current, resistance, range, series);
  const observed = auditInstrumentTurnPlanV3(correct);
  assert.deepEqual(observed.results.map(({ currentAmps, galvanometerResistanceOhms, rangeVolts,
    totalResistanceOhms, seriesResistanceOhms }) =>
    [currentAmps, galvanometerResistanceOhms, rangeVolts, totalResistanceOhms, seriesResistanceOhms]),
  [[0.005, 8, 10, 2000, 1992]], `${current}/${resistance}/${range}/${series} binds exact textbook roles before applying the law`);
  assert.deepEqual(observed.declined, []);
  assert.deepEqual(observed.inconsistencies, []);
  assert(validateInstrumentPlan(correct).valid, "production accepts the independently computed 1992-ohm answer with textbook aliases");
  for (const wrongSeries of [-6, 2000]) {
    const wrong = structuredClone(correct); wrong.derived[1]!.value = wrongSeries;
    const mismatch = auditInstrumentTurnPlanV3(wrong);
    assert(mismatch.inconsistencies.some((entry) => entry.role === "series_resistance" && entry.expectedOhms === 1992),
      "aliases do not forgive either the unconverted-mA answer or the total-as-series answer");
    const rejected = validateInstrumentPlan(wrong);
    assert(!rejected.valid);
    assert(rejected.issues.some((entry) => entry.code === "instrument_law_mismatch"));
  }
}

for (const [group, index, alias] of [
  ["given", 0, "i_g"], ["given", 1, "G"], ["given", 1, "R_G"],
  ["given", 2, "V_max"], ["derived", 1, "R"], ["derived", 1, "R_series"],
] as const) {
  const input = textbookFixture();
  if (group === "given") input.givens[index] = { ...input.givens[index]!, id: alias, symbol: `input_${index}` };
  else {
    input.derived[index] = { ...input.derived[index]!, id: alias, symbol: "output_series" };
    input.unknowns[0] = { ...input.unknowns[0]!, id: alias, symbol: "output_series" };
  }
  const observed = auditInstrumentTurnPlanV3(input);
  assert.equal(observed.results[0]?.seriesResistanceOhms, 1992, "an exact bound alias in a quantity ID has the same role as its symbol");
  assert.deepEqual(observed.declined, []);
  assert.deepEqual(observed.inconsistencies, []);
  assert(validateInstrumentPlan(input).valid);
}

for (const [current, resistance, range, series] of [
  [String.raw`i_{g}`, String.raw`\mathrm{G}`, String.raw`V_{max}`, String.raw`\mathrm{R}_{series}`],
  ["i_g", "R_G", "V_max", "R"],
] as const) {
  const input = textbookFixture(current, resistance, range, series);
  const observed = auditInstrumentTurnPlanV3(input);
  assert.equal(observed.results[0]?.seriesResistanceOhms, 1992);
  assert.deepEqual(observed.declined, []);
  assert(validateInstrumentPlan(input).valid);
}

for (const [index, symbol] of [[0, "IG"], [1, "g"], [2, "V_MAX"]] as const) {
  const input = textbookFixture(); input.givens[index]!.symbol = symbol;
  const observed = auditInstrumentTurnPlanV3(input);
  assert.equal(observed.results.length, 0, "allowlisted lowercase i_g does not introduce global case-folding");
  assert(observed.declined.some((entry) => entry.reason === "missing_given"));
  assert(!validateInstrumentPlan(input).valid);
}
for (const symbol of ["r", "R_SERIES"]) {
  const input = textbookFixture(); input.derived[1]!.symbol = symbol;
  assert(auditInstrumentTurnPlanV3(input).declined.some((entry) => entry.reason === "missing_output"));
  assert(!validateInstrumentPlan(input).valid);
}

for (const [index, unit] of [[0, "MA"], [1, "mA"], [2, "Ω"]] as const) {
  const input = textbookFixture("i_g", "G", "V_max", "R"); input.givens[index]!.unit = unit;
  const observed = auditInstrumentTurnPlanV3(input);
  assert.equal(observed.results.length, 0, "a recognized textbook role never guesses its dimension or prefix");
  assert(observed.declined.some((entry) => entry.reason === "unsupported_given_unit"));
  assert(!validateInstrumentPlan(input).valid);
}
for (const unit of [undefined, "unrecognized", "V"]) {
  const input = textbookFixture("i_g", "R_G", "V_max", "R_series"); input.derived[1]!.unit = unit;
  const observed = auditInstrumentTurnPlanV3(input);
  assert(unit === "V" ? observed.inconsistencies.some((entry) => entry.reason === "unit_mismatch")
    : observed.declined.some((entry) => entry.reason === "unsupported_output_unit"));
  assert(!validateInstrumentPlan(input).valid);
}

const duplicateTextbookInput = textbookFixture("i_g", "G", "V_max", "R");
duplicateTextbookInput.givens.push({ ...duplicateTextbookInput.givens[1]!, id: "another_coil", symbol: "R_G" });
const duplicateInputAudit = auditInstrumentTurnPlanV3(duplicateTextbookInput);
assert.equal(duplicateInputAudit.results.length, 0);
assert(duplicateInputAudit.declined.some((entry) => entry.reason === "ambiguous_given" && entry.role === "galvanometer_resistance"));
assert(!validateInstrumentPlan(duplicateTextbookInput).valid, "equal G and R_G inputs still cannot choose between two quantities");
const duplicateTextbookOutput = textbookFixture("i_g", "G", "V_max", "R");
duplicateTextbookOutput.derived.push({ ...duplicateTextbookOutput.derived[1]!, id: "another_series", symbol: "R_series" });
assert(auditInstrumentTurnPlanV3(duplicateTextbookOutput).declined.some((entry) => entry.reason === "ambiguous_output" && entry.role === "series_resistance"));
assert(!validateInstrumentPlan(duplicateTextbookOutput).valid, "equal R and R_series outputs remain ambiguous");
const conflictingTextbookRole = textbookFixture("i_g", "G", "V_max", "R_series");
conflictingTextbookRole.givens[1]!.id = "R";
assert(auditInstrumentTurnPlanV3(conflictingTextbookRole).declined.some((entry) => entry.reason === "conflicting_role"));
assert(!validateInstrumentPlan(conflictingTextbookRole).valid, "G and R cannot pick the role whose unit happens to fit");
const guessedTextbookResistance = textbookFixture("i_g", "R", "V_max", "R_series");
assert(auditInstrumentTurnPlanV3(guessedTextbookResistance).declined.some((entry) => entry.reason === "missing_given" && entry.role === "galvanometer_resistance"));
assert(!validateInstrumentPlan(guessedTextbookResistance).valid, "a bare R input is not silently repurposed as galvanometer resistance");
const aliasesWithoutLaw = textbookFixture("i_g", "G", "V_max", "R"); aliasesWithoutLaw.lawIds = ["ohms_law"];
const noAliasAuthority = auditInstrumentTurnPlanV3(aliasesWithoutLaw);
assert.deepEqual([noAliasAuthority.results, noAliasAuthority.checkedLawIds, noAliasAuthority.inconsistencies, noAliasAuthority.declined], [[], [], [], []],
  "aliases cannot activate galvanometer authority without an exact conversion law tag");
const aliasAuditCalls = auditCalls;
const aliasValidationCalls = validationCalls;

const totalOnly = fixture();
totalOnly.unknowns = [{ id: "total", symbol: "R_total", unit: "Ω" }];
totalOnly.derived.pop();
const totalOnlyAudit = auditInstrumentTurnPlanV3(totalOnly);
assert.equal(totalOnlyAudit.declined.length, 0,
  "a checked total-only answer does not require an unrequested series output");
assert.equal(totalOnlyAudit.inconsistencies.length, 0);
assert.deepEqual(totalOnlyAudit.results.map(({ totalResistanceOhms }) => totalResistanceOhms), [2000]);
assert(validateInstrumentPlan(totalOnly).valid, "the production validator accepts the correct total-only answer");

const bothRequested = fixture();
bothRequested.unknowns.unshift({ id: "total", symbol: "R_total", unit: "Ω" });
assert.equal(auditInstrumentTurnPlanV3(bothRequested).declined.length, 0, "both requested outputs are independently checked");
assert(validateInstrumentPlan(bothRequested).valid);
const seriesOnly = fixture(); seriesOnly.derived.shift();
assert.equal(auditInstrumentTurnPlanV3(seriesOnly).declined.length, 0,
  "a checked series-only answer does not require an unrequested total output");
assert(validateInstrumentPlan(seriesOnly).valid);

for (const [index, role] of [[0, "total_resistance"], [1, "series_resistance"]] as const) {
  const missingRequested = structuredClone(bothRequested); missingRequested.derived.splice(index, 1);
  assert(auditInstrumentTurnPlanV3(missingRequested).declined.some((entry) => entry.reason === "missing_output" && entry.role === role),
    "a requested output remains required even when its sibling is correct");
  assert(!validateInstrumentPlan(missingRequested).valid);
  const wrongUnrequested = fixture();
  wrongUnrequested.unknowns = [bothRequested.unknowns[1 - index]!];
  wrongUnrequested.derived[index]!.value += 1;
  assert(auditInstrumentTurnPlanV3(wrongUnrequested).inconsistencies.some((entry) => entry.role === role),
    "every present output is checked even when only its sibling was requested");
  assert(!validateInstrumentPlan(wrongUnrequested).valid);
}
for (const [index, id, symbol] of [
  [0, "total", "Rₜₒₜₐₗ"], [0, "total", String.raw`\mathrm{R}_{total}`], [0, "total_resistance", "X"],
  [1, "series", "Rₛ"], [1, "series", String.raw`\mathrm{R}_{s}`], [1, "series_resistance", "X"],
] as const) {
  const input = fixture(); input.derived.splice(index, 1); input.unknowns = [{ id, symbol, unit: "Ω" }];
  const role = index === 0 ? "total_resistance" : "series_resistance";
  assert(auditInstrumentTurnPlanV3(input).declined.some((entry) => entry.reason === "missing_output" && entry.role === role),
    "Unicode, TeX formatting and exact typed IDs preserve requested role identity");
  assert(!validateInstrumentPlan(input).valid);
}
const wrongCaseRequest = fixture(); wrongCaseRequest.derived.pop();
wrongCaseRequest.unknowns = [{ id: "other", symbol: "r_s", unit: "Ω" }];
assert.equal(auditInstrumentTurnPlanV3(wrongCaseRequest).declined.length, 0, "request symbol case is not guessed");
const misleadingQuestion = structuredClone(totalOnly);
misleadingQuestion.question = "Find the series resistance R_s, series resistance and total resistance.";
assert.equal(auditInstrumentTurnPlanV3(misleadingQuestion).declined.length, 0,
  "question words cannot add a role absent from the structured requests");
const noOutputs = fixture(); noOutputs.derived = []; noOutputs.unknowns = [];
assert.equal(auditInstrumentTurnPlanV3(noOutputs).declined.filter((entry) => entry.reason === "missing_output").length, 2,
  "omitting every output cannot borrow computed law authority");
assert(!validateInstrumentPlan(noOutputs).valid);
const wrongOnlyTotal = structuredClone(totalOnly); wrongOnlyTotal.derived[0]!.value = 6;
const wrongOnlyAudit = auditInstrumentTurnPlanV3(wrongOnlyTotal);
assert.equal(wrongOnlyAudit.inconsistencies.length, 1);
assert(wrongOnlyAudit.declined.some((entry) => entry.reason === "missing_output" && entry.role === "series_resistance"),
  "a wrong sibling cannot authorize an unrequested omission");
assert(!validateInstrumentPlan(wrongOnlyTotal).valid);
for (const unsupported of ["given", "output", "ambiguous"] as const) {
  const input = structuredClone(totalOnly);
  if (unsupported === "given") input.givens[0]!.unit = "MA";
  else if (unsupported === "output") input.derived[0]!.unit = "unrecognized";
  else input.derived.push({ ...input.derived[0]!, id: "duplicate_total" });
  const observed = auditInstrumentTurnPlanV3(input);
  assert(observed.declined.some((entry) => entry.reason === (unsupported === "given" ? "unsupported_given_unit"
    : unsupported === "output" ? "unsupported_output_unit" : "ambiguous_output")),
  "a total-only request never bypasses unsupported or ambiguous evidence");
  assert(!validateInstrumentPlan(input).valid);
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
console.log(`verify-instrument-plan-audit: ${auditCalls} report-only calls; ${validationCalls} production validations; explicit SI inputs and contradiction controls pass`);
console.log(`verify-instrument-plan-audit breakdown: legacy ${auditCalls - aliasAuditCalls} report-only calls / ${validationCalls - aliasValidationCalls} production validations; textbook aliases ${aliasAuditCalls} report-only calls / ${aliasValidationCalls} production validations`);
