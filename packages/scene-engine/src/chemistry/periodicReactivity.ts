/**
 * Distinctions the periodic-trend graph does not draw.
 *
 * Electron-gain enthalpy and Pauling electronegativity disagree for F/Cl and
 * for O/S. Chlorine's electron-gain enthalpy (−349 kJ/mol) is more negative
 * than fluorine's (−328). Fluorine's Pauling electronegativity (3.98) is
 * higher than chlorine's (3.16). A larger electronegativity is not a more
 * negative enthalpy. The six electron-gain values below are the NCERT
 * main-group figures; `ELECTRON_GAIN_ENTHALPY` in periodicTrend.ts is not
 * exported, and no other elements are given a gain enthalpy here.
 *
 * Pauling electronegativity is read from the element table. He, Ne and Ar are
 * null. A null value stays unknown: it is not 0 and it is not interpolated.
 * Kr, Xe and Rn keep whatever the table lists.
 *
 * Valence, oxidation state and reactivity are different. Sodium's valence is
 * its group number, 1, and its oxidation state in NaCl is +1. That oxidation
 * state is not a formal charge. A reaction is named only when the stem states
 * the reactant and the behaviour, and the only behaviour named here is sodium
 * reacting with water. Nothing is inferred from atomic radius.
 *
 * Trend graphs already owned by periodicTrend.ts, including the group-17
 * electronegativity probe and the halogen electron-gain graph, are not claimed.
 */
import type { SceneDocument } from "../types";
import { elementBySymbol } from "./elements";
import { periodicTrendOwnsLegacy, PERIODIC_FAMILY, PERIODIC_PROBES } from "./periodicTrend";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

/** NCERT main-group electron-gain enthalpies, kJ/mol. No other elements. */
const GAIN_KJ: Readonly<Record<string, number>> = {
  F: -328,
  Cl: -349,
  Br: -325,
  I: -295,
  O: -141,
  S: -200,
};

const GAIN_SYMBOLS = ["F", "Cl", "Br", "I", "O", "S"] as const;

const FLUORINE = /\bfluorine\b|\bf\b/;
const CHLORINE = /\bchlorine\b|\bcl\b/;
const OXYGEN = /\boxygen\b|\bo\b/;
const SULFUR = /\bsulphur\b|\bsulfur\b|\bs\b/;
const GAIN = /electron[- ]gain enthalp/;
const EN = /\belectronegativ/;
const CHALCOGEN_SERIES = /\bselenium\b|\btellurium\b|\bse\b|\bte\b/;

const NULL_NOBLES: ReadonlyArray<{ symbol: string; pattern: RegExp }> = [
  { symbol: "He", pattern: /\bhelium\b|\bhe\b/ },
  { symbol: "Ne", pattern: /\bneon\b|\bne\b/ },
  { symbol: "Ar", pattern: /\bargon\b|\bar\b/ },
];

const KNOWN_NOBLES: ReadonlyArray<{ symbol: string; pattern: RegExp }> = [
  { symbol: "Kr", pattern: /\bkrypton\b|\bkr\b/ },
  { symbol: "Xe", pattern: /\bxenon\b|\bxe\b/ },
  { symbol: "Rn", pattern: /\bradon\b|\brn\b/ },
];

const MENTION_PATTERNS: ReadonlyArray<{ symbol: string; pattern: RegExp }> = [
  { symbol: "F", pattern: FLUORINE },
  { symbol: "Cl", pattern: CHLORINE },
  { symbol: "Br", pattern: /\bbromine\b|\bbr\b/ },
  { symbol: "I", pattern: /\biodine\b|\bi\b/ },
  { symbol: "O", pattern: OXYGEN },
  { symbol: "S", pattern: SULFUR },
  ...NULL_NOBLES,
  ...KNOWN_NOBLES,
];

interface Mention {
  symbol: string;
  index: number;
  length: number;
}

interface StemNumber {
  value: number;
  raw: string;
  index: number;
}

type PairId = "FCl" | "OS";

const PAIRS: Readonly<Record<PairId, { left: string; right: string; leftPattern: RegExp; rightPattern: RegExp }>> = {
  FCl: { left: "F", right: "Cl", leftPattern: FLUORINE, rightPattern: CHLORINE },
  OS: { left: "O", right: "S", leftPattern: OXYGEN, rightPattern: SULFUR },
};

