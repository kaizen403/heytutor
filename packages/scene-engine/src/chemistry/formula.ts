/**
 * Chemical formula reading for the chemistry families.
 *
 * Every family starts from a formula the student typed (H2SO4, [Fe(CN)6]3-,
 * SO4^2-, XeF₄, Cu²⁺). This module turns those spellings into one structure:
 * ordered atoms with counts, a net charge, and for a coordination entity the
 * central metal with its ligands. It never guesses: a token that is not an
 * element symbol makes the parse fail, so a garbled OCR formula draws nothing
 * rather than something else.
 */
import { elementBySymbol, type ElementRecord } from "./elements";

export interface FormulaAtom {
  readonly symbol: string;
  readonly count: number;
  readonly element: ElementRecord;
}

export interface ParsedFormula {
  /** Atoms in the order written, merged when a symbol repeats. */
  readonly atoms: readonly FormulaAtom[];
  readonly charge: number;
  /** The formula as written, after notation normalisation. */
  readonly text: string;
  readonly totalAtoms: number;
}

const SUPERSCRIPT: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "-",
};
const SUBSCRIPT: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};

/**
 * Notation the student or a paper uses, folded to one ASCII spelling:
 * Unicode scripts, typographic minus, arrow glyphs, and `^{2-}` braces.
 * Chemistry-neutral text is left alone.
 */
export function normalizeChemistryText(text: string): string {
  let out = "";
  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    if (SUPERSCRIPT[ch] !== undefined) {
      // A superscript run that carries a sign is a charge: SO₄²⁻ -> SO4^(2-).
      let run = "";
      while (i < chars.length && SUPERSCRIPT[chars[i]!] !== undefined) {
        run += SUPERSCRIPT[chars[i]!];
        i += 1;
      }
      i -= 1;
      out += /[+-]/.test(run) ? `^(${run})` : run;
    } else if (SUBSCRIPT[ch] !== undefined) out += SUBSCRIPT[ch];
    else out += ch;
  }
  return out
    .replace(/[–—−]/g, "-")
    .replace(/⇌|⇄|↔|<=>|<->/g, " <=> ")
    .replace(/→|⟶|−>|-->|⇒/g, " -> ")
    .replace(/\^\{([^}]*)\}/g, "^($1)")
    .replace(/_\{([^}]*)\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Charge at the end of a formula. `^(2-)` and `^2-` are explicit. A bare
 * `<digits><sign>` is read the way a student types it: on a single element
 * the digits are the charge (Fe3+, Cu2+, S2-); on a polyatomic ion one digit
 * is a subscript with unit charge (NH4+, NO3-, I3-) and two digits split into
 * subscript then charge (SO42-, PO43-, Cr2O72-, Hg22+).
 */
function splitCharge(formula: string): { body: string; charge: number } {
  const explicit = /\^\(?\s*(\d*)\s*([+-])\s*\)?$/.exec(formula);
  if (explicit) {
    const magnitude = Number(explicit[1] || "1") || 1;
    return { body: formula.slice(0, explicit.index), charge: magnitude * (explicit[2] === "-" ? -1 : 1) };
  }
  const bare = /^(.*?)(\d*)([+-])$/.exec(formula);
  if (!bare) return { body: formula, charge: 0 };
  const [, head, digits, sign] = bare as unknown as [string, string, string, string];
  const unit = sign === "-" ? -1 : 1;
  if (!digits) return { body: head, charge: unit };
  // After a closing bracket the digits can only be the charge: [Fe(CN)6]3-.
  if (/[\])]$/.test(head)) return { body: head, charge: Number(digits) * unit };
  if (digits.length >= 2) {
    return { body: `${head}${digits.slice(0, -1)}`, charge: Number(digits.slice(-1)) * unit };
  }
  const single = /^([A-Z][a-z]?)$/.exec(head);
  if (single && plausibleMonatomicCharge(single[1]!, Number(digits) * unit)) {
    return { body: head, charge: Number(digits) * unit };
  }
  return { body: `${head}${digits}`, charge: unit };
}

