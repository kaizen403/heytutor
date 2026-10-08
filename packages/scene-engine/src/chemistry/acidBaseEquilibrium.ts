/**
 * Source-grounded acid-base figures: Arrhenius, Bronsted-Lowry and Lewis
 * definitions, strong versus concentrated, the weak-acid square-root
 * check, separate Ka1 and Ka2, and concentration pH when Kw is stated.
 *
 * Titration, buffers, hydrolysis, solubility and colligative plots stay
 * in their own modules. A missing Kw or an invalid approximation is not
 * replaced with a textbook shortcut. pH here is from concentration.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_solutions" as const;
const VETO = /titr|equivalence|buffer|henderson|common[-\s]ion|pure weak acid|salt concentration|(?<![\w])kb\b|hydrolys|ksp|solubility product|precipitat|raoult|osmotic|henry/;
const STRONG_ACIDS = "hcl|hbr|hi|hno3|hclo4|hydrochloric acid|hydrobromic acid|hydroiodic acid|nitric acid|perchloric acid";
const MOLAR = String.raw`(?:m|molar)\b|mol\s*(?:\/\s*)?(?:l|dm3|dm\^?-?3|l\s*-?\s*1)\b`;

function prepare(question: string): string {
  return chemStem(question)
    .replace(/\^\(\+\)/g, "+")
    .replace(/\^\(-\)/g, "-")
    .replace(/\^\+/g, "+")
    .replace(/\^-(?!\d)/g, "-")
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/(\d+(?:\.\d+)?)\s*(?:[x×*·⋅]|times)\s*10\s*\^\s*\(?\s*([+-]?\d+)\s*\)?/g, "$1e$2")
    .replace(/(?<![\d.])10\s*\^\s*\(?\s*([+-]?\d+)\s*\)?/g, "1e$1");
}

function valueOf(mantissa: string | undefined, exponent?: string): number | null {
  if (mantissa === undefined) return null;
  const value = Number(mantissa) * Math.pow(10, exponent === undefined ? 0 : Number(exponent));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readKeyed(stem: string, key: RegExp): number | null {
  const search = new RegExp(key.source, key.flags.includes("g") ? key.flags : `${key.flags}g`);
  for (let found = search.exec(stem); found; found = search.exec(stem)) {
    const slice = stem.slice(found.index + found[0].length, found.index + found[0].length + 42);
    if (/^\s*(?:sqrt|square|greater|less|above|below|over|under)/.test(slice)) continue;
    const match = /[^0-9]{0,28}?(\d+(?:\.\d+)?)(?:e([+-]?\d+))?/.exec(slice);
    if (!match || match.index === undefined || match.index > 28) continue;
    const after = slice.slice(match.index + match[0].length);
    if (/^\s*k\b/.test(after)) continue;
    const value = valueOf(match[1], match[2]);
    if (value !== null) return value;
  }
  return null;
}

function readKw(stem: string): number | null {
  return readKeyed(stem, /k_?w\s*(?:=|is|equals|of)?/)
    ?? readKeyed(stem, /ionic product(?:\s+of water)?\s*(?:=|is|equals|of)?/);
}

function readMolarities(stem: string): number[] {
  const re = new RegExp(String.raw`(?<![a-z\d.])(\d+(?:\.\d+)?)(?:e([+-]?\d+))?\s*(?:${MOLAR})`, "g");
  return [...stem.matchAll(re)].flatMap((match) => {
    const value = valueOf(match[1], match[2]);
    return value === null ? [] : [value];
  });
}

function readAcidMolarity(stem: string): number | null {
  if (/h2so4|sulphuric|sulfuric|diprotic|polyprotic|carbonic|h2co3/.test(stem) && !/monoprotic/.test(stem)) return null;
  const before = new RegExp(
    String.raw`(?<![a-z\d.])(\d+(?:\.\d+)?)(?:e([+-]?\d+))?\s*(?:${MOLAR})\s*(?:of\s+)?(?:${STRONG_ACIDS})\b`,
  ).exec(stem);
  if (before) return valueOf(before[1], before[2]);
  const after = new RegExp(
    String.raw`(?:${STRONG_ACIDS})\b[^.]{0,48}?(?<![a-z\d.])(\d+(?:\.\d+)?)(?:e([+-]?\d+))?\s*(?:${MOLAR})`,
  ).exec(stem);
  if (after) return valueOf(after[1], after[2]);
  const named = new RegExp(String.raw`(?:${STRONG_ACIDS})\b`).test(stem);
  const generic = /strong (?:monoprotic )?acid/.test(stem)
    && !/not a strong acid/.test(stem)
    && (!/weak acid/.test(stem) || /not a weak acid/.test(stem));
  if (!named && !generic) return null;
  const labeled = readKeyed(stem, /(?:concentration|molarity)\s*(?:is|of|=|:)?/);
  if (labeled !== null) return labeled;
  const molarities = readMolarities(stem);
  return molarities.length === 1 ? molarities[0]! : null;
}

function readExplicitH(stem: string): number | null {
  const bracket = /(?:\[h\+\]|\[h3o\+\])\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)(?:e([+-]?\d+))?/.exec(stem);
  if (bracket) return valueOf(bracket[1], bracket[2]);
  const named = /(?:hydrogen ion|hydronium(?: ion)?) concentration\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)(?:e([+-]?\d+))?/.exec(stem);
  return named ? valueOf(named[1], named[2]) : null;
}

function readWeakConcentration(stem: string): number | null {
  const labeled = readKeyed(stem, /concentration\s*(?:is|of|=|:)?/);
  if (labeled !== null) return labeled;
  const symbolic = readKeyed(stem, /(?<![a-z])c\s*=/);
  if (symbolic !== null) return symbolic;
  const molarities = readMolarities(stem);
  return molarities.length === 1 ? molarities[0]! : null;
}

function readKa(stem: string): number | null {
  if (/k_?a_?1|k_?a_?2|k_?a\s*\(\s*[12]\s*\)/.test(stem)) return null;
  return readKeyed(stem, /k_?a(?!_?\d)\s*(?:=|is|equals|of)?/);
}

function readIndexedKa(stem: string, index: "1" | "2"): number | null {
  const symbolic = readKeyed(stem, new RegExp(`k_?a_?${index}\\s*(?:=|is|equals|of)?`))
    ?? readKeyed(stem, new RegExp(`k_?a\\s*\\(\\s*${index}\\s*\\)\\s*(?:=|is|equals|of)?`));
  if (symbolic !== null) return symbolic;
  const word = index === "1" ? "first" : "second";
  return readKeyed(stem, new RegExp(`${word}\\s+(?:acid\\s+)?dissociation(?:\\s+constant)?\\s*(?:k_?a\\s*)?(?:=|is|equals|of)?`));
}

function readRatio(stem: string): number | null {
  const match = /c\s*\/\s*k_?a\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)(?:e([+-]?\d+))?/.exec(stem);
  return match ? valueOf(match[1], match[2]) : null;
}

function statedHydrogens(stem: string): number[] {
  const re = /(?:\[h\+\]|\[h3o\+\]|(?<![a-z])h\+)\s*(?:=|is|equals)\s*(\d+(?:\.\d+)?)(?:e([+-]?\d+))?/g;
  return [...stem.matchAll(re)].flatMap((match) => {
    const value = valueOf(match[1], match[2]);
    return value === null ? [] : [value];
  });
}

function close(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-30);
  return Math.abs(a - b) <= 1e-3 * scale;
}

function formatSci(value: number): string {
  const abs = Math.abs(value);
  let exp = Math.floor(Math.log10(abs));
  let mantissa = abs / Math.pow(10, exp);
  mantissa = Number(mantissa.toPrecision(3));
  if (mantissa >= 10) {
    mantissa /= 10;
    exp += 1;
  }
  return `${String(mantissa)}e${exp}`;
}

function formatH(value: number): string {
  const rounded = Number(value.toPrecision(6));
  if (rounded >= 1e-4 && rounded < 1000) {
    const text = rounded.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    if (text.length > 0 && text.length <= 12) return text;
  }
  return formatSci(rounded);
}

function formatPlain(value: number): string {
  const rounded = Number(value.toFixed(4));
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return rounded.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatDirect(ph: number): string {
  if (Math.abs(ph - Math.round(ph)) < 5e-4) return String(Math.round(ph));
  return ph.toFixed(3);
}

function conflicts(stem: string, actual: number): boolean {
  const re = /ph\s*(?:=|is(?:\s+equal(?:\s+to)?)?|equals)\s*([+-]?\d+(?:\.\d+)?)/g;
  for (const match of stem.matchAll(re)) {
    const before = stem.slice(Math.max(0, (match.index ?? 0) - 20), match.index ?? 0);
    if (/(?:not|never|do not|don't|n't)\s*$/.test(before)) continue;
    const stated = Number(match[1]);
    if (Math.abs(stated - actual) > 0.03 + 0.001 * Math.abs(actual)) return true;
  }
  return false;
}

function panel(question: string, reason: string, labels: readonly string[], caption: string): SceneDocument | null {
  if (labels.length < 1 || labels.length > 6) return null;
  if (labels.some((label) => label.length < 1 || label.length > 16)) return null;
  const scene = new ChemScene(question, reason, FAMILY);
  const ids = labels.map((label, index) => scene.text(`l${index}`, { x: 0.2, y: 2.6 - index * 0.8 }, label, "result"));
  scene.scene.group("result", ids, reason);
  return scene.build({ caption });
}

function claimsArrhenius(stem: string): boolean {
  if (!/arrhenius/.test(stem)) return false;
  if (/activation|rate constant|frequency factor|pre-?exponential/.test(stem)) return false;
  return /acid|base/.test(stem);
}

function claimsBronsted(stem: string): boolean {
  return /br[oø]nsted/.test(stem);
}

function claimsLewis(stem: string): boolean {
  return /lewis acid|lewis base/.test(stem);
}

function claimsStrongConc(stem: string): boolean {
  if (!/\bstrong\b/.test(stem)) return false;
  if (!/acid|solution|hcl|hno3|hbr|hclo4/.test(stem)) return false;
  if (/\bph\b/.test(stem) && (readKw(stem) !== null || /include water|from water|autoioni/.test(stem))) return false;
  return /dilute|concentrat/.test(stem) || /strong[^.]{0,80}concentration/.test(stem);
}

function claimsWeak(stem: string): boolean {
  if (/k_?a_?1/.test(stem) && /k_?a_?2/.test(stem)) return false;
  if (/carbonic|h2co3/.test(stem) && /both protons|two stages|k_?a_?2/.test(stem)) return false;
  const weak = /weak acid/.test(stem) && !/not a weak acid/.test(stem);
  const approx = /sqrt|square[-\s]?root|c\s*\/\s*k_?a|approximation/.test(stem);
  if (weak && /k_?a|sqrt|square|approx/.test(stem)) return true;
  return approx && /k_?a/.test(stem) && (/concentration|(?<![a-z])c\s*=|\d\s*m\b/.test(stem));
}

function claimsStages(stem: string): boolean {
  if (/k_?a_?1/.test(stem) && /k_?a_?2/.test(stem)) return true;
  if (/k_?a\s*\(\s*1\s*\)/.test(stem) && /k_?a\s*\(\s*2\s*\)/.test(stem)) return true;
  if (/carbonic|h2co3/.test(stem) && /k_?a|both protons|two stages|diprotic/.test(stem)) return true;
  return /both protons/.test(stem) && /k_?a|diprotic|carbonic|h2co3/.test(stem);
}

function claimsPh(stem: string): boolean {
  if (!/\bph\b/.test(stem) && !/\bpoh\b/.test(stem)) return false;
  if (/pure water|\bneutral\b/.test(stem)) return true;
  if (readAcidMolarity(stem) !== null) return true;
  if (readExplicitH(stem) !== null) return true;
  if (/k_?w|ionic product/.test(stem)) return true;
  return /0\s*(?:\.\.|to|and|through|-)\s*14/.test(stem);
}

/** True when this chapter owns the stem, including honest declines. */
export function claimsAcidBaseEquilibrium(question: string): boolean {
  const stem = prepare(question);
  if (VETO.test(stem)) return false;
  return claimsArrhenius(stem)
    || claimsBronsted(stem)
    || claimsLewis(stem)
    || claimsStrongConc(stem)
    || claimsWeak(stem)
    || claimsStages(stem)
    || claimsPh(stem);
}