function has(stem: string, pattern: RegExp): boolean {
  return new RegExp(pattern.source, pattern.flags.replace("g", "")).test(stem);
}

function firstIndex(stem: string, pattern: RegExp): number {
  const match = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(stem);
  return match?.index ?? Number.POSITIVE_INFINITY;
}

function findAll(stem: string, pattern: RegExp): Array<{ index: number; length: number }> {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  return [...stem.matchAll(re)].map((match) => ({ index: match.index ?? 0, length: match[0].length }));
}

function probeKey(text: string): string {
  return chemStem(text).replace(/[^a-z0-9]+/g, " ").trim();
}

function isProbeQuestion(question: string): boolean {
  const key = probeKey(question);
  return PERIODIC_PROBES.some((probe) => probeKey(probe.question) === key);
}

function mentionsSodium(stem: string): boolean {
  return /\bsodium\b|\bna\b/.test(stem);
}

function mentionsNaCl(stem: string): boolean {
  return /\bnacl\b|\bsodium chloride\b/.test(stem);
}

function mentionsReactivity(stem: string): boolean {
  return /\breactiv|\breacts?\b|\breaction\b/.test(stem);
}

function namedNullNobles(stem: string): string[] {
  const found: string[] = [];
  for (const entry of NULL_NOBLES) {
    if (!has(stem, entry.pattern)) continue;
    const element = elementBySymbol(entry.symbol);
    if (!element || element.electronegativity !== null) continue;
    found.push(entry.symbol);
  }
  return found;
}

function namesKnownNoble(stem: string): boolean {
  return KNOWN_NOBLES.some((entry) => has(stem, entry.pattern));
}

function whichPair(stem: string): PairId | null {
  const fcl = has(stem, FLUORINE) && has(stem, CHLORINE);
  const os = has(stem, OXYGEN) && has(stem, SULFUR);
  if (fcl && os) return firstIndex(stem, FLUORINE) <= firstIndex(stem, OXYGEN) ? "FCl" : "OS";
  if (fcl) return "FCl";
  if (os) return "OS";
  return null;
}

/** Both quantities, for a pair whose orderings disagree. Se/Te stay on the trend graph. */
function gainEnCue(stem: string): boolean {
  if (!has(stem, GAIN) || !has(stem, EN)) return false;
  const pair = whichPair(stem);
  if (pair === "FCl") return true;
  return pair === "OS" && !has(stem, CHALCOGEN_SERIES);
}

const NOBLE_CLASS = /\bnoble gases\b|\binert gases\b/;
const FILLED_UNKNOWN = /\bunknown\b|\bzero\b|\bno value\b|\bnot (?:listed|given|defined)\b|\binterpolat|\bto 0\b|\bequals 0\b|\bis 0\b|\b0\b/;

function nobleEnCue(stem: string): boolean {
  if (!has(stem, EN)) return false;
  if (namedNullNobles(stem).length > 0) return true;
  if (namesKnownNoble(stem) && has(stem, FILLED_UNKNOWN)) return true;
  if (has(stem, NOBLE_CLASS) && has(stem, FILLED_UNKNOWN)) return true;
  return false;
}

function isRedoxAssignment(stem: string): boolean {
  return /\bh2so4\b|\bsulfuric\b|\bh2o2\b|\bperoxide\b|\bsuperoxide\b|\bko2\b|\bfe3o4\b|\bmno4\b|\bpermanganate\b|\bcr2o7\b|\bdichromate\b|\boxidation number of s\b/.test(stem);
}

