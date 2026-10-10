import { mathToSpeech } from "../../src/tts/elevenLabsClient";
import { findSpokenToken, getCueSpeechWindow } from "../../src/sync/cueWindow";
import { normalizeForSpeechMatch } from "../../src/sync/audioSync";
import { StreamingSpeechClient } from "../../src/tts/streamingSpeechClient";
import { normalizeBoardText } from "@heytutor/drawing";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertContains(output: string, substring: string, input: string): void {
  if (!output.includes(substring)) {
    throw new Error(`Expected mathToSpeech("${input}") to contain "${substring}", but got:\n  "${output}"`);
  }
}

function assertNotContains(output: string, substring: string, input: string): void {
  if (output.includes(substring)) {
    throw new Error(`Expected mathToSpeech("${input}") to NOT contain "${substring}", but got:\n  "${output}"`);
  }
}

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("Phase 4a — Chemistry notation\n");

check("H_2O subscript expansion", () => {
  const out = mathToSpeech("H_2O");
  assertContains(out, "H 2 O", "H_2O");
});

check("C_6H_12O_6 multi-subscript expansion", () => {
  const out = mathToSpeech("C_6H_12O_6");
  assertContains(out, "C 6 H 12 O 6", "C_6H_12O_6");
});

check("⇌ equilibrium arrow → reversible", () => {
  const out = mathToSpeech("A ⇌ B");
  assertContains(out, "reversible", "A ⇌ B");
});

check("→ in chemistry context (after compound) → gives", () => {
  const out = mathToSpeech("CH3COOH(l) → CH3COOCH2CH3(l)");
  assertContains(out, "gives", "CH3COOH(l) → ...");
});

check("→ after element symbol (Cl →) → gives", () => {
  const out = mathToSpeech("NaCl → Na+ + Cl-");
  assertContains(out, "gives", "NaCl → ...");
});

check("→ in math context (x → 0) → approaches", () => {
  const out = mathToSpeech("as x → 0");
  assertContains(out, "approaches", "x → 0");
});

check("→ in math context (n → ∞) → approaches", () => {
  const out = mathToSpeech("n → ∞");
  assertContains(out, "approaches", "n → ∞");
});

check("SO4^2- charge with caret → minus", () => {
  const out = mathToSpeech("SO4^2-");
  assertContains(out, "minus", "SO4^2-");
  assertNotContains(out, "to the power of", "SO4^2-");
});

check("O^2- simple ion charge with caret", () => {
  const out = mathToSpeech("O^2-");
  assertContains(out, "minus", "O^2-");
  assertNotContains(out, "to the power of", "O^2-");
});

check("Ca^2+ positive charge with caret → plus", () => {
  const out = mathToSpeech("Ca^2+");
  assertContains(out, "plus", "Ca^2+");
  assertNotContains(out, "to the power of", "Ca^2+");
});

check("Na+ ion charge without caret → plus", () => {
  const out = mathToSpeech("Na+");
  assertContains(out, "plus", "Na+");
});

check("NH4+ polyatomic ion charge → plus", () => {
  const out = mathToSpeech("NH4+");
  assertContains(out, "plus", "NH4+");
});

check("Cl- negative ion at end → minus", () => {
  const out = mathToSpeech("Cl-");
  assertContains(out, "minus", "Cl-");
});

check("(s) state symbol → solid", () => {
  const out = mathToSpeech("Fe2O3(s)");
  assertContains(out, "solid", "Fe2O3(s)");
});

check("(l) state symbol → liquid", () => {
  const out = mathToSpeech("H2O(l)");
  assertContains(out, "liquid", "H2O(l)");
});

check("(g) state symbol → gas", () => {
  const out = mathToSpeech("CO2(g)");
  assertContains(out, "gas", "CO2(g)");
});

check("(aq) state symbol → aqueous", () => {
  const out = mathToSpeech("NaCl(aq)");
  assertContains(out, "aqueous", "NaCl(aq)");
});

check("°C → degrees Celsius", () => {
  const out = mathToSpeech("25°C");
  assertContains(out, "degrees Celsius", "25°C");
});

check("°F → degrees Fahrenheit", () => {
  const out = mathToSpeech("98°F");
  assertContains(out, "degrees Fahrenheit", "98°F");
});

