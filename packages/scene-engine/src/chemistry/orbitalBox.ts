/**
 * Atomic-structure figures for the JEE "Atomic structure" stems that are not
 * Bohr transitions (physics owns energy levels): the orbital box diagram of
 * an element or a bare ion, the shape of a named orbital with its nodes, and
 * the subshell ladder of a stated principal quantum number.
 *
 * Every drawn value comes from the stem or from the periodic table: the
 * species is read from the question, its configuration is computed by the
 * shared aufbau module, and node counts follow n and l as written. A stem
 * that names no species, no orbital and no n draws nothing; a coordination
 * complex or a compound whose oxidation state would have to be deduced is
 * declined rather than guessed.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import { electronConfiguration, type Subshell } from "./electronConfiguration";
import { ELEMENTS, elementBySymbol, type ElementRecord } from "./elements";
import { complexTokens, formulaTokens, normalizeChemistryText, parseFormula } from "./formula";

export const ORBITAL_FAMILY = "chem_orbital" as const;

/* ------------------------------------------------------------------------- */
/* Cues                                                                      */
/* ------------------------------------------------------------------------- */

const BOX_CUES = /electron(?:ic)? configuration|orbital diagram|box diagram|unpaired electron|magnetic moment|spin[ -]?only|hund|aufbau|pauli/;
const SHAPE_CUES = /shapes? of|nodal|\bnodes?\b|lobes?/;
const QUANTUM_CUES = /quantum number|number of orbitals|how many orbitals|maximum number of electrons|max(?:imum)? electrons|electrons (?:can|that can|which can) (?:be )?(?:accommodated|held|present)/;
/** A box-diagram cue strong enough to keep an otherwise physics-flavoured stem. */
const STRONG_BOX_CUES = /electron(?:ic)? configuration|orbital diagram|box diagram/;
// "Magnetic moment" alone is not a box diagram: a revolving charge, a
// current loop, a coil and a bar magnet all have one and belong to physics.
const PHYSICS_VETO = /transition|wavelength|balmer|lyman|paschen|brackett|\bbohr\b|photon|rydberg|photo.?electric|hydrogen.like|de broglie|frequency|spectral line|spectrum|ionis[ae]tion (?:energy|enthalpy) of hydrogen|revolving (?:charge|electron)|current (?:loop|carrying)|\bcoil\b|bar magnet|solenoid|magnetic field|\btorque\b|magnetic dipole|angular momentum of/;
const COMPLEX_VETO = /crystal field|cfse|ligand|\bcomplex(?:es)?\b|spectrochemical|hybridi[sz]|coordination|octahedral|tetrahedral|square planar|\bt2g\b|\be_?g\b|bond order|molecular orbital|\bmo\b|inner.orbital|outer.orbital/;

