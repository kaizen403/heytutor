/**
 * Source-grounded ionic-equilibrium figures: Henderson-Hasselbalch buffers,
 * common-ion suppression, buffer exhaustion after stoichiometry, the ion that
 * actually hydrolyses, Ksp with its stoichiometric powers, mixture volumes,
 * and Q compared with Ksp.
 *
 * Titration curves, Arrhenius plots, and colligative solution properties stay
 * in their own modules. A missing constant is not replaced with a textbook
 * value, and a label is never shortened to fit.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_solutions" as const;
const LABEL_X = 0.2;
const LABEL_Y = 2.6;
const LABEL_DY = -0.8;
const MAX_LABELS = 6;

const VETO = /titrat|equivalence|arrhenius|bronsted|lewis acid|raoult|osmotic|henry|molarity|molality/;

const ACIDS = ["acetic acid", "ethanoic acid", "formic acid", "ch3cooh", "hcooh", "ha"] as const;
const CONJUGATES = ["sodium acetate", "potassium acetate", "sodium ethanoate", "ch3coona", "ch3cook", "ch3coo-", "a-"] as const;

interface Amount {
  value: number;
  unit: "M" | "mol";
}

interface LatticeSalt {
  cation: string;
  anion: string;
  /** Ions produced per formula unit. CaF2 is 1 and 2, so pure water is 4 s^3, not s^2. */
  cx: number;
  ax: number;
  names: readonly string[];
}

const LATTICE: readonly LatticeSalt[] = [
  { cation: "ca2+", anion: "f-", cx: 1, ax: 2, names: ["caf2", "calcium fluoride"] },
  { cation: "ag+", anion: "cl-", cx: 1, ax: 1, names: ["agcl", "silver chloride"] },
  { cation: "ag+", anion: "br-", cx: 1, ax: 1, names: ["agbr", "silver bromide"] },
  { cation: "ag+", anion: "i-", cx: 1, ax: 1, names: ["agi", "silver iodide"] },
  { cation: "pb2+", anion: "cl-", cx: 1, ax: 2, names: ["pbcl2", "lead chloride", "lead(ii) chloride"] },
  { cation: "pb2+", anion: "i-", cx: 1, ax: 2, names: ["pbi2", "lead iodide"] },
  { cation: "ba2+", anion: "so42-", cx: 1, ax: 1, names: ["baso4", "barium sulfate", "barium sulphate"] },
  { cation: "ca2+", anion: "so42-", cx: 1, ax: 1, names: ["caso4", "calcium sulfate", "calcium sulphate"] },
  { cation: "ag+", anion: "cro42-", cx: 2, ax: 1, names: ["ag2cro4", "silver chromate"] },
  { cation: "mg2+", anion: "oh-", cx: 1, ax: 2, names: ["mg(oh)2", "mgoh2", "magnesium hydroxide"] },
  { cation: "ca2+", anion: "oh-", cx: 1, ax: 2, names: ["ca(oh)2", "caoh2", "calcium hydroxide"] },
  { cation: "al3+", anion: "oh-", cx: 1, ax: 3, names: ["al(oh)3", "aloh3", "aluminium hydroxide", "aluminum hydroxide"] },
  { cation: "fe3+", anion: "oh-", cx: 1, ax: 3, names: ["fe(oh)3", "feoh3", "ferric hydroxide", "iron(iii) hydroxide"] },
  { cation: "zn2+", anion: "oh-", cx: 1, ax: 2, names: ["zn(oh)2", "znoh2", "zinc hydroxide"] },
];

const SPECTATOR_IONS: readonly RegExp[] = [
  /na\+/,
  /k\+/,
  /li\+/,
  /ca2\+/,
  /ba2\+/,
  /sr2\+/,
  /cl-(?![a-z0-9])/,
  /br-(?![a-z0-9])/,
  /(?<![a-z0-9])i-(?![a-z0-9])/,
  /no3-/,
  /clo4-/,
];

interface HydroAccount {
  ion: string;
  spectator: string;
  ionRe: RegExp;
}

