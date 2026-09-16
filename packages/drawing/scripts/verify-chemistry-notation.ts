/**
 * The pen writes chemical formulas in script notation whatever the model
 * typed: subscripted counts, superscripted charges, an electron as e^(-).
 * Physics designators (R2, V0, F1) and maths (x2, f(x)) are untouched.
 */
import { scriptChemicalFormulas } from "../src/handwriting/chemistryNotation";
import { normalizeStrokeText } from "../src/handwriting/handwriting";

const CASES: Array<[string, string]> = [
  ["H2SO4 + 2NaOH → Na2SO4 + 2H2O", "H_2SO_4 + 2NaOH → Na_2SO_4 + 2H_2O"],
  ["Cu2+ + 2e- → Cu", "Cu^(2+) + 2e^(-) → Cu"],
  ["Fe3+", "Fe^(3+)"],
  ["NH4+", "NH_4^(+)"],
  ["SO4^2-", "SO_4^(2-)"],
  ["SO42-", "SO_4^(2-)"],
  ["2H2 + O2 → 2H2O", "2H_2 + O_2 → 2H_2O"],
  ["CO2", "CO_2"],
  ["Ca(OH)2", "Ca(OH)_2"],
  ["K4[Fe(CN)6]", "K_4[Fe(CN)_6]"],
  ["[Fe(CN)6]3-", "[Fe(CN)_6]^(3-)"],
  ["MnO4-", "MnO_4^(-)"],
  ["Cl2(g)", "Cl_2(g)"],
  ["I3-", "I_3^(-)"],
  ["N3-", "N^(3-)"],
  ["Hg22+", "Hg_2^(2+)"],
  ["C6H12O6 + 6O2 → 6CO2 + 6H2O", "C_6H_12O_6 + 6O_2 → 6CO_2 + 6H_2O"],
  ["e- + H+", "e^(-) + H^(+)"],
  ["H_2O already", "H_2O already"],
  ["R2 = 4 ohm", "R2 = 4 ohm"],
  ["V0 = 5 V", "V0 = 5 V"],
  ["F1 and F2 forces", "F1 and F2 forces"],
  ["x2 + 3x", "x2 + 3x"],
  ["E = mc2", "E = mc2"],
  ["f(x) = x2", "f(x) = x2"],
  ["10N force", "10N force"],
  ["v = 10 m/s", "v = 10 m/s"],
  ["sin2x", "sin2x"],
  ["x^2 - 1", "x^2 - 1"],
  ["E = 5 - 3", "E = 5 - 3"],
  ["2 × 10^-3", "2 × 10^-3"],
  ["e-mail", "e-mail"],
];

let failures = 0;
for (const [input, expected] of CASES) {
  const output = scriptChemicalFormulas(input);
  if (output !== expected) {
    failures += 1;
    console.error(`  ${JSON.stringify(input)} -> ${JSON.stringify(output)}, expected ${JSON.stringify(expected)}`);
  }
}
// The pass is wired into the stroke normaliser the pen actually runs.
const wired = normalizeStrokeText("H2SO4");
if (!wired.includes("H_2SO_4") && !wired.includes("H_(2)SO_(4)")) {
  failures += 1;
  console.error(`  normalizeStrokeText did not script H2SO4: ${JSON.stringify(wired)}`);
}
if (failures > 0) {
  console.error(`verify-chemistry-notation: FAILED (${failures})`);
  process.exit(1);
}
console.log(`verify-chemistry-notation: ok (${CASES.length} cases, wired into normalizeStrokeText)`);
