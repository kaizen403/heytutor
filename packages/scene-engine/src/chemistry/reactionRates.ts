/**
 * Rate of reaction, the factors that change it, and rate-law order versus
 * molecularity.
 *
 * The reaction rate divides each species derivative by its stoichiometric
 * coefficient: v = -(1/a) d[A]/dt = (1/b) d[B]/dt. One species derivative
 * is not v when that coefficient is not 1.
 *
 * Order comes from initial-rate ratios or from a written rate law. It is
 * not copied from the balanced equation. When the rate is in mol/L/s, the
 * unit of k follows the overall order: order 3 is L2/mol2 s.
 *
 * Molecularity is a positive integer for one elementary step. Order may be
 * fractional or zero. A complex reaction has no single molecularity.
 *
 * A catalyst changes the rate, not the reaction Delta G or Delta H. If the
 * stem gives no energy, the board says schematic and shows no number.
 *
 * Half-life plots, Arrhenius plots from 300 K to 310 K, and
 * concentration-time equilibrium graphs stay with the kinetics probes. A
 * claimed stem that cannot be grounded draws nothing.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, planQuantity, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_kinetics";

interface Species {
  coeff: number;
  formula: string;
}

interface Reaction {
  reactants: Species[];
  products: Species[];
}

interface Sample {
  species: string;
  derivative: number;
}

interface Ratio {
  species: string;
  conc: number;
  rate: number;
}

interface Experiment {
  conc: Map<string, number>;
  rate: number;
}

type Built = SceneDocument | "decline" | null;

const STOP = new Set([
  "the", "rate", "order", "find", "for", "and", "with", "from", "this", "that",
  "step", "reaction", "mol", "when", "then", "not", "its", "has", "per", "into",
  "does", "did", "are", "was", "were", "been", "have", "will", "can", "data",
]);

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));
}

function parseNumber(raw: string): number | null {
  const match = /^([+-]?\d+(?:\.\d+)?)(?:\s*(?:e([+-]?\d+)|(?:[x×*]\s*)?10\s*\^?\(?\s*([+-]?\d+)\s*\)?))?/.exec(raw.trim());
  if (!match?.[1]) return null;
  const mantissa = Number(match[1]);
  const exponent = match[2] !== undefined ? Number(match[2]) : match[3] !== undefined ? Number(match[3]) : 0;
  const value = mantissa * 10 ** exponent;
  return Number.isFinite(value) ? value : null;
}

const NUMBER_TAIL = String.raw`([+-]?\d+(?:\.\d+)?(?:\s*(?:e[+-]?\d+|(?:[x×*]\s*)?10\s*\^?\(?\s*[+-]?\d+\s*\)?))?)`;

function formatRate(value: number): string | null {
  if (!(value > 0) || !Number.isFinite(value)) return null;
  const snapped = Number(value.toPrecision(6));
  if (!(snapped > 0)) return null;
  if (snapped >= 0.01 && snapped < 1000) {
    const plain = snapped.toString();
    if (!plain.includes("e") && plain.length <= 12) return plain;
  }
  const exp = Math.floor(Math.log10(snapped) + 1e-12);
  let mantissa = snapped / 10 ** exp;
  mantissa = Math.round(mantissa * 1000) / 1000;
  let exponent = exp;
  if (mantissa >= 9.9995) {
    mantissa = 1;
    exponent += 1;
  }
  const man = Number.isInteger(mantissa) ? mantissa.toFixed(1) : String(mantissa);
  const text = `${man}e${exponent}`;
  return text.length <= 12 ? text : null;
}

function formatOrder(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const fractions: Array<[number, string]> = [
    [0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"],
    [0.5, "1/2"], [1.5, "3/2"], [2.5, "5/2"],
    [1 / 3, "1/3"], [2 / 3, "2/3"], [4 / 3, "4/3"], [5 / 3, "5/3"],
    [0.25, "1/4"], [0.75, "3/4"], [1.25, "5/4"],
  ];
  for (const [n, text] of fractions) {
    if (Math.abs(abs - n) < 1e-9) return `${sign}${text}`;
  }
  return `${sign}${Number(abs.toPrecision(3))}`;
}

function showFormula(token: string): string {
  return token.toUpperCase();
}

function kUnitFor(order: number): string | null {
  if (!Number.isFinite(order) || Math.abs(order - Math.round(order)) > 1e-9) return null;
  const n = Math.round(order);
  if (n === 0) return "mol/L s";
  if (n === 1) return "1/s";
  if (n === 2) return "L/mol s";
  if (n < 3 || n > 6) return null;
  return `L${n - 1}/mol${n - 1} s`;
}

function rateIsMolPerLitrePerSecond(stem: string): boolean {
  const text = stem.replace(/\^\(\s*-1\s*\)/g, "^-1");
  if (/mol\s*\/\s*l\s*\/\s*s/.test(text)) return true;
  if (/mol\s*l\s*\^\s*-1\s*s\s*\^\s*-1/.test(text)) return true;
  if (/mol\s*l\s*-1\s*s\s*-1/.test(text)) return true;
  return false;
}

function board(question: string, reason: string, labels: readonly string[], caption: string): SceneDocument | null {
  const unique: string[] = [];
  for (const label of labels) {
    if (!unique.includes(label)) unique.push(label);
  }
  if (unique.length < 1 || unique.length > 6) return null;
  if (unique.some((label) => label.length < 1 || label.length > 16)) return null;
  const scene = new ChemScene(question, reason, FAMILY);
  const ids = unique.map((label, index) => scene.text(`row${index}`, { x: 0.2, y: 2.6 - index * 0.8 }, label, "kinetics result"));
  scene.scene.group("result", ids, `${reason}. ${unique.join(", ")}.`);
  return scene.build({ caption });
}

function parseSpecies(part: string): Species | null {
  const match = /^(\d+(?:\.\d+)?)?\s*([a-z][a-z0-9]*)$/.exec(part.trim());
  if (!match?.[2] || STOP.has(match[2])) return null;
  const coeff = match[1] ? Number(match[1]) : 1;
  if (!Number.isInteger(coeff) || coeff < 1) return null;
  return { coeff, formula: match[2] };
}

function parseSide(side: string): Species[] | null {
  const parts = side.split("+");
  if (parts.length === 0) return null;
  const species: Species[] = [];
  for (const part of parts) {
    const item = parseSpecies(part);
    if (!item) return null;
    species.push(item);
  }
  return species;
}

function parseReaction(stem: string): Reaction | null {
  const cleaned = stem.replace(/\((?:g|l|s|aq)\)/g, "");
  const match = /((?:\d+(?:\.\d+)?\s*)?[a-z][a-z0-9]*(?:\s*\+\s*(?:\d+(?:\.\d+)?\s*)?[a-z][a-z0-9]*)*)\s*->\s*((?:\d+(?:\.\d+)?\s*)?[a-z][a-z0-9]*(?:\s*\+\s*(?:\d+(?:\.\d+)?\s*)?[a-z][a-z0-9]*)*)/.exec(cleaned);
  if (!match?.[1] || !match[2]) return null;
  const reactants = parseSide(match[1]);
  const products = parseSide(match[2]);
  if (!reactants || !products) return null;
  return { reactants, products };
}

function findSpecies(reaction: Reaction, formula: string): { coeff: number; reactant: boolean } | null {
  const reactants = reaction.reactants.filter((item) => item.formula === formula);
  const products = reaction.products.filter((item) => item.formula === formula);
  if (reactants.length + products.length !== 1) return null;
  const reactant = reactants[0];
  if (reactant) return { coeff: reactant.coeff, reactant: true };
  const product = products[0];
  if (!product) return null;
  return { coeff: product.coeff, reactant: false };
}

function handsOff(stem: string): boolean {
  if (/half[ -]?life|\bt\s*1\s*\/\s*2\b|t½/.test(stem)) return true;
  if (/arrhenius/.test(stem)) return true;
  if (/300\s*k[^.]{0,80}310\s*k/.test(stem)) return true;
  if (/activation energy/.test(stem) && /calculat|find the|arrhenius|300|310|diagram|profile|coordinate|lowers|reduces|decreases/.test(stem)) return true;
  if (/energy profile|transition state|activated complex|reaction coordinate/.test(stem)) return true;
  if (/collision theory|steric factor/.test(stem)) return true;
  if (/radioactiv|nuclear|decay constant|disintegrat/.test(stem)) return true;
  if (/le chatelier|chatelier/.test(stem)) return true;
  if (/attains? equilibrium|variation of concentration/.test(stem)) return true;
  if (/<=>/.test(stem) && /(?:graph|plot|with time)/.test(stem)) return true;
  if (/which of the following (?:plots|graphs)/.test(stem)) return true;
  if (/straight line/.test(stem) && /order/.test(stem) && /plot|graph|\bvs\b/.test(stem)) return true;
  if (/(?:ln|log)\s*\[?\s*a\]?/.test(stem) && /plot|graph|\bvs\b|versus|against|straight/.test(stem)) return true;
  if (/vs\.?\s*t\b|versus t\b|against t\b/.test(stem) && /\[a\]|1\/\[/.test(stem)) return true;
  if (/integrated rate/.test(stem)) return true;
  if (/first order/.test(stem) && /%\s*(?:of|decomposition|completion|complete)|decomposed in/.test(stem)) return true;
  if (/\b(?:zero|first|second)\s+order\b/.test(stem) && /(?:plot|graph|vs\.?\s*t|versus t|against t)/.test(stem)) return true;
  if (/bond order/.test(stem)) return true;
  if (/rates?\s+are\s+equal/.test(stem) && /equilibri/.test(stem)) return true;
  return false;
}

function hasExperimentalOrderData(stem: string): boolean {
  if (/doubl|tripl|quadrupl|halv/.test(stem) && /\[/.test(stem) && /rate/.test(stem)) return true;
  if (/rate\s*=\s*k\s*\[/.test(stem)) return true;
  if (/initial rate/.test(stem) && /\[/.test(stem) && /rate\s*(?:=|is)\s*\d/.test(stem)) return true;
  return false;
}

function hasDerivative(stem: string): boolean {
  return /d\[[a-z0-9]+\]\s*\/\s*dt/.test(stem)
    || /rate of (?:formation|appearance|disappearance|decomposition|consumption)/.test(stem)
    || /\[([a-z0-9]+)\]\s+(?:decreases|increases|falls|drops|rises)\s+from/.test(stem);
}

function stoichiometricCue(stem: string): boolean {
  if (/d\[[a-z0-9]+\]\s*\/\s*dt/.test(stem)) return true;
  if (/rate of (?:formation|appearance|disappearance|decomposition|consumption)/.test(stem)) return true;
  if (/(?:reaction rate|rate of (?:the )?reaction|average rate)/.test(stem) && /->/.test(stem)) return true;
  if (/(?:find|calculate|determine|what is)\s+(?:the\s+)?(?:reaction rate|rate of (?:the )?reaction|average rate)/.test(stem) && /->|concentration|mol\/l|d\[/.test(stem)) return true;
  return false;
}

function orderCue(stem: string): boolean {
  if (/initial rate/.test(stem) && /\[/.test(stem)) return true;
  if (/rate\s*=\s*k\s*\[/.test(stem)) return true;
  if (/doubl|tripl|quadrupl|halv/.test(stem) && /\[/.test(stem) && /rate/.test(stem)) return true;
  if (/units?\s+of\s+(?:the\s+)?(?:rate\s+constant|\bk\b)/.test(stem) && /order|rate/.test(stem)) return true;
  if (/\border\b/.test(stem) && (/rate/.test(stem) || /->/.test(stem) || /molecularit/.test(stem))) return true;
  return false;
}

function molecularityCue(stem: string): boolean {
  if (/molecularit|unimolecular|bimolecular|termolecular/.test(stem)) return true;
  if (/elementary/.test(stem) && /step|reaction|molecular/.test(stem)) return true;
  if (/complex reaction/.test(stem) && /molecularit|step/.test(stem)) return true;
  return false;
}

function catalystCue(stem: string): boolean {
  if (!/catalyst/.test(stem) || !/rate/.test(stem)) return false;
  if (/activation energy|energy profile|reaction coordinate|transition state/.test(stem)) return false;
  if (/equilibri/.test(stem) && /composition|\bk\b/.test(stem) && !/delta\s*[gh]|gibbs|enthalpy/.test(stem)) return false;
  return /delta\s*[gh]|δ\s*[gh]|∆\s*[gh]|gibbs|enthalpy/.test(stem);
}

function factorCue(stem: string): boolean {
  if (!/\brate\b/.test(stem)) return false;
  if (/doubl|rate\s*=\s*k|initial rate|d\[/.test(stem)) return false;
  if (/activation energy|arrhenius/.test(stem)) return false;
  return (/concentration/.test(stem) || /temperature/.test(stem) || /pressure/.test(stem))
    && /increas|decreas|rais|lower|does not|do not|no effect/.test(stem);
}

/** True when this chapter owns the stem, including honest declines. */
export function claimsReactionRates(question: string): boolean {
  const stem = chemStem(question);
  if (handsOff(stem)) return false;
  return stoichiometricCue(stem) || orderCue(stem) || molecularityCue(stem) || catalystCue(stem) || factorCue(stem);
}