check("mol → mole", () => {
  const out = mathToSpeech("2 mol of NaCl");
  assertContains(out, "mole", "2 mol of NaCl");
});

check("2 M → molar", () => {
  const out = mathToSpeech("2 M HCl");
  assertContains(out, "molar", "2 M HCl");
});

console.log("\nPhase 4b — Calculus notation\n");

check("d/dx → d d x", () => {
  const out = mathToSpeech("dy/dx = d/dx");
  assertContains(out, "d d x", "d/dx");
});

check("d/dt → d d t", () => {
  const out = mathToSpeech("d/dt");
  assertContains(out, "d d t", "d/dt");
});

check("∂/∂x → partial d d x", () => {
  const out = mathToSpeech("∂f/∂x");
  assertContains(out, "partial", "∂f/∂x");
});

check("standalone ∂ → partial", () => {
  const out = mathToSpeech("∂");
  assertContains(out, "partial", "∂");
});

check("lim → limit", () => {
  const out = mathToSpeech("lim x→a");
  assertContains(out, "limit", "lim x→a");
});

check("Lim → limit", () => {
  const out = mathToSpeech("Lim n→∞");
  assertContains(out, "limit", "Lim n→∞");
});

check("∞ → infinity", () => {
  const out = mathToSpeech("n → ∞");
  assertContains(out, "infinity", "n → ∞");
});

check("≤ → less than or equal to", () => {
  const out = mathToSpeech("x ≤ 5");
  assertContains(out, "less than or equal to", "x ≤ 5");
});

check("≥ → greater than or equal to", () => {
  const out = mathToSpeech("y ≥ 3");
  assertContains(out, "greater than or equal to", "y ≥ 3");
});

check("≠ → not equal to", () => {
  const out = mathToSpeech("a ≠ b");
  assertContains(out, "not equal to", "a ≠ b");
});

check("≈ → approximately", () => {
  const out = mathToSpeech("π ≈ 3.14");
  assertContains(out, "approximately", "π ≈ 3.14");
});

check("± → plus or minus", () => {
  const out = mathToSpeech("x = ±5");
  assertContains(out, "plus or minus", "x = ±5");
});

check("sqrt(x) → square root of x", () => {
  const out = mathToSpeech("sqrt(x+1)");
  assertContains(out, "square root of", "sqrt(x+1)");
});

check("csc → cosecant", () => {
  const out = mathToSpeech("csc θ");
  assertContains(out, "cosecant", "csc θ");
});

check("sec → secant", () => {
  const out = mathToSpeech("sec θ");
  assertContains(out, "secant", "sec θ");
});

check("cot → cotangent", () => {
  const out = mathToSpeech("cot θ");
  assertContains(out, "cotangent", "cot θ");
});

check("x' → x prime", () => {
  const out = mathToSpeech("f'(x)");
  assertContains(out, "prime", "f'(x)");
});

check("x'' → x double prime", () => {
  const out = mathToSpeech("f''(x)");
  assertContains(out, "double prime", "f''(x)");
});

check("a possessive or a contraction keeps its apostrophe", () => {
  for (const input of ["Coulomb's law", "Snell's law", "let's start", "the object's distance", "we'll use it"]) {
    const out = mathToSpeech(input);
    assertNotContains(out, "prime", input);
    assert(out.includes("'"), `Expected mathToSpeech("${input}") to keep its apostrophe, got "${out}"`);
  }
});

check("a prime on a lone symbol is still a prime", () => {
  for (const input of ["y' = 2x", "A' is the image", "x'' + x = 0", "θ' = 0"]) {
    assertContains(mathToSpeech(input), "prime", input);
  }
});

check("∇ → del", () => {
  const out = mathToSpeech("∇f");
  assertContains(out, "del", "∇f");
});

check("∫∫ → double integral of", () => {
  const out = mathToSpeech("∫∫ f(x,y) dA");
  assertContains(out, "double integral of", "∫∫ f(x,y) dA");
});

check("log → log", () => {
  const out = mathToSpeech("log 100");
  assertContains(out, "log", "log 100");
});

check("ln → natural log", () => {
  const out = mathToSpeech("ln x");
  assertContains(out, "natural log", "ln x");
});

check("exp → e to the power of", () => {
  const out = mathToSpeech("exp(x)");
  assertContains(out, "e to the power of", "exp(x)");
});

