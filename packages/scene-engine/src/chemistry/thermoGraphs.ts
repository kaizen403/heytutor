/**
 * Thermochemistry graphs for JEE Main: the reaction energy profile (one hump,
 * a catalysed hump, or a two or three step mechanism), the ΔG = ΔH − TΔS
 * line with its equilibrium temperature, the Born Haber ladder for an alkali
 * halide, the Ellingham diagram, the Haber type variation of ΔG°, ΔH°, ΔS°
 * with T, and the Maxwell Boltzmann energy distribution at two temperatures.
 *
 * Every number on a figure is read from the stem or the plan. A profile whose
 * enthalpy sign the stem never states is declined rather than drawn with a
 * guessed product level; the Born Haber ladder only carries values when the
 * cycle closes from the stem's own steps.
 */
import { fmt } from "../archetypes/document";
import type { SceneDocument } from "../types";
import { formulaTokens, normalizeChemistryText, parseFormula } from "./formula";
import { ChemScene, chemStem, planQuantity, type ChemPlanQuantity } from "./sceneKit";

export const THERMO_FAMILY = "chem_thermo" as const;

type ThermoKind = "profile" | "gibbs" | "gibbs_variation" | "born_haber" | "ellingham" | "maxwell";

const MINUS = "−";

/* ------------------------------------------------------------------ cues */

const FIGURE_ABSENT =
  /\b(?:shown|given|depicted|drawn|provided|represented)\s+(?:below|above|here|alongside|in\s+(?:the\s+)?(?:figure|diagram|graph|plot|sketch))\b|\bas\s+shown\b|\b(?:figure|diagram|graph|plot|profile|sketch|curve)s?\s+(?:shown|given|below|above)\b|\bfrom\s+the\s+(?:figure|diagram|graph|plot)\b|\bgiven\s+(?:figure|diagram|graph|plot|sketch)s?\b|\bin\s+the\s+(?:figure|diagram|graph|plot)\s+(?:below|above|given|shown)\b/;

const STATE_PLOT =
  /\bp\s*-\s*v\b|\bpv\s+(?:diagram|graph|plot|curve)|isotherm|adiabat|cyclic\s+process|indicator\s+diagram|isobaric|isochoric|\bwork\s+(?:done|obtained)\b/;