const NUMBER_BODY = "([+-]?\\d+(?:\\.\\d+)?)(?:e([+-]?\\d+)|(?:\\s*[x×*]\\s*10\\s*\\^?\\(?\\s*([+-]?\\d+)\\s*\\)?))?";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function token(name: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(name)}(?![a-z0-9])`, "i");
}

function readSignedNumber(text: string): { value: number; length: number } | null {
  const match = new RegExp(`^${NUMBER_BODY}`, "i").exec(text);
  if (!match?.[1]) return null;
  const exp = match[2] ?? match[3];
  const value = Number(match[1]) * 10 ** (exp !== undefined ? Number(exp) : 0);
  return Number.isFinite(value) ? { value, length: match[0].length } : null;
}

/** A number that is not the coefficient in "4 s^3". */
function assignedNumber(text: string): number | null {
  const parsed = readSignedNumber(text);
  if (!parsed) return null;
  if (/^\s*s\^/.test(text.slice(parsed.length))) return null;
  return parsed.value;
}

/**
 * The number that belongs to a cue. A value sitting immediately after the cue
 * wins, so "[F-] = 1e-3" is not replaced by a later "Ksp is 4e-11". A cue such
 * as "pKa of CH3COOH = 4.76" still finds the later assignment.
 */
function numberAfter(stem: string, phrase: RegExp): number | null {
  const found = new RegExp(phrase.source, "i").exec(stem);
  if (!found) return null;
  const rest = stem.slice(found.index + found[0].length, found.index + found[0].length + 96);
  if (/^(?:\s|=|is|of|:)*zero\b/i.test(rest)) return 0;
  const trimmed = rest.replace(/^\s+/, "");
  if (/^(?:=|is\b|\d)/i.test(trimmed)) {
    return assignedNumber(trimmed.replace(/^(?:=|is)\s*/i, ""));
  }
  const later = /(?:=|\bis)\s+/gi;
  let marker: RegExpExecArray | null;
  while ((marker = later.exec(rest))) {
    const value = assignedNumber(rest.slice(marker.index + marker[0].length));
    if (value !== null) return value;
  }
  return null;
}

function formatMeasure(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0";
  const rounded = Number(magnitude.toPrecision(3));
  if (!(rounded > 0)) return null;
  const raw = Math.log10(rounded);
  const nearest = Math.round(raw);
  const exp = Math.abs(rounded - 10 ** nearest) / rounded < 1e-8 ? nearest : Math.floor(raw + 1e-12);
  if (exp >= -3 && exp <= 3) return `${sign}${String(rounded)}`;
  const mantissa = rounded / 10 ** exp;
  return `${sign}${String(Number(mantissa.toPrecision(3)))}e${exp}`;
}

function formatPH(pH: number): string | null {
  if (!Number.isFinite(pH)) return null;
  const cents = Math.round(pH * 100) / 100;
  const text = Math.abs(cents - Math.round(cents)) < 1e-9 ? String(Math.round(cents)) : cents.toFixed(2);
  const label = `pH=${text}`;
  return label.length <= 16 ? label : null;
}

function stableNegLog10(value: number): number {
  const log = Math.log10(value);
  const nearest = Math.round(log);
  if (Math.abs(log - nearest) < 1e-8) return -nearest;
  return -log;
}

function draw(question: string, purpose: string, labels: readonly string[], caption: string): SceneDocument | null {
  if (labels.length < 1 || labels.length > MAX_LABELS) return null;
  if (labels.some((label) => label.length < 1 || label.length > 16)) return null;
  const scene = new ChemScene(question, purpose, FAMILY);
  const ids = labels.map((label, index) => scene.text(
    `v${index}`,
    { x: LABEL_X, y: LABEL_Y + index * LABEL_DY },
    label,
    "ionic equilibrium result",
  ));
  scene.scene.group("equilibrium", ids, purpose);
  return scene.build({ caption });
}

function amountBefore(stem: string, name: string): Amount | null {
  const found = token(name).exec(stem);
  if (!found) return null;
  const window = stem.slice(Math.max(0, found.index - 48), found.index);
  const moles = new RegExp(`${NUMBER_BODY}\\s*mol\\s*$`, "i").exec(window);
  if (moles?.[1]) {
    const exp = moles[2] ?? moles[3];
    const value = Number(moles[1]) * 10 ** (exp !== undefined ? Number(exp) : 0);
    return Number.isFinite(value) ? { value, unit: "mol" } : null;
  }
  const molar = new RegExp(`${NUMBER_BODY}\\s*m\\s*$`, "i").exec(window);
  if (!molar?.[1]) return null;
  const exp = molar[2] ?? molar[3];
  const value = Number(molar[1]) * 10 ** (exp !== undefined ? Number(exp) : 0);
  return Number.isFinite(value) ? { value, unit: "M" } : null;
}

function amountOf(stem: string, names: readonly string[]): Amount | null {
  for (const name of names) {
    const bracket = numberAfter(stem, new RegExp(`\\[${escapeRegExp(name)}\\]\\s*=`));
    if (bracket !== null) return { value: bracket, unit: "M" };
    const leading = amountBefore(stem, name);
    if (leading) return leading;
    const assigned = numberAfter(stem, new RegExp(`${escapeRegExp(name)}\\s*(?:=|is)`));
    if (assigned !== null) return { value: assigned, unit: "M" };
  }
  return null;
}

function readPKa(stem: string): number | null {
  const stated = numberAfter(stem, /pka\b/);
  const ka = numberAfter(stem, /(?<![\w])ka\b/);
  const fromKa = ka !== null && ka > 0 && ka < 1 ? stableNegLog10(ka) : null;
  if (stated !== null && (stated <= 0 || stated >= 20)) return null;
  if (stated !== null && fromKa !== null && Math.abs(stated - fromKa) > 0.05) return null;
  return stated ?? fromKa;
}

function solutionLitres(stem: string): number | null {
  const named = /(?:^|[^\w])(?:in|volume(?:\s+of)?)\s*(\d+(?:\.\d+)?)\s*(ml|l)\b/.exec(stem);
  if (!named?.[1] || !named[2]) return null;
  const value = Number(named[1]);
  if (!(value > 0)) return null;
  return named[2] === "ml" ? value / 1000 : value;
}

function asMoles(amount: Amount, litres: number | null): number | null {
  if (amount.unit === "mol") return amount.value;
  if (litres === null) return null;
  return amount.value * litres;
}

interface Reagent {
  kind: "oh" | "h";
  moles: number;
}

function readReagent(stem: string): Reagent | null {
  if (/no reagent/.test(stem)) return null;
  const mentioned = [...stem.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*mol\\s+(?:of\\s+)?(naoh|koh|lioh|hcl|hno3|hbr|hi|hclo4)\\b`, "gi"))];
  const last = mentioned.at(-1);
  if (!last?.[1] || !last[2]) return null;
  if (!/stoichiometr|\badded\b|\badding\b|\bthen\b|\bexcess\b/.test(stem)) return null;
  const name = last[2].toLowerCase();
  const kind = name === "naoh" || name === "koh" || name === "lioh" ? "oh" : "h";
  const moles = Number(last[1]);
  return moles > 0 ? { kind, moles } : null;
}

