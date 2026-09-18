/**
 * The lesson text as the voice should say it.
 *
 * Every spoken segment goes through `mathToSpeech` before it reaches
 * ElevenLabs, on both the socket and the HTTP path, and the same function is
 * applied to a board label before it is searched for inside the narration. So
 * this file decides two things at once: what the student hears, and where the
 * pen believes each word sits. A rule added here must be safe for both.
 *
 * Why the rules below exist, measured on 18 Sep 2026 by generating each line
 * with the real tutor voice and dials and transcribing it back
 * (`apps/tutor/scripts/live/probe-speech-pronunciation.mjs` replays it). The
 * narration was left exactly as the teaching model writes it, taken from the
 * stored lecture transcripts:
 *
 *   "this arrow is mg sinθ"         heard as  "this arrow is maximum theta"
 *   "the downward weight mg"        heard as  "the downward weight on j"
 *   "plus 0.5mg cosine theta"       heard as  "plus 0.5 millillion cosine theta"
 *   "the spring force kx"           heard as  "the spring force Gx" / "case"
 *   "so v = 20 m/s"                 heard as  "so V R 20 NCs"
 *   "9.8 m/s^2 ... 200 N/m"         heard as  "9.8 mice squared ... 200 Nmm"
 *   "6.626e-34 joule seconds"       heard as  "six point six times six thirty-four"
 *   "the speed v_rms"               heard as  "the speed v arms"
 *   "here k_e is Coulomb's"         heard as  "here k is Coulomb's"
 *   "the mean speed <v>"            heard as  "the mean speed" (dropped)
 *   "the magnitude |q|"             heard as  "the magnitude sigma"
 *   "for n=1 the electron"          heard as  "for n1, the electron"
 *   "the square root of 2gh"        heard as  "the square root of two g f"
 *
 * The headline case is worth naming, because it is not the one it looks like.
 * "sine theta" was never the broken word. A glued `mg` in front of it made the
 * voice guess at a longer abbreviation and swallow the word after it, which is
 * how "mg sine theta" came out as "maximum theta". Spacing the product fixed
 * the trig word without touching any trig rule.
 *
 * Counted across the 22,671 spoken narration lines in `.lecture-lab`: 1,986
 * underscore subscripts, 1,677 raw operator characters (671 of them a bare
 * `=`), 748 numbers glued to a symbol, and 2,079 symbol letter clusters. Those
 * are the four rule groups below.
 *
 * What is deliberately NOT rewritten, because the round trip showed the voice
 * already says it correctly and a rule would only add risk: uppercase symbol
 * products (`PV`, `nRT`, `qE`, `qvB`, `GM`, `kT`, `eV`, `Cv`, `Cp`, `XL`,
 * `XC`), orbital labels (`3s`, `3p`, `4s`, `3d`), and a spaced unit after a
 * number (`5 mg` stays milligrams).
 */

/** Insert spaces so `cosθ` and `2θ` tokenize like spoken math. */
function spaceGreekMathSymbols(text: string): string {
  return text
    .replace(/([a-z])([α-ω])/gi, "$1 $2")
    .replace(/([α-ω])([a-z0-9])/gi, "$1 $2")
    .replace(/(\d)([α-ω])/g, "$1 $2");
}

/**
 * Markdown that leaked into speech. DSA lessons quote identifiers in
 * backticks, and the voice reads the backtick as a pause or a stray sound.
 */