function asksNumericRate(stem: string): boolean {
  if (/d\[[a-z0-9]+\]\s*\/\s*dt/.test(stem)) return true;
  if (/rate of (?:formation|appearance|disappearance|decomposition|consumption)/.test(stem)) return true;
  if (/(?:find|calculate|determine|what is)\s+(?:the\s+)?(?:reaction rate|rate of (?:the )?reaction|average rate)/.test(stem)) return true;
  if (/reaction rate\s*(?:is|=)/.test(stem)) return true;
  return false;
}

function assertsNegativeRate(stem: string): boolean {
  if (/negative rate|rate is negative/.test(stem)) return true;
  if (/reaction rate\s*(?:is|=)\s*-\d/.test(stem)) return true;
  if (/rate of (?:the )?reaction\s*(?:is|=)\s*-\d/.test(stem)) return true;
  return false;
}

function orderCopied(stem: string): boolean {
  if (hasExperimentalOrderData(stem) || hasDerivative(stem)) return false;
  if (!/->/.test(stem) || !/\border\b/.test(stem)) return false;
  if (/molecularit|elementary|bimolecular|unimolecular|termolecular/.test(stem)) return false;
  return true;
}

function readNumberMatch(text: string | undefined): number | null {
  if (!text) return null;
  return parseNumber(text);
}

