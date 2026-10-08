/**
 * Source-grounded equilibrium-constant figures: ideal-gas Kp from Kc,
 * heterogeneous omission of pure solids and liquids, a 1:1 extent with
 * nonnegative amounts, and the reaction Gibbs energy ΔG = ΔG° + RT ln Q.
 *
 * Q = K makes the reaction ΔG zero. It does not make ΔG° zero, and this
 * ΔG is not the total Gibbs energy of the system. ΔG° = −RT ln K with no
 * Q and no extent stays with chemical thermodynamics. A missing R, a
 * nonpositive Kc or Q, or an extent past the available amount draws nothing.
 */
import type { SceneDocument } from "../types";
import { normalizeChemistryText } from "./formula";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_kinetics" as const;
const R_J = 8.314;

type Phase = "s" | "l" | "g" | "aq";

interface Species {
  coeff: number;
  formula: string;
  phase: Phase | null;
}

interface Reaction {
  reactants: Species[];
  products: Species[];
}

type Quotient = { kind: "equilibrium" } | { kind: "value"; value: number } | "nonpositive";

function shown(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const text = String(Number(value.toPrecision(3)));
  return text.length > 0 ? text : null;
}

function phaseOf(token: string | undefined): Phase | null {
  if (token === "s" || token === "l" || token === "g" || token === "aq") return token;
  return null;
}

function readSpecies(text: string): { species: Species; rest: string } | null {
  const match = /^(\d+(?:\.\d+)?)?\s*([A-Z][A-Za-z0-9]*)\s*(?:\((s|l|g|aq)\))?/.exec(text);
  if (!match?.[2]) return null;
  const coeff = match[1] === undefined ? 1 : Number(match[1]);
  if (!(coeff > 0)) return null;
  return {
    species: { coeff, formula: match[2], phase: phaseOf(match[3]) },
    rest: text.slice(match[0].length),
  };
}

/** Products begin at the arrow. A "+" that is not followed by a species is rejected. */
function parseProductSide(text: string): Species[] | null {
  const species: Species[] = [];
  let rest = text.trim();
  let expect = true;
  while (expect) {
    const read = readSpecies(rest);
    if (!read) return null;
    species.push(read.species);
    rest = read.rest.trim();
    if (rest.startsWith("+")) {
      rest = rest.slice(1).trim();
      continue;
    }
    expect = false;
  }
  return species;
}

/**
 * Reactants end at the arrow. Prose may precede the first species.
 * A non-species term between two species rejects the reaction.
 */
function parseReactantSide(text: string): Species[] | null {
  const chunks = text.split("+");
  const species: Species[] = [];
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]?.trim() ?? "";
    const end = /(?:(\d+(?:\.\d+)?)\s*)?([A-Z][A-Za-z0-9]*)(?:\((s|l|g|aq)\))?$/.exec(chunk);
    if (!end?.[2]) {
      if (index === 0 && species.length > 0) return species;
      return null;
    }
    const coeff = end[1] === undefined ? 1 : Number(end[1]);
    if (!(coeff > 0)) return null;
    species.unshift({ coeff, formula: end[2], phase: phaseOf(end[3]) });
    const prefix = chunk.slice(0, end.index).trim();
    if (prefix.length > 0) return species;
  }
  return species.length > 0 ? species : null;
}

function parseReaction(formulaText: string): Reaction | null {
  const at = formulaText.indexOf(" <=> ");
  if (at < 0) return null;
  const reactants = parseReactantSide(formulaText.slice(0, at));
  const products = parseProductSide(formulaText.slice(at + " <=> ".length));
  if (!reactants || !products) return null;
  return { reactants, products };
}

/** If any phase is written, only (g) counts. Otherwise every species is gas. */
function gasDeltaN(reaction: Reaction): number {
  const all = [...reaction.reactants, ...reaction.products];
  const phased = all.some((species) => species.phase !== null);
  const moles = (side: readonly Species[]): number => side.reduce((sum, species) => {
    if (phased && species.phase !== "g") return sum;
    return sum + species.coeff;
  }, 0);
  return moles(reaction.products) - moles(reaction.reactants);
}