function strictlyGreater(left: number, right: number): boolean {
  return left > right + 1e-9 * Math.max(1, Math.abs(right));
}

function bufferScene(question: string, stem: string): SceneDocument | null {
  const acid = amountOf(stem, ACIDS);
  const salt = amountOf(stem, CONJUGATES);
  if (!acid || !salt) return null;
  const reagent = readReagent(stem);
  const wantsStoichiometry = !/no reagent/.test(stem) && /stoichiometr|\badded\b|\badding\b/.test(stem);
  if (wantsStoichiometry && !reagent) return null;

  let acidQty = acid.value;
  let saltQty = salt.value;
  if (reagent) {
    if (acid.unit !== salt.unit) return null;
    const litres = solutionLitres(stem);
    const acidMol = asMoles(acid, litres);
    const saltMol = asMoles(salt, litres);
    if (acidMol === null || saltMol === null) return null;
    if (reagent.kind === "oh") {
      if (strictlyGreater(reagent.moles, acidMol)) {
        return draw(question, "buffer exhausted by added strong base", ["exhausted", "not buffer", "OH left"], "The added strong base exceeds the weak acid, so the acid is gone before equilibrium is written. Excess hydroxide remains. Henderson-Hasselbalch is not used on a mixture that is no longer a buffer.");
      }
      if (!strictlyGreater(acidMol, reagent.moles)) return null;
      acidQty = acidMol - reagent.moles;
      saltQty = saltMol + reagent.moles;
    } else {
      if (strictlyGreater(reagent.moles, saltMol)) {
        return draw(question, "buffer exhausted by added strong acid", ["exhausted", "not buffer", "H+ left"], "The added strong acid exceeds the conjugate base, so the buffer is exhausted before equilibrium is written. Excess hydrogen ion remains. Henderson-Hasselbalch is not used.");
      }
      if (!strictlyGreater(saltMol, reagent.moles)) return null;
      saltQty = saltMol - reagent.moles;
      acidQty = acidMol + reagent.moles;
    }
  }

  if (!(acidQty > 0) || !(saltQty > 0)) return null;
  const pKa = readPKa(stem);
  if (pKa === null) return null;
  const pHLabel = formatPH(pKa + Math.log10(saltQty / acidQty));
  if (!pHLabel) return null;
  return draw(question, "Henderson-Hasselbalch buffer", [pHLabel, "HH ok", "buffer"], `pH = pKa + log([A-]/[HA]) = ${pKa} + log(${saltQty}/${acidQty}). Both the weak acid and its salt are still present, so Henderson-Hasselbalch applies. Neither concentration was driven to zero.`);
}