/** A stem that asks for reactivity from radius, rather than refusing that inference. */
function infersReactivityFromRadius(stem: string): boolean {
  if (!mentionsReactivity(stem) || !/\bradi/.test(stem)) return false;
  if (/\bdo not infer\b|\bdon't infer\b|\bnot inferred\b|\bcannot be inferred\b|\bnot read from\b/.test(stem)) return false;
  return /\binfer\b|\bdeduc|\bsolely\b|\buniversal\b|\ball (?:the |chemical )?reactiv|\breactivity arrow\b|\barrow from\b|\bfrom (?:the |their |its )?atomic radi/.test(stem);
}

function valenceReactivityCue(stem: string): boolean {
  if (isRedoxAssignment(stem)) return false;
  if (infersReactivityFromRadius(stem)) return true;
  const valence = /\bvalenc/.test(stem);
  const oxidation = /oxidation (?:state|number)/.test(stem);
  const reactivity = mentionsReactivity(stem);
  if (valence && (oxidation || reactivity || mentionsNaCl(stem))) return true;
  if (oxidation && mentionsNaCl(stem) && mentionsSodium(stem)) return true;
  if (reactivity && mentionsSodium(stem) && /\bwater\b|\bh2o\b/.test(stem)) return true;
  return false;
}

function ownsDistinction(stem: string): boolean {
  return gainEnCue(stem) || nobleEnCue(stem) || valenceReactivityCue(stem);
}

/** True when this module owns the stem, including stems it must decline. */
export function claimsPeriodicReactivity(question: string): boolean {
  const stem = chemStem(question);
  if (!stem) return false;
  if (isProbeQuestion(question)) return false;
  if (periodicTrendOwnsLegacy(question) && !ownsDistinction(stem)) return false;
  return ownsDistinction(stem);
}

function instructionRefuses(stem: string, index: number): boolean {
  const prior = stem.slice(Math.max(0, index - 80), index);
  return /\bdo not\b|\bdon't\b|\bnever\b|\bunknown\b|\bnot\b/.test(prior);
}

function collectMentions(stem: string): Mention[] {
  const found: Mention[] = [];
  for (const entry of MENTION_PATTERNS) {
    for (const hit of findAll(stem, entry.pattern)) found.push({ symbol: entry.symbol, index: hit.index, length: hit.length });
  }
  return found;
}

function collectNumbers(stem: string): StemNumber[] {
  return [...stem.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => ({
    value: Number(match[0]),
    raw: match[0],
    index: match.index ?? 0,
  }));
}

function closestMention(mentions: readonly Mention[], index: number, window: number): Mention | null {
  let best: Mention | null = null;
  let bestDistance = window + 1;
  for (const mention of mentions) {
    const end = mention.index + mention.length;
    const distance = index < mention.index ? mention.index - index : index >= end ? index - end : 0;
    if (distance < bestDistance) {
      best = mention;
      bestDistance = distance;
    }
  }
  return best;
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-6;
}

function looksLikeEn(raw: string, value: number): boolean {
  return raw.includes(".") && value > 0 && value <= 4;
}

function isGainMagnitude(raw: string, value: number): boolean {
  if (raw.includes(".")) return false;
  const magnitude = Math.abs(value);
  return magnitude >= 100 && magnitude <= 400;
}

function trackedEnValues(): number[] {
  const values: number[] = [];
  for (const symbol of GAIN_SYMBOLS) {
    const en = elementBySymbol(symbol)?.electronegativity;
    if (en !== null && en !== undefined) values.push(en);
  }
  return values;
}

/** A stated number that contradicts the table, or fills a null electronegativity. */
function assignmentConflicts(symbol: string, value: number, raw: string): boolean {
  const gain = GAIN_KJ[symbol];
  const en = elementBySymbol(symbol)?.electronegativity ?? null;
  if (gain !== undefined && sameNumber(value, gain)) return false;
  if (en !== null && sameNumber(value, en)) return false;
  if (value === 0) return true;
  if (looksLikeEn(raw, value)) return en === null || !sameNumber(value, en);
  if (gain !== undefined && isGainMagnitude(raw, value)) {
    return !sameNumber(Math.abs(value), Math.abs(gain));
  }
  if (value < 0 && gain !== undefined) return true;
  return trackedEnValues().some((candidate) => sameNumber(value, candidate));
}

function contradictsNumbers(stem: string): boolean {
  const mentions = collectMentions(stem);
  for (const number of collectNumbers(stem)) {
    if (instructionRefuses(stem, number.index)) continue;
    const mention = closestMention(mentions, number.index, 28);
    if (!mention) continue;
    const previous = stem[number.index - 1] ?? "";
    if (previous === "+" && isGainMagnitude(number.raw, number.value)) return true;
    if (assignmentConflicts(mention.symbol, number.value, number.raw)) return true;
  }
  return false;
}

function saysMoreNegativeThan(stem: string, subject: RegExp, other: RegExp): boolean {
  for (const hit of findAll(stem, subject)) {
    const slice = stem.slice(hit.index + hit.length, hit.index + hit.length + 110);
    const negative = /more negative/.exec(slice);
    if (!negative || negative.index === undefined) continue;
    const gap = slice.slice(0, negative.index);
    if (has(gap, other)) continue;
    if (has(slice.slice(negative.index + negative[0].length), other)) return true;
  }
  return false;
}

function saysHigherEnThan(stem: string, subject: RegExp, other: RegExp): boolean {
  for (const hit of findAll(stem, subject)) {
    const slice = stem.slice(hit.index + hit.length, hit.index + hit.length + 120);
    const higher = /(?:higher|greater|larger|more)(?:\s+\w+){0,4}\s+electronegativ/.exec(slice);
    if (!higher || higher.index === undefined) continue;
    const gap = slice.slice(0, higher.index);
    if (has(gap, other)) continue;
    if (has(slice.slice(higher.index + higher[0].length), other)) return true;
  }
  return false;
}

function wrongPairOrder(stem: string, pair: PairId): boolean {
  const spec = PAIRS[pair];
  return saysMoreNegativeThan(stem, spec.leftPattern, spec.rightPattern)
    || saysHigherEnThan(stem, spec.rightPattern, spec.leftPattern);
}

/** The false rule that a larger electronegativity is the more negative enthalpy. */
function treatsEnAsGain(stem: string): boolean {
  if (/\bdo not\b|\bdon't\b|\balthough\b|\beven though\b|\bwhereas\b|\bhowever\b|\bdistinguish\b|\bcontrast\b|\bunlike\b|\bnot the same\b/.test(stem)) {
    return false;
  }
  return /(?:larger|higher|greater) electronegativ[\s\S]{0,48}more negative/.test(stem)
    || /more negative[\s\S]{0,48}(?:larger|higher|greater) electronegativ/.test(stem);
}

function swappedConvention(stem: string): boolean {
  if (treatsEnAsGain(stem)) return true;
  if (has(stem, FLUORINE) && has(stem, CHLORINE) && wrongPairOrder(stem, "FCl")) return true;
  if (has(stem, OXYGEN) && has(stem, SULFUR) && wrongPairOrder(stem, "OS")) return true;
  return false;
}

function asksToGuess(stem: string): boolean {
  const request = /\binterpolat|\bguess(?:ed)?\b|\bfill in\b|\bestimate\b/.exec(stem);
  if (!request || request.index === undefined) return false;
  if (instructionRefuses(stem, request.index)) return false;
  return namedNullNobles(stem).length > 0 || namesKnownNoble(stem) || /\bnoble gases\b|\binert gases\b/.test(stem);
}

function classBlanket(stem: string): boolean {
  if (!has(stem, NOBLE_CLASS)) return false;
  const restricted = namedNullNobles(stem).length > 0 && !/\ball\b|\bevery\b/.test(stem);
  if (restricted) return false;
  return has(stem, FILLED_UNKNOWN);
}

function misstatesKnownNoble(stem: string): boolean {
  if (!has(stem, FILLED_UNKNOWN)) return false;
  return KNOWN_NOBLES.some((entry) => {
    if (!has(stem, entry.pattern)) return false;
    const en = elementBySymbol(entry.symbol)?.electronegativity;
    return en !== null && en !== undefined;
  });
}

function wantsReactivityArrow(stem: string): boolean {
  if (/\bdo not\b[\s\S]{0,40}\barrow\b|\bno arrow\b|\bnot an arrow\b/.test(stem)) return false;
  return /\barrow\b/.test(stem) && (mentionsReactivity(stem) || /\bradi/.test(stem));
}

function equatesOxidationWithFormalCharge(stem: string): boolean {
  if (!/\bformal charge\b/.test(stem)) return false;
  if (/\bnot\b[\s\S]{0,40}\bformal charge\b|\bformal charge\b[\s\S]{0,24}\bnot\b|\bnot formal\b/.test(stem)) return false;
  return /\bsame\b|\bequal|\bas the formal\b|\bis the formal\b|\bidentical\b|\bone quantity\b/.test(stem);
}

function sodiumValenceClaim(stem: string): number | null {
  const match = /\bvalenc\w*(?: of (?:sodium|\bna\b))?(?: is| =| of)?\s*(\d+)/.exec(stem)
    ?? /(?:sodium|\bna\b) has valenc\w*\s*(\d+)/.exec(stem);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function sodiumOxidationClaim(stem: string): number | null {
  const match = /oxidation (?:state|number)(?: of (?:sodium|\bna\b))?(?: in nacl| in sodium chloride)?(?: is| =| of)?\s*([+-]?\d+)/.exec(stem)
    ?? /(?:sodium|\bna\b)(?: in nacl| in sodium chloride)? has oxidation (?:state|number)\s*([+-]?\d+)/.exec(stem);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function sodiumGroup(): number | null {
  const sodium = elementBySymbol("Na");
  if (!sodium || sodium.group !== 1) return null;
  return sodium.group;
}

function unsupportedSodiumClaim(stem: string): boolean {
  const group = sodiumGroup();
  if (group === null) return true;
  const valence = sodiumValenceClaim(stem);
  if (valence !== null && valence !== group) return true;
  const oxidation = sodiumOxidationClaim(stem);
  if (oxidation !== null && oxidation !== group) return true;
  if (/oxidation (?:state|number) of (?:chlorine|\bcl\b|oxygen|sulphur|sulfur|iron|\bfe\b|carbon|nitrogen|hydrogen)\b/.test(stem)) {
    return true;
  }
  return false;
}

function sodiumReactsWithWater(stem: string): boolean {
  if (/\b(?:does not|doesn't|do not|don't|will not|won't|never)\s+react/.test(stem)) return false;
  if (/\bno reaction\b/.test(stem)) return false;
  const forward = /\b(?:sodium|\bna\b)\b([\s\S]{0,40}?)\b(?:reacts?|reaction)\b([\s\S]{0,30}?)\bwith\b([\s\S]{0,20}?)\b(?:water|h2o)\b/.exec(stem);
  if (forward) {
    const between = `${forward[1] ?? ""} ${forward[2] ?? ""} ${forward[3] ?? ""}`;
    if (!/\bchloride\b|\bnacl\b|\bion\b|\bhydroxide\b/.test(between)) return true;
  }
  return /\breaction of (?:sodium|\bna\b)\b[\s\S]{0,24}?\bwith\b[\s\S]{0,16}?\b(?:water|h2o)\b/.test(stem);
}

interface QuantitySpec {
  id: string;
  symbol: string;
  value: number;
  unit: string;
}

function board(
  question: string,
  reason: string,
  labels: readonly string[],
  caption: string,
  quantities: readonly QuantitySpec[],
): SceneDocument | null {
  if (labels.length === 0 || labels.length > 6) return null;
  if (labels.some((label) => label.length === 0 || label.length > 16)) return null;
  const scene = new ChemScene(question, reason, PERIODIC_FAMILY);
  const ids = labels.map((label, index) => scene.text(`row_${index}`, { x: 0.2, y: 2.6 - index * 0.8 }, label, "periodicity line"));
  for (const quantity of quantities) scene.scene.quantity(quantity.id, quantity.symbol, quantity.value, quantity.unit);
  scene.scene.group("board", ids, `${reason}. ${labels.join(", ")}.`);
  return scene.build({ caption });
}

interface PairFacts {
  left: string;
  right: string;
  gainLeft: number;
  gainRight: number;
  enLeft: number;
  enRight: number;
}

/**
 * The right-hand element has the more negative electron-gain enthalpy.
 * The left-hand element has the higher Pauling electronegativity.
 * If the table does not disagree in that way, there is no figure.
 */
function pairFacts(pair: PairId): PairFacts | null {
  const spec = PAIRS[pair];
  const gainLeft = GAIN_KJ[spec.left];
  const gainRight = GAIN_KJ[spec.right];
  const enLeft = elementBySymbol(spec.left)?.electronegativity ?? null;
  const enRight = elementBySymbol(spec.right)?.electronegativity ?? null;
  if (gainLeft === undefined || gainRight === undefined || enLeft === null || enRight === null) return null;
  if (!(gainRight < gainLeft)) return null;
  if (!(enLeft > enRight)) return null;
  return { left: spec.left, right: spec.right, gainLeft, gainRight, enLeft, enRight };
}

function enText(value: number): string {
  return value.toFixed(2);
}

function drawPair(question: string, pair: PairId): SceneDocument | null {
  const facts = pairFacts(pair);
  if (!facts) return null;
  const moreNegative = `${facts.right} more -`;
  const higherEn = `${facts.left} higher EN`;
  const labels = [
    `${facts.left} egH ${facts.gainLeft}`,
    `${facts.right} egH ${facts.gainRight}`,
    moreNegative,
    `${facts.left} EN ${enText(facts.enLeft)}`,
    `${facts.right} EN ${enText(facts.enRight)}`,
    higherEn,
  ];
  const caption = `Electron-gain enthalpy of ${facts.right} (${facts.gainRight} kJ/mol) is more negative than ${facts.left} (${facts.gainLeft} kJ/mol). Pauling electronegativity of ${facts.left} (${enText(facts.enLeft)}) is higher than ${facts.right} (${enText(facts.enRight)}). A larger Pauling electronegativity is not a more negative electron-gain enthalpy.`;
  return board(question, "electron-gain enthalpy is not Pauling electronegativity", labels, caption, [
    { id: `egh_${facts.left}`, symbol: `egh(${facts.left})`, value: facts.gainLeft, unit: "kJ/mol" },
    { id: `egh_${facts.right}`, symbol: `egh(${facts.right})`, value: facts.gainRight, unit: "kJ/mol" },
    { id: `en_${facts.left}`, symbol: `EN(${facts.left})`, value: facts.enLeft, unit: "" },
    { id: `en_${facts.right}`, symbol: `EN(${facts.right})`, value: facts.enRight, unit: "" },
  ]);
}

function drawUnknown(question: string, stem: string): SceneDocument | null {
  const symbols = namedNullNobles(stem);
  if (symbols.length === 0) return null;
  const labels = [...symbols.map((symbol) => `${symbol} unknown`), "not 0", "no guess"];
  const names = symbols.join(", ");
  const caption = `Pauling electronegativity of ${names} is null in the element table. Unknown stays unknown: it is not 0, and it is not interpolated.`;
  return board(question, "unknown electronegativity stays unknown", labels, caption, []);
}

function drawValence(question: string, stem: string): SceneDocument | null {
  const group = sodiumGroup();
  if (group === null) return null;
  const wantsValence = /\bvalenc/.test(stem);
  const wantsOxidation = /oxidation (?:state|number)/.test(stem) && mentionsNaCl(stem) && mentionsSodium(stem);
  const water = sodiumReactsWithWater(stem);
  if (!wantsValence && !wantsOxidation && !water) return null;
  const labels: string[] = [];
  const quantities: QuantitySpec[] = [];
  if (wantsValence) {
    labels.push(`valence ${group}`);
    quantities.push({ id: "valence_Na", symbol: "valence(Na)", value: group, unit: "" });
  }
  if (wantsOxidation) {
    labels.push(`Na ox +${group}`, "not formal");
    quantities.push({ id: "ox_Na", symbol: "ox(Na,NaCl)", value: group, unit: "" });
  }
  if (water) labels.push("Na + water");
  else if (mentionsReactivity(stem)) labels.push("not reaction");
  if (water && /\bradi/.test(stem)) labels.push("not radius");
  const parts: string[] = [];
  if (wantsValence) parts.push(`Sodium is group ${group}, so its valence is ${group}.`);
  if (wantsOxidation) parts.push(`In NaCl its oxidation state is +${group}. Oxidation state is not formal charge.`);
  parts.push(water
    ? "The stem states that sodium reacts with water."
    : "No reactant is stated, so no reaction is named.");
  parts.push("Reactivity is not read from atomic radius.");
  return board(question, "valence, oxidation state and reactivity are different", labels, parts.join(" "), quantities);
}

/** The figure, or null when the stem is not owned or cannot be grounded. */
export function buildPeriodicReactivityScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void quantities;
  void schematic;
  if (!claimsPeriodicReactivity(question)) return null;
  const stem = chemStem(question);
  if (infersReactivityFromRadius(stem) || wantsReactivityArrow(stem)) return null;
  if (asksToGuess(stem) || classBlanket(stem) || misstatesKnownNoble(stem) || contradictsNumbers(stem)) return null;
  if (swappedConvention(stem)) return null;
  if (equatesOxidationWithFormalCharge(stem)) return null;
  if (valenceReactivityCue(stem) && unsupportedSodiumClaim(stem)) return null;
  try {
    if (gainEnCue(stem)) {
      const pair = whichPair(stem);
      if (pair) {
        const drawn = drawPair(question, pair);
        if (drawn) return drawn;
      }
    }
    if (nobleEnCue(stem)) {
      const drawn = drawUnknown(question, stem);
      if (drawn) return drawn;
    }
    if (valenceReactivityCue(stem)) return drawValence(question, stem);
    return null;
  } catch {
    return null;
  }
}
