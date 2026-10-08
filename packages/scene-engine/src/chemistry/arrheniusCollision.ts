/**
 * Arrhenius plots and bimolecular collision theory (chemistry unit 8).
 *
 * ln k versus 1/T has slope -Ea/R. A log10 plot has slope -Ea/(2.303 R).
 * Two temperatures and a rate ratio use the natural log even when the
 * board is a log10 plot. Temperatures on 1/T are kelvin; a Celsius value
 * declines. R is 8.314 J/mol/K unless the stem states another value.
 *
 * A catalyst keeps the reactant-to-product enthalpy and changes the
 * barrier. Both barriers and Delta H are labelled only when the stem
 * gives all three. Otherwise the board is marked schematic, or it declines
 * when the energies are only partly given.
 *
 * Collision theory of bimolecular gases shows both partners, orientation,
 * and a threshold. It does not give a rate, a derivation, or a distribution.
 *
 * The 300 K to 310 K doubling probe stays on kinetics.ts.
 * Labels are at most 16 characters.
 */
import type { SceneDocument } from "../types";
import { fmt } from "../archetypes/document";
import { ChemScene, chemStem, planQuantity, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_kinetics";
const DEFAULT_R = 8.314;
const LOG10_FACTOR = 2.303;

const CELSIUS_VALUE = /\d+(?:\.\d+)?\s*(?:°\s*c\b|celsius\b|degrees?\s+celsius\b|deg(?:rees?)?\s*c\b)/;
const FIGURE_ABSENT = /shown below|shown above|the graph shown|the plot shown|from the (?:graph|plot|figure)|in the (?:figure|graph|plot) below/;

type PlotBasis = "ln" | "log10";

function isDoublingProbe(stem: string): boolean {
  return /doubl/.test(stem) && /300\s*k\b/.test(stem) && /310\s*k\b/.test(stem);
}

/** The existing kinetics probe declines catalyst prose that gives no energies. */
function isLegacyCatalystDecline(stem: string): boolean {
  return /catalyst lowers the activation energy/.test(stem) && /reaction coordinate diagram/.test(stem);
}

function isCollision(stem: string): boolean {
  return /collision theory/.test(stem)
    || (/bimolecular/.test(stem) && /collision/.test(stem))
    || (/threshold/.test(stem) && /collision/.test(stem) && /orient/.test(stem));
}

function isCatalystProfile(stem: string): boolean {
  if (!/cataly/.test(stem)) return false;
  if (/equilibri/.test(stem) && /does not change k|k (?:is |stays |remains )?unchanged|no effect on k/.test(stem) && !/activation|barrier|profile|enthalpy|δ\s*h|delta\s*h/.test(stem)) {
    return false;
  }
  return /activation|barrier|energy profile|reaction coordinate|enthalpy|δ\s*h|delta\s*h|potential energy/.test(stem);
}

function isArrhenius(stem: string): boolean {
  if (/(?:ln|log(?:\s*10|10)?)\s*k\b/.test(stem) && /1\s*\/\s*t|reciprocal/.test(stem)) return true;
  if (/\barrhenius\b/.test(stem)) return true;
  const temperature = /temperature|\d\s*k\b|°\s*c|celsius/.test(stem);
  if (/activation energy|\be_?a\b/.test(stem) && temperature) return true;
  return /rate constant|\bk\b/.test(stem)
    && temperature
    && /doubl|tripl|quadrupl|halv|times|fold|k\s*2\s*\/\s*k\s*1/.test(stem);
}

export function claimsArrheniusCollision(question: string): boolean {
  const stem = chemStem(question);
  if (isDoublingProbe(stem) || isLegacyCatalystDecline(stem)) return false;
  return isCollision(stem) || isCatalystProfile(stem) || isArrhenius(stem);
}

function wantsValue(stem: string): boolean {
  return /calculat|find|determine|compute|what is the (?:activation|value)|how (?:much|large)|evaluate/.test(stem);
}

function drawCue(stem: string): boolean {
  return /sketch|plot|draw|graph|diagram|versus|vs\.?\b|against/.test(stem);
}

function plotBasis(stem: string): PlotBasis | "ambiguous" | "unspecified" {
  const ln = /\bln\s*k\b|\bnatural log\b/.test(stem);
  const log = /\blog(?:\s*10|10)?\s*k\b|\blog10\b|\bcommon log\b/.test(stem);
  const bareLogarithm = /\blogarithm\b/.test(stem) && !ln && !log;
  if (bareLogarithm || (ln && log)) return "ambiguous";
  if (log) return "log10";
  if (ln) return "ln";
  return "unspecified";
}

function logPlotCalledNatural(stem: string): boolean {
  if (plotBasis(stem) !== "log10") return false;
  return stem.split(/[.]/).some((clause) => {
    if (!/slope/.test(clause) || /2\.303/.test(clause)) return false;
    return /e_?a\s*\/\s*r\b/.test(clause);
  });
}

interface EnergyToken {
  kJ: number;
}

function toKJ(value: number, unit: string): number | null {
  if (unit === "kj") return value;
  if (unit === "j") return value / 1000;
  if (unit === "kcal") return value * 4.184;
  if (unit === "cal") return value * 0.004184;
  return null;
}

function energyToken(slice: string): EnergyToken | null {
  const match = /([+-]?\d+(?:\.\d+)?)\s*(kj|kcal|cal|j)\b/.exec(slice);
  if (!match?.[1] || !match[2]) return null;
  const kJ = toKJ(Number(match[1]), match[2]);
  if (kJ === null || !Number.isFinite(kJ)) return null;
  return { kJ };
}

function nearPhrase(stem: string, phrase: RegExp): EnergyToken | null {
  const head = phrase.exec(stem);
  if (!head) return null;
  const after = energyToken(stem.slice(head.index + head[0].length, head.index + head[0].length + 70));
  if (after) return after;
  const before = stem.slice(Math.max(0, head.index - 48), head.index);
  const matches = [...before.matchAll(/([+-]?\d+(?:\.\d+)?)\s*(kj|kcal|cal|j)\b/g)];
  const last = matches.at(-1);
  return last ? energyToken(last[0]) : null;
}

interface GasConstant {
  joule: number;
}

function readGasConstant(stem: string, quantities: readonly ChemPlanQuantity[]): GasConstant | null {
  const pattern = /r\s*=\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*10\^?\(?\s*(-?\d+)\s*\)?)?\s*(kj|kcal|cal|j)?/g;
  const found: number[] = [];
  for (const match of stem.matchAll(pattern)) {
    const mantissa = Number(match[1]);
    const exponent = match[2] !== undefined ? Number(match[2]) : 0;
    const unit = match[3] ?? "j";
    const joule = toKJ(mantissa * 10 ** exponent, unit);
    if (joule === null || !(joule > 0)) return null;
    found.push(joule * (unit === "j" || unit === undefined ? 1 : 1000));
  }
  // toKJ on joules divides by 1000. Rebuild from the raw unit instead.
  found.length = 0;
  for (const match of stem.matchAll(pattern)) {
    const mantissa = Number(match[1]);
    const exponent = match[2] !== undefined ? Number(match[2]) : 0;
    const unit = match[3] ?? "";
    let joule = mantissa * 10 ** exponent;
    if (unit === "kj") joule *= 1000;
    else if (unit === "kcal") joule *= 4184;
    else if (unit === "cal") joule *= 4.184;
    else if (unit === "" && joule < 0.1) return null;
    if (!(joule > 0) || !Number.isFinite(joule)) return null;
    found.push(joule);
  }
  const planned = planQuantity(quantities, ["R", "gas_constant"]);
  if (found.length > 1 && found.some((value) => Math.abs(value - found[0]!) > 1e-6 * found[0]!)) return null;
  const stated = found[0] ?? null;
  if (stated !== null && planned !== null && Math.abs(stated - planned) > 1e-3 * Math.max(stated, planned)) return null;
  return { joule: stated ?? planned ?? DEFAULT_R };
}