const ARRHENIUS =
  /rate\s+constant|frequency\s+factor|pre-?\s?exponential|arrhenius|\b(?:ln|log)\s*\(?\s*k\b|\bk\s*=\s*[(\d]|ratio\s+of\s+(?:the\s+)?rate|steric\s+factor|temperature\s+coefficient|\brate\b[^.]{0,80}?\d+\s*°\s*c\b|\d+\s*°\s*c\b[^.]{0,80}?\brate\b/;

const PROFILE_EXPLICIT = /reaction\s+coordinate|energy\s+profile|potential\s+energy\s+(?:diagram|curve|graph|profile)|energy\s+(?:level\s+)?diagram\s+(?:of|for)\s+(?:the\s+)?reaction/;

const DRAW_CUE = /\b(?:draw|sketch|plot|show|represent|illustrate|depict)\b|\bdiagram\b|\bprofile\b|\bgraph\b|\bcurve\b/;

function classifyThermoStem(stem: string): ThermoKind | null {
  if (FIGURE_ABSENT.test(stem)) return null;
  if (/ellingham|δg°?\s*(?:vs|versus|against)\s*t\b[^.]{0,60}?oxide|thermodynamic\s+principles?\s+of\s+metallurgy|thermodynamics\s+of\s+metallurgy/.test(stem)) {
    return "ellingham";
  }
  if (/born\s*-?\s*haber/.test(stem) || (/lattice\s+(?:enthalpy|energy)/.test(stem) && /\bcycle\b/.test(stem))) {
    return "born_haber";
  }
  if (
    /maxwell|boltzmann\s+distribution|distribution\s+of\s+(?:molecular\s+)?(?:speeds|velocities|kinetic\s+energ|energ)/.test(stem) ||
    (/fraction\s+of\s+(?:the\s+)?molecules/.test(stem) && /energy/.test(stem)) ||
    /effect\s+of\s+temperature\s+on\s+(?:the\s+)?(?:rate|reaction\s+rate)/.test(stem) ||
    /molecules\s+(?:having|with|possessing)\s+(?:kinetic\s+)?energy\s+(?:greater|more|higher|larger)\s+than/.test(stem)
  ) {
    return "maxwell";
  }
  const hasDeltaH = readEnthalpyChange(stem) !== null;
  const hasDeltaS = readEntropyChange(stem) !== null;
  if (
    (/haber/.test(stem) && /variation|graph|plot|\bvs\b|versus|represent/.test(stem)) ||
    (/variation\s+of\s+(?:thermodynamic\s+)?(?:properties|parameters|δg|δh|δs)/.test(stem) && /\b(?:with|against|vs|versus)\s+(?:temperature|t)\b/.test(stem) && !(hasDeltaH && hasDeltaS))
  ) {
    return "gibbs_variation";
  }
  if (
    hasDeltaH && hasDeltaS &&
    /spontaneous|δg\s*=\s*δh|temperature\s+(?:above|below|at|beyond)\s+which|(?:equilibrium|transition|minimum|threshold)\s+temperature|at\s+what\s+temperature|δg\b.*\b(?:zero|negative|positive)|feasible/.test(stem)
  ) {
    return "gibbs";
  }
  const profileCue =
    PROFILE_EXPLICIT.test(stem) ||
    /activation\s+energy|energy\s+barrier|threshold\s+energy|catalyst\s+(?:lowers|reduces|decreases|provides)|energy\s+of\s+activation/.test(stem) ||
    (/transition\s+state|activated\s+complex/.test(stem) && /energy|diagram|profile|activation|reaction\s+coordinate/.test(stem)) ||
    (/exothermic|endothermic|evolution\s+of\s+heat|heat\s+is\s+(?:evolved|absorbed)/.test(stem) && /diagram|profile|graph|draw|sketch|plot|curve/.test(stem)) ||
    (/rate\s+determining\s+step|slow\s+step/.test(stem) && /energy|mechanism|reaction\s+coordinate/.test(stem));
  if (!profileCue) return null;
  const explicit = PROFILE_EXPLICIT.test(stem);
  if (STATE_PLOT.test(stem) && !explicit) return null;
  if (ARRHENIUS.test(stem) && !explicit) return null;
  if (/\bs\s*n\s*[12]\b|sn[12]|trigonal\s+bipyramidal|p-orbital|nucleophil|electrophil|carbocation/.test(stem) && !explicit && !/activation\s+energy/.test(stem)) return null;
  return "profile";
}

/** True when this family should draw for the stem. Include vetoes. */
export function isThermoGraphStem(question: string): boolean {
  return classifyThermoStem(chemStem(question)) !== null;
}

/* --------------------------------------------------------- number reading */

interface Energy {
  value: number;
  /** Display unit as the stem wrote it: kJ, kcal, J, eV. */
  unit: string;
}

const NUMBER = /([+-]?\s?\d+(?:\.\d+)?)/g;
const ENERGY_UNIT = /^\s*(kj|kilo\s?joules?|kcal|kilo\s?calories?|j\b|joules?|ev)/;
const NOT_ENERGY = /^\s*(?:°|k\b|s\b|sec|min|hour|%|mol\b|g\b|ml|l\b|atm|bar|times|x\b|×)/;

function canonicalUnit(raw: string | undefined): string | null {
  if (!raw) return null;
  const unit = raw.toLowerCase();
  if (/^kj|^kilo\s?joule/.test(unit)) return "kJ";
  if (/^kcal|^kilo\s?cal/.test(unit)) return "kcal";
  if (/^ev/.test(unit)) return "eV";
  if (/^j/.test(unit)) return "J";
  return null;
}

/**
 * First energy value after a phrase: the first number in the window that
 * carries an energy unit, else the first number not followed by a
 * temperature, time or amount unit. Signs are read as written.
 */
function energyNear(stem: string, phrase: RegExp, window = 70): Energy | null {
  const head = new RegExp(phrase.source, "i").exec(stem);
  if (!head) return null;
  const tail = stem.slice(head.index + head[0].length, head.index + head[0].length + window);
  let fallback: Energy | null = null;
  NUMBER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMBER.exec(tail)) !== null) {
    const raw = match[1]!.replace(/\s/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const after = tail.slice(match.index + match[0].length);
    const unit = canonicalUnit(ENERGY_UNIT.exec(after)?.[1]);
    if (unit) return { value, unit };
    if (fallback === null && !NOT_ENERGY.test(after) && !/^\s*[×x]\s*10/.test(after)) fallback = { value, unit: "" };
  }
  return fallback;
}

function toKj(energy: Energy): number {
  if (energy.unit === "J") return energy.value / 1000;
  if (energy.unit === "kcal") return energy.value * 4.184;
  return energy.value;
}

const DELTA_H_SYMBOL = /(?:δ|∆)\s*(?:r|reaction)?\s*h(?:°|º)?\b|\b[ad]h(?:°|º)?\s*(?=[=:]|\s+is\b|\s+of\b|\s+for\b)|(?:enthalpy|heat)\s+(?:change\s+)?(?:of|for)\s+(?:the\s+)?reaction|enthalpy\s+change|heat\s+of\s+reaction|reaction\s+enthalpy/;
const DELTA_S_SYMBOL = /(?:δ|∆)\s*(?:r|reaction)?\s*s(?:°|º)?\b|\b[ad]s(?:°|º)?\s*(?=[=:]|\s+is\b|\s+of\b|\s+for\b)|entropy\s+change|change\s+in\s+entropy|reaction\s+entropy/;

function readEnthalpyChange(stem: string): Energy | null {
  const direct = energyNear(stem, DELTA_H_SYMBOL, 40);
  if (direct) return direct;
  const evolved = energyNear(stem, /(?:exothermic\s+(?:by|with)|releases|evolves|liberates|heat\s+(?:evolved|released|liberated)(?:\s+is)?)/, 30);
  if (evolved) return { value: -Math.abs(evolved.value), unit: evolved.unit };
  const absorbed = energyNear(stem, /(?:endothermic\s+(?:by|with)|absorbs|heat\s+absorbed(?:\s+is)?)/, 30);
  if (absorbed) return { value: Math.abs(absorbed.value), unit: absorbed.unit };
  return null;
}

function readEntropyChange(stem: string): { value: number; unit: "J" | "kJ" } | null {
  const head = new RegExp(DELTA_S_SYMBOL.source, "i").exec(stem);
  if (!head) return null;
  const tail = stem.slice(head.index + head[0].length, head.index + head[0].length + 40);
  const match = /([+-]?\s?\d+(?:\.\d+)?)\s*(kj|j)\b/i.exec(tail) ?? /([+-]?\s?\d+(?:\.\d+)?)/.exec(tail);
  if (!match) return null;
  const value = Number(match[1]!.replace(/\s/g, ""));
  if (!Number.isFinite(value)) return null;
  return { value, unit: match[2]?.toLowerCase() === "kj" ? "kJ" : "J" };
}

function unitLabel(unit: string): string {
  return unit || "kJ";
}

function signed(value: number, digits = 3): string {
  const text = fmt(Math.abs(value), digits);
  return value < 0 ? `${MINUS}${text}` : text;
}

/* ------------------------------------------------------- species reading */

/** "NO2(g)" -> "NO_2(g)"; charges and states survive. */
function prettyFormula(token: string): string {
  return token
    .replace(/([A-Za-z)\]])(\d+)/g, "$1_$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reactant and product side of the first reaction arrow in the stem, if both fit a label. */
function reactionSides(question: string): { reactants: string; products: string } | null {
  const text = normalizeChemistryText(question);
  const match =
    /(?:reaction|equilibrium|process|conversion)[,:]?\s+([A-Za-z0-9()+^\s]{1,40}?)\s*(?:->|<=>)\s*([A-Za-z0-9()+^\s]{1,40}?)(?=\s*[,.;:?]|\s+(?:the|is|has|at|with|in|and|if|for|which|takes|occurs|proceeds|goes)\b|$)/.exec(text);
  if (!match) return null;
  const reactants = prettyFormula(match[1]!);
  const products = prettyFormula(match[2]!);
  if (!reactants || !products || reactants.length > 16 || products.length > 16) return null;
  if (!/[A-Za-z]/.test(reactants) || !/[A-Za-z]/.test(products)) return null;
  return { reactants, products };
}

/* ---------------------------------------------------------------- scene */

function proveOnCurve(c: ChemScene, id: string, curve: string, x: number, y: number, tolerance?: number): void {
  c.scene.assertions.push({
    id,
    predicate: "function_value",
    entities: [curve],
    expected: { x: Number(x.toFixed(6)), y: Number(y.toFixed(6)) },
    severity: "fatal",
    ...(tolerance !== undefined ? { tolerance } : {}),
  });
}

function dashed(c: ChemScene, id: string): void {
  const entity = c.scene.entities.find((candidate) => candidate.id === id);
  if (entity) entity.provenance = { ...(entity.provenance ?? {}), dashed: true };
}

function num(value: number): string {
  const text = String(Number(value.toFixed(4)));
  return value < 0 ? `(${text})` : text;
}

/**
 * One hump between two levels as a single continuous expression: a Gaussian
 * bump of the barrier height on the left level, with a very narrow smooth
 * step carrying the level change so both flanks are Gaussian and the peak sits
 * exactly at `peakX`.
 */
function humpExpression(peakX: number, width: number, yFrom: number, yPeak: number, yTo: number): string {
  const p = num(peakX);
  const s = num(width);
  const g = `exp(-(x-${p})^2/${s})`;
  return `${num(yFrom)}+${num(yPeak - yFrom)}*${g}+(0.5+0.5*(x-${p})/sqrt((x-${p})^2+0.0001))*${num(yTo - yFrom)}*(1-${g})`;
}

/* -------------------------------------------------------------- profile */

interface ProfileStep {
  /** Barrier above the level the step starts from, in kJ or display units. */
  ea: number;
  /** Enthalpy change of the step. */
  dH: number;
  slow: boolean;
}

interface ProfileSpec {
  steps: ProfileStep[];
  exact: boolean;
  /** The forward barrier was read from the stem or plan even if ΔH was not. */
  eaKnown: boolean;
  unit: string;
  /** Catalysed barrier of the first step: a number, "qualitative", or null. */
  catalyst: number | "qualitative" | null;
  reactants: string;
  products: string;
  caption: string;
}

const EXOTHERMIC = /exothermic|evolution\s+of\s+heat|heat\s+is\s+(?:evolved|released|liberated)|releases?\s+heat|liberates?\s+heat/;
const ENDOTHERMIC = /endothermic|absorption\s+of\s+heat|heat\s+is\s+absorbed|absorbs?\s+heat/;

/**
 * "A -> B slow; ΔH = +ve", "B -> C fast, ΔH = -ve" in reading order. Display
 * magnitudes are chosen so the net ΔH carries the sign the stem states; with
 * mixed step signs and no net sign the product level cannot be placed and
 * the mechanism is declined.
 */
function readMechanismSteps(stem: string): ProfileStep[] | null {
  const pattern = /([a-z0-9()+ ]{1,12}?)\s*->\s*([a-z0-9()+ ]{1,12}?)(?:\s+is|\s*[;,(:])?\s*(?:a\s+|the\s+)?(slow|fast)\b[^;.]{0,40}?(?:δh|∆h|\bah\b|\bdh\b|enthalpy)\s*[=:]?\s*([+-])\s*ve\b/g;
  const signs: Array<{ slow: boolean; sign: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stem)) !== null) {
    signs.push({ slow: match[3] === "slow", sign: match[4] === "-" ? -1 : 1 });
  }
  if (signs.length < 2 || signs.length > 3) return null;
  const plus = signs.filter((step) => step.sign > 0).length;
  const minus = signs.length - plus;
  const netStated = EXOTHERMIC.test(stem) && !ENDOTHERMIC.test(stem) ? -1 : ENDOTHERMIC.test(stem) && !EXOTHERMIC.test(stem) ? 1 : 0;
  const net = netStated !== 0 ? netStated : plus === 0 ? -1 : minus === 0 ? 1 : 0;
  if (net === 0) return null;
  // Magnitudes: the side that must win gets the larger step.
  const plusMagnitude = net > 0 ? 1.0 : 0.7;
  const minusMagnitude = net > 0 ? 0.7 : 1.0;
  if (Math.sign(plus * plusMagnitude - minus * minusMagnitude) !== net) return null;
  return signs.map((step) => ({ ea: step.slow ? 2.6 : 1.1, dH: step.sign > 0 ? plusMagnitude : -minusMagnitude, slow: step.slow }));
}