console.log("\nRegression — Existing rules still work\n");

check("² superscript → squared", () => {
  const out = mathToSpeech("x²");
  assertContains(out, "squared", "x²");
});

check("π → pi", () => {
  const out = mathToSpeech("πr²");
  assertContains(out, "pi", "πr²");
});

check("sin → sine", () => {
  const out = mathToSpeech("sin θ");
  assertContains(out, "sine", "sin θ");
});

check("^2 → squared (text notation)", () => {
  const out = mathToSpeech("x^2 + y^2");
  assertContains(out, "squared", "x^2 + y^2");
});

check("∫ single → integral of (not double)", () => {
  const out = mathToSpeech("∫ f(x) dx");
  assertContains(out, "integral of", "∫ f(x) dx");
  assertNotContains(out, "double integral", "∫ f(x) dx");
});

console.log("\nF2 — Greek symbols and number expansion in normalizeForSpeechMatch\n");

check("θ → theta in mathToSpeech", () => {
  const out = mathToSpeech("θ = 45°");
  assertContains(out, "theta", "θ = 45°");
});

check("μ → mu in mathToSpeech", () => {
  const out = mathToSpeech("μ = 0.3");
  assertContains(out, "mu", "μ = 0.3");
});

check("ω → omega in mathToSpeech", () => {
  const out = mathToSpeech("ω = 2π");
  assertContains(out, "omega", "ω = 2π");
});

check("Δ → delta in mathToSpeech", () => {
  const out = mathToSpeech("ΔE = mc²");
  assertContains(out, "delta", "ΔE = mc²");
});

check("λ → lambda in mathToSpeech", () => {
  const out = mathToSpeech("λ = h/p");
  assertContains(out, "lambda", "λ = h/p");
});

check("Σ → sigma in mathToSpeech", () => {
  const out = mathToSpeech("Σ x_i");
  assertContains(out, "sigma", "Σ x_i");
});

check("Ω → omega (capital) in mathToSpeech", () => {
  const out = mathToSpeech("R = 5Ω");
  assertContains(out, "omega", "R = 5Ω");
});

console.log("\nPhase 5 — Pronunciation, measured against the voice on 18 Sep 2026\n");

/**
 * Every check below names a line the tutor really spoke and the words the
 * voice really produced for it. The audio was generated with the live voice id
 * and `TUTOR_VOICE_SETTINGS`, then transcribed back, so "heard as" is measured
 * rather than guessed.
 */

check('mg is m times g, heard as "maximum theta" glued', () => {
  const out = mathToSpeech("this arrow is mg sinθ, the part of the weight pulling along the slope.");
  assertContains(out, "m g sine theta", "mg sinθ");
  assertNotContains(out, " mg ", "mg sinθ");
});

check('a coefficient glued to mg splits too (heard as "0.5 millillion")', () => {
  assertContains(mathToSpeech("plus 0.5mg cosθ"), "0.5 m g cosine theta", "0.5mg cosθ");
  assertContains(mathToSpeech("equals 2mg sinθ"), "2 m g sine theta", "2mg sinθ");
});

check("a spaced mg after a number stays milligrams", () => {
  assertContains(mathToSpeech("take 5 mg of sodium chloride."), "5 mg of sodium", "5 mg");
});

check("Mg the element is not split", () => {
  assertContains(mathToSpeech("2 mol of Mg reacts"), "Mg", "2 mol of Mg reacts");
});

check('kx is k times x, heard as "Gx" and "case"', () => {
  assertContains(mathToSpeech("the upward spring force kx"), "k x", "kx");
});

check('a bare equals is spoken (heard as "so V R 20")', () => {
  assertContains(mathToSpeech("so v = 20 meters per second"), "v equals 20", "v = 20");
  assertContains(mathToSpeech("for n=1 the electron"), "n equals 1", "n=1");
  assertNotContains(mathToSpeech("peaks near A=56"), "=", "A=56");
});

check('a unit ratio is said in full (heard as "9.8 mice squared" and "200 Nmm")', () => {
  const out = mathToSpeech("that gives 9.8 m/s^2 downward, and the spring constant is 200 N/m.");
  assertContains(out, "9.8 meters per second squared", "9.8 m/s^2");
  assertContains(out, "200 newtons per meter", "200 N/m");
});

