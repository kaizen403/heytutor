/**
 * Physical and dynamic equilibrium, and the Le Chatelier shifts that follow
 * from a parsed reaction: immediate Q, pressure and Δn(gas), temperature
 * and K, a catalyst, and an inert gas at fixed volume or fixed pressure.
 *
 * Concentration-time graphs, rate laws, order, half-life and Arrhenius stay
 * out. A Kp/Kc conversion, an extent, or a reaction ΔG is not taken unless
 * the stem also asks about a shift, dynamic equilibrium, a catalyst, an
 * inert gas, or Le Chatelier. Open loss, a stopped reaction, a driven
 * steady state, and a request to draw a false pressure shift are owned
 * and declined: no picture.
 *
 * Labels are written in full. A label longer than 16 characters is not drawn.
 */
import type { SceneDocument } from "../types";
import { normalizeChemistryText } from "./formula";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_kinetics" as const;

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

function aboutEquilibrium(stem: string): boolean {
  return /equilibri(?:um|a)\b/.test(stem);
}

function ratesEqual(stem: string): boolean {
  return /rates?\s+(?:are\s+|is\s+)?equal/.test(stem)
    || /equal\s+rates?/.test(stem)
    || /forward\s+rate\s+equals/.test(stem)
    || (/forward/.test(stem) && /reverse/.test(stem) && /equal/.test(stem));
}

function physicalPhrase(stem: string): boolean {
  return /solid(?:\s*[-–—]\s*|\s+)liquid/.test(stem)
    || /liquid(?:\s*[-–—]\s*|\s+)(?:gas|vapou?r)/.test(stem)
    || /solid(?:\s*[-–—]\s*|\s+)(?:gas|vapou?r)/.test(stem)
    || /gas(?:\s*[-–—]\s*|\s+)gas/.test(stem);
}

function volumeFixed(stem: string): boolean {
  return /constant volume|volume (?:is |remains |stays )?constant|fixed volume|volume (?:is )?fixed/.test(stem);
}

function pressureFixed(stem: string): boolean {
  return /constant pressure|pressure (?:is |remains |stays )?constant|fixed pressure|pressure (?:is )?fixed/.test(stem);
}

function pressureUp(stem: string): boolean {
  if (pressureFixed(stem)) return false;
  if (/decreas\w* (?:the )?pressure|pressure (?:is |was )?(?:decreased|decreases|decreasing)|lower(?:ing)? (?:the )?pressure/.test(stem)) return false;
  return /increas\w* (?:the )?pressure|increasing pressure|pressure (?:is |was )?(?:increased|increases|increasing)|higher pressure|rais\w* (?:the )?pressure|increase in (?:the )?pressure|pressure increase/.test(stem);
}

function temperatureRises(stem: string): boolean {
  return /temperature (?:is )?(?:increased|increases|increasing)|increas\w* (?:the )?temperature|rais\w* (?:the )?temperature|higher temperature/.test(stem);
}

function temperatureFalls(stem: string): boolean {
  return /temperature (?:is )?(?:decreased|decreases|decreasing)|decreas\w* (?:the )?temperature|lower(?:ing)? (?:the )?temperature|cooling|cooled/.test(stem);
}

function kRises(stem: string): boolean {
  return /(?:equilibrium )?k (?:is )?(?:increased|increases|increasing)|increas\w* (?:the )?(?:equilibrium )?k\b/.test(stem);
}

function kFalls(stem: string): boolean {
  return /(?:equilibrium )?k (?:is )?(?:decreased|decreases|decreasing)|decreas\w* (?:the )?(?:equilibrium )?k\b/.test(stem);
}

function concentrationLeavesK(stem: string): boolean {
  return /concentration/.test(stem) && /(?:does not|do not) change k|k (?:is |remains |stays )?unchanged|no effect on k/.test(stem);
}

function openLoss(stem: string): boolean {
  if (/\bclosed\b/.test(stem) || !/\bopen\b/.test(stem)) return false;
  return /evaporat/.test(stem) && /vapou?r|lost|dish/.test(stem);
}