function pushSample(samples: Sample[], species: string, derivative: number, bad: { value: boolean }): void {
  if (!Number.isFinite(derivative)) {
    bad.value = true;
    return;
  }
  const existing = samples.find((sample) => sample.species === species);
  if (existing && !close(existing.derivative, derivative)) {
    bad.value = true;
    return;
  }
  if (!existing) samples.push({ species, derivative });
}

function readDerivatives(stem: string): Sample[] | null {
  const samples: Sample[] = [];
  const bad = { value: false };
  for (const match of stem.matchAll(new RegExp(String.raw`d\[([a-z0-9]+)\]\s*\/\s*dt\s*=\s*${NUMBER_TAIL}`, "g"))) {
    const value = readNumberMatch(match[2]);
    if (value === null) return null;
    pushSample(samples, match[1] ?? "", value, bad);
  }
  for (const match of stem.matchAll(new RegExp(String.raw`rate of (?:formation|appearance) of \[?([a-z0-9]+)\]?\s*(?:is|=)\s*${NUMBER_TAIL}`, "g"))) {
    const value = readNumberMatch(match[2]);
    if (value === null || !(value > 0)) return null;
    pushSample(samples, match[1] ?? "", value, bad);
  }
  for (const match of stem.matchAll(new RegExp(String.raw`rate of (?:disappearance|decomposition|consumption) of \[?([a-z0-9]+)\]?\s*(?:is|=)\s*${NUMBER_TAIL}`, "g"))) {
    const value = readNumberMatch(match[2]);
    if (value === null || !(value > 0)) return null;
    pushSample(samples, match[1] ?? "", -value, bad);
  }
  return bad.value ? null : samples;
}

function readAverages(stem: string): Sample[] | null {
  const samples: Sample[] = [];
  const re = new RegExp(String.raw`(?:concentration of |\[)([a-z0-9]+)\]?\s+(decreases|increases|falls|drops|rises)\s+from\s+${NUMBER_TAIL}\s+(?:mol\/l\s+)?to\s+${NUMBER_TAIL}\s+(?:mol\/l\s+)?in\s+${NUMBER_TAIL}\s*(s|sec|min|h)\b`, "g");
  for (const match of stem.matchAll(re)) {
    const species = match[1] ?? "";
    const direction = match[2] ?? "";
    const start = readNumberMatch(match[3]);
    const end = readNumberMatch(match[4]);
    const dt = readNumberMatch(match[5]);
    if (start === null || end === null || dt === null || !(dt > 0)) return null;
    const down = /decreas|fall|drop/.test(direction);
    if (down && !(end < start)) return null;
    if (!down && !(end > start)) return null;
    const existing = samples.find((sample) => sample.species === species);
    const derivative = (end - start) / dt;
    if (existing && !close(existing.derivative, derivative)) return null;
    if (!existing) samples.push({ species, derivative });
  }
  return samples;
}

function reactionRate(reaction: Reaction, samples: readonly Sample[]): number | null {
  if (samples.length === 0) return null;
  let value: number | null = null;
  for (const sample of samples) {
    const part = findSpecies(reaction, sample.species);
    if (!part || part.coeff < 1) return null;
    const next = part.reactant ? -sample.derivative / part.coeff : sample.derivative / part.coeff;
    if (!Number.isFinite(next)) return null;
    if (value !== null && !close(value, next)) return null;
    value = next;
  }
  return value;
}