interface Temperatures {
  t1: number;
  t2: number;
}

function maskedSlope(stem: string): string {
  return stem.replace(/slope[^.]{0,48}?-?\d+(?:\.\d+)?\s*k\b/g, " ");
}

function readTemperatures(stem: string, quantities: readonly ChemPlanQuantity[]): Temperatures | { only: number } | null {
  const labelled1 = /\bt\s*1\s*=\s*(\d+(?:\.\d+)?)\s*k\b/.exec(stem);
  const labelled2 = /\bt\s*2\s*=\s*(\d+(?:\.\d+)?)\s*k\b/.exec(stem);
  let t1: number | null = labelled1?.[1] ? Number(labelled1[1]) : null;
  let t2: number | null = labelled2?.[1] ? Number(labelled2[1]) : null;
  if (t1 === null || t2 === null) {
    const pair = /(\d+(?:\.\d+)?)\s*k\b\s*(?:to|and)\s*(\d+(?:\.\d+)?)\s*k\b/.exec(maskedSlope(stem));
    if (pair?.[1] && pair[2]) {
      t1 = t1 ?? Number(pair[1]);
      t2 = t2 ?? Number(pair[2]);
    }
  }
  if (t1 === null || t2 === null) {
    const singles: number[] = [];
    for (const match of maskedSlope(stem).matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*k\b/g)) {
      const value = Number(match[1]);
      if (value >= 50 && value <= 4000) singles.push(value);
    }
    const unique = [...new Set(singles)];
    if (unique.length > 2) return null;
    if (unique.length === 2) {
      t1 = t1 ?? unique[0]!;
      t2 = t2 ?? unique[1]!;
    } else if (unique.length === 1 && t1 === null && t2 === null) {
      const planned1 = planQuantity(quantities, ["T1", "T_1"]);
      const planned2 = planQuantity(quantities, ["T2", "T_2"]);
      if (planned1 !== null && planned2 !== null) return { t1: planned1, t2: planned2 };
      return { only: unique[0]! };
    }
  }
  if (t1 === null) t1 = planQuantity(quantities, ["T1", "T_1"]);
  if (t2 === null) t2 = planQuantity(quantities, ["T2", "T_2"]);
  if (t1 === null && t2 === null) return null;
  if (t1 === null || t2 === null) return { only: (t1 ?? t2)! };
  if (!(t1 > 0) || !(t2 > 0) || t1 === t2) return null;
  return { t1, t2 };
}

