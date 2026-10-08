/**
 * Commercial cells and moist-air iron corrosion on the electrochemistry board.
 *
 * Owned devices: the Leclanche dry cell, the lead accumulator in discharge
 * and in recharge, the acid hydrogen-oxygen fuel cell, and iron corroding
 * in moist air. Every half reaction and net reaction is counted for atoms
 * and charge before a label is placed. An unbalanced reaction draws nothing.
 * Voltages, lifetimes, capacities and corrosion rates are not invented, and
 * voltage digits are never written on a label.
 */
import type { SceneDocument } from "../types";
import { parseFormula } from "./formula";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_electrochem" as const;
const LABEL_X = 0.2;
const LABEL_Y = 2.6;
const LABEL_STEP = -0.8;
const MAX_LABELS = 6;
const MAX_LABEL_CHARS = 16;

/**
 * Galvanic notation, conductance and oxidation-number stems belong to other
 * lanes. `||` is cell notation. Internal resistance is not one of these devices.
 */
const NOT_THIS_BOARD = /faraday|nernst|kohlrausch|conductance|daniell|\|\||internal resistance|oxidation number of/;

interface Term {
  readonly coeff: number;
  readonly formula: string;
}

interface Reaction {
  readonly left: readonly Term[];
  readonly right: readonly Term[];
}

interface Cell {
  readonly anode: Reaction;
  readonly cathode: Reaction;
  readonly net: Reaction;
  /** Charge of each balanced half reaction and of the net, both sides. */
  readonly anodeCharge: number;
  readonly cathodeCharge: number;
  readonly netCharge: number;
}

interface Tally {
  readonly atoms: ReadonlyMap<string, number>;
  readonly charge: number;
}

function term(coeff: number, formula: string): Term {
  return { coeff, formula };
}

function electron(coeff: number): Term {
  return { coeff, formula: "e-" };
}

/**
 * Dry cell discharge. Cathode product is Mn2O3, not a substituted hydroxide.
 * Net charge is +2 on each side from 2 NH4+ and Zn2+.
 */
const DRY: Cell = {
  anode: {
    left: [term(1, "Zn")],
    right: [term(1, "Zn2+"), electron(2)],
  },
  cathode: {
    left: [term(2, "MnO2"), term(2, "NH4+"), electron(2)],
    right: [term(1, "Mn2O3"), term(2, "NH3"), term(1, "H2O")],
  },
  net: {
    left: [term(1, "Zn"), term(2, "MnO2"), term(2, "NH4+")],
    right: [term(1, "Zn2+"), term(1, "Mn2O3"), term(2, "NH3"), term(1, "H2O")],
  },
  anodeCharge: 0,
  cathodeCharge: 0,
  netCharge: 2,
};

/**
 * Lead accumulator discharge. The net is the molecular form of the ionic
 * halves: 2 H2SO4 stands for 4 H+ and 2 SO4^2-. Recharge is this cell reversed.
 */
const LEAD: Cell = {
  anode: {
    left: [term(1, "Pb"), term(1, "SO4^2-")],
    right: [term(1, "PbSO4"), electron(2)],
  },
  cathode: {
    left: [term(1, "PbO2"), term(1, "SO4^2-"), term(4, "H+"), electron(2)],
    right: [term(1, "PbSO4"), term(2, "H2O")],
  },
  net: {
    left: [term(1, "Pb"), term(1, "PbO2"), term(2, "H2SO4")],
    right: [term(2, "PbSO4"), term(2, "H2O")],
  },
  anodeCharge: -2,
  cathodeCharge: 0,
  netCharge: 0,
};

/** Acid hydrogen-oxygen fuel cell. Alkali is a different pair of halves. */
const FUEL: Cell = {
  anode: {
    left: [term(2, "H2")],
    right: [term(4, "H+"), electron(4)],
  },
  cathode: {
    left: [term(1, "O2"), term(4, "H+"), electron(4)],
    right: [term(2, "H2O")],
  },
  net: {
    left: [term(2, "H2"), term(1, "O2")],
    right: [term(2, "H2O")],
  },
  anodeCharge: 0,
  cathodeCharge: 0,
  netCharge: 0,
};

/**
 * Moist-air corrosion. The anode as written moves two electrons, so two iron
 * atoms are taken to match the four electrons of oxygen reduction.
 * Net charge is 0 on each side.
 */