/**
 * Fe3+ is an ion; I3- is triiodide. A single element followed by one digit
 * and a sign reads as a monatomic ion only when that charge is one the
 * element forms: metals up to +4, and the p-block anions that complete an
 * octet (N3-, O2-, S2-, halide 1-).
 */
function plausibleMonatomicCharge(symbol: string, charge: number): boolean {
  const element = elementBySymbol(symbol);
  if (!element) return false;
  if (charge > 0) return charge <= 4 && (element.block !== "p" || ["Al", "Ga", "In", "Tl", "Sn", "Pb", "Bi", "Sb"].includes(symbol));
  if (element.block !== "p") return false;
  const octetCharge = (element.group ?? 18) - 18;
  return charge === octetCharge;
}

interface Frame { counts: Map<string, number>; order: string[] }

function newFrame(): Frame {
  return { counts: new Map(), order: [] };
}

function addAtom(frame: Frame, symbol: string, count: number): void {
  if (!frame.counts.has(symbol)) frame.order.push(symbol);
  frame.counts.set(symbol, (frame.counts.get(symbol) ?? 0) + count);
}

function mergeFrame(into: Frame, from: Frame, multiplier: number): void {
  for (const symbol of from.order) addAtom(into, symbol, (from.counts.get(symbol) ?? 0) * multiplier);
}

/**
 * Parse `body` (no charge) into element counts. Brackets of every shape nest;
 * a hydrate dot multiplies the trailing group. Returns null on any token that
 * is not an element symbol.
 */
function parseBody(body: string): Frame | null {
  const source = body.replace(/\s+/g, "");
  if (!source) return null;
  const parts = source.split(/[.·•]/);
  const total = newFrame();
  for (const part of parts) {
    const leading = /^(\d+)(.*)$/.exec(part);
    const multiplier = leading ? Number(leading[1]) : 1;
    const text = leading ? leading[2]! : part;
    const frame = parseGroup(text);
    if (!frame) return null;
    mergeFrame(total, frame, multiplier);
  }
  return total;
}

function parseGroup(text: string): Frame | null {
  const stack: Frame[] = [newFrame()];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(newFrame());
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.length < 2) return null;
      const inner = stack.pop()!;
      i += 1;
      const count = readCount(text, i);
      i = count.next;
      mergeFrame(stack[stack.length - 1]!, inner, count.value);
      continue;
    }
    const symbolMatch = /^[A-Z][a-z]?/.exec(text.slice(i));
    if (!symbolMatch) return null;
    let symbol = symbolMatch[0];
    // "CO" is carbon + oxygen, "Co" is cobalt; two-letter reads win only when
    // the pair is an element and the single letter followed by the rest is not.
    if (symbol.length === 2 && !elementBySymbol(symbol)) symbol = symbol[0]!;
    if (!elementBySymbol(symbol)) return null;
    i += symbol.length;
    const count = readCount(text, i);
    i = count.next;
    addAtom(stack[stack.length - 1]!, symbol, count.value);
  }
  if (stack.length !== 1) return null;
  return stack[0]!;
}

function readCount(text: string, at: number): { value: number; next: number } {
  const match = /^\d+/.exec(text.slice(at));
  if (!match) return { value: 1, next: at };
  return { value: Number(match[0]), next: at + match[0].length };
}

export function parseFormula(input: string): ParsedFormula | null {
  const text = normalizeChemistryText(input).replace(/\s+/g, "");
  if (!text) return null;
  const { body, charge } = splitCharge(text);
  const frame = parseBody(body);
  if (!frame || frame.order.length === 0) return null;
  const atoms = frame.order.map((symbol) => ({
    symbol,
    count: frame.counts.get(symbol)!,
    element: elementBySymbol(symbol)!,
  }));
  return {
    atoms,
    charge,
    text,
    totalAtoms: atoms.reduce((sum, atom) => sum + atom.count, 0),
  };
}

/**
 * A formula-shaped token in running text. Requires at least one element
 * symbol followed by a digit, a bracket, a charge, or a second symbol, so
 * ordinary capitalised words are not read as formulas.
 */