function readNamedK(stem: string, index: "1" | "2"): number | null {
  const match = new RegExp(String.raw`\bk\s*${index}\s*=\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*10\^?\(?\s*(-?\d+)\s*\)?)?`).exec(stem);
  if (!match?.[1]) return null;
  const exponent = match[2] !== undefined ? Number(match[2]) : 0;
  const value = Number(match[1]) * 10 ** exponent;
  return value > 0 ? value : null;
}

function readRatio(stem: string, quantities: readonly ChemPlanQuantity[]): number | null {
  const values: number[] = [];
  const explicit = /k\s*2\s*\/\s*k\s*1\s*(?:=|is)\s*(\d+(?:\.\d+)?)/.exec(stem);
  if (explicit?.[1]) values.push(Number(explicit[1]));
  const k1 = readNamedK(stem, "1");
  const k2 = readNamedK(stem, "2");
  if (k1 !== null && k2 !== null) values.push(k2 / k1);
  if (/\b(?:doubl\w*|twice)\b/.test(stem)) values.push(2);
  if (/\btripl\w*\b/.test(stem)) values.push(3);
  if (/\bquadrupl\w*\b/.test(stem)) values.push(4);
  if (/\bhalved\b|\bone half\b/.test(stem)) values.push(0.5);
  const times = /(\d+(?:\.\d+)?)\s*(?:times|fold)\b/.exec(stem);
  if (times?.[1]) values.push(Number(times[1]));
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, ten: 10 };
  const word = /(two|three|four|five|ten)\s*(?:times|fold)\b/.exec(stem);
  if (word?.[1] && words[word[1]] !== undefined) values.push(words[word[1]]!);
  const planned = planQuantity(quantities, ["ratio", "k2_k1", "k2/k1"]);
  if (planned !== null) values.push(planned);
  if (values.length === 0) return null;
  if (values.some((value) => !(value > 0) || !Number.isFinite(value))) return null;
  if (values.some((value) => Math.abs(value - values[0]!) > 1e-6 * Math.max(1, Math.abs(values[0]!)))) return null;
  return values[0]!;
}

function readSlope(stem: string): number | null {
  const match = /slope(?:\s+of(?:\s+the\s+(?:line|plot))?)?\s*(?:=|is|:)\s*(-?\d+(?:\.\d+)?)/.exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value !== 0 ? value : null;
}

