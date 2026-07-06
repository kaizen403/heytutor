import { mathToSpeech } from "../src/elevenLabsClient";

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

console.log(`\n───────────────────────────────────`);
console.log(`All ${passed} checks passed ✓`);