const FORMULA_TOKEN = /(?<![A-Za-z])(\[?(?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+\]?\d*(?:\^?\(?\d*[+-]\)?)?)(?![a-z])/g;

const NOT_FORMULA_WORDS = new Set([
  "I", "A", "In", "At", "As", "Be", "No", "He", "Si", "So", "If", "Or", "On", "Of", "By", "Am", "An", "Is", "It",
  "To", "Do", "Up", "Us", "We", "Go", "Ho", "Mo", "Ni", "Na", "Po", "Pa", "Ra", "Re", "Sb", "Sc", "Se", "Sn", "Ta",
  "Ti", "Tm", "Ts", "Yb", "Kr", "Ne", "Bi", "Ba", "Ca", "Cs", "Fe", "Ge", "Ir", "La", "Li", "Nb", "Pb", "Pd", "Rb",
  "Ru", "Sm", "Sr", "Tb", "Te", "Xe", "Ar", "Al", "Cr", "Cu", "Ag", "Au", "Hg", "Br", "Cl", "Mg", "Mn", "Zn", "Co",
  "Ce", "Nd", "Pr", "Pm", "Eu", "Gd", "Dy", "Er", "Lu", "Hf", "Os", "Pt", "Tl", "Rn", "Fr", "Ac", "Th", "Np", "Pu",
  "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "Lr", "Rh", "Tc", "Cd", "Zr", "Y", "V", "W", "U", "B", "C", "N", "O",
  "F", "P", "S", "K", "H",
]);

/**
 * Species that are genuinely written without a subscript, so a comma after
 * them is punctuation and not a lost digit.
 */
const NO_SUBSCRIPT_SPECIES = new Set([
  "CO", "NO", "CN", "HF", "HCl", "HBr", "HI", "ICl", "IBr", "BrCl", "ClF", "HCN", "HOCl", "HClO", "HOBr", "HOI",
  "NaCl", "NaBr", "NaI", "NaF", "KCl", "KBr", "KI", "KF", "LiF", "LiCl", "LiI", "CsCl", "CsF", "CsI", "RbCl",
  "AgCl", "AgBr", "AgI", "CuCl", "CuBr", "CuI", "TlCl", "CuO", "ZnO", "MgO", "CaO", "BaO", "FeO", "NiO", "CoO",
  "MnO", "PbO", "SnO", "HgO", "ZnS", "PbS", "CuS", "HgS", "FeS", "CdS", "CaS", "MgS", "NaH", "LiH", "KH",
  "NaOH", "KOH", "LiOH", "CsOH", "NaCN", "KCN", "SiC", "BN", "AlN", "GaN", "GaAs", "ZnSe", "CdSe",
]);

const ROMAN_NUMERAL = /^\(?(?:I{1,3}|IV|VI{0,3}|IX|X{1,3})\)?$/;

/**
 * A formula token that OCR damaged into a different real species. Scanned
 * papers turn a subscript into punctuation ("SO,," for SO2, "HNO;" for
 * HNO3, "IF, and IF," for IF5 and IF7) or split it off ("XeF 4"), read
 * "Cl" as "CI" (HCI, CIF, HCIO), and leave roman numerals that parse as
 * iodine and vanadium. Each of those drew a confident, wrong structure on a
 * bank stem, so the token is dropped rather than drawn.
 */
export function ocrSuspectToken(token: string, text: string, start: number): boolean {
  if (ROMAN_NUMERAL.test(token)) return true;
  if (/CI(?![a-z])/.test(token)) return true;
  // A fragment of a longer formula whose subscript became a comma: "H,CO" is H3CO.
  if (/[A-Za-z],$/.test(text.slice(Math.max(0, start - 2), start))) return true;
  if (/[+-]\)?$/.test(token)) return false;
  if (/\d/.test(token) || token.length > 4) return false;
  const after = text.slice(start + token.length, start + token.length + 3);
  // A semicolon, colon or brace glued to a formula is a lost "3" or charge
  // even on a species that is often written bare: "NO;" is NO3, "NO}" NO3-.
  if (/^[;:!}]/.test(after)) return true;
  // A closing bracket with no opening one is an answer mark: "OC)".
  if (/^\)/.test(after) && text[start - 1] !== "(" && !token.includes("(")) return true;
  if (NO_SUBSCRIPT_SPECIES.has(token)) return false;
  if (/^,/.test(after)) return true;
  if (/^\s\d/.test(after)) return true;
  return false;
}