check("the denominator of a unit ratio is singular", () => {
  assertNotContains(mathToSpeech("20 m/s"), "per seconds", "20 m/s");
});

check("a ratio of variables is said as over, not as a unit", () => {
  assertContains(mathToSpeech("the current is V/R"), "V over R", "V/R");
  assertContains(mathToSpeech("the wavelength is h/p"), "h over p", "h/p");
  assertContains(mathToSpeech("the period is 2 pi/T"), "pi over T", "2 pi/T");
});

check('scientific notation is unpacked (heard as "six point six times six thirty-four")', () => {
  const out = mathToSpeech("Planck's constant is 6.626e-34 joule seconds");
  assertContains(out, "times ten to the minus 34", "6.626e-34");
  assertNotContains(out, "e-34", "6.626e-34");
  assertContains(mathToSpeech("about 8.99e9 newton"), "times ten to the 9", "8.99e9");
});

check('a decimal fraction is read digit by digit (heard as "eight point ninety-nine")', () => {
  assertContains(mathToSpeech("about 8.99 newton"), "8 point 9 9", "8.99");
  assertContains(mathToSpeech("lambda is 6.626 nanometres"), "6 point 6 2 6", "6.626");
});

check('a letter subscript opens up (v_rms heard as "v arms", k_e lost its e)', () => {
  assertContains(mathToSpeech("the speed v_rms is larger"), "v r m s", "v_rms");
  assertContains(mathToSpeech("the average speed v_avg"), "v average", "v_avg");
  assertContains(mathToSpeech("here k_e is Coulomb's constant"), "k e", "k_e");
  assertContains(mathToSpeech("so F_up equals F_down"), "F up equals F down", "F_up");
});

check("a Greek base or a Greek subscript opens up too", () => {
  assertContains(mathToSpeech("μ_s is the static coefficient"), "mu s", "μ_s");
  assertContains(mathToSpeech("the radiance B_λ per unit area"), "B lambda", "B_λ");
  assertNotContains(mathToSpeech("ω_spring equals"), "_", "ω_spring");
});

check("two underscores in one identifier both open (max_path_sum)", () => {
  const out = mathToSpeech("the function max_path_sum takes the root");
  assertContains(out, "max path sum", "max_path_sum");
  assertNotContains(out, "_", "max_path_sum");
});

check("a chemistry subscript keeps its own spacing", () => {
  assertContains(mathToSpeech("H_2O"), "H 2 O", "H_2O");
  assertContains(mathToSpeech("KMnO_4 turns colourless"), "KMnO 4", "KMnO_4");
});

check('a number glued to symbols splits (2gh heard as "two g f")', () => {
  assertContains(mathToSpeech("the square root of 2gh"), "2 g h", "2gh");
});

check("an orbital label is left alone, and so is an ordinal", () => {
  const orbitals = mathToSpeech("the 3s orbital fills before 3p, and 4s before 3d.");
  assertContains(orbitals, "3s orbital", "3s");
  assertContains(orbitals, "4s before 3d", "4s");
  assertContains(mathToSpeech("the 4th largest value"), "4th", "4th");
});

check("a mean bracket and an absolute value are spoken", () => {
  const out = mathToSpeech("the mean speed <v> and the magnitude |q| set the field");
  assertContains(out, "v average", "<v>");
  assertContains(out, "the magnitude of q", "|q|");
  assertNotContains(out, "<", "<v>");
  assertNotContains(out, "|", "|q|");
});

check("the narration's own word is not repeated after |q|", () => {
  assertNotContains(
    mathToSpeech("the magnitude |q| sets the field"),
    "magnitude the magnitude",
    "the magnitude |q|",
  );
});

check("a comparison chain is spoken, and <v> is gone before it runs", () => {
  assertContains(mathToSpeech("so we expect Na < Mg < Al"), "less than", "Na < Mg < Al");
  assertContains(mathToSpeech("the region Gauss r>R"), "greater than", "r>R");
});

check("a lone hyphen between symbols is a minus", () => {
  assertContains(mathToSpeech("the point (R, X_L - X_C)"), "X L minus X C", "X_L - X_C");
  assertContains(mathToSpeech("the level at -13.6 eV"), "minus 13.6 eV", "-13.6 eV");
});