function normalizedLabel(coeff: number, formula: string, reactant: boolean): string | null {
  const factor = coeff === 1 ? "1" : `1/${coeff}`;
  const signed = reactant ? `-${factor}` : factor;
  const text = `${signed} d[${showFormula(formula)}]/dt`;
  return text.length <= 16 ? text : null;
}

function notLabel(formula: string): string | null {
  const text = `not d[${showFormula(formula)}]/dt`;
  return text.length <= 16 ? text : null;
}

function rateUnitLabel(stem: string): string | null {
  if (!rateIsMolPerLitrePerSecond(stem) && !/mol\s*\/\s*l/.test(stem)) return null;
  if (/in\s+\d+(?:\.\d+)?\s*min\b/.test(stem)) return "mol/L min";
  if (/in\s+\d+(?:\.\d+)?\s*h\b/.test(stem)) return "mol/L h";
  if (rateIsMolPerLitrePerSecond(stem) || /in\s+\d+(?:\.\d+)?\s*s\b/.test(stem)) return "mol/L s";
  return null;
}

function tryStoichiometric(question: string, stem: string, quantities: readonly ChemPlanQuantity[]): Built {
  const derivatives = readDerivatives(stem);
  const averages = readAverages(stem);
  if (!derivatives || !averages) return "decline";
  const samples = [...derivatives];
  for (const average of averages) {
    const existing = samples.find((sample) => sample.species === average.species);
    if (existing && !close(existing.derivative, average.derivative)) return "decline";
    if (!existing) samples.push(average);
  }
  const reaction = parseReaction(stem);
  if (samples.length === 0) {
    if (asksNumericRate(stem) && (reaction !== null || /concentration|mol\/l/.test(stem))) return "decline";
    return null;
  }
  if (!reaction) return "decline";
  const v = reactionRate(reaction, samples);
  if (v === null || !(v > 0)) return "decline";
  const planned = planQuantity(quantities, ["v", "rate", "reactionRate"]);
  if (planned !== null && !close(planned, v)) return "decline";
  const shown = formatRate(v);
  if (!shown || !close(Number(shown), v)) return "decline";
  const labels = [`v=${shown}`];
  const add = (text: string | null, required: boolean): boolean => {
    if (!text) return !required;
    if (labels.includes(text)) return true;
    if (labels.length >= 6 || text.length > 16) return !required;
    labels.push(text);
    return true;
  };
  for (const sample of samples) {
    const part = findSpecies(reaction, sample.species);
    if (!part) return "decline";
    if (!close(Math.abs(sample.derivative), v)) {
      if (!add(notLabel(sample.species), true)) return "decline";
    }
    add(normalizedLabel(part.coeff, sample.species, part.reactant), false);
  }
  const reactant = reaction.reactants.find((item) => item.coeff !== 1);
  const product = reaction.products.find((item) => item.coeff !== 1);
  if (reactant) add(normalizedLabel(reactant.coeff, reactant.formula, true), false);
  if (product) add(normalizedLabel(product.coeff, product.formula, false), false);
  add(rateUnitLabel(stem), false);
  return board(
    question,
    "reaction rate from stoichiometric coefficients",
    labels,
    "The reaction rate is each species derivative divided by its stoichiometric coefficient. A reactant contributes with a minus sign. One species derivative is not the reaction rate when its coefficient is not 1.",
  );
}

function snapOrder(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const options: number[] = [];
  for (let n = -2; n <= 6; n += 1) {
    options.push(n, n + 0.5, n + 1 / 3, n + 2 / 3);
  }
  let best: number | null = null;
  let bestErr = 0.015;
  for (const option of options) {
    const err = Math.abs(value - option);
    if (err < bestErr) {
      bestErr = err;
      best = option;
    }
  }
  return best;
}

function concentrationChanges(sentence: string): Array<{ species: string; factor: number }> | "decline" {
  const found: Array<{ species: string; factor: number }> = [];
  const note = (species: string | undefined, factor: number): void => {
    if (!species || !(factor > 0)) return;
    const existing = found.find((item) => item.species === species);
    if (existing && !close(existing.factor, factor)) found.push({ species, factor: Number.NaN });
    else if (!existing) found.push({ species, factor });
  };
  for (const match of sentence.matchAll(/doubl\w*\s+\[([a-z0-9]+)\]/g)) note(match[1], 2);
  for (const match of sentence.matchAll(/doubl\w*\s+the\s+concentration\s+of\s+([a-z0-9]+)/g)) note(match[1], 2);
  for (const match of sentence.matchAll(/\[([a-z0-9]+)\]\s+is\s+doubled/g)) note(match[1], 2);
  for (const match of sentence.matchAll(/concentration\s+of\s+([a-z0-9]+)\s+is\s+doubled/g)) note(match[1], 2);
  for (const match of sentence.matchAll(/tripl\w*\s+\[([a-z0-9]+)\]/g)) note(match[1], 3);
  for (const match of sentence.matchAll(/\[([a-z0-9]+)\]\s+is\s+tripled/g)) note(match[1], 3);
  for (const match of sentence.matchAll(/quadrupl\w*\s+\[([a-z0-9]+)\]/g)) note(match[1], 4);
  for (const match of sentence.matchAll(/halv\w*\s+(?:the\s+concentration\s+of\s+)?\[?([a-z0-9]+)\]?/g)) {
    if (match[1] && match[1] !== "rate" && match[1] !== "the") note(match[1], 0.5);
  }
  const made = /\[([a-z0-9]+)\]\s+is\s+(?:made|increased|multiplied)(?:\s+by)?\s*(?:a\s+factor\s+of\s+)?(\d+(?:\.\d+)?)(?:\s*times)?/.exec(sentence);
  if (made?.[1] && made[2]) note(made[1], Number(made[2]));
  if (found.some((item) => !Number.isFinite(item.factor))) return "decline";
  return found;
}