function assertsStopped(stem: string): boolean {
  if (/not stopped|has not stopped|rates are not zero|not zero/.test(stem)) return false;
  if (/dynamic/.test(stem) && ratesEqual(stem)) return false;
  return /stopped/.test(stem) && /rate/.test(stem) && /zero|\b0\b/.test(stem);
}

function drivenSteady(stem: string): boolean {
  if (/not a (?:driven )?steady state|not pumping/.test(stem)) return false;
  const flow = /flow reactor|continuous flow|steady state|pump|in and out/.test(stem);
  return flow && /steady state|pump|in and out|concentrations? (?:are |stay |keeps? |kept )?constant/.test(stem);
}

function waterScene(stem: string): boolean {
  if (/\bice\b/.test(stem) || /solid(?:\s*[-–—]\s*|\s+)liquid/.test(stem)) return false;
  return /\bclosed\b/.test(stem)
    && (/\bwater\b/.test(stem) || /\bh2o\b/.test(stem))
    && /\bliquid\b/.test(stem)
    && /vapou?r/.test(stem)
    && aboutEquilibrium(stem)
    && ratesEqual(stem)
    && /not equal/.test(stem);
}

function iceScene(stem: string): boolean {
  if (!/\bclosed\b/.test(stem) || !aboutEquilibrium(stem)) return false;
  const solid = /solid(?:\s*[-–—]\s*|\s+)liquid/.test(stem) || (/\bice\b/.test(stem) && /\bwater\b/.test(stem));
  if (!solid) return false;
  return (/melting/.test(stem) && /freezing/.test(stem)) || ratesEqual(stem) || /both continue/.test(stem);
}

function immediateAsk(stem: string): boolean {
  return /immediate/.test(stem) && (/\bq\b/.test(stem) || /quotient/.test(stem));
}

function veto(stem: string): boolean {
  if (/with time|versus time|vs\.? time|variation of concentration/.test(stem)) return true;
  if (/rate law|half-?\s*life|arrhenius|activation energy|\bzero order\b|\bfirst order\b|\bsecond order\b|\bthird order\b|order of (?:the )?reaction|reaction order/.test(stem)) return true;
  if (hasShiftCue(stem)) return false;
  const kpKc = /k_?p/.test(stem) && /k_?c/.test(stem);
  const extent = /\bextent\b|degree of dissociation/.test(stem);
  const deltaG = /(?:δ|∆)\s*g\b|delta g|gibbs/.test(stem);
  return kpKc || extent || deltaG;
}

function hasShiftCue(stem: string): boolean {
  return /shift|dynamic|catalyst|inert|chatelier|immediate|quotient/.test(stem)
    || pressureUp(stem)
    || volumeFixed(stem)
    || concentrationLeavesK(stem)
    || ((/\bexothermic\b/.test(stem) || /\bendothermic\b/.test(stem)) && temperatureRises(stem));
}

function owns(stem: string): boolean {
  if (openLoss(stem) || assertsStopped(stem) || drivenSteady(stem)) return true;
  if (/chatelier/.test(stem)) return true;
  if (/dynamic/.test(stem) && aboutEquilibrium(stem)) return true;
  if (ratesEqual(stem) && (aboutEquilibrium(stem) || /\bclosed\b/.test(stem))) return true;
  if (physicalPhrase(stem) && aboutEquilibrium(stem)) return true;
  if (waterScene(stem) || iceScene(stem)) return true;
  if (/\binert\b/.test(stem) && (volumeFixed(stem) || pressureFixed(stem) || aboutEquilibrium(stem) || /shift|added/.test(stem))) return true;
  if (/catalyst/.test(stem) && (aboutEquilibrium(stem) || /\bk\b/.test(stem) || /composition/.test(stem))) return true;
  if (immediateAsk(stem)) return true;
  if (pressureUp(stem) && (aboutEquilibrium(stem) || /<=>/.test(stem) || /shift/.test(stem))) return true;
  if ((/\bexothermic\b/.test(stem) || /\bendothermic\b/.test(stem)) && /temperature/.test(stem) && /\bk\b/.test(stem)) return true;
  if (concentrationLeavesK(stem)) return true;
  if (/\bliquid\b/.test(stem) && /vapou?r/.test(stem) && aboutEquilibrium(stem)) return true;
  if (/\bice\b/.test(stem) && /\bwater\b/.test(stem) && aboutEquilibrium(stem)) return true;
  return false;
}