function readStatedEaJoule(stem: string): number | null {
  if (/cataly/.test(stem)) return null;
  const match = /(?:activation energy|\be_?a\b)[^.]{0,48}?([+-]?\d+(?:\.\d+)?)\s*(kj|kcal|cal|j)\b/.exec(stem);
  if (!match?.[1] || !match[2]) return null;
  const kJ = toKJ(Number(match[1]), match[2]);
  if (kJ === null || !(kJ > 0)) return null;
  return kJ * 1000;
}

function activationJoule(ratio: number, t1: number, t2: number, gas: number): number | null {
  if (!(ratio > 0) || ratio === 1 || !(t1 > 0) || !(t2 > 0) || t1 === t2 || !(gas > 0)) return null;
  const energy = (gas * Math.log(ratio)) / (1 / t1 - 1 / t2);
  if (!(energy > 0) || !Number.isFinite(energy)) return null;
  return energy;
}

function agrees(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.02 * Math.max(Math.abs(left), Math.abs(right), 1);
}

function kjLabel(prefix: string, kJ: number): string | null {
  const text = `${prefix}=${fmt(kJ, 3)} kJ/mol`;
  return text.length <= 16 ? text : null;
}

function enthalpyLabel(kJ: number): string | null {
  const body = fmt(kJ, 3);
  const signed = kJ > 0 ? `+${body}` : body;
  const text = `dH=${signed} kJ/mol`;
  return text.length <= 16 ? text : null;
}

function temperatureLabel(index: 1 | 2, kelvin: number): string | null {
  const text = `T${index}=${fmt(kelvin, 4)} K`;
  return text.length <= 16 ? text : null;
}

function ratioLabel(ratio: number): string | null {
  const text = `k2/k1=${fmt(ratio, 3)}`;
  return text.length <= 16 ? text : null;
}

interface Board {
  scene: ChemScene;
  ids: string[];
}

function openBoard(question: string, reason: string, withAxes = true): Board {
  const scene = new ChemScene(question, reason, FAMILY);
  if (!withAxes) return { scene, ids: [] };
  scene.scene.axes("axes", 0, 10, 0, 7, "board axes");
  return { scene, ids: ["axes"] };
}

function column(board: Board, labels: readonly string[]): boolean {
  if (labels.length === 0 || labels.length > 7) return false;
  if (labels.some((label) => label.length === 0 || label.length > 16)) return false;
  if (new Set(labels).size !== labels.length) return false;
  labels.forEach((label, index) => {
    board.ids.push(board.scene.text(`v${index}`, { x: 7.15, y: 5.75 - index * 0.78 }, label, "result"));
  });
  return true;
}

function finish(board: Board, caption: string): SceneDocument {
  const labels = board.ids.flatMap((id) => {
    const entity = board.scene.scene.entities.find((candidate) => candidate.id === id);
    return entity?.label ? [entity.label] : [];
  });
  const reason = board.scene.scene.reason ?? "figure";
  const cue = labels.length > 0 ? `${reason}. ${labels.join(", ")}.` : reason;
  board.scene.scene.group("figure", board.ids, cue);
  return board.scene.build({ caption });
}

function placeLine(board: Board, basis: PlotBasis): void {
  const yAxis = basis === "log10" ? "log k" : "ln k";
  board.ids.push(board.scene.text("y_axis", { x: 1.15, y: 6.35 }, yAxis, "axis label"));
  board.ids.push(board.scene.text("x_axis", { x: 3.6, y: 0.55 }, "1/T", "axis label"));
  const curve = board.scene.scene.curve("line", "5.2 - 0.8*x", 0.5, 4.6, "arrhenius line", undefined, 33);
  board.ids.push(curve);
  const coldX = 4.4;
  const hotX = 0.6;
  const yAt = (x: number) => Number((5.2 - 0.8 * x).toFixed(6));
  board.scene.scene.point("hot", { x: hotX, y: yAt(hotX) }, "higher temperature");
  board.scene.scene.point("cold", { x: coldX, y: yAt(coldX) }, "lower temperature");
  board.ids.push("hot", "cold");
  board.scene.scene.assert("hot_on_line", "function_value", [curve], { x: hotX, y: yAt(hotX) });
  board.scene.scene.assert("cold_on_line", "function_value", [curve], { x: coldX, y: yAt(coldX) });
}

function slopeText(basis: PlotBasis): string {
  return basis === "log10" ? "slope=-Ea/2.303R" : "slope=-Ea/R";
}