function stripCodeMarkup(text: string): string {
  return text.replace(/`+/g, "");
}

/**
 * `6.626e-34` and `8.99e9`. Left alone the voice either spells the literal out
 * ("6.626E-11") or invents a number ("six point six times six thirty-four").
 */
function expandScientificNotation(text: string): string {
  return text.replace(
    /(?<![A-Za-z])(\d+(?:\.\d+)?)[eE]([-+]?)(\d+)(?![\d.])/g,
    (_match, mantissa: string, sign: string, exponent: string) =>
      `${mantissa} times ten to the ${sign === "-" ? "minus " : ""}${exponent}`,
  );
}

/**
 * Unit symbols the voice has to be told to say in full. Only the symbols that
 * actually appear in a ratio in the corpus, because every entry here is also a
 * chance to mistake a variable for a unit.
 */
const UNIT_WORDS: Record<string, { plural: string; singular: string }> = {
  m: { plural: "meters", singular: "meter" },
  s: { plural: "seconds", singular: "second" },
  g: { plural: "grams", singular: "gram" },
  kg: { plural: "kilograms", singular: "kilogram" },
  cm: { plural: "centimeters", singular: "centimeter" },
  mm: { plural: "millimeters", singular: "millimeter" },
  km: { plural: "kilometers", singular: "kilometer" },
  nm: { plural: "nanometers", singular: "nanometer" },
  N: { plural: "newtons", singular: "newton" },
  J: { plural: "joules", singular: "joule" },
  kJ: { plural: "kilojoules", singular: "kilojoule" },
  C: { plural: "coulombs", singular: "coulomb" },
  K: { plural: "kelvin", singular: "kelvin" },
  V: { plural: "volts", singular: "volt" },
  A: { plural: "amperes", singular: "ampere" },
  W: { plural: "watts", singular: "watt" },
  Hz: { plural: "hertz", singular: "hertz" },
  Pa: { plural: "pascals", singular: "pascal" },
  T: { plural: "tesla", singular: "tesla" },
  rad: { plural: "radians", singular: "radian" },
  mol: { plural: "moles", singular: "mole" },
  L: { plural: "litres", singular: "litre" },
  F: { plural: "farads", singular: "farad" },
  H: { plural: "henries", singular: "henry" },
  Wb: { plural: "webers", singular: "weber" },
  eV: { plural: "electron volts", singular: "electron volt" },
  "\u03a9": { plural: "ohms", singular: "ohm" },
};

const POWER_WORDS: Record<string, string> = {
  "2": "squared",
  "3": "cubed",
  "²": "squared",
  "³": "cubed",
};

/**
 * `200 N/m` and `9.8 m/s^2`. Heard raw as "200 Nmm" and "9.8 mice squared".
 *
 * Both sides must be known unit symbols AND a number or the word "in" must
 * introduce the ratio, so a ratio of variables (`V/R`, `F/A`, `h/p`) is left
 * for the general "over" rule below rather than being read as farads per
 * ampere.
 */
function expandUnitRatios(text: string): string {
  const ratio = "([A-Za-zΩ]{1,3})\\s*/\\s*([A-Za-zΩ]{1,3})(\\^?[23]|[²³])?";
  const say = (numerator: string, denominator: string, power?: string): string | null => {
    const top = UNIT_WORDS[numerator];
    const bottom = UNIT_WORDS[denominator];
    if (!top || !bottom) return null;
    const exponent = power ? POWER_WORDS[power.replace("^", "")] : undefined;
    // "meters per second", never "meters per seconds": the denominator names
    // one of the unit, which is why it is stored in both forms.
    return `${top.plural} per ${bottom.singular}${exponent ? ` ${exponent}` : ""}`;
  };

  return text
    .replace(
      new RegExp(`(\\d(?:[\\d.,]*\\d)?)(\\s*)${ratio}`, "g"),
      (match, value: string, gap: string, top: string, bottom: string, power?: string) =>
        say(top, bottom, power) === null ? match : `${value}${gap || " "}${say(top, bottom, power)}`,
    )
    .replace(
      new RegExp(`\\b(in|per)\\s+${ratio}`, "g"),
      (match, lead: string, top: string, bottom: string, power?: string) =>
        say(top, bottom, power) === null ? match : `${lead} ${say(top, bottom, power)}`,
    );
}

/**
 * What a multi-letter subscript is called out loud. Anything not listed is
 * spoken as the word it already is (`v_net` is "v net", `stack_out` is
 * "stack out"), which is the house rule: a subscript is said by its letters
 * alone, never as "v sub net".
 */
const SUBSCRIPT_WORDS: Record<string, string> = {
  rms: "r m s",
  avg: "average",
  eff: "effective",
  tot: "total",
  emf: "e m f",
};

/**
 * `v_rms`, `k_e`, `F_up`, `T_A`, `mu_0`, `stack_out`.
 *
 * 1,986 of these reach the voice per corpus sweep and the underscore is read
 * unpredictably: `v_rms` came back as "v arms" and `k_e` lost its subscript
 * entirely. Chemistry subscripts (`H_2O`) are left for the chemistry rule,
 * which pads them differently.
 */
function expandSubscripts(text: string): string {
  // Greek on both sides: `\u03bc_s` and `B_\u03bb` are as common as `v_rms`, and the
  // Greek letter only becomes the word "mu" further down the chain.
  const letter = "[A-Za-z\\u0370-\\u03ff]";
  const lettered = new RegExp(`(${letter})_(${letter}[A-Za-z0-9\\u0370-\\u03ff]*)`, "g");
  const numbered = new RegExp(`([a-z\\u0370-\\u03ff])_(\\d+)`, "g");
  const once = (input: string): string =>
    input
      .replace(lettered, (_match, base: string, subscript: string) =>
        `${base} ${SUBSCRIPT_WORDS[subscript.toLowerCase()] ?? subscript}`)
      .replace(numbered, "$1 $2");
  // `max_path_sum` holds two underscores whose matches overlap by one letter,
  // so a single pass left the second one in ("max path_sum"). Three passes
  // cover every identifier the corpus holds; the guard is for safety, not use.
  let current = text;
  for (let pass = 0; pass < 4; pass++) {
    const expanded = once(current);
    if (expanded === current) break;
    current = expanded;
  }
  return current;
}

/**
 * Symbol products the voice mangles when their letters are glued together.
 *
 * This list is short on purpose. Every entry was heard failing in the round
 * trip; the uppercase products it does not contain were heard correctly and
 * splitting them would only make the lecture sound spelled out.
 */
function expandSymbolProducts(text: string): string {
  return text
    // "2mg" and "0.5mg" are a coefficient times m times g. "2 mg" with a space
    // is two milligrams and is left alone.
    .replace(/(\d+(?:\.\d+)?)mg(?![A-Za-z0-9])/g, "$1 m g")
    .replace(/(?<![A-Za-z0-9])(?<!\d\s)mg(?![A-Za-z0-9])/g, "m g")
    .replace(/(?<![A-Za-z0-9])kx(?![A-Za-z0-9])/g, "k x")
    // A differential rides with the letter it differentiates: "dp over dt" was
    // heard as "d over dt", losing the momentum. "do" is a word and "dB" is a
    // decibel, so neither is a differential, and the `d` of `d/dx` belongs to
    // the derivative rule that already ran.
    .replace(/(?<![A-Za-z0-9/])d([A-Za-z])(?![A-Za-z0-9])/g, (match, symbol: string) =>
      DIFFERENTIAL_LOOKALIKES.has(match) ? match : `d ${symbol}`);
}

/**
 * A derivative written as a fraction: `dv/dt`, `dT/dx`, `∂P/∂V`. Said as a
 * fraction of two glued pairs the voice loses one of them, and the bare `/`
 * rule below would read it as "dv over dt" with both pairs still glued. The
 * plain `d/dx` form keeps its own spelling, which the notation rules own.
 */
function expandDerivativeFractions(text: string): string {
  return text
    .replace(/(?<![A-Za-z0-9])d([A-Za-z])\s*\/\s*d([A-Za-z])(?![A-Za-z0-9])/g, " d $1 by d $2 ")
    .replace(/\u2202([A-Za-z])\s*\/\s*\u2202([A-Za-z])(?![A-Za-z0-9])/g,
      " partial $1 by partial $2 ");
}

/**
 * Two-letter words that start with a `d` and are not a differential: "do" is
 * a verb, "de" opens "de Broglie", and "dB" is a decibel.
 */
const DIFFERENTIAL_LOOKALIKES = new Set(["do", "de", "dB"]);

/** Unit symbols that are already said correctly when glued to a number. */
const GLUED_UNIT_SYMBOLS = new Set([
  "kg", "cm", "mm", "km", "nm", "mol", "rad", "ms", "Hz", "eV", "mg", "min", "Pa", "Wb", "kJ",
]);
/** `1s` to `7f` is an electron orbital, and the voice already says it right. */
const ORBITAL_LETTERS = new Set(["s", "p", "d", "f"]);
const ORDINAL_SUFFIXES = new Set(["st", "nd", "rd", "th"]);

/**
 * `2gh`, `2a`, `2R`. The glue is what marks a product: the teaching prompt
 * writes a real quantity as "20 m" with a space. Heard raw, "the square root
 * of 2gh" came back as "the square root of two g f".
 */
function expandGluedCoefficients(text: string): string {
  return text.replace(
    /(?<![A-Za-z])(\d+(?:\.\d+)?)([A-Za-z]{1,3})(?![A-Za-z0-9])/g,
    (match, value: string, letters: string) => {
      if (GLUED_UNIT_SYMBOLS.has(letters)) return match;
      if (ORDINAL_SUFFIXES.has(letters.toLowerCase())) return match;
      if (letters.length === 1 && ORBITAL_LETTERS.has(letters) && /^[1-7]$/.test(value)) {
        return match;
      }
      return `${value} ${letters.split("").join(" ")}`;
    },
  );
}

/**
 * `<v>` and `|q|`. The angle brackets were dropped along with the symbol
 * inside them ("the mean speed depends on temperature"), and `|q|` was read as
 * a Greek letter.
 */
function expandBrackets(text: string): string {
  return text
    .replace(/<\s*([A-Za-z][A-Za-z0-9 ]{0,12}?)\s*>/g, " $1 average ")
    .replace(/\|\s*([A-Za-z0-9][A-Za-z0-9 ]{0,12}?)\s*\|/g, " the magnitude of $1 ");
}

/**
 * Operators the teaching model leaves in spoken text. `=` is the common one at
 * 671 occurrences: "so v = 20" was heard as "so V R 20" and "for n=1" as "for
 * n1". A ratio of symbols that survived the unit rule is said as "over", which
 * is how a teacher reads `V/R` and `dv/dt` alike.
 */
const GREEK_WORDS =
  "pi|theta|mu|lambda|omega|rho|phi|psi|alpha|beta|gamma|nu|sigma|delta|tau|eta|kappa|chi";
const OVER_SIDE = new RegExp(
  `^(?:\\d+(?:\\.\\d+)?|[A-Za-z]|[A-Za-z]\\d|[A-Za-z][A-Z]|[A-Z]{2,3}|${GREEK_WORDS})$`,
);

function expandOperators(text: string): string {
  return text
    .replace(/\s*(?:<=|=<)\s*/g, " less than or equal to ")
    .replace(/\s*(?:>=|=>)\s*/g, " greater than or equal to ")
    .replace(/\s*!=\s*/g, " not equal to ")
    // A comparison chain ("Na < Mg < Al") and a glued one ("Gauss r>R") both
    // reach the voice. `<v>` is already gone by here, so no mean survives.
    .replace(/\s*<\s*/g, " less than ")
    .replace(/\s*>\s*/g, " greater than ")
    .replace(/\s*=\s*/g, " equals ")
    .replace(/\s*->\s*/g, " to ")
    // An antibonding orbital carries a star, not a product: the corpus writes
    // it as "sigma*2s" and "pi*2p".
    .replace(/\b(pi|sigma|delta|phi)\s*\*/gi, "$1 star ")
    .replace(/([A-Za-z0-9])\s*\*\s*([A-Za-z0-9])/g, "$1 times $2")
    // A lone hyphen between two symbols is a minus sign: the teaching prompt
    // forbids a dash as punctuation, so nothing else spells it this way.
    .replace(/([A-Za-z0-9)])\s+[-\u2212]\s+(?=[A-Za-z0-9(])/g, "$1 minus ")
    .replace(/(^|[\s(])[-\u2212](?=\d)/g, "$1minus ")
    .replace(/\/\s*\(/g, " over (")
    .replace(
      /(?<![A-Za-z0-9])([A-Za-z0-9]{1,5})\s*\/\s*([A-Za-z0-9]{1,5})(?![A-Za-z0-9])/g,
      (match, top: string, bottom: string) =>
        OVER_SIDE.test(top) && OVER_SIDE.test(bottom) ? `${top} over ${bottom}` : match,
    );
}

/**
 * A decimal fraction is read digit by digit, the way it is dictated in class.
 * Left whole the voice groups the digits: "6.626" came back as "six point six
 * twenty-six" and "8.99" as "eight point ninety-nine".
 */
function expandDecimalFractions(text: string): string {
  return text.replace(/(\d)\.(\d{2,})(?![\d.])/g, (_match, whole: string, fraction: string) =>
    `${whole} point ${fraction.split("").join(" ")}`);
}

/**
 * The rule chain produces padded fragments (" degrees ", " equals "). Left in,
 * the voice reads a space before a comma as a hesitation, and every extra
 * character shifts the alignment index the pen follows.
 */
function tidySpokenSpacing(text: string): string {
  return text
    // The narration often already says the word: "the magnitude |q|" expands
    // to "the magnitude the magnitude of q".
    .replace(/\b(?:the\s+)?magnitude\s+(?:of\s+)?(?=the magnitude of\b)/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ([,.;:!?])/g, "$1")
    .trim();
}

/**
 * The chemistry, calculus, and symbol rules, as the original `mathToSpeech`
 * held them; `verify-speech-notation` pins every one of them. The signed
 * exponents just below the ion-charge rule are the one addition: a bare `^-`
 * was falling through to the generic power rule, so `Br^-` was read as "Br to
 * the power of, is attracted", and `x^(2)` kept its brackets.
 */
function expandNotationSymbols(text: string): string {
  return text
    .replace(/([A-Z][a-z]?)_(\d+)/g, "$1 $2 ")
    .replace(/([A-Za-z0-9]+)\^(\d+)([-+])/g, (_m, formula: string, num: string, sign: string) =>
      `${formula} ${num} ${sign === "-" ? "minus" : "plus"} `)
    .replace(/\^\(([-+])\)/g, (_m, sign: string) => (sign === "-" ? " minus " : " plus "))
    .replace(/\^\(([-+]?\d+)\)/g, (_m, exponent: string) =>
      ` to the power of ${exponent.replace("-", "minus ").replace("+", "")} `)
    .replace(/\^([-+])(\d)/g, (_m, sign: string, digit: string) =>
      ` to the power of ${sign === "-" ? "minus " : ""}${digit}`)
    .replace(/\^([-+])(?![\d(])/g, (_m, sign: string) => (sign === "-" ? " minus " : " plus "))
    .replace(/([A-Z]\w*)\+/g, "$1 plus ")
    .replace(/([A-Z]\w*)-(?=\s|,|\.|;|$)/g, "$1 minus ")
    .replace(/⇌/g, " reversible ")
    .replace(/([A-Z][a-z])\s*→/g, "$1 gives ")
    .replace(/([a-z])\s*→/g, "$1 approaches ")
    .replace(/→/g, " gives ")
    .replace(/\(s\)/g, " solid ")
    .replace(/\(l\)/g, " liquid ")
    .replace(/\(g\)/g, " gas ")
    .replace(/\(aq\)/g, " aqueous ")
    .replace(/°C/g, " degrees Celsius ")
    .replace(/°F/g, " degrees Fahrenheit ")
    .replace(/°/g, " degrees ")
    .replace(/\bmol\b/g, " mole ")
    .replace(/(\d)\s+M\b/g, "$1 molar ")
    .replace(/\bd\/dx\b/g, " d d x ")
    .replace(/\bd\/dt\b/g, " d d t ")
    .replace(/∂\/∂(\w)/g, " partial d d $1 ")
    .replace(/∂/g, " partial ")
    .replace(/\b[Ll]im\b/g, " limit ")
    .replace(/∞/g, " infinity ")
    .replace(/≤/g, " less than or equal to ")
    .replace(/≥/g, " greater than or equal to ")
    .replace(/≠/g, " not equal to ")
    .replace(/≈/g, " approximately ")
    .replace(/±/g, " plus or minus ")
    .replace(/sqrt\(([^)]+)\)/g, " square root of $1 ")
    .replace(/\bcsc\b/g, " cosecant ")
    .replace(/\bsec\b/g, " secant ")
    .replace(/\bcot\b/g, " cotangent ")
    // A prime is a mark on a symbol: f', y'', A'. It used to be read off any
    // apostrophe, so "Coulomb's law" was voiced "Coulomb prime s law" and
    // "let's" as "let prime s" (five possessives in thirty stored lessons).
    // Only a lone letter or a digit followed by nothing word-like is a prime.
    .replace(/(?<![A-Za-z])([A-Za-zͰ-Ͽ]|\d)''(?![a-z])/g, "$1 double prime ")
    .replace(/(?<![A-Za-z])([A-Za-zͰ-Ͽ]|\d)'(?![a-z])/g, "$1 prime ")
    .replace(/∇/g, " del ")
    .replace(/√\(([^)]+)\)/g, " square root of ($1) ")
    .replace(/∮/g, " contour integral of ")
    .replace(/∏/g, " product of ")
    .replace(/≡/g, " is identical to ")
    .replace(/∝/g, " is proportional to ")
    .replace(/∴/g, " therefore ")
    .replace(/∵/g, " because ")
    .replace(/∉/g, " does not belong to ")
    .replace(/∈/g, " belongs to ")
    .replace(/⊆/g, " is a subset of or equal to ")
    .replace(/⊂/g, " is a subset of ")
    .replace(/⊇/g, " is a superset of or equal to ")
    .replace(/⊃/g, " is a superset of ")
    .replace(/∪/g, " union ")
    .replace(/∩/g, " intersection ")
    .replace(/∅/g, " the empty set ")
    .replace(/∀/g, " for all ")
    .replace(/∃/g, " there exists ")
    .replace(/∠/g, " angle ")
    .replace(/[⟂⊥]/g, " perpendicular to ")
    .replace(/∥/g, " parallel to ")
    .replace(/↔/g, " ")
    .replace(/←/g, " ")
    .replace(/⇒/g, " implies ")
    .replace(/⇐/g, " ")
    .replace(/∓/g, " minus or plus ")
    .replace(/[·⋅∙]/g, " times ")
    .replace(/∫∫/g, " double integral of ")
    .replace(/\blog\b/g, " log ")
    .replace(/\bln\b/g, " natural log ")
    .replace(/\bexp\b/g, " e to the power of ")
    .replace(/(\w)²/g, "$1 squared")
    .replace(/(\w)³/g, "$1 cubed")
    .replace(/√(\d+)/g, "square root of $1")
    .replace(/√/g, " square root of ")
    .replace(/π/g, "pi")
    .replace(/θ/g, "theta")
    .replace(/μ/g, "mu")
    .replace(/λ/g, "lambda")
    .replace(/ρ/g, "rho")
    .replace(/Δ/g, "delta")
    .replace(/ν/g, "nu")
    .replace(/ω/g, "omega")
    .replace(/Ω/g, "omega")
    .replace(/Σ/g, "sigma")
    .replace(/φ/g, "phi")
    .replace(/ψ/g, "psi")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/γ/g, "gamma")
    // The rest of the alphabet. Sigma, epsilon, tau and eta alone accounted
    // for 144 raw Greek characters reaching the voice across the stored
    // lectures, spoken as whatever the model made of the glyph.
    .replace(/[σς]/g, "sigma")
    .replace(/ε/g, "epsilon")
    .replace(/τ/g, "tau")
    .replace(/η/g, "eta")
    .replace(/δ/g, "delta")
    .replace(/ζ/g, "zeta")
    .replace(/ι/g, "iota")
    .replace(/κ/g, "kappa")
    .replace(/ξ/g, "xi")
    .replace(/υ/g, "upsilon")
    .replace(/χ/g, "chi")
    .replace(/Γ/g, "gamma")
    .replace(/Θ/g, "theta")
    .replace(/Λ/g, "lambda")
    .replace(/Ξ/g, "xi")
    .replace(/Π/g, "pi")
    .replace(/Υ/g, "upsilon")
    .replace(/Φ/g, "phi")
    .replace(/Ψ/g, "psi")
    .replace(/\bsin\b/gi, "sine")
    .replace(/\bcos\b/gi, "cosine")
    .replace(/\btan\b/gi, "tangent")
    .replace(/×/g, " times ")
    .replace(/÷/g, " divided by ")
    .replace(/∑/g, " sum of ")
    .replace(/∫/g, " integral of ")
    .replace(/\^2/g, " squared")
    .replace(/\^3/g, " cubed")
    .replace(/\^/g, " to the power of ");
}

/**
 * Narration in, the sentence the voice should speak out.
 *
 * The order is load bearing. Scientific notation claims its exponent before
 * anything splits a number from a letter; units claim `m/s^2` before `^2`
 * becomes the word "squared" and before a bare `/` becomes "over"; subscripts
 * open up before the chemistry rule pads `H_2O`; and the operator pass runs
 * last so it only ever sees characters no earlier rule wanted.
 */
const SPEECH_STAGES: ((text: string) => string)[] = [
  spaceGreekMathSymbols,
  stripCodeMarkup,
  expandScientificNotation,
  expandUnitRatios,
  expandSubscripts,
  expandDerivativeFractions,
  expandSymbolProducts,
  expandGluedCoefficients,
  expandNotationSymbols,
  expandBrackets,
  expandOperators,
  expandDecimalFractions,
  tidySpokenSpacing,
];

export function mathToSpeech(text: string): string {
  return SPEECH_STAGES.reduce((spoken, stage) => stage(spoken), text);
}