/** True when this chapter owns the stem, including honest declines. */
export function claimsEquilibriumPhysical(question: string): boolean {
  const stem = chemStem(question);
  if (veto(stem)) return false;
  return owns(stem);
}

function numeral(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(4));
  if (!Number.isFinite(rounded)) return null;
  const text = String(rounded);
  if (text.length > 12 || /e/i.test(text)) return null;
  return text;
}

function phaseOf(raw: string | undefined): Phase | null {
  const value = raw?.toLowerCase();
  if (value === "s" || value === "l" || value === "g" || value === "aq") return value;
  return null;
}

const TOKEN = /^(\d+(?:\.\d+)?)?\s*([A-Z][A-Za-z0-9]*)(?:\(([a-zA-Z]{1,2})\))?$/;
const SIDE = /((?:\d+(?:\.\d+)?\s*)?[A-Z][A-Za-z0-9]*(?:\([a-zA-Z]{1,2}\))?(?:\s*\+\s*(?:\d+(?:\.\d+)?\s*)?[A-Z][A-Za-z0-9]*(?:\([a-zA-Z]{1,2}\))?)*)$/;

function speciesFrom(part: string): Species | null {
  const match = TOKEN.exec(part.trim());
  if (!match?.[2]) return null;
  const coeff = match[1] ? Number(match[1]) : 1;
  const phase = phaseOf(match[3]);
  if (!(coeff > 0) || (match[3] !== undefined && phase === null)) return null;
  return { coeff, formula: match[2], phase };
}

function parseSide(side: string): Species[] | null {
  const parts = side.split("+");
  const species: Species[] = [];
  for (const part of parts) {
    const item = speciesFrom(part);
    if (!item) return null;
    species.push(item);
  }
  return species.length > 0 ? species : null;
}

function parseForward(text: string): Species[] | null {
  const species: Species[] = [];
  let rest = text.trim();
  const token = /^(\d+(?:\.\d+)?)?\s*([A-Z][A-Za-z0-9]*)(?:\(([a-zA-Z]{1,2})\))?/;
  while (rest.length > 0) {
    const match = token.exec(rest);
    if (!match?.[2]) break;
    const coeff = match[1] ? Number(match[1]) : 1;
    const phase = phaseOf(match[3]);
    if (!(coeff > 0) || (match[3] !== undefined && phase === null)) return null;
    species.push({ coeff, formula: match[2], phase });
    rest = rest.slice(match[0].length);
    const plus = /^\s*\+\s*/.exec(rest);
    if (!plus) break;
    rest = rest.slice(plus[0].length);
  }
  return species.length > 0 ? species : null;
}

function parseReaction(text: string): Reaction | null {
  const at = text.indexOf("<=>");
  if (at < 0) return null;
  const left = SIDE.exec(text.slice(0, at).trim());
  if (!left?.[1]) return null;
  const reactants = parseSide(left[1]);
  const products = parseForward(text.slice(at + 3));
  if (!reactants || !products) return null;
  return { reactants, products };
}

function anyPhase(reaction: Reaction): boolean {
  return [...reaction.reactants, ...reaction.products].some((item) => item.phase !== null);
}

/** Product gas coefficients minus reactant gas coefficients. */
function deltaGas(reaction: Reaction): number {
  const phased = anyPhase(reaction);
  const moles = (species: Species[]): number => species.reduce((sum, item) => {
    if (phased && item.phase !== "g") return sum;
    return sum + item.coeff;
  }, 0);
  return moles(reaction.products) - moles(reaction.reactants);
}

