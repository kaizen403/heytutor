/**
 * Electrochemistry figures for JEE Main redox and electrochemistry.
 *
 * Three figures live here. A galvanic cell is two open beakers, an electrode
 * bar in each, a salt bridge between them, an external wire through a
 * voltmeter and an electron arrow from anode to cathode. An electrolytic cell
 * is one beaker, two bars, a battery above it and the product named at each
 * electrode. A conductance plot is the qualitative Kohlrausch picture of
 * molar conductivity against root concentration.
 *
 * Every number on a figure is read from the stem or from the NCERT table of
 * standard reduction potentials, and a potential stated in the stem always
 * overrides the table. The pure solvers (cell notation, standard potential,
 * cell emf, electrolysis products) are exported for other lanes.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, planQuantity, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import { normalizeChemistryText, parseFormula } from "./formula";
import { elementBySymbol } from "./elements";

export const ELECTROCHEM_FAMILY = "chem_electrochem" as const;

const FARADAY = 96500;
const NERNST_298 = 0.0591;

/* ------------------------------------------------------------------------- */
/* Standard reduction potentials                                             */
/* ------------------------------------------------------------------------- */

export interface CoupleSpecies {
  /** Canonical spelling: "Zn2+", "Cl-", "Cr2O72-", "H2". */
  readonly formula: string;
  /** Board spelling: "Zn^(2+)", "Cl^-", "Cr_2O_7^(2-)", "H_2". */
  readonly label: string;
  readonly phase: "aq" | "s" | "g" | "l";
  /** Which side of the reduction half reaction the species sits on. */
  readonly side: "ox" | "red";
  /** Moles of the species per mole of electrons in the half reaction. */
  readonly perElectron: number;
}

export interface CoupleRecord {
  /** Canonical key, oxidised form first: "Zn2+/Zn", "Fe3+/Fe2+", "H+/H2". */
  readonly key: string;
  /** Standard reduction potential in volts at 298 K. */
  readonly e0: number;
  /** Electrons in the half reaction as written. */
  readonly n: number;
  /** Conductor drawn as the electrode: the metal, or Pt for an ion or gas couple. */
  readonly electrode: string;
  readonly species: readonly CoupleSpecies[];
}

function metalCouple(symbol: string, charge: number, e0: number): CoupleRecord {
  const ion = `${symbol}${charge > 1 ? charge : ""}+`;
  return {
    key: `${ion}/${symbol}`,
    e0,
    n: charge,
    electrode: symbol,
    species: [
      { formula: ion, label: speciesLabel(ion), phase: "aq", side: "ox", perElectron: 1 / charge },
      { formula: symbol, label: symbol, phase: "s", side: "red", perElectron: 1 / charge },
    ],
  };
}

function ionCouple(ox: string, red: string, n: number, e0: number, oxPer = 1 / n, redPer = 1 / n): CoupleRecord {
  return {
    key: `${ox}/${red}`,
    e0,
    n,
    electrode: "Pt",
    species: [
      { formula: ox, label: speciesLabel(ox), phase: "aq", side: "ox", perElectron: oxPer },
      { formula: red, label: speciesLabel(red), phase: "aq", side: "red", perElectron: redPer },
    ],
  };
}

function gasAnionCouple(gas: string, anion: string, e0: number, phase: "g" | "s" | "l" = "g"): CoupleRecord {
  return {
    key: `${gas}/${anion}`,
    e0,
    n: 2,
    electrode: "Pt",
    species: [
      { formula: gas, label: speciesLabel(gas), phase, side: "ox", perElectron: 1 / 2 },
      { formula: anion, label: speciesLabel(anion), phase: "aq", side: "red", perElectron: 1 },
    ],
  };
}

/**
 * NCERT Table 3.1 values (volts, 298 K). Au3+/Au and Br2/Br- follow the
 * older JEE tables the brief quotes (1.50, 1.08).
 */
export const STANDARD_POTENTIALS: readonly CoupleRecord[] = [
  metalCouple("Li", 1, -3.04),
  metalCouple("Rb", 1, -2.98),
  metalCouple("K", 1, -2.93),
  metalCouple("Cs", 1, -2.92),
  metalCouple("Ba", 2, -2.90),
  metalCouple("Sr", 2, -2.89),
  metalCouple("Ca", 2, -2.87),
  metalCouple("Na", 1, -2.71),
  metalCouple("Mg", 2, -2.37),
  metalCouple("Al", 3, -1.66),
  metalCouple("Mn", 2, -1.18),
  metalCouple("Zn", 2, -0.76),
  metalCouple("Cr", 3, -0.74),
  metalCouple("Fe", 2, -0.44),
  metalCouple("Cd", 2, -0.40),
  metalCouple("Tl", 1, -0.34),
  metalCouple("Co", 2, -0.28),
  metalCouple("Ni", 2, -0.25),
  metalCouple("Sn", 2, -0.14),
  metalCouple("Pb", 2, -0.13),
  metalCouple("Fe", 3, -0.04),
  {
    key: "H+/H2",
    e0: 0,
    n: 2,
    electrode: "Pt",
    species: [
      { formula: "H+", label: "H^+", phase: "aq", side: "ox", perElectron: 1 },
      { formula: "H2", label: "H_2", phase: "g", side: "red", perElectron: 1 / 2 },
    ],
  },
  {
    key: "AgBr/Ag",
    e0: 0.10,
    n: 1,
    electrode: "Ag",
    species: [
      { formula: "AgBr", label: "AgBr", phase: "s", side: "ox", perElectron: 1 },
      { formula: "Ag", label: "Ag", phase: "s", side: "red", perElectron: 1 },
      { formula: "Br-", label: "Br^-", phase: "aq", side: "red", perElectron: 1 },
    ],
  },
  ionCouple("Sn4+", "Sn2+", 2, 0.15),
  ionCouple("Cu2+", "Cu+", 1, 0.16),
  {
    key: "AgCl/Ag",
    e0: 0.22,
    n: 1,
    electrode: "Ag",
    species: [
      { formula: "AgCl", label: "AgCl", phase: "s", side: "ox", perElectron: 1 },
      { formula: "Ag", label: "Ag", phase: "s", side: "red", perElectron: 1 },
      { formula: "Cl-", label: "Cl^-", phase: "aq", side: "red", perElectron: 1 },
    ],
  },
  {
    key: "Hg2Cl2/Hg",
    e0: 0.27,
    n: 2,
    electrode: "Hg",
    species: [
      { formula: "Hg2Cl2", label: "Hg_2Cl_2", phase: "s", side: "ox", perElectron: 1 / 2 },
      { formula: "Hg", label: "Hg", phase: "l", side: "red", perElectron: 1 },
      { formula: "Cl-", label: "Cl^-", phase: "aq", side: "red", perElectron: 1 },
    ],
  },
  metalCouple("Cu", 2, 0.34),
  metalCouple("Cu", 1, 0.52),
  gasAnionCouple("I2", "I-", 0.54, "s"),
  ionCouple("Fe3+", "Fe2+", 1, 0.77),
  metalCouple("Ag", 1, 0.80),
  metalCouple("Hg", 2, 0.85),
  {
    key: "NO3-/NO",
    e0: 0.97,
    n: 3,
    electrode: "Pt",
    species: [
      { formula: "NO3-", label: "NO_3^-", phase: "aq", side: "ox", perElectron: 1 / 3 },
      { formula: "NO", label: "NO", phase: "g", side: "red", perElectron: 1 / 3 },
    ],
  },
  gasAnionCouple("Br2", "Br-", 1.08, "l"),
  {
    key: "O2/H2O",
    e0: 1.23,
    n: 4,
    electrode: "Pt",
    species: [
      { formula: "O2", label: "O_2", phase: "g", side: "ox", perElectron: 1 / 4 },
      { formula: "H2O", label: "H_2O", phase: "l", side: "red", perElectron: 1 / 2 },
    ],
  },
  ionCouple("MnO2", "Mn2+", 2, 1.23, 1 / 2, 1 / 2),
  ionCouple("Cr2O72-", "Cr3+", 6, 1.33, 1 / 6, 2 / 6),
  gasAnionCouple("Cl2", "Cl-", 1.36),
  metalCouple("Au", 3, 1.50),
  ionCouple("MnO4-", "Mn2+", 5, 1.51),
  ionCouple("Mn3+", "Mn2+", 1, 1.57),
  {
    key: "H2O2/H2O",
    e0: 1.78,
    n: 2,
    electrode: "Pt",
    species: [
      { formula: "H2O2", label: "H_2O_2", phase: "aq", side: "ox", perElectron: 1 / 2 },
      { formula: "H2O", label: "H_2O", phase: "l", side: "red", perElectron: 1 },
    ],
  },
  ionCouple("Co3+", "Co2+", 1, 1.81),
  gasAnionCouple("F2", "F-", 2.87),
];

/** Canonical spelling of one species: "Zn^(2+)" and "Zn++" both give "Zn2+". */
export function canonicalSpecies(text: string): string | null {
  let cleaned = normalizeChemistryText(text)
    .replace(/\((?:aq|s|g|l|sol|soln|solution)\)/gi, "")
    .replace(/\s+/g, "");
  const plusRun = /^([A-Z][a-z]?)(\+{2,}|-{2,})$/.exec(cleaned);
  if (plusRun) cleaned = `${plusRun[1]}${plusRun[2]!.length}${plusRun[2]![0]}`;
  cleaned = cleaned.replace(/\^\(?(\d*)([+-])\)?$/, "$1$2").replace(/\^/g, "");
  const parsed = parseFormula(cleaned);
  if (!parsed) return null;
  const body = parsed.atoms.map((atom) => `${atom.symbol}${atom.count > 1 ? atom.count : ""}`).join("");
  const charge = parsed.charge === 0 ? "" : `${Math.abs(parsed.charge) > 1 ? Math.abs(parsed.charge) : ""}${parsed.charge > 0 ? "+" : "-"}`;
  return `${body}${charge}`;
}

/** Board spelling of a species with subscripts and a bracketed charge. */
export function speciesLabel(formula: string): string {
  const parsed = parseFormula(formula);
  if (!parsed) return formula;
  const body = parsed.atoms.map((atom) => `${atom.symbol}${atom.count > 1 ? `_${atom.count}` : ""}`).join("");
  if (parsed.charge === 0) return body;
  const sign = parsed.charge > 0 ? "+" : "-";
  return Math.abs(parsed.charge) === 1 ? `${body}^${sign}` : `${body}^(${Math.abs(parsed.charge)}${sign})`;
}

/** Canonical couple key from any spelling, or null when neither side parses. */
export function coupleKey(text: string): string | null {
  const parts = normalizeChemistryText(text).replace(/\|/g, "/").split("/");
  if (parts.length !== 2) return null;
  const a = canonicalSpecies(parts[0]!);
  const b = canonicalSpecies(parts[1]!);
  if (!a || !b) return null;
  return `${a}/${b}`;
}

function reverseKey(key: string): string {
  const [a, b] = key.split("/");
  return `${b}/${a}`;
}

function findCouple(key: string): CoupleRecord | null {
  if (key === "SHE") return STANDARD_POTENTIALS.find((record) => record.key === "H+/H2")!;
  return STANDARD_POTENTIALS.find((record) => record.key === key)
    ?? STANDARD_POTENTIALS.find((record) => record.key === reverseKey(key))
    ?? null;
}

/**
 * Standard reduction potential of a couple written any way a student writes
 * it ("Zn2+/Zn", "Zn/Zn2+", "Zn^(2+)/Zn", "Fe3+/Fe2+", "SHE"). Table only:
 * a stem's own value is read by `parseCellNotation`.
 */
export function standardPotential(couple: string): number | null {
  if (/^\s*she\s*$/i.test(couple) || /standard hydrogen electrode/i.test(couple)) return 0;
  const key = coupleKey(couple);
  if (!key) return null;
  return findCouple(key)?.e0 ?? null;
}

