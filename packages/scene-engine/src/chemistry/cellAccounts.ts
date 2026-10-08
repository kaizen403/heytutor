/**
 * Label-panel accounts for the Nernst equation, ΔG° and K from E°,
 * the sign change when a cell reaction is reversed, and anode polarity.
 *
 * Beaker cells, cell notation, electrolysis, and conductance plots stay in
 * electrochemistry.ts. This module does not import that file. A missing
 * electron count, a non-positive Q, or a non-298 K Nernst problem without
 * the stated R and F draws nothing. E° is never scaled by a stoichiometric
 * coefficient, and K is never taken from a nonstandard E.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_electrochem";
const LABEL_X = 0.2;
const LABEL_Y = 2.6;
const LABEL_STEP = -0.8;
const MAX_LABELS = 6;
const MAX_LABEL_CHARS = 16;
const GAS_R = 8.314;
const FARADAY = 96500;
const ROOM_T = 298;

const BLOCKED = [
  "|",
  "salt bridge",
  "daniell",
  "daniel",
  "internal resistance",
  "standard emf of a cell is",
  "oxidation number",
  "dry cell",
  "kohlrausch",
  "√c",
  "electrolysis",
  "znso4",
  "brine",
];

function accountStem(question: string): string {
  return chemStem(question.replace(/º/g, "°"));
}

function blocked(question: string): boolean {
  const folded = `${question}\n${accountStem(question)}`.toLowerCase();
  return BLOCKED.some((phrase) => folded.includes(phrase));
}

function hasStandardPotential(stem: string): boolean {
  return /(?:^|[^a-z])e\s*°/.test(stem) || /(?:^|[^a-z])e0\b/.test(stem);
}

function asksK(stem: string): boolean {
  return /\bfind k\b|\bcalculate k\b|\band k\b|\bk from\b|\bequilibrium constant\b|\bln k\b/.test(stem);
}

function asksG(stem: string): boolean {
  return /δ\s*g|∆\s*g|delta\s*g|\bdg\b/.test(stem);
}

function ownsNernst(stem: string): boolean {
  if (/nernst/.test(stem)) return true;
  return hasStandardPotential(stem) && /\bq\s*=/.test(stem) && /\b(?:find|calculate|determine)\s+e\b/.test(stem);
}

function ownsReversal(stem: string): boolean {
  return /\breversed\b|\breverse the\b|\breversing\b/.test(stem) && hasStandardPotential(stem);
}

function ownsPolarity(stem: string): boolean {
  return /galvanic/.test(stem) && /electrolytic/.test(stem) && /anode/.test(stem);
}

function ownsGibbs(stem: string): boolean {
  if (!asksK(stem) && !asksG(stem)) return false;
  return hasStandardPotential(stem) || /(?:^|[^a-z°])e\s*=/.test(stem);
}

/** True when a cell-account figure owns the stem, including honest declines. */
export function claimsCellAccount(question: string): boolean {
  if (blocked(question)) return false;
  const stem = accountStem(question);
  return ownsPolarity(stem) || ownsReversal(stem) || ownsNernst(stem) || ownsGibbs(stem);
}

const NUMBER = "([+-]?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)";