function rateFactorOf(sentence: string): number | "decline" | null {
  const multiplied = /multipli\w*\s+the\s+rate\s+by\s*([+-]?\d+(?:\.\d+)?)/.exec(sentence);
  if (multiplied?.[1]) {
    const value = Number(multiplied[1]);
    return value > 0 ? value : "decline";
  }
  const by = /rate\s+is\s+multipli\w*\s+by\s*([+-]?\d+(?:\.\d+)?)/.exec(sentence);
  if (by?.[1]) {
    const value = Number(by[1]);
    return value > 0 ? value : "decline";
  }
  const becomes = /rate\s+(?:becomes|is)\s*([+-]?\d+(?:\.\d+)?)\s*times/.exec(sentence);
  if (becomes?.[1]) {
    const value = Number(becomes[1]);
    return value > 0 ? value : "decline";
  }
  const factor = /rate[^.]{0,40}factor of\s*([+-]?\d+(?:\.\d+)?)/.exec(sentence);
  if (factor?.[1]) {
    const value = Number(factor[1]);
    return value > 0 ? value : "decline";
  }
  if (/does not change the rate|rate (?:is |does )?not change|rate (?:is )?unchanged|rate remains the same|rate stays the same/.test(sentence)) return 1;
  if (/doubl\w*\s+the\s+rate|the\s+rate\s+doubl|rate\s+doubl/.test(sentence)) return 2;
  if (/tripl\w*\s+the\s+rate|the\s+rate\s+tripl/.test(sentence)) return 3;
  if (/quadrupl\w*\s+the\s+rate|the\s+rate\s+quadrupl/.test(sentence)) return 4;
  if (/halv\w*\s+the\s+rate|the\s+rate\s+halv/.test(sentence)) return 0.5;
  const times = /rate[^.]{0,24}(\d+(?:\.\d+)?)\s*times/.exec(sentence);
  if (times?.[1]) {
    const value = Number(times[1]);
    return value > 0 ? value : "decline";
  }
  return null;
}

function collectRatios(stem: string): Ratio[] | "decline" | null {
  const ratios: Ratio[] = [];
  let saw = false;
  for (const sentence of stem.split(/[.;]/)) {
    const changes = concentrationChanges(sentence);
    if (changes === "decline") return "decline";
    if (changes.length === 0) continue;
    saw = true;
    if (changes.length !== 1) continue;
    const change = changes[0];
    if (!change || !(change.factor > 0) || close(change.factor, 1)) continue;
    const rate = rateFactorOf(sentence);
    if (rate === "decline") return "decline";
    if (rate === null) continue;
    if (!(rate > 0)) return "decline";
    ratios.push({ species: change.species, conc: change.factor, rate });
  }
  if (ratios.length === 0) return saw ? "decline" : null;
  return ratios;
}

function ordersFromRatios(ratios: readonly Ratio[]): Map<string, number> | null {
  const orders = new Map<string, number>();
  for (const ratio of ratios) {
    const raw = Math.log(ratio.rate) / Math.log(ratio.conc);
    const snapped = snapOrder(raw);
    if (snapped === null) return null;
    const existing = orders.get(ratio.species);
    if (existing !== undefined && !close(existing, snapped)) return null;
    orders.set(ratio.species, snapped);
  }
  return orders.size > 0 ? orders : null;
}

function parseExperiments(stem: string): Experiment[] | null {
  const experiments: Experiment[] = [];
  for (const part of stem.split(/[.;]/)) {
    const conc = new Map<string, number>();
    let bad = false;
    for (const match of part.matchAll(new RegExp(String.raw`\[([a-z0-9]+)\]\s*=\s*${NUMBER_TAIL}`, "g"))) {
      const value = readNumberMatch(match[2]);
      if (value === null || !(value > 0)) bad = true;
      else conc.set(match[1] ?? "", value ?? 0);
    }
    if (bad) return null;
    if (conc.size === 0) continue;
    const rateMatch = new RegExp(String.raw`(?:initial\s+)?rate\s*(?:=|is)\s*${NUMBER_TAIL}`).exec(part);
    if (!rateMatch) continue;
    const rate = readNumberMatch(rateMatch[1]);
    if (rate === null) return null;
    if (!(rate > 0)) return null;
    experiments.push({ conc, rate });
  }
  if (experiments.length < 2) return null;
  const keys = [...experiments[0]!.conc.keys()].sort().join(",");
  if (experiments.some((experiment) => [...experiment.conc.keys()].sort().join(",") !== keys)) return null;
  return experiments;
}

function ordersFromExperiments(experiments: readonly Experiment[]): Map<string, number> | null {
  const names = [...experiments[0]!.conc.keys()];
  const orders = new Map<string, number>();
  for (const name of names) {
    const estimates: number[] = [];
    for (let i = 0; i < experiments.length; i += 1) {
      for (let j = i + 1; j < experiments.length; j += 1) {
        const left = experiments[i]!;
        const right = experiments[j]!;
        let isolated = true;
        for (const other of names) {
          if (other === name) continue;
          if (!close(left.conc.get(other) ?? 0, right.conc.get(other) ?? 0)) isolated = false;
        }
        const a = left.conc.get(name) ?? 0;
        const b = right.conc.get(name) ?? 0;
        if (!isolated || close(a, b)) continue;
        if (!(a > 0) || !(b > 0)) return null;
        estimates.push(Math.log(right.rate / left.rate) / Math.log(b / a));
      }
    }
    if (estimates.length === 0) return null;
    const snapped = snapOrder(estimates[0] ?? Number.NaN);
    if (snapped === null || estimates.some((estimate) => Math.abs(estimate - snapped) > 0.02)) return null;
    orders.set(name, snapped);
  }
  return orders;
}

