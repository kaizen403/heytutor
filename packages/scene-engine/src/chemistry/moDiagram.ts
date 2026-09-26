/**
 * Molecular orbital diagrams for the JEE diatomics (NCERT class 11 MOT).
 *
 * The solver `moConfiguration` fills the valence MOs of a homonuclear or
 * heteronuclear diatomic (H2 to Ne2 and their ions, CO, NO, CN and their
 * ions) in the textbook energy order, applies Hund's rule in the degenerate
 * π sets, and returns bond order, unpaired electrons and the configuration
 * string. The figure is the classic three column diagram: atomic orbitals of
 * each atom outside, molecular orbitals in the middle, dashed correlation
 * links between them, and electrons as spin arrows on every level. When a
 * stem lists several species the figure is a row of compact MO ladders, one
 * per species, each headed by its bond order.
 *
 * Nothing here is invented: the species comes from a token in the stem, the
 * occupancy from the electron count, the order from the NCERT rule (or from
 * the stem when it says s-p mixing is switched off). A stem with no species
 * token, or with a coordination complex or an organic system, draws nothing.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import { complexTokens, normalizeChemistryText, ocrSuspectToken } from "./formula";
import { elementBySymbol } from "./elements";

export const MO_FAMILY = "chem_mo" as const;

/* ------------------------------------------------------------------------- */
/* Solver                                                                    */
/* ------------------------------------------------------------------------- */

export type MoOrder = "period1" | "n2" | "o2";

export interface MoLevel {
  /** Stable key: s1, s1a, s2, s2a, p2, s2p, p2a, s2pa. */
  readonly key: string;
  /** Display name in NCERT notation: σ2s, σ*2s, π2p, σ2p, π*2p, σ*2p. */
  readonly name: string;
  readonly kind: "bonding" | "antibonding";
  /** 1 for a σ level, 2 for a degenerate π pair. */
  readonly degeneracy: 1 | 2;
  readonly capacity: number;
  readonly electrons: number;
  /** Electrons in each orbital of the level, Hund's rule applied (0, 1 or 2). */
  readonly boxes: readonly number[];
}

export interface MoResult {
  /** The species as parsed, ASCII: O2^(2-), NO^(+), CO. */
  readonly species: string;
  /** Board label with subscript and charge notation: O_2^(2-). */
  readonly label: string;
  readonly atoms: readonly [string, string];
  readonly charge: number;
  readonly totalElectrons: number;
  readonly valenceElectrons: number;
  readonly order: MoOrder;
  /** Levels in increasing energy, every one listed even when empty. */
  readonly levels: readonly MoLevel[];
  readonly bondOrder: number;
  readonly unpairedElectrons: number;
  readonly magnetic: "paramagnetic" | "diamagnetic";
  /** Occupied levels only, NCERT style: σ2s^2 σ*2s^2 π2p^4 σ2p^2 π*2p^2 */
  readonly configuration: string;
}

export interface MoOptions {
  /**
   * "auto" is the NCERT rule (π2p below σ2p up to N2 and for CO, NO, CN;
   * σ2p below π2p for O2, F2, Ne2). "off" is the no-mixing order (σ2p below
   * π2p) for every period 2 species, for stems that say so.
   */
  mixing?: "auto" | "off";
}

const SPECIES_HEADS = ["He2", "Li2", "Be2", "Ne2", "H2", "B2", "C2", "N2", "O2", "F2", "CO", "NO", "CN"] as const;

const SPECIES_PATTERN = new RegExp(`^(${SPECIES_HEADS.join("|")})(?:\\^?\\(?(\\d?)([+-])\\)?)?$`);

interface LevelTemplate { key: string; name: string; kind: "bonding" | "antibonding"; degeneracy: 1 | 2 }

const PERIOD1_LEVELS: LevelTemplate[] = [
  { key: "s1", name: "σ1s", kind: "bonding", degeneracy: 1 },
  { key: "s1a", name: "σ*1s", kind: "antibonding", degeneracy: 1 },
];