const RUST: Cell = {
  anode: {
    left: [term(1, "Fe")],
    right: [term(1, "Fe2+"), electron(2)],
  },
  cathode: {
    left: [term(1, "O2"), term(2, "H2O"), electron(4)],
    right: [term(4, "OH-")],
  },
  net: {
    left: [term(2, "Fe"), term(1, "O2"), term(2, "H2O")],
    right: [term(2, "Fe2+"), term(4, "OH-")],
  },
  anodeCharge: 0,
  cathodeCharge: -4,
  netCharge: 0,
};

const DRY_LABELS = ["dry cell", "Zn anode", "discharge", "no voltage"] as const;
const LEAD_DISCHARGE_LABELS = ["discharge", "Pb anode", "PbO2 cath", "net ok"] as const;
const LEAD_RECHARGE_LABELS = ["recharge", "reversed", "not disch"] as const;
const FUEL_LABELS = ["fuel cell", "net 2H2+O2", "no voltage"] as const;
const RUST_LABELS = ["Fe anode", "O2 cath", "no rate", "net ok"] as const;

function tally(terms: readonly Term[]): Tally | null {
  const atoms = new Map<string, number>();
  let charge = 0;
  for (const item of terms) {
    if (!Number.isInteger(item.coeff) || item.coeff <= 0) return null;
    if (item.formula === "e-") {
      charge -= item.coeff;
      continue;
    }
    const parsed = parseFormula(item.formula);
    if (!parsed) return null;
    charge += item.coeff * parsed.charge;
    for (const atom of parsed.atoms) {
      atoms.set(atom.symbol, (atoms.get(atom.symbol) ?? 0) + item.coeff * atom.count);
    }
  }
  return { atoms, charge };
}

function sameAtoms(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  const symbols = new Set([...left.keys(), ...right.keys()]);
  for (const symbol of symbols) {
    if ((left.get(symbol) ?? 0) !== (right.get(symbol) ?? 0)) return false;
  }
  return true;
}

/** Atom totals agree and the charge, including electrons, agrees. */
function balanced(reaction: Reaction): boolean {
  const left = tally(reaction.left);
  const right = tally(reaction.right);
  if (!left || !right) return false;
  return left.charge === right.charge && sameAtoms(left.atoms, right.atoms);
}

function sideCharge(reaction: Reaction): number | null {
  const left = tally(reaction.left);
  const right = tally(reaction.right);
  if (!left || !right || left.charge !== right.charge) return null;
  return left.charge;
}

function electronCoeff(terms: readonly Term[]): number {
  return terms.reduce((sum, item) => sum + (item.formula === "e-" ? item.coeff : 0), 0);
}

function electronsProduced(reaction: Reaction): number {
  return electronCoeff(reaction.right) - electronCoeff(reaction.left);
}