/**
 * Formula tokens in a stem, in order, without bare element symbols and
 * ordinary words. A bare symbol is only a formula when it carries a charge
 * (Cu2+, Fe3+, Cl-). OCR-damaged tokens are dropped (see ocrSuspectToken).
 */
export function formulaTokens(text: string): string[] {
  const normalized = normalizeChemistryText(text);
  const tokens: string[] = [];
  for (const match of normalized.matchAll(FORMULA_TOKEN)) {
    const token = match[1]!;
    if (ocrSuspectToken(token, normalized, match.index ?? 0)) continue;
    const hasCharge = /[+-]\)?$/.test(token);
    if (NOT_FORMULA_WORDS.has(token) && !hasCharge) continue;
    if (/^[A-Z][a-z]?$/.test(token)) continue;
    if (/^[A-Z][a-z]?\d+$/.test(token) && !elementBySymbol(token.replace(/\d+$/, ""))) continue;
    const parsed = parseFormula(token);
    if (!parsed) continue;
    if (parsed.totalAtoms === 1 && parsed.charge === 0) continue;
    tokens.push(token);
  }
  return tokens;
}

/* ------------------------------------------------------------------------- */
/* Coordination entities                                                     */
/* ------------------------------------------------------------------------- */

export interface LigandSpec {
  readonly key: string;
  /** Formula as drawn on the board (16 characters at most). */
  readonly label: string;
  readonly name: string;
  readonly charge: number;
  readonly denticity: number;
  /** Position in the spectrochemical series, low to high field. */
  readonly fieldRank: number;
  readonly aliases: readonly string[];
}