function signedNumber(match: RegExpMatchArray | null): number | null {
  if (!match?.[1]) return null;
  const mantissa = Number(match[1]);
  if (!Number.isFinite(mantissa)) return null;
  if (match[2] === undefined) return mantissa;
  const exponent = Number(match[2]);
  if (!Number.isFinite(exponent)) return null;
  return mantissa * 10 ** exponent;
}

const SIGNED = String.raw`([+-]?\d+(?:\.\d+)?)(?:\s*[×x*]\s*10\^?\(?\s*([+-]?\d+)\s*\)?)?`;

function statedKc(stem: string): number | null {
  return signedNumber(new RegExp(String.raw`\bk_?c\s*(?:=|is|equals)\s*${SIGNED}`).exec(stem));
}

function statedR(stem: string): number | null {
  const match = /\br\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)/.exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Kelvin only. The K in kJ or in J/mol K is not a temperature: it is not a bare number followed by K. */
function kelvinTemperature(stem: string): number | null {
  const named = /\btemperature\s*(?:=|is|equals|of)\s*(\d+(?:\.\d+)?)\s*k(?:elvin)?\b/.exec(stem)
    ?? /\bt\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)\s*k(?:elvin)?\b/.exec(stem)
    ?? /\bat\s+(\d+(?:\.\d+)?)\s*k(?:elvin)?\b/.exec(stem);
  if (named?.[1]) {
    const namedValue = Number(named[1]);
    return Number.isFinite(namedValue) ? namedValue : null;
  }
  for (const match of stem.matchAll(/(?:^|[^\w/])(\d+(?:\.\d+)?)\s*k(?:elvin)?\b/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function idealGas(stem: string): boolean {
  return /ideal[\s-]*gas|\bgases?\b[^.]{0,32}\bideal\b|\bideal\b[^.]{0,32}\bgases?\b/.test(stem);
}

function concentrationTimeGraph(stem: string): boolean {
  return /concentration[^.]{0,48}(?:vs\.?|versus|against|with)\s*(?:time|\bt\b)|(?:vs\.?|versus|against)\s*(?:time|\bt\b)[^.]{0,48}concentration|\[\s*[a-z0-9]+\s*\][^.]{0,24}(?:vs\.?|versus|against)\s*(?:time|\bt\b)|concentration[-\s]time|variation[^.]{0,40}concentration[^.]{0,40}time/.test(stem);
}

function hardVeto(stem: string): boolean {
  if (/le\s*chatelier/.test(stem)) return true;
  if (/\bshifts?\b/.test(stem)) return true;
  if (/catalyst|catalysis|cataly[sz]ed/.test(stem)) return true;
  if (/inert gas/.test(stem)) return true;
  return concentrationTimeGraph(stem);
}

function standardGibbsCue(stem: string): boolean {
  return /(?:δ|∆|Δ)\s*g\s*[°º˚∘]|delta\s*g\s*[°º˚∘]|standard gibbs/.test(stem);
}

/** The misconception that equilibrium forces ΔG° itself to zero. */
function standardZeroMisconception(stem: string): boolean {
  if (!/equilibrium/.test(stem) || !standardGibbsCue(stem)) return false;
  return /must be\s*(?:0|zero)|must equal\s*(?:0|zero)|necessarily\s*(?:0|zero)/.test(stem);
}

/** Thermo already owns ΔG° = −RT ln K when the stem never mentions Q or extent. */
function pureStandardRelation(stem: string): boolean {
  if (/\bq\b|reaction quotient|\bextent\b/.test(stem)) return false;
  return standardGibbsCue(stem) && /ln\s*k|equilibrium constant|-?\s*rt\s*ln/.test(stem);
}

function asksKpKc(stem: string): boolean {
  return /\bk_?p\b/.test(stem) && /\bk_?c\b/.test(stem);
}

function asksHeterogeneous(stem: string): boolean {
  const condensed = /\([sl]\)|\bsolids?\b|\bliquids?\b/.test(stem);
  const constant = /\bk_?[cp]\b/.test(stem);
  const topic = /omit|activit|heterogen|\bpure\b|\binclude\b/.test(stem);
  return condensed && constant && topic;
}

function asksExtent(stem: string): boolean {
  return /\bextent\b/.test(stem) && /equilibrium|k_?c|\bmol\b|reaction/.test(stem);
}

function asksReactionGibbs(stem: string): boolean {
  const quotient = /\bq\b|reaction quotient/.test(stem);
  const gibbs = /(?:δ|∆|Δ)\s*g\b|delta\s*g\b|gibbs/.test(stem);
  return quotient && gibbs;
}

function dynamicWithoutAsk(stem: string): boolean {
  if (!/dynamic equilibrium/.test(stem)) return false;
  return !asksKpKc(stem) && !asksHeterogeneous(stem) && !asksExtent(stem) && !asksReactionGibbs(stem) && !standardZeroMisconception(stem);
}

/** True when this chapter should own the stem, including honest declines. */
export function claimsEquilibriumConstants(question: string): boolean {
  const stem = chemStem(question);
  if (hardVeto(stem)) return false;
  if (standardZeroMisconception(stem)) return true;
  if (pureStandardRelation(stem)) return false;
  if (dynamicWithoutAsk(stem)) return false;
  return asksKpKc(stem) || asksHeterogeneous(stem) || asksExtent(stem) || asksReactionGibbs(stem);
}

function finish(question: string, reason: string, labels: readonly string[], caption: string): SceneDocument | null {
  if (labels.length === 0 || labels.length > 6) return null;
  if (labels.some((label) => label.length === 0 || label.length > 16)) return null;
  const scene = new ChemScene(question, reason, FAMILY);
  const ids = labels.map((label, index) => scene.text(`v${index}`, { x: 0.2, y: 2.6 - index * 0.8 }, label, "equilibrium result"));
  scene.scene.group("result", ids, reason);
  return scene.build({ caption });
}

function buildKpKc(question: string, stem: string, formulaText: string): SceneDocument | null {
  if (!idealGas(stem)) return null;
  const kc = statedKc(stem);
  if (kc === null || !(kc > 0)) return null;
  const temperature = kelvinTemperature(stem);
  if (temperature === null || !(temperature > 0)) return null;
  const gasR = statedR(stem);
  if (gasR === null || !(gasR > 0)) return null;
  const reaction = parseReaction(formulaText);
  if (!reaction) return null;
  const delta = gasDeltaN(reaction);
  const kp = kc * (gasR * temperature) ** delta;
  if (!Number.isFinite(kp) || !(kp > 0)) return null;
  const kpText = shown(kp);
  const deltaText = shown(delta);
  const kcText = shown(kc);
  if (kpText === null || deltaText === null || kcText === null) return null;
  return finish(question, "ideal-gas conversion of Kc to Kp", [
    `Kp=${kpText}`,
    `dN=${deltaText}`,
    `Kc=${kcText}`,
    "ideal gas",
  ], "Kp = Kc (RT)^Δn for an ideal gas. Δn is gaseous product moles minus gaseous reactant moles. R and T are the values stated in the stem. No gas constant is supplied when the stem omits it.");
}

function instructsIncludeCondensed(stem: string): boolean {
  return /include[^.]{0,80}(?:concentration|activity)[^.]{0,48}(?:\([sl]\)|solid|liquid)/.test(stem)
    || /include[^.]{0,48}\([sl]\)/.test(stem);
}

function omitsCondensed(stem: string): boolean {
  return /omitt?ed|\bomit\b|left out|excluded/.test(stem) || /activit(?:y|ies)[^.]{0,32}\b1\b/.test(stem);
}

function directKpBar(stem: string): number | null {
  const match = /\bk_?p\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)\s*bar\b/.exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function barPressure(stem: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*bar\b/.exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function buildHeterogeneous(question: string, stem: string, formulaText: string): SceneDocument | null {
  if (instructsIncludeCondensed(stem)) return null;
  if (!omitsCondensed(stem)) return null;
  const reaction = parseReaction(formulaText);
  if (!reaction) return null;
  const all = [...reaction.reactants, ...reaction.products];
  const solids = all.filter((species) => species.phase === "s");
  const liquids = all.filter((species) => species.phase === "l");
  const gases = all.filter((species) => species.phase === "g");
  if (solids.length + liquids.length === 0) return null;
  const direct = directKpBar(stem);
  const productGas = reaction.products.filter((species) => species.phase === "g");
  const pressure = barPressure(stem);
  const fromPressure = /k_?p\s*(?:=|equals|is)\s*(?:the\s+)?pressure/.test(stem)
    && gases.length === 1
    && productGas.length === 1
    && productGas[0]?.coeff === 1
    && pressure !== null
    && pressure > 0
    ? pressure
    : null;
  const kp = direct ?? fromPressure;
  if (kp === null || !(kp > 0)) return null;
  const kpText = shown(kp);
  if (kpText === null) return null;
  const labels = [`Kp=${kpText} bar`];
  if (solids.length > 0) labels.push("solids a=1", "omit solid");
  if (liquids.length > 0) labels.push("liquids a=1", "omit liquid");
  return finish(question, "heterogeneous equilibrium omits pure solids and liquids", labels, "A pure solid or liquid has activity 1 and is omitted from K. When the only remaining species is one gas of coefficient 1, Kp equals that gas pressure in bar. The concentration of a pure solid is not put into Kc.");
}

function moleAmounts(formulaText: string): Map<string, number> {
  const amounts = new Map<string, number>();
  const pattern = /(\d+(?:\.\d+)?)\s*mol(?:e|es)?\s+of\s+([A-Za-z][A-Za-z0-9]*)/g;
  for (const match of formulaText.matchAll(pattern)) {
    const formula = match[2];
    const value = Number(match[1]);
    if (formula && Number.isFinite(value)) amounts.set(formula.toLowerCase(), value);
  }
  return amounts;
}

function statedExtentMol(stem: string): number | null {
  const match = /\bextent\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)\s*mol\b/.exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function vesselLitres(formulaText: string): number | null {
  const vessel = /(\d+(?:\.\d+)?)\s*L(?:itres?|iters?)?\s*(?:vessel|container|flask|bulb)/i.exec(formulaText);
  const named = /(?:volume|vessel|container|flask|bulb)\s*(?:of|is|=|:)?\s*(\d+(?:\.\d+)?)\s*L\b/i.exec(formulaText);
  const symbol = /\bV\s*=\s*(\d+(?:\.\d+)?)\s*L\b/.exec(formulaText);
  const raw = vessel?.[1] ?? named?.[1] ?? symbol?.[1];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildExtent(question: string, stem: string, formulaText: string): SceneDocument | null {
  const reaction = parseReaction(formulaText);
  if (!reaction || reaction.reactants.length !== 1 || reaction.products.length !== 1) return null;
  const reactant = reaction.reactants[0];
  const product = reaction.products[0];
  if (!reactant || !product || reactant.coeff !== 1 || product.coeff !== 1) return null;
  const amounts = moleAmounts(formulaText);
  const nA = amounts.get(reactant.formula.toLowerCase());
  const nB = amounts.get(product.formula.toLowerCase());
  if (nA === undefined || nB === undefined || nA < 0 || nB < 0) return null;
  const stated = statedExtentMol(stem);
  if (stated !== null && !(stated >= 0 && stated <= nA + 1e-9)) return null;
  const kc = statedKc(stem);
  if (kc === null || !(kc > 0)) return null;
  const extent = (kc * nA - nB) / (1 + kc);
  if (!Number.isFinite(extent) || extent < -1e-9 || extent > nA + 1e-9) return null;
  if (stated !== null && Math.abs(stated - extent) > 1e-6 * Math.max(1, nA)) return null;
  const volume = vesselLitres(formulaText);
  if (volume === null || !(volume > 0)) return null;
  const eqA = (nA - extent) / volume;
  const eqB = (nB + extent) / volume;
  if (eqA < -1e-9 || eqB < -1e-9) return null;
  const extentText = shown(extent);
  const aText = shown(Math.max(0, eqA));
  const bText = shown(Math.max(0, eqB));
  if (extentText === null || aText === null || bText === null) return null;
  return finish(question, "equilibrium extent for a 1:1 reaction", [
    `x=${extentText} mol`,
    "Q=K",
    `[${reactant.formula}]=${aText}`,
    `[${product.formula}]=${bText}`,
  ], "For A <=> B, Kc = (nB + x) / (nA - x). The extent x stays between 0 and nA, so every amount is nonnegative. At equilibrium Q = K. Concentrations use the stated vessel volume.");
}

function standardGibbsKj(stem: string): number | null {
  const match = new RegExp(String.raw`(?:(?:δ|∆|Δ)\s*g\s*[°º˚∘]|delta\s*g\s*[°º˚∘]|standard gibbs(?:\s+energy)?(?:\s+change)?)\s*(?:=|is|equals|of)\s*${SIGNED}\s*(kj|j)\b`).exec(stem);
  const value = signedNumber(match);
  const unit = match?.[3];
  if (value === null || (unit !== "kj" && unit !== "j")) return null;
  return unit === "j" ? value / 1000 : value;
}

function reactionQuotient(stem: string): Quotient | null {
  if (/q\s*(?:=|equals|is)\s*k\b|reaction quotient\s*(?:=|equals|is)\s*(?:k\b|the equilibrium constant)/.test(stem)) {
    return { kind: "equilibrium" };
  }
  if (/q\s*(?:<=|≤)\s*0|q\s*<\s*0|q\s*(?:is|equals|=)\s*(?:0|zero|negative)\b|q\s+is\s+(?:negative|zero)\b/.test(stem)) {
    return "nonpositive";
  }
  const match = new RegExp(String.raw`\bq\s*(?:=|is|equals)\s*${SIGNED}`).exec(stem);
  const value = signedNumber(match);
  if (value === null) return null;
  if (value <= 0) return "nonpositive";
  return { kind: "value", value };
}

function deniesTotalGibbs(stem: string): boolean {
  return /not the total[^.]{0,48}gibbs|not total system gibbs|isn'?t the total[^.]{0,32}gibbs/.test(stem);
}

function buildReactionGibbs(question: string, stem: string): SceneDocument | null {
  const quotient = reactionQuotient(stem);
  if (quotient === null || quotient === "nonpositive") return null;
  const temperature = kelvinTemperature(stem);
  if (temperature === null || !(temperature > 0)) return null;
  const gasR = statedR(stem);
  if (gasR === null || Math.abs(gasR - R_J) > 1e-3) return null;
  const standard = standardGibbsKj(stem);
  if (quotient.kind === "equilibrium") {
    const labels = ["dG=0"];
    if (standard !== null && standard !== 0) labels.push("dGo!=0");
    labels.push("Q=K");
    if (deniesTotalGibbs(stem)) labels.push("not G total");
    return finish(question, "reaction Gibbs energy is zero when Q equals K", labels, "ΔG = ΔG° + RT ln Q with R = 8.314 J/(mol K). Q = K makes this reaction ΔG zero. ΔG° is unchanged. This ΔG is not the total Gibbs energy of the system.");
  }
  if (standard === null) return null;
  const joules = standard * 1000 + R_J * temperature * Math.log(quotient.value);
  const kilojoules = joules / 1000;
  if (!Number.isFinite(kilojoules)) return null;
  const gText = shown(kilojoules);
  const qText = shown(quotient.value);
  if (gText === null || qText === null) return null;
  const labels = [`dG=${gText} kJ/mol`, `Q=${qText}`];
  if (deniesTotalGibbs(stem)) labels.push("not G total");
  return finish(question, "reaction Gibbs energy from Q", labels, "ΔG = ΔG° + RT ln Q with R = 8.314 J/(mol K) and T in kelvin. The result is the reaction Gibbs energy, not the total Gibbs energy of the system. ln 1 is zero, so Q = 1 leaves ΔG equal to ΔG°.");
}

/** The figure, or null when the stem is claimed but not grounded. */
export function buildEquilibriumConstantsScene(
  question: string,
  _quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  if (!claimsEquilibriumConstants(question)) return null;
  const stem = chemStem(question);
  const formulaText = normalizeChemistryText(question);
  if (standardZeroMisconception(stem)) return null;
  if (asksReactionGibbs(stem)) return buildReactionGibbs(question, stem);
  if (asksExtent(stem)) return buildExtent(question, stem, formulaText);
  if (asksKpKc(stem)) return buildKpKc(question, stem, formulaText);
  if (asksHeterogeneous(stem)) return buildHeterogeneous(question, stem, formulaText);
  return null;
}