function commonIonScene(question: string, stem: string): SceneDocument | null {
  const acid = amountOf(stem, ACIDS);
  const salt = amountOf(stem, CONJUGATES);
  const ka = numberAfter(stem, /(?<![\w])ka\b/);
  if (!acid || !salt || ka === null) return null;
  if (acid.unit !== "M" || salt.unit !== "M") return null;
  if (!(acid.value > 0) || !(salt.value > 0) || !(ka > 0) || ka >= 1) return null;
  const hydrogen = ka * acid.value / salt.value;
  const pure = Math.sqrt(ka * acid.value);
  if (!(pure > hydrogen)) return null;
  const hydrogenText = formatMeasure(hydrogen);
  const pureText = formatMeasure(pure);
  if (!hydrogenText || !pureText) return null;
  const labels = [`H+=${hydrogenText}`, `pure ${pureText}`, "suppressed"];
  return draw(question, "common-ion suppression of a weak acid", labels, `[H+] = Ka [HA]/[A-] = ${hydrogenText}. A pure weak acid of the same concentration would have [H+] = sqrt(Ka c) = ${pureText}, which is higher. The common ion suppresses dissociation. This is not a Henderson-Hasselbalch pH.`);
}

function sentences(stem: string): string[] {
  return stem.split(/[.;]/);
}

function polarity(stem: string, ion: RegExp): "yes" | "no" | "silent" {
  let sawYes = false;
  let sawNo = false;
  for (const sentence of sentences(stem)) {
    if (!new RegExp(ion.source, "i").test(sentence)) continue;
    const source = ion.source;
    const denies = new RegExp(`${source}.{0,32}(?:does not|do not|doesn't|cannot|never)|(?:does not|do not|doesn't|cannot|never|not caused|not).{0,24}${source}`, "i").test(sentence);
    const affirms = /caused by|due to|because of|hydrolys/.test(sentence);
    if (denies) sawNo = true;
    else if (affirms) sawYes = true;
  }
  if (sawNo) return "no";
  if (sawYes) return "yes";
  return "silent";
}

function spectatorClaimed(stem: string): boolean {
  return SPECTATOR_IONS.some((ion) => polarity(stem, ion) === "yes");
}

function hydrolysisAccount(stem: string): HydroAccount | "neither" | "both" | null {
  if (/ammonium acetate|ch3coonh4/.test(stem)) return "both";
  if (/sodium acetate|ch3coona|sodium ethanoate/.test(stem)) return { ion: "acetate", spectator: "Na+", ionRe: /acetate/ };
  if (/potassium acetate|ch3cook|potassium ethanoate/.test(stem)) return { ion: "acetate", spectator: "K+", ionRe: /acetate/ };
  if (/sodium formate|hcoona|sodium methanoate/.test(stem)) return { ion: "formate", spectator: "Na+", ionRe: /formate/ };
  if (/potassium cyanide|\bkcn\b/.test(stem)) return { ion: "cyanide", spectator: "K+", ionRe: /cyanide/ };
  if (/sodium cyanide|\bnacn\b/.test(stem)) return { ion: "cyanide", spectator: "Na+", ionRe: /cyanide/ };
  if (/sodium fluoride|\bnaf\b/.test(stem)) return { ion: "fluoride", spectator: "Na+", ionRe: /fluoride/ };
  if (/ammonium chloride|\bnh4cl\b/.test(stem)) return { ion: "NH4+", spectator: "Cl-", ionRe: /nh4\+/ };
  if (/ammonium nitrate|\bnh4no3\b/.test(stem)) return { ion: "NH4+", spectator: "NO3-", ionRe: /nh4\+/ };
  if (/\bnacl\b|sodium chloride|\bkcl\b|potassium chloride|\bnano3\b|sodium nitrate|\bkno3\b|potassium nitrate|\bna2so4\b|sodium sulfate|sodium sulphate/.test(stem)) return "neither";
  if (/acetate/.test(stem) && /na\+/.test(stem)) return { ion: "acetate", spectator: "Na+", ionRe: /acetate/ };
  return null;
}