function readProfile(stem: string, question: string, quantities: ChemPlanQuantity[], schematic: boolean): ProfileSpec | null {
  const sides = reactionSides(question);
  const reactants = sides?.reactants ?? "R";
  const products = sides?.products ?? "P";
  const mechanism = readMechanismSteps(stem);
  if (!mechanism && /\b(?:two|three|2|3)\s+steps?\b|\bmechanism\b|\bintermediate\b|\b(?:slow|fast)\s+step\b|rate\s+determining/.test(stem)) return null;
  if (mechanism) {
    const net = mechanism.reduce((sum, step) => sum + step.dH, 0);
    const rds = mechanism.findIndex((step) => step.slow);
    return {
      steps: mechanism,
      exact: false,
      eaKnown: false,
      unit: "",
      catalyst: null,
      reactants,
      products,
      caption: `${mechanism.length} steps, ${mechanism.length - 1} intermediate${mechanism.length > 2 ? "s" : ""} and ${mechanism.length} activated complexes. Step ${rds + 1} is slow, so it has the largest barrier and is rate determining. Overall ΔH is ${net < 0 ? "negative: heat is evolved" : "positive: heat is absorbed"}; step heights are qualitative.`,
    };
  }

  const planEa = planQuantity(quantities, ["Ea", "E_a", "activation_energy", "activationEnergy", "Ea_forward", "Ea_f", "Ea(f)"]);
  const planEaBack = planQuantity(quantities, ["Ea_backward", "Ea_b", "Ea(b)", "Ea_reverse", "activation_energy_backward"]);
  const planDh = planQuantity(quantities, ["dH", "delta_H", "deltaH", "enthalpy", "enthalpy_change", "ΔH"]);
  const planUnit = quantities.find((quantity) => /^(?:ea|e_a|dh|delta_?h)$/i.test(quantity.id) && quantity.unit)?.unit;

  const eaBackStem = energyNear(stem, /activation\s+energy\s+(?:of|for)\s+(?:the\s+)?(?:backward|reverse)\s+(?:reaction|step|process)|\be_?a\s*\(?\s*(?:b|back|backward|rev|reverse)\s*\)?|backward\s+activation\s+energy|reverse\s+activation\s+energy/);
  const eaForwardStem =
    energyNear(stem, /activation\s+energy\s+(?:of|for)\s+(?:the\s+)?(?:forward|uncatalys[ez]d)\s+(?:reaction|step|process)|\be_?a\s*\(?\s*(?:f|fwd|forward)\s*\)?|forward\s+activation\s+energy/) ??
    (eaBackStem && /activation\s+energy[^.]{0,40}?backward/.test(stem) ? null : energyNear(stem, /activation\s+energy|energy\s+of\s+activation|\be_?a\b|energy\s+barrier/));
  const threshold = energyNear(stem, /threshold\s+energy/);
  const energyR = energyNear(stem, /(?:potential\s+)?energy\s+of\s+(?:the\s+)?reactants?/);
  const energyP = energyNear(stem, /(?:potential\s+)?energy\s+of\s+(?:the\s+)?products?/);
  const dHStem = readEnthalpyChange(stem);

  let ea: number | null = planEa;
  let eaBack: number | null = planEaBack;
  let dH: number | null = planDh;
  let unit = planUnit ? (canonicalUnit(planUnit) ?? "kJ") : "";
  const take = (energy: Energy | null): number | null => {
    if (!energy) return null;
    if (!unit) unit = energy.unit || "kJ";
    return unit === "kcal" && energy.unit === "kcal" ? energy.value : toKj(energy);
  };
  if (ea === null) ea = take(eaForwardStem);
  if (eaBack === null) eaBack = take(eaBackStem);
  if (dH === null) dH = take(dHStem);
  if (ea === null && threshold && energyR) ea = take(threshold)! - take(energyR)!;
  if (dH === null && energyR && energyP) dH = take(energyP)! - take(energyR)!;
  if (dH === null && ea !== null && eaBack !== null) dH = ea - eaBack;
  if (ea === null && dH !== null && eaBack !== null) ea = eaBack + dH;

  const exothermic = EXOTHERMIC.test(stem);
  const endothermic = ENDOTHERMIC.test(stem);
  let sign: number | null = dH !== null ? Math.sign(dH) : exothermic && !endothermic ? -1 : endothermic && !exothermic ? 1 : null;
  let assumed = false;
  if (sign === null) {
    if (!(schematic || DRAW_CUE.test(stem))) return null;
    sign = -1;
    assumed = true;
  }

  const exact = ea !== null && dH !== null;
  if (exact && (ea! <= 0 || ea! - dH! <= 0)) return null;
  const displayEa = 3;
  const displayDh = sign === 0 ? 0 : sign * 0.9;
  const step: ProfileStep = exact ? { ea: ea!, dH: dH!, slow: true } : { ea: ea ?? displayEa, dH: ea !== null ? sign * Math.max(0.25 * ea, 1e-6) : displayDh, slow: true };

  const catalysed = /catalys(?:t|ed|is|e)/.test(stem);
  let catalyst: ProfileSpec["catalyst"] = null;
  if (catalysed) {
    const lowered = energyNear(stem, /(?:lowers?|reduces?|decreases?|brings?\s+down)\s+(?:the\s+)?(?:activation\s+energy|energy\s+barrier|e_?a)[^.]{0,30}?\bby\b/);
    const withCatalyst = energyNear(stem, /(?:in\s+(?:the\s+)?presence\s+of\s+(?:a\s+)?catalyst|with\s+(?:a\s+)?catalyst|catalys[ez]d\s+(?:reaction|path|pathway|route))[^.]{0,60}?(?:activation\s+energy|e_?a|barrier)/) ??
      energyNear(stem, /(?:activation\s+energy|e_?a)\s+(?:of|for|in)\s+(?:the\s+)?(?:catalys[ez]d|presence\s+of\s+(?:a\s+)?catalyst)[^.]{0,20}?/);
    if (ea !== null && lowered) catalyst = ea - toKj(lowered);
    else if (ea !== null && withCatalyst) catalyst = toKj(withCatalyst);
    else catalyst = "qualitative";
    if (typeof catalyst === "number" && !(catalyst > 0 && catalyst < step.ea && catalyst > step.dH)) catalyst = "qualitative";
  }

  const u = unitLabel(unit);
  const parts: string[] = [];
  if (exact) {
    const back = ea! - dH!;
    parts.push(`E_a(forward) = ${fmt(ea!)} ${u}/mol and ΔH = ${signed(dH!)} ${u}/mol, so E_a(backward) = E_a(forward) ${MINUS} ΔH = ${fmt(back)} ${u}/mol.`);
    parts.push(dH! < 0 ? "Exothermic: the products sit below the reactants." : dH! > 0 ? "Endothermic: the products sit above the reactants." : "ΔH = 0: reactants and products at the same level.");
  } else if (ea !== null) {
    parts.push(`E_a(forward) = ${fmt(ea)} ${u}/mol; the product level is drawn ${sign < 0 ? "below" : "above"} the reactants because the stem calls the reaction ${sign < 0 ? "exothermic" : "endothermic"}, with ΔH not to scale.`);
  } else {
    parts.push(assumed
      ? "Heights are qualitative and the exothermic case is drawn; for an endothermic reaction the product level sits above R."
      : `Heights are qualitative: the reaction is ${sign < 0 ? "exothermic, so P lies below R" : "endothermic, so P lies above R"}.`);
  }
  if (catalyst !== null) {
    parts.push(typeof catalyst === "number"
      ? `With the catalyst the barrier falls to ${fmt(catalyst)} ${u}/mol; ΔH is unchanged.`
      : "The catalyst opens a path with a lower barrier; ΔH and the positions of R and P are unchanged.");
  }
  return { steps: [step], exact, eaKnown: ea !== null, unit: u, catalyst, reactants, products, caption: parts.join(" ") };
}