/* ------------------------------------------------------------------------- */
/* Cell specification                                                        */
/* ------------------------------------------------------------------------- */

export interface HalfCell {
  /** Canonical couple key, oxidised form first. */
  readonly couple: string;
  /** Standard reduction potential (stem value first, table second); null when unknown. */
  readonly e0: number | null;
  /** Electrons in the half reaction; null when the couple is unknown. */
  readonly n: number | null;
  /** Conductor drawn as the bar: "Zn", "Pt", "Ag". */
  readonly electrode: string;
  /** Species in the solution, board spelling, e.g. ["Zn^(2+)"] or ["Fe^(3+)", "Fe^(2+)"]. */
  readonly solution: readonly string[];
  /** Gas bubbling at the electrode, board spelling ("H_2"), if any. */
  readonly gas?: string;
  /** A solid coat on the electrode other than the metal itself ("AgCl"), if any. */
  readonly coat?: string;
  /** Concentration in mol/L (or partial pressure in bar for a gas) by canonical species. */
  readonly concentrations: Readonly<Record<string, number>>;
  /** Where the potential came from. */
  readonly potentialSource: "stem" | "table" | "unknown";
  readonly record: CoupleRecord | null;
}

export interface CellSpec {
  readonly anode: HalfCell;
  readonly cathode: HalfCell;
  /** Compact notation for the caption: "Zn|Zn2+||Cu2+|Cu". */
  readonly notation: string;
  /** Value of 2.303RT/F the stem gives (0.059, 0.06), if any. */
  readonly nernstFactor?: number;
  readonly temperatureK?: number;
  /** E°cell as the stem states it, when it does. */
  readonly statedE0?: number;
  /** A non-standard emf the stem states ("the emf of the cell is 1.60 V"). */
  readonly statedE?: number;
  /** How the cell was read. */
  readonly source: "notation" | "named" | "prose" | "half_reactions" | "she";
}

const E_NAUGHT = String.raw`E(?:°|º|˚|⁰|®|\^\s*(?:0|o|\(0\))|0(?![.\d])|o\b)`;
const SPECIES = String.raw`[A-Z][a-z]?(?:[A-Za-z0-9]*?)(?:\^?\(?\d*[+-]\)?|\+{2,})?`;
const COUPLE = String.raw`(${SPECIES})\s*(?:\(\s*(?:aq|s|g|l)\s*\))?\s*[\/|]\s*(${SPECIES})(?:\s*\(\s*(?:aq|s|g|l)\s*\))?`;
const VALUE = String.raw`([+-]?\s*\d+(?:\.\d+)?)\s*(?:V|volt|volts)\b`;

function numberOf(text: string): number {
  return Number(text.replace(/\s+/g, ""));
}

/**
 * Standard potentials the stem states, keyed by canonical couple. Reads
 * "E°(Zn2+/Zn) = -0.76 V", "E° Cu2+/Cu = 0.34 V", "E°_(Ag+/Ag) is 0.80 V",
 * half reactions "Zn2+ + 2e- -> Zn, E° = -0.76 V", and the list form
 * "E° of Zn2+/Zn and Cu2+/Cu are -0.76 V and 0.34 V respectively". An
 * "oxidation potential" is negated to a reduction potential.
 */
export function statedPotentials(question: string): Map<string, { e0: number; n?: number }> {
  const text = normalizeChemistryText(question);
  const found = new Map<string, { e0: number; n?: number }>();
  const store = (rawCouple: string, value: number, index: number, n?: number): void => {
    const key = coupleKey(rawCouple);
    if (!key || !Number.isFinite(value)) return;
    const before = text.slice(Math.max(0, index - 80), index).toLowerCase();
    const e0 = /oxidation potential/.test(before) ? -value : value;
    const record = findCouple(key);
    const canonical = record ? record.key : key;
    if (!found.has(canonical)) found.set(canonical, { e0, ...(n !== undefined ? { n } : {}) });
  };
  const direct = new RegExp(`${E_NAUGHT}\\s*(?:for|of|value\\s+of|_)?\\s*[\\(\\[]?\\s*${COUPLE}\\s*[\\)\\]]?\\s*(?:=|is|:|as)?\\s*${VALUE}`, "g");
  for (const match of text.matchAll(direct)) {
    store(`${match[1]}/${match[2]}`, numberOf(match[3]!), match.index ?? 0);
  }
  const halfReaction = new RegExp(
    `(?:^|[^A-Za-z0-9])(?:\\d+\\s*)?(${SPECIES})\\s*(?:\\(\\s*(?:aq|s|g|l)\\s*\\))?\\s*\\+\\s*(\\d*)\\s*e(?:\\^?\\(?-\\)?|\\^-|-)?\\s*(?:->|=|<=>)\\s*(?:\\d+\\s*)?(${SPECIES})(?:\\s*\\(\\s*(?:aq|s|g|l)\\s*\\))?[^\\n]{0,40}?${E_NAUGHT}[^\\n=]{0,12}(?:=|is|:)?\\s*${VALUE}`,
    "g",
  );
  for (const match of text.matchAll(halfReaction)) {
    const electrons = match[2] ? Number(match[2]) : 1;
    store(`${match[1]}/${match[3]}`, numberOf(match[4]!), match.index ?? 0, electrons);
  }
  const list = new RegExp(`(?:${E_NAUGHT}|reduction potentials?|electrode potentials?)[^.\\n]{0,40}?${COUPLE}\\s*(?:,|and)\\s*${COUPLE}[^.\\n]{0,30}?(?:are|=|is|:)\\s*${VALUE}\\s*(?:,|and)\\s*${VALUE}`, "g");
  for (const match of text.matchAll(list)) {
    store(`${match[1]}/${match[2]}`, numberOf(match[5]!), match.index ?? 0);
    store(`${match[3]}/${match[4]}`, numberOf(match[6]!), match.index ?? 0);
  }
  return found;
}

const METAL_NAMES: Readonly<Record<string, string>> = {
  zinc: "Zn", copper: "Cu", silver: "Ag", iron: "Fe", nickel: "Ni", magnesium: "Mg", aluminium: "Al", aluminum: "Al",
  lead: "Pb", tin: "Sn", cadmium: "Cd", cobalt: "Co", chromium: "Cr", platinum: "Pt", gold: "Au", mercury: "Hg",
  sodium: "Na", potassium: "K", calcium: "Ca", lithium: "Li", manganese: "Mn", thallium: "Tl", hydrogen: "H",
};

const ANION_CHARGE: Readonly<Record<string, number>> = {
  SO4: -2, NO3: -1, Cl: -1, Br: -1, I: -1, F: -1, ClO4: -1, CO3: -2, PO4: -3, OH: -1, CH3COO: -1, C2H3O2: -1,
};

/** The cation charge of a simple salt (ZnSO4 gives +2, AgNO3 gives +1, FeCl3 gives +3), or null. */
function saltCationCharge(formula: string): { metal: string; charge: number } | null {
  const parsed = parseFormula(formula);
  if (!parsed || parsed.charge !== 0 || parsed.atoms.length < 2) return null;
  const metal = parsed.atoms[0]!;
  if (!ELECTRODE_METALS.has(metal.symbol)) return null;
  const rest = parsed.atoms.slice(1);
  for (const [anion, charge] of Object.entries(ANION_CHARGE)) {
    const anionAtoms = parseFormula(anion)!.atoms;
    if (rest.length !== anionAtoms.length) continue;
    const k = rest[0]!.count / anionAtoms[0]!.count;
    if (!Number.isInteger(k) || k < 1) continue;
    const fits = rest.every((atom, index) => atom.symbol === anionAtoms[index]!.symbol && atom.count === anionAtoms[index]!.count * k);
    if (!fits) continue;
    const total = -charge * k;
    if (total % metal.count !== 0) return null;
    return { metal: metal.symbol, charge: total / metal.count };
  }
  return null;
}

interface SpeciesToken {
  formula: string;
  phase: "aq" | "s" | "g" | "l" | null;
  concentration: number | null;
  pressure: number | null;
}

function readConcentration(text: string): number | null {
  const molar = /(\d+(?:\.\d+)?(?:\s*[x×]\s*10\s*\^?\s*\(?\s*[+-]?\d+\s*\)?)?|10\s*\^?\s*\(?\s*[+-]?\d+\s*\)?)\s*(?:M\b|molar|mol\s*\/?\s*(?:L|dm)|mol\s*dm)/i.exec(text);
  if (!molar) return null;
  return parseScientific(molar[1]!);
}