function organicHydrolysis(stem: string): boolean {
  return /ester|amide|alkyl halide|sucrose|maltose|starch|protein|peptide|glycosid|methyl acetate|ethyl acetate|phenyl acetate/.test(stem);
}

function hydrolysisScene(question: string, stem: string): SceneDocument | null {
  if (!/hydrolys/.test(stem) || organicHydrolysis(stem)) return null;
  if (spectatorClaimed(stem)) return null;
  if (/\bph\b|\[oh-\]|\[h\+\]/.test(stem)) return null;
  const account = hydrolysisAccount(stem);
  if (account === "both" || account === "neither" || !account) return null;
  if (polarity(stem, account.ionRe) === "no") return null;
  if (polarity(stem, token(account.spectator.toLowerCase())) === "yes") return null;
  const labels = [`ion=${account.ion}`, `not ${account.spectator}`, "hydrolysis"];
  return draw(question, "ion that hydrolyses", labels, `In ${account.spectator === "Na+" || account.spectator === "K+" ? "this salt of a weak acid and a strong base" : "this salt"}, ${account.ion} is the ion that hydrolyses. ${account.spectator} does not hydrolyse.`);
}

function saltConcentration(stem: string): number | null {
  const found = /salt concentration/.exec(stem);
  if (!found) return null;
  const rest = stem.slice(found.index + found[0].length, found.index + found[0].length + 48);
  if (/^(?:\s|=|is|of|:)*zero\b/.test(rest)) return 0;
  const skipped = /^[^0-9]*/.exec(rest);
  const start = skipped?.[0].length ?? 0;
  const parsed = readSignedNumber(rest.slice(start));
  if (!parsed) return null;
  const tail = rest.slice(start + parsed.length);
  if (!/^\s*m(?!ol)/.test(tail) && !/^\s*mol\s*\/\s*l/.test(tail)) return null;
  return parsed.value;
}

function weakAnion(stem: string): { name: string; re: RegExp } | null {
  if (/acetate|ch3coo/.test(stem)) return { name: "acetate", re: /acetate/ };
  if (/formate|methanoate|\bhcoo/.test(stem)) return { name: "formate", re: /formate/ };
  if (/cyanide|\bcn-/.test(stem)) return { name: "cyanide", re: /cyanide/ };
  if (/fluoride/.test(stem)) return { name: "fluoride", re: /fluoride/ };
  if (/benzoate/.test(stem)) return { name: "benzoate", re: /benzoate/ };
  return null;
}

/** pH = 14 + log10([OH-]) only when Kw is 1e-14. Any other Kw uses pH = -log10(Kw/[OH-]). */
function pHFromHydroxide(oh: number, kw: number): number {
  const standardKw = Math.abs(kw - 1e-14) <= 1e-20;
  return standardKw ? 14 + Math.log10(oh) : -Math.log10(kw / oh);
}