const LIGANDS: readonly LigandSpec[] = [
  { key: "I", label: "I", name: "iodido", charge: -1, denticity: 1, fieldRank: 1, aliases: ["iodo", "iodido"] },
  { key: "Br", label: "Br", name: "bromido", charge: -1, denticity: 1, fieldRank: 2, aliases: ["bromo", "bromido"] },
  { key: "SCN", label: "SCN", name: "thiocyanato-S", charge: -1, denticity: 1, fieldRank: 3, aliases: ["thiocyanato"] },
  { key: "Cl", label: "Cl", name: "chlorido", charge: -1, denticity: 1, fieldRank: 4, aliases: ["chloro", "chlorido"] },
  { key: "S", label: "S", name: "sulphido", charge: -2, denticity: 1, fieldRank: 4, aliases: [] },
  { key: "F", label: "F", name: "fluorido", charge: -1, denticity: 1, fieldRank: 5, aliases: ["fluoro", "fluorido"] },
  { key: "OH", label: "OH", name: "hydroxido", charge: -1, denticity: 1, fieldRank: 6, aliases: ["hydroxo", "hydroxido"] },
  { key: "C2O4", label: "ox", name: "oxalato", charge: -2, denticity: 2, fieldRank: 7, aliases: ["ox", "oxalato", "oxalate"] },
  { key: "H2O", label: "H2O", name: "aqua", charge: 0, denticity: 1, fieldRank: 8, aliases: ["aqua", "aquo", "OH2"] },
  { key: "NCS", label: "NCS", name: "thiocyanato-N", charge: -1, denticity: 1, fieldRank: 9, aliases: ["isothiocyanato"] },
  { key: "py", label: "py", name: "pyridine", charge: 0, denticity: 1, fieldRank: 10, aliases: ["pyridine", "C5H5N"] },
  { key: "NH3", label: "NH3", name: "ammine", charge: 0, denticity: 1, fieldRank: 11, aliases: ["ammine"] },
  { key: "en", label: "en", name: "ethylenediamine", charge: 0, denticity: 2, fieldRank: 12, aliases: ["ethylenediamine", "ethane-1,2-diamine", "C2H8N2"] },
  { key: "bipy", label: "bipy", name: "bipyridine", charge: 0, denticity: 2, fieldRank: 13, aliases: ["bipy", "bpy", "bipyridine", "bipyridyl"] },
  { key: "phen", label: "phen", name: "phenanthroline", charge: 0, denticity: 2, fieldRank: 13, aliases: ["phen", "phenanthroline"] },
  { key: "NO2", label: "NO2", name: "nitrito-N", charge: -1, denticity: 1, fieldRank: 14, aliases: ["nitro", "nitrito"] },
  { key: "ONO", label: "ONO", name: "nitrito-O", charge: -1, denticity: 1, fieldRank: 7, aliases: [] },
  { key: "CN", label: "CN", name: "cyanido", charge: -1, denticity: 1, fieldRank: 15, aliases: ["cyano", "cyanido"] },
  { key: "CO", label: "CO", name: "carbonyl", charge: 0, denticity: 1, fieldRank: 16, aliases: ["carbonyl"] },
  { key: "NO", label: "NO", name: "nitrosyl", charge: 1, denticity: 1, fieldRank: 15, aliases: ["nitrosyl"] },
  { key: "EDTA", label: "EDTA", name: "edta", charge: -4, denticity: 6, fieldRank: 8, aliases: ["edta", "ethylenediaminetetraacetato"] },
  { key: "gly", label: "gly", name: "glycinato", charge: -1, denticity: 2, fieldRank: 8, aliases: ["gly", "glycinato", "glycinate"] },
  { key: "acac", label: "acac", name: "acetylacetonato", charge: -1, denticity: 2, fieldRank: 8, aliases: ["acac", "acetylacetonato"] },
  { key: "dmg", label: "dmg", name: "dimethylglyoximato", charge: -1, denticity: 2, fieldRank: 11, aliases: ["dmg", "dimethylglyoximato"] },
  { key: "O", label: "O", name: "oxido", charge: -2, denticity: 1, fieldRank: 6, aliases: ["oxo", "oxido"] },
  { key: "H", label: "H", name: "hydrido", charge: -1, denticity: 1, fieldRank: 14, aliases: ["hydrido"] },
  { key: "PPh3", label: "PPh3", name: "triphenylphosphine", charge: 0, denticity: 1, fieldRank: 14, aliases: ["PPh3", "triphenylphosphine"] },
  { key: "CH3", label: "CH3", name: "methyl", charge: -1, denticity: 1, fieldRank: 14, aliases: [] },
];

const LIGAND_BY_KEY = new Map(LIGANDS.map((ligand) => [ligand.key, ligand]));
for (const ligand of LIGANDS) {
  for (const alias of ligand.aliases) LIGAND_BY_KEY.set(alias, ligand);
}

export function ligandSpec(token: string): LigandSpec | null {
  return LIGAND_BY_KEY.get(token) ?? LIGAND_BY_KEY.get(token.toLowerCase()) ?? null;
}

export interface ComplexLigand {
  readonly spec: LigandSpec;
  readonly count: number;
}

export interface ParsedComplex {
  readonly metal: ElementRecord;
  readonly ligands: readonly ComplexLigand[];
  /** Charge of the coordination entity (inside the brackets). */
  readonly charge: number;
  readonly oxidationState: number;
  readonly coordinationNumber: number;
  readonly text: string;
  /** Counter ion written outside the brackets, e.g. K3 or Cl2, if any. */
  readonly counterIon: string | null;
}

/**
 * Read a coordination entity: `[Co(NH3)6]Cl3`, `K4[Fe(CN)6]`, `[Ni(CN)4]2-`,
 * `[Pt(NH3)2Cl2]`, `[Cr(en)3]3+`, `[Fe(H2O)6]2+`. Counter ions fix the
 * charge of the entity when it is not written explicitly.
 */