function buildProfile(question: string, spec: ProfileSpec): SceneDocument {
  const n = spec.steps.length;
  const levels: number[] = [0];
  const peaks: number[] = [];
  spec.steps.forEach((step) => {
    const from = levels[levels.length - 1]!;
    peaks.push(from + step.ea);
    levels.push(from + step.dH);
  });
  const eMin = Math.min(...levels);
  const eMax = Math.max(...peaks);
  const k = 4.2 / (eMax - eMin);
  const y = (energy: number): number => 0.6 + (energy - eMin) * k;

  const halfWidth = n === 1 ? 0.9 : n === 2 ? 0.8 : 0.55;
  const centre = (index: number): number => 1 + (8 * index) / n;
  const peakX = (index: number): number => (centre(index) + centre(index + 1)) / 2;
  const width = Math.pow((4 / n - halfWidth) / 2.4, 2);

  const c = new ChemScene(question, n === 1 ? "reaction energy profile with the barrier and the enthalpy change" : `energy profile of a ${n} step mechanism`, THERMO_FAMILY);
  const s = c.scene;
  const yTop = Math.max(...peaks.map(y)) + 0.9;
  s.axes("axes", -0.2, 10.6, -0.2, yTop, "energy axes");
  c.text("x_title", { x: 5.6, y: -0.45 }, "reaction coord.", "axis title");
  c.text("y_title", { x: 1.25, y: yTop - 0.2 }, "potential energy", "axis title");

  const profileIds: string[] = ["axes"];
  const levelIds = levels.map((energy, index) => {
    const id = index === 0 ? "reactant_level" : index === n ? "product_level" : `intermediate_${index}`;
    const role = index === 0 ? "reactant level" : index === n ? "product level" : "intermediate level";
    c.level(id, { x: centre(index), y: y(energy) }, 2 * halfWidth, role);
    const text = index === 0 ? spec.reactants : index === n ? spec.products : n === 2 ? "I" : `I_${index}`;
    c.text(`${id}_name`, { x: centre(index), y: y(energy) + 0.32 }, text, `${role} name`);
    profileIds.push(id, `${id}_name`);
    return id;
  });

  const curveIds: string[] = [];
  spec.steps.forEach((step, index) => {
    const id = n === 1 ? "profile" : `profile_${index + 1}`;
    const from = y(levels[index]!);
    const to = y(levels[index + 1]!);
    const peak = y(peaks[index]!);
    s.curve(id, humpExpression(peakX(index), width, from, peak, to), centre(index), centre(index + 1), n === 1 ? "energy profile" : `step ${index + 1} profile`, undefined, 97);
    curveIds.push(id);
    profileIds.push(id);
    proveOnCurve(c, `peak_${index + 1}`, id, peakX(index), peak);
    if (spec.exact) {
      proveOnCurve(c, `level_start_${index + 1}`, id, centre(index), from, 0.02);
      proveOnCurve(c, `level_end_${index + 1}`, id, centre(index + 1), to, 0.02);
    } else {
      s.assert(`hump_${index + 1}_exists`, "exists", [id]);
    }
    const slowest = spec.steps.reduce((best, candidate, at) => (candidate.ea > spec.steps[best]!.ea ? at : best), 0);
    const label = n === 1 ? "TS" : index === slowest ? `TS_${index + 1} (RDS)` : `TS_${index + 1}`;
    const pointId = `ts_point_${index + 1}`;
    s.point(pointId, { x: peakX(index), y: peak }, "transition state", label);
    s.labelled(pointId);
    profileIds.push(pointId);
  });
  s.group("landscape", profileIds, n === 1 ? "reactants, transition state and products along the reaction coordinate" : "each step climbs to its own activated complex and drops to an intermediate");

  const u = spec.unit;
  const yR = y(levels[0]!);
  const yP = y(levels[n]!);
  const guide = c.link("reactant_guide", { x: centre(0) + halfWidth, y: yR }, { x: centre(n) + halfWidth, y: yR }, "reactant energy reference");
  const barrierIds: string[] = [guide];
  if (n === 1) {
    const step = spec.steps[0]!;
    const foot = s.helper("ea_foot", { x: peakX(0) - 0.35, y: yR }, "barrier foot helper");
    const top = s.helper("ea_top", { x: peakX(0) - 0.35, y: y(peaks[0]!) }, "barrier top helper");
    s.dimension("ea_dim", foot, top, "activation energy", spec.eaKnown ? `E_a = ${fmt(step.ea)} ${u}` : "E_a");
    s.labelled("ea_dim");
    barrierIds.push("ea_dim");
    if (spec.eaKnown) s.quantity("Ea_forward", "E_a", step.ea, u);
    if (spec.catalyst !== null) {
      const eaCat = typeof spec.catalyst === "number" ? spec.catalyst : step.ea * 0.55;
      const peakCat = y(eaCat);
      s.curve("catalysed", humpExpression(peakX(0), width * 0.8, yR, peakCat, yP), centre(0), centre(1), "catalysed profile", "with catalyst", 97);
      dashed(c, "catalysed");
      s.labelled("catalysed");
      proveOnCurve(c, "catalysed_peak", "catalysed", peakX(0), peakCat);
      const catTop = s.helper("ea_cat_top", { x: peakX(0) - 0.35, y: peakCat }, "catalysed top helper");
      const catFoot = s.helper("ea_cat_foot", { x: peakX(0) - 0.35, y: yR }, "catalysed foot helper");
      s.dimension("ea_cat_dim", catFoot, catTop, "catalysed activation energy", typeof spec.catalyst === "number" ? `E_a = ${fmt(eaCat)} ${u}` : "E_a (catalyst)");
      s.labelled("ea_cat_dim");
      barrierIds.push("catalysed", "ea_cat_dim");
      if (typeof spec.catalyst === "number") s.quantity("Ea_catalysed", "E_a(cat)", eaCat, u);
    }
  }
  s.group("barrier", barrierIds, "the activation energy is the climb from the reactant level to the top of the barrier");

  if (Math.abs(yP - yR) > 1e-6) {
    const x = centre(n) - halfWidth - 0.25;
    const a = s.helper("dh_a", { x, y: yR }, "enthalpy reference helper");
    const b = s.helper("dh_b", { x, y: yP }, "enthalpy product helper");
    const net = levels[n]!;
    s.dimension("dh_dim", a, b, "enthalpy change", spec.exact ? `ΔH = ${signed(net)} ${u}` : "ΔH");
    s.labelled("dh_dim");
    s.group("enthalpy", ["dh_dim"], "ΔH is the gap between the product and reactant levels");
    if (spec.exact) {
      s.quantity("dH", "ΔH", net, u);
      s.quantity("Ea_backward", "E_a(back)", spec.steps[0]!.ea - net, u);
    }
  }
  s.labelled(...levelIds.filter((id) => id === "reactant_level" || id === "product_level").map((id) => `${id}_name`));
  return c.build({ caption: spec.caption });
}

