/**
 * Chemical formulas as the board should write them.
 *
 * The teaching model is asked for script notation (H_2SO_4, Fe^(3+)) but
 * still writes H2SO4 and Fe3+ often enough that the pen drew full-size
 * digits. This pass rewrites a token that reads as a chemical formula into
 * the script form the handwriting engine renders: element counts become
 * subscripts and a trailing charge becomes a superscript.
 *
 * A token is a formula when it holds two or more element symbols, or one
 * element followed by a charge, or when the whole line is a reaction (an
 * arrow, an equilibrium sign, or a state symbol). A bare "R2" or "V0" on a
 * physics row is left alone.
 */

const ELEMENT_SYMBOLS = new Set([
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y",
  "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce",
  "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir",
  "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm",
  "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr",
]);

const REACTION_LINE = /(?:→|⇌|⇄|->|<=>|\((?:s|l|g|aq)\)(?![A-Za-z]))/;

/**
 * A candidate token: an optional coefficient, then symbols, digits and
 * brackets, then a trailing charge, not already scripted. A "(" may follow
 * only as a state symbol, so f(x) is never read as a formula.
 */
const FORMULA_TOKEN = /(?<![A-Za-z0-9_^([])(\d+)?((?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*|\[(?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+\]\d*)+)(\d*[+-])?(?!(?:[A-Za-z0-9_]|\((?!(?:s|l|g|aq)\))))/g;

function elementCount(body: string): number {
  let count = 0;
  const symbols = body.match(/[A-Z][a-z]?/g) ?? [];
  for (const symbol of symbols) {
    if (ELEMENT_SYMBOLS.has(symbol)) count += 1;
    else if (symbol.length === 2 && ELEMENT_SYMBOLS.has(symbol[0]!)) count += 1;
    else return -1;
  }
  return count;
}

function scriptBody(body: string): string {
  return body.replace(/([A-Z][a-z]?|\)|\])(\d+)/g, "$1_$2");
}

/**
 * Split a bare trailing charge the way a student types it: on a single
 * element the digits are the charge (Fe3+), on a polyatomic ion one digit is
 * a subscript with unit charge (NH4+) and two digits split into subscript
 * then charge (SO42-).
 */
function splitCharge(body: string, charge: string): { body: string; charge: string } {
  const sign = charge.slice(-1);
  const explicitDigits = charge.slice(0, -1);
  if (explicitDigits) return { body, charge: `${explicitDigits}${sign}` };
  const tail = /^(.*?)(\d+)$/.exec(body);
  if (!tail) return { body, charge: sign };
  const [, head, digits] = tail as unknown as [string, string, string];
  if (/[\])]$/.test(head)) return { body: head, charge: `${digits}${sign}` };
  if (digits.length >= 2) return { body: `${head}${digits.slice(0, -1)}`, charge: `${digits.slice(-1)}${sign}` };
  if (/^[A-Z][a-z]?$/.test(head) && plausibleIonCharge(head, Number(digits), sign)) {
    return { body: head, charge: `${digits}${sign}` };
  }
  return { body, charge: sign };
}

const NONMETALS = new Set(["H", "He", "B", "C", "N", "O", "F", "Ne", "Si", "P", "S", "Cl", "Ar", "As", "Se", "Br", "Kr", "Te", "I", "Xe", "At", "Rn"]);
const ANION_CHARGE: Record<string, number> = { N: 3, P: 3, As: 3, O: 2, S: 2, Se: 2, Te: 2, F: 1, Cl: 1, Br: 1, I: 1, H: 1, C: 4 };

/** Fe3+ is an ion; I3- is triiodide, so its 3 stays a subscript. */
function plausibleIonCharge(symbol: string, magnitude: number, sign: string): boolean {
  if (sign === "+") return !NONMETALS.has(symbol) && magnitude <= 4;
  return ANION_CHARGE[symbol] === magnitude;
}

export function scriptChemicalFormulas(text: string): string {
  if (!/(?:[A-Z][a-z]?|[)\]])\d|[A-Z][a-z]?\d*[+-](?![A-Za-z0-9])|[)\]]\d*[+-]|(?<![A-Za-z])\d*e-(?![A-Za-z0-9])/.test(text)) return text;
  const reactionLine = REACTION_LINE.test(text);
  const scripted = text.replace(FORMULA_TOKEN, (whole: string, coefficient: string | undefined, body: string, charge: string | undefined) => {
    const symbols = elementCount(body);
    if (symbols < 1) return whole;
    const hasDigits = /\d/.test(body);
    const isFormula = symbols >= 2 || Boolean(charge) || (reactionLine && hasDigits);
    if (!isFormula) return whole;
    if (!hasDigits && !charge) return whole;
    const prefix = coefficient ?? "";
    if (charge) {
      const split = splitCharge(body, charge);
      return `${prefix}${scriptBody(split.body)}^(${split.charge})`;
    }
    return `${prefix}${scriptBody(body)}`;
  });
  // An explicit caret charge without brackets: SO_4^2- reads as one script group.
  // The electron: e- and 2e- on a half reaction row.
  return scripted
    .replace(/\^(\d*[+-])(?![A-Za-z0-9)])/g, "^($1)")
    .replace(/(?<![A-Za-z0-9_^])(\d*)e-(?![A-Za-z0-9])/g, "$1e^(-)");
}