export function parseComplex(input: string): ParsedComplex | null {
  const text = normalizeChemistryText(input).replace(/\s+/g, "");
  const match = /^([A-Za-z0-9()]*?)\[([^\]]+)\]([A-Za-z0-9()]*?)(?:\^?\(?(\d*)([+-])\)?)?$/.exec(text);
  if (!match) return null;
  const [, before, inside, after, magnitude, sign] = match;
  const metalMatch = /^([A-Z][a-z]?)/.exec(inside!);
  if (!metalMatch) return null;
  const metal = elementBySymbol(metalMatch[1]!);
  if (!metal || !(metal.block === "d" || metal.block === "f" || ["Al", "Sn", "Pb", "Mg", "Ca", "Be", "B", "Si"].includes(metal.symbol))) return null;
  let rest = inside!.slice(metalMatch[1]!.length);
  const ligands: ComplexLigand[] = [];
  while (rest.length > 0) {
    let token: string;
    let count = 1;
    if (rest.startsWith("(")) {
      const close = rest.indexOf(")");
      if (close < 0) return null;
      token = rest.slice(1, close);
      rest = rest.slice(close + 1);
    } else {
      const tokenMatch = /^(?:[A-Z][a-z]?|[a-z]+)/.exec(rest);
      if (!tokenMatch) return null;
      token = tokenMatch[0];
      rest = rest.slice(token.length);
    }
    const countMatch = /^\d+/.exec(rest);
    if (countMatch) {
      count = Number(countMatch[0]);
      rest = rest.slice(countMatch[0].length);
    }
    const spec = ligandSpec(token);
    if (!spec) return null;
    const existing = ligands.find((ligand) => ligand.spec.key === spec.key);
    if (existing) ligands[ligands.indexOf(existing)] = { spec, count: existing.count + count };
    else ligands.push({ spec, count });
  }
  const ligandCharge = ligands.reduce((sum, ligand) => sum + ligand.spec.charge * ligand.count, 0);
  const coordinationNumber = ligands.reduce((sum, ligand) => sum + ligand.spec.denticity * ligand.count, 0);
  let charge: number;
  const explicit = sign !== undefined;
  if (explicit) {
    charge = (Number(magnitude || "1") || 1) * (sign === "-" ? -1 : 1);
  } else {
    charge = -counterIonCharge(before ?? "") - counterIonCharge(after ?? "");
  }
  const counterIon = (before || after) ? `${before ?? ""}${after ?? ""}` : null;
  return {
    metal,
    ligands,
    charge,
    oxidationState: charge - ligandCharge,
    coordinationNumber,
    text,
    counterIon,
  };
}

/** Net charge of a counter-ion group such as K3, Cl2, (NO3)2, SO4, NH4. */
function counterIonCharge(token: string): number {
  if (!token) return 0;
  const groups: Array<[RegExp, number]> = [
    [/^\(?(?:NH4)\)?(\d*)$/, 1],
    [/^\(?(?:NO3)\)?(\d*)$/, -1],
    [/^\(?(?:SO4)\)?(\d*)$/, -2],
    [/^\(?(?:ClO4)\)?(\d*)$/, -1],
    [/^\(?(?:OH)\)?(\d*)$/, -1],
    [/^\(?(?:CN)\)?(\d*)$/, -1],
    [/^(?:K|Na|Li|Cs|Rb|Ag)(\d*)$/, 1],
    [/^(?:Ca|Ba|Mg|Sr|Zn|Cu)(\d*)$/, 2],
    [/^(?:Cl|Br|I|F)(\d*)$/, -1],
    [/^(?:O|S)(\d*)$/, -2],
  ];
  for (const [pattern, unit] of groups) {
    const match = pattern.exec(token);
    if (match) return unit * (Number(match[1] || "1") || 1);
  }
  return 0;
}

/** Complex-shaped tokens in a stem, in order. */
export function complexTokens(text: string): string[] {
  const normalized = normalizeChemistryText(text);
  const tokens: string[] = [];
  const pattern = /(?<![A-Za-z])([A-Za-z0-9()]*\[[A-Za-z0-9()]+\][A-Za-z0-9()]*(?:\^?\(?\d*[+-]\)?)?)/g;
  for (const match of normalized.matchAll(pattern)) {
    if (parseComplex(match[1]!)) tokens.push(match[1]!);
  }
  return tokens;
}