/* ---------------------------------------------------------------- gibbs */

function buildGibbs(question: string, stem: string, quantities: ChemPlanQuantity[]): SceneDocument | null {
  const planH = planQuantity(quantities, ["dH", "delta_H", "deltaH", "enthalpy", "ΔH"]);
  const planS = planQuantity(quantities, ["dS", "delta_S", "deltaS", "entropy", "ΔS"]);
  const stemH = readEnthalpyChange(stem);
  const stemS = readEntropyChange(stem);
  const dH = planH ?? (stemH ? toKj(stemH) : null);
  const dSkJ = planS !== null
    ? (quantities.find((quantity) => /^(?:ds|delta_?s)$/i.test(quantity.id))?.unit?.toLowerCase().startsWith("kj") ? planS : planS / 1000)
    : stemS ? (stemS.unit === "kJ" ? stemS.value : stemS.value / 1000) : null;
  if (dH === null || dSkJ === null || dH === 0 || dSkJ === 0) return null;
  const tEq = dH / dSkJ;
  const sign = Math.sign(dH);
  const hText = `ΔH = ${signed(dH)} kJ/mol`;
  const sText = `ΔS = ${signed(stemS && stemS.unit === "J" ? stemS.value : dSkJ * 1000)} J/K/mol`;

  const c = new ChemScene(question, "ΔG = ΔH − TΔS as a straight line in T", THERMO_FAMILY);
  const s = c.scene;
  s.axes("axes", -0.3, 8.6, -3.8, 3.8, "ΔG against T axes");
  c.text("x_title", { x: 8.1, y: -0.55 }, "T (K)", "axis title");
  c.text("y_title", { x: 0.7, y: 3.5 }, "ΔG", "axis title");

  if (tEq > 0) {
    // Display: T_eq at x = 5, ΔH at y = 3 sign(ΔH); the slope then follows.
    s.curve("gibbs_line", `${num(3 * sign)}*(1-x/5)`, 0, 8, "ΔG line", "ΔG = ΔH − TΔS", 33);
    s.labelled("gibbs_line");
    s.point("t_eq", { x: 5, y: 0 }, "equilibrium temperature", `T = ${fmt(tEq)} K`);
    s.labelled("t_eq");
    s.point("h_intercept", { x: 0, y: 3 * sign }, "enthalpy intercept", hText.length <= 16 ? hText : `ΔH = ${signed(dH)} kJ`);
    s.labelled("h_intercept");
    proveOnCurve(c, "zero_at_teq", "gibbs_line", 5, 0);
    proveOnCurve(c, "intercept_is_dh", "gibbs_line", 0, 3 * sign);
    s.assert("root_teq", "root", ["gibbs_line"], { x: 5 });
    const spontaneousRight = sign > 0;
    c.text("spont", { x: spontaneousRight ? 7 : 2.4, y: spontaneousRight ? 0.8 : -0.8 }, "spontaneous", "region name");
    c.text("nonspont", { x: spontaneousRight ? 2.4 : 7, y: spontaneousRight ? -0.8 : 0.8 }, "not spontaneous", "region name");
    s.quantity("T_eq", "T_eq", tEq, "K");
    s.quantity("dH", "ΔH", dH, "kJ/mol");
    s.quantity("dS", "ΔS", dSkJ * 1000, "J/K/mol");
    const caption = `${hText}, ${sText}. ΔG = ΔH ${MINUS} TΔS is zero at T = ΔH/ΔS = ${fmt(tEq)} K and is negative (spontaneous) ${spontaneousRight ? "above" : "below"} that temperature.`;
    return c.build({ caption });
  }
  s.curve("gibbs_line", `${num(3 * sign)}*(1+x/8)`, 0, 8, "ΔG line", "ΔG = ΔH − TΔS", 33);
  s.labelled("gibbs_line");
  s.point("h_intercept", { x: 0, y: 3 * sign }, "enthalpy intercept", hText.length <= 16 ? hText : `ΔH = ${signed(dH)} kJ`);
  s.labelled("h_intercept");
  proveOnCurve(c, "intercept_is_dh", "gibbs_line", 0, 3 * sign);
  c.text("region", { x: 4.5, y: sign > 0 ? -0.8 : 0.8 }, sign < 0 ? "ΔG < 0 at all T" : "ΔG > 0 at all T", "region name");
  s.quantity("dH", "ΔH", dH, "kJ/mol");
  s.quantity("dS", "ΔS", dSkJ * 1000, "J/K/mol");
  const caption = `${hText}, ${sText}. ΔH and ΔS have opposite signs, so ΔG = ΔH ${MINUS} TΔS never changes sign: the reaction is ${sign < 0 ? "spontaneous" : "non spontaneous"} at every temperature.`;
  return c.build({ caption });
}

function buildGibbsVariation(question: string, stem: string): SceneDocument | null {
  const haber = /haber|ammonia|nh_?3/.test(stem);
  const sPositive = /(?:δ|∆)s\s*(?:°|º)?\s*(?:>\s*0|is\s+positive|=\s*\+|positive)|entropy\s+increases|increase\s+in\s+entropy/.test(stem);
  const sNegative = /(?:δ|∆)s\s*(?:°|º)?\s*(?:<\s*0|is\s+negative|=\s*-|negative)|entropy\s+decreases|decrease\s+in\s+entropy/.test(stem);
  const hPositive = /(?:δ|∆)h\s*(?:°|º)?\s*(?:>\s*0|is\s+positive|=\s*\+|positive)|endothermic/.test(stem);
  const hNegative = /(?:δ|∆)h\s*(?:°|º)?\s*(?:<\s*0|is\s+negative|=\s*-|negative)|exothermic/.test(stem);
  // Haber synthesis: ΔH° near -92 kJ/mol and ΔS° near -199 J/K/mol.
  const sSign = haber && !sPositive ? -1 : sNegative && !sPositive ? -1 : sPositive && !sNegative ? 1 : 0;
  const hSign = haber && !hPositive ? -1 : hNegative && !hPositive ? -1 : hPositive && !hNegative ? 1 : 0;
  if (sSign === 0 || hSign === 0) return null;
  const c = new ChemScene(question, "how ΔH°, ΔS° and ΔG° change with temperature", THERMO_FAMILY);
  const s = c.scene;
  s.axes("axes", -0.3, 9.2, -3.2, 3.2, "thermodynamic quantity against T axes");
  c.text("x_title", { x: 8.7, y: -0.5 }, "T", "axis title");
  c.text("y_title", { x: 0.9, y: 2.95 }, "kJ or J/K", "axis title");
  const hLevel = 0.92 * hSign;
  const sLevel = 1.99 * sSign;
  const gSlope = -0.199 * sSign;
  s.curve("dh_line", `${num(hLevel)}+0*x`, 0, 8.5, "ΔH° line", "ΔH°", 17);
  s.curve("ds_line", `${num(sLevel)}+0*x`, 0, 8.5, "ΔS° line", "ΔS°", 17);
  s.curve("dg_line", `${num(hLevel)}+${num(gSlope)}*x`, 0, 8.5, "ΔG° line", "ΔG°", 17);
  s.labelled("dh_line", "ds_line", "dg_line");
  const crossing = -hLevel / gSlope;
  if (crossing > 0 && crossing < 8.5) {
    s.point("g_zero", { x: crossing, y: 0 }, "temperature where ΔG° changes sign", "ΔG° = 0");
    s.labelled("g_zero");
    proveOnCurve(c, "dg_crosses_zero", "dg_line", crossing, 0);
  }
  const rises = sSign < 0;
  const caption = `ΔH° and ΔS° change little with T. With ΔS° ${rises ? "negative" : "positive"}, ΔG° = ΔH° ${MINUS} TΔS° ${rises ? "rises" : "falls"} as T rises${crossing > 0 && crossing < 8.5 ? ` and changes sign at T = ΔH°/ΔS°: the reaction is spontaneous ${rises ? "below" : "above"} that temperature` : `, so ΔG° keeps the sign of ΔH° at every temperature`}. Values are not to scale.`;
  return c.build({ caption });
}