function statedDeltaN(stem: string): number | null {
  const match = /(?:delta\s*n|δ\s*n|∆\s*n)(?:\s*\(?g\)?|\s+of\s+gas)?\s*(?:=|is)\s*(-?\d+(?:\.\d+)?)/.exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function gasSpecies(species: Species[], phased: boolean): Species[] {
  if (!phased) return species;
  const gases = species.filter((item) => item.phase === "g");
  return gases.length > 0 ? gases : species;
}

function loneFormula(species: Species[], phased: boolean): string | null {
  const named = gasSpecies(species, phased);
  if (named.length !== 1) return null;
  return named[0]?.formula ?? null;
}

function assertsAShift(stem: string): boolean {
  if (/no shift|does not shift|do not shift|not shift|does not change|do not change|not change|unchanged|no effect/.test(stem)) return false;
  return /\bshifts?\b|favou?r|toward/.test(stem);
}

function isFalsePressureShift(stem: string, reaction: Reaction | null): boolean {
  if (!pressureUp(stem)) return false;
  const computed = reaction ? deltaGas(reaction) : null;
  const stated = statedDeltaN(stem);
  const n = computed ?? stated;
  if (n !== 0) return false;
  return assertsAShift(stem);
}

function readConcentrations(stem: string): Map<string, number> {
  const map = new Map<string, number>();
  const pattern = /\[([a-z0-9]+)(?:\([a-z]{1,2}\))?\]\s*=\s*(\d+(?:\.\d+)?)/g;
  for (const match of stem.matchAll(pattern)) {
    const formula = match[1];
    const value = Number(match[2]);
    if (!formula || !Number.isFinite(value) || value < 0 || map.has(formula)) continue;
    map.set(formula, value);
  }
  return map;
}

function changedConcentration(stem: string): { formula: string; value: number } | null {
  const match = /\[([a-z0-9]+)(?:\([a-z]{1,2}\))?\]\s*becomes\s*(\d+(?:\.\d+)?)/.exec(stem);
  if (!match?.[1] || match[2] === undefined) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value) || value < 0) return null;
  return { formula: match[1], value };
}

function statedKc(stem: string): number | null {
  const match = /k_?c\s*=\s*(\d+(?:\.\d+)?)/.exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function countsInQuotient(item: Species, phased: boolean): boolean {
  if (!phased) return true;
  return item.phase === "g" || item.phase === "aq";
}

function quotient(reaction: Reaction, conc: Map<string, number>): number | null {
  const phased = anyPhase(reaction);
  let numerator = 1;
  let denominator = 1;
  for (const item of reaction.products) {
    if (!countsInQuotient(item, phased)) continue;
    const value = conc.get(item.formula.toLowerCase());
    if (value === undefined) return null;
    numerator *= value ** item.coeff;
  }
  for (const item of reaction.reactants) {
    if (!countsInQuotient(item, phased)) continue;
    const value = conc.get(item.formula.toLowerCase());
    if (value === undefined) return null;
    denominator *= value ** item.coeff;
  }
  if (!(denominator > 0) || !Number.isFinite(numerator)) return null;
  return numerator / denominator;
}

function temperatureSteady(stem: string): boolean {
  if (/temperature/.test(stem) && /increas|decreas|rais|lower|heat|cool/.test(stem) && !/constant|unchanged|same/.test(stem)) return false;
  return true;
}

function draw(question: string, reason: string, labels: readonly string[], caption: string, arrows = false): SceneDocument | null {
  if (labels.length === 0 || labels.length > 6) return null;
  for (const label of labels) {
    if (label.length === 0 || label.length > 16) return null;
  }
  const c = new ChemScene(question, reason, FAMILY);
  const ids: string[] = [];
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    if (label === undefined) return null;
    ids.push(c.text(`row${index}`, { x: 0.2, y: 2.6 - index * 0.8 }, label, "equilibrium label"));
  }
  if (arrows) {
    ids.push(c.arrow("fwd_a", { x: 3.4, y: 2.3 }, { x: 5.3, y: 2.3 }, "forward process", "fwd"));
    ids.push(c.arrow("rev_a", { x: 5.3, y: 1.3 }, { x: 3.4, y: 1.3 }, "reverse process", "rev"));
  }
  c.scene.group("panel", ids, reason);
  return c.build({ caption });
}

function phaseKind(stem: string): "solid-gas" | "gas-gas" | "liq-gas" | "solid-liq" | null {
  if (/solid(?:\s*[-–—]\s*|\s+)(?:gas|vapou?r)/.test(stem)) return "solid-gas";
  if (/gas(?:\s*[-–—]\s*|\s+)gas/.test(stem)) return "gas-gas";
  if (/liquid(?:\s*[-–—]\s*|\s+)(?:gas|vapou?r)/.test(stem)) return "liq-gas";
  if (/solid(?:\s*[-–—]\s*|\s+)liquid/.test(stem)) return "solid-liq";
  return null;
}