check("a hyphen inside a word is not a minus", () => {
  assertContains(mathToSpeech("a well-known result"), "well-known", "well-known");
  assertContains(mathToSpeech("the de Broglie wavelength"), "de Broglie", "de Broglie");
});

check('a signed exponent is spoken (Br^- read as "Br to the power of")', () => {
  assertContains(mathToSpeech("Br^- is attracted to C3"), "Br minus", "Br^-");
  assertContains(mathToSpeech("the process gives e^(-)"), "e minus", "e^(-)");
  assertContains(mathToSpeech("dimensions M^-1 L^-3"), "to the power of minus 1", "M^-1");
});

check("a board paren script group loses its brackets", () => {
  assertContains(mathToSpeech("write x^(2) on the board"), "x to the power of 2", "x^(2)");
});

check("a differential rides with its symbol (dp heard as a dropped word)", () => {
  assertContains(mathToSpeech("the change in momentum dp over dt"), "d p over d t", "dp over dt");
  assertContains(mathToSpeech("the induced emf is minus L dI/dt"), "d I by d t", "dI/dt");
});

check("do, de and dB are not differentials", () => {
  assertContains(mathToSpeech("do the substitution"), "do the", "do the substitution");
  assertContains(mathToSpeech("the de Broglie relation"), "de Broglie", "de Broglie");
  assertContains(mathToSpeech("a gain of 3 dB"), "dB", "3 dB");
});

check("an antibonding orbital carries a star, not a product", () => {
  assertContains(mathToSpeech("the σ*2s level fills first"), "sigma star", "σ*2s");
  assertContains(mathToSpeech("the π*2p level is empty"), "pi star", "π*2p");
});

check("a backtick never reaches the voice", () => {
  assertNotContains(mathToSpeech("use `prev` to walk the list"), "`", "`prev`");
});

check("every Greek letter becomes a word", () => {
  const greek = "σ ε τ η Φ χ δ ξ ζ ι κ υ Γ Θ Λ Ξ Π Υ Ψ";
  const out = mathToSpeech(greek);
  assert(!/[Ͱ-Ͽ]/.test(out), `Expected no raw Greek character to survive, got "${out}"`);
});

console.log("\nPhase 5b — Real narration lines, nothing left for the voice to guess\n");

/**
 * Taken verbatim from stored lecture transcripts. `.lecture-lab` is not
 * committed, so the sweep that ranked these lines lives in the probe; the
 * lines it ranked are kept here so the rules cannot silently regress.
 */
const NARRATION_CORPUS = [
  "The weight mg acts straight down, and the components mg sinθ and mg cosθ split the weight.",
  "When pushing up, friction acts down the plane, so F_up equals mg sinθ plus μN.",
  "So 4μ mg cosθ equals 2mg sinθ, and mg cancels.",
  "Here k_e is Coulomb's constant, about 8.99e9 newton meter squared per coulomb squared.",
  "the upward spring force kx must balance the downward weight mg.",
  "so v = 20 m/s and the acceleration a = 2 m/s^2.",
  "Planck's constant is 6.626e-34 joule seconds, and the electron charge is 1.60e-19 coulombs.",
  "the root mean square speed v_rms is larger than the average speed v_avg.",
  "the mean speed <v> depends on temperature, and the magnitude |q| sets the field.",
  "for n=1 the electron sits in the ground state, and for n=2 it is one level up.",
  "the speed at the bottom is the square root of 2gh.",
  "The isotherm at T_h is the top curve, and the isotherm at T_c is the bottom curve.",
  "The impedance Z is the hypotenuse, from the origin to the point (R, X_L - X_C).",
  "The Bohr model gives E_n equals minus 13.6 electronvolts over n squared.",
  "the purple colour of KMnO_4 disappears and a brown precipitate of MnO_2 appears.",
];