function assigned(stem: string, symbol: string): number | null {
  const match = new RegExp(`\\b${symbol}\\s*=\\s*${NUMBER}`, "i").exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function readE0Values(stem: string): number[] {
  const values: number[] = [];
  const pattern = new RegExp(`(?:^|[^a-z])e\\s*(?:°|0)\\s*(?:cell)?\\s*(?:=|is|was)\\s*${NUMBER}`, "gi");
  for (const match of stem.matchAll(pattern)) {
    if (match[1] === undefined) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function readPlainE(stem: string): number | null {
  const match = new RegExp(`(?:^|[^a-z°])e\\s*=\\s*${NUMBER}`, "i").exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function positiveInteger(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0;
}

function statedConstant(stem: string, symbol: string, expected: number, badUnit: RegExp): number | null {
  const match = new RegExp(`\\b${symbol}\\s*=\\s*${NUMBER}([^.]{0,24})`, "i").exec(stem);
  if (!match?.[1]) return null;
  if (badUnit.test(match[2] ?? "")) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || Math.abs(value - expected) > 1e-6) return null;
  return expected;
}

function readR(stem: string): number | null {
  return statedConstant(stem, "r", GAS_R, /\bkj\b|\bcal\b|calorie|\batm\b|\bbar\b|litre|liter/);
}

function readF(stem: string): number | null {
  return statedConstant(stem, "f", FARADAY, /\bkj\b|\bcal\b|calorie|\batm\b|\bbar\b/);
}

function plain(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

function panel(question: string, purpose: string, labels: readonly string[], caption: string): SceneDocument | null {
  if (labels.length === 0 || labels.length > MAX_LABELS) return null;
  if (labels.some((label) => label.length === 0 || label.length > MAX_LABEL_CHARS)) return null;
  const scene = new ChemScene(question, purpose, FAMILY);
  const ids = labels.map((label, index) =>
    scene.text(`line_${index}`, { x: LABEL_X, y: LABEL_Y + index * LABEL_STEP }, label, "cell account"),
  );
  scene.scene.group("account", ids, "cell account");
  return scene.build({ caption });
}

function polarityDenied(stem: string): boolean {
  const clauses = stem.split(/[.]|;|\band in\b/);
  for (const clause of clauses) {
    const anode = /anode/.test(clause);
    if (/galvanic/.test(clause) && anode && /positive/.test(clause) && !/negative/.test(clause)) return true;
    if (/electrolytic/.test(clause) && anode && /negative/.test(clause) && !/positive/.test(clause)) return true;
    if (/oxidation/.test(clause) && /cathode/.test(clause) && !/anode/.test(clause)) return true;
  }
  return /reduction is at the anode/.test(stem);
}

function buildPolarity(question: string, stem: string): SceneDocument | null {
  if (polarityDenied(stem)) return null;
  return panel(question, "anode sign in galvanic and electrolytic cells", [
    "ox anode",
    "galv an-",
    "elec an+",
  ], "Oxidation is at the anode in both cells. The galvanic anode is negative. The electrolytic anode is positive. No beaker cell is drawn.");
}

function reversedPotential(stem: string): number | null {
  const was = new RegExp(`(?:^|[^a-z])e\\s*(?:°|0)\\s*(?:cell)?\\s*was\\s*${NUMBER}`, "i").exec(stem);
  const stated = new RegExp(`reversed e\\s*(?:°|0)\\s*(?:cell)?\\s*(?:=|is|was)\\s*${NUMBER}`, "i").exec(stem);
  const original = was?.[1] !== undefined ? Number(was[1]) : null;
  const statedReversed = stated?.[1] !== undefined ? Number(stated[1]) : null;
  if (original !== null && Number.isFinite(original)) {
    const flipped = -original;
    if (statedReversed !== null && Math.abs(statedReversed - flipped) > 1e-6) return null;
    return flipped;
  }
  if (statedReversed !== null && Number.isFinite(statedReversed)) return statedReversed;
  const values = readE0Values(stem);
  if (values.length !== 1) return null;
  const only = values[0];
  return only === undefined ? null : -only;
}

function buildReversal(question: string, stem: string): SceneDocument | null {
  const electrons = assigned(stem, "n");
  if (electrons !== null && !positiveInteger(electrons)) return null;
  const flipped = reversedPotential(stem);
  if (flipped === null || !Number.isFinite(flipped)) return null;
  // Reversal changes the sign of E° and of ΔG°. It does not multiply E° by a coefficient.
  const label = `E0=${flipped.toFixed(2)} V`;
  return panel(question, "sign change on reversing the cell reaction", [
    label,
    "sign flip",
  ], "Reversing the cell reaction changes the sign of E° and the sign of ΔG° = −nFE°. E° is not multiplied by a stoichiometric coefficient.");
}

function kFromNonstandardE(stem: string): boolean {
  if (!asksK(stem) || readPlainE(stem) === null) return false;
  if (/from e\s*°|from e0\b/.test(stem)) return false;
  return /alone|from this e\b/.test(stem) || readE0Values(stem).length === 0;
}

function buildNernst(question: string, stem: string): SceneDocument | null {
  const standardPotential = readE0Values(stem)[0] ?? null;
  const electrons = assigned(stem, "n");
  const reactionQuotient = assigned(stem, "q");
  const temperature = assigned(stem, "t");
  if (standardPotential === null || reactionQuotient === null || temperature === null) return null;
  if (!positiveInteger(electrons)) return null;
  if (!(reactionQuotient > 0) || !(temperature > 0)) return null;

  const roomStandard = reactionQuotient === 1 && temperature === ROOM_T;
  if (roomStandard) {
    return panel(question, "Nernst equation at unit reaction quotient", [
      `E=${standardPotential.toFixed(2)} V`,
      "Q=1",
      "E=E0",
    ], "E = E° − (RT/nF) ln Q. Q = 1 makes ln Q = 0, so E = E°. At 298 K that result does not need R or F.");
  }

  const gasR = readR(stem);
  const faraday = readF(stem);
  if (gasR === null || faraday === null) return null;
  // E = E° − (RT/nF) ln Q. The 0.059 V shortcut is not this formula.
  const cellPotential = standardPotential - ((gasR * temperature) / (electrons * faraday)) * Math.log(reactionQuotient);
  if (!Number.isFinite(cellPotential)) return null;
  const potentialLabel = `E=${cellPotential.toFixed(3)} V`;
  if (temperature !== ROOM_T) {
    return panel(question, "Nernst equation with RT/nF at the stated temperature", [
      potentialLabel,
      `T=${plain(temperature)} K`,
      "not 0.059",
      "RT lnQ",
    ], "E = E° − (RT/nF) ln Q with the stated R and F. A temperature other than 298 K does not use 0.059 V.");
  }
  return panel(question, "Nernst equation at 298 K", [
    potentialLabel,
    `Q=${plain(reactionQuotient)}`,
    "RT lnQ",
  ], "E = E° − (RT/nF) ln Q with the stated R and F. Q is not 1, so the logarithm remains.");
}

function buildGibbs(question: string, stem: string): SceneDocument | null {
  if (kFromNonstandardE(stem)) return null;
  const wantsK = asksK(stem);
  const wantsG = asksG(stem);
  if (!wantsK && !wantsG) return null;
  const standardPotential = readE0Values(stem)[0] ?? null;
  if (standardPotential === null) return null;
  const electrons = assigned(stem, "n");
  if (!positiveInteger(electrons)) return null;
  const faraday = readF(stem);
  if (faraday === null) return null;
  const temperature = assigned(stem, "t");
  const gasR = readR(stem);
  if (wantsK && (temperature === null || !(temperature > 0) || gasR === null)) return null;

  // ΔG° = −nFE° and ln K = nFE°/(RT). E° is not scaled by a stoichiometric coefficient.
  const deltaGkJ = (-electrons * faraday * standardPotential) / 1000;
  const labels = [`dGo=${deltaGkJ.toFixed(2)}kJ`];
  if (wantsK && gasR !== null && temperature !== null) {
    const equilibrium = Math.exp((electrons * faraday * standardPotential) / (gasR * temperature));
    if (!Number.isFinite(equilibrium) || !(equilibrium > 0)) return null;
    labels.push(`K=${Number(equilibrium.toPrecision(3))}`);
  }
  labels.push("from E0");
  return panel(question, "standard Gibbs energy and K from E°", labels,
    "ΔG° = −nFE° and ln K = nFE°/(RT), both from the standard potential. K is not computed from a nonstandard E.");
}

/** The label panel, or null when the stem is claimed but not grounded. */
export function buildCellAccountScene(
  question: string,
  _quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  if (!claimsCellAccount(question)) return null;
  const stem = accountStem(question);
  if (ownsReversal(stem)) return buildReversal(question, stem);
  if (ownsNernst(stem) && !asksK(stem)) return buildNernst(question, stem);
  if (ownsGibbs(stem)) return buildGibbs(question, stem);
  if (ownsNernst(stem)) return buildNernst(question, stem);
  if (ownsPolarity(stem)) return buildPolarity(question, stem);
  return null;
}