function basisText(basis: PlotBasis): string {
  return basis === "log10" ? "basis log10" : "basis ln";
}

function rememberEnergy(board: Board, joule: number, gas: number, basis: PlotBasis, temps: Temperatures | null, ratio: number | null): void {
  board.scene.scene.quantity("Ea", "Ea", joule, "J/mol");
  board.scene.scene.quantity("R", "R", gas, "J/mol/K");
  if (basis === "log10") board.scene.scene.quantity("logFactor", "2.303", LOG10_FACTOR, "");
  if (temps) {
    board.scene.scene.quantity("T1", "T1", temps.t1, "K");
    board.scene.scene.quantity("T2", "T2", temps.t2, "K");
  }
  if (ratio !== null) board.scene.scene.quantity("ratio", "k2/k1", ratio, "");
}

function buildArrhenius(
  question: string,
  stem: string,
  quantities: readonly ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (CELSIUS_VALUE.test(stem)) return null;
  const basisChoice = plotBasis(stem);
  if (basisChoice === "ambiguous" || logPlotCalledNatural(stem)) return null;
  const basis: PlotBasis = basisChoice === "log10" ? "log10" : "ln";
  const gas = readGasConstant(stem, quantities);
  if (!gas) return null;
  const temps = readTemperatures(stem, quantities);
  if (temps === null && /from\s+\d+(?:\.\d+)?\s*k\b/.test(stem)) return null;
  const ratio = readRatio(stem, quantities);
  const slope = readSlope(stem);
  const stated = readStatedEaJoule(stem);
  const pair = temps && "t1" in temps ? temps : null;
  const one = temps && "only" in temps ? temps.only : null;

  if (FIGURE_ABSENT.test(stem) && slope === null && pair === null && stated === null) return null;
  if (one !== null && pair === null) return null;
  if (ratio !== null && pair === null && slope === null && stated === null) return null;
  if (slope !== null && !(slope < 0)) return null;

  let fromPair: number | null = null;
  if (pair && ratio !== null) {
    fromPair = activationJoule(ratio, pair.t1, pair.t2, gas.joule);
    if (fromPair === null) return null;
  }
  let fromSlope: number | null = null;
  if (slope !== null) {
    fromSlope = basis === "log10" ? -slope * LOG10_FACTOR * gas.joule : -slope * gas.joule;
    if (!(fromSlope > 0)) return null;
  }
  if (fromPair !== null && fromSlope !== null && !agrees(fromPair, fromSlope)) return null;
  if (stated !== null && fromPair !== null && !agrees(stated, fromPair)) return null;
  if (stated !== null && fromSlope !== null && !agrees(stated, fromSlope)) return null;

  const joule = fromPair ?? fromSlope ?? stated;
  if (joule === null) {
    if (wantsValue(stem) || ratio !== null || slope !== null) return null;
    if (!(drawCue(stem) || schematic)) return null;
    return schematicArrhenius(question, basis);
  }

  const label = kjLabel("Ea", joule / 1000);
  const labels = [slopeText(basis), basisText(basis)];
  if (!label) return null;
  labels.push(label);
  if (pair) {
    const first = temperatureLabel(1, pair.t1);
    const second = temperatureLabel(2, pair.t2);
    if (!first || !second) return null;
    labels.unshift(second);
    labels.unshift(first);
  }
  if (ratio !== null) {
    const ratioText = ratioLabel(ratio);
    if (!ratioText) return null;
    labels.splice(pair ? 2 : 0, 0, ratioText);
  }
  const board = openBoard(question, basis === "log10"
    ? "log10 k versus 1/T has slope -Ea/(2.303 R)"
    : "ln k versus 1/T has slope -Ea/R");
  if (!column(board, labels)) return null;
  placeLine(board, basis);
  rememberEnergy(board, joule, gas.joule, basis, pair, ratio);
  const source = fromPair !== null
    ? `Ea = R ln(k2/k1)/(1/T1 - 1/T2) = ${fmt(joule / 1000, 3)} kJ/mol`
    : fromSlope !== null
      ? basis === "log10"
        ? `Ea = -slope * 2.303 * R = ${fmt(joule / 1000, 3)} kJ/mol`
        : `Ea = -slope * R = ${fmt(joule / 1000, 3)} kJ/mol`
      : `Ea = ${fmt(joule / 1000, 3)} kJ/mol is the value stated in the stem`;
  const slopeNote = basis === "log10"
    ? "The plot is log10 k versus 1/T, so its slope is -Ea/(2.303 R)."
    : "The plot is ln k versus 1/T, so its slope is -Ea/R.";
  return finish(board, `${source}. R = ${fmt(gas.joule, 4)} J/mol/K. ${slopeNote}`);
}