function electronsConsumed(reaction: Reaction): number {
  return electronCoeff(reaction.left) - electronCoeff(reaction.right);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/** Positive coefficients are reactants. Electrons are omitted so the net can cancel them. */
function absorb(into: Map<string, number>, terms: readonly Term[], scale: number, sign: 1 | -1): void {
  for (const item of terms) {
    if (item.formula === "e-") continue;
    into.set(item.formula, (into.get(item.formula) ?? 0) + sign * scale * item.coeff);
  }
}

function reactionMap(reaction: Reaction): Map<string, number> {
  const map = new Map<string, number>();
  absorb(map, reaction.left, 1, 1);
  absorb(map, reaction.right, 1, -1);
  return map;
}

function netMap(oxidation: Reaction, reduction: Reaction): Map<string, number> | null {
  const produced = electronsProduced(oxidation);
  const consumed = electronsConsumed(reduction);
  if (produced <= 0 || consumed <= 0) return null;
  const divisor = gcd(produced, consumed);
  const map = new Map<string, number>();
  absorb(map, oxidation.left, consumed / divisor, 1);
  absorb(map, oxidation.right, consumed / divisor, -1);
  absorb(map, reduction.left, produced / divisor, 1);
  absorb(map, reduction.right, produced / divisor, -1);
  return map;
}

/** 2 H2SO4 is the molecular writing of 4 H+ + 2 SO4^2-. */
function expandAcid(map: Map<string, number>): Map<string, number> {
  const expanded = new Map<string, number>();
  for (const [formula, coeff] of map) {
    if (formula === "H2SO4") {
      expanded.set("H+", (expanded.get("H+") ?? 0) + coeff * 2);
      expanded.set("SO4^2-", (expanded.get("SO4^2-") ?? 0) + coeff);
    } else {
      expanded.set(formula, (expanded.get(formula) ?? 0) + coeff);
    }
  }
  return expanded;
}

function mapsEqual(left: Map<string, number>, right: Map<string, number>): boolean {
  const keys = new Set([...left.keys(), ...right.keys()]);
  for (const key of keys) {
    if ((left.get(key) ?? 0) !== (right.get(key) ?? 0)) return false;
  }
  return true;
}

function reactionCharge(reaction: Reaction, expected: number): boolean {
  return balanced(reaction) && sideCharge(reaction) === expected;
}

/**
 * Halves and the net balance, the coded charges match the tallies, and the
 * net is the electron-cancelled sum of the halves. H2SO4 is expanded before
 * that comparison.
 */
function cellOk(cell: Cell): boolean {
  if (!reactionCharge(cell.anode, cell.anodeCharge)) return false;
  if (!reactionCharge(cell.cathode, cell.cathodeCharge)) return false;
  if (!reactionCharge(cell.net, cell.netCharge)) return false;
  const combined = netMap(cell.anode, cell.cathode);
  if (!combined) return false;
  return mapsEqual(expandAcid(combined), expandAcid(reactionMap(cell.net)));
}

function reverseReaction(reaction: Reaction): Reaction {
  return { left: reaction.right, right: reaction.left };
}

function reverseCell(cell: Cell): Cell {
  return {
    anode: reverseReaction(cell.cathode),
    cathode: reverseReaction(cell.anode),
    net: reverseReaction(cell.net),
    anodeCharge: cell.cathodeCharge,
    cathodeCharge: cell.anodeCharge,
    netCharge: cell.netCharge,
  };
}

function libraryBalances(): boolean {
  return cellOk(DRY) && cellOk(LEAD) && cellOk(reverseCell(LEAD)) && cellOk(FUEL) && cellOk(RUST);
}

function ownsDry(stem: string): boolean {
  return /dry[-\s]?cell|leclanch/.test(stem);
}

function ownsLead(stem: string): boolean {
  if (!/\blead\b|\bpb\b/.test(stem)) return false;
  return /accumulator|storage battery|storage cell|lead-acid|lead acid/.test(stem);
}

function ownsFuel(stem: string): boolean {
  if (!/fuel[-\s]?cell/.test(stem)) return false;
  if (/methanol|ethanol|ch3oh|methane|hydrocarbon/.test(stem)) return false;
  return /hydrogen|(?:^|[^a-z])h2(?:[^a-z]|$)/.test(stem);
}

function ownsCorrosion(stem: string): boolean {
  if (/dry corrosion|in dry air|absence of moisture|anhydrous/.test(stem)) return false;
  const iron = /\biron\b|\bfe\b/.test(stem);
  const attack = /corrod|corros|rust/.test(stem);
  if (iron && attack && /moist|damp|humid|wet|\bair\b|water|h2o|oxygen|atmosphere/.test(stem)) return true;
  return /corrosion rate|rate of corrosion|rate of rusting|rusting rate/.test(stem);
}

/** True when this board owns the stem, including stems that must draw nothing. */
export function claimsCommercialCell(question: string): boolean {
  const stem = chemStem(question);
  if (NOT_THIS_BOARD.test(stem)) return false;
  return ownsDry(stem) || ownsLead(stem) || ownsFuel(stem) || ownsCorrosion(stem);
}

function isRechargeContext(stem: string): boolean {
  return /recharg|(?<!dis)charging\b|(?<![a-z])charged\b|on charge\b/.test(stem);
}

function dischargeAnodeArrow(stem: string): boolean {
  return /(?:^|[^a-z])pb(?:\s*\+\s*so4[^a-z]{0,8})?\s*->\s*pbso4\b/.test(stem);
}

/** Recharge described with the discharge anode Pb -> PbSO4 is not drawn as recharge. */
function rechargeClaimsDischargeAnode(stem: string): boolean {
  if (!isRechargeContext(stem) || !ownsLead(stem) || !dischargeAnodeArrow(stem)) return false;
  if (/stay|remain|still|unchanged|same direction|not revers/.test(stem)) return true;
  if (/revers|opposite/.test(stem)) return false;
  return /anode/.test(stem);
}

function forbidsTopic(stem: string, topic: string): boolean {
  const body = `(?:do not|don't|not to) (?:invent|draw|show|state|give|include|assume)[^.]{0,48}${topic}|without (?:a |an |any )?(?:stated )?${topic}|no ${topic}`;
  return new RegExp(body).test(stem);
}

function asksVoltage(stem: string): boolean {
  if (forbidsTopic(stem, "voltage") || forbidsTopic(stem, "emf")) return false;
  const number = /\d+(?:\.\d+)?\s*v(?:olts?)?\b/.test(stem);
  if (number && /draw|show|label|mark|indicate|plot|that voltage|this voltage/.test(stem)) return true;
  if (/(?:draw|show|label|mark|plot|indicate)[^.]{0,80}(?:voltage|emf|\d+(?:\.\d+)?\s*v(?:olts?)?\b)/.test(stem)) return true;
  if (/(?:voltage|emf|cell potential)[^.]{0,40}(?:draw|show|label|mark|plot)/.test(stem)) return true;
  if (/(?:what is|find|calculate|state) (?:the |its )?(?:voltage|emf|cell potential)/.test(stem)) return true;
  return false;
}

function asksRate(stem: string): boolean {
  if (forbidsTopic(stem, "rate")) return false;
  if (/corrosion rate|rusting rate|rate of (?:corrosion|rusting|rust)\b/.test(stem)) return true;
  return /\d+(?:\.\d+)?\s*mm\b/.test(stem) && /(?:per|a|\/)\s*year|annum/.test(stem);
}

function asksLife(stem: string): boolean {
  if (forbidsTopic(stem, "lifetime") || forbidsTopic(stem, "capacity")) return false;
  const topic = /lifetime|shelf life|service life|ampere[- ]?hours?|amp[- ]?hours?|\bah\b/.test(stem);
  if (!topic) return false;
  return /\d/.test(stem) || /draw|show|what|find|how long|state|calculate/.test(stem);
}

function namedMeasurement(quantities: readonly ChemPlanQuantity[], pattern: RegExp): boolean {
  return quantities.some((item) => {
    if (!Number.isFinite(item.value)) return false;
    return pattern.test(`${item.id} ${item.symbol} ${item.unit ?? ""}`.toLowerCase());
  });
}

/** A number typed in the question is not a measured source. A planner quantity can be. */
function measuredVoltage(stem: string, quantities: readonly ChemPlanQuantity[]): boolean {
  if (/\bmeasured\b[^.]{0,40}(?:voltage|emf|\d+(?:\.\d+)?\s*v\b)/.test(stem)) return true;
  if (/(?:voltage|emf)[^.]{0,40}\bmeasured\b/.test(stem)) return true;
  return namedMeasurement(quantities, /\b(?:emf|voltage)\b|\bvolts?\b|(?:^|\s)v(?:$|\s)/);
}

function measuredRate(stem: string, quantities: readonly ChemPlanQuantity[]): boolean {
  if (/\bmeasured\b[^.]{0,48}rate|rate[^.]{0,48}\bmeasured\b/.test(stem)) return true;
  return namedMeasurement(quantities, /rate|mm\/y|mm per year/);
}

function measuredLife(stem: string, quantities: readonly ChemPlanQuantity[]): boolean {
  if (/\bmeasured\b[^.]{0,48}(?:life|capacity)|(?:life|capacity)[^.]{0,48}\bmeasured\b/.test(stem)) return true;
  return namedMeasurement(quantities, /lifetime|capacity|ampere|amp[- ]?hour|\bah\b/);
}

function unmeasuredDemand(stem: string, quantities: readonly ChemPlanQuantity[]): boolean {
  if (asksVoltage(stem) && !measuredVoltage(stem, quantities)) return true;
  if (asksRate(stem) && !measuredRate(stem, quantities)) return true;
  if (asksLife(stem) && !measuredLife(stem, quantities)) return true;
  return false;
}

function fuelKind(stem: string): "acid" | "alkali" | "silent" {
  const alkali = /alkali|alkaline|\bbasic medium\b|\bkoh\b|hydroxide/.test(stem);
  const acid = /\bacid|\bacidic\b|\bh2so4\b/.test(stem) || (/h\+/.test(stem) && /->/.test(stem));
  if (acid && alkali) return "silent";
  if (alkali) return "alkali";
  if (acid) return "acid";
  return "silent";
}

function moistIron(stem: string): boolean {
  const iron = /\biron\b|\bfe\b/.test(stem);
  const attack = /corrod|corros|rust/.test(stem);
  const moist = /moist|damp|humid|wet/.test(stem) || (/\bair\b|water|h2o|oxygen|atmosphere/.test(stem) && attack);
  return iron && attack && moist;
}

function place(question: string, reason: string, labels: readonly string[], cue: string): SceneDocument | null {
  if (labels.length === 0 || labels.length > MAX_LABELS) return null;
  if (labels.some((label) => label.length === 0 || label.length > MAX_LABEL_CHARS)) return null;
  if (labels.some((label) => /\d+\.\d+\s*V/.test(label))) return null;
  const scene = new ChemScene(question, reason, FAMILY);
  const ids = labels.map((label, index) =>
    scene.text(`line_${index + 1}`, { x: LABEL_X, y: LABEL_Y + index * LABEL_STEP }, label, "cell board"),
  );
  scene.scene.group("cell", ids, cue);
  const document = scene.build();
  const drawn = document.entities.flatMap((entity) => (entity.kind === "label" && entity.label ? [entity.label] : []));
  if (drawn.length !== labels.length || drawn.some((label, index) => label !== labels[index])) return null;
  if (document.source.chemistryFamily !== FAMILY) return null;
  return document;
}

function drawCell(question: string, reason: string, cell: Cell, labels: readonly string[], heading: string): SceneDocument | null {
  if (!cellOk(cell)) return null;
  const charge = sideCharge(cell.net);
  if (charge === null || charge !== cell.netCharge) return null;
  return place(question, reason, labels, `${heading}. net charge left ${charge} right ${charge}`);
}

function buildDry(question: string, stem: string, reason: string): SceneDocument | null {
  if (isRechargeContext(stem)) return null;
  if (/mnooh|mno\(oh\)|mn\(oh\)/.test(stem)) return null;
  return drawCell(question, reason, DRY, DRY_LABELS, "Leclanche dry cell discharge");
}

function buildLead(question: string, stem: string, reason: string): SceneDocument | null {
  if (rechargeClaimsDischargeAnode(stem)) return null;
  const recharge = isRechargeContext(stem);
  const discharge = /discharg/.test(stem);
  if (recharge && discharge && !/revers|opposite/.test(stem)) return null;
  if (recharge) {
    return drawCell(question, reason, reverseCell(LEAD), LEAD_RECHARGE_LABELS, "lead accumulator recharge reverses discharge");
  }
  return drawCell(question, reason, LEAD, LEAD_DISCHARGE_LABELS, "lead accumulator discharge");
}

function buildFuel(question: string, stem: string, reason: string): SceneDocument | null {
  if (fuelKind(stem) !== "acid") return null;
  if (/h2o2|peroxide/.test(stem)) return null;
  return drawCell(question, reason, FUEL, FUEL_LABELS, "acid hydrogen oxygen fuel cell");
}

function buildCorrosion(question: string, stem: string, reason: string): SceneDocument | null {
  if (asksRate(stem)) return null;
  if (!moistIron(stem)) return null;
  return drawCell(question, reason, RUST, RUST_LABELS, "iron corrosion in moist air");
}

export function buildCommercialCellScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (!claimsCommercialCell(question)) return null;
  if (!libraryBalances()) return null;
  const stem = chemStem(question);
  if (unmeasuredDemand(stem, quantities)) return null;
  const owned = [ownsDry(stem), ownsLead(stem), ownsFuel(stem), ownsCorrosion(stem)].filter(Boolean).length;
  if (owned !== 1) return null;
  const reason = schematic ? "schematic commercial cell" : "commercial cell";
  if (ownsDry(stem)) return buildDry(question, stem, reason);
  if (ownsLead(stem)) return buildLead(question, stem, reason);
  if (ownsFuel(stem)) return buildFuel(question, stem, reason);
  return buildCorrosion(question, stem, reason);
}