/** True when this family should draw for the stem: a box, shape or quantum-number cue, with the physics and complex vetoes. */
/** A square bracket opening on a metal symbol is a coordination entity even when OCR has mangled the rest. */
const BRACKET_COMPLEX = /\[(?!(?:he|ne|ar|kr|xe|rn)\])[a-z]{1,2}\s*[(\d]/;
const LIGAND_TOKENS = /\((?:nh3|h2o|cn|en|co|ox|c2o4|ncs|scn|no2|py|bipy|phen|edta|nh 3|h 2 o)\)/;

export function isOrbitalStem(question: string): boolean {
  const stem = chemStem(question);
  if (COMPLEX_VETO.test(stem) || complexTokens(question).length > 0) return false;
  if (BRACKET_COMPLEX.test(stem) || LIGAND_TOKENS.test(stem)) return false;
  if (PHYSICS_VETO.test(stem) && !STRONG_BOX_CUES.test(stem)) return false;
  if (BOX_CUES.test(stem)) return true;
  if (SHAPE_CUES.test(stem) && /orbital/.test(stem)) return true;
  if (QUANTUM_CUES.test(stem)) return true;
  return false;
}

/* ------------------------------------------------------------------------- */
/* Reading the stem                                                          */
/* ------------------------------------------------------------------------- */

interface Species {
  readonly element: ElementRecord;
  readonly charge: number;
  /** Position in the stem, for ordering. */
  readonly at: number;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
const NAMED_IONS: Record<string, [string, number]> = {
  ferric: ["Fe", 3], ferrous: ["Fe", 2], cupric: ["Cu", 2], cuprous: ["Cu", 1],
  manganous: ["Mn", 2], cobaltous: ["Co", 2], chromic: ["Cr", 3], chromous: ["Cr", 2],
};
const CONTEXT_BEFORE = new Set(["of", "for", "in", "element", "elements", "atom", "atoms", "ion", "ions", "metal", "metals", "among", "amongst", "and", "between", "is", "are", "like", "e.g.", "eg", "viz", "namely", "than", "with"]);
const CONTEXT_AFTER = new Set(["atom", "atoms", "ion", "ions", "element", "metal", "is", "has", "have", "in", "and", "(z", "(atomic", "z", "with"]);
const NAME_EXCLUSIONS = new Set(["lead"]);

function plausibleCharge(element: ElementRecord, charge: number): boolean {
  if (charge === 0) return true;
  if (charge > 0) {
    if (charge > 4) return false;
    if (element.block === "p") return ["Al", "Ga", "In", "Tl", "Sn", "Pb", "Bi", "Sb"].includes(element.symbol);
    return element.symbol !== "H" && element.symbol !== "He";
  }
  if (element.symbol === "H") return charge === -1;
  if (element.block !== "p") return false;
  return charge === (element.group ?? 18) - 18;
}

/** "+2 oxidation state", "oxidation state of +3", "M^(2+) ion": one charge the stem applies to its bare elements. */
function statedOxidationState(stem: string): number | null {
  const patterns = [
    /\+\s*(\d)\s*oxidation state/, /oxidation state (?:of |is )?\+\s*(\d)/, /oxidation number (?:of |is )?\+\s*(\d)/,
    /\bm\^?\(?(\d)\+\)?\s*(?:ion|state)/, /\(\s*\+\s*(\d)\s*\)/, /dipositive/, /tripositive/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(stem);
    if (!match) continue;
    if (pattern.source === "dipositive") return 2;
    if (pattern.source === "tripositive") return 3;
    return Number(match[1]);
  }
  return null;
}

interface SymbolToken { readonly symbol: string; readonly start: number; readonly end: number }

/**
 * Maximal runs of element-symbol tokens separated only by commas, "and",
 * "or", slashes or option markers, so a list reads as a whole or not at all.
 */
function symbolRuns(text: string): SymbolToken[][] {
  const tokens: SymbolToken[] = [];
  for (const match of text.matchAll(/(?<![A-Za-z[(])([A-Z][a-z]?)(?:\^?\(?\d?[+-]\)?)?(?![A-Za-z0-9^([])/g)) {
    tokens.push({ symbol: match[1]!, start: match.index!, end: match.index! + match[0].length });
  }
  const runs: SymbolToken[][] = [];
  let current: SymbolToken[] = [];
  const separator = /^\s*(?:(?:,|;|and|or|&|\/)\s*)?(?:\(\s*[A-Ea-e]\s*\)|[A-E]\.)?\s*$/;
  const joins = (gap: string): boolean => separator.test(gap) && /[,;&/]|\band\b|\bor\b|\(|\./.test(gap);
  for (const token of tokens) {
    const last = current[current.length - 1];
    if (last && joins(text.slice(last.end, token.start))) current.push(token);
    else {
      if (current.length >= 2) runs.push(current);
      current = [token];
    }
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

/** The monatomic species the stem names, in order of appearance; empty when none is readable. */
function readSpecies(question: string): Species[] {
  const text = normalizeChemistryText(question);
  const lower = text.toLowerCase();
  const found: Species[] = [];
  const claimed: Array<[number, number]> = [];
  const claim = (start: number, end: number): boolean => {
    if (claimed.some(([a, b]) => start < b && end > a)) return false;
    claimed.push([start, end]);
    return true;
  };
  const push = (element: ElementRecord, charge: number, at: number): void => {
    if (!plausibleCharge(element, charge)) return;
    if (found.some((species) => species.element.symbol === element.symbol && species.charge === charge)) return;
    found.push({ element, charge, at });
  };

  // 1. Charged monatomic ions written as formulas: Fe^(3+), Fe3+, Cu+, Cl-, Fe^+3.
  for (const match of text.matchAll(/(?<![A-Za-z[(])([A-Z][a-z]?)(?:\^?\(?(\d?)([+-])\)?|\^?\(?([+-])(\d)\)?)(?![A-Za-z0-9])/g)) {
    const element = elementBySymbol(match[1]!);
    if (!element) continue;
    const magnitude = Number((match[2] || match[5] || "1")) || 1;
    const sign = (match[3] ?? match[4]) === "-" ? -1 : 1;
    if (!claim(match.index!, match.index! + match[0].length)) continue;
    push(element, magnitude * sign, match.index!);
  }
  // Ion tokens the formula reader accepts (a second net for spacing variants).
  for (const token of formulaTokens(text)) {
    const parsed = parseFormula(token);
    if (!parsed || parsed.totalAtoms !== 1 || parsed.charge === 0) continue;
    const at = text.indexOf(token);
    if (at >= 0 && !claim(at, at + token.length)) continue;
    push(parsed.atoms[0]!.element, parsed.charge, at < 0 ? text.length : at);
  }

  // 2. Roman-numeral oxidation states: Fe(III), Cu(I), chromium(III).
  for (const match of text.matchAll(/([A-Z][a-z]?|[A-Za-z]{3,})\s*\(\s*(I{1,3}|IV|V|VI|VII)\s*\)/g)) {
    const token = match[1]!;
    const element = elementBySymbol(token) ?? ELEMENTS.find((candidate) => candidate.name.toLowerCase() === token.toLowerCase()) ?? null;
    if (!element) continue;
    if (!claim(match.index!, match.index! + match[0].length)) continue;
    push(element, ROMAN[match[2]!]!, match.index!);
  }

  // 3. Trivial ion names.
  for (const [name, [symbol, charge]] of Object.entries(NAMED_IONS)) {
    const at = lower.search(new RegExp(`\\b${name}\\b`));
    if (at >= 0) push(elementBySymbol(symbol)!, charge, at);
  }

  const stated = statedOxidationState(lower);
  // 4. Element names.
  for (const element of ELEMENTS) {
    const name = element.name.toLowerCase();
    if (NAME_EXCLUSIONS.has(name)) continue;
    const pattern = new RegExp(`\\b${name}\\b`, "g");
    for (const match of lower.matchAll(pattern)) {
      // "potassium permanganate", "copper sulphate": the name is part of a compound, not a species.
      const following = lower.slice(match.index! + name.length).trimStart();
      if (/^(?:\(\s*[ivx]+\s*\)\s*)?[a-z]*(?:ate|ide|ite|ates|ides|ites)\b/.test(following)) continue;
      if (/^(?:salts?|solutions?|compounds?|complex(?:es)?|metal|oxide|alloy)\b/.test(following)) continue;
      // "copper ion" names a charge the stem never states.
      if (stated === null && /^ions?\b/.test(following)) continue;
      if (!claim(match.index!, match.index! + name.length)) continue;
      push(element, stated ?? 0, match.index!);
    }
  }
  // 5. Lists of symbols: "Sc, Cr, V, Ti and Mn", "(A) Sc (B) Cr (C) V". Every member must be an element.
  for (const run of symbolRuns(text)) {
    if (run.some((token) => !elementBySymbol(token.symbol))) continue;
    if (!run.some((token) => token.symbol.length === 2 || claimed.some(([a, b]) => token.start < b && token.end > a))) continue;
    for (const token of run) {
      if (!claim(token.start, token.end)) continue;
      push(elementBySymbol(token.symbol)!, stated ?? 0, token.start);
    }
  }
  // 6. Bare symbols in a context that reads as an element, never as an option letter or a formula piece.
  for (const match of text.matchAll(/(?<![A-Za-z[(])([A-Z][a-z]?)(?![a-z])/g)) {
    const symbol = match[1]!;
    const element = elementBySymbol(symbol);
    if (!element) continue;
    const start = match.index!;
    const end = start + symbol.length;
    const next = text[end] ?? " ";
    const previous = text[start - 1] ?? " ";
    if (/[A-Z0-9^([\]{}]/.test(next) || next === "." && /[A-Z]/.test(text[end + 1] ?? " ")) continue;
    if (/[A-Za-z0-9\])}]/.test(previous)) continue;
    const before = lower.slice(0, start).trim().split(/\s+/).pop() ?? "";
    const afterWords = lower.slice(end).trim().split(/\s+/);
    const after = afterWords[0] ?? "";
    const optionMarker = /\(\s*[A-E]\s*\)\s*$/.test(text.slice(0, start)) || /\b[A-E]\.\s*$/.test(text.slice(0, start));
    // "Cu ion" names a charge the stem never states.
    if (stated === null && (after === "ion" || after === "ions")) continue;
    const strong = ["atom", "atoms", "(z", "(atomic", "ion", "ions"].includes(after) || /^\(\s*z\s*=/.test(lower.slice(end).trim()) || /^\(\s*atomic/.test(lower.slice(end).trim()) || ["element", "of", "atom"].includes(before) && symbol.length === 2;
    const contextual = CONTEXT_BEFORE.has(before) || CONTEXT_AFTER.has(after) || optionMarker;
    if (symbol.length === 1 && !strong) continue;
    if (!strong && !contextual) continue;
    if (!claim(start, end)) continue;
    push(element, stated ?? 0, start);
  }
  return found.sort((a, b) => a.at - b.at);
}

/** Polyatomic formulas that carry a d or f block metal: an oxidation state we would have to deduce. */
function hasMetalCompound(question: string): boolean {
  return formulaTokens(question).some((token) => {
    // Cu(II) is an oxidation state, not copper iodide.
    if (/^[A-Z][a-z]?\((?:I{1,3}|IV|V|VI|VII)\)$/.test(token)) return false;
    const parsed = parseFormula(token);
    return Boolean(parsed && parsed.totalAtoms > 1 && parsed.atoms.some((atom) => atom.element.block === "d" || atom.element.block === "f"));
  });
}

interface WrittenConfiguration {
  readonly core: string | null;
  readonly subshells: Subshell[];
  readonly text: string;
}

const CAPACITY: Record<Subshell["l"], number> = { s: 2, p: 6, d: 10, f: 14 };
const NOBLE_CORES = new Set([2, 10, 18, 36, 54, 86]);

/** Configurations written in the stem itself: "[Ar] 3d^5 4s^1", "1s2 2s2 2p4". Null when any run is damaged. */
function readWrittenConfigurations(question: string): WrittenConfiguration[] | null {
  const text = normalizeChemistryText(question);
  const runPattern = /(\[(?:He|Ne|Ar|Kr|Xe|Rn)\])?\s*((?:[1-7][spdf]\^?\(?\d{1,2}\)?[\s,]*)+)/g;
  const configurations: WrittenConfiguration[] = [];
  for (const match of text.matchAll(runPattern)) {
    const core = match[1] ? match[1].slice(1, -1) : null;
    const subshells: Subshell[] = [];
    for (const token of match[2]!.matchAll(/([1-7])([spdf])\^?\(?(\d{1,2})\)?/g)) {
      const l = token[2] as Subshell["l"];
      const electrons = Number(token[3]);
      if (electrons < 1 || electrons > CAPACITY[l]) return null;
      subshells.push({ n: Number(token[1]), l, electrons });
    }
    if (subshells.length === 0) continue;
    if (!core && subshells[0]!.n !== 1) continue;
    configurations.push({ core, subshells, text: match[0].trim() });
  }
  const coreMentions = text.match(/\[(?:He|Ne|Ar|Kr|Xe|Rn)\]/g)?.length ?? 0;
  if (coreMentions > configurations.filter((configuration) => configuration.core).length) return null;
  return configurations;
}

interface OrbitalName {
  readonly n: number | null;
  readonly l: "s" | "p" | "d";
  /** "x", "y", "z", "xy", "yz", "xz", "x2y2", "z2" or null when unspecified. */
  readonly axis: string | null;
  readonly at: number;
}

/** The orbital a shape or node question names: "3p", "2p_z", "d_(z^2)", "dxy orbital". */
function readOrbitalName(question: string): OrbitalName | null {
  const stem = chemStem(question);
  const axisPattern = "(?:_?\\(?\\{?\\s*(xy|yz|zx|xz|x\\^?2\\s*-\\s*y\\^?2|z\\^?2|x|y|z)\\s*\\)?\\}?)";
  const candidates: OrbitalName[] = [];
  for (const match of stem.matchAll(new RegExp(`(?<![a-z0-9])(?:([1-7])\\s*)?([spd])${axisPattern}?(?:[ -]?orbitals?)?(?![a-z0-9^])`, "g"))) {
    const n = match[1] ? Number(match[1]) : null;
    const l = match[2] as OrbitalName["l"];
    const rawAxis = match[3] ?? null;
    const tail = stem.slice(match.index! + match[0].length, match.index! + match[0].length + 12);
    const namedOrbital = /orbital/.test(match[0]) || /^\s*[-]?\s*orbital/.test(tail);
    const near = stem.slice(Math.max(0, match.index! - 40), match.index! + match[0].length + 40);
    // A bare "3d" only counts when "orbital" is attached or a node or shape cue sits beside it; "dxy" and "2p_z" are unambiguous.
    if (!namedOrbital && !rawAxis && !(n && /nodes?|nodal|shape/.test(near))) continue;
    if (l === "s" && rawAxis) continue;
    if (l === "p" && rawAxis && rawAxis.length !== 1) continue;
    if (l === "d" && rawAxis && rawAxis.length === 1) continue;
    if (n !== null && ((l === "p" && n < 2) || (l === "d" && n < 3))) continue;
    let axis: string | null = null;
    if (rawAxis) {
      if (/x\^?2/.test(rawAxis)) axis = "x2y2";
      else if (/z\^?2/.test(rawAxis)) axis = "z2";
      else axis = rawAxis === "zx" ? "xz" : rawAxis;
    }
    candidates.push({ n, l, axis, at: match.index! });
  }
  if (candidates.length === 0) return null;
  // Prefer the most specific mention (an axis, then an n), then the first.
  candidates.sort((a, b) => (Number(Boolean(b.axis)) - Number(Boolean(a.axis))) || (Number(b.n !== null) - Number(a.n !== null)) || a.at - b.at);
  return candidates[0]!;
}

function readQuantumNumbers(question: string): { n: number; l: number | null } | null {
  const stem = chemStem(question);
  const n = /\bn\s*=\s*([1-7])\b/.exec(stem);
  if (!n) return null;
  const l = /\bl\s*=\s*([0-6])\b/.exec(stem);
  const nValue = Number(n[1]);
  const lValue = l ? Number(l[1]) : null;
  if (lValue !== null && lValue >= nValue) return null;
  return { n: nValue, l: lValue };
}

/* ------------------------------------------------------------------------- */
/* Formatting                                                                */
/* ------------------------------------------------------------------------- */

const MINUS = "−";

function speciesLabel(species: { element: ElementRecord; charge: number }): string {
  if (species.charge === 0) return species.element.symbol;
  const magnitude = Math.abs(species.charge);
  const sign = species.charge < 0 ? "-" : "+";
  return `${species.element.symbol}^(${magnitude === 1 ? "" : magnitude}${sign})`;
}

function subshellLabel(subshell: Subshell): string {
  return `${subshell.n}${subshell.l}^${subshell.electrons}`;
}

/** "[Ar] 3d^5 4s^1", trimmed from the left until it fits a 16 character label. */
function condensedLabel(core: string | null, subshells: readonly Subshell[]): string {
  const parts = subshells.map(subshellLabel);
  let label = `${core ? `[${core}]` : ""}${parts.length ? " " + parts.join(" ") : ""}`.trim();
  if (label.length <= 16 && label.length > 0) return label;
  let rest = [...parts];
  label = rest.join(" ");
  while (label.length > 16 && rest.length > 1) {
    rest = rest.slice(1);
    label = rest.join(" ");
  }
  return label.length > 0 ? label : core ? `[${core}]` : "";
}

function momentLabel(unpaired: number): string {
  const moment = Math.sqrt(unpaired * (unpaired + 2));
  return unpaired === 0 ? "μ = 0 BM" : `μ = ${moment.toFixed(2)} BM`;
}

function unpairedLabel(unpaired: number): string {
  return `${unpaired} unpaired`;
}

/* ------------------------------------------------------------------------- */
/* Drawing                                                                   */
/* ------------------------------------------------------------------------- */

const BOX = 0.6;
const GAP = 0.1;
const SUBSHELL_GAP = 0.35;
const PAIR_OFFSET = 0.12;

interface BoxRow {
  readonly label: string;
  readonly boxes: readonly number[];
}

/** Width of a run of subshell boxes drawn side by side. */
function rowsWidth(rows: readonly BoxRow[]): number {
  return rows.reduce((sum, row, index) => sum + row.boxes.length * BOX + (row.boxes.length - 1) * GAP + (index > 0 ? SUBSHELL_GAP : 0), 0);
}

/**
 * Subshell boxes on one baseline from `origin` (left edge, box centre height),
 * each box with its arrows and each subshell labelled beneath. Returns the
 * ids of everything drawn so the caller can group them.
 */
function drawBoxRows(c: ChemScene, prefix: string, origin: Vec2, rows: readonly BoxRow[], options: { labelBelow?: boolean; boxLabels?: readonly string[] } = {}): string[] {
  const ids: string[] = [];
  let x = origin.x;
  let boxIndex = 0;
  rows.forEach((row, rowIndex) => {
    const rowStart = x;
    row.boxes.forEach((count, index) => {
      const centre = { x: x + BOX / 2, y: origin.y };
      const boxId = `${prefix}_r${rowIndex}_b${index}`;
      const centreId = c.scene.helper(`${boxId}_c`, centre, "orbital box centre helper");
      ids.push(c.scene.rectangle(boxId, centreId, BOX, BOX, "orbital box"));
      if (count === 1) ids.push(c.electron(`${boxId}_e1`, centre, "up", "electron"));
      if (count === 2) {
        ids.push(c.electron(`${boxId}_e1`, { x: centre.x - PAIR_OFFSET, y: centre.y }, "up", "electron"));
        ids.push(c.electron(`${boxId}_e2`, { x: centre.x + PAIR_OFFSET, y: centre.y }, "down", "electron"));
      }
      const boxLabel = options.boxLabels?.[boxIndex];
      if (boxLabel) ids.push(c.text(`${boxId}_m`, { x: centre.x, y: origin.y - BOX / 2 - 0.26 }, boxLabel, "magnetic quantum number label"));
      boxIndex += 1;
      x += BOX + (index < row.boxes.length - 1 ? GAP : 0);
    });
    const rowEnd = x;
    if (options.labelBelow !== false) {
      ids.push(c.text(`${prefix}_r${rowIndex}_l`, { x: (rowStart + rowEnd) / 2, y: origin.y - BOX / 2 - 0.26 }, row.label, "subshell label"));
    }
    x += SUBSHELL_GAP;
  });
  return ids;
}

interface SpeciesFigure {
  readonly title: string;
  readonly core: string | null;
  readonly subshells: readonly Subshell[];
  readonly rows: readonly BoxRow[];
  readonly unpaired: number;
}

function figureFromSpecies(species: Species): SpeciesFigure | null {
  const configuration = electronConfiguration(species.element, species.charge);
  if (!configuration) return null;
  const rows = configuration.valenceBoxes.map((entry) => ({ label: `${entry.subshell.n}${entry.subshell.l}`, boxes: entry.boxes }));
  const shown = configuration.valenceBoxes.map((entry) => entry.subshell);
  if (rows.length === 0) return null;
  // The core is whatever the boxes do not show: Sc3+ shows 3s2 3p6 over [Ne], not over [Ar].
  const coreElectrons = configuration.electrons - shown.reduce((sum, subshell) => sum + subshell.electrons, 0);
  const core = coreElectrons > 0 && NOBLE_CORES.has(coreElectrons) ? ELEMENTS.find((element) => element.z === coreElectrons)?.symbol ?? null : null;
  return { title: speciesLabel(species), core, subshells: shown, rows, unpaired: configuration.unpairedElectrons };
}

function boxesFor(subshell: Subshell): number[] {
  const orbitals = CAPACITY[subshell.l] / 2;
  const boxes = new Array<number>(orbitals).fill(0);
  for (let e = 0; e < subshell.electrons; e += 1) boxes[e % orbitals]! += 1;
  return boxes;
}

function figureFromWritten(configuration: WrittenConfiguration): SpeciesFigure {
  // Boxes past the last noble-gas boundary reached by the written run.
  let cumulative = 0;
  let boundary = -1;
  configuration.subshells.forEach((subshell, index) => {
    cumulative += subshell.electrons;
    if (NOBLE_CORES.has(cumulative) && (subshell.l === "p" || (subshell.n === 1 && subshell.l === "s")) && subshell.electrons === CAPACITY[subshell.l]) boundary = index;
  });
  let shown = configuration.subshells.slice(boundary + 1);
  let core = configuration.core;
  if (shown.length === 0) {
    shown = configuration.subshells.slice(-2);
    core = configuration.subshells.length > 2 ? configuration.core : null;
  } else if (boundary >= 0 && !core) {
    const coreElectrons = configuration.subshells.slice(0, boundary + 1).reduce((sum, subshell) => sum + subshell.electrons, 0);
    core = ELEMENTS.find((element) => element.z === coreElectrons)?.symbol ?? null;
  }
  const unpaired = configuration.subshells.reduce((sum, subshell) => {
    const orbitals = CAPACITY[subshell.l] / 2;
    return sum + (subshell.electrons <= orbitals ? subshell.electrons : 2 * orbitals - subshell.electrons);
  }, 0);
  return {
    title: condensedLabel(core, shown),
    core,
    subshells: shown,
    rows: shown.map((subshell) => ({ label: `${subshell.n}${subshell.l}`, boxes: boxesFor(subshell) })),
    unpaired,
  };
}

const MOMENT_CUES = /magnetic moment|spin[ -]?only|unpaired|paramagnet|diamagnet|bohr magneton|\bbm\b/;
/** Wording that makes the species asked about a product or an ion of unstated charge. */
const REACTION_CUES = /product|reaction|oxidi[sz]|reduc(?:es|ed|ing|tion)|disproportionat|titrat|oxidation state|oxidation number|oxide|halide|chloride|sulphate|sulfate|nitrate|salt|compound|solution/;

/** Thin outline around one species' boxes and its text lines, so the fit bounds every label. */
function panel(c: ChemScene, id: string, centre: Vec2, width: number, height: number): string {
  const centreId = c.scene.helper(`${id}_c`, centre, "panel centre helper");
  const panelId = c.scene.rectangle(id, centreId, width, height, "figure panel");
  const entity = c.scene.entities.find((candidate) => candidate.id === panelId);
  if (entity) entity.provenance = { strokeRole: "construction", strokeWidth: 1 };
  return panelId;
}

const PANEL_MIN_WIDTH = 3.0;
const PANEL_MARGIN = 0.3;

function buildBoxDocument(question: string, figures: readonly SpeciesFigure[], wantMoment: boolean): SceneDocument | null {
  if (figures.length === 0 || figures.length > 4) return null;
  const c = new ChemScene(question, "orbital box diagram of the named species", ORBITAL_FAMILY);
  const columns = figures.length <= 2 ? figures.length : 2;
  const widths = figures.map((figure) => rowsWidth(figure.rows));
  const panelWidth = Math.max(...widths, PANEL_MIN_WIDTH) + 2 * PANEL_MARGIN;
  const top = BOX / 2 + 0.36 + PANEL_MARGIN;
  const bottom = -(BOX / 2 + 0.62 + (wantMoment ? 0.36 : 0) + PANEL_MARGIN);
  const panelHeight = top - bottom;
  const columnPitch = panelWidth + 0.5;
  const rowPitch = panelHeight + 0.5;
  const captions: string[] = [];
  figures.forEach((figure, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const centreX = column * columnPitch;
    const originY = -row * rowPitch;
    const originX = centreX - widths[index]! / 2;
    const prefix = `sp${index}`;
    const ids = drawBoxRows(c, prefix, { x: originX, y: originY }, figure.rows);
    const titleId = c.text(`${prefix}_title`, { x: centreX, y: originY + BOX / 2 + 0.36 }, figure.title, "species label");
    ids.push(titleId);
    const condensed = condensedLabel(figure.core, figure.subshells);
    const configY = originY - BOX / 2 - 0.62;
    if (condensed && condensed !== figure.title) {
      ids.push(c.text(`${prefix}_cfg`, { x: centreX, y: configY }, condensed, "condensed configuration"));
    }
    if (wantMoment) {
      const lineY = configY - 0.36;
      ids.push(c.text(`${prefix}_unp`, { x: centreX - 0.95, y: lineY }, unpairedLabel(figure.unpaired), "unpaired electron count"));
      ids.push(c.text(`${prefix}_mu`, { x: centreX + 0.95, y: lineY }, momentLabel(figure.unpaired), "spin only magnetic moment"));
    }
    ids.push(panel(c, `${prefix}_panel`, { x: centreX, y: originY + (top + bottom) / 2 }, panelWidth, panelHeight));
    c.scene.labelled(titleId);
    c.scene.group(`species_${index}`, ids, `box diagram of ${figure.title}`, index > 0 ? [`species_${index - 1}`] : []);
    captions.push(`${figure.title}: ${condensed || figure.subshells.map(subshellLabel).join(" ")}, ${unpairedLabel(figure.unpaired)}, ${momentLabel(figure.unpaired)}`);
  });
  return c.build({ caption: captions.join("; ") });
}

/* Orbital shapes ---------------------------------------------------------- */

const DEG = Math.PI / 180;

/**
 * One lobe as 12 points: the origin plus 11 samples of a polar profile about
 * the lobe axis. A p lobe (and each d_z2 lobe) follows r = L cos^3 t over
 * ±70°, a teardrop that tapers to the nucleus; a d clover leaf follows
 * r = L cos 2t over ±42°, the |sin 2φ| angular factor, so four leaves meet
 * only at the nucleus.
 */
function lobePoints(angleDeg: number, length: number, kind: "p" | "d"): Vec2[] {
  const points: Vec2[] = [{ x: 0, y: 0 }];
  const half = kind === "p" ? 70 : 42;
  for (let i = 0; i <= 10; i += 1) {
    const t = (-half + (2 * half * i) / 10) * DEG;
    const r = kind === "p" ? length * Math.pow(Math.cos(t), 3) : length * Math.cos(2 * t);
    const a = angleDeg * DEG + t;
    points.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return points;
}

function ellipsePoints(a: number, b: number, count = 16): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    const t = (2 * Math.PI * i) / count;
    return { x: a * Math.cos(t), y: b * Math.sin(t) };
  });
}

function polygonAt(c: ChemScene, id: string, points: readonly Vec2[], role: string): string {
  const ids = points.map((point, index) => c.scene.helper(`${id}_p${index}`, point, `${role} outline helper`));
  return c.scene.polygon(id, ids, role);
}

interface ShapePlan {
  readonly name: string;
  readonly lobes: Array<{ angle: number; sign: "+" | "-" }>;
  readonly ring: boolean;
  readonly sphere: boolean;
  /** Axis letters drawn horizontal and vertical; null draws an unlabelled axis. */
  readonly axes: [string | null, string | null];
  /** Which axes are nodal planes seen edge on. */
  readonly dashedAxes: Array<"h" | "v">;
  readonly dashedDiagonals: boolean;
  readonly angularNodes: number;
  readonly planeText: string;
}

function planShape(orbital: OrbitalName): ShapePlan | null {
  const prefix = orbital.n !== null ? String(orbital.n) : "";
  if (orbital.l === "s") {
    return { name: `${prefix}s`, lobes: [], ring: false, sphere: true, axes: [null, null], dashedAxes: [], dashedDiagonals: false, angularNodes: 0, planeText: "no angular node" };
  }
  if (orbital.l === "p") {
    const axis = orbital.axis;
    const name = `${prefix}p${axis ? `_${axis}` : ""}`;
    if (axis === "x") return { name, lobes: [{ angle: 0, sign: "+" }, { angle: 180, sign: "-" }], ring: false, sphere: false, axes: ["x", "y"], dashedAxes: ["v"], dashedDiagonals: false, angularNodes: 1, planeText: "yz plane" };
    if (axis === "y") return { name, lobes: [{ angle: 90, sign: "+" }, { angle: 270, sign: "-" }], ring: false, sphere: false, axes: ["x", "y"], dashedAxes: ["h"], dashedDiagonals: false, angularNodes: 1, planeText: "xz plane" };
    if (axis === "z") return { name, lobes: [{ angle: 90, sign: "+" }, { angle: 270, sign: "-" }], ring: false, sphere: false, axes: ["x", "z"], dashedAxes: ["h"], dashedDiagonals: false, angularNodes: 1, planeText: "xy plane" };
    return { name, lobes: [{ angle: 0, sign: "+" }, { angle: 180, sign: "-" }], ring: false, sphere: false, axes: [null, null], dashedAxes: ["v"], dashedDiagonals: false, angularNodes: 1, planeText: "one nodal plane" };
  }
  const axis = orbital.axis;
  const clover = (signs: Array<"+" | "-">): ShapePlan["lobes"] => [45, 135, 225, 315].map((angle, index) => ({ angle, sign: signs[index]! }));
  if (axis === "xy") return { name: `${prefix}d_(xy)`, lobes: clover(["+", "-", "+", "-"]), ring: false, sphere: false, axes: ["x", "y"], dashedAxes: ["h", "v"], dashedDiagonals: false, angularNodes: 2, planeText: "xz, yz planes" };
  if (axis === "yz") return { name: `${prefix}d_(yz)`, lobes: clover(["+", "-", "+", "-"]), ring: false, sphere: false, axes: ["y", "z"], dashedAxes: ["h", "v"], dashedDiagonals: false, angularNodes: 2, planeText: "xy, xz planes" };
  if (axis === "xz") return { name: `${prefix}d_(xz)`, lobes: clover(["+", "-", "+", "-"]), ring: false, sphere: false, axes: ["x", "z"], dashedAxes: ["h", "v"], dashedDiagonals: false, angularNodes: 2, planeText: "xy, yz planes" };
  if (axis === "x2y2") return { name: `${prefix}d_(x^2${MINUS}y^2)`, lobes: [0, 90, 180, 270].map((angle, index) => ({ angle, sign: index % 2 === 0 ? "+" : "-" })), ring: false, sphere: false, axes: ["x", "y"], dashedAxes: [], dashedDiagonals: true, angularNodes: 2, planeText: "planes x = ±y" };
  if (axis === "z2") return { name: `${prefix}d_(z^2)`, lobes: [{ angle: 90, sign: "+" }, { angle: 270, sign: "+" }], ring: true, sphere: false, axes: ["x", "z"], dashedAxes: [], dashedDiagonals: false, angularNodes: 2, planeText: "two conical nodes" };
  return { name: `${prefix}d`, lobes: clover(["+", "-", "+", "-"]), ring: false, sphere: false, axes: [null, null], dashedAxes: ["h", "v"], dashedDiagonals: false, angularNodes: 2, planeText: "two nodal planes" };
}

function buildShapeDocument(question: string, orbital: OrbitalName): SceneDocument | null {
  const plan = planShape(orbital);
  if (!plan) return null;
  const c = new ChemScene(question, `shape of the ${plan.name} orbital`, ORBITAL_FAMILY);
  const lValue = orbital.l === "s" ? 0 : orbital.l === "p" ? 1 : 2;
  const radial = orbital.n !== null ? orbital.n - lValue - 1 : null;
  const ids: string[] = [];
  const AXIS = 1.9;
  const LOBE = orbital.l === "p" || plan.ring ? 1.5 : 1.3;

  if (plan.sphere) {
    ids.push(c.link("ax_h", { x: -AXIS, y: 0 }, { x: AXIS, y: 0 }, "coordinate frame line", false));
    ids.push(c.link("ax_v", { x: 0, y: -AXIS }, { x: 0, y: AXIS }, "coordinate frame line", false));
    const centre = c.scene.helper("s_c", { x: 0, y: 0 }, "orbital centre helper");
    const SPHERE = 1.2;
    ids.push(c.scene.circle("s_sphere", centre, SPHERE, "s orbital boundary"));
    // The sign sits in the outermost shell, between the last radial node and the boundary.
    const nodeCount = radial ?? 0;
    const signRadius = SPHERE * (nodeCount / (nodeCount + 1) + 1) / 2;
    ids.push(c.text("s_sign", { x: -signRadius * Math.SQRT1_2, y: signRadius * Math.SQRT1_2 }, "+", "wavefunction sign"));
    if (radial !== null && radial > 0) {
      for (let k = 1; k <= radial; k += 1) {
        const r = (SPHERE * k) / (radial + 1);
        const nodeId = c.scene.circle(`s_node_${k}`, centre, r, "radial node surface");
        const entity = c.scene.entities.find((candidate) => candidate.id === nodeId);
        if (entity) entity.provenance = { dashed: true, strokeRole: "construction" };
        ids.push(nodeId);
      }
    }
  } else {
    // Axes, dashed where they are a nodal plane seen edge on.
    const [hName, vName] = plan.axes;
    const gapH = plan.ring;
    const hDashed = plan.dashedAxes.includes("h");
    const vDashed = plan.dashedAxes.includes("v");
    if (gapH) {
      ids.push(c.link("ax_h1", { x: -AXIS, y: 0 }, { x: -1.15, y: 0 }, "coordinate frame line", false));
      ids.push(c.link("ax_h2", { x: 1.15, y: 0 }, { x: AXIS, y: 0 }, "coordinate frame line", false));
    } else {
      ids.push(c.link("ax_h", { x: -AXIS, y: 0 }, { x: AXIS, y: 0 }, hDashed ? "nodal plane edge" : "coordinate frame line", hDashed));
    }
    ids.push(c.link("ax_v", { x: 0, y: -AXIS }, { x: 0, y: AXIS }, vDashed ? "nodal plane edge" : "coordinate frame line", vDashed));
    if (hName) ids.push(c.text("ax_h_l", { x: AXIS + 0.22, y: 0 }, hName, "axis label"));
    if (vName) ids.push(c.text("ax_v_l", { x: 0, y: AXIS + 0.22 }, vName, "axis label"));
    if (plan.dashedDiagonals) {
      ids.push(c.link("diag_1", { x: -1.45, y: -1.45 }, { x: 1.45, y: 1.45 }, "nodal plane edge", true));
      ids.push(c.link("diag_2", { x: -1.45, y: 1.45 }, { x: 1.45, y: -1.45 }, "nodal plane edge", true));
    }
    const lobeKind: "p" | "d" = plan.ring || orbital.l === "p" ? "p" : "d";
    plan.lobes.forEach((lobe, index) => {
      ids.push(polygonAt(c, `lobe_${index}`, lobePoints(lobe.angle, LOBE, lobeKind), "orbital lobe"));
      const along = 0.6 * LOBE;
      const a = lobe.angle * DEG;
      // A lobe on an axis carries its sign beside the axis line, always to the same side.
      const horizontal = lobe.angle % 180 === 0;
      const onAxis = lobe.angle % 90 === 0;
      const at = {
        x: along * Math.cos(a) + (onAxis && !horizontal ? 0.24 : 0),
        y: along * Math.sin(a) + (onAxis && horizontal ? 0.24 : 0),
      };
      ids.push(c.text(`lobe_${index}_sign`, at, lobe.sign === "+" ? "+" : MINUS, "wavefunction sign"));
    });
    if (plan.ring) {
      ids.push(polygonAt(c, "ring", ellipsePoints(0.95, 0.26), "orbital ring"));
      ids.push(c.text("ring_sign", { x: 0.55, y: 0 }, MINUS, "wavefunction sign"));
    }
    // Where the nodal plane text goes: beside the dashed line, clear of lobes.
    if (vDashed && !hDashed) ids.push(c.text("nodal_l", { x: 0.75, y: 1.45 }, "nodal plane", "nodal plane label"));
    else if (hDashed && !vDashed) ids.push(c.text("nodal_l", { x: 1.35, y: 0.3 }, "nodal plane", "nodal plane label"));
    else if (hDashed && vDashed) ids.push(c.text("nodal_l", { x: 0.85, y: 1.5 }, "nodal planes", "nodal plane label"));
    else if (plan.dashedDiagonals) ids.push(c.text("nodal_l", { x: 1.35, y: 1.75 }, "nodal planes", "nodal plane label"));
  }
  const nucleus = c.scene.point("nucleus", { x: 0, y: 0 }, "nucleus");
  const nucleusEntity = c.scene.entities.find((candidate) => candidate.id === nucleus);
  if (nucleusEntity) nucleusEntity.provenance = { pointStyle: "filled" };
  ids.push(nucleus);
  const nameId = c.text("orbital_name", { x: -1.45, y: 1.9 }, plan.name, "orbital name");
  ids.push(nameId);
  c.scene.labelled(nameId);
  if (radial !== null) {
    ids.push(c.text("radial_l", { x: -1.35, y: -1.75 }, `radial nodes: ${radial}`, "radial node count"));
  }
  c.scene.group("shape", ids, `the ${plan.name} orbital`);
  const total = orbital.n !== null ? orbital.n - 1 : null;
  const caption = radial !== null && total !== null
    ? `${plan.name} orbital: radial nodes = n ${MINUS} l ${MINUS} 1 = ${radial}, angular nodes = l = ${plan.angularNodes} (${plan.planeText}), total = n ${MINUS} 1 = ${total}`
    : `${plan.name} orbital: angular nodes = l = ${plan.angularNodes} (${plan.planeText}); radial nodes need n`;
  return c.build({ caption });
}

/* Quantum number ladder ---------------------------------------------------- */

const L_LETTERS = ["s", "p", "d", "f", "g"] as const;

function buildLadderDocument(question: string, n: number, l: number | null): SceneDocument | null {
  if (n < 1 || n > 4) return null;
  const c = new ChemScene(question, `subshells of the n = ${n} shell`, ORBITAL_FAMILY);
  const ids: string[] = [];
  if (l !== null) {
    const letter = L_LETTERS[l]!;
    const count = 2 * l + 1;
    const mLabels = Array.from({ length: count }, (_, i) => {
      const m = i - l;
      return m === 0 ? "0" : m > 0 ? `+${m}` : `${MINUS}${-m}`;
    });
    const rows: BoxRow[] = [{ label: `${n}${letter}`, boxes: new Array<number>(count).fill(0) }];
    const width = rowsWidth(rows);
    ids.push(...drawBoxRows(c, "sub", { x: 0, y: 0 }, rows, { labelBelow: false, boxLabels: mLabels }));
    const titleId = c.text("sub_title", { x: width / 2, y: BOX / 2 + 0.36 }, `${n}${letter}`, "subshell label");
    ids.push(titleId);
    c.scene.labelled(titleId);
    ids.push(c.text("sub_m", { x: width / 2 - 0.95, y: -BOX / 2 - 0.62 }, `m = ${MINUS}${l} to +${l}`, "magnetic quantum number range"));
    ids.push(c.text("sub_count", { x: width / 2 + 0.95, y: -BOX / 2 - 0.62 }, `${count} orbitals`, "orbital count"));
    ids.push(panel(c, "sub_panel", { x: width / 2, y: (BOX / 2 + 0.36 + PANEL_MARGIN - (BOX / 2 + 0.62 + PANEL_MARGIN)) / 2 }, Math.max(width, PANEL_MIN_WIDTH) + 2 * PANEL_MARGIN, BOX + 0.98 + 2 * PANEL_MARGIN));
    c.scene.group("subshell", ids, `the ${n}${letter} subshell`);
    return c.build({ caption: `n = ${n}, l = ${l} (${n}${letter}): ${count} orbitals, m from ${MINUS}${l} to +${l}, ${2 * count} electrons at most` });
  }
  let orbitals = 0;
  const pitch = 1.0;
  for (let level = 0; level < n; level += 1) {
    const letter = L_LETTERS[level]!;
    const count = 2 * level + 1;
    orbitals += count;
    const rows: BoxRow[] = [{ label: `${n}${letter}`, boxes: new Array<number>(count).fill(0) }];
    ids.push(...drawBoxRows(c, `lv${level}`, { x: 0, y: level * pitch }, rows, { labelBelow: false }));
    const labelId = c.text(`lv${level}_l`, { x: -0.5, y: level * pitch }, `${n}${letter}`, "subshell label");
    ids.push(labelId);
    c.scene.labelled(labelId);
  }
  const widest = rowsWidth([{ label: "", boxes: new Array<number>(2 * (n - 1) + 1).fill(0) }]);
  if (n >= 2) {
    const countX = Math.max(widest - 0.8, 1.9);
    ids.push(c.text("count_orbitals", { x: countX, y: 0.14 }, `${orbitals} orbitals`, "orbital count"));
    ids.push(c.text("count_electrons", { x: countX, y: -0.2 }, `${2 * orbitals} electrons`, "electron capacity"));
  }
  // Subshell energy rises with l in a many-electron atom; the axis says which way the ladder reads.
  const axisTop = (n - 1) * pitch + 0.7;
  ids.push(c.arrow("energy_axis", { x: -1.05, y: -0.5 }, { x: -1.05, y: axisTop }, "energy axis"));
  ids.push(c.text("energy_l", { x: -1.05, y: axisTop + 0.28 }, "E", "energy axis label"));
  c.scene.group("ladder", ids, `subshells of n = ${n}`);
  return c.build({ caption: `n = ${n}: ${n} subshells, ${orbitals} orbitals (n^2), ${2 * orbitals} electrons at most (2n^2)` });
}

/* ------------------------------------------------------------------------- */
/* Entry                                                                     */
/* ------------------------------------------------------------------------- */

/** The figure, or null when the stem does not ground it. */
export function buildOrbitalScene(question: string, _quantities: ChemPlanQuantity[], _schematic: boolean): SceneDocument | null {
  if (!isOrbitalStem(question)) return null;
  const stem = chemStem(question);
  const wantsShape = SHAPE_CUES.test(stem);
  const orbital = wantsShape ? readOrbitalName(question) : null;
  if (orbital) return buildShapeDocument(question, orbital);

  const species = readSpecies(question);
  if (species.length > 0) {
    if (hasMetalCompound(question)) return null;
    if (species.length > 4) return null;
    // A bare element is only drawn as itself: when the stem is about a product,
    // a reaction or an unstated oxidation state, the species asked about is not the one named.
    const bare = species.some((entry) => entry.charge === 0);
    if (bare && REACTION_CUES.test(stem) && statedOxidationState(stem) === null) return null;
    const figures = species.map(figureFromSpecies);
    if (figures.some((figure) => figure === null)) return null;
    return buildBoxDocument(question, figures as SpeciesFigure[], MOMENT_CUES.test(stem));
  }

  const written = readWrittenConfigurations(question);
  if (written && written.length > 0) {
    if (hasMetalCompound(question)) return null;
    return buildBoxDocument(question, written.map(figureFromWritten), MOMENT_CUES.test(stem));
  }

  if (QUANTUM_CUES.test(stem)) {
    const quantum = readQuantumNumbers(question);
    if (quantum) return buildLadderDocument(question, quantum.n, quantum.l);
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                    */
/* ------------------------------------------------------------------------- */

export const ORBITAL_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  {
    question: "Draw the orbital diagram of Fe^(3+) and calculate its spin only magnetic moment.",
    expect: "draw",
    labels: ["Fe^(3+)", "3d", "[Ar] 3d^5", "5 unpaired", "μ = 5.92 BM"],
    note: "Fe3+ is d5, five singly occupied boxes",
  },
  {
    question: "Write the electronic configuration of chromium (Z = 24) and state the number of unpaired electrons in it.",
    expect: "draw",
    labels: ["Cr", "3d", "4s", "[Ar] 3d^5 4s^1", "6 unpaired"],
    note: "half filled exception, 3d5 4s1",
  },
  {
    question: "The electronic configuration of Cu is [Ar] 3d10 4s1. Draw its box diagram.",
    expect: "draw",
    labels: ["Cu", "[Ar] 3d^10 4s^1"],
    forbidLabels: ["[Ar] 3d^9 4s^2"],
    note: "fully filled exception, the species wins over the written string",
  },
  {
    question: "Calculate the spin only magnetic moment of the Fe2+ ion.",
    expect: "draw",
    labels: ["Fe^(2+)", "4 unpaired", "μ = 4.90 BM"],
  },
  {
    question: "Which of Ni2+ and Cu2+ has the higher magnetic moment? Draw their electronic configurations.",
    expect: "draw",
    labels: ["Ni^(2+)", "Cu^(2+)", "μ = 2.83 BM", "μ = 1.73 BM"],
    note: "two species side by side, d8 and d9",
  },
  {
    question: "How many unpaired electrons does Gd3+ have? Draw its electron configuration.",
    expect: "draw",
    labels: ["Gd^(3+)", "4f", "7 unpaired"],
    note: "f block, 4f7",
  },
  {
    question: "Draw the box diagram of the chloride ion Cl- and show that it is diamagnetic.",
    expect: "draw",
    labels: ["Cl^(-)", "3s", "3p", "μ = 0 BM"],
  },
  {
    question: "Nitrogen atom has three unpaired electrons according to Hund's rule. Draw its orbital diagram.",
    expect: "draw",
    labels: ["N", "2p", "3 unpaired"],
  },
  {
    question: "How many radial and angular nodes does a 3p orbital have? Sketch its shape.",
    expect: "draw",
    labels: ["3p", "nodal plane", "radial nodes: 1"],
    note: "radial = n l 1 = 1, angular = 1",
  },
  {
    question: "Sketch the shape of the d_(z^2) orbital and mark the sign of the wavefunction in each region.",
    expect: "draw",
    labels: ["d_(z^2)", "+", "−", "x", "z"],
    note: "two lobes on z and a ring in the xy plane",
  },
  {
    question: "Draw the shape of the 3d_(xy) orbital and state the number of nodal planes.",
    expect: "draw",
    labels: ["3d_(xy)", "x", "y", "nodal planes", "radial nodes: 0"],
  },
  {
    question: "How many orbitals are there in the shell with n = 3, and what is the maximum number of electrons it can hold?",
    expect: "draw",
    labels: ["3s", "3p", "3d"],
    note: "1 + 3 + 5 = 9 orbitals, 18 electrons",
  },
  {
    question: "An electron in a hydrogen atom makes a transition from n = 4 to n = 2. Find the wavelength of the emitted photon.",
    expect: "decline",
    note: "Bohr transition, physics energy_level owns it",
  },
  {
    question: "Calculate the spin only magnetic moment of [Fe(CN)6]^(3-).",
    expect: "decline",
    note: "coordination complex, the crystal field lane owns it",
  },
  {
    question: "The spin only magnetic moment of KMnO4 is how many BM?",
    expect: "decline",
    note: "oxidation state of Mn in a compound must be deduced, not read",
  },
  {
    question: "Calculate the number of unpaired electrons in O2 and O2^(-) and state which is more paramagnetic.",
    expect: "decline",
    note: "molecular orbital question, another lane",
  },
];