function schematicArrhenius(question: string, basis: PlotBasis): SceneDocument | null {
  const board = openBoard(question, "schematic Arrhenius line with no measured activation energy");
  const labels = [slopeText(basis), basisText(basis), "schematic"];
  if (!column(board, labels)) return null;
  placeLine(board, basis);
  if (basis === "log10") board.scene.scene.quantity("logFactor", "2.303", LOG10_FACTOR, "");
  const note = basis === "log10"
    ? "Schematic log10 plot. The slope is -Ea/(2.303 R). No activation energy is invented."
    : "Schematic ln k versus 1/T. The slope is -Ea/R. No activation energy is invented.";
  return finish(board, note);
}

function catalystMovesEnthalpy(stem: string): boolean {
  if (/(?:changes|alters|modifies)\s+(?:the\s+)?(?:δ\s*h|delta\s*h|enthalpy|\bdh\b)/.test(stem)) return true;
  return /(?:δ\s*h|delta\s*h|enthalpy)[^.]{0,40}\b(?:changes|changed|different)\b/.test(stem)
    && !/unchanged|stays the same|does not change|fixed|\bsame\b/.test(stem);
}

function hasNonGasEnergy(stem: string): boolean {
  const withoutR = stem.replace(/r\s*=\s*\d+(?:\.\d+)?(?:\s*[x×]\s*10\^?\(?\s*-?\d+\s*\)?)?\s*(?:kj|kcal|cal|j)\b[^.]{0,20}/g, " ");
  return /\d+(?:\.\d+)?\s*(?:kj|kcal)\b/.test(withoutR) || /\d+(?:\.\d+)?\s*j\s*\/\s*mol/.test(withoutR);
}

function readBarriers(stem: string, quantities: readonly ChemPlanQuantity[]): { plain: number; cat: number } | null {
  const fromTo = /(?:activation|barrier)[^.]{0,40}?from\s+([+-]?\d+(?:\.\d+)?)\s*(kj|kcal|cal|j)\b[^.]{0,40}?to\s+([+-]?\d+(?:\.\d+)?)\s*(kj|kcal|cal|j)\b/.exec(stem);
  const spanned = fromTo?.[1] && fromTo[2] && fromTo[3] && fromTo[4]
    ? { plain: energyToken(`${fromTo[1]} ${fromTo[2]}`), cat: energyToken(`${fromTo[3]} ${fromTo[4]}`) }
    : null;
  const plainToken = nearPhrase(stem, /uncataly[sz]ed/) ?? nearPhrase(stem, /without (?:a )?catalyst/);
  const catToken = nearPhrase(stem, /(?<!un)cataly[sz]ed/) ?? nearPhrase(stem, /with (?:a )?catalyst/) ?? nearPhrase(stem, /e_?a\s*cat/);
  let plain = spanned?.plain?.kJ ?? plainToken?.kJ ?? null;
  let cat = spanned?.cat?.kJ ?? catToken?.kJ ?? null;
  if (plain === null) plain = planQuantity(quantities, ["Ea", "Ea_uncat", "E_a"]);
  if (cat === null) cat = planQuantity(quantities, ["Ea_cat", "Eacat", "Ea_catalysed"]);
  if (plain === null || cat === null) return null;
  return { plain, cat };
}

function readEnthalpy(stem: string, quantities: readonly ChemPlanQuantity[]): number | null {
  const match = /(?:δ\s*h|delta\s*h|\bdh\b|enthalpy(?:\s+change)?|reaction enthalpy)(?:\s+is|\s*=|:)?[^.]{0,48}?([+-]?\d+(?:\.\d+)?)\s*(kj|kcal|cal|j)\b/.exec(stem);
  if (match?.[1] && match[2]) {
    const energy = energyToken(`${match[1]} ${match[2]}`);
    if (energy) return energy.kJ;
  }
  return planQuantity(quantities, ["dH", "deltaH", "delta_H", "enthalpy"]);
}