function immediateScene(question: string, stem: string, reaction: Reaction | null): SceneDocument | null {
  if (!reaction) return null;
  const change = changedConcentration(stem);
  if (!change) return null;
  const initial = readConcentrations(stem);
  const stated = statedKc(stem);
  const initialQ = quotient(reaction, initial);
  if (stated !== null && initialQ !== null && Math.abs(stated - initialQ) > 1e-4 * Math.max(1, Math.abs(stated))) return null;
  const k = stated ?? initialQ;
  if (k === null || !(k > 0)) return null;
  const immediate = new Map(initial);
  immediate.set(change.formula, change.value);
  const q = quotient(reaction, immediate);
  if (q === null || !Number.isFinite(q) || q < 0) return null;
  const qText = numeral(q);
  const kText = numeral(k);
  if (!qText || !kText) return null;
  const same = Math.abs(q - k) <= 1e-6 * Math.max(1, Math.abs(k));
  const compare = same ? "Q=K" : q < k ? "Q<K" : "Q>K";
  const shift = same ? "no shift" : q < k ? "shift fwd" : "shift rev";
  const labels = [`Q=${qText}`, `K=${kText}`, compare, shift];
  if (temperatureSteady(stem)) labels.push("K fixed");
  return draw(
    question,
    "immediate reaction quotient",
    labels,
    "Q uses the concentrations at the instant of the change, before the amounts respond. K stays fixed when the temperature is constant. Q < K favours the forward direction and Q > K favours the reverse.",
  );
}

function catalystLabels(stem: string): string[] | null {
  if (!/catalyst/.test(stem)) return null;
  if (!/does not|do not|unchanged|no effect|neither/.test(stem)) return null;
  const mentionsK = /\bk\b/.test(stem);
  const mentionsComp = /composition/.test(stem);
  if (!mentionsK && !mentionsComp) return null;
  const labels: string[] = [];
  if (mentionsK) labels.push("K same");
  if (mentionsComp) labels.push("comp same");
  labels.push("catalyst");
  return labels;
}

function thermalLabels(stem: string): string[] | null {
  const exo = /\bexothermic\b/.test(stem);
  const endo = /\bendothermic\b/.test(stem);
  if (exo && endo) return null;
  const labels: string[] = [];
  if (exo && temperatureRises(stem)) {
    if (kRises(stem) && !kFalls(stem)) return null;
    labels.push("exo", "T up", "K down");
  } else if (endo && temperatureRises(stem)) {
    if (kFalls(stem) && !kRises(stem)) return null;
    labels.push("endo", "T up", "K up");
  } else if (exo && temperatureFalls(stem)) {
    if (kFalls(stem) && !kRises(stem)) return null;
    labels.push("exo", "T down", "K up");
  } else if (endo && temperatureFalls(stem)) {
    if (kRises(stem) && !kFalls(stem)) return null;
    labels.push("endo", "T down", "K down");
  }
  if (concentrationLeavesK(stem)) labels.push("c no K");
  return labels.length > 0 ? labels : null;
}

function pressureLabels(stem: string, reaction: Reaction | null): string[] | null {
  if (!pressureUp(stem)) return null;
  const computed = reaction ? deltaGas(reaction) : null;
  const stated = statedDeltaN(stem);
  if (computed !== null && stated !== null && computed !== stated) return null;
  const n = computed ?? stated;
  if (n === null) return null;
  const shown = numeral(n);
  if (shown === null) return null;
  const dN = `dN=${shown}`;
  if (dN.length > 16) return null;
  if (n === 0) return [dN, "no shift", "K fixed"];
  if (!reaction) return null;
  const formula = loneFormula(n < 0 ? reaction.products : reaction.reactants, anyPhase(reaction));
  if (!formula) return null;
  const toward = `toward ${formula}`;
  if (toward.length > 16) return null;
  return [dN, "P up", toward, "K fixed", "schematic"];
}

