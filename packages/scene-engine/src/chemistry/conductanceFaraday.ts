/**
 * Conductivity κ = G l / A, molar conductivity Λm = 1000 κ / c,
 * Kohlrausch's limiting ionic sum, and Faraday deposition mass.
 *
 * The Λm versus √c curve and the electrolysis product figures stay in
 * electrochemistry.ts. A missing length, area, concentration, Faraday
 * constant, or efficiency is not invented, and a deposit that needs more
 * reactant than the stem provides is not drawn.
 */
import type { SceneDocument } from "../types";
import { elementBySymbol } from "./elements";
import { normalizeChemistryText } from "./formula";
import { ChemScene, chemStem, planQuantity, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_electrochem";
const HANDOFF = /variation of molar conductivity|√c|sqrt\(c\)|electrolys|brine|molten|internal resistance|daniell|salt bridge|dry cell|fuel cell|corrosion/;

const METAL_NAMES: Readonly<Record<string, string>> = {
  copper: "Cu",
  silver: "Ag",
  zinc: "Zn",
  nickel: "Ni",
  iron: "Fe",
  gold: "Au",
  aluminium: "Al",
  aluminum: "Al",
  lead: "Pb",
  tin: "Sn",
  chromium: "Cr",
  cobalt: "Co",
  cadmium: "Cd",
  magnesium: "Mg",
  sodium: "Na",
  potassium: "K",
  calcium: "Ca",
  mercury: "Hg",
  platinum: "Pt",
};

function shown(value: number): string {
  return String(Number(value.toPrecision(3)));
}

function captureNumber(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  const raw = match?.[1];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function statedOrPlanned(
  stem: string,
  pattern: RegExp,
  quantities: readonly ChemPlanQuantity[],
  aliases: readonly string[],
): number | null {
  const stated = captureNumber(stem, pattern);
  if (stated !== null) return stated;
  return planQuantity(quantities, aliases);
}

/** A plot or an electrolysis picture belongs to electrochemistry.ts. */
function handsOff(stem: string): boolean {
  if (HANDOFF.test(stem)) return true;
  return /(?:plot|graph|curve|variation)\b/.test(stem)
    && /molar conductivity|molar conductance|kohlrausch/.test(stem);
}

function faradayCue(stem: string): boolean {
  if (/faraday/.test(stem)) return true;
  return /deposit/.test(stem) && /\bi\s*=|\bcurrent\b/.test(stem) && /\bf\s*=|\bz\s*=|efficienc/.test(stem);
}

function kohlrauschCue(stem: string): boolean {
  return /kohlrausch|limiting ionic|ionic conductivity/.test(stem);
}

function molarCue(stem: string): boolean {
  if (kohlrauschCue(stem)) return false;
  return /molar conductivity|molar conductance/.test(stem)
    || (/lambda_?m|λ_?m/.test(stem) && /1000/.test(stem));
}

function kappaCue(stem: string): boolean {
  if (kohlrauschCue(stem) || molarCue(stem) || faradayCue(stem)) return false;
  return /\bconductance\b/.test(stem) || /\bconductivity\b/.test(stem) || /\bkappa\b/.test(stem) || /κ/.test(stem);
}

export function claimsConductanceFaraday(question: string): boolean {
  const stem = chemStem(question);
  if (handsOff(stem)) return false;
  return faradayCue(stem) || kohlrauschCue(stem) || molarCue(stem) || kappaCue(stem);
}

function place(question: string, reason: string, labels: readonly string[], caption: string): SceneDocument | null {
  if (labels.length === 0 || labels.length > 6) return null;
  if (labels.some((label) => label.length === 0 || label.length > 16)) return null;
  const scene = new ChemScene(question, reason, FAMILY);
  const ids: string[] = [];
  let y = 2.6;
  const step = -0.8;
  for (const [index, label] of labels.entries()) {
    ids.push(scene.text(`v${index}`, { x: 0.2, y }, label, "stated result"));
    y += step;
  }
  scene.scene.group("result", ids, reason);
  return scene.build({ caption });
}

function knownFormula(symbol: string): boolean {
  if (elementBySymbol(symbol)) return true;
  let index = 0;
  let count = 0;
  while (index < symbol.length) {
    const pair = symbol.slice(index, index + 2);
    if (pair.length === 2 && /[a-z]/.test(pair[1] ?? "") && elementBySymbol(pair)) index += 2;
    else if (elementBySymbol(symbol[index] ?? "")) index += 1;
    else return false;
    count += 1;
    while (index < symbol.length && /\d/.test(symbol[index] ?? "")) index += 1;
  }
  return count > 0;
}

interface IonTerm {
  label: string;
  value: number;
}

/** Limiting ionic conductivities written next to the ion, in stem order. */
function readIonConductivities(question: string): IonTerm[] | null {
  const text = normalizeChemistryText(question);
  const pattern = /([A-Z][a-z]?(?:\d*[A-Z][a-z]?\d*)*)\s*(?:\^\(\s*(\d*)\s*([+-])\s*\)|(\d*)\s*([+-])\s*\)?)\s*(?:is|=)\s*(-?\d+(?:\.\d+)?)/g;
  const ions: IonTerm[] = [];
  for (const match of text.matchAll(pattern)) {
    const symbol = match[1];
    const sign = match[3] ?? match[5];
    const raw = match[6];
    if (!symbol || !sign || raw === undefined) return null;
    if (!knownFormula(symbol)) continue;
    const value = Number(raw);
    if (!(value > 0)) return null;
    const digits = match[2] ?? match[4] ?? "";
    const charge = digits === "" || digits === "1" ? sign : `${digits}${sign}`;
    ions.push({ label: `${symbol}${charge}=${shown(value)}`, value });
  }
  return ions;
}

function buildKohlrausch(question: string): SceneDocument | null {
  const ions = readIonConductivities(question);
  if (!ions || ions.length < 2 || ions.length > 5) return null;
  let total = 0;
  for (const ion of ions) total += ion.value;
  const labels = [`Lm0=${shown(total)}`, ...ions.map((ion) => ion.label)];
  return place(
    question,
    "Kohlrausch sum of the stated ionic conductivities",
    labels,
    `Λm° = ${shown(total)} S cm2/mol, the sum of the stated limiting ionic conductivities.`,
  );
}

function cellUnitsDisagree(stem: string): boolean {
  const length = /\bl\s*=\s*-?\d+(?:\.\d+)?\s*(mm|cm|m)\b/.exec(stem);
  if (length && length[1] !== "cm") return true;
  const area = /\ba\s*=\s*-?\d+(?:\.\d+)?\s*(mm2|cm2|cm\^2|m2)\b/.exec(stem);
  if (area && area[1] !== "cm2" && area[1] !== "cm^2") return true;
  return false;
}

function buildKappa(question: string, stem: string, quantities: readonly ChemPlanQuantity[]): SceneDocument | null {
  if (cellUnitsDisagree(stem)) return null;
  const conductance = statedOrPlanned(stem, /\bg\s*=\s*(-?\d+(?:\.\d+)?)/, quantities, ["G", "conductance"]);
  const length = statedOrPlanned(stem, /\bl\s*=\s*(-?\d+(?:\.\d+)?)/, quantities, ["l", "length"]);
  const area = statedOrPlanned(stem, /\ba\s*=\s*(-?\d+(?:\.\d+)?)/, quantities, ["A", "area"]);
  if (conductance === null || conductance < 0 || length === null || !(length > 0) || area === null || !(area > 0)) return null;
  const kappa = conductance * length / area;
  if (!(kappa >= 0)) return null;
  const text = shown(kappa);
  return place(
    question,
    "conductivity from conductance, length and area",
    [`k=${text} S/cm`, "k=G*l/A"],
    `Conductivity κ = G l / A = ${text} S/cm from the stated conductance, length and electrode area.`,
  );
}

function molarUnitsDisagree(stem: string): boolean {
  const kappa = /\bkappa\s*=\s*-?\d+(?:\.\d+)?\s*s\s*\/\s*(cm|m)\b/.exec(stem);
  if (kappa && kappa[1] !== "cm") return true;
  const concentration = /\bc\s*=\s*-?\d+(?:\.\d+)?\s*mol\s*\/\s*(l|kg|m3)\b/.exec(stem);
  return concentration !== null && concentration[1] !== "l";
}

function buildMolar(question: string, stem: string, quantities: readonly ChemPlanQuantity[]): SceneDocument | null {
  if (molarUnitsDisagree(stem)) return null;
  const kappa = statedOrPlanned(stem, /\b(?:kappa|κ)\s*=\s*(-?\d+(?:\.\d+)?)/, quantities, ["kappa", "k"]);
  const concentration = statedOrPlanned(stem, /\bc\s*=\s*(-?\d+(?:\.\d+)?)/, quantities, ["c", "concentration"]);
  if (kappa === null || !(kappa > 0) || concentration === null || !(concentration > 0)) return null;
  const lambda = 1000 * kappa / concentration;
  const text = shown(lambda);
  return place(
    question,
    "molar conductivity from stated conductivity and concentration",
    [`Lm=${text}`, "1000k/c", "S cm2/mol"],
    `Molar conductivity Λm = 1000 κ / c = ${text} S cm2/mol from the stated conductivity and concentration.`,
  );
}

function canonicalizeSymbol(token: string): string | null {
  const letters = token.replace(/[^A-Za-z]/g, "");
  const named = METAL_NAMES[letters.toLowerCase()];
  if (named && elementBySymbol(named)) return named;
  if (letters.length === 2) {
    const symbol = letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase();
    if (elementBySymbol(symbol)) return symbol;
  }
  if (letters.length === 1) {
    const symbol = letters.toUpperCase();
    if (elementBySymbol(symbol)) return symbol;
  }
  return null;
}

function readMetal(question: string): { symbol: string; charge: number | null } | null {
  const text = normalizeChemistryText(question);
  const charged = /\b([A-Z][a-z]?)(?:\^\(\s*(\d*)\s*\+\s*\)|\^(\d*)\s*\+|(\d*)\s*\+)/.exec(text);
  if (charged) {
    const symbol = charged[1];
    if (symbol && elementBySymbol(symbol)) {
      const digits = charged[2] ?? charged[3] ?? charged[4] ?? "";
      const charge = digits === "" ? 1 : Number(digits);
      return { symbol, charge: charge > 0 ? charge : null };
    }
  }
  const deposited = /\b(?:deposits?|deposited)\s+([A-Z][a-z]?)\b/.exec(text);
  const depositedSymbol = deposited?.[1];
  if (depositedSymbol && elementBySymbol(depositedSymbol)) return { symbol: depositedSymbol, charge: null };
  const lower = text.toLowerCase();
  for (const [name, symbol] of Object.entries(METAL_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower) && elementBySymbol(symbol)) return { symbol, charge: null };
  }
  return null;
}