function saltSolutionScene(question: string, stem: string): SceneDocument | null {
  if (spectatorClaimed(stem)) return null;
  if (/activity coefficient|ionic strength/.test(stem)) return null;
  const kb = numberAfter(stem, /(?<![\w])kb\b/);
  const kw = numberAfter(stem, /(?<![\w])kw\b/);
  const concentration = saltConcentration(stem);
  const anion = weakAnion(stem);
  if (kb === null || kw === null || concentration === null || !anion) return null;
  if (!(kb > 0) || !(kw > 0) || !(concentration > 0)) return null;
  if (!/\bph\b|\[oh-\]|poh\b/.test(stem)) return null;
  if (polarity(stem, anion.re) === "no") return null;
  const hydroxide = Math.sqrt(kb * concentration);
  if (!(hydroxide > 0) || hydroxide >= concentration) return null;
  const pHLabel = formatPH(pHFromHydroxide(hydroxide, kw));
  if (!pHLabel) return null;
  return draw(question, "hydrolysis pH from Kb and Kw", [pHLabel, `ion=${anion.name}`, "not activity"], `[OH-] = sqrt(Kb c). pH follows from Kw and that hydroxide concentration. Kw = 1e-14 uses pH = 14 + log10([OH-]); any other Kw uses pH = -log10(Kw/[OH-]). Concentrations are used, not activities.`);
}

function namedLattice(stem: string): LatticeSalt | null {
  let best: { salt: LatticeSalt; index: number } | null = null;
  for (const salt of LATTICE) {
    for (const name of salt.names) {
      const found = token(name).exec(stem);
      if (!found) continue;
      if (!best || found.index < best.index) best = { salt, index: found.index };
    }
  }
  return best?.salt ?? null;
}

function solubilityPowers(salt: LatticeSalt): { factor: number; power: number; label: string } {
  const factor = salt.cx ** salt.cx * salt.ax ** salt.ax;
  const power = salt.cx + salt.ax;
  const label = factor === 1 ? `Ksp=s^${power}` : `Ksp=${factor}s^${power}`;
  return { factor, power, label };
}

function readKsp(stem: string): number | null {
  const re = /k_?sp\b|solubility product/gi;
  let found: RegExpExecArray | null;
  while ((found = re.exec(stem))) {
    const value = numberAfter(stem.slice(found.index), /^(?:k_?sp\b|solubility product)/);
    if (value !== null && value > 0 && value < 1) return value;
  }
  return null;
}

function qRelation(q: number, ksp: number): "Q<Ksp" | "Q>Ksp" | "Q=Ksp" {
  const ratio = q / ksp;
  if (ratio < 1 - 1e-6) return "Q<Ksp";
  if (ratio > 1 + 1e-6) return "Q>Ksp";
  return "Q=Ksp";
}

function ignoresVolume(stem: string): boolean {
  return /ignore[^.]{0,40}volume|neglect[^.]{0,30}volume|volume change is ignored/.test(stem);
}

function qStoryContradicts(stem: string): boolean {
  const below = /q\s*(?:is|lies|remains|was)?\s*(?:below|under|less than|smaller than|<)\s*k_?sp/.test(stem) || /q\s*<\s*k_?sp/.test(stem);
  const above = /q\s*(?:is|lies|remains|was)?\s*(?:above|over|greater than|larger than|more than|>)\s*k_?sp/.test(stem) || /q\s*>\s*k_?sp/.test(stem);
  const forms = /precipitate forms|forms a precipitate|will form a precipitate|precipitation occurs|ppt forms/.test(stem);
  const absent = /no precipitate|does not precipitate|will not precipitate|precipitation does not|no ppt/.test(stem);
  if (below && forms && !absent) return true;
  if (above && absent && !forms) return true;
  return false;
}

interface Portion {
  ml: number;
  molarity: number;
  ion: string;
}

