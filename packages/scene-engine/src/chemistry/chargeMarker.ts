/**
 * Charge markers a question writes, and whether a figure's species carry them.
 *
 * A student writes a charge many ways: attached (NH4+, SO42-, SO4^2-,
 * SO4^(2-), Cu²⁺), spaced (SO3 2-, NO2 -, Cu 2+), sign first (O2+1, O2 -2),
 * or in brackets (O2 (2-)). A builder that reads only some of these draws
 * the neutral species for the rest, so a certificate that trusts "the figure
 * equals a fresh rebuild" must also check that every charge the question
 * writes is carried by a drawn species. The words ion, cation and anion are
 * markers too: they say some drawn species is charged.
 *
 * A sign is a charge only right after a formula token (an uppercase start
 * that the formula reader parses) and only where nothing continues the
 * token: a letter or digit right after the sign, or a formula or number
 * after one space, makes it a bond, a hyphen, a reaction or arithmetic
 * (C-H bond, CH3-CH3, C - H, BF3 + NH3, pH 3-4, sp3-hybridised,
 * 2-methylpropane, O2 -> O3). This reader only ever removes trust: a false
 * marker makes a figure fall back to the exact label rule, never admits one.
 */
import { normalizeChemistryText, parseFormula, splitCharge } from "./formula";

export interface ChargeMarker {
  /** Formula body the sign follows (NO2 for "NO2 -"), or null for a word marker. */
  readonly formula: string | null;
  /** Net charge written, or null for a word marker. */
  readonly charge: number | null;
  /** Sign a word marker asks for: cation +1, anion -1, ion 0 (either). */
  readonly polarity: -1 | 0 | 1;
  /** The marker as written, after notation folding. */
  readonly text: string;
}

/**
 * A formula token (a bracketed entity, or an uppercase start with optional
 * parenthesised groups), then one space or nothing, then a charge suffix:
 * optional caret and bracket around digits and a sign in either order. After
 * the suffix: no letter, digit, sign, arrow head or equals sign.
 */
const SIGN_MARKER =
  /(?<![A-Za-z0-9_\])])(\[[^\]\s]+\]\d*|[A-Z][A-Za-z0-9]*(?:\([A-Z][A-Za-z0-9]*\)[A-Za-z0-9]*)*)( ?)(\^?\(?\s*(\d*)\s*([+-])\s*(\d*)\s*\)?)(?![A-Za-z0-9+\-=>])/g;

/** One space then a formula or a number: a bare spaced sign there is a bond, a reaction or arithmetic. */
const CONTINUED = /^ (\d|[A-Z[(][A-Za-z0-9()[\]]*)/;

const WORD_MARKER = /\b(cation|anion|ion)s?\b/gi;

/** Fold notation (scripts, braces, typographic minus, subscript underscores). */
function fold(text: string): string {
  return normalizeChemistryText(text).replace(/_\(?(\d+)\)?/g, "$1");
}

/** Every charge marker the text writes, in order. */
export function readChargeMarkers(text: string): ChargeMarker[] {
  const folded = fold(text);
  const markers: ChargeMarker[] = [];
  for (const match of folded.matchAll(SIGN_MARKER)) {
    const [whole, token, space, suffix, lead, sign, trail] = match as unknown as [string, string, string, string, string, string, string];
    if (lead && trail) continue;
    const bare = !lead && !trail && suffix === sign;
    if (bare && space) {
      const next = CONTINUED.exec(folded.slice((match.index ?? 0) + whole.length));
      if (next && (/^\d/.test(next[1]!) || parseFormula(next[1]!.replace(/[,.;:?!]+$/, "")))) continue;
    }
    const unit = sign === "-" ? -1 : 1;
    const explicit = suffix.startsWith("^") || suffix.startsWith("(") || space.length > 0 || trail.length > 0;
    // Attached digits then a sign without a caret are read the way the
    // formula reader reads them (NH4+, SO42-, Fe3+).
    const read = explicit
      ? { body: token, charge: unit * (Number(lead || trail || "1") || 1) }
      : splitCharge(`${token}${lead}${sign}`);
    if (!parseFormula(read.body) || !/[A-Z]/.test(read.body)) continue;
    markers.push({ formula: read.body, charge: read.charge, polarity: read.charge < 0 ? -1 : 1, text: whole });
  }
  for (const match of folded.matchAll(WORD_MARKER)) {
    const word = match[1]!.toLowerCase();
    markers.push({ formula: null, charge: null, polarity: word === "cation" ? 1 : word === "anion" ? -1 : 0, text: match[0] });
  }
  return markers;
}

/** Body and net charge of a species formula in any of its spellings. */
function speciesCharge(formula: string): { body: string; charge: number } | null {
  const text = fold(formula).replace(/\s+/g, "");
  if (!parseFormula(text)) return null;
  return splitCharge(text);
}

/**
 * True when every charge marker in the text is carried by one of the
 * species: a formula marker by a species with the same body and charge, a
 * word marker by a charged species of the asked sign. With no marker in the
 * text this is true; with a marker and no species it is false.
 */
export function chargeMarkersCarried(text: string, speciesFormulas: readonly string[]): boolean {
  const markers = readChargeMarkers(text);
  if (markers.length === 0) return true;
  const species = speciesFormulas.map(speciesCharge).filter((item): item is { body: string; charge: number } => item !== null);
  return markers.every((marker) => {
    if (marker.formula !== null) {
      return species.some((item) => item.body === marker.formula && item.charge === marker.charge);
    }
    return species.some((item) => item.charge !== 0 && (marker.polarity === 0 || Math.sign(item.charge) === marker.polarity));
  });
}