function readCurrent(stem: string, quantities: readonly ChemPlanQuantity[]): number | null {
  const match = /\bi\s*=\s*(-?\d+(?:\.\d+)?)\s*(milliamperes?|milliamps?|amperes?|amps?|ma|a)\b/.exec(stem)
    ?? /\bcurrent(?:\s+of|\s+is|=)?\s*(-?\d+(?:\.\d+)?)\s*(milliamperes?|milliamps?|amperes?|amps?|ma|a)\b/.exec(stem);
  if (match?.[1] && match[2]) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    return match[2].startsWith("m") ? value / 1000 : value;
  }
  const planned = quantities.find((quantity) => {
    const symbol = quantity.symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
    const id = quantity.id.toLowerCase().replace(/[^a-z0-9]/g, "");
    return symbol === "i" || symbol === "current" || id === "i" || id === "current";
  });
  if (!planned || !Number.isFinite(planned.value)) return null;
  const unit = planned.unit?.toLowerCase() ?? "";
  return /ma|milliamp/.test(unit) ? planned.value / 1000 : planned.value;
}

function readDuration(stem: string, quantities: readonly ChemPlanQuantity[]): { seconds: number; converted: boolean } | null {
  const match = /(?:\bt\s*=\s*|\bfor\s+)(-?\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?|s|h)\b/.exec(stem);
  if (match?.[1] && match[2]) {
    const value = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(value)) return null;
    if (unit.startsWith("h")) return { seconds: value * 3600, converted: true };
    if (unit.startsWith("min")) return { seconds: value * 60, converted: true };
    return { seconds: value, converted: false };
  }
  const planned = quantities.find((quantity) => {
    const symbol = quantity.symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
    const id = quantity.id.toLowerCase().replace(/[^a-z0-9]/g, "");
    return symbol === "t" || symbol === "time" || id === "t" || id === "time";
  });
  if (!planned || !Number.isFinite(planned.value)) return null;
  const unit = planned.unit?.toLowerCase() ?? "";
  if (/min/.test(unit)) return { seconds: planned.value * 60, converted: true };
  if (/hour|^h/.test(unit)) return { seconds: planned.value * 3600, converted: true };
  return { seconds: planned.value, converted: false };
}