function parseScientific(text: string): number | null {
  const cleaned = text.replace(/\s+/g, "");
  const sci = /^(\d+(?:\.\d+)?)?(?:[x×]?10\^?\(?([+-]?\d+)\)?)?$/.exec(cleaned);
  if (!sci) return null;
  const mantissa = sci[1] !== undefined ? Number(sci[1]) : 1;
  const exponent = sci[2] !== undefined ? Number(sci[2]) : 0;
  const value = mantissa * Math.pow(10, exponent);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readPressure(text: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*(?:bar|atm)\b/i.exec(text);
  return match ? Number(match[1]) : null;
}

/** Split on commas that are not inside parentheses: "Zn2+ (aq, 0.1 M), Fe3+" gives two parts. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const SPECIES_IN_TOKEN = /(?<![A-Za-z])([A-Z][a-z]?(?:[A-Za-z0-9]|\([A-Z][A-Za-z0-9]*\)\d*)*(?:\^?\(?\d*[+-]\)?|\+{2,}|-{2,})?)(?![a-z])/g;

/** One phase of a half cell: "Zn2+ (aq, 0.1 M)", "H2(g, 1 bar)", "Fe2+, Fe3+". */
function readSpeciesTokens(text: string): SpeciesToken[] {
  const tokens: SpeciesToken[] = [];
  for (const part of splitTopLevel(text)) {
    for (const match of part.matchAll(SPECIES_IN_TOKEN)) {
      const formula = canonicalSpecies(match[1]!);
      if (!formula) continue;
      const phaseMatch = /\(\s*(aq|s|g|l)\b/.exec(part);
      tokens.push({
        formula,
        phase: (phaseMatch?.[1] as SpeciesToken["phase"]) ?? null,
        concentration: readConcentration(part),
        pressure: readPressure(part),
      });
      break;
    }
  }
  return tokens;
}

const ELECTRODE_METALS = new Set(["Pt", "C", "Zn", "Cu", "Ag", "Fe", "Ni", "Mg", "Al", "Pb", "Sn", "Cd", "Co", "Cr", "Au", "Hg", "Na", "K", "Ca", "Li", "Mn", "Tl", "Ba", "Sr", "Rb", "Cs"]);

/** Trailing bare metal of a token ("For the cell Zn(s)" gives "Zn"; "Zn2+" and "AgCl(s)" give null). */
function trailingElectrode(text: string): string | null {
  const match = /(?<![A-Za-z])([A-Z][a-z]?)\s*(?:\(\s*s\s*\))?\s*$/.exec(text);
  if (!match) return null;
  return ELECTRODE_METALS.has(match[1]!) ? match[1]! : null;
}

/** Leading bare metal of a token ("Cu(s) is 1.10 V" gives "Cu"; "Cu2+" and "AgCl" give null). */
function leadingElectrode(text: string): string | null {
  const match = /^\s*([A-Z][a-z]?)\s*(?:\(\s*s\s*\))?(?![A-Za-z0-9+\-^])/.exec(text);
  if (!match) return null;
  return ELECTRODE_METALS.has(match[1]!) ? match[1]! : null;
}

/** An inert conductor listed among the species of a phase ("Pt, H2(g)"), if any. */
function embeddedElectrode(tokens: SpeciesToken[]): string | null {
  const bare = tokens.find((token) => (token.formula === "Pt" || token.formula === "C") && (token.phase === "s" || token.phase === null));
  return bare ? bare.formula : null;
}

function resolveHalfCell(electrode: string, tokens: SpeciesToken[], overrides: Map<string, { e0: number; n?: number }>): HalfCell | null {
  const formulas = tokens.map((token) => token.formula);
  const inert = electrode === "Pt" || electrode === "C";
  let record: CoupleRecord | null = null;
  let key: string | null = null;
  const charged = (formula: string): number => parseFormula(formula)?.charge ?? 0;
  const firstAtom = (formula: string): string => parseFormula(formula)?.atoms[0]?.symbol ?? "";
  const monatomic = (formula: string): boolean => (parseFormula(formula)?.atoms.length ?? 0) === 1;

  if (inert) {
    if (formulas.includes("H2") && (formulas.includes("H+") || formulas.some((formula) => /^H(Cl|Br|I|NO3|2SO4|ClO4)$/.test(formula)))) {
      key = "H+/H2";
    } else {
      const ions = formulas.filter((formula) => charged(formula) !== 0);
      const oxAnion = ions.find((formula) => charged(formula) < 0 && monatomic(formula));
      const halogen = oxAnion ? formulas.find((formula) => formula === `${firstAtom(oxAnion)}2`) : undefined;
      const sameMetal = ions.filter((formula) => monatomic(formula) && charged(formula) > 0);
      if (halogen && oxAnion) key = `${halogen}/${oxAnion}`;
      else if (sameMetal.length === 2 && firstAtom(sameMetal[0]!) === firstAtom(sameMetal[1]!)) {
        const [a, b] = [...sameMetal].sort((x, y) => charged(y) - charged(x));
        key = `${a}/${b}`;
      } else if (formulas.includes("MnO4-")) key = "MnO4-/Mn2+";
      else if (formulas.includes("Cr2O72-")) key = "Cr2O72-/Cr3+";
      else if (formulas.includes("MnO2")) key = "MnO2/Mn2+";
      else if (sameMetal.length === 1 && overrides.size > 0) {
        // A redox couple stated in the stem with only one ion written here.
        const only = sameMetal[0]!;
        const stated = [...overrides.keys()].find((candidate) => candidate.split("/").includes(only));
        if (stated) key = stated;
      }
      if (!key && sameMetal.length === 1 && !halogen) {
        const only = sameMetal[0]!;
        const candidates = STANDARD_POTENTIALS.filter((candidate) =>
          candidate.electrode === "Pt" && candidate.species.some((species) => species.formula === only && species.phase === "aq"));
        if (candidates.length === 1) key = candidates[0]!.key;
      }
    }
  } else {
    const coat = formulas.find((formula) => charged(formula) === 0 && !monatomic(formula) && firstAtom(formula) === electrode
      && tokens.find((token) => token.formula === formula)?.phase === "s");
    if (coat) {
      key = `${coat}/${electrode}`;
    } else {
      const ownIon = formulas.find((formula) => monatomic(formula) && charged(formula) > 0 && firstAtom(formula) === electrode);
      if (ownIon) key = `${ownIon}/${electrode}`;
      else {
        const salt = formulas.map(saltCationCharge).find((value) => value && value.metal === electrode);
        if (salt) key = `${salt.metal}${salt.charge > 1 ? salt.charge : ""}+/${electrode}`;
        else if (formulas.some((formula) => firstAtom(formula) === electrode)) {
          // "Ag | AgNO" style OCR damage: the metal is named, its common ion is the couple.
          const common = STANDARD_POTENTIALS.filter((candidate) => candidate.electrode === electrode && candidate.species.length === 2);
          if (common.length === 1) key = common[0]!.key;
        }
      }
    }
  }
  if (!key) return null;
  record = findCouple(key);
  const canonical = record ? record.key : key;
  const override = overrides.get(canonical) ?? overrides.get(reverseKey(canonical));
  const e0 = override ? override.e0 : record ? record.e0 : null;
  const n = record ? record.n : override?.n ?? (() => {
    const [ox, red] = canonical.split("/");
    const dq = charged(ox!) - charged(red!);
    return dq > 0 && monatomic(ox!) && monatomic(red!) ? dq : null;
  })();
  const concentrations: Record<string, number> = {};
  for (const token of tokens) {
    if (token.concentration !== null) concentrations[token.formula] = token.concentration;
    if (token.pressure !== null) concentrations[token.formula] = token.pressure;
  }
  // A concentration written on a salt belongs to its cation.
  for (const token of tokens) {
    const salt = saltCationCharge(token.formula);
    if (salt && token.concentration !== null) concentrations[`${salt.metal}${salt.charge > 1 ? salt.charge : ""}+`] = token.concentration;
  }
  const species = record?.species ?? [];
  const [oxRaw, redRaw] = canonical.split("/");
  const solution = record
    ? species.filter((entry) => entry.phase === "aq").map((entry) => entry.label)
    : [oxRaw!, redRaw!].filter((formula) => charged(formula) !== 0).map(speciesLabel);
  const gas = species.find((entry) => entry.phase === "g")?.label;
  const coatLabel = species.find((entry) => entry.phase === "s" && entry.formula !== electrode && entry.formula !== record?.electrode)?.label;
  return {
    couple: canonical,
    e0,
    n,
    electrode: record ? record.electrode : electrode,
    solution,
    ...(gas ? { gas } : {}),
    ...(coatLabel ? { coat: coatLabel } : {}),
    concentrations,
    potentialSource: override ? "stem" : record ? "table" : "unknown",
    record,
  };
}

function readNernstFactor(text: string): number | undefined {
  const match = /(?:2\.303\s*RT\s*\/\s*F|RT\s*\/\s*F|0\.0591|0\.059|0\.06)\D{0,12}?(?:=|is)?\s*(0\.0\d+)\s*V/i.exec(text)
    ?? /\b(0\.0591|0\.059|0\.06)\s*V\b/.exec(text);
  return match ? Number(match[1]) : undefined;
}

function readTemperature(text: string): number | undefined {
  const match = /(\d{3})\s*K\b/.exec(text);
  return match ? Number(match[1]) : undefined;
}

function readStatedCellPotentials(text: string): { e0?: number; e?: number } {
  const out: { e0?: number; e?: number } = {};
  const standard = new RegExp(`${E_NAUGHT}\\s*_?\\s*\\(?\\s*cell\\s*\\)?\\s*(?:=|is|:|of)?\\s*(?:the\\s+cell\\s+)?(?:=|is)?\\s*${VALUE}`, "i").exec(text)
    ?? new RegExp(`standard\\s+(?:emf|cell\\s+potential|electrode\\s+potential\\s+of\\s+the\\s+cell)[^.\\n]{0,30}?(?:=|is|:)\\s*${VALUE}`, "i").exec(text);
  if (standard) out.e0 = numberOf(standard[1]!);
  const observed = /(?:emf|e\.m\.f\.|cell potential|potential of the cell|emf of the cell|voltage)[^.\n]{0,110}?(?:is|=|of|measured\s+(?:as|to\s+be))\s*([+-]?\s*\d+(?:\.\d+)?)\s*(?:V|volt|volts)\b/i.exec(text)
    ?? /(?:is|=)\s*([+-]?\s*\d+(?:\.\d+)?)\s*(?:V|volts?)\s+at\s+\d{3}\s*K/i.exec(text);
  if (observed && !new RegExp(`${E_NAUGHT}|/`).test(observed[0])) {
    out.e = numberOf(observed[1]!);
  }
  return out;
}

function halfCellFromCouple(key: string, overrides: Map<string, { e0: number; n?: number }>, concentrations: Record<string, number> = {}): HalfCell | null {
  const record = findCouple(key);
  const canonical = record ? record.key : key;
  const override = overrides.get(canonical) ?? overrides.get(reverseKey(canonical));
  const [ox, red] = canonical.split("/");
  const oxParsed = parseFormula(ox!);
  const redParsed = parseFormula(red!);
  if (!oxParsed || !redParsed) return null;
  const electrode = record ? record.electrode : (redParsed.charge === 0 && redParsed.atoms.length === 1 ? redParsed.atoms[0]!.symbol : "Pt");
  const n = record ? record.n : override?.n ?? (oxParsed.atoms.length === 1 && redParsed.atoms.length === 1 && oxParsed.charge > redParsed.charge ? oxParsed.charge - redParsed.charge : null);
  const solution = record
    ? record.species.filter((entry) => entry.phase === "aq").map((entry) => entry.label)
    : [ox!, red!].filter((formula) => (parseFormula(formula)?.charge ?? 0) !== 0).map(speciesLabel);
  const gas = record?.species.find((entry) => entry.phase === "g")?.label;
  const coat = record?.species.find((entry) => entry.phase === "s" && entry.formula !== record.electrode)?.label;
  return {
    couple: canonical,
    e0: override ? override.e0 : record ? record.e0 : null,
    n,
    electrode,
    solution,
    ...(gas ? { gas } : {}),
    ...(coat ? { coat } : {}),
    concentrations,
    potentialSource: override ? "stem" : record ? "table" : "unknown",
    record,
  };
}

function compactNotation(anode: HalfCell, cathode: HalfCell): string {
  const side = (half: HalfCell): string => {
    const [ox, red] = half.couple.split("/") as [string, string];
    if (half.electrode === ox || half.electrode === red) return ox === half.electrode ? red : ox;
    const gas = half.record?.species.find((species) => species.phase === "g")?.formula;
    const ordered = gas ? [gas, ...[ox, red].filter((value) => value !== gas)] : [ox, red];
    return ordered.join(gas ? "|" : ",");
  };
  return `${anode.electrode}|${side(anode)}||${side(cathode)}|${cathode.electrode}`;
}

/**
 * Read a cell from its line notation: `Zn(s) | Zn2+(aq) || Cu2+(aq) | Cu(s)`,
 * `Zn|ZnSO4||CuSO4|Cu`, `Pt | H2(g, 1 bar) | H+(aq) || Ag+ | Ag`,
 * `Pt | Fe2+, Fe3+ || ...`. Left of the double bar is the anode. Potentials
 * stated in the same text override the table; concentrations in parentheses
 * are kept for the Nernst equation. Named cells ("Daniell cell") and prose
 * ("zinc rod dipped in ZnSO4 ... copper rod in CuSO4 ... salt bridge") are
 * read too. Null when either electrode cannot be read.
 */
export function parseCellNotation(text: string): CellSpec | null {
  const source = normalizeChemistryText(text);
  const overrides = statedPotentials(source);
  const extras = {
    nernstFactor: readNernstFactor(source),
    temperatureK: readTemperature(source),
    ...readStatedCellPotentials(source),
  };
  const finish = (anode: HalfCell | null, cathode: HalfCell | null, kind: CellSpec["source"]): CellSpec | null => {
    if (!anode || !cathode) return null;
    return {
      anode,
      cathode,
      notation: compactNotation(anode, cathode),
      ...(extras.nernstFactor !== undefined ? { nernstFactor: extras.nernstFactor } : {}),
      ...(extras.temperatureK !== undefined ? { temperatureK: extras.temperatureK } : {}),
      ...(extras.e0 !== undefined ? { statedE0: extras.e0 } : {}),
      ...(extras.e !== undefined ? { statedE: extras.e } : {}),
      source: kind,
    };
  };

  const bar = /\|\s*\||‖|¦\s*¦/.exec(source);
  if (bar) {
    const before = source.slice(0, bar.index);
    const after = source.slice(bar.index + bar[0].length);
    const leftTokens = before.split("|");
    const rightTokens = after.split("|");
    // Anode: walk back from the double bar until a token that is a bare electrode.
    let anodeElectrode: string | null = null;
    const anodeSpecies: SpeciesToken[] = [];
    for (let index = leftTokens.length - 1; index >= 0 && index >= leftTokens.length - 4; index -= 1) {
      const token = leftTokens[index]!;
      const species = readSpeciesTokens(token);
      const tail = trailingElectrode(token);
      if (tail) {
        anodeElectrode = tail;
        break;
      }
      const embedded = embeddedElectrode(species);
      if (embedded) {
        anodeElectrode = embedded;
        anodeSpecies.unshift(...species.filter((entry) => entry.formula !== embedded));
        break;
      }
      if (species.length === 0) break;
      anodeSpecies.unshift(...species);
    }
    // Cathode: walk forward from the double bar until a token that leads with a bare electrode.
    let cathodeElectrode: string | null = null;
    const cathodeSpecies: SpeciesToken[] = [];
    for (let index = 0; index < rightTokens.length && index < 4; index += 1) {
      const token = rightTokens[index]!;
      const lead = leadingElectrode(token);
      const species = readSpeciesTokens(token);
      if (lead && (species.length === 0 || species[0]!.formula === lead)) {
        cathodeElectrode = lead;
        break;
      }
      const embedded = embeddedElectrode(species);
      if (embedded) {
        cathodeElectrode = embedded;
        cathodeSpecies.push(...species.filter((entry) => entry.formula !== embedded));
        break;
      }
      if (species.length === 0) break;
      cathodeSpecies.push(...species);
    }
    if (anodeElectrode && cathodeElectrode) {
      const anode = resolveHalfCell(anodeElectrode, anodeSpecies, overrides);
      const cathode = resolveHalfCell(cathodeElectrode, cathodeSpecies, overrides);
      const spec = finish(anode, cathode, "notation");
      if (spec) return spec;
    }
  }

  const lower = source.toLowerCase();
  if (/\bdaniel?l\b/.test(lower)) {
    const daniell = finish(halfCellFromCouple("Zn2+/Zn", overrides, readNamedConcentration(lower, "zn")), halfCellFromCouple("Cu2+/Cu", overrides, readNamedConcentration(lower, "cu")), "named");
    if (daniell) return daniell;
  }

  const prose = readProseHalfCells(source, overrides);
  if (prose.length === 2) {
    const [a, b] = prose as [HalfCell, HalfCell];
    if (a.e0 !== null && b.e0 !== null) {
      const [anode, cathode] = a.e0 <= b.e0 ? [a, b] : [b, a];
      return finish(anode, cathode, "prose");
    }
  }

  const halves = readHalfReactionCells(source, overrides);
  if (halves.length === 2) {
    const [a, b] = halves as [HalfCell, HalfCell];
    const [anode, cathode] = (a.e0 ?? 0) <= (b.e0 ?? 0) ? [a, b] : [b, a];
    return finish(anode, cathode, "half_reactions");
  }

  if (/standard hydrogen electrode|hydrogen electrode/.test(lower) || /\bSHE\b/.test(source)) {
    const couples = [...source.matchAll(new RegExp(COUPLE, "g"))]
      .map((match) => coupleKey(`${match[1]}/${match[2]}`))
      .filter((key): key is string => Boolean(key) && key !== "H+/H2" && key !== "H2/H+")
      .filter((key) => findCouple(key) || overrides.has(key));
    const distinct = [...new Set(couples.map((key) => findCouple(key)?.key ?? key))];
    const single = distinct.length === 1 ? distinct[0]! : prose.length === 1 ? prose[0]!.couple : null;
    if (single) {
      const other = prose.length === 1 ? prose[0]! : halfCellFromCouple(single, overrides);
      const she = halfCellFromCouple("H+/H2", overrides);
      if (other && she && other.e0 !== null) {
        return other.e0 < 0 ? finish(other, she, "she") : finish(she, other, "she");
      }
    }
  }
  return null;
}

function readNamedConcentration(lower: string, metal: string): Record<string, number> {
  const match = new RegExp(`${metal}\\s*(?:2\\+|\\^\\(2\\+\\)|\\+\\+|so4)?[^.\\n]{0,20}?\\(?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:m\\b|molar)`, "i").exec(lower);
  if (!match) return {};
  const key = metal === "zn" ? "Zn2+" : "Cu2+";
  return { [key]: Number(match[1]) };
}

const SALT_NAMES: Readonly<Record<string, string>> = {
  sulphate: "SO4", sulfate: "SO4", nitrate: "NO3", chloride: "Cl", bromide: "Br", iodide: "I", acetate: "CH3COO",
};
const OLD_NAMES: Readonly<Record<string, string>> = {
  ferrous: "Fe2+", ferric: "Fe3+", stannous: "Sn2+", stannic: "Sn4+", cupric: "Cu2+", cuprous: "Cu+",
  mercuric: "Hg2+", plumbous: "Pb2+", cobaltous: "Co2+", nickelous: "Ni2+", zincic: "Zn2+",
};

/** The single table couple a metal electrode in its own salt stands for (Cu2+/Cu, Fe2+/Fe, Ag+/Ag). */
function commonCouple(symbol: string): CoupleRecord | null {
  return STANDARD_POTENTIALS.find((record) => record.electrode === symbol && record.species.length === 2 && record.species[1]!.formula === symbol) ?? null;
}

/**
 * Half cells written in words: "zinc rod dipped in 1 M ZnSO4", "silver
 * electrode in AgNO3 solution", "copper plate in copper sulphate". Order is
 * as written; the caller decides the anode from the potentials.
 */
function readProseHalfCells(source: string, overrides: Map<string, { e0: number; n?: number }>): HalfCell[] {
  const halves: HalfCell[] = [];
  const seen = new Set<string>();
  const metalWord = Object.keys(METAL_NAMES).join("|");
  const pattern = new RegExp(`(?<![A-Za-z])(${metalWord}|[A-Z][a-z]?)\\s+(?:metal\\s+)?(?:electrode|rod|plate|strip|foil|wire|bar)\\b(?=([^.;]{0,100}))`, "gi");
  for (const match of source.matchAll(pattern)) {
    const word = match[1]!;
    const symbol = METAL_NAMES[word.toLowerCase()] ?? (ELECTRODE_METALS.has(word) ? word : null);
    if (!symbol || symbol === "H") continue;
    const tail = match[2] ?? "";
    const clauseRaw = /\b(?:in|into)\b(.{0,80})/i.exec(tail)?.[1] ?? "";
    const clause = clauseRaw.split(/\b(?:and|while|whereas|other|another)\b|[,;]/i)[0] ?? "";
    let key: string | null = null;
    const concentrations: Record<string, number> = {};
    const conc = readConcentration(clause);
    const old = Object.keys(OLD_NAMES).find((name) => new RegExp(`\\b${name}\\b`, "i").test(clause));
    const saltName = Object.keys(SALT_NAMES).find((name) => new RegExp(`\\b${name}\\b`, "i").test(clause));
    const metalInClause = new RegExp(`\\b(${metalWord})\\b`, "i").exec(clause)?.[1];
    const common = commonCouple(symbol);
    if (old) {
      const ion = OLD_NAMES[old]!;
      if (parseFormula(ion)!.atoms[0]!.symbol === symbol) key = `${ion}/${symbol}`;
    } else if (metalInClause && saltName && METAL_NAMES[metalInClause.toLowerCase()] === symbol) {
      if (common) key = common.key;
    } else if (/\bits\s+(?:own\s+)?(?:salt|ions?|sulphate|sulfate|nitrate|chloride)/i.test(clause)) {
      if (common) key = common.key;
    } else {
      for (const token of clause.matchAll(SPECIES_IN_TOKEN)) {
        const canonical = canonicalSpecies(token[1]!);
        const parsed = canonical ? parseFormula(canonical) : null;
        if (!canonical || !parsed || parsed.atoms[0]!.symbol !== symbol) continue;
        if (parsed.charge > 0 && parsed.atoms.length === 1) key = `${canonical}/${symbol}`;
        else {
          const salt = saltCationCharge(canonical);
          if (salt) key = `${salt.metal}${salt.charge > 1 ? salt.charge : ""}+/${symbol}`;
          else if (common) key = common.key;
        }
        break;
      }
    }
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const record = findCouple(key);
    if (conc !== null) concentrations[(record ?? { key }).key.split("/")[0]!] = conc;
    const half = halfCellFromCouple(key, overrides, concentrations);
    if (half) halves.push(half);
  }
  return halves;
}

/** Cells given as two half reactions with potentials; both must carry a stated E°. */
function readHalfReactionCells(source: string, overrides: Map<string, { e0: number; n?: number }>): HalfCell[] {
  const halfReaction = new RegExp(
    `(?:^|[^A-Za-z0-9])(?:\\d+\\s*)?(${SPECIES})\\s*(?:\\(\\s*(?:aq|s|g|l)\\s*\\))?\\s*\\+\\s*(\\d*)\\s*e(?:\\^?\\(?-\\)?|\\^-|-)?\\s*(?:->|=|<=>)\\s*(?:\\d+\\s*)?(${SPECIES})(?:\\s*\\(\\s*(?:aq|s|g|l)\\s*\\))?[^\\n]{0,40}?${E_NAUGHT}[^\\n=]{0,12}(?:=|is|:)?\\s*${VALUE}`,
    "g",
  );
  const halves: HalfCell[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(halfReaction)) {
    const key = coupleKey(`${match[1]}/${match[3]}`);
    if (!key) continue;
    const canonical = findCouple(key)?.key ?? key;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const half = halfCellFromCouple(canonical, overrides);
    if (half && half.e0 !== null) halves.push(half);
  }
  return halves;
}

/* ------------------------------------------------------------------------- */
/* Cell emf                                                                   */
/* ------------------------------------------------------------------------- */

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface CellEmf {
  /** E°cell = E°cathode minus E°anode. */
  readonly e0: number;
  /** Nernst emf when any concentration or pressure is known; null at standard state. */
  readonly e: number | null;
  /** Electrons in the balanced cell reaction (lcm of the two half reactions). */
  readonly n: number;
  readonly anode: HalfCell;
  readonly cathode: HalfCell;
  /** Reaction quotient used, when `e` is set. */
  readonly q?: number;
  /** 2.303RT/F used, when `e` is set. */
  readonly factor?: number;
  /** ΔG° = −nFE° in kJ/mol. */
  readonly dG0kJ: number;
}

/**
 * E°cell and, when concentrations are known, the Nernst emf at 298 K (or at
 * `temperatureK`). `concentrations` override the spec's own values by
 * canonical species ("Zn2+", "Cu2+", "H+"); a gas pressure in bar is
 * given the same way ("H2"). `nernstFactor` is 2.303RT/F when the stem
 * fixes it (0.059, 0.06).
 */
export function cellEmf(
  spec: CellSpec,
  concentrations?: Readonly<Record<string, number>>,
  temperatureK?: number,
  nernstFactor?: number,
): CellEmf | null {
  const { anode, cathode } = spec;
  if (anode.e0 === null || cathode.e0 === null || anode.n === null || cathode.n === null) return null;
  const e0 = Number((cathode.e0 - anode.e0).toFixed(4));
  const n = (anode.n * cathode.n) / gcd(anode.n, cathode.n);
  const known = { ...anode.concentrations, ...cathode.concentrations, ...(concentrations ?? {}) };
  const dG0kJ = Number((-n * FARADAY * e0 / 1000).toFixed(2));
  if (Object.keys(known).length === 0 || !anode.record || !cathode.record) {
    return { e0, e: null, n, anode, cathode, dG0kJ };
  }
  const temperature = temperatureK ?? spec.temperatureK;
  const factor = nernstFactor ?? spec.nernstFactor ?? (temperature && temperature !== 298 ? Number((2.303 * 8.314 * temperature / FARADAY).toFixed(5)) : NERNST_298);
  // Q for the cell reaction: reduction quotient at the cathode times the
  // oxidation quotient at the anode, each species raised to n × (moles per electron).
  let logQ = 0;
  const contribute = (half: HalfCell, reduction: boolean): void => {
    for (const species of half.record!.species) {
      if (species.phase === "s" || species.phase === "l") continue;
      const activity = known[species.formula] ?? 1;
      const exponent = n * species.perElectron;
      const sign = (species.side === "red") === reduction ? 1 : -1;
      logQ += sign * exponent * Math.log10(activity);
    }
  };
  contribute(cathode, true);
  contribute(anode, false);
  const q = Math.pow(10, logQ);
  const e = Number((e0 - (factor / n) * logQ).toFixed(4));
  return { e0, e, n, anode, cathode, q, factor, dG0kJ };
}

/* ------------------------------------------------------------------------- */
/* Electrolysis                                                              */
/* ------------------------------------------------------------------------- */

export interface ElectrolysisProducts {
  /** Product at the anode, board spelling ("Cl_2", "O_2", "Cu dissolves"). */
  readonly anode: string;
  /** Product at the cathode ("H_2", "Cu", "Na"). */
  readonly cathode: string;
  /** What is left in solution, when a textbook names it ("NaOH"). */
  readonly solution?: string;
  /** The electrolyte as drawn inside the beaker ("NaCl(aq)", "NaCl(l)"). */
  readonly electrolyte: string;
  readonly molten: boolean;
  /** Electrode material: inert (Pt or graphite) or the named metal. */
  readonly electrodes: "inert" | string;
  readonly cathodeReaction: string;
  readonly anodeReaction: string;
  readonly cathodeGas: boolean;
  readonly anodeGas: boolean;
  /** Metal deposited at the cathode with its ion charge, for Faraday's law. */
  readonly deposit?: { symbol: string; n: number };
  readonly name: string;
}

interface ElectrolyteRule {
  readonly match: RegExp;
  /** Salts whose bare name is ambiguous between melt and solution (NaCl) need an aqueous word. */
  readonly needsAqueousCue?: boolean;
  readonly aqueous?: (electrodes: "inert" | string) => ElectrolysisProducts | null;
  readonly fused?: () => ElectrolysisProducts;
}

const WATER_ANODE = "2H_2O → O_2 + 4H^+ + 4e^-";
const WATER_CATHODE = "2H_2O + 2e^- → H_2 + 2OH^-";
const ACID_CATHODE = "2H^+ + 2e^- → H_2";

function aqueousWater(name: string, electrolyte: string): ElectrolysisProducts {
  return {
    anode: "O_2", cathode: "H_2", electrolyte, molten: false, electrodes: "inert",
    cathodeReaction: /H_2SO_4|acid/.test(electrolyte) || /acid/.test(name) ? ACID_CATHODE : WATER_CATHODE,
    anodeReaction: WATER_ANODE, cathodeGas: true, anodeGas: true, name,
  };
}

function halideBrine(salt: string, cation: string, halide: string, name: string): ElectrolyteRule {
  const gas = `${halide}_2`;
  const anion = `${halide}^-`;
  return {
    match: new RegExp(`\\b${salt.toLowerCase()}\\b|\\b${name.toLowerCase()}\\b`),
    needsAqueousCue: true,
    aqueous: () => ({
      anode: gas, cathode: "H_2", solution: `${cation}OH`, electrolyte: `${salt}(aq)`, molten: false, electrodes: "inert",
      cathodeReaction: WATER_CATHODE, anodeReaction: `2${anion} → ${gas} + 2e^-`, cathodeGas: true, anodeGas: true,
      name: `aqueous ${name}`,
    }),
    fused: () => ({
      anode: gas, cathode: cation, electrolyte: `${salt}(l)`, molten: true, electrodes: "inert",
      cathodeReaction: `${cation}^+ + e^- → ${cation}`, anodeReaction: `2${anion} → ${gas} + 2e^-`, cathodeGas: false, anodeGas: true,
      deposit: { symbol: cation, n: 1 }, name: `molten ${name}`,
    }),
  };
}

function metalSalt(salt: string, metal: string, charge: number, anodeInert: string, name: string, saltNames: string[]): ElectrolyteRule {
  const ion = `${metal}^(${charge}+)`;
  return {
    match: new RegExp(`\\b${salt.toLowerCase()}\\b|\\b(?:${saltNames.join("|")})\\b`),
    aqueous: (electrodes) => {
      const active = electrodes === metal;
      return {
        anode: active ? `${metal} dissolves` : anodeInert,
        cathode: metal,
        electrolyte: `${speciesLabel(salt)}(aq)`,
        molten: false,
        electrodes: active ? metal : "inert",
        cathodeReaction: `${ion} + ${charge}e^- → ${metal}`,
        anodeReaction: active ? `${metal} → ${ion} + ${charge}e^-` : WATER_ANODE,
        cathodeGas: false,
        anodeGas: !active,
        deposit: { symbol: metal, n: charge },
        name: active ? `${name} with ${metal} electrodes` : `aqueous ${name}`,
      };
    },
  };
}

const ELECTROLYTES: readonly ElectrolyteRule[] = [
  {
    match: /\bbrine\b|\bnacl\b|sodium chloride|common salt/,
    needsAqueousCue: true,
    aqueous: () => halideBrine("NaCl", "Na", "Cl", "sodium chloride").aqueous!("inert"),
    fused: () => halideBrine("NaCl", "Na", "Cl", "sodium chloride").fused!(),
  },
  halideBrine("KCl", "K", "Cl", "potassium chloride"),
  halideBrine("NaBr", "Na", "Br", "sodium bromide"),
  halideBrine("KBr", "K", "Br", "potassium bromide"),
  halideBrine("KI", "K", "I", "potassium iodide"),
  halideBrine("NaI", "Na", "I", "sodium iodide"),
  {
    match: /\bmgcl2\b|magnesium chloride/,
    fused: () => ({
      anode: "Cl_2", cathode: "Mg", electrolyte: "MgCl_2(l)", molten: true, electrodes: "inert",
      cathodeReaction: "Mg^(2+) + 2e^- → Mg", anodeReaction: "2Cl^- → Cl_2 + 2e^-", cathodeGas: false, anodeGas: true,
      deposit: { symbol: "Mg", n: 2 }, name: "molten magnesium chloride",
    }),
  },
  {
    match: /\bcacl2\b|calcium chloride/,
    fused: () => ({
      anode: "Cl_2", cathode: "Ca", electrolyte: "CaCl_2(l)", molten: true, electrodes: "inert",
      cathodeReaction: "Ca^(2+) + 2e^- → Ca", anodeReaction: "2Cl^- → Cl_2 + 2e^-", cathodeGas: false, anodeGas: true,
      deposit: { symbol: "Ca", n: 2 }, name: "molten calcium chloride",
    }),
  },
  {
    match: /\bpbbr2\b|lead bromide|lead\(ii\) bromide/,
    fused: () => ({
      anode: "Br_2", cathode: "Pb", electrolyte: "PbBr_2(l)", molten: true, electrodes: "inert",
      cathodeReaction: "Pb^(2+) + 2e^- → Pb", anodeReaction: "2Br^- → Br_2 + 2e^-", cathodeGas: false, anodeGas: true,
      deposit: { symbol: "Pb", n: 2 }, name: "molten lead bromide",
    }),
  },
  {
    match: /\bal2o3\b|alumina|aluminium oxide|aluminum oxide|bauxite|hall\s*[-–]?\s*heroult|cryolite/,
    aqueous: () => ELECTROLYTES.find((rule) => rule.match.source.includes("al2o3"))!.fused!(),
    fused: () => ({
      anode: "O_2, CO_2", cathode: "Al", electrolyte: "Al_2O_3+cryolite", molten: true, electrodes: "C",
      cathodeReaction: "Al^(3+) + 3e^- → Al", anodeReaction: "2O^(2-) → O_2 + 4e^-, then C + O_2 → CO_2", cathodeGas: false, anodeGas: true,
      deposit: { symbol: "Al", n: 3 }, name: "molten alumina (Hall Heroult)",
    }),
  },
  metalSalt("CuSO4", "Cu", 2, "O_2", "copper sulphate", ["copper sulphate", "copper sulfate", "copper\\s*\\(ii\\)\\s*sulphate", "copper\\s*\\(ii\\)\\s*sulfate", "cupric sulphate", "blister copper", "refining of (?:blister )?copper", "copper is (?:purified|refined)"]),
  {
    match: /\bcucl2\b|copper chloride|copper\(ii\) chloride/,
    aqueous: () => ({
      anode: "Cl_2", cathode: "Cu", electrolyte: "CuCl_2(aq)", molten: false, electrodes: "inert",
      cathodeReaction: "Cu^(2+) + 2e^- → Cu", anodeReaction: "2Cl^- → Cl_2 + 2e^-", cathodeGas: false, anodeGas: true,
      deposit: { symbol: "Cu", n: 2 }, name: "aqueous copper chloride",
    }),
  },
  metalSalt("AgNO3", "Ag", 1, "O_2", "silver nitrate", ["silver nitrate"]),
  metalSalt("NiSO4", "Ni", 2, "O_2", "nickel sulphate", ["nickel sulphate", "nickel sulfate"]),
  metalSalt("ZnSO4", "Zn", 2, "O_2", "zinc sulphate", ["zinc sulphate", "zinc sulfate"]),
  {
    match: /\bna2so4\b|sodium sulphate|sodium sulfate|\bk2so4\b|potassium sulphate|\bnano3\b|sodium nitrate|\bkno3\b|potassium nitrate/,
    aqueous: () => ({
      ...aqueousWater("aqueous sodium sulphate", "Na_2SO_4(aq)"),
    }),
  },
  {
    match: /\bnaoh\b|sodium hydroxide|\bkoh\b|potassium hydroxide/,
    aqueous: () => ({
      anode: "O_2", cathode: "H_2", electrolyte: "NaOH(aq)", molten: false, electrodes: "inert",
      cathodeReaction: WATER_CATHODE, anodeReaction: "4OH^- → O_2 + 2H_2O + 4e^-", cathodeGas: true, anodeGas: true,
      name: "aqueous sodium hydroxide",
    }),
  },
  {
    match: /\bh2so4\b|sulphuric acid|sulfuric acid|\bdil(?:ute|\.)?\s+acid\b/,
    aqueous: () => aqueousWater("dilute sulphuric acid", "dil. H_2SO_4"),
  },
  {
    match: /electrolysis of (?:acidified |acidulated |pure |distilled )?water|acidified water|acidulated water|water is electrolys/,
    aqueous: () => aqueousWater("water", "H_2O (acidified)"),
  },
  {
    match: /\bconc(?:entrated|\.)?\s+hcl\b|concentrated hydrochloric acid/,
    aqueous: () => ({
      anode: "Cl_2", cathode: "H_2", electrolyte: "conc. HCl", molten: false, electrodes: "inert",
      cathodeReaction: ACID_CATHODE, anodeReaction: "2Cl^- → Cl_2 + 2e^-", cathodeGas: true, anodeGas: true,
      name: "concentrated hydrochloric acid",
    }),
  },
];

/**
 * Products at inert (or the named metal) electrodes for a textbook
 * electrolyte named in `electrolyteText`: brine, molten NaCl, water or
 * dilute H2SO4, CuSO4 (Pt or Cu electrodes), AgNO3, NaBr, KI, Na2SO4,
 * molten Al2O3. Null for anything ambiguous (dilute NaCl, dilute HCl,
 * sodium acetate) or unnamed.
 */
export function electrolysisProducts(electrolyteText: string, electrodes?: string): ElectrolysisProducts | null {
  const whole = normalizeChemistryText(electrolyteText).toLowerCase();
  const lower = electrolysisWindow(whole);
  const molten = /\b(?:molten|fused|melt(?:ed)?)\b/.test(lower);
  const aqueousCue = /\baqueous\b|\(aq\)|\baq\b|\bsolution\b|\bbrine\b|\bdilute\b|\bconcentrated\b|\bdissolved\b|\bwater\b/.test(lower);
  const electrodeMaterial = electrodes
    ? (METAL_NAMES[electrodes.toLowerCase()] ?? electrodes)
    : readElectrodeMaterial(lower);
  if (/\b(?:very\s+)?dilute\s+(?:nacl|sodium chloride|brine|hcl|hydrochloric)/.test(lower)) return null;
  if (/\bacetate\b|kolbe|coona\b/.test(lower)) return null;
  // Several salts named together ("solutions of each of Cu(NO3)2, AgNO3 ... are
  // electrolysed") is a comparison, not one cell: never pick one of them.
  if (distinctSalts(electrolyteText).length >= 2) return null;
  const matching = ELECTROLYTES.filter((rule) => rule.match.test(lower));
  if (matching.length > 1 && !molten) return null;
  for (const rule of matching) {
    if (molten) {
      if (rule.fused) return rule.fused();
      continue;
    }
    if (rule.needsAqueousCue && !aqueousCue) continue;
    if (rule.aqueous) {
      const products = rule.aqueous(electrodeMaterial);
      if (products) return products;
    }
  }
  return null;
}

/**
 * The stretch of a stem that names what is electrolysed: 90 characters
 * before and 160 after each electrolysis word. A short input with no such
 * word ("brine", "molten NaCl") is used whole.
 */
function electrolysisWindow(lower: string): string {
  const pattern = /electrolys(?:is|ed|ing|e)|electrolyz(?:ed|ing|e)|electrolytic|electrorefin|electroplat/g;
  const windows: string[] = [];
  for (const match of lower.matchAll(pattern)) {
    const at = match.index ?? 0;
    windows.push(lower.slice(Math.max(0, at - 90), Math.min(lower.length, at + match[0].length + 160)));
  }
  return windows.length > 0 ? windows.join(" \n ") : lower;
}

/** Distinct neutral metal salts written as formulas in the electrolysis window. */
function distinctSalts(text: string): string[] {
  const window = electrolysisWindow(normalizeChemistryText(text));
  const salts = new Set<string>();
  for (const match of window.matchAll(SPECIES_IN_TOKEN)) {
    const canonical = canonicalSpecies(match[1]!);
    if (!canonical) continue;
    const salt = saltCationCharge(canonical);
    if (salt && salt.metal !== "H") salts.add(canonical);
  }
  return [...salts];
}

function readElectrodeMaterial(lower: string): "inert" | string {
  const named = /\b(copper|silver|nickel|zinc|cu|ag|ni|zn)\s+(?:electrodes?|anode|cathode|rods?|plates?)\b/.exec(lower);
  if (named) {
    const word = named[1]!;
    return METAL_NAMES[word] ?? word.charAt(0).toUpperCase() + word.slice(1);
  }
  if (/electrorefin|electrolytic refining|refining of (?:copper|blister)|blister copper|electroplat/.test(lower)) {
    return /silver|ag\b/.test(lower) ? "Ag" : "Cu";
  }
  return "inert";
}

/** The conductor to write on an inert electrode, only when the stem names it. */
function inertMaterialLabel(question: string): string | null {
  const lower = chemStem(question);
  if (/\bplatinum\b|\bpt\b/.test(lower)) return "Pt";
  if (/\bgraphite\b|\bcarbon electrodes?\b/.test(lower)) return "C";
  return null;
}

/** Faraday's law: metal mass deposited, in grams, when the stem gives a current and a time. */
export function faradayMass(question: string, deposit: { symbol: string; n: number }): { grams: number; ampere: number; seconds: number } | null {
  const text = normalizeChemistryText(question);
  const current = /(\d+(?:\.\d+)?)\s*(?:A\b|amp(?:ere)?s?\b|mA\b)/.exec(text);
  const time = /(\d+(?:\.\d+)?)\s*(s\b|sec(?:ond)?s?\b|min(?:ute)?s?\b|h\b|hr\b|hours?\b)/.exec(text);
  if (!current || !time) return null;
  const ampere = Number(current[1]) * (/mA/.test(current[0]) ? 1e-3 : 1);
  const unit = time[2]!;
  const seconds = Number(time[1]) * (/^s/.test(unit) ? 1 : /^min/.test(unit) ? 60 : 3600);
  const element = elementBySymbol(deposit.symbol);
  if (!element) return null;
  const grams = (element.mass / deposit.n) * ampere * seconds / FARADAY;
  return { grams, ampere, seconds };
}

/* ------------------------------------------------------------------------- */
/* Cues                                                                      */
/* ------------------------------------------------------------------------- */

// A bare "cell" is not redox: "EMF of a cell, internal resistance, and
// potential difference" is the physics current-electricity subject, and it
// used to pass this veto on that one word.
const REDOX_WORDS = /\b(?:electrode|anode|cathode|electroly\w*|oxidation|oxidised|oxidized|reduction|reduced|redox|half[- ]cell|salt bridge|nernst|galvanic|voltaic|daniell|electrochemical cell|concentration cell)\b|E°|E⁰|E®/i;
const PHYSICS_WORDS = /\b(?:resistor|resistors|ohm|ohms|kirchhoff|capacitor|capacitance|inductor|galvanometer|potentiometer|internal resistance)\b/i;

function conductancePlotCue(lower: string): boolean {
  return /kohlrausch/.test(lower)
    || /(?:variation|plot|graph|curve|dependence)[^.]{0,60}(?:molar conductivity|molar conductance|λ\s*m|λm|conductivity)[^.]{0,60}(?:√c|sqrt|root|dilution|concentration)/.test(lower)
    || /(?:molar conductivity|molar conductance|λm|λ\s*m)[^.]{0,40}(?:vs\.?|versus|against|with)\s*(?:√c|√\s*c|c\^?\s*\(?1\/2|root|dilution|concentration)/.test(lower)
    || /(?:molar conductivity|molar conductance)[^.]{0,40}\b(?:on|with|upon)\s+dilution\b/.test(lower);
}

function electrolysisCue(lower: string): boolean {
  return /\belectrolys(?:is|ed|ing|e)\b|\belectrolyz(?:ed|ing|e)\b|\belectrolytic\s+(?:cell|refining|reduction|extraction)\b|\belectrorefin|\belectroplat/.test(lower);
}

function galvanicCue(lower: string): boolean {
  return /\bgalvanic\b|\bvoltaic\b|\bdaniel?l\b|\belectrochemical cell\b|\bsalt bridge\b|\bcell potential\b|\bemf of (?:the |a |this )?cell\b|\bcell emf\b|\bnernst\b|standard hydrogen electrode|\bconcentration cell\b|\bhalf[- ]cells?\b/.test(lower);
}

/**
 * True for a stem this family should draw for: cell notation, a named or
 * described galvanic cell, a Nernst or electrode-potential question with a
 * couple named, an electrolysis, or the Kohlrausch conductivity plot. A
 * circuit stem (resistor, ohm, Kirchhoff, capacitor) is vetoed unless redox
 * words are present too.
 */
export function isElectrochemStem(question: string): boolean {
  const lower = chemStem(question);
  if (PHYSICS_WORDS.test(lower) && !REDOX_WORDS.test(lower)) return false;
  if (conductancePlotCue(lower)) return true;
  if (electrolysisCue(lower)) return true;
  if (galvanicCue(lower) || /\bSHE\b/.test(question)) return true;
  if (/\|\s*\||‖/.test(lower) && (REDOX_WORDS.test(lower) || parseCellNotation(question) !== null)) return true;
  if (/\b(?:electrode|reduction|oxidation|standard) potential\b|E°|E⁰/i.test(lower)
    && (new RegExp(COUPLE).test(normalizeChemistryText(question)) || /\bcell\b/.test(lower))) return true;
  return false;
}

/* ------------------------------------------------------------------------- */
/* Drawing helpers                                                           */
/* ------------------------------------------------------------------------- */

function fmtPotential(value: number): string {
  const text = value.toFixed(2);
  return (value < 0 ? "−" : "") + Math.abs(Number(text)).toFixed(2);
}

function signed(value: number): string {
  return value < 0 ? `(${fmtPotential(value)})` : fmtPotential(value);
}

function openBeaker(c: ChemScene, id: string, x0: number, x1: number, bottom: number, rim: number): string {
  const points = [
    c.helper({ x: x0, y: rim }, "beaker rim helper"),
    c.helper({ x: x0, y: bottom }, "beaker base helper"),
    c.helper({ x: x1, y: bottom }, "beaker base helper"),
    c.helper({ x: x1, y: rim }, "beaker rim helper"),
  ];
  return c.scene.polyline(id, points, "beaker");
}

function bar(c: ChemScene, id: string, cx: number, y0: number, y1: number, width: number, role: string): string {
  const half = width / 2;
  const points = [
    c.helper({ x: cx - half, y: y1 }, "electrode corner helper"),
    c.helper({ x: cx - half, y: y0 }, "electrode corner helper"),
    c.helper({ x: cx + half, y: y0 }, "electrode corner helper"),
    c.helper({ x: cx + half, y: y1 }, "electrode corner helper"),
  ];
  return c.scene.polygon(id, points, role);
}

/** Solution level: a line across the beaker broken around the bars in it. */
function levelLine(c: ChemScene, id: string, x0: number, x1: number, y: number, gaps: ReadonlyArray<readonly [number, number]>): string[] {
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
  const ids: string[] = [];
  let cursor = x0;
  sorted.forEach((gap, index) => {
    if (gap[0] > cursor + 0.05) {
      ids.push(c.scene.segment(`${id}_${index}`, c.helper({ x: cursor, y }, "level end helper"), c.helper({ x: gap[0], y }, "level end helper"), "solution level"));
    }
    cursor = gap[1];
  });
  if (x1 > cursor + 0.05) {
    ids.push(c.scene.segment(`${id}_${sorted.length}`, c.helper({ x: cursor, y }, "level end helper"), c.helper({ x: x1, y }, "level end helper"), "solution level"));
  }
  return ids;
}

function wire(c: ChemScene, id: string, points: readonly Vec2[], role = "wire"): string {
  return c.scene.polyline(id, points.map((point) => c.helper(point, "wire bend helper")), role);
}

function bubbles(c: ChemScene, id: string, x: number, yBase: number, side: 1 | -1): void {
  const offsets: Vec2[] = [{ x: 0.12, y: 0 }, { x: 0.28, y: 0.32 }, { x: 0.1, y: 0.62 }];
  offsets.forEach((offset, index) => {
    const centre = c.helper({ x: x + side * offset.x, y: yBase + offset.y }, "bubble centre helper");
    c.scene.circle(`${id}_${index}`, centre, 0.055, "gas bubble");
  });
}

/* ------------------------------------------------------------------------- */
/* Galvanic cell figure                                                      */
/* ------------------------------------------------------------------------- */

interface GalvanicLabels {
  e0Text?: string;
  eText?: string;
  dGText?: string;
}

function concentrationText(half: HalfCell): string | null {
  const entries = Object.entries(half.concentrations).filter(([formula]) => half.record?.species.some((species) => species.formula === formula && species.phase === "aq") ?? true);
  if (entries.length === 0) return null;
  const [, value] = entries[0]!;
  const text = value >= 0.001 ? `${Number(value.toPrecision(3))} M` : `${value.toExponential(0).replace("e-", "×10^-")} M`;
  return text.length <= 16 ? text : null;
}

function drawGalvanicCell(question: string, spec: CellSpec, emf: CellEmf | null, labels: GalvanicLabels, reason: string, caption: string): SceneDocument | null {
  const c = new ChemScene(question, reason, ELECTROCHEM_FAMILY);
  const { anode, cathode } = spec;
  const beakerW = 3;
  const gap = 2;
  const leftX0 = 0;
  const rightX0 = beakerW + gap;
  const bottom = 0;
  const rim = 2.6;
  const level = 2.0;
  const barW = 0.36;
  const barBottom = 0.45;
  const barTop = 3.4;
  const wireY = 4.3;
  const leftBar = leftX0 + 1.3;
  const rightBar = rightX0 + beakerW - 1.3;
  const bridgeLeft = leftX0 + beakerW - 0.65;
  const bridgeRight = rightX0 + 0.65;
  const bridgeTop = 3.15;
  const bridgeDip = 1.35;
  const tube = 0.16;

  openBeaker(c, "beaker_a", leftX0, leftX0 + beakerW, bottom, rim);
  openBeaker(c, "beaker_c", rightX0, rightX0 + beakerW, bottom, rim);
  levelLine(c, "level_a", leftX0, leftX0 + beakerW, level, [[leftBar - barW / 2, leftBar + barW / 2], [bridgeLeft - tube, bridgeLeft + tube]]);
  levelLine(c, "level_c", rightX0, rightX0 + beakerW, level, [[bridgeRight - tube, bridgeRight + tube], [rightBar - barW / 2, rightBar + barW / 2]]);
  bar(c, "electrode_a", leftBar, barBottom, barTop, barW, "anode electrode");
  bar(c, "electrode_c", rightBar, barBottom, barTop, barW, "cathode electrode");

  // Salt bridge: an inverted U tube, two parallel polylines.
  const bridgeOuter: Vec2[] = [
    { x: bridgeLeft - tube, y: bridgeDip }, { x: bridgeLeft - tube, y: bridgeTop + tube },
    { x: (bridgeLeft + bridgeRight) / 2, y: bridgeTop + tube },
    { x: bridgeRight + tube, y: bridgeTop + tube }, { x: bridgeRight + tube, y: bridgeDip },
  ];
  const bridgeInner: Vec2[] = [
    { x: bridgeLeft + tube, y: bridgeDip }, { x: bridgeLeft + tube, y: bridgeTop - tube },
    { x: (bridgeLeft + bridgeRight) / 2, y: bridgeTop - tube },
    { x: bridgeRight - tube, y: bridgeTop - tube }, { x: bridgeRight - tube, y: bridgeDip },
  ];
  wire(c, "salt_bridge", bridgeOuter, "salt bridge tube");
  wire(c, "salt_bridge_inner", bridgeInner, "salt bridge tube inner wall");
  c.text("salt_bridge_label", { x: (bridgeLeft + bridgeRight) / 2, y: bridgeTop + tube + 0.3 }, "salt bridge", "salt bridge label");

  // External circuit through a voltmeter at the middle of the top wire.
  const meterX = (leftBar + rightBar) / 2;
  const meterR = 0.32;
  wire(c, "wire_a", [{ x: leftBar, y: barTop }, { x: leftBar, y: wireY }, { x: meterX - meterR, y: wireY }]);
  wire(c, "wire_c", [{ x: meterX + meterR, y: wireY }, { x: rightBar, y: wireY }, { x: rightBar, y: barTop }]);
  c.atom("voltmeter", "V", { x: meterX, y: wireY }, { radius: meterR, role: "voltmeter" });
  const arrowFrom = { x: leftBar + 0.7, y: wireY + 0.28 };
  const arrowTo = { x: meterX - meterR - 0.45, y: wireY + 0.28 };
  c.arrow("electron_flow", arrowFrom, arrowTo, "electron flow", "e^-");

  // Electrode and ion labels.
  c.text("label_electrode_a", { x: leftBar - 0.42, y: barTop - 0.15 }, anode.electrode, "anode metal label");
  c.text("label_electrode_c", { x: rightBar + 0.42, y: barTop - 0.15 }, cathode.electrode, "cathode metal label");
  const ionA = anode.solution.join(",");
  const ionC = cathode.solution.join(",");
  if (ionA) c.text("ion_a", { x: leftX0 + 0.62, y: 1.25 }, ionA.slice(0, 16), "anode solution label");
  if (ionC) c.text("ion_c", { x: rightX0 + beakerW - 0.62, y: 1.25 }, ionC.slice(0, 16), "cathode solution label");
  const concA = concentrationText(anode);
  const concC = concentrationText(cathode);
  if (concA) c.text("conc_a", { x: leftX0 + 0.62, y: 0.85 }, concA, "anode concentration label");
  if (concC) c.text("conc_c", { x: rightX0 + beakerW - 0.62, y: 0.85 }, concC, "cathode concentration label");
  if (anode.gas) {
    bubbles(c, "gas_a", leftBar + barW / 2, 0.75, 1);
    c.text("gas_a_label", { x: leftBar + 0.6, y: 1.72 }, anode.gas, "anode gas label");
  }
  if (cathode.gas) {
    bubbles(c, "gas_c", rightBar - barW / 2, 0.75, -1);
    c.text("gas_c_label", { x: rightBar - 0.6, y: 1.72 }, cathode.gas, "cathode gas label");
  }
  if (anode.coat) c.text("coat_a", { x: leftBar + 0.62, y: 0.7 }, anode.coat, "anode coat label");
  if (cathode.coat) c.text("coat_c", { x: rightBar - 0.62, y: 0.7 }, cathode.coat, "cathode coat label");
  c.text("role_a", { x: leftX0 + beakerW / 2, y: bottom - 0.4 }, "anode (-)", "anode role label");
  c.text("role_c", { x: rightX0 + beakerW / 2, y: bottom - 0.4 }, "cathode (+)", "cathode role label");

  // Emf between the beakers, under the salt bridge.
  const midX = (leftX0 + beakerW + rightX0) / 2;
  let y = 1.85;
  if (labels.e0Text) { c.text("emf0", { x: midX, y }, labels.e0Text, "standard emf label"); y -= 0.42; }
  if (labels.eText) { c.text("emf", { x: midX, y }, labels.eText, "emf label"); y -= 0.42; }
  if (labels.dGText) { c.text("dg", { x: midX, y }, labels.dGText, "gibbs energy label"); }

  if (emf) {
    c.scene.quantity("E0_cell", "E°", emf.e0, "V");
    c.scene.quantity("n_electrons", "n", emf.n, "");
    c.scene.quantity("dG0", "ΔG°", emf.dG0kJ, "kJ/mol");
    if (emf.e !== null) c.scene.quantity("E_cell", "E", emf.e, "V");
  } else if (spec.statedE0 !== undefined) {
    c.scene.quantity("E0_cell", "E°", spec.statedE0, "V");
  }
  c.scene.labelled("label_electrode_a", "label_electrode_c", "role_a", "role_c", "salt_bridge_label", "electron_flow");
  return c.build({ caption });
}

function galvanicCaption(spec: CellSpec, emf: CellEmf | null, wantsGibbs: boolean): string {
  const { anode, cathode } = spec;
  const parts: string[] = [];
  if (emf) {
    parts.push(`${spec.notation}: E°cell = E°cathode − E°anode = ${fmtPotential(cathode.e0!)} − ${signed(anode.e0!)} = ${fmtPotential(emf.e0)} V, n = ${emf.n}`);
    if (spec.statedE === undefined && emf.e !== null && emf.q !== undefined && emf.factor !== undefined && Math.abs(emf.e - emf.e0) >= 0.005) {
      parts.push(`Nernst: E = E° − (${emf.factor}/${emf.n}) log Q, Q = ${Number(emf.q.toPrecision(3))}, E = ${fmtPotential(emf.e)} V`);
    }
    if (wantsGibbs) parts.push(`ΔG° = −nFE° = −${emf.n} × 96500 × ${fmtPotential(emf.e0)} = ${String(emf.dG0kJ).replace(/^-/, "−")} kJ/mol`);
    if (anode.potentialSource === "stem" || cathode.potentialSource === "stem") parts.push("potentials as given in the question");
  } else {
    parts.push(`${spec.notation}: ${anode.electrode} is oxidised at the anode (left), ${cathode.electrode} side is reduced at the cathode (right)`);
    if (spec.statedE0 !== undefined) parts.push(`E°cell = ${fmtPotential(spec.statedE0)} V as given`);
  }
  if (spec.statedE !== undefined) parts.push(`emf ${fmtPotential(spec.statedE)} V as given in the question`);
  return parts.join("; ");
}

function buildGalvanic(question: string, quantities: ChemPlanQuantity[], schematic: boolean): SceneDocument | null {
  const spec = parseCellNotation(question);
  const lower = chemStem(question);
  const wantsGibbs = /δg|delta\s*g|gibbs|free energy|ΔrG|\bdg\b/i.test(question) || /gibbs|free energy/.test(lower);
  if (!spec) {
    if (!schematic) return null;
    return buildSchematicGalvanic(question, lower);
  }
  const emf = cellEmf(spec);
  const labels: GalvanicLabels = {};
  if (emf) {
    labels.e0Text = `E° = ${fmtPotential(emf.e0)} V`;
    if (spec.statedE !== undefined) {
      // The question's own emf is the fact the student works from.
      if (Math.abs(spec.statedE - emf.e0) >= 0.005) labels.eText = `E = ${fmtPotential(spec.statedE)} V`;
    } else if (emf.e !== null && Math.abs(emf.e - emf.e0) >= 0.005) {
      labels.eText = `E = ${fmtPotential(emf.e)} V`;
    }
    if (wantsGibbs) {
      const text = `ΔG°=${emf.dG0kJ < 0 ? "−" : ""}${Math.abs(Math.round(emf.dG0kJ))} kJ/mol`;
      if (text.length <= 16) labels.dGText = text;
    }
  } else {
    const planE0 = spec.statedE0 ?? planQuantity(quantities, ["E0_cell", "E°cell", "Ecell", "E0cell", "E°"]);
    if (planE0 !== null && planE0 !== undefined) labels.e0Text = `E° = ${fmtPotential(planE0)} V`;
    else if (spec.statedE !== undefined) labels.eText = `E = ${fmtPotential(spec.statedE)} V`;
  }
  const reason = `${spec.anode.couple} anode and ${spec.cathode.couple} cathode with a salt bridge`;
  return drawGalvanicCell(question, spec, emf, labels, reason, galvanicCaption(spec, emf, wantsGibbs));
}

/** Last resort: the stem names a galvanic cell and its salt bridge but no couple. Symbolic labels only. */
function buildSchematicGalvanic(question: string, lower: string): SceneDocument | null {
  if (!/\b(?:galvanic|voltaic|electrochemical) cell\b/.test(lower) || !/salt bridge|anode|cathode/.test(lower)) return null;
  const generic = (electrode: string, ion: string): HalfCell => ({
    couple: `${ion}/${electrode}`, e0: null, n: null, electrode, solution: [ion], concentrations: {}, potentialSource: "unknown", record: null,
  });
  const spec: CellSpec = { anode: generic("M", "M^(n+)"), cathode: generic("N", "N^(m+)"), notation: "M|M^(n+)||N^(m+)|N", source: "named" };
  return drawGalvanicCell(question, spec, null, {}, "a galvanic cell with its salt bridge, electrodes unnamed", "Galvanic cell: oxidation at the anode (left), reduction at the cathode (right); electrons flow through the wire, ions through the salt bridge");
}

/* ------------------------------------------------------------------------- */
/* Electrolytic cell figure                                                  */
/* ------------------------------------------------------------------------- */

function drawElectrolyticCell(question: string, products: ElectrolysisProducts, massText: string | null, caption: string): SceneDocument | null {
  const c = new ChemScene(question, `electrolysis of ${products.name}`, ELECTROCHEM_FAMILY);
  const x0 = 0;
  const width = 5.0;
  const bottom = 0;
  const rim = 2.6;
  const level = 2.0;
  const barW = 0.3;
  const barBottom = 0.45;
  const barTop = 3.25;
  const wireY = 4.3;
  const anodeX = x0 + 1.35;
  const cathodeX = x0 + width - 1.35;
  const midX = x0 + width / 2;

  openBeaker(c, "beaker", x0, x0 + width, bottom, rim);
  levelLine(c, "level", x0, x0 + width, level, [[anodeX - barW / 2, anodeX + barW / 2], [cathodeX - barW / 2, cathodeX + barW / 2]]);
  bar(c, "anode_bar", anodeX, barBottom, barTop, barW, "anode electrode");
  bar(c, "cathode_bar", cathodeX, barBottom, barTop, barW, "cathode electrode");

  // Battery: long plate is positive (left), short plate negative (right).
  const plateGap = 0.16;
  const longX = midX - plateGap;
  const shortX = midX + plateGap;
  c.scene.segment("plate_long", c.helper({ x: longX, y: wireY - 0.42 }, "plate end helper"), c.helper({ x: longX, y: wireY + 0.42 }, "plate end helper"), "battery positive plate");
  c.scene.segment("plate_short", c.helper({ x: shortX, y: wireY - 0.22 }, "plate end helper"), c.helper({ x: shortX, y: wireY + 0.22 }, "plate end helper"), "battery negative plate");
  c.text("plus", { x: longX - 0.3, y: wireY + 0.55 }, "+", "battery positive label");
  c.text("minus", { x: shortX + 0.3, y: wireY + 0.55 }, "-", "battery negative label");
  wire(c, "wire_anode", [{ x: anodeX, y: barTop }, { x: anodeX, y: wireY }, { x: longX, y: wireY }]);
  wire(c, "wire_cathode", [{ x: shortX, y: wireY }, { x: cathodeX, y: wireY }, { x: cathodeX, y: barTop }]);
  c.arrow("electron_flow", { x: cathodeX + 0.3, y: wireY - 0.15 }, { x: cathodeX + 0.3, y: barTop + 0.1 }, "electron flow", "e^-");

  c.text("role_a", { x: anodeX, y: bottom - 0.4 }, "anode (+)", "anode role label");
  c.text("role_c", { x: cathodeX, y: bottom - 0.4 }, "cathode (-)", "cathode role label");
  const electrodeMaterial = products.electrodes === "inert" ? inertMaterialLabel(question) : products.electrodes;
  if (electrodeMaterial) {
    c.text("material_a", { x: anodeX - 0.4, y: rim + 0.25 }, electrodeMaterial, "anode material label");
    c.text("material_c", { x: cathodeX + 0.4, y: rim + 0.25 }, electrodeMaterial, "cathode material label");
  }
  c.text("electrolyte", { x: midX, y: 0.7 }, products.electrolyte.slice(0, 16), "electrolyte label");

  if (products.anodeGas) bubbles(c, "gas_a", anodeX - barW / 2, 0.8, -1);
  if (products.cathodeGas) bubbles(c, "gas_c", cathodeX + barW / 2, 0.8, 1);
  c.text("product_a", { x: anodeX - 0.7, y: 1.7 }, products.anode.slice(0, 16), "anode product label");
  c.text("product_c", { x: cathodeX + 0.7, y: 1.7 }, products.cathode.slice(0, 16), "cathode product label");
  if (!products.cathodeGas && products.deposit) {
    // Deposit: a thickened band on the lower cathode face.
    c.scene.segment("deposit", c.helper({ x: cathodeX - barW / 2 - 0.05, y: barBottom }, "deposit helper"), c.helper({ x: cathodeX - barW / 2 - 0.05, y: level - 0.15 }, "deposit helper"), "metal deposit");
    c.scene.segment("deposit_r", c.helper({ x: cathodeX + barW / 2 + 0.05, y: barBottom }, "deposit helper"), c.helper({ x: cathodeX + barW / 2 + 0.05, y: level - 0.15 }, "deposit helper"), "metal deposit");
  }
  if (products.solution) c.text("solution", { x: midX, y: 1.3 }, products.solution.slice(0, 16), "solution product label");
  if (massText) c.text("mass", { x: midX, y: products.solution ? 1.7 : 1.3 }, massText, "deposited mass label");
  c.scene.labelled("role_a", "role_c", "product_a", "product_c", "electrolyte", "electron_flow");
  return c.build({ caption });
}

function buildElectrolytic(question: string): SceneDocument | null {
  const products = electrolysisProducts(question);
  if (!products) return null;
  let massText: string | null = null;
  const captionParts = [`Electrolysis of ${products.name}: cathode ${products.cathodeReaction}, anode ${products.anodeReaction}`];
  if (products.solution) captionParts.push(`${products.solution} left in solution`);
  if (products.deposit) {
    const faraday = faradayMass(question, products.deposit);
    if (faraday) {
      const grams = Number(faraday.grams.toPrecision(3));
      const text = `${products.deposit.symbol}: ${grams} g`;
      if (text.length <= 16) massText = text;
      captionParts.push(`Faraday: m = (M/n) × I t / 96500 = ${grams} g of ${products.deposit.symbol} for ${faraday.ampere} A over ${faraday.seconds} s`);
    }
  }
  return drawElectrolyticCell(question, products, massText, captionParts.join("; "));
}

/* ------------------------------------------------------------------------- */
/* Conductance plot                                                          */
/* ------------------------------------------------------------------------- */

function buildConductancePlot(question: string): SceneDocument | null {
  const c = new ChemScene(question, "molar conductivity against root concentration, strong and weak electrolytes", ELECTROCHEM_FAMILY);
  const s = c.scene;
  s.axes("axes", -0.05, 1.25, -0.08, 1.2, "conductivity axes");
  s.curve("strong", "0.95 - 0.35*x", 0, 1, "strong electrolyte", "strong", 33);
  s.curve("weak", "0.75*exp(-6*x)", 0, 1, "weak electrolyte", "weak", 65);
  c.text("x_label", { x: 1.15, y: -0.2 }, "√c", "x axis label");
  c.text("y_label", { x: -0.18, y: 1.1 }, "Λ_m", "y axis label");
  s.labelled("strong", "weak");
  return c.build({ caption: "Λm vs √c: a strong electrolyte falls on a straight line, Λm = Λ°m − A√c (Kohlrausch); a weak electrolyte rises steeply as c → 0, so Λ°m cannot be read by extrapolation" });
}

/* ------------------------------------------------------------------------- */
/* Family entry                                                              */
/* ------------------------------------------------------------------------- */

/**
 * The figure for the stem, or null when the stem does not ground it: a
 * galvanic cell when two electrodes are readable, an electrolytic cell when
 * a textbook electrolyte is named, the Kohlrausch plot when the stem is
 * about that variation.
 */
export function buildElectrochemScene(question: string, quantities: ChemPlanQuantity[], schematic: boolean): SceneDocument | null {
  if (!isElectrochemStem(question)) return null;
  const lower = chemStem(question);
  if (conductancePlotCue(lower)) return buildConductancePlot(question);
  const galvanic = buildGalvanicIfReadable(question, quantities);
  if (galvanic) return galvanic;
  if (electrolysisCue(lower)) {
    const electrolytic = buildElectrolytic(question);
    if (electrolytic) return electrolytic;
  }
  if (schematic) return buildGalvanic(question, quantities, true);
  return null;
}

function buildGalvanicIfReadable(question: string, quantities: ChemPlanQuantity[]): SceneDocument | null {
  return buildGalvanic(question, quantities, false);
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                    */
/* ------------------------------------------------------------------------- */

export const ELECTROCHEM_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  {
    question: "Draw the Daniell cell and calculate its standard emf.",
    expect: "draw",
    labels: ["Zn", "Cu", "Zn^(2+)", "Cu^(2+)", "anode (-)", "cathode (+)", "salt bridge", "E° = 1.10 V"],
    note: "E° = 0.34 − (−0.76) = 1.10 V, n = 2",
  },
  {
    question: "Calculate the emf of the cell Zn(s) | Zn2+(0.1 M) || Cu2+(0.01 M) | Cu(s) at 298 K. E°(Zn2+/Zn) = −0.76 V, E°(Cu2+/Cu) = 0.34 V.",
    expect: "draw",
    labels: ["E° = 1.10 V", "E = 1.07 V", "0.1 M", "0.01 M"],
    note: "E = 1.10 − (0.0591/2) log(0.1/0.01) = 1.0705 V",
  },
  {
    question: "For the cell Pt(s) | H2(g, 1 bar) | H+(aq, 1 M) || Ag+(aq, 1 M) | Ag(s), find E°cell.",
    expect: "draw",
    labels: ["Pt", "Ag", "H^+", "Ag^+", "H_2", "E° = 0.80 V"],
    note: "SHE anode, E° = 0.80 − 0 = 0.80 V, n = 2",
  },
  {
    question: "Write the cell reaction and calculate E°cell for Fe | Fe2+ || Cu2+ | Cu.",
    expect: "draw",
    labels: ["Fe", "Cu", "E° = 0.78 V"],
    note: "0.34 − (−0.44) = 0.78 V",
  },
  {
    question: "Calculate the standard cell potential of the galvanic cell Ni(s) | Ni2+(aq) || Ag+(aq) | Ag(s) and the number of electrons transferred.",
    expect: "draw",
    labels: ["Ni", "Ag", "E° = 1.05 V"],
    note: "0.80 − (−0.25) = 1.05 V, n = 2",
  },
  {
    question: "Find E°cell for the cell Mg | Mg2+ || Zn2+ | Zn.",
    expect: "draw",
    labels: ["Mg", "Zn", "E° = 1.61 V"],
    note: "−0.76 − (−2.37) = 1.61 V",
  },
  {
    question: "Given E°(Sn2+/Sn) = −0.20 V and E°(Pb2+/Pb) = −0.10 V, calculate E°cell for Sn | Sn2+ || Pb2+ | Pb.",
    expect: "draw",
    labels: ["Sn", "Pb", "E° = 0.10 V"],
    forbidLabels: ["E° = 0.01 V"],
    note: "the stem's values win: −0.10 − (−0.20) = 0.10 V, not the table's 0.01 V",
  },
  {
    question: "A zinc rod is dipped in 1 M ZnSO4 solution and a copper rod in 1 M CuSO4 solution; the two are connected by a salt bridge. Find the ΔG° of the cell reaction.",
    expect: "draw",
    labels: ["Zn", "Cu", "E° = 1.10 V", "ΔG°=−212 kJ/mol"],
    note: "ΔG° = −2 × 96500 × 1.10 = −212.3 kJ/mol",
  },
  {
    question: "Draw the electrolytic cell for the electrolysis of brine with inert electrodes and name the products at each electrode.",
    expect: "draw",
    labels: ["Cl_2", "H_2", "NaCl(aq)", "anode (+)", "cathode (-)", "NaOH"],
  },
  {
    question: "What are the products of electrolysis of molten NaCl using platinum electrodes?",
    expect: "draw",
    labels: ["Cl_2", "Na", "NaCl(l)"],
    forbidLabels: ["H_2", "NaOH"],
  },
  {
    question: "Aqueous CuSO4 is electrolysed using platinum electrodes. Give the reactions at the two electrodes.",
    expect: "draw",
    labels: ["Cu", "O_2", "CuSO_4(aq)"],
  },
  {
    question: "Aqueous copper sulphate solution is electrolysed with copper electrodes. What happens at the anode and the cathode?",
    expect: "draw",
    labels: ["Cu", "Cu dissolves", "CuSO_4(aq)"],
    forbidLabels: ["O_2"],
  },
  {
    question: "A dilute solution of sulphuric acid is electrolysed using a current of 0.10 A for 2 hours to produce hydrogen and oxygen gas. Draw the cell.",
    expect: "draw",
    labels: ["H_2", "O_2", "dil. H_2SO_4"],
  },
  {
    question: "Draw the variation of molar conductivity with √c for a strong electrolyte and a weak electrolyte and explain Kohlrausch law.",
    expect: "draw",
    labels: ["strong", "weak", "√c", "Λ_m"],
  },
  {
    question: "The standard emf of a cell is 1.1 V. Calculate ΔG° for the cell reaction if n = 2.",
    expect: "decline",
    note: "no electrodes named",
  },
  {
    question: "A cell of emf 2 V and internal resistance 1 ohm is connected to a resistor of 4 ohm. Find the current in the circuit.",
    expect: "decline",
    note: "physics circuit, vetoed",
  },
];