function pathSegment(board: Board, id: string, from: { x: number; y: number }, to: { x: number; y: number }, role: string, dashed: boolean): void {
  const start = board.scene.scene.helper(`${id}_a`, from, "path helper");
  const end = board.scene.scene.helper(`${id}_b`, to, "path helper");
  board.ids.push(board.scene.scene.segment(id, start, end, role));
  if (!dashed) return;
  const entity = board.scene.scene.entities.find((candidate) => candidate.id === id);
  if (entity) entity.provenance = { ...(entity.provenance ?? {}), dashed: true };
}

function drawPaths(board: Board, yR: number, yP: number, yPlain: number, yCat: number): void {
  pathSegment(board, "uncat_up", { x: 0.8, y: yR }, { x: 2.5, y: yPlain }, "uncatalysed barrier", false);
  pathSegment(board, "uncat_down", { x: 2.5, y: yPlain }, { x: 4.5, y: yP }, "uncatalysed descent", false);
  pathSegment(board, "cat_up", { x: 0.8, y: yR }, { x: 2.1, y: yCat }, "catalysed barrier", true);
  pathSegment(board, "cat_down", { x: 2.1, y: yCat }, { x: 4.5, y: yP }, "catalysed descent", true);
}

function buildCatalyst(
  question: string,
  stem: string,
  quantities: readonly ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (catalystMovesEnthalpy(stem)) return null;
  if (/catalyst[^.]{0,40}(?:raises|increases)[^.]{0,24}(?:activation|barrier)/.test(stem)) return null;
  const barriers = readBarriers(stem, quantities);
  const enthalpy = readEnthalpy(stem, quantities);
  const complete = barriers !== null && enthalpy !== null;
  if (!complete) {
    if (hasNonGasEnergy(stem) || barriers !== null || enthalpy !== null) return null;
    if (wantsValue(stem) && !schematic && !drawCue(stem)) return null;
    if (!(drawCue(stem) || schematic || /lowers|reduces|decreases/.test(stem))) return null;
    return qualitativeCatalyst(question, stem);
  }
  const { plain, cat } = barriers;
  if (!(plain > 0) || !(cat > 0) || !(cat < plain) || !(plain > enthalpy) || !(cat > enthalpy)) return null;
  const exo = /\bexothermic\b/.test(stem);
  const endo = /\bendothermic\b/.test(stem);
  if (exo && endo) return null;
  if (exo && enthalpy > 0) return null;
  if (endo && enthalpy < 0) return null;
  const plainLabel = kjLabel("Ea", plain);
  const catLabel = kjLabel("Eacat", cat) ?? kjLabel("Eac", cat);
  const dHLabel = enthalpyLabel(enthalpy);
  if (!plainLabel || !catLabel || !dHLabel) return null;
  const board = openBoard(question, "catalyst changes the barrier and leaves Delta H fixed");
  if (!column(board, [plainLabel, catLabel, dHLabel, "dH fixed", "R", "P"])) return null;
  const low = Math.min(0, enthalpy);
  const high = Math.max(plain, enthalpy, 0);
  const span = Math.max(high - low, 1e-9);
  const y = (energy: number) => 1.45 + ((energy - low) / span) * 4.1;
  drawPaths(board, y(0), y(enthalpy), y(plain), y(cat));
  board.scene.scene.quantity("Ea", "Ea", plain, "kJ/mol");
  board.scene.scene.quantity("Ea_cat", "Ea_cat", cat, "kJ/mol");
  board.scene.scene.quantity("dH", "dH", enthalpy, "kJ/mol");
  return finish(board, `Uncatalysed Ea = ${fmt(plain, 3)} kJ/mol and catalysed Ea = ${fmt(cat, 3)} kJ/mol. Delta H = ${fmt(enthalpy, 3)} kJ/mol on both paths.`);
}

function qualitativeCatalyst(question: string, stem: string): SceneDocument | null {
  const exo = /\bexothermic\b/.test(stem);
  const endo = /\bendothermic\b/.test(stem);
  if (exo && endo) return null;
  const labels = ["schematic", "dH fixed", "Ea lower", "R", "P"];
  if (exo) labels.push("exo");
  if (endo) labels.push("endo");
  const board = openBoard(question, "schematic catalyst profile with Delta H unchanged");
  if (!column(board, labels)) return null;
  const yR = exo ? 3.1 : endo ? 1.8 : 2.5;
  const yP = exo ? 1.7 : endo ? 3.2 : 2.5;
  drawPaths(board, yR, yP, 5.35, endo ? 4.35 : 3.9);
  return finish(board, "Schematic profile. The catalyst lowers the barrier. The reactant-to-product enthalpy is not given a value.");
}