/* ----------------------------------------------------------- born haber */

const ALKALI = new Set(["Li", "Na", "K", "Rb", "Cs"]);
const HALOGEN = new Set(["F", "Cl", "Br", "I"]);
const METAL_NAMES: Record<string, string> = { lithium: "Li", sodium: "Na", potassium: "K", rubidium: "Rb", caesium: "Cs", cesium: "Cs" };
const HALIDE_NAMES: Record<string, string> = { fluoride: "F", chloride: "Cl", bromide: "Br", iodide: "I" };

function alkaliHalide(question: string, stem: string): { metal: string; halogen: string } | null {
  for (const token of formulaTokens(normalizeChemistryText(question))) {
    const parsed = parseFormula(token);
    if (!parsed || parsed.atoms.length !== 2) continue;
    const a = parsed.atoms[0]!;
    const b = parsed.atoms[1]!;
    if (ALKALI.has(a.symbol) && HALOGEN.has(b.symbol) && a.count === 1 && b.count === 1) return { metal: a.symbol, halogen: b.symbol };
  }
  const named = /\b(lithium|sodium|potassium|rubidium|caesium|cesium)\s+(fluoride|chloride|bromide|iodide)\b/.exec(stem);
  if (named) return { metal: METAL_NAMES[named[1]!]!, halogen: HALIDE_NAMES[named[2]!]! };
  return null;
}

function buildBornHaber(question: string, stem: string, quantities: ChemPlanQuantity[]): SceneDocument | null {
  const salt = alkaliHalide(question, stem);
  if (!salt) return null;
  const { metal, halogen } = salt;
  const halogenLower = halogen.toLowerCase();

  const sub = planQuantity(quantities, ["dH_sub", "sublimation", "delta_sub_H", "Hsub"]) ??
    energyNear(stem, /(?:enthalpy|heat|energy)\s+of\s+sublimation|sublimation\s+(?:enthalpy|energy)|(?:δ|∆)\s*_?\s*sub\s*h|atomi[sz]ation\s+(?:enthalpy|energy)\s+of\s+(?:the\s+)?(?:metal|sodium|potassium|lithium|rubidium|caesium|cesium|na|k|li|rb|cs)\b/)?.value ?? null;
  const ie = planQuantity(quantities, ["IE", "IE1", "ionisation_enthalpy", "ionization_enthalpy", "ionisation_energy", "ionization_energy"]) ??
    energyNear(stem, /ioni[sz]ation\s+(?:enthalpy|energy|potential)|\bie_?1?\b|\bip\b|(?:δ|∆)\s*_?\s*i\s*h/)?.value ?? null;
  const dissRaw = energyNear(stem, new RegExp(`(?:bond\\s+)?dissociation\\s+(?:enthalpy|energy)|bond\\s+(?:enthalpy|energy)|(?:δ|∆)\\s*_?\\s*diss\\s*h|atomi[sz]ation\\s+(?:enthalpy|energy)\\s+of\\s+(?:${halogenLower}_?2|chlorine|bromine|fluorine|iodine)`));
  const dissPlan = planQuantity(quantities, ["dH_diss", "bond_dissociation", "bond_enthalpy", "D"]);
  let halfDiss: number | null = dissPlan ?? dissRaw?.value ?? null;
  if (halfDiss !== null) {
    const givenAsHalf = new RegExp(`(?:½|1/2|half)[^.]{0,40}?(?:dissociation|bond)|per\\s+mole\\s+of\\s+(?:${halogenLower}|chlorine|bromine|fluorine|iodine)\\s+atoms|atomi[sz]ation`).test(stem);
    if (!givenAsHalf) halfDiss = halfDiss / 2;
  }
  const egRaw = energyNear(stem, /electron\s+gain\s+enthalpy|electron\s+affinity|(?:δ|∆)\s*_?\s*eg\s*h|\bea\b(?!\s*\()/);
  let eg: number | null = planQuantity(quantities, ["dH_eg", "electron_gain_enthalpy", "electron_affinity", "EA"]) ?? egRaw?.value ?? null;
  let egNegated = false;
  if (eg !== null && eg > 0) {
    eg = -eg;
    egNegated = true;
  }
  const lattice = planQuantity(quantities, ["lattice_enthalpy", "lattice_energy", "U", "dH_lattice"]) ??
    energyNear(stem, /lattice\s+(?:enthalpy|energy)\s*(?:of\s+[a-z0-9_() ]{1,12})?(?:is|=|:)/)?.value ?? null;
  const formation = planQuantity(quantities, ["dH_f", "enthalpy_of_formation", "formation_enthalpy", "delta_f_H"]) ??
    energyNear(stem, /(?:enthalpy|heat)\s+of\s+formation|formation\s+enthalpy|(?:δ|∆)\s*_?\s*f\s*h|standard\s+enthalpy\s+of\s+formation/)?.value ?? null;

  const known = [sub, ie, halfDiss, eg].filter((value) => value !== null).length;
  const closes = known === 4 && (lattice !== null || formation !== null);
  let steps: number[];
  let latticeValue: number | null = null;
  let formationValue: number | null = null;
  if (closes) {
    const upward = sub! + ie! + halfDiss! + eg!;
    formationValue = formation ?? upward + lattice!;
    latticeValue = lattice ?? formationValue - upward;
    steps = [sub!, ie!, halfDiss!, eg!, latticeValue];
  } else {
    // Qualitative ladder in NaCl proportions, symbolic labels only.
    steps = [108, 496, 121, -349, -787];
  }
  const energies = [0];
  steps.forEach((step) => energies.push(energies[energies.length - 1]! + step));
  const eMin = Math.min(...energies);
  const eMax = Math.max(...energies);
  const k = 5 / (eMax - eMin);
  const y = (energy: number): number => (energy - eMin) * k;
  const stepWidth = 2.2;

  const c = new ChemScene(question, `Born Haber cycle for ${metal}${halogen}`, THERMO_FAMILY);
  const s = c.scene;
  const x2 = `${halogen}_2`;
  const names = [
    `${metal}(s)+½${x2}(g)`,
    `${metal}(g)+½${x2}(g)`,
    `${metal}^(+)(g)+½${x2}`,
    `${metal}^(+)(g)+${halogen}(g)`,
    `${metal}^(+)+${halogen}^(-)(g)`,
    `${metal}${halogen}(s)`,
  ];
  const stepNames = closes
    ? [`ΔH_sub = ${fmt(steps[0]!)}`, `IE = ${fmt(steps[1]!)}`, `½ΔH_diss = ${fmt(steps[2]!)}`, `ΔH_eg = ${signed(steps[3]!)}`, `U = ${signed(steps[4]!)} kJ`]
    : ["ΔH_sub", "IE_1", "½ΔH_diss", "ΔH_eg", "ΔH_lattice"];
  const levelIds: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const id = `level_${index}`;
    const x0 = index * stepWidth;
    c.level(id, { x: x0 + stepWidth / 2, y: y(energies[index]!) }, stepWidth, `${names[index]} level`);
    c.text(`${id}_name`, { x: x0 + stepWidth / 2, y: y(energies[index]!) + 0.3 }, names[index]!, "species name");
    levelIds.push(id);
    const arrowX = x0 + stepWidth;
    c.arrow(`step_${index + 1}`, { x: arrowX, y: y(energies[index]!) }, { x: arrowX, y: y(energies[index + 1]!) }, `step ${index + 1}: ${stepNames[index]}`, stepNames[index]);
    s.labelled(`step_${index + 1}`);
  }
  c.level("level_5", { x: 2.5 * stepWidth, y: y(energies[5]!) }, 5 * stepWidth, `${names[5]} level`);
  c.text("level_5_name", { x: 2.5 * stepWidth, y: y(energies[5]!) - 0.32 }, names[5]!, "species name");
  c.arrow("formation", { x: 0, y: y(0) }, { x: 0, y: y(energies[5]!) }, "enthalpy of formation", closes ? `ΔH_f = ${signed(formationValue!)}` : "ΔH_f");
  s.labelled("formation");
  if (closes) {
    s.quantity("lattice_enthalpy", "U", latticeValue!, "kJ/mol");
    s.quantity("formation_enthalpy", "ΔH_f", formationValue!, "kJ/mol");
    s.quantity("sub", "ΔH_sub", steps[0]!, "kJ/mol");
    s.quantity("ie", "IE", steps[1]!, "kJ/mol");
    s.quantity("half_diss", "½ΔH_diss", steps[2]!, "kJ/mol");
    s.quantity("eg", "ΔH_eg", steps[3]!, "kJ/mol");
  }
  const cycle = `ΔH_f = ΔH_sub + IE + ½ΔH_diss + ΔH_eg + U`;
  const caption = closes
    ? `${cycle}: ${signed(formationValue!)} = ${fmt(steps[0]!)} + ${fmt(steps[1]!)} + ${fmt(steps[2]!)} + (${signed(steps[3]!)}) + U, so ${lattice !== null ? `ΔH_f = ${signed(formationValue!)}` : `U = ${signed(latticeValue!)}`} kJ/mol.${egNegated ? ` The electron gain step releases energy, so it is taken as ${signed(steps[3]!)} kJ/mol.` : ""} Heights are to scale in kJ/mol.`
    : `${cycle}. Rising arrows cost energy (sublimation, ionisation, half the ${halogen}_2 bond); the electron gain and the lattice step release it. Heights are qualitative because the stem does not close the cycle numerically.`;
  return c.build({ caption });
}