function portionsOf(stem: string): Portion[] {
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(ml|l)\\s+of\\s+(\\d+(?:\\.\\d+)?)\\s*m\\s+(ca2\\+|ag\\+|pb2\\+|ba2\\+|mg2\\+|al3\\+|fe3\\+|zn2\\+|f-|cl-|br-|i-|so42-|oh-|cro42-)(?![a-z0-9])`, "gi");
  return [...stem.matchAll(re)].flatMap((match) => {
    const volume = Number(match[1]);
    const molarity = Number(match[3]);
    const ion = match[4]?.toLowerCase();
    if (!ion || !(volume > 0) || !(molarity > 0)) return [];
    return [{ ml: match[2]?.toLowerCase() === "l" ? volume * 1000 : volume, molarity, ion }];
  });
}

function mixtureVolume(stem: string, portions: readonly Portion[]): { ml: number; label: string } | null {
  const stated = /mixture volume(?:\s+is|\s*=)?\s*(\d+(?:\.\d+)?)\s*(ml|l)\b/.exec(stem);
  if (stated?.[1] && stated[2]) {
    const amount = Number(stated[1]);
    if (!(amount > 0)) return null;
    const ml = stated[2] === "l" ? amount * 1000 : amount;
    const shown = Number.isInteger(amount) ? String(amount) : formatMeasure(amount);
    const unit = stated[2] === "l" ? "L" : "mL";
    const label = shown ? `V=${shown} ${unit}` : "";
    return label.length > 0 && label.length <= 16 ? { ml, label } : null;
  }
  if (portions.length < 2) return null;
  const ml = portions.reduce((sum, portion) => sum + portion.ml, 0);
  if (!(ml > 0)) return null;
  const shown = Number.isInteger(ml) ? String(ml) : formatMeasure(ml);
  const label = shown ? `V=${shown} mL` : "";
  return label.length > 0 && label.length <= 16 ? { ml, label } : null;
}

function dilutedConcentrations(portions: readonly Portion[], totalMl: number): Map<string, number> {
  const concentrations = new Map<string, number>();
  for (const portion of portions) {
    const next = portion.molarity * (portion.ml / totalMl);
    concentrations.set(portion.ion, (concentrations.get(portion.ion) ?? 0) + next);
  }
  return concentrations;
}

function productOf(salt: LatticeSalt, concentrations: ReadonlyMap<string, number>): number | null {
  const cation = concentrations.get(salt.cation);
  const anion = concentrations.get(salt.anion);
  if (cation === undefined || anion === undefined || !(cation > 0) || !(anion > 0)) return null;
  return cation ** salt.cx * anion ** salt.ax;
}

function mixingScene(question: string, stem: string): SceneDocument | null {
  if (ignoresVolume(stem)) return null;
  const portions = portionsOf(stem);
  if (portions.length < 2) return null;
  const volume = mixtureVolume(stem, portions);
  const salt = namedLattice(stem) ?? LATTICE.find((candidate) => portions.some((portion) => portion.ion === candidate.cation) && portions.some((portion) => portion.ion === candidate.anion)) ?? null;
  const ksp = readKsp(stem);
  if (!volume || !salt || ksp === null) return null;
  const q = productOf(salt, dilutedConcentrations(portions, volume.ml));
  const qText = q === null ? null : formatMeasure(q);
  if (q === null || !qText) return null;
  const relation = qRelation(q, ksp);
  return draw(question, "ion product after mixing stated volumes", [`Q=${qText}`, volume.label, relation], `Each starting concentration is multiplied by its own volume over the mixture volume before Q is formed. For this salt Q uses the ion powers in the solubility product, so fluoride in CaF2 is squared. Q is then compared with Ksp.`);
}

function bracketConcentrations(stem: string): Map<string, number> {
  const ions = ["ca2+", "ag+", "pb2+", "ba2+", "mg2+", "al3+", "fe3+", "zn2+", "f-", "cl-", "br-", "i-", "so42-", "oh-", "cro42-"];
  const concentrations = new Map<string, number>();
  for (const ion of ions) {
    const value = numberAfter(stem, new RegExp(`\\[${escapeRegExp(ion)}\\]\\s*=`));
    if (value !== null) concentrations.set(ion, value);
  }
  return concentrations;
}

function ionProductScene(question: string, stem: string): SceneDocument | null {
  if (ignoresVolume(stem) || portionsOf(stem).length >= 2) return null;
  const concentrations = bracketConcentrations(stem);
  if (concentrations.size < 2) return null;
  const salt = namedLattice(stem) ?? LATTICE.find((candidate) => concentrations.has(candidate.cation) && concentrations.has(candidate.anion)) ?? null;
  const ksp = readKsp(stem);
  if (!salt || ksp === null) return null;
  const q = productOf(salt, concentrations);
  const qText = q === null ? null : formatMeasure(q);
  if (q === null || !qText) return null;
  const relation = qRelation(q, ksp);
  const precipitate = relation === "Q>Ksp" ? "ppt" : "no ppt";
  return draw(question, "Q compared with Ksp", [`Q=${qText}`, relation, precipitate], `Q is the product of the stated ion concentrations, each raised to the power in the salt's solubility product. CaF2 uses [F-]^2, not an s^2 stand-in. ${relation === "Q>Ksp" ? "Q exceeds Ksp, so a precipitate forms." : "Q does not exceed Ksp, so no precipitate forms."}`);
}