function buildArrhenius(question: string, stem: string): SceneDocument | null {
  if (/not an arrhenius|is not an arrhenius|isn't an arrhenius/.test(stem)) return null;
  if (/arrhenius base/.test(stem) && !/arrhenius acid/.test(stem)) return null;
  if (!/hcl|hydrochloric/.test(stem) || !/acid/.test(stem)) return null;
  if (!/h\+|h3o\+|proton|ionis|ioniz|dissociat|in water/.test(stem)) return null;
  const equation = /hcl\s*->\s*([^.]*)/.exec(stem);
  if (equation && !/h\+|h3o\+/.test(equation[1]!)) return null;
  if (/produces oh-|gives oh-|forms oh-/.test(stem) && !/h\+|h3o\+/.test(stem)) return null;
  return panel(question, "Arrhenius acid: HCl produces H+ in water", ["Arrhenius", "H+ donor", "HCl"], "An Arrhenius acid produces H+ in water. HCl ionises to H+ and Cl-. The figure names that definition.");
}

function hasAmmoniaWater(stem: string): boolean {
  const ammonia = /\bnh3\b|ammonia/.test(stem);
  const water = /\bh2o\b|\bwater\b/.test(stem);
  const ammonium = /nh4\+|ammonium/.test(stem);
  const hydroxide = /oh-|hydroxide/.test(stem);
  return ammonia && water && ammonium && hydroxide && (/<=>/.test(stem) || /equilibrium|reversible/.test(stem));
}

function assignedSpecies(stem: string, role: "acid" | "base"): string | null {
  const named = new RegExp(`(?:br[oø]nsted(?:\\s*-?\\s*lowry)?\\s+)?${role}\\s+is\\s+([a-z0-9+-]+)`).exec(stem);
  if (named) return named[1] ?? null;
  const subject = new RegExp(`([a-z0-9+-]+)\\s+is\\s+(?:the\\s+)?(?:br[oø]nsted(?:\\s*-?\\s*lowry)?\\s+)?${role}\\b`).exec(stem);
  return subject?.[1] ?? null;
}

function buildBronsted(question: string, stem: string): SceneDocument | null {
  if (!hasAmmoniaWater(stem)) return null;
  const acid = assignedSpecies(stem, "acid");
  const base = assignedSpecies(stem, "base");
  if (acid && acid !== "h2o" && acid !== "water") return null;
  if (base && base !== "nh3" && base !== "ammonia") return null;
  const conjugate = /conjugate acid of\s+(?:nh3|ammonia)\s+is\s+([a-z0-9+-]+)/.exec(stem);
  if (conjugate && conjugate[1] !== "nh4+" && conjugate[1] !== "ammonium") return null;
  return panel(
    question,
    "Bronsted-Lowry roles in the ammonia-water equilibrium",
    ["base NH3", "acid H2O", "conj NH4+"],
    "NH3 accepts H+ from H2O, so NH3 is the Bronsted base and H2O is the Bronsted acid. The conjugate acid of NH3 is NH4+. OH- is the conjugate base of H2O.",
  );
}

const ACTOR = "boron trifluoride|ammonia|water|bf3|nh3|h2o|hcl|[a-z][a-z]?\\d[a-z0-9]*";

function showFormula(token: string): string {
  if (token === "ammonia") return "NH3";
  if (token === "water") return "H2O";
  if (token === "boron trifluoride") return "BF3";
  return token.toUpperCase();
}

function buildLewis(question: string, stem: string): SceneDocument | null {
  const pairWords = "(?:(?:an?|the)\\s+)?(?:electron pair|pair of electrons)";
  const accept = new RegExp(`(${ACTOR})\\s+accepts?\\s+${pairWords}\\s+from\\s+(${ACTOR})`).exec(stem);
  const donate = new RegExp(`(${ACTOR})\\s+donates?\\s+${pairWords}\\s+to\\s+(${ACTOR})`).exec(stem);
  const statedAcid = /([a-z0-9]+)\s+is\s+(?:the\s+)?lewis acid/.exec(stem)?.[1]
    ?? /lewis acid\s+is\s+([a-z0-9]+)/.exec(stem)?.[1]
    ?? null;
  const statedBase = /([a-z0-9]+)\s+is\s+(?:the\s+)?lewis base/.exec(stem)?.[1]
    ?? /lewis base\s+is\s+([a-z0-9]+)/.exec(stem)?.[1]
    ?? null;
  let acid = accept?.[1] ?? (donate ? donate[2] : undefined) ?? null;
  let base = accept?.[2] ?? (donate ? donate[1] : undefined) ?? null;
  if (!acid && statedAcid) acid = statedAcid;
  if (!base && statedBase) base = statedBase;
  if (!acid || !base) return null;
  if (statedAcid && showFormula(statedAcid) !== showFormula(acid)) return null;
  if (statedBase && showFormula(statedBase) !== showFormula(base)) return null;
  const labels = ["Lewis acid", `${showFormula(acid)} accept`, `${showFormula(base)} donor`];
  return panel(
    question,
    "Lewis acid accepts an electron pair; Lewis base donates it",
    labels,
    "A Lewis acid accepts an electron pair. A Lewis base donates that electron pair. The acceptor and the donor are the species named in the stem.",
  );
}

function separatesStrength(stem: string): boolean {
  return /does not mean[^.]{0,48}concentrated|do not mean[^.]{0,48}concentrated|not the same[^.]{0,32}concentrated|is not concentrated|isn'?t concentrated|not concentrated|different from concentrated|strength is not/.test(stem);
}

function equatesStrength(stem: string): boolean {
  if (separatesStrength(stem)) return false;
  return /strong[^.]{0,100}(?:\bso\b|\btherefore\b|\bhence\b|\bthus\b|\bmeans\b|\bimplies\b)[^.]{0,80}(?:concentrated|concentration)/.test(stem)
    || /(?:\bso\b|\btherefore\b|\bhence\b|\bthus\b|\bbecause\b)[^.]{0,80}concentration is\s+\d/.test(stem);
}

function buildStrongConc(question: string, stem: string): SceneDocument | null {
  if (/\bph\b/.test(stem) || equatesStrength(stem) || !/\bstrong\b/.test(stem)) return null;
  const molarities = readMolarities(stem);
  if (molarities.some((value) => value >= 1)) return null;
  const saysDilute = /\bdilute\b/.test(stem);
  const low = molarities.some((value) => value > 0 && value < 1);
  if (!saysDilute || (!separatesStrength(stem) && !low)) return null;
  return panel(
    question,
    "Strong describes dissociation, dilute describes concentration",
    ["strong", "dilute", "not conc"],
    "A strong acid dissociates completely. Dilute describes a low concentration. Strong does not mean the solution is concentrated.",
  );
}

function wantsCollapsed(stem: string): boolean {
  if (/do not use one k_?a|don't use one k_?a|not use one k_?a/.test(stem)) return false;
  if (/one k_?a for both|single k_?a for both|same k_?a|use (?:only )?one k_?a/.test(stem)) return true;
  if (/report (?:only )?one\b/.test(stem) && /h\+|hydrogen/.test(stem) && !/do not report|don't report|not report/.test(stem)) return true;
  return false;
}

function buildStages(question: string, stem: string): SceneDocument | null {
  if (wantsCollapsed(stem)) return null;
  const ka1 = readIndexedKa(stem, "1");
  const ka2 = readIndexedKa(stem, "2");
  if (ka1 === null || ka2 === null || !(ka1 > 0) || !(ka2 > 0)) return null;
  if (/report (?:only )?one\b/.test(stem) && /h\+|hydrogen/.test(stem) && !/do not report|don't report/.test(stem)) return null;
  return panel(
    question,
    "Two dissociation constants kept as separate stages",
    [`Ka1=${formatSci(ka1)}`, `Ka2=${formatSci(ka2)}`, "two stages"],
    "Ka1 and Ka2 are successive dissociation constants. Both stages stay on the figure. One Ka is not turned into a single H+ concentration.",
  );
}

function buildWeak(question: string, stem: string): SceneDocument | null {
  const c = readWeakConcentration(stem);
  const ka = readKa(stem);
  if (c === null || ka === null || !(c > 0) || !(ka > 0)) return null;
  const ratio = c / ka;
  const statedRatio = readRatio(stem);
  if (statedRatio !== null && !close(statedRatio, ratio)) return null;
  if (/quadratic|do not use the (?:square|sqrt|approximation)|don't use the approximation|approximation (?:is|does) not|not valid/.test(stem)) return null;
  if (ratio < 99.999) return null;
  const hydrogen = Math.sqrt(ka * c);
  if (!Number.isFinite(hydrogen) || !(hydrogen > 0)) return null;
  const stated = statedHydrogens(stem);
  if (stated.some((value) => !close(value, hydrogen))) return null;
  const labels = [`H+=${formatH(hydrogen)}`, `Ka=${formatSci(ka)}`, "approx ok"];
  return panel(
    question,
    "Weak-acid square-root approximation after the c/Ka check",
    labels,
    `H+ is sqrt(Ka c) only because c/Ka = ${formatPlain(ratio)}, which is at least 100. Below that ratio the full quadratic is required, and this figure does not draw it.`,
  );
}

function naivePh(c: number): number {
  const raw = -Math.log10(c);
  const nearest = Math.round(raw);
  return Math.abs(raw - nearest) < 1e-6 ? nearest : raw;
}

function naiveWarning(c: number, actual: number): string | null {
  const naive = naivePh(c);
  const crosses = naive >= 7 - 1e-6;
  if (!crosses && Math.abs(naive - actual) < 0.05) return null;
  const shown = Math.abs(naive - Math.round(naive)) < 1e-6 ? String(Math.round(naive)) : naive.toFixed(2);
  const label = `not pH ${shown}`;
  return label.length <= 16 ? label : null;
}

function strongHydrogen(c: number, kw: number): number {
  return (c + Math.sqrt(c * c + 4 * kw)) / 2;
}

function buildStrongPh(question: string, stem: string, c: number): SceneDocument | null {
  const kw = readKw(stem);
  if (kw === null || !(kw > 0) || !(c > 0)) return null;
  if (/neglect water|ignore water|without water|water can be ignored/.test(stem) && naivePh(c) >= 7 - 1e-6) return null;
  const hydrogen = strongHydrogen(c, kw);
  if (!Number.isFinite(hydrogen) || !(hydrogen > 0)) return null;
  const ph = -Math.log10(hydrogen);
  if (!Number.isFinite(ph) || conflicts(stem, ph)) return null;
  const warning = naiveWarning(c, ph);
  const labels = [`pH=${ph.toFixed(2)}`, ...(warning ? [warning] : []), "Kw used", "not activity"];
  return panel(
    question,
    "pH of a strong monoprotic acid with water included",
    labels,
    "For a strong monoprotic acid the charge balance is [H+]^2 - c[H+] - Kw = 0. The positive root includes water. -log10(c) is not used when that result would cross neutrality. The value is a concentration pH, not an activity.",
  );
}

function isWaterPh(stem: string): boolean {
  if (/not neutral/.test(stem)) return false;
  return /pure water|neutral water|neutral solution|solution is neutral|\bis neutral\b|\bneutral\b/.test(stem);
}

function buildWater(question: string, stem: string): SceneDocument | null {
  const kw = readKw(stem);
  if (kw === null || !(kw > 0)) return null;
  const ph = -0.5 * Math.log10(kw);
  if (!Number.isFinite(ph) || conflicts(stem, ph)) return null;
  const saysNot7 = /not(?:\s+\w+){0,3}\s+ph\s*7|isn'?t(?:\s+\w+){0,3}\s+ph\s*7/.test(stem);
  if (saysNot7 && Math.abs(ph - 7) < 0.02) return null;
  const kwLabel = `Kw=${formatSci(kw)}`;
  const asksPoh = /\bpoh\b/.test(stem);
  if (Math.abs(ph - 7) > 0.02) {
    return panel(
      question,
      "Neutral pH at the stated Kw",
      [`pH=${formatPlain(ph)}`, "not pH 7", kwLabel, "not activity"],
      "In neutral water [H+] = [OH-] = sqrt(Kw), so pH = 0.5 pKw. That is 7 only when Kw = 1e-14. The value is a concentration pH, not an activity.",
    );
  }
  if (!asksPoh) return null;
  return panel(
    question,
    "pH and pOH of pure water at the stated Kw",
    [`pH=${formatPlain(ph)}`, `pOH=${formatPlain(ph)}`, kwLabel, "not activity"],
    "Pure water is neutral, so pH = pOH = 0.5 pKw. At Kw = 1e-14 both are 7. The values are concentration pH and pOH, not activities.",
  );
}

function buildDirect(question: string, stem: string, hydrogen: number): SceneDocument | null {
  const kw = readKw(stem);
  if (kw === null || !(kw > 0) || !(hydrogen > 0)) return null;
  const ph = -Math.log10(hydrogen);
  if (!Number.isFinite(ph) || conflicts(stem, ph)) return null;
  const outside = ph < -1e-6 || ph > 14 + 1e-6;
  const mentionsScale = /0\s*(?:\.\.|to|and|through|-)\s*14|not limited|no limit|outside the (?:usual )?scale/.test(stem);
  if (!outside && !mentionsScale) return null;
  return panel(
    question,
    "Concentration pH from the stated hydrogen ion concentration",
    [`pH=${formatDirect(ph)}`, "not 0..14", "not activity"],
    "pH = -log10([H+]) from the stated concentration. The number is not confined to 0..14. It is a concentration pH, not an activity.",
  );
}

function demandsActivity(stem: string): boolean {
  return /activity coefficient|ionic strength|use activit|using activit/.test(stem);
}

function buildPh(question: string, stem: string): SceneDocument | null {
  if (demandsActivity(stem)) return null;
  if (isWaterPh(stem) && readAcidMolarity(stem) === null && readExplicitH(stem) === null) return buildWater(question, stem);
  const analytical = readAcidMolarity(stem);
  if (analytical !== null && !/\[h\+\]|\[h3o\+\]|hydrogen ion concentration/.test(stem)) return buildStrongPh(question, stem, analytical);
  const explicit = readExplicitH(stem);
  if (explicit !== null && analytical === null) return buildDirect(question, stem, explicit);
  if (analytical !== null) return buildStrongPh(question, stem, analytical);
  if (isWaterPh(stem)) return buildWater(question, stem);
  return null;
}

/** The figure for a claimed acid-base stem, or null when the stem is not grounded. */
export function buildAcidBaseEquilibriumScene(
  question: string,
  _quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  const stem = prepare(question);
  if (VETO.test(stem)) return null;
  if (claimsLewis(stem)) return buildLewis(question, stem);
  if (claimsBronsted(stem)) return buildBronsted(question, stem);
  if (claimsArrhenius(stem)) return buildArrhenius(question, stem);
  if (claimsStages(stem)) return buildStages(question, stem);
  if (claimsWeak(stem)) return buildWeak(question, stem);
  if (claimsPh(stem)) return buildPh(question, stem);
  if (claimsStrongConc(stem)) return buildStrongConc(question, stem);
  return null;
}