function wantsCollisionNumber(stem: string): boolean {
  if (/do not calculat|don't calculat|do not find|no numerical/.test(stem)) return false;
  return /calculat|find the (?:rate|frequency|fraction)|what is the (?:rate|frequency)|how many collisions|numerical rate|collision frequency/.test(stem);
}

function wantsDerivation(stem: string): boolean {
  if (/do not deriv|don't deriv|without deriv|no deriv/.test(stem)) return false;
  return /deriv/.test(stem);
}

function assertsEveryCollision(stem: string): boolean {
  if (/not every|not all|do not all|only some|only a fraction/.test(stem)) return false;
  return /every collision/.test(stem) || /all collisions/.test(stem);
}

function deniesCollisionModel(stem: string): boolean {
  if (/orientation (?:is |does )?not|no (?:particular |favourable |favorable )?orientation|orientation (?:is )?irrelevant/.test(stem)) return true;
  if (/no threshold|without (?:a |any )?threshold|threshold (?:is )?irrelevant/.test(stem)) return true;
  return /unimolecular/.test(stem) && !/bimolecular/.test(stem);
}

function buildCollision(question: string, stem: string): SceneDocument | null {
  if (wantsCollisionNumber(stem) || wantsDerivation(stem) || assertsEveryCollision(stem) || deniesCollisionModel(stem)) return null;
  if (/maxwell|boltzmann|distribution/.test(stem)) return null;
  const labels = ["A and B", "orient", "threshold", "not all react", "schematic"];
  if (/cataly/.test(stem)) labels.push("catalyst");
  if (/selectiv/.test(stem) && labels.length < 7) labels.push("selective");
  const board = openBoard(question, "bimolecular collision needs both partners, orientation, and a threshold", false);
  if (!column(board, labels)) return null;
  board.scene.atom("mol_a", "A", { x: 1.35, y: 3.5 }, { radius: 0.46 });
  board.scene.atom("mol_b", "B", { x: 3.7, y: 3.5 }, { radius: 0.46 });
  board.scene.arrow("approach_a", { x: 0.15, y: 3.5 }, { x: 0.7, y: 3.5 }, "A approaching");
  board.scene.arrow("approach_b", { x: 4.9, y: 3.5 }, { x: 4.35, y: 3.5 }, "B approaching");
  board.ids.push("mol_a", "mol_b", "approach_a", "approach_b");
  const catalysis = /cataly/.test(stem) ? " Advanced names the catalyst." : "";
  return finish(board, `Both gas molecules must meet with a favourable orientation and at least the threshold energy. Not every collision reacts. No rate is calculated.${catalysis}`);
}

function arrheniusReady(stem: string, quantities: readonly ChemPlanQuantity[]): boolean {
  if (CELSIUS_VALUE.test(stem)) return false;
  const temps = readTemperatures(stem, quantities);
  const pair = temps && "t1" in temps;
  const ratio = readRatio(stem, quantities);
  const slope = readSlope(stem);
  return (pair && ratio !== null) || (slope !== null && slope < 0) || readStatedEaJoule(stem) !== null;
}

export function buildArrheniusCollisionScene(
  question: string,
  quantities: readonly ChemPlanQuantity[],
  schematic: boolean,
): SceneDocument | null {
  if (!claimsArrheniusCollision(question)) return null;
  const stem = chemStem(question);
  try {
    if (isCollision(stem) && !arrheniusReady(stem, quantities)) return buildCollision(question, stem);
    if (isCatalystProfile(stem) && !arrheniusReady(stem, quantities)) return buildCatalyst(question, stem, quantities, schematic);
    if (isArrhenius(stem)) return buildArrhenius(question, stem, quantities, schematic);
    if (isCollision(stem)) return buildCollision(question, stem);
    if (isCatalystProfile(stem)) return buildCatalyst(question, stem, quantities, schematic);
    return null;
  } catch {
    return null;
  }
}