const N2_ORDER: LevelTemplate[] = [
  { key: "s2", name: "σ2s", kind: "bonding", degeneracy: 1 },
  { key: "s2a", name: "σ*2s", kind: "antibonding", degeneracy: 1 },
  { key: "p2", name: "π2p", kind: "bonding", degeneracy: 2 },
  { key: "s2p", name: "σ2p", kind: "bonding", degeneracy: 1 },
  { key: "p2a", name: "π*2p", kind: "antibonding", degeneracy: 2 },
  { key: "s2pa", name: "σ*2p", kind: "antibonding", degeneracy: 1 },
];

const O2_ORDER: LevelTemplate[] = [
  N2_ORDER[0]!, N2_ORDER[1]!, N2_ORDER[3]!, N2_ORDER[2]!, N2_ORDER[4]!, N2_ORDER[5]!,
];

function parseSpecies(text: string): { head: string; charge: number; species: string } | null {
  const cleaned = normalizeChemistryText(text).replace(/[\s_]/g, "");
  const match = SPECIES_PATTERN.exec(cleaned);
  if (!match) return null;
  const head = match[1]!;
  const magnitude = match[3] ? (Number(match[2] || "1") || 1) : 0;
  const charge = match[3] === "-" ? -magnitude : magnitude;
  const chargeText = charge === 0 ? "" : `^(${Math.abs(charge) === 1 ? "" : Math.abs(charge)}${charge < 0 ? "-" : "+"})`;
  return { head, charge, species: `${head}${chargeText}` };
}

function atomsOf(head: string): [string, string] {
  const homonuclear = /^([A-Z][a-z]?)2$/.exec(head);
  if (homonuclear) return [homonuclear[1]!, homonuclear[1]!];
  return [head[0]!, head[1]!];
}

function hundBoxes(degeneracy: 1 | 2, electrons: number): number[] {
  if (degeneracy === 1) return [electrons];
  if (electrons <= 2) return [Math.min(1, electrons), electrons >= 2 ? 1 : 0];
  return [2, electrons - 2];
}

/** Board form of a species: O_2^(2-), NO^(+), CO, He_2^(+). */
function moSpeciesLabel(species: string): string {
  const parsed = parseSpecies(species);
  if (!parsed) return species;
  const head = parsed.head.replace(/2$/, "_2");
  const charge = parsed.charge;
  if (charge === 0) return head;
  return `${head}^(${Math.abs(charge) === 1 ? "" : Math.abs(charge)}${charge < 0 ? "-" : "+"})`;
}

/**
 * Valence MO occupancy of a diatomic, or null for anything outside the
 * table (a polyatomic, a period 3 molecule, an electron count the levels
 * cannot hold).
 */
export function moConfiguration(speciesText: string, options: MoOptions = {}): MoResult | null {
  const parsed = parseSpecies(speciesText);
  if (!parsed) return null;
  const atoms = atomsOf(parsed.head);
  const elements = atoms.map((symbol) => elementBySymbol(symbol));
  if (!elements[0] || !elements[1]) return null;
  const totalElectrons = elements[0].z + elements[1].z - parsed.charge;
  const period1 = elements.every((element) => element!.period === 1);
  const core = period1 ? 0 : 4;
  const valenceElectrons = totalElectrons - core;
  const capacity = period1 ? 4 : 16;
  if (valenceElectrons < 1 || valenceElectrons > capacity) return null;
  let order: MoOrder;
  if (period1) order = "period1";
  else if (options.mixing === "off") order = "o2";
  else order = atoms[0] === atoms[1] && ["O", "F", "Ne"].includes(atoms[0]) ? "o2" : "n2";
  const templates = order === "period1" ? PERIOD1_LEVELS : order === "n2" ? N2_ORDER : O2_ORDER;
  let remaining = valenceElectrons;
  const levels: MoLevel[] = templates.map((template) => {
    const levelCapacity = 2 * template.degeneracy;
    const take = Math.min(levelCapacity, remaining);
    remaining -= take;
    return { ...template, capacity: levelCapacity, electrons: take, boxes: hundBoxes(template.degeneracy, take) };
  });
  const bonding = levels.filter((level) => level.kind === "bonding").reduce((sum, level) => sum + level.electrons, 0);
  const antibonding = levels.filter((level) => level.kind === "antibonding").reduce((sum, level) => sum + level.electrons, 0);
  const bondOrder = (bonding - antibonding) / 2;
  const unpairedElectrons = levels.reduce((sum, level) => sum + level.boxes.filter((box) => box === 1).length, 0);
  const configuration = levels.filter((level) => level.electrons > 0).map((level) => `${level.name}^${level.electrons}`).join(" ");
  return {
    species: parsed.species,
    label: moSpeciesLabel(parsed.species),
    atoms,
    charge: parsed.charge,
    totalElectrons,
    valenceElectrons,
    order,
    levels,
    bondOrder,
    unpairedElectrons,
    magnetic: unpairedElectrons > 0 ? "paramagnetic" : "diamagnetic",
    configuration,
  };
}