function parseRateLaw(stem: string): Map<string, number> | null {
  const start = /rate\s*=\s*k\b/.exec(stem);
  if (!start) return null;
  const rest = stem.slice(start.index + start[0].length);
  const stop = rest.search(/[.]/);
  const body = stop >= 0 ? rest.slice(0, stop) : rest;
  const orders = new Map<string, number>();
  for (const match of body.matchAll(/\[([a-z0-9]+)\](?:\s*\^\s*(?:\(\s*(\d+)\s*\/\s*(\d+)\s*\)|(\d+(?:\.\d+)?)))?/g)) {
    const name = match[1];
    if (!name) return null;
    let exp = 1;
    if (match[2] && match[3]) exp = Number(match[2]) / Number(match[3]);
    else if (match[4]) exp = Number(match[4]);
    if (!Number.isFinite(exp)) return null;
    orders.set(name, exp);
  }
  return orders.size > 0 ? orders : null;
}

function mergeOrders(parts: Array<Map<string, number> | null>): Map<string, number> | "conflict" | null {
  const present = parts.filter((part): part is Map<string, number> => part !== null);
  if (present.length === 0) return null;
  const orders = new Map<string, number>();
  for (const part of present) {
    for (const [name, order] of part) {
      const existing = orders.get(name);
      if (existing !== undefined && !close(existing, order)) return "conflict";
      orders.set(name, order);
    }
  }
  return orders.size > 0 ? orders : null;
}

function statedSpeciesOrders(stem: string): Map<string, number> | null {
  const orders = new Map<string, number>();
  for (const match of stem.matchAll(/order\s+(?:with respect to|in|of|for)\s+([a-z0-9]+)\s*(?:is|=)\s*(\d+\s*\/\s*\d+|\d+(?:\.\d+)?)/g)) {
    const name = match[1];
    const raw = match[2];
    if (!name || !raw) continue;
    const value = raw.includes("/") ? Number(raw.split("/")[0]) / Number(raw.split("/")[1]) : Number(raw);
    if (!Number.isFinite(value)) return null;
    const existing = orders.get(name);
    if (existing !== undefined && !close(existing, value)) return null;
    orders.set(name, value);
  }
  return orders.size > 0 ? orders : null;
}

function mentionedSpecies(stem: string): string[] {
  const names: string[] = [];
  for (const match of stem.matchAll(/\[([a-z0-9]+)\]/g)) {
    const name = match[1];
    if (name && !names.includes(name) && !STOP.has(name)) names.push(name);
  }
  return names;
}

function overallOrder(orders: Map<string, number>, stem: string, reaction: Reaction | null): number | null {
  if (reaction) {
    if (reaction.reactants.some((item) => !orders.has(item.formula))) return null;
    return reaction.reactants.reduce((sum, item) => sum + (orders.get(item.formula) ?? 0), 0);
  }
  const named = mentionedSpecies(stem).filter((name) => name !== "k");
  if (named.length > 0 && named.some((name) => !orders.has(name))) return null;
  let sum = 0;
  for (const order of orders.values()) sum += order;
  return sum;
}

function stoichiometryDisagrees(reaction: Reaction | null, orders: Map<string, number>): boolean {
  if (!reaction) return false;
  return reaction.reactants.some((item) => {
    const order = orders.get(item.formula);
    return order !== undefined && !close(order, item.coeff);
  });
}

function statedUnitConflict(stem: string, expected: string): boolean {
  const window = /(?:units?\s+of\s+k|k\s+has\s+units?|units?\s+of\s+the\s+rate\s+constant)\s+([^.]{0,40})/.exec(stem);
  if (!window?.[1]) return false;
  const phrase = window[1];
  if (expected === "L2/mol2 s") {
    if (/l\s*\^?\s*2|l2/.test(phrase)) return false;
    return /1\/s|s\s*\^\s*-1|s-1|per second|l\/mol/.test(phrase);
  }
  if (expected === "1/s") return /l2\/mol2|l\s*\^?\s*2/.test(phrase);
  if (expected === "L/mol s") return /l2\/mol2|1\/s/.test(phrase);
  if (expected === "mol/L s") return /l\/mol|l2\/mol2|1\/s/.test(phrase);
  return false;
}

function rateConstant(experiments: readonly Experiment[], orders: Map<string, number>): number | null {
  const values: number[] = [];
  for (const experiment of experiments) {
    let denom = 1;
    for (const [name, order] of orders) {
      const conc = experiment.conc.get(name);
      if (conc === undefined || !(conc > 0)) return null;
      denom *= conc ** order;
    }
    if (!(denom > 0)) return null;
    values.push(experiment.rate / denom);
  }
  const first = values[0];
  if (first === undefined || values.some((value) => !close(value, first))) return null;
  return first;
}

function asksForUnits(stem: string): boolean {
  return /units?\s+of\s+(?:the\s+)?(?:rate\s+constant|\bk\b)|what (?:is|are) the units/.test(stem);
}

function tryOrder(question: string, stem: string): Built {
  const ratios = collectRatios(stem);
  if (ratios === "decline") return "decline";
  const experiments = parseExperiments(stem);
  const law = parseRateLaw(stem);
  const fromRatios = ratios ? ordersFromRatios(ratios) : null;
  if (ratios && !fromRatios) return "decline";
  const fromExperiments = experiments ? ordersFromExperiments(experiments) : null;
  if (experiments && !fromExperiments) return "decline";
  const merged = mergeOrders([fromRatios, fromExperiments, law]);
  if (merged === "conflict") return "decline";
  if (!merged) return null;
  const stated = statedSpeciesOrders(stem);
  if (stated) {
    for (const [name, order] of stated) {
      const actual = merged.get(name);
      if (actual !== undefined && !close(actual, order)) return "decline";
    }
  }
  const reaction = parseReaction(stem);
  const overall = overallOrder(merged, stem, reaction);
  const knownUnit = rateIsMolPerLitrePerSecond(stem);
  const unit = knownUnit && overall !== null ? kUnitFor(overall) : null;
  if ((knownUnit && overall !== null && !unit) || (asksForUnits(stem) && !unit)) return "decline";
  if (unit && statedUnitConflict(stem, unit)) return "decline";
  const labels: string[] = [];
  for (const [name, order] of merged) {
    const text = `order ${showFormula(name)}=${formatOrder(order)}`;
    if (text.length > 16) return "decline";
    labels.push(text);
  }
  if (unit) labels.push(unit);
  if (stoichiometryDisagrees(reaction, merged) && labels.length < 6) labels.push("not stoich");
  if (experiments && fromExperiments) {
    const k = rateConstant(experiments, merged);
    if (k === null) return "decline";
    const kText = formatRate(k);
    if (kText && labels.length < 6) {
      const label = `k=${kText}`;
      if (label.length <= 16) labels.push(label);
    }
  }
  return board(
    question,
    "orders from initial rates and the matching unit of k",
    labels,
    "Each order is log(rate ratio) / log(concentration ratio), or the exponent in the rate law. The balanced equation does not supply the order. For a rate in mol/L/s, order 3 gives k the unit L2/mol2 s.",
  );
}