/** Percent only when the stem states it. 100 percent stays 100, not an assumed default. */
function readEfficiency(stem: string): number | null {
  const match = /efficienc[^.]{0,48}?(\d+(?:\.\d+)?)\s*(?:%|percent\b)/.exec(stem)
    ?? /(\d+(?:\.\d+)?)\s*(?:%|percent\b)[^.]{0,32}efficienc/.exec(stem);
  if (!match) return null;
  const raw = match[1] ?? match[2];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function availableMoles(question: string, symbol: string): number | null {
  const text = normalizeChemistryText(question);
  const pattern = /(\d+(?:\.\d+)?)\s*mol(?:e|es)?\s+of\s+(?:the\s+)?([A-Za-z]+)/g;
  let limit: number | null = null;
  for (const match of text.matchAll(pattern)) {
    const amount = Number(match[1]);
    const token = match[2];
    if (!token || !Number.isFinite(amount)) continue;
    if (canonicalizeSymbol(token) !== symbol) continue;
    limit = limit === null ? amount : Math.min(limit, amount);
  }
  return limit;
}

function resolveZ(stem: string, charge: number | null, quantities: readonly ChemPlanQuantity[]): number | null {
  const stated = statedOrPlanned(stem, /\bz\s*=\s*(-?\d+(?:\.\d+)?)/, quantities, ["z"]);
  if (stated !== null && charge !== null && Math.abs(stated - charge) > 1e-9) return null;
  const z = stated ?? charge;
  if (z === null || !(z > 0)) return null;
  return z;
}

function buildFaraday(question: string, stem: string, quantities: readonly ChemPlanQuantity[]): SceneDocument | null {
  const metal = readMetal(question);
  if (!metal) return null;
  const element = elementBySymbol(metal.symbol);
  if (!element) return null;
  const current = readCurrent(stem, quantities);
  const duration = readDuration(stem, quantities);
  const faraday = captureNumber(stem, /\bf\s*=\s*(\d+(?:\.\d+)?)/);
  const efficiency = readEfficiency(stem);
  const z = resolveZ(stem, metal.charge, quantities);
  if (current === null || !(current > 0) || duration === null || !(duration.seconds > 0)) return null;
  if (faraday === null || !(faraday > 0) || efficiency === null || efficiency < 0 || efficiency > 100) return null;
  if (z === null) return null;
  const coulombs = current * duration.seconds;
  const molesMetal = (coulombs / faraday) * (efficiency / 100) / z;
  const available = availableMoles(question, metal.symbol);
  if (available !== null && molesMetal > available + 1e-9 * Math.max(1, available)) return null;
  const mass = element.mass * molesMetal;
  const labels = [`m=${shown(mass)} g`, `Q=${shown(coulombs)} C`];
  if (duration.converted) labels.push(`t=${shown(duration.seconds)} s`);
  else labels.push(`z=${shown(z)}`);
  labels.push(`eff=${shown(efficiency)}%`);
  return place(
    question,
    "Faraday deposition mass from the stated current, time and efficiency",
    labels,
    `Deposited mass m = M Q / (z F) at ${shown(efficiency)}% efficiency, Q = I t = ${shown(coulombs)} C, z = ${shown(z)}. M is the atomic mass of ${metal.symbol}.`,
  );
}

export function buildConductanceFaradayScene(
  question: string,
  quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  if (!claimsConductanceFaraday(question)) return null;
  const stem = chemStem(question);
  if (faradayCue(stem)) return buildFaraday(question, stem, quantities);
  if (kohlrauschCue(stem)) return buildKohlrausch(question);
  if (molarCue(stem)) return buildMolar(question, stem, quantities);
  if (kappaCue(stem)) return buildKappa(question, stem, quantities);
  return null;
}