/* ------------------------------------------------------------------------- */
/* Stem reading                                                              */
/* ------------------------------------------------------------------------- */

/** Case-sensitive species token in running text, with an optional charge. */
const SPECIES_TOKEN = new RegExp(`(?<![A-Za-z0-9])(${SPECIES_HEADS.join("|")})(\\^?\\(?\\d?[+-]\\)?)?(?![A-Za-z0-9])`, "g");

/** Words a student uses for a diatomic, resolved to the species token. */
const SPECIES_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/\bsuperoxides?\b/g, "O2-"],
  [/(?<!hydrogen )\bperoxides?\b/g, "O2^(2-)"],
  [/\b(?:dioxygen|oxygen molecule|molecular oxygen)\b/g, "O2"],
  [/\b(?:dinitrogen|nitrogen molecule|molecular nitrogen)\b/g, "N2"],
  [/\b(?:dihydrogen|hydrogen molecule|molecular hydrogen)\b/g, "H2"],
  [/\b(?:difluorine|fluorine molecule)\b/g, "F2"],
  [/\bcarbon monoxide\b/g, "CO"],
  [/\b(?:nitric oxide|nitrogen monoxide)\b/g, "NO"],
  [/\bnitrosonium\b/g, "NO+"],
  [/\bcyanide ion\b/g, "CN-"],
];

/** Diatomic species named in a stem, in stem order, without repeats. */
export function moSpeciesTokens(question: string): string[] {
  const text = normalizeChemistryText(question);
  const found: Array<{ index: number; species: string }> = [];
  for (const match of text.matchAll(SPECIES_TOKEN)) {
    if (!match[2] && ocrSuspectToken(match[1]!, text, match.index ?? 0)) continue;
    const parsed = parseSpecies(`${match[1]}${match[2] ?? ""}`);
    if (parsed) found.push({ index: match.index ?? 0, species: parsed.species });
  }
  const lower = text.toLowerCase();
  for (const [pattern, species] of SPECIES_NAMES) {
    for (const match of lower.matchAll(pattern)) found.push({ index: match.index ?? 0, species });
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const entry of found) {
    if (seen.has(entry.species)) continue;
    seen.add(entry.species);
    tokens.push(entry.species);
  }
  return tokens;
}

const MO_CUE = /\b(?:bond order|molecular orbital|mo diagram|mo theory|mot|lcao|paramagnetic|diamagnetic|antibonding|bonding (?:mo|orbital|electron)|homo|lumo|unpaired electron|magnetic (?:nature|character|behaviou?r|propert)|bond (?:length|strength|energy|dissociation)|mixing|stab(?:le|ility))\b/;

// A carbocation, a radical or a mechanism asks "most stable" about organic
// structure, not about molecular orbital occupancy.
const MO_VETO = /\b(?:carbocations?|carbanions?|carbenes?|free radicals?|nucleophil\w*|electrophil\w*|sn1|sn2|inductive|hyperconjugation|crystal field|ligand|coordination|complex(?:es)?|hybridi[sz](?:ation|ed)|octahedral|tetrahedral|square planar|d-block|f-block|transition metal|spin[- ]only|bohr magneton|benzene|alkene|alkyne|alkane|ethene|ethyne|butadiene|conjugat(?:ed|ion)|aromatic|resonance|graphite|diamond|reagents?|reaction of|treatment of|produces?|yields?|prepared|electrolys(?:is|ed)|lattice|oxidation (?:state|number)|catalyst)\b/;