/* ------------------------------------------------------------ ellingham */

interface OxideLine {
  key: RegExp;
  label: string;
  /** kJ per mol O2 at T = 0 and slope in kJ per K, textbook order of magnitude. */
  intercept: number;
  slope: number;
}

const OXIDE_LINES: OxideLine[] = [
  { key: /\bcao\b|calcium/, label: "2Ca+O_2→2CaO", intercept: -1270, slope: 0.21 },
  { key: /\bmgo\b|magnesium/, label: "2Mg+O_2→2MgO", intercept: -1160, slope: 0.21 },
  { key: /al_?2o_?3|aluminium|aluminum/, label: "Al_2O_3", intercept: -1120, slope: 0.21 },
  { key: /cr_?2o_?3|chromium/, label: "Cr_2O_3", intercept: -750, slope: 0.17 },
  { key: /\bzno\b|zinc/, label: "2Zn+O_2→2ZnO", intercept: -700, slope: 0.21 },
  { key: /\bfeo\b|fe_?2o_?3|iron|haematite|hematite/, label: "2Fe+O_2→2FeO", intercept: -520, slope: 0.13 },
  { key: /h_?2o\b|hydrogen/, label: "2H_2+O_2→2H_2O", intercept: -490, slope: 0.11 },
  { key: /cu_?2o|copper|cuprous/, label: "4Cu+O_2→2Cu_2O", intercept: -340, slope: 0.15 },
  { key: /\bco_?2\b|carbon\s+dioxide/, label: "C+O_2→CO_2", intercept: -394, slope: 0 },
];
const CO_LINE: OxideLine = { key: /\bco\b|carbon|coke|graphite/, label: "2C+O_2→2CO", intercept: -220, slope: -0.18 };

function buildEllingham(question: string, stem: string): SceneDocument {
  const named = OXIDE_LINES.filter((line) => line.key.test(stem));
  const chosen = (named.length > 0 ? named : OXIDE_LINES.filter((line) => /MgO|ZnO/.test(line.label))).slice(0, 3);
  const lines = [...chosen, CO_LINE];
  const c = new ChemScene(question, "Ellingham diagram: ΔG° of oxide formation against temperature", THERMO_FAMILY);
  const s = c.scene;
  const tMax = 2000;
  const kx = 10 / tMax;
  const ky = 1 / 200;
  const bottom = Math.min(...lines.map((line) => line.intercept)) * ky - 0.6;
  s.axes("axes", -0.3, 10.8, bottom, 0.9, "Ellingham axes");
  c.text("x_title", { x: 10.4, y: 0.35 }, "T", "axis title");
  c.text("y_title", { x: 0.75, y: 0.55 }, "ΔG°", "axis title");
  c.text("zero", { x: -0.55, y: 0 }, "0", "axis mark");
  lines.forEach((line, index) => {
    const id = `line_${index}`;
    const slope = line.slope * ky / kx;
    s.curve(id, `${num(line.intercept * ky)}+${num(slope)}*x`, 0, 10, `${line.label} line`, line.label, 17);
    s.labelled(id);
  });
  const crossings: string[] = [];
  chosen.forEach((line, index) => {
    const t = (CO_LINE.intercept - line.intercept) / (line.slope - CO_LINE.slope);
    if (t > 0 && t < tMax) {
      s.point(`cross_${index}`, { x: t * kx, y: (line.intercept + line.slope * t) * ky }, `crossing of the CO line with ${line.label}`);
      crossings.push(`${line.label.replace(/_/g, "")} near ${fmt(t, 2)} K`);
    }
  });
  const caption = `ΔG° for 2C + O_2 → 2CO falls with T (gas moles increase, ΔS° > 0) while the metal oxide lines rise (a gas is consumed). Below a crossing the oxide line is lower and carbon cannot reduce it; above it the CO line is lower, so carbon reduces the oxide${crossings.length ? `: ${crossings.join(", ")} (typical values)` : ""}. The lower a line, the more stable the oxide.`;
  return c.build({ caption });
}

/* -------------------------------------------------------------- maxwell */