function readOrderValue(raw: string): number | null {
  if (raw.includes("/")) {
    const [num, den] = raw.split("/");
    const value = Number(num) / Number(den);
    return Number.isFinite(value) ? value : null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function assertsBadMolecularity(stem: string): boolean {
  if (!/molecularit/.test(stem)) return false;
  if (/not a molecularity|is not a molecularity|cannot be a molecularity|no single molecularity/.test(stem)
    && !/molecularity\s+is\s+[+-]?\d/.test(stem)) {
    // A denial can share the stem with a separate false assignment.
  }
  const re = /molecularit\w*(?:\s+of(?:\s+the\s+(?:reaction|step))?)?\s*(?:=|is|equals)?\s*([+-]?\d+(?:\.\d+)?|\d+\s*\/\s*\d+)/g;
  for (const match of stem.matchAll(re)) {
    const index = match.index ?? 0;
    const before = stem.slice(Math.max(0, index - 48), index);
    if (/\b(?:not|never|no|cannot|can't)\b|n't/.test(before)) continue;
    const value = readOrderValue(match[1] ?? "");
    if (value === null || !(value > 0) || Math.abs(value - Math.round(value)) > 1e-9) return true;
  }
  return false;
}

function complexAssignedMolecularity(stem: string): boolean {
  if (!/complex reaction|multi-?step|two steps|more than one step/.test(stem)) return false;
  if (/no single molecular|does not have a (?:single )?molecular|has no (?:single )?molecular|without a single molecular/.test(stem)) return false;
  return /molecularit\w*\s*(?:=|is|equals|of)?\s*\d/.test(stem);
}

function wordMolecularity(stem: string): number | "conflict" | null {
  const hits: number[] = [];
  if (/unimolecular/.test(stem)) hits.push(1);
  if (/bimolecular/.test(stem)) hits.push(2);
  if (/termolecular/.test(stem)) hits.push(3);
  if (hits.length > 1) return "conflict";
  return hits[0] ?? null;
}

function statedIntegerMolecularity(stem: string): number | null {
  const match = /molecularit\w*(?:\s+of(?:\s+the\s+(?:reaction|step))?)?\s*(?:=|is|equals)?\s*(\d+)(?!\d|\.|\/)/.exec(stem);
  if (!match?.[1]) return null;
  const index = match.index ?? 0;
  const before = stem.slice(Math.max(0, index - 48), index);
  if (/\b(?:not|never|no|cannot|can't)\b|n't/.test(before)) return null;
  return Number(match[1]);
}

function statedOverallOrder(stem: string): number | null {
  const fraction = /order(?:\s+of\s+the\s+reaction)?\s+is\s+(\d+)\s*\/\s*(\d+)/.exec(stem);
  if (fraction?.[1] && fraction[2]) return Number(fraction[1]) / Number(fraction[2]);
  const decimal = /order(?:\s+of\s+the\s+reaction)?\s+is\s+([+-]?\d+(?:\.\d+)?)/.exec(stem);
  if (decimal?.[1]) return Number(decimal[1]);
  if (/zero order/.test(stem)) return 0;
  return null;
}

function orderLabel(value: number, stem: string): string | null {
  if (Math.abs(value - 1.5) < 1e-9 && /1\.5/.test(stem)) return "order=1.5";
  if (Math.abs(value) < 1e-9) return "order=0";
  const text = `order=${formatOrder(value)}`;
  return text.length <= 16 ? text : null;
}

function tryMolecularity(question: string, stem: string): Built {
  if (assertsBadMolecularity(stem) || complexAssignedMolecularity(stem)) return "decline";
  const labels: string[] = [];
  const elementaryWord = /elementary|single step|one elementary step/.test(stem);
  const word = wordMolecularity(stem);
  if (word === "conflict") return "decline";
  const reaction = elementaryWord ? parseReaction(stem) : null;
  let fromEquation: number | null = null;
  if (elementaryWord && reaction) {
    const sum = reaction.reactants.reduce((total, item) => total + item.coeff, 0);
    if (!Number.isInteger(sum) || sum < 1) return "decline";
    fromEquation = sum;
  }
  if (typeof word === "number" && fromEquation !== null && word !== fromEquation) return "decline";
  const molecularity = typeof word === "number" ? word : fromEquation;
  const stated = statedIntegerMolecularity(stem);
  if (stated !== null && molecularity !== null && stated !== molecularity) return "decline";
  if (molecularity !== null && molecularity >= 1) {
    labels.push(`mol=${molecularity}`);
    if (elementaryWord || word !== null) labels.push("elementary");
    if (molecularity === 1) labels.push("unimolecular");
    if (molecularity === 2) labels.push("bimolecular");
    if (molecularity === 3) labels.push("termolecular");
  }
  const deniesSingle = /no single molecularity|does not have a (?:single )?molecularity|has no (?:single )?molecularity/.test(stem);
  if (/complex reaction|two steps|multi-?step|more than one step/.test(stem) && deniesSingle) {
    labels.push("complex", "no single mol");
  }
  const deniesMolecularity = /not a molecularity|is not a molecularity|cannot be a molecularity/.test(stem);
  if (deniesMolecularity) {
    const overall = statedOverallOrder(stem);
    if (overall !== null) {
      const text = orderLabel(overall, stem);
      if (!text) return "decline";
      labels.push(text);
    } else if (/fractional/.test(stem)) {
      labels.push("fractional");
    }
    labels.push("not mol");
  }
  if (labels.length === 0) return null;
  labels.push("schematic");
  return board(
    question,
    "molecularity of one elementary step, distinct from order",
    labels,
    "Molecularity counts reactant particles in one elementary step and is a positive integer. Order may be fractional or zero. A complex reaction has no single molecularity. This classification is schematic, not measured data.",
  );
}

function catalystIsFalse(stem: string): boolean {
  if (/catalyst[^.]{0,80}does not change the rate/.test(stem)) return true;
  for (const sentence of stem.split(/[.]/)) {
    const neg = /does not|do not|not change|unchanged|no effect|stays the same|remains the same/.test(sentence);
    const thermo = /delta\s*[gh]|δ\s*[gh]|∆\s*[gh]|gibbs|enthalpy/.test(sentence);
    if (thermo && /chang|alter|affect|increas|decreas/.test(sentence) && !neg) return true;
    if (/\brate\b/.test(sentence) && /does not change the rate|rate (?:is )?unchanged|no effect on the rate/.test(sentence)) return true;
  }
  return false;
}

function tryCatalyst(question: string, stem: string): Built {
  if (!/catalyst/.test(stem) || !/\brate\b/.test(stem)) return null;
  if (/activation energy|energy profile|reaction coordinate|transition state/.test(stem)) return null;
  const g = /delta\s*g|δ\s*g|∆\s*g|gibbs/.test(stem);
  const h = /delta\s*h|δ\s*h|∆\s*h|enthalpy/.test(stem);
  if (!g && !h) return null;
  if (catalystIsFalse(stem)) return "decline";
  if (!/does not|do not|unchanged|no effect|stays the same|remains the same|not change/.test(stem)) return "decline";
  const labels: string[] = [];
  if (/increas|faster|speed/.test(stem)) labels.push("rate up");
  else if (/decreas|slower|inhibit/.test(stem)) labels.push("rate down");
  else labels.push("rate changes");
  if (g) labels.push("dG same");
  if (h) labels.push("dH same");
  const energy = /([+-]?\d+(?:\.\d+)?)\s*kj/.exec(stem);
  if (energy?.[1] && h !== g) {
    const shown = String(Number(energy[1]));
    const text = `${h ? "dH" : "dG"}=${shown} kJ`;
    if (text.length <= 16) labels.push(text);
  }
  labels.push("schematic");
  return board(
    question,
    "a catalyst changes the rate and not the reaction energy",
    labels,
    "A catalyst changes the rate. It does not change the reaction Delta G or Delta H. When the stem gives no energy, the figure is schematic and states no energy number.",
  );
}

function sentenceEffect(sentence: string, subject: "concentration" | "temperature" | "pressure"): "up" | "down" | "none" | null {
  if (!sentence.includes(subject) || !/\brate\b/.test(sentence)) return null;
  if (/does not|do not|no effect|unchanged|remains the same|stays the same/.test(sentence)) return "none";
  if (/increas|rais/.test(sentence)) return "up";
  if (/decreas|lower/.test(sentence)) return "down";
  return null;
}

function effectOn(stem: string, subject: "concentration" | "temperature" | "pressure"): "up" | "down" | "none" | null {
  let found: "up" | "down" | "none" | null = null;
  for (const sentence of stem.split(/[.]/)) {
    const effect = sentenceEffect(sentence, subject);
    if (!effect) continue;
    if (found && found !== effect) return null;
    found = effect;
  }
  return found;
}

function tryFactor(question: string, stem: string): Built {
  if (/doubl|rate\s*=\s*k|initial rate|d\[/.test(stem)) return null;
  const zero = /zero order|order\s+is\s+0(?!\.\d)/.test(stem);
  const positive = /positive order/.test(stem);
  if (zero && positive) return "decline";
  const concentration = effectOn(stem, "concentration");
  const temperature = effectOn(stem, "temperature");
  const pressure = effectOn(stem, "pressure");
  if (!concentration && !temperature && !pressure) return null;
  const gas = /gas/.test(stem);
  if (concentration === "up" && !positive) return "decline";
  if (concentration === "up" && zero) return "decline";
  if (concentration === "none" && positive) return "decline";
  if (concentration === "none" && !zero) return "decline";
  if (pressure === "up" && (!gas || !positive || zero)) return "decline";
  if (pressure === "none" && (!gas || !zero)) return "decline";
  const labels: string[] = [];
  if (concentration === "up") labels.push("c up", "rate up", "order>0");
  if (concentration === "none") labels.push("order=0", "c no rate");
  if (temperature === "up") labels.push("T up", "rate up");
  if (temperature === "down") labels.push("T up", "rate down");
  if (pressure === "up") labels.push("P up", "rate up", "gas");
  if (pressure === "none") labels.push("P no rate", "order=0");
  if (labels.length === 0) return null;
  labels.push("schematic");
  if (/kj|ev\b|kcal/.test(stem)) return "decline";
  return board(
    question,
    "qualitative factors that change a reaction rate",
    labels,
    "Concentration and pressure change the rate only when the order is not zero. Temperature is marked as a qualitative effect. The figure is schematic and invents no energy.",
  );
}

/** The figure, or null when the stem is claimed but not grounded. */
export function buildReactionRatesScene(
  question: string,
  quantities: ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  void schematic;
  if (!claimsReactionRates(question)) return null;
  const stem = chemStem(question);
  if (assertsNegativeRate(stem) || assertsBadMolecularity(stem) || complexAssignedMolecularity(stem) || orderCopied(stem)) return null;
  const steps: Array<(text: string) => Built> = [
    (text) => tryStoichiometric(question, text, quantities),
    (text) => tryOrder(question, text),
    (text) => tryMolecularity(question, text),
    (text) => tryCatalyst(question, text),
    (text) => tryFactor(question, text),
  ];
  for (const step of steps) {
    const built = step(stem);
    if (built === "decline") return null;
    if (built) return built;
  }
  return null;
}