function inertPressureLabels(stem: string, reaction: Reaction | null): string[] | null {
  if (!reaction) return null;
  const computed = deltaGas(reaction);
  const stated = statedDeltaN(stem);
  if (stated !== null && stated !== computed) return null;
  const shown = numeral(computed);
  if (shown === null) return null;
  const dN = `dN=${shown}`;
  if (dN.length > 16) return null;
  if (computed === 0) return ["P fixed", "no shift", dN];
  if (assertsAShift(stem) && computed < 0 && /toward nh3|shift right/.test(stem)) return null;
  return ["P fixed", computed < 0 ? "shift left" : "shift right", dN];
}

/** The figure, or null when the stem is claimed but not drawn. */
export function buildEquilibriumPhysicalScene(
  question: string,
  _quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  if (!claimsEquilibriumPhysical(question)) return null;
  const stem = chemStem(question);
  if (openLoss(stem) || assertsStopped(stem) || drivenSteady(stem)) return null;
  const raw = normalizeChemistryText(question);
  const reaction = parseReaction(raw);
  if (isFalsePressureShift(stem, reaction)) return null;
  if (immediateAsk(stem)) {
    return immediateScene(question, stem, reaction);
  }
  const catalyst = catalystLabels(stem);
  if (catalyst) {
    return draw(
      question,
      "catalyst at equilibrium",
      catalyst,
      "A catalyst speeds the forward and reverse rates by the same factor. K and the equilibrium composition stay as they were.",
    );
  }
  const thermal = thermalLabels(stem);
  if (thermal) {
    return draw(
      question,
      "temperature and the equilibrium constant",
      thermal,
      "K changes with temperature. Heating an exothermic forward reaction decreases K. A concentration change moves Q, not K.",
    );
  }
  if (/\binert\b/.test(stem) && volumeFixed(stem) && !pressureFixed(stem)) {
    if (assertsAShift(stem)) return null;
    return draw(
      question,
      "inert gas at constant volume",
      ["V fixed", "no shift", "inert"],
      "An inert gas added at constant volume does not change the partial pressures of the reacting gases, so the equilibrium does not shift.",
    );
  }
  if (/\binert\b/.test(stem) && pressureFixed(stem) && !volumeFixed(stem)) {
    const labels = inertPressureLabels(stem, reaction);
    if (!labels) return null;
    return draw(
      question,
      "inert gas at constant pressure",
      labels,
      "An inert gas added at constant pressure increases the volume. The equilibrium shifts toward the side with more gas moles. K is unchanged.",
    );
  }
  if (pressureUp(stem)) {
    const labels = pressureLabels(stem, reaction);
    if (!labels) return null;
    return draw(
      question,
      "pressure and the gas mole change",
      labels,
      "Raising the pressure shifts the equilibrium toward fewer gas moles. When the gas mole change is zero there is no shift. K depends on temperature, not pressure. The direction is schematic when no pressure value is given.",
    );
  }
  if (waterScene(stem)) {
    return draw(
      question,
      "closed liquid-vapour equilibrium",
      ["rates equal", "not equal c", "closed", "H2O(l)", "H2O(g)"],
      "In a closed vessel the forward and reverse rates are equal, so liquid water and water vapour are at dynamic equilibrium. The two amounts need not be equal. Both directions continue.",
      true,
    );
  }
  if (iceScene(stem)) {
    return draw(
      question,
      "closed solid-liquid equilibrium",
      ["rates equal", "not equal c", "solid-liq", "closed"],
      "Melting and freezing both continue in a closed ice-water equilibrium, and the two rates are equal. The amount of ice need not equal the amount of water.",
      true,
    );
  }
  const phase = phaseKind(stem);
  if (phase && aboutEquilibrium(stem) && /\bclosed\b/.test(stem) && ratesEqual(stem) && /not equal/.test(stem)) {
    return draw(
      question,
      `${phase} physical equilibrium`,
      ["rates equal", "not equal c", phase, "closed"],
      "Both directions continue and the rates are equal. The two amounts need not be equal. This is a closed physical equilibrium, not a stopped reaction.",
      true,
    );
  }
  return null;
}