function solubilityScene(question: string, stem: string): SceneDocument | null {
  if (/mix/.test(stem) || organicHydrolysis(stem)) return null;
  if (!/solubilit|dissolv|\bfind s\b|pure water/.test(stem)) return null;
  if (/common\s*-?\s*ion/.test(stem)) return null;
  const salt = namedLattice(stem);
  const ksp = readKsp(stem);
  if (!salt || ksp === null) return null;
  const powers = solubilityPowers(salt);
  if (powers.label.length > 16) return null;
  const solubility = powers.power === 2 ? Math.sqrt(ksp / powers.factor) : powers.power === 3 ? Math.cbrt(ksp / powers.factor) : (ksp / powers.factor) ** (1 / powers.power);
  const solubilityText = formatMeasure(solubility);
  if (!solubilityText) return null;
  const labels = [`s=${solubilityText}`, powers.label];
  if (powers.factor !== 1) labels.push("pure water");
  const relation = powers.factor === 1 ? `s^${powers.power}` : `${powers.factor} s^${powers.power}`;
  return draw(question, "solubility from the stoichiometric Ksp", labels, `Ksp = ${relation} for this salt in pure water. CaF2 is 4 s^3 because [F-] = 2s; a 1:1 salt is s^2. The stated Ksp is not replaced, and s^2 is not used for CaF2.`);
}

function claimsSaltHydrolysis(stem: string): boolean {
  if (!/hydrolys/.test(stem) || organicHydrolysis(stem)) return false;
  return /sodium|potassium|ammonium|\bnacl\b|\bkcl\b|ch3coo|acetate|na\+|k\+|nh4|fluoride|cyanide|formate|anion|cation|\bsalt\b/.test(stem);
}

function ownsIonic(stem: string): boolean {
  if (/henderson|hasselbalch|\bbuffer\b/.test(stem)) return true;
  if (/common\s*-?\s*ion|pure weak acid/.test(stem)) return true;
  if (claimsSaltHydrolysis(stem)) return true;
  if (/(?<![\w])kb\b/.test(stem) && /salt concentration|acetate|formate|cyanide|fluoride|\[oh-\]/.test(stem)) return true;
  if (/k_?sp\b|solubility product/.test(stem)) return true;
  if ((/solubilit|dissolves\b|\bfind s\b/.test(stem)) && namedLattice(stem)) return true;
  if (/mix/.test(stem) && /ca2\+|ag\+|pb2\+|f-|cl-|k_?sp|precipitat/.test(stem)) return true;
  if (/\bq\b/.test(stem) && /k_?sp|precipitat/.test(stem)) return true;
  return false;
}

/** True when ionic equilibrium owns the stem, including stems that must not be drawn. */
export function claimsIonicEquilibrium(question: string): boolean {
  const stem = chemStem(question);
  if (VETO.test(stem)) return false;
  return ownsIonic(stem);
}

/** The figure, or null when the stem is claimed but the numbers or the chemistry do not ground one. */
export function buildIonicEquilibriumScene(
  question: string,
  _quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  const stem = chemStem(question);
  if (!claimsIonicEquilibrium(question)) return null;
  if (qStoryContradicts(stem)) return null;
  if (/mix/.test(stem) && ignoresVolume(stem)) return null;
  if (/pure weak acid|common\s*-?\s*ion/.test(stem)) return commonIonScene(question, stem);
  if (/buffer|henderson|hasselbalch/.test(stem) || (/stoichiometr/.test(stem) && /\b(?:naoh|koh|hcl)\b/.test(stem))) {
    return bufferScene(question, stem);
  }
  const saltPh = saltSolutionScene(question, stem);
  if (saltPh) return saltPh;
  if (/(?<![\w])kb\b/.test(stem) && /salt concentration|\[oh-\]/.test(stem)) return null;
  if (/hydrolys/.test(stem)) return hydrolysisScene(question, stem);
  if (portionsOf(stem).length >= 2 && /mix/.test(stem)) return mixingScene(question, stem);
  const product = ionProductScene(question, stem);
  if (product) return product;
  if (bracketConcentrations(stem).size >= 2 && /k_?sp\b|solubility product/.test(stem)) return null;
  return solubilityScene(question, stem);
}