const LEFT_FOR_THE_VOICE: [string, RegExp][] = [
  ["an underscore subscript", /[A-Za-z]_[A-Za-z0-9]/],
  ["a bare equals sign", /=/],
  ["a raw unit ratio", /\d\s*[A-Za-z]{1,3}\s*\/\s*[A-Za-z]{1,3}/],
  ["scientific notation", /(?<![A-Za-z])\d+(?:\.\d+)?[eE][-+]?\d+(?![\d.])/],
  ["a glued weight", /(?<![A-Za-z0-9])(?<!\d\s)mg(?![A-Za-z0-9])/],
  ["an angle bracket mean", /<\s*[A-Za-z]/],
  ["absolute value bars", /\|/],
  ["a backtick", /`/],
  ["a raw Greek character", /[Ͱ-Ͽ]/],
];

check(`${NARRATION_CORPUS.length} stored narration lines leave nothing for the voice to guess`, () => {
  for (const narration of NARRATION_CORPUS) {
    const spoken = mathToSpeech(narration.trim());
    for (const [label, pattern] of LEFT_FOR_THE_VOICE) {
      const hit = pattern.exec(spoken);
      if (hit) {
        throw new Error(
          `${label} ("${hit[0]}") survived into speech:\n  in : ${narration}\n  out: ${spoken}`,
        );
      }
    }
  }
});

console.log("\nPhase 5c — The pen still finds the board label inside the sentence\n");

/**
 * `getCueSpeechWindow` searches for a board label inside the spoken narration,
 * and both sides go through `mathToSpeech`. A rule that rewrote one side but
 * not the other would park the pen: the label would never be found and the
 * command would fall back to the cursor. So every rewritten label is checked
 * against the sentence it belongs to.
 */
const CUE_PAIRS: [string, string][] = [
  ["mg", "this arrow is mg, the weight, and it points straight down."],
  ["mg sinθ", "this arrow is mg sinθ, the part of the weight pulling along the slope."],
  ["mg cosθ", "and mg cosθ presses the block into the surface."],
  ["F_up", "so F_up equals mg sinθ plus μN."],
  ["v_rms", "the root mean square speed v_rms is larger than the average speed."],
  ["k_e", "here k_e is Coulomb's constant."],
  ["T_A", "the tension arrows T_A and T_B hold the loop."],
  ["θ = 30°", "the angle θ = 30° is measured up from the horizontal."],
  ["N", "the normal force N acts perpendicular to the incline."],
  ["kx", "the upward spring force kx must balance the weight."],
  ["x", "the extension x is measured from the natural length."],
];

check(`${CUE_PAIRS.length} board labels are still found in their spoken sentence`, () => {
  for (const [label, narration] of CUE_PAIRS) {
    const spoken = mathToSpeech(narration.trim());
    const token = mathToSpeech(label).trim();
    if (findSpokenToken(spoken, token) < 0) {
      throw new Error(
        `board label "${label}" (spoken "${token}") is not in its own sentence:\n  ${spoken}`,
      );
    }
  }
});

console.log("\nNotation audit — written modifiers survive into speech and cues\n");

const DECORATED_SYMBOL_READINGS: [string, string][] = [
  ["v\u0304", "v bar"],
  ["\u0101", "a bar"],
  ["x\u0302", "x hat"],
  ["\u1e59", "r dot"],
  ["r\u0308", "r double dot"],
  ["v\u20d7", "v vector"],
  ["f\u2032", "f prime"],
  ["y\u2033", "y double prime"],
  ["\u03b8\u2032", "theta prime"],
  ["v\u2080", "v 0"],
  ["T\u2081", "T 1"],
  ["H\u2082O", "H 2 O"],
  ["v\u0304\u2080", "v bar 0"],
  ["x\u2212y", "x minus y"],
];

for (const [input, expected] of DECORATED_SYMBOL_READINGS) {
  check(`${JSON.stringify(input)} has an explicit modifier reading`, () => {
    assert(mathToSpeech(input) === expected, `Expected ${JSON.stringify(input)} to read ${JSON.stringify(expected)}, got ${JSON.stringify(mathToSpeech(input))}`);
    const narration = `Now ${input} is the quantity we compare.`;
    assert(findSpokenToken(mathToSpeech(narration), mathToSpeech(input)) >= 0, `The cue for ${JSON.stringify(input)} must match its own spoken sentence`);
  });
}

check("a combining vector can multiply the adjacent scalar", () => {
  assertContains(mathToSpeech("a\u20d7t"), "a vector t", "a\u20d7t");
});

check("Unicode primes agree with the established ASCII prime spelling", () => {
  for (const [unicode, ascii] of [["f′(x)", "f'(x)"], ["y″", "y''"], ["x₀′", "x_0'"]]) {
    assert(mathToSpeech(unicode!) === mathToSpeech(ascii!), `Equivalent prime spellings must agree: ${unicode}`);
  }
});

for (const [expression, label] of [["2v′", "v′"], ["0.25v′", "v′"], ["6.2e−3θ′", "θ′"], ["2v_A′", "v_A′"], ["2v̄₀′", "v̄₀′"]]) {
  check(`a primed quantity in ${expression} retains its actual speech cue`, () => {
    const narration = `First ${label![0]}, next ${expression}, finally ${label![0]} again.`;
    const spoken = mathToSpeech(narration);
    const reading = mathToSpeech(label!).trim();
    const index = spoken.indexOf(reading);
    const window = getCueSpeechWindow(narration, { token: label!, entityId: "primed-quantity" }, {
      charStartTimes: Array.from(spoken, (_, position) => position * 0.01),
      charDurations: Array.from(spoken, () => 0.01), totalDuration: spoken.length * 0.01,
    });
    assert(window.matched, `The actual cue ${label} must match inside ${expression}; speech was ${spoken}`);
    assert(index > 0 && window.startMs === index * 10, "The primed cue must anchor after the earlier plain letter");
    assert(normalizeForSpeechMatch(expression!).includes(normalizeForSpeechMatch(label!)), "A numeric coefficient must preserve its primed symbol reading");
  });
}

check("allowing a coefficient before a primed letter does not reinterpret numeric angle marks", () => {
  assert(mathToSpeech("2′ 20″") === "2′ 20″", "Numeric angle minutes and seconds stay distinct from letter-attached primes");
  assert(mathToSpeech("word′ and version2′") === "word′ and version2′", "Unicode marks after words or numbers are not single-letter math primes");
});

check("a Unicode minus retains its role in scientific notation", () => {
  assert(mathToSpeech("6.626e−34") === mathToSpeech("6.626e-34"), "Unicode and ASCII negative scientific exponents must agree");
});

check("the MICRO SIGN prefix matches the unit the narration names", () => {
  assert(mathToSpeech("2 µC") === "2 microcoulombs", "The explicit microcoulomb unit must reach speech");
  assert(normalizeForSpeechMatch("µC") === normalizeForSpeechMatch("microcoulombs"), "The actual sync normalizer must retain the micro prefix");
  assert(mathToSpeech("5 µF") === "5 microfarads", "Micro units use the existing generic unit vocabulary");
  assertContains(mathToSpeech("the coefficient μ_s"), "mu s", "μ_s");
  assertNotContains(mathToSpeech("unknown µX"), "micro", "unknown µX");
  assertContains(mathToSpeech("unknown µX"), "µ", "unknown µX");
});

check("micro units keep attached powers and do not consume identifier prefixes", () => {
  assert(mathToSpeech("2 µm²") === "2 micrometers squared", "A micro-unit must retain its square power");
  assert(mathToSpeech("3 µm³") === "3 micrometers cubed", "A micro-unit must retain its cube power");
  assert(mathToSpeech("2 µm/s²") === "2 micrometers per second squared", "Known micro-unit ratios retain their denominator and power");
  assert(mathToSpeech("in C/µs") === "in coulombs per microsecond", "Micro prefixes can modify the known denominator");
  assert(mathToSpeech("2e-3µm/s^2") === mathToSpeech("2e-3 micrometers per second squared"), "Unit ratios preserve a preceding scientific quantity");
  for (const identifier of ["µC_name", "µC2", "µCode", "2 m/µC_name", "2 µC_name/s"]) {
    assertNotContains(mathToSpeech(identifier), "micro", identifier);
  }
  assertContains(mathToSpeech("4μN"), "mu N", "4μN");
});

check("board normalization preserves the MICRO SIGN through actual speech cue matching", () => {
  const label = normalizeBoardText("q = 2µC");
  assert(label.includes("µC"), "A drawing shape alias must preserve the source unit text");
  const narration = "Earlier q, now q equals 2 microcoulombs, then q again.";
  const spoken = mathToSpeech(narration);
  const index = spoken.indexOf("q equals 2 microcoulombs");
  const window = getCueSpeechWindow(narration, { token: label, entityId: "charge" }, {
    charStartTimes: Array.from(spoken, (_, position) => position * 0.01),
    charDurations: Array.from(spoken, () => 0.01), totalDuration: spoken.length * 0.01,
  });
  assert(mathToSpeech(label) === "q equals 2 microcoulombs", "The parsed label must name its explicit micro unit");
  assert(window.matched && window.startMs === index * 10, "The micro-unit cue must anchor on the full quantity reading");
  assertContains(mathToSpeech(normalizeBoardText("μN")), "mu N", "μN");
});

check("actual cue alignment keeps the modifier and skips an earlier plain letter", () => {
  for (const [label, reading] of [["v̄", "v bar"], ["v⃗_A/B", "v vector A over B"], ["f′", "f prime"], ["r̈", "r double dot"]]) {
    const narration = `First ${label![0]}, then ${reading}, then ${label![0]} again.`;
    const spoken = mathToSpeech(narration);
    const index = spoken.indexOf(reading!);
    assert(index > 0, "The decorated cue follows an earlier undecorated symbol");
    const window = getCueSpeechWindow(narration, { token: label!, entityId: "source-symbol" }, {
      charStartTimes: Array.from(spoken, (_, position) => position * 0.01),
      charDurations: Array.from(spoken, () => 0.01), totalDuration: spoken.length * 0.01,
    });
    assert(window.matched && window.startMs === index * 10, `Actual cue must anchor ${label} on its modifier reading, not its earlier plain letter`);
    assert(normalizeForSpeechMatch(label!) === normalizeForSpeechMatch(reading!), `Normalized ${label} must agree with the spoken modifier`);
    assert(normalizeForSpeechMatch(label!) !== normalizeForSpeechMatch(label![0]!), "The sync normalizer must retain the modifier's meaning");
  }
  assert(normalizeForSpeechMatch("v₀") === normalizeForSpeechMatch("v zero"), "Unicode subscript zero must match the ordinary spoken number");
});

check("ordinary accents, apostrophes, numeric angle marks and code punctuation stay intact", () => {
  const prose = "Māori café déjà vu Ångström and Coulomb's law; let's compare.";
  assert(mathToSpeech(prose) === prose, "Decorated symbol rules must preserve ordinary prose accents and possessives");
  assert(mathToSpeech("30′ 20″") === "30′ 20″", "Numeric angle marks remain ambiguous and must not be silently called symbol primes");
  assert(mathToSpeech("arr[i]++ and node.next") === "arr[i]++ and node.next", "Code punctuation must retain its existing reading");
  assert(mathToSpeech("r\u0304adius") === "r\u0304adius", "An accent inside an ordinary word is not a decorated variable");
  assertContains(mathToSpeech("x/y = 1/2"), "x over y equals 1 over 2", "x/y = 1/2");
});

// The actual prefetch producer must send the same normalized text to HTTP.
// The fake transport terminates before audio/credentials, with no network.
const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
const socketDescriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
let receiveText!: (text: string) => void;
const sentText = new Promise<string>((resolve) => { receiveText = resolve; });
const client = new StreamingSpeechClient();
let watchdog: ReturnType<typeof setTimeout> | undefined;
try {
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: class { static readonly OPEN = 1; } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (input: unknown, init?: RequestInit) => {
    assert(String(input) === "/api/tts/stream", "Only the intercepted TTS transport is permitted");
    const payload = JSON.parse(String(init?.body)) as { text: string };
    receiveText(payload.text);
    return new Response(null, { status: 200, headers: { "x-heytutor-tts-skipped": "test" } });
  } });
  client.prefetchSegment("Compare v̄ and v⃗_A/B with f′ and v₀, then q=2µC.");
  const payload = await Promise.race([sentText, new Promise<never>((_resolve, reject) => {
    watchdog = setTimeout(() => reject(new Error("Actual TTS prefetch did not submit its text")), 1000);
  })]);
  check("actual HTTP prefetch payload retains written modifiers", () => {
    assert(payload === "Compare v bar and v vector A over B with f prime and v 0, then q equals 2 microcoulombs.", `Unexpected actual TTS payload: ${payload}`);
  });
} finally {
  if (watchdog !== undefined) clearTimeout(watchdog);
  client.stop();
  if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor); else Reflect.deleteProperty(globalThis, "fetch");
  if (socketDescriptor) Object.defineProperty(globalThis, "WebSocket", socketDescriptor); else Reflect.deleteProperty(globalThis, "WebSocket");
}

console.log(`\n───────────────────────────────────`);
console.log(`All ${passed} checks passed ✓`);