function buildMaxwell(question: string, stem: string): SceneDocument {
  const speeds = /speed|velocit/.test(stem) && !/energy/.test(stem);
  const c = new ChemScene(question, "Maxwell Boltzmann distribution at two temperatures", THERMO_FAMILY);
  const s = c.scene;
  s.axes("axes", -0.2, 4.9, -0.1, 1.1, "distribution axes");
  c.text("x_title", { x: 4.35, y: -0.14 }, speeds ? "speed" : "kinetic energy", "axis title");
  c.text("y_title", { x: 0.9, y: 1.02 }, "fraction", "axis title");
  // Equal areas: the T2 curve is flatter and its most probable value larger.
  s.curve("t1", "2*x^2*exp(-x^2)", 0, 4.6, "distribution at the lower temperature", "T_1", 97);
  s.curve("t2", "0.7071*x^2*exp(-x^2/2)", 0, 4.6, "distribution at the higher temperature", "T_2", 97);
  s.labelled("t1", "t2");
  proveOnCurve(c, "t1_peak", "t1", 1, 2 * Math.exp(-1));
  proveOnCurve(c, "t2_peak", "t2", Math.SQRT2, 0.7071 * 2 * Math.exp(-1));
  if (!speeds) {
    const foot = s.helper("ea_foot", { x: 2.3, y: 0 }, "threshold foot helper");
    const top = s.helper("ea_top", { x: 2.3, y: 0.62 }, "threshold top helper");
    s.segment("ea_line", foot, top, "activation energy threshold", "E_a");
    dashed(c, "ea_line");
    s.labelled("ea_line");
  }
  const caption = speeds
    ? "Raising the temperature from T_1 to T_2 shifts the most probable speed to the right and flattens the curve; the area under each curve is the same because it counts all the molecules."
    : "Raising the temperature from T_1 to T_2 flattens and broadens the curve. The fraction of molecules with energy above E_a (the area to the right of the dashed line) grows sharply, which is why the rate rises so fast with temperature.";
  return c.build({ caption });
}

/* ----------------------------------------------------------------- entry */

/** The figure, or null when the stem does not ground it. */
export function buildThermoGraphScene(question: string, quantities: ChemPlanQuantity[], schematic: boolean): SceneDocument | null {
  const stem = chemStem(question);
  const kind = classifyThermoStem(stem);
  if (!kind) return null;
  switch (kind) {
    case "profile": {
      const spec = readProfile(stem, question, quantities, schematic);
      return spec ? buildProfile(question, spec) : null;
    }
    case "gibbs": return buildGibbs(question, stem, quantities);
    case "gibbs_variation": return buildGibbsVariation(question, stem);
    case "born_haber": return buildBornHaber(question, stem, quantities);
    case "ellingham": return buildEllingham(question, stem);
    case "maxwell": return buildMaxwell(question, stem);
  }
}

/* --------------------------------------------------------------- probes */

export const THERMO_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  {
    question: "For an exothermic reaction the activation energy of the forward reaction is 60 kJ/mol and ΔH = −20 kJ/mol. Draw the energy profile diagram and find the activation energy of the backward reaction.",
    expect: "draw",
    labels: ["E_a = 60 kJ", "ΔH = −20 kJ", "TS", "R", "P"],
    note: "Ea(back) = 80 kJ/mol; products drawn below reactants",
  },
  {
    question: "The activation energy of a reaction is 50 kJ/mol and the reaction is endothermic with ΔH = +30 kJ/mol. Sketch the potential energy diagram along the reaction coordinate and mark the activation energy of the reverse reaction.",
    expect: "draw",
    labels: ["E_a = 50 kJ", "ΔH = 30 kJ", "TS"],
    note: "Ea(back) = 20 kJ/mol; products drawn above reactants",
  },
  {
    question: "Show with an energy profile diagram how a catalyst lowers the activation energy of an exothermic reaction without changing ΔH.",
    expect: "draw",
    labels: ["with catalyst", "E_a", "E_a (catalyst)", "ΔH"],
    note: "qualitative: dashed lower hump, same R and P levels",
  },
  {
    question: "An exothermic reaction proceeds in two steps: A → I is slow with ΔH = +ve and I → P is fast with ΔH = −ve. Draw the reaction coordinate diagram showing the intermediate and the rate determining step.",
    expect: "draw",
    labels: ["TS_1 (RDS)", "TS_2", "I"],
    note: "two humps, the first higher",
  },
  {
    question: "Reactant A converts to product D through the given mechanism with net evolution of heat: A → B slow, ΔH = +ve; B → C fast, ΔH = −ve; C → D fast, ΔH = −ve. Which energy profile represents this mechanism?",
    expect: "draw",
    labels: ["TS_1 (RDS)", "TS_2", "TS_3", "I_1", "I_2"],
    note: "three humps, the first highest; D below A",
  },
  {
    question: "For a reaction ΔH = 40 kJ/mol and ΔS = 100 J K−1 mol−1. Above what temperature will the reaction become spontaneous?",
    expect: "draw",
    labels: ["T = 400 K", "spontaneous", "ΔH = 40 kJ/mol"],
    note: "T_eq = ΔH/ΔS = 400 K, spontaneous above",
  },
  {
    question: "Construct the Born Haber cycle for NaCl. Enthalpy of sublimation of Na = 108 kJ/mol, ionisation enthalpy of Na = 496 kJ/mol, bond dissociation enthalpy of Cl2 = 242 kJ/mol, electron gain enthalpy of Cl = −349 kJ/mol and enthalpy of formation of NaCl = −411 kJ/mol. Calculate the lattice enthalpy of NaCl.",
    expect: "draw",
    labels: ["NaCl(s)", "U = −787 kJ", "IE = 496", "½ΔH_diss = 121"],
    note: "U = −411 − (108 + 496 + 121 − 349) = −787 kJ/mol",
  },
  {
    question: "Using the Ellingham diagram explain why carbon can reduce ZnO to zinc at high temperature but cannot reduce MgO.",
    expect: "draw",
    labels: ["2C+O_2→2CO", "2Zn+O_2→2ZnO", "2Mg+O_2→2MgO"],
    note: "qualitative; the CO line falls, oxide lines rise",
  },
  {
    question: "Using the Maxwell Boltzmann distribution of molecular energies explain why the fraction of molecules with energy greater than the activation energy increases with temperature.",
    expect: "draw",
    labels: ["T_1", "T_2", "E_a"],
    note: "qualitative: two curves, dashed threshold",
  },
  {
    question: "Which of the following graphs correctly represents the variation of thermodynamic properties of Haber's process with temperature?",
    expect: "draw",
    labels: ["ΔH°", "ΔS°", "ΔG°"],
    note: "ΔS° negative, so ΔG° rises with T",
  },
  {
    question: "The potential energy of the reactants is 20 kJ, the potential energy of the products is 10 kJ and the threshold energy is 80 kJ. Draw the energy profile and find the activation energy of the forward and backward reactions.",
    expect: "draw",
    labels: ["E_a = 60 kJ", "ΔH = −10 kJ"],
    note: "Ea(f) = 80 − 20 = 60, Ea(b) = 70, ΔH = −10",
  },
  {
    question: "Draw the Born Haber cycle for potassium chloride and label each enthalpy term.",
    expect: "draw",
    labels: ["KCl(s)", "ΔH_sub", "IE_1", "ΔH_lattice"],
    forbidLabels: ["U = −787 kJ"],
    note: "qualitative ladder with symbolic labels only",
  },
  {
    question: "One mole of an ideal gas expands isothermally and reversibly at 300 K from 10 L to 20 L. Draw the P-V diagram and calculate the work done.",
    expect: "decline",
    note: "physics state plot family",
  },
  {
    question: "Calculate ΔH for the reaction H2 + Cl2 → 2HCl from the bond enthalpies H−H = 436, Cl−Cl = 242 and H−Cl = 431 kJ/mol.",
    expect: "decline",
    note: "pure calculation, no profile cue",
  },
  {
    question: "The energy profile diagram shown below is for a two step reaction. Identify the rate determining step from the diagram shown.",
    expect: "decline",
    note: "figure absent: the stem refers to its own diagram",
  },
  {
    question: "Assertion: SN2 reaction of C6H5CH2Br occurs more readily than that of CH3CH2Br. Reason: the partially bonded p orbital in the trigonal bipyramidal transition state is stabilised by the ring.",
    expect: "decline",
    note: "organic mechanism, not an energy profile",
  },
];