/** A bracket opening on a metal is a coordination entity even when OCR broke the rest. */
const METAL_BRACKET = /\[\s*(?:Fe|Co|Ni|Cu|Mn|Cr|Ti|V|Zn|Pt|Pd|Ag|Au|Sc|Ru|Rh|Os|Ir|Hg|Cd|Mo|W|Al)\b/;

function mixingOff(stem: string): boolean {
  return /\b(?:s-p|2s-2p|s and p|2s and 2p)\s*(?:orbital\s*)?mixing\b[^.]{0,40}\b(?:not|no|absent|ignored|neglected|switched off)\b/.test(stem)
    || /\b(?:no|without|ignoring|neglecting|absence of)\s+(?:s-p|2s-2p)\s*(?:orbital\s*)?mixing\b/.test(stem)
    || /\bmixing\s+(?:is|being)\s+not\s+operative\b/.test(stem)
    || /\bwithout\s+(?:s-p|2s-2p)\s+mixing\b/.test(stem);
}

/** True for an MO theory stem that names at least one diatomic in the table. */
export function isMoStem(question: string): boolean {
  const stem = chemStem(question);
  if (MO_VETO.test(stem)) return false;
  if (METAL_BRACKET.test(normalizeChemistryText(question))) return false;
  if (complexTokens(question).length > 0) return false;
  if (/->|<=>/.test(normalizeChemistryText(question))) return false;
  if (!MO_CUE.test(stem)) return false;
  return moSpeciesTokens(question).length > 0;
}

/* ------------------------------------------------------------------------- */
/* Drawing                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Two level styles share one ladder builder.
 *
 * "ladder" (the compare figure): short levels, electrons centred, the name
 * solver placed to the east where nothing else is drawn.
 *
 * "full" (the three column figure): every MO level is flanked by dashed
 * correlation links that fan out from its ends, so a name beside the level
 * always crosses a link, and a name under the level cannot clear the arrows
 * standing on the level below at a legible arrow size (the solver reserves
 * a 32 px box 14 px under the line plus 6 px of air, the zone is 555 px tall,
 * and six levels leave about 60 px each). So the full figure widens each
 * level, stands the electrons on its outer part, and pins the name centred
 * under the level where no link and no arrow can reach it. The lab bench
 * measures that clearance on every render.
 */
type LevelStyle = "ladder" | "full";

const LADDER = { sigmaSpan: [-0.3, 0.3] as const, pairLeft: [-0.6, -0.1] as const, pairRight: [0.1, 0.6] as const, sigmaElectron: 0, pairElectron: 0.35 };
const FULL = { sigmaSpan: [-1.2, 0.7] as const, pairLeft: [-1.2, -0.2] as const, pairRight: [0.2, 1.2] as const, sigmaElectron: -0.85, pairElectron: 0.85 };

const AO_WIDTH = 0.6;
const AO_P_WIDTH = 0.4;
const AO_P_PITCH = 0.5;
/** Electron arrows are 0.32 world units tall (sceneKit); they stand on the line. */
const ELECTRON_RISE = 0.2;
const ELECTRON_SPREAD = 0.1;
/** Vertical pitch between adjacent MO levels. */
const PITCH = 1.0;
/** Pinned level names sit this far under their level (see LevelStyle). */
const NAME_DROP = 0.4;
/** Below the lowest level: the axis tail, then the bond order line. */
const AXIS_TAIL = -0.7;
const BOND_ORDER_Y = -1.3;
const HEADROOM = 0.8;

/** Energy (y) of each MO level key on the board, both period 2 orders. */
const LEVEL_Y: Record<MoOrder, Record<string, number>> = {
  period1: { s1: 0, s1a: 1.5 * PITCH },
  n2: { s2: 0, s2a: PITCH, p2: 2 * PITCH, s2p: 3 * PITCH, p2a: 4 * PITCH, s2pa: 5 * PITCH },
  o2: { s2: 0, s2a: PITCH, s2p: 2 * PITCH, p2: 3 * PITCH, p2a: 4 * PITCH, s2pa: 5 * PITCH },
};

interface Placed { id: string; ends: [Vec2, Vec2] }

/** A level spanning [x0, x1] at height y, electrons standing at `electronX`. */
function drawSpan(c: ChemScene, id: string, x0: number, x1: number, y: number, role: string, electrons: number, electronX: number): Placed {
  c.level(id, { x: (x0 + x1) / 2, y }, x1 - x0, role);
  const ey = y + ELECTRON_RISE;
  if (electrons >= 1) c.electron(`${id}_e1`, { x: electronX - (electrons === 2 ? ELECTRON_SPREAD : 0), y: ey }, "up");
  if (electrons >= 2) c.electron(`${id}_e2`, { x: electronX + ELECTRON_SPREAD, y: ey }, "down");
  return { id, ends: [{ x: x0, y }, { x: x1, y }] };
}

/** A solver placed name on a level, preferring one side. */
function nameBeside(c: ChemScene, id: string, label: string, side: "left" | "right"): void {
  const entity = c.scene.entities.find((candidate) => candidate.id === id);
  if (entity) entity.label = label;
  c.scene.annotations.push({ id: `place_${id}`, kind: "label", targetIds: [id], text: label, placementIntent: side });
  c.scene.labelled(id);
}

/** A pinned name centred under a level. */
function nameBelow(c: ChemScene, id: string, label: string, x: number, y: number): void {
  c.text(`${id}_name`, { x, y: y - NAME_DROP }, label, `${label} level name`);
}

/** An atomic orbital level with its name on the outer side of its column. */
function drawAtomicLevel(c: ChemScene, id: string, at: Vec2, width: number, role: string, electrons: number, label: string | undefined, side: "left" | "right"): Placed {
  const placed = drawSpan(c, id, at.x - width / 2, at.x + width / 2, at.y, role, electrons, at.x);
  if (label) nameBeside(c, id, label, side);
  return placed;
}

/** One MO ladder at `column`; returns each level's span for the links. */
function drawLadder(c: ChemScene, result: MoResult, column: Vec2, prefix: string, style: LevelStyle): Map<string, Placed> {
  const geometry = style === "full" ? FULL : LADDER;
  const placed = new Map<string, Placed>();
  const ys = LEVEL_Y[result.order];
  for (const level of result.levels) {
    const y = column.y + ys[level.key]!;
    const x = column.x;
    const role = `${level.name} ${level.kind} molecular orbital`;
    const id = `${prefix}${level.key}`;
    if (level.degeneracy === 2) {
      const left = drawSpan(c, `${id}_l`, x + geometry.pairLeft[0], x + geometry.pairLeft[1], y, role, level.boxes[0] ?? 0, x - geometry.pairElectron);
      const right = drawSpan(c, `${id}_r`, x + geometry.pairRight[0], x + geometry.pairRight[1], y, role, level.boxes[1] ?? 0, x + geometry.pairElectron);
      if (style === "ladder") nameBeside(c, `${id}_r`, level.name, "right");
      else nameBelow(c, id, level.name, x, y);
      placed.set(level.key, { id, ends: [left.ends[0], right.ends[1]] });
    } else {
      const span = drawSpan(c, id, x + geometry.sigmaSpan[0], x + geometry.sigmaSpan[1], y, role, level.electrons, x + geometry.sigmaElectron);
      if (style === "ladder") nameBeside(c, id, level.name, "right");
      else nameBelow(c, id, level.name, x, y);
      placed.set(level.key, span);
    }
  }
  return placed;
}

/** Neutral atom valence occupancy as the AO columns show it. */
function atomValence(symbol: string): { s: number; p: number[] } {
  const element = elementBySymbol(symbol)!;
  if (element.period === 1) return { s: element.z, p: [] };
  const valence = element.group === null ? 0 : element.group <= 2 ? element.group : element.group - 10;
  const s = Math.min(2, valence);
  const pCount = Math.max(0, valence - 2);
  const p = [0, 0, 0];
  for (let index = 0; index < pCount; index += 1) p[index % 3]! += 1;
  return { s, p };
}

function formatBondOrder(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function captionFor(result: MoResult): string {
  const magnetic = result.unpairedElectrons > 0
    ? `paramagnetic (${result.unpairedElectrons} unpaired)`
    : "diamagnetic";
  return `${result.label}: BO = ${formatBondOrder(result.bondOrder)}, ${magnetic}`;
}

function orderCue(result: MoResult): string {
  if (result.order === "period1") return "σ1s then σ*1s";
  return result.order === "n2" ? "π2p below σ2p" : "σ2p below π2p";
}

/** The full three column diagram for one species. */
function buildFullDiagram(question: string, result: MoResult): SceneDocument {
  const c = new ChemScene(question, `molecular orbital diagram of ${result.species}`, MO_FAMILY);
  const [symbolA, symbolB] = result.atoms;
  // The more electronegative atom sits on the right, its orbitals lower.
  const enA = elementBySymbol(symbolA)!.electronegativity ?? 0;
  const enB = elementBySymbol(symbolB)!.electronegativity ?? 0;
  const [left, right] = enA > enB ? [symbolB, symbolA] : [symbolA, symbolB];
  const hetero = left !== right;
  const period1 = result.order === "period1";
  const ys = LEVEL_Y[result.order];
  const columnX = 3.6;
  const top = (period1 ? ys.s1a! : ys.s2pa!) + HEADROOM;
  const ids = { atoms: [] as string[], mos: [] as string[], fill: [] as string[], result: [] as string[] };
  const record = (from: number, into: string[]): void => {
    for (const entity of c.scene.entities.slice(from)) into.push(entity.id);
  };

  // Atomic orbital columns, names on the outer side.
  let mark = c.scene.entities.length;
  const aoEnds = { left: { s: { x: 0, y: 0 }, p: { x: 0, y: 0 } }, right: { s: { x: 0, y: 0 }, p: { x: 0, y: 0 } } };
  for (const side of ["left", "right"] as const) {
    const symbol = side === "left" ? left : right;
    const sign = side === "left" ? -1 : 1;
    const x = sign * columnX;
    const shift = hetero ? (side === "right" ? -0.15 : 0.15) : 0;
    const valence = atomValence(symbol);
    const inner = side === "left" ? 1 : 0;
    c.text(`atom_${side}`, { x, y: top }, symbol, `${symbol} atom heading`);
    if (period1) {
      const ao = drawAtomicLevel(c, `ao_${side}_1s`, { x, y: (ys.s1! + ys.s1a!) / 2 + shift }, AO_WIDTH, `${symbol} 1s atomic orbital`, valence.s, "1s", side);
      aoEnds[side].s = ao.ends[inner];
      continue;
    }
    const ao2s = drawAtomicLevel(c, `ao_${side}_2s`, { x, y: (ys.s2! + ys.s2a!) / 2 + shift }, AO_WIDTH, `${symbol} 2s atomic orbital`, valence.s, "2s", side);
    aoEnds[side].s = ao2s.ends[inner];
    const pY = (Math.max(ys.s2p!, ys.p2!) + ys.p2a!) / 2 + shift;
    const boxes = [-1, 0, 1].map((k) => drawAtomicLevel(
      c,
      `ao_${side}_2p${k + 2}`,
      { x: x + k * AO_P_PITCH, y: pY },
      AO_P_WIDTH,
      `${symbol} 2p atomic orbital`,
      valence.p[k + 1]!,
      k === sign ? "2p" : undefined,
      side,
    ));
    aoEnds[side].p = side === "left" ? boxes[2]!.ends[1] : boxes[0]!.ends[0];
  }
  const axisX = -columnX - 2.2;
  c.arrow("energy_axis", { x: axisX, y: AXIS_TAIL }, { x: axisX, y: top - 0.3 }, "energy axis", "E");
  c.scene.labelled("energy_axis");
  record(mark, ids.atoms);

  // Molecular orbitals, their names, and the correlation links.
  mark = c.scene.entities.length;
  c.text("species_heading", { x: 0, y: top }, result.label, "species heading");
  const placed = drawLadder(c, result, { x: 0, y: 0 }, "mo_", "full");
  let linkIndex = 0;
  const link = (from: Vec2, to: Vec2): void => {
    linkIndex += 1;
    c.link(`corr_${linkIndex}`, from, to, "correlation link");
  };
  for (const side of ["left", "right"] as const) {
    const end = side === "left" ? 0 : 1;
    if (period1) {
      link(aoEnds[side].s, placed.get("s1")!.ends[end]);
      link(aoEnds[side].s, placed.get("s1a")!.ends[end]);
      continue;
    }
    link(aoEnds[side].s, placed.get("s2")!.ends[end]);
    link(aoEnds[side].s, placed.get("s2a")!.ends[end]);
    for (const key of ["s2p", "p2", "p2a", "s2pa"]) link(aoEnds[side].p, placed.get(key)!.ends[end]);
  }
  record(mark, ids.mos);
  ids.fill = ids.mos.filter((id) => /^mo_.*_e[12]$/.test(id));
  ids.mos = ids.mos.filter((id) => !ids.fill.includes(id));

  mark = c.scene.entities.length;
  c.text("bond_order", { x: 0, y: BOND_ORDER_Y }, `BO = ${formatBondOrder(result.bondOrder)}`, "bond order result");
  record(mark, ids.result);

  c.scene.group("atoms", ids.atoms, `the ${hetero ? `${left} and ${right}` : left} atomic orbitals with their own electrons`);
  c.scene.group("mos", ids.mos, `the molecular orbitals of ${result.species} in energy order, ${orderCue(result)}`, ["atoms"]);
  c.scene.group("fill", ids.fill, `${result.valenceElectrons} valence electrons fill the molecular orbitals: ${result.configuration}`, ["mos"]);
  c.scene.group("result", ids.result, `bond order ${formatBondOrder(result.bondOrder)}, ${result.magnetic}`, ["fill"]);
  return c.build({ caption: captionFor(result) });
}

/** Compact MO ladders side by side, one per species, each headed by its bond order. */
function buildCompareDiagram(question: string, results: readonly MoResult[]): SceneDocument {
  const c = new ChemScene(question, `molecular orbital occupancy of ${results.map((r) => r.species).join(", ")}`, MO_FAMILY);
  const pitch = 2.6;
  const period1 = results.every((result) => result.order === "period1");
  const top = (period1 ? LEVEL_Y.period1.s1a! : LEVEL_Y.n2.s2pa!) + HEADROOM;
  const axisX = -((results.length - 1) * pitch) / 2 - 1.6;
  c.arrow("energy_axis", { x: axisX, y: AXIS_TAIL }, { x: axisX, y: top - 0.3 }, "energy axis", "E");
  c.scene.labelled("energy_axis");
  let previous: string[] = [];
  results.forEach((result, index) => {
    const x = (index - (results.length - 1) / 2) * pitch;
    const before = c.scene.entities.length;
    c.text(`species_${index}`, { x, y: top }, result.label, "species heading");
    drawLadder(c, result, { x, y: 0 }, `mo${index}_`, "ladder");
    c.text(`bo_${index}`, { x, y: BOND_ORDER_Y }, `BO = ${formatBondOrder(result.bondOrder)}`, "bond order result");
    const ids = c.scene.entities.slice(before).map((entity) => entity.id);
    if (index === 0) ids.unshift("energy_axis");
    const groupId = `species_${index}_group`;
    c.scene.group(groupId, ids, `${result.species}: ${result.configuration}, bond order ${formatBondOrder(result.bondOrder)}, ${result.magnetic} (${orderCue(result)})`, previous);
    previous = [groupId];
  });
  return c.build({ caption: results.map(captionFor).join("; ") });
}

/**
 * The MO figure for the stem: the full diagram when one species is named,
 * a row of compact ladders for two to four, nothing otherwise.
 */
export function buildMoScene(question: string, quantities: ChemPlanQuantity[], schematic: boolean): SceneDocument | null {
  void quantities;
  void schematic;
  if (!isMoStem(question)) return null;
  const stem = chemStem(question);
  const options: MoOptions = { mixing: mixingOff(stem) ? "off" : "auto" };
  const tokens = moSpeciesTokens(question);
  const results = tokens.map((token) => moConfiguration(token, options)).filter((result): result is MoResult => result !== null);
  if (results.length === 0 || results.length > 4) return null;
  if (results.length !== tokens.length) return null;
  if (results.length === 1) return buildFullDiagram(question, results[0]!);
  return buildCompareDiagram(question, results);
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                    */
/* ------------------------------------------------------------------------- */

export const MO_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  {
    question: "Draw the molecular orbital diagram of O2 and find its bond order and magnetic character.",
    expect: "draw",
    labels: ["O_2", "O", "σ2s", "σ*2s", "σ2p", "π2p", "π*2p", "σ*2p", "2s", "2p", "BO = 2", "E"],
    note: "O2 order, σ2p below π2p; two unpaired electrons in π*2p",
  },
  {
    question: "Using MO theory, calculate the bond order of N2 and state whether it is paramagnetic or diamagnetic.",
    expect: "draw",
    labels: ["N_2", "N", "π2p", "σ2p", "BO = 3"],
    note: "N2 order, π2p below σ2p, π*2p and σ*2p empty",
  },
  {
    question: "Draw the MO diagram of CO and find its bond order.",
    expect: "draw",
    labels: ["C", "O", "CO", "BO = 3"],
    note: "heteronuclear: the O column sits lower than the C column",
  },
  {
    question: "Nitric oxide NO is paramagnetic. Using MOT find its bond order.",
    expect: "draw",
    labels: ["NO", "N", "O", "BO = 2.5"],
    note: "15 electrons, N2 order, one electron in π*2p",
  },
  {
    question: "Bond order of He2+ according to molecular orbital theory is",
    expect: "draw",
    labels: ["He_2^(+)", "He", "σ1s", "σ*1s", "1s", "BO = 0.5"],
    forbidLabels: ["2s", "2p"],
  },
  {
    question: "Arrange O2, O2+, O2- and O2^2- in increasing order of bond order using MO theory.",
    expect: "draw",
    labels: ["O_2", "O_2^(+)", "O_2^(-)", "O_2^(2-)", "BO = 2", "BO = 2.5", "BO = 1.5", "BO = 1"],
    note: "four compact ladders in stem order",
  },
  {
    question: "Assuming 2s-2p mixing is NOT operative, the paramagnetic species among Be2, B2, C2 and N2 is",
    expect: "draw",
    labels: ["Be_2", "B_2", "C_2", "N_2", "BO = 0", "BO = 1", "BO = 2", "BO = 3"],
    note: "no-mixing order for all four, so C2 is the paramagnetic one",
  },
  {
    question: "Compare the bond orders of N2+, N2-, N2^2- and C2^2- using molecular orbital theory.",
    expect: "draw",
    labels: ["N_2^(+)", "N_2^(-)", "N_2^(2-)", "C_2^(2-)", "BO = 2.5", "BO = 2", "BO = 3"],
  },
  {
    question: "Which of H2, H2+, H2- and He2 do not exist according to MOT? Give the bond order of each.",
    expect: "draw",
    labels: ["H_2", "H_2^(+)", "H_2^(-)", "He_2", "σ1s", "σ*1s", "BO = 1", "BO = 0.5", "BO = 0"],
    forbidLabels: ["σ2s"],
  },
  {
    question: "Which of Li2, B2, B2+ and F2- are paramagnetic according to molecular orbital theory?",
    expect: "draw",
    labels: ["Li_2", "B_2", "B_2^(+)", "F_2^(-)", "BO = 1", "BO = 0.5"],
    note: "B2 has π2p^1 π2p^1 in the NCERT order",
  },
  {
    question: "Arrange CN-, CN, CO+ and NO+ in decreasing order of bond order.",
    expect: "draw",
    labels: ["CN^(-)", "CN", "CO^(+)", "NO^(+)", "BO = 3", "BO = 2.5"],
  },
  {
    question: "Which of F2, Ne2, NO- and Li2+ has a bond order of zero according to MO theory?",
    expect: "draw",
    labels: ["F_2", "Ne_2", "NO^(-)", "Li_2^(+)", "BO = 1", "BO = 0", "BO = 2", "BO = 0.5"],
    note: "mixed orders on one board: F2 and Ne2 in the O2 order, NO- and Li2+ in the N2 order",
  },
  {
    question: "Superoxides are paramagnetic while peroxides are diamagnetic. Explain with the MO configuration of the anions.",
    expect: "draw",
    labels: ["O_2^(-)", "O_2^(2-)", "BO = 1.5", "BO = 1"],
    note: "species read from the names superoxide and peroxide",
  },
  {
    question: "The number of unpaired electrons in [Fe(CN)6]3- and its magnetic moment, using crystal field theory, are",
    expect: "decline",
    note: "coordination complex, vetoed even though CN is a token",
  },
  {
    question: "The bond order of Cl2 molecule according to molecular orbital theory is",
    expect: "decline",
    note: "period 3 diatomic, outside the table",
  },
  {
    question: "The paramagnetic gas obtained when HClO3 reacts with HCl is",
    expect: "decline",
    note: "reaction stem with no diatomic species token",
  },
];
