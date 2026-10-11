/**
 * Source-grounded solution figures for concentration, Henry's law,
 * a nonvolatile solute, colligative shifts, and the van't Hoff factor.
 *
 * Acid-base titration curves and the two-volatile Raoult plot stay in
 * solutionsGraphs.ts. A missing density, pressure, or constant is not
 * replaced with a textbook value.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, numberAfter, type ChemPlanQuantity } from "./sceneKit";

import { CHEMISTRY_SCALAR_PATTERN, matchedChemistryScalar, matchedChemistryQuantity, findChemistryQuantities, readChemistryQuantity, convertChemistryReading, chemistryPlanBindingsValid, chemistryCanonicalValuesAgree, chemistryUnitSymbol, type ChemistryDimension, type ChemistryUnit } from "./quantityReader";

const FAMILY = "chem_solutions" as const;

function fit(text: string): string {
  return text;
}

function shown(value: number): string {
  if (!Number.isFinite(value)) return "";
  // Decimal rounding must never turn a finite nonzero quantity into zero.
  if (value !== 0 && Math.abs(value) < 0.001) {
    const [mantissa, exponent] = value.toExponential(3).split("e");
    return `${Number(mantissa)}e${Number(exponent)}`;
  }
  return String(Number(value.toFixed(3)));
}

/** Keep each physical value and unit complete within the compact-label limit. */
function physicalResultLabels(symbol: string, value: number, unit: string): string[] {
  let number = shown(value);
  if (`${symbol}=${number}`.length > 16) {
    const [mantissa, exponent] = value.toExponential(3).split("e");
    number = `${Number(mantissa)}e${Number(exponent)}`;
  }
  const physicalValue = `${symbol}=${number}`;
  const full = `${physicalValue} ${unit}`;
  return full.length <= 16 ? [full] : [physicalValue,unit];
}

function take(match: RegExpMatchArray | null, group = 1): number | null {
  if (!match) return null;
  if (match[group] === undefined) group = match.findIndex((part, index) => index > 0 && part !== undefined);
  return matchedChemistryScalar(match.input!, match, group);
}
/** A declared factor must be read before a default or a derived factor exists. */
function suppliedVanthoffFactor(question: string): {value:number|null} | null {
  const cue = /\bvan['’]?t[\s-]+hoff\s+factor(?:\s*\(\s*i\s*\)|\s+i\b)?|\bi\b(?=\s*(?:[=:]|\b(?:is|was|equals|equal\s+to|unknown|unspecified|undefined|not|NaN)\b))/ig;
  const owners = [...question.matchAll(cue)];
  let value: number | null = null;
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index]!;
    const start = owner.index! + owner[0].length;
    const end = owners[index + 1]?.index ?? question.length;
    const tail = question.slice(start,end);
    const clause = question.slice(0,owner.index!).split(/[.;?!\n]/).at(-1) ?? "";
    const requested = /\b(?:find|calculate|determine|evaluate|compute|what\s+(?:is|are))\b/i.test(clause);
    const requestBoundary = /^\s*(?:$|[.;?!]\s*(?:$|(?:find|calculate|determine|evaluate|compute|what\s+(?:is|are))\b))/i.test(tail);
    const suppliedMaterial = !requestBoundary && /^\s*(?:[=:]|[+\-−.\d]|\\(?:frac|dfrac|tfrac)\b|\b(?:is|was|equals|equal\s+to|unknown|unreadable|unspecified|undefined|not|NaN|given|stated|measured|taken)\b)/i.test(tail);
    const requestContinuation = /^\s*(?:$|[;?!]|\.(?!\d)|(?:and|for|from|using|with|of|in|at|based\s+on)\b)/i.test(tail);
    // A requested quantity with no supplied material has no source value.
    // An assignment, scalar, damaged value or unread declaration remains an
    // owner even inside the same imperative clause as a genuine request.
    if (requested && !suppliedMaterial && requestContinuation) continue;
    if (start >= end) return null;
    // Read this original declaration alone: a later good i cannot hide an
    // earlier unknown, and a supplied unit cannot disappear in a scalar match.
    const read = readChemistryQuantity({question,after:/^/,within:{start,end},dimension:"dimensionless"});
    if (!read.ok || read.reading.rawUnit !== null || !(read.reading.value > 0)) return null;
    if (value !== null && !chemistryCanonicalValuesAgree(value,read.reading.value)) return null;
    value = read.reading.value;
  }
  return {value};
}
function literal(question: string, dimension: ChemistryDimension, targetUnit?: ChemistryUnit): number | null {
  const result = findChemistryQuantities({question, dimension, targetUnit});
  return result.ok && result.reading.length === 1 ? result.reading[0]!.value : null;
}
function panel(question: string, purpose: string, labels: readonly string[], caption: string): SceneDocument {
  const c = new ChemScene(question, purpose, FAMILY);
  labels.forEach((text, index) => {
    c.text(`v${index}`, { x: 0.3, y: 2.4 - index * 0.85 }, text, "solution result", {preserveText:true});
  });
  return c.build({ caption });
}

function claimsConcentration(stem: string): boolean {
  return /molarity|molality|mole fraction|mass percent|percentage by mass|volume percent|mass\/volume|dilut/.test(stem);
}

function diagramCue(stem: string): boolean {
  return /(?:elevation (?:in|of) (?:the )?boiling point|boiling point elevation|depression (?:in|of) (?:the )?freezing point|freezing point depression|ebullioscop|cryoscop).{0,200}(?:graph|diagram|curve|plot|vapou?r pressure)|(?:graph|diagram|curve|plot|vapou?r pressure).{0,200}(?:elevation (?:in|of) (?:the )?boiling point|boiling point elevation|depression (?:in|of) (?:the )?freezing point|freezing point depression)/.test(stem);
}

function claimsHenry(stem: string): boolean {
  if (/henry/.test(stem)) return true;
  // The declared relation and dissolved-gas quantity roles establish the
  // intent even when the question does not name the law.
  return /(?:p\s*=\s*k_?h\s*\*?\s*x\b|c\s*=\s*k_?h\s*\*?\s*p\b)/.test(stem)
    && /\bk_?h\s*=/.test(stem)
    && /dissolv|partial pressure|mole fraction/.test(stem);
}

function twoVolatilePlot(stem: string): boolean {
  if (/non\s*-?\s*volatile|relative lowering/.test(stem) || claimsHenry(stem)) return false;
  return /raoult|positive deviation|negative deviation|deviations? from (?:the )?ideal|ideal solution.{0,120}(?:graph|plot|curve|deviation)|(?:graph|plot|curve).{0,120}ideal solution|vapou?r pressure.{0,160}(?:mole fraction|composition|plot|graph|deviation)|(?:mole fraction|composition|plot|graph).{0,160}vapou?r pressure/.test(stem);
}

/** True when this chapter's new models own the stem, including honest declines. */
export function claimsSolutionLesson(question: string): boolean {
  const stem = chemStem(question);
  if (/titr|thiosulph|thiosulf|redox|buffer|shown (?:in|below)|following (?:figure|graph)/.test(stem)) return false;
  if (diagramCue(stem) || twoVolatilePlot(stem)) return false;
  return claimsConcentration(stem)
    || claimsHenry(stem)
    || /non\s*-?\s*volatile/.test(stem)
    || /relative lowering|lowering of vapou?r pressure/.test(stem)
    || /osmotic pressure|van'?t hoff|vant hoff|degree of dissociation|degree of association|molar mass|molecular mass/.test(stem)
    || (/boiling point|freezing point/.test(stem) && /k_?[bf]\b|molality|molal\b/.test(stem));
}

function concentrationScene(question: string, stem: string): SceneDocument | null {
  if (/titr/.test(stem)) return null;
  const asksMolalityFromMolar = /convert/.test(stem) && /molar/.test(stem);
  if (asksMolalityFromMolar && !/density/.test(stem)) return null;

  const density = numberAfter(question, /density/, "density", "g/cm^3");
  const molarMass = numberAfter(question, /molar mass(?:\s+of(?:\s+the)?\s+solute)?/, "molar_mass", "g/mol");
  const molar = literal(question, "concentration", "mol/L");
  if (density !== null && molar !== null && molarMass !== null && /molality/.test(stem)) {
    if (!(density > 0) || !(molar > 0) || !(molarMass > 0)) return null;
    const solventKg = (density * 1000 - molar * molarMass) / 1000;
    if (!(solventKg > 0)) return null;
    const molal = molar / solventKg;
    return panel(question, "molality from molarity using the stated density", [
      `M=${molar} mol/L`,
      `m=${shown(molal)} mol/kg`,
      `d=${density} g/mL`,
      "density given",
    ], `One litre of solution has mass ${density * 1000} g. Solute mass is ${molar} × ${molarMass} g, so the solvent mass is ${solventKg.toFixed(3)} kg and the molality is ${molal.toFixed(2)} mol/kg. Density was not assumed.`);
  }

  const dilution = new RegExp(String.raw`(${CHEMISTRY_SCALAR_PATTERN})\s*ml\s+of\s+(${CHEMISTRY_SCALAR_PATTERN})\s*m\b[^.]{0,48}?dilut\w*(?:\s+to)?\s+(${CHEMISTRY_SCALAR_PATTERN})\s*ml`, "id").exec(question);
  if (/dilut/.test(stem)) {
    if (!dilution || molar === null) return null;
    const v1 = matchedChemistryQuantity(question, dilution, 1, "volume", "L") ?? NaN;
    const v2 = matchedChemistryQuantity(question, dilution, 3, "volume", "L") ?? NaN;
    const statedM = matchedChemistryQuantity(question, dilution, 2, "concentration", "mol/L") ?? NaN;
    if (!(v1 > 0) || !(v2 > 0) || !(statedM > 0) || statedM !== molar) return null;
    const moles = molar * v1;
    const finalM = moles / v2;
    return panel(question, "dilution at constant solute amount", [
      `M1=${molar} mol/L`,
      `M2=${finalM} mol/L`,
      `n=${moles} mol`,
      "solute kept",
    ], `${v1} L of ${molar} mol/L contains ${moles} mol. After dilution to ${v2} L the molarity is ${finalM} mol/L. Volumes were not assumed to come from a reaction.`);
  }

  const pair = new RegExp(String.raw`(${CHEMISTRY_SCALAR_PATTERN})\s*mol(?:e|es)?\s+of\s+([a-z])\b[^.]{0,48}?(${CHEMISTRY_SCALAR_PATTERN})\s*mol(?:e|es)?\s+of\s+([a-z])\b`, "id").exec(question);
  if (/mole fraction/.test(stem) && pair) {
    const n1 = matchedChemistryQuantity(question, pair, 1, "amount", "mol") ?? NaN;
    const n2 = matchedChemistryQuantity(question, pair, 3, "amount", "mol") ?? NaN;
    if (!(n1 > 0) || !(n2 > 0)) return null;
    const total = n1 + n2;
    const x1 = n1 / total;
    const x2 = n2 / total;
    const name1 = pair[2]!.toUpperCase();
    const name2 = pair[4]!.toUpperCase();
    return panel(question, "mole fractions of the stated components", [
      `x${name1}=${shown(x1)}`,
      `x${name2}=${shown(x2)}`,
      "sum=1",
      `n=${total} mol`,
    ], `x_${name1} = ${n1}/${total} = ${x1.toFixed(2)} and x_${name2} = ${n2}/${total} = ${x2.toFixed(2)}. The two mole fractions add to 1.`);
  }
  if (/x_?[a-z]\s*=\s*\d/.test(stem) && /x_?[a-z]\s*=\s*\d/.test(stem.slice(stem.search(/x_?[a-z]/) + 2))) {
    const found = [...question.matchAll(new RegExp(String.raw`x_?([a-z])\s*=\s*(${CHEMISTRY_SCALAR_PATTERN})`, "gid"))];
    if (found.length >= 2) {
      const sum = found.reduce((total, item) => total + (matchedChemistryScalar(question, item, 2) ?? NaN), 0);
      if (Math.abs(sum - 1) > 1e-6) return null;
    }
  }

  const solventMass = new RegExp(String.raw`(${CHEMISTRY_SCALAR_PATTERN})\s*g\s+of\s+solute\s+(?:is\s+)?dissolved\s+in\s+(${CHEMISTRY_SCALAR_PATTERN})\s*g\s+of\s+solvent`, "id").exec(question);
  const solutionMass = new RegExp(String.raw`(${CHEMISTRY_SCALAR_PATTERN})\s*g\s+of\s+solute\s+in\s+(${CHEMISTRY_SCALAR_PATTERN})\s*g\s+of\s+solution`, "id").exec(question);
  if (/mass percent|percentage by mass/.test(stem)) {
    if (solventMass && solutionMass) return null;
    if (solventMass) {
      const solute = matchedChemistryQuantity(question, solventMass, 1, "mass", "g") ?? NaN;
      const solvent = matchedChemistryQuantity(question, solventMass, 2, "mass", "g") ?? NaN;
      if (!(solute >= 0) || !(solvent > 0)) return null;
      const percent = (100 * solute) / (solute + solvent);
      return panel(question, "mass percent from solute and solvent masses", [
        `${shown(percent)} mass%`,
        `solute ${solute} g`,
        `solvent ${solvent} g`,
        `soln ${solute + solvent} g`,
      ], `The solution mass is ${solute} + ${solvent} = ${solute + solvent} g. Mass percent is 100 × ${solute}/${solute + solvent} = ${percent.toFixed(2)}. Solvent mass was not used as the solution mass.`);
    }
    if (solutionMass) {
      const solute = matchedChemistryQuantity(question, solutionMass, 1, "mass", "g") ?? NaN;
      const solution = matchedChemistryQuantity(question, solutionMass, 2, "mass", "g") ?? NaN;
      if (!(solute >= 0) || !(solution > 0) || solute > solution) return null;
      const percent = (100 * solute) / solution;
      return panel(question, "mass percent from solute and solution masses", [
        `${shown(percent)} mass%`,
        `solute ${solute} g`,
        `soln ${solution} g`,
        "solution mass",
      ], `Mass percent is 100 × ${solute}/${solution} = ${percent.toFixed(2)}. The ${solution} g is the solution, not an extra solvent mass.`);
    }
    return null;
  }

  const volumePercent = new RegExp(String.raw`(${CHEMISTRY_SCALAR_PATTERN})\s*ml\s+of\s+(?:the\s+)?solute\s+in\s+(${CHEMISTRY_SCALAR_PATTERN})\s*ml\s+of\s+solution`, "id").exec(question);
  if (/volume percent/.test(stem) && volumePercent) {
    const part = matchedChemistryQuantity(question, volumePercent, 1, "volume", "mL") ?? NaN;
    const whole = matchedChemistryQuantity(question, volumePercent, 2, "volume", "mL") ?? NaN;
    if (!(part >= 0) || !(whole > 0) || part > whole) return null;
    const percent = (100 * part) / whole;
    return panel(question, "volume percent on the stated solution volume", [
      `${shown(percent)} vol%`,
      `solute ${part} mL`,
      `soln ${whole} mL`,
      "not additive",
    ], `Volume percent is 100 × ${part}/${whole} = ${percent.toFixed(2)} on the stated solution volume. Separate liquid volumes were not assumed to add.`);
  }

  const moles = literal(question, "amount", "mol");
  const litres = numberAfter(question, /solution volume of/, "volume", "L");
  if (/molarity/.test(stem) && moles !== null && litres !== null) {
    if (!(moles > 0) || !(litres > 0)) return null;
    const value = moles / litres;
    return panel(question, "molarity from solute moles and solution volume", [
      `M=${value} mol/L`,
      `n=${moles} mol`,
      `V=${litres} L`,
      "solution V",
    ], `Molarity is ${moles}/${litres} = ${value} mol/L. The volume is the solution volume.`);
  }

  const molalMoles = literal(question, "amount", "mol");
  const solvent = new RegExp(String.raw`(${CHEMISTRY_SCALAR_PATTERN})\s*(g|kg)\s+of\s+solvent`, "id").exec(question);
  if (/molality/.test(stem) && molalMoles !== null && solvent) {
    if (!(molalMoles > 0)) return null;
    const kg = matchedChemistryQuantity(question, solvent, 1, "mass", "kg") ?? NaN;
    if (!(kg > 0)) return null;
    const value = molalMoles / kg;
    return panel(question, "molality from solute moles and solvent mass", [
      `m=${value} mol/kg`,
      `n=${molalMoles} mol`,
      `solvent ${kg} kg`,
      "not solution",
    ], `Molality is ${molalMoles}/${kg} = ${value} mol/kg of solvent. The denominator is solvent mass, not solution volume.`);
  }
  return null;
}

function henryScene(question: string, stem: string): SceneDocument | null {
  const pressureForm = /p\s*=\s*k_?h\s*\*?\s*x\b/.test(stem);
  const concentrationForm = /c\s*=\s*k_?h\s*\*?\s*p\b/.test(stem);
  if (pressureForm === concentrationForm) return null;
  if (/total pressure/.test(stem) && !/partial pressure/.test(stem)) return null;
  const constant = readChemistryQuantity({question,after:/k_?h\s*=/,dimension:concentrationForm?"concentration_pressure":"pressure"});
  if (!constant.ok || !(constant.reading.value > 0)) return null;
  // Computation stays in the reader's canonical dimension; the pressure-form
  // board uses the actual declared unit after a checked display conversion.
  const unit = concentrationForm
    ? (/bar/.test(constant.reading.rawUnit ?? "") ? "bar" : "atm")
    : chemistryUnitSymbol(constant.reading.rawUnit ?? "", "pressure");
  if (!unit) return null;
  const display = convertChemistryReading(constant.reading,concentrationForm?(unit === "bar"?"mol/(L bar)":"mol/(L atm)"):unit);
  if (!display.ok) return null;
  const kH = display.reading.value;
  if (concentrationForm) {
    const partial = numberAfter(question, /partial pressure/, "pressure", unit);
    if (partial === null || !(partial > 0)) return null;
    const concentration = kH * partial;
    return panel(question, "Henry concentration at the stated gas partial pressure", [
      fit(`c=${shown(concentration)} mol/L`),
      `p=${partial} ${unit}`,
      "c=kH*p",
      "T fixed",
    ], `The declared convention is c = k_H p. At partial pressure ${partial} ${unit}, c = ${shown(kH)} × ${shown(partial)} = ${shown(concentration)}. Temperature is the stated fixed temperature, and the pressure is the gas partial pressure.`);
  }
  const zero = /zero partial pressure|partial pressure is zero|\bp\s*=\s*0\b/.test(stem);
  const mole = take(new RegExp(String.raw`mole fraction(?:\s+of(?:\s+the)?\s+dissolved gas)?(?:\s+is)?\s*(${CHEMISTRY_SCALAR_PATTERN})|x\s*=\s*(${CHEMISTRY_SCALAR_PATTERN})`, "id").exec(question));
  const x = zero ? 0 : mole;
  if (x === null || x < 0 || x > 1) return null;
  const pressure = kH * x;
  const c = new ChemScene(question, "Henry's law line at fixed temperature", FAMILY);
  const scale = 0.6 / kH;
  c.scene.axes("axes", -0.08, 1.35, -1.7, 0.9, "partial pressure against mole fraction");
  c.scene.curve("henry", `(${scale})*(${kH})*x`, 0, 1, "Henry partial pressure", undefined, 17);
  c.scene.point("state", { x, y: scale * pressure }, "stated dissolved gas");
  c.scene.assert("on_line", "function_value", ["henry"], { x, y: Number((scale * pressure).toFixed(8)) }, "warning");
  c.text("p_l", { x: 0.05, y: 0.78 }, fit(`p=${shown(pressure)} ${unit}`), "gas partial pressure");
  c.text("law_l", { x: 0.05, y: -0.55 }, "p=kH*x", "declared Henry convention");
  c.text("x_l", { x: 0.05, y: -0.95 }, fit(x === 0 ? "x=0" : `x=${shown(x)}`), "dissolved mole fraction");
  c.text("temp_l", { x: 0.05, y: -1.3 }, "T fixed", "temperature held fixed");
  c.text("scale_l", { x: 0.55, y: -1.3 }, "display scaled", "axis height is not the pressure unit");
  return c.build({ caption: `Henry's law in the declared form p = k_H x gives p = ${shown(kH)} × ${x} = ${shown(pressure)} ${unit}. The line is display-scaled. k_H applies at the stated fixed temperature in the dilute range, and p is the gas partial pressure.` });
}

function nonvolatileScene(question: string, stem: string): SceneDocument | null {
  if (/\bvolatile solute\b|\bsolute is volatile\b|\bsecond volatile\b/.test(stem)) return null;
  const solute = take(new RegExp(String.raw`mole fraction of (?:the )?solute(?:\s+is)?\s*(${CHEMISTRY_SCALAR_PATTERN})|x_?solute\s*=\s*(${CHEMISTRY_SCALAR_PATTERN})`, "id").exec(question));
  const pure = numberAfter(question, /pure[^.;]{0,40}?vapou?r pressure|p\s*°/, "pressure", "kPa");
  if (solute === null || pure === null || !(pure > 0) || solute < 0 || solute > 1) return null;
  const solvent = 1 - solute;
  const pressure = solvent * pure;
  const unit = "kPa";
  if (!unit) return null;
  const c = new ChemScene(question, "vapour pressure of a solvent with a nonvolatile solute", FAMILY);
  const scale = 0.6 / pure;
  c.scene.axes("axes", -0.08, 1.35, -1.5, 0.9, "solution vapour pressure against solvent mole fraction");
  c.scene.curve("solvent", `(${scale})*(${pure})*x`, 0, 1, "solvent partial pressure", undefined, 17);
  c.scene.point("mix", { x: solvent, y: scale * pressure }, "stated solution");
  c.scene.assert("on_line", "function_value", ["solvent"], { x: Number(solvent.toFixed(8)), y: Number((scale * pressure).toFixed(8)) }, "warning");
  c.text("p_l", { x: 0.05, y: 0.78 }, fit(`p=${shown(pressure)} ${unit}`), "solution vapour pressure");
  c.text("zero_l", { x: 0.05, y: -0.55 }, "solute p=0", "nonvolatile solute");
  c.text("x_l", { x: 0.05, y: -0.95 }, fit(`xsolv=${shown(solvent)}`), "solvent mole fraction");
  c.text("scale_l", { x: 0.05, y: -1.3 }, "display scaled", "axis height is not the pressure unit");
  return c.build({ caption: `The nonvolatile solute adds no vapour pressure. p = x_solvent p° = ${solvent} × ${shown(pure)} = ${shown(pressure)} ${unit}. The line is display-scaled and is not a second volatile component.` });
}

function colligativeScene(question: string, stem: string): SceneDocument | null {
  if (/molar mass|molecular mass|van'?t hoff|vant hoff|degree of dissociation|degree of association/.test(stem)) return null;
  const dissociating = /dissociat|associat|electrolyte/.test(stem);
  const supplied = suppliedVanthoffFactor(question);
  if (!supplied) return null;
  const factor = supplied.value;
  if (dissociating && factor === null) return null;
  const i = factor ?? 1;
  if (!(i > 0)) return null;

  if (/osmotic pressure/.test(stem)) {
    const concentration = literal(question, "concentration", "mol/L");
    const temperature = literal(question, "temperature", "K");
    const gasRead = readChemistryQuantity({question, after: /\bR\s*=/, dimension: "gas_constant"});
    if (!gasRead.ok) return null;
    const unit = gasRead.reading.rawUnit?.includes("bar") ? "bar" : "atm";
    const convertedGas = convertChemistryReading(gasRead.reading, unit === "bar" ? "L bar/(mol K)" : "L atm/(mol K)");
    const gas = convertedGas.ok ? convertedGas.reading.value : null;
    if (concentration === null || temperature === null || gas === null) return null;
    if (!(concentration > 0) || !(temperature > 0) || !(gas > 0)) return null;
    if (/molal/.test(stem) && !/mol\s*\/\s*l|\d\s*M\b/.test(question)) return null;
    const pressure = i * concentration * gas * temperature;
    const c = new ChemScene(question, "osmotic pressure across a solvent-permeable membrane", FAMILY);
    c.link("membrane", { x: 2.1, y: 0 }, { x: 2.1, y: 2.6 }, "semipermeable membrane", false);
    c.arrow("flow", { x: 0.3, y: 1.3 }, { x: 1.9, y: 1.3 }, "solvent flow into the solution");
    c.text("solvent_l", { x: 0.1, y: 2.2 }, "solvent", "solvent crosses the membrane");
    c.text("block_l", { x: 2.5, y: 2.2 }, "no solute", "solute stays on the solution side");
    c.text("pi_l", { x: 2.5, y: 1.2 }, fit(`pi=${shown(pressure)} ${unit}`), "osmotic pressure");
    c.text("temp_l", { x: 0.1, y: 0.3 }, fit(`T=${shown(temperature)} K`), "absolute temperature");
    return c.build({ caption: `π = i c R T = ${i} × ${concentration} × ${gas} × ${temperature} = ${pressure} ${unit}. The membrane lets solvent through and keeps the solute back, so net solvent flow is toward the solution until the pressure balances π. c is molarity and T is absolute temperature.` });
  }

  if (/relative lowering|lowering of vapou?r pressure/.test(stem)) {
    const solute = take(new RegExp(String.raw`x_?solute\s*=\s*(${CHEMISTRY_SCALAR_PATTERN})|mole fraction of (?:the )?solute(?:\s+is)?\s*(${CHEMISTRY_SCALAR_PATTERN})`, "id").exec(question));
    const pure = numberAfter(question, /pure[^.;]{0,40}?vapou?r pressure/, "pressure", "kPa");
    if (solute === null || pure === null || !(pure > 0) || solute < 0 || solute > 1) return null;
    const lowering = solute * pure;
    const pressure = pure - lowering;
    const unit = "kPa";
    if (!unit) return null;
    return panel(question, "relative vapour-pressure lowering for a nonvolatile solute", [
      `xsol=${solute}`,
      `dp/p=${solute}`,
      fit(`p=${shown(pressure)} ${unit}`),
      "nonvolatile",
    ], `For a dilute solution of a nonvolatile solute, (p° − p)/p° = x_solute = ${solute}. With p° = ${shown(pure)} ${unit}, p = ${shown(pressure)} ${unit}.`);
  }

  const molality = literal(question, "molality", "mol/kg");
  if (molality === null || !(molality > 0)) return null;
  const boiling = /boiling/.test(stem);
  const freezing = /freezing/.test(stem);
  if (boiling === freezing) return null;
  if (boiling && /decreas|falls|lower/.test(stem)) return null;
  if (freezing && /increas|rises|higher/.test(stem)) return null;
  const constant = numberAfter(question, boiling ? /k_?b\s*=/ : /k_?f\s*=/, "colligative_constant", "K kg/mol");
  if (constant === null || !(constant > 0)) return null;
  const delta = i * constant * molality;
  const reference = numberAfter(question, boiling ? /boiling point of (?:the )?pure solvent/ : /freezing point of (?:the )?pure solvent/, "temperature", "K");
    const labels = boiling
    ? [`dTb=${shown(delta)} K`, `m=${molality}`, "boiling up", reference === null ? "Tb not given" : `Tb=${shown(reference + delta)} K`]
    : [`dTf=${shown(delta)} K`, `m=${molality}`, "freezing down", reference === null ? "Tf not given" : `Tf=${shown(reference - delta)} K`];
  const shift = reference === null
    ? "The pure-solvent temperature was not stated, so only the shift is given."
    : boiling
      ? `The solution boils at ${reference} + ${delta} = ${reference + delta} K.`
      : `The solution freezes at ${reference} − ${delta} = ${reference - delta} K.`;
  return panel(
    question,
    boiling ? "boiling-point elevation of a dilute solution" : "freezing-point depression of a dilute solution",
    labels,
    boiling
      ? `ΔT_b = i K_b m = ${i} × ${constant} × ${molality} = ${delta} K. Boiling moves up. ${shift} Molality is not molarity.`
      : `ΔT_f = i K_f m = ${i} × ${constant} × ${molality} = ${delta} K. Freezing moves down. ${shift} Molality is not molarity.`,
  );
}

function molarMassScene(question: string, stem: string): SceneDocument | null {
  const dissociation = /dissociat/.test(stem);
  const association = /associat/.test(stem);
  if (dissociation && association) return null;
  const alpha = take(new RegExp(String.raw`alpha\s*=\s*(${CHEMISTRY_SCALAR_PATTERN})|α\s*=\s*(${CHEMISTRY_SCALAR_PATTERN})|degree of (?:dissociation|association)(?:\s+is)?\s*(${CHEMISTRY_SCALAR_PATTERN})`, "id").exec(question));
  const nu = take(/into\s+(\d+)\s+particles|ν\s*=\s*(\d+)|\bnu\s*=\s*(\d+)/id.exec(question));
  const monomers = take(/(\d+)\s+monomers|\bk\s*=\s*(\d+)/id.exec(question));
  if (alpha !== null && (alpha < 0 || alpha > 1)) return null;
  if (dissociation && (nu === null || nu < 2)) return null;
  if (association && (monomers === null || monomers < 2)) return null;
  const supplied = suppliedVanthoffFactor(question);
  if (!supplied) return null;
  let factor: number | null = supplied.value;
  if (dissociation && alpha !== null && nu !== null) {
    const predicted = 1 + (nu - 1) * alpha;
    if (factor !== null && Math.abs(factor - predicted) > 1e-6) return null;
    factor = predicted;
  }
  if (association && alpha !== null && monomers !== null) {
    const predicted = 1 - alpha + alpha / monomers;
    if (factor !== null && Math.abs(factor - predicted) > 1e-6) return null;
    factor = predicted;
  }
  if ((dissociation || association) && factor === null) return null;

  const trueMass = numberAfter(question, /(?:true )?molar mass/, "molar_mass", "g/mol");
  if (trueMass !== null && factor !== null) {
    // A given factor and mass do not change a freezing/boiling/osmotic request
    // into an apparent-mass question.
    if (!/\b(?:find|calculate|determine|what is)\b[^.;?]{0,60}\bapparent (?:molar|molecular) mass\b/.test(stem)) return null;
    if (!(trueMass > 0) || !(factor > 0)) return null;
    const apparent = trueMass / factor;
    return panel(question, "apparent molar mass from the van't Hoff factor", [
      `i=${shown(factor)}`,
      ...physicalResultLabels("M'",apparent,"g/mol"),
      factor > 1 ? "M' < M" : factor < 1 ? "M' > M" : "M' = M",
      ...physicalResultLabels("M",trueMass,"g/mol"),
    ], `M_apparent = M_true / i = ${trueMass} / ${factor} = ${apparent} g/mol. ${factor > 1 ? "Dissociation raises i, so the apparent molar mass is smaller than the true mass." : factor < 1 ? "Association lowers i, so the apparent molar mass is larger than the true mass." : "i = 1, so the apparent and true molar masses agree."}`);
  }

  const grams = new RegExp(String.raw`(${CHEMISTRY_SCALAR_PATTERN})\s*g\s+of\s+a\s+non\s*-?\s*volatile\s+solute\s+dissolved\s+in\s+(${CHEMISTRY_SCALAR_PATTERN})\s*g\s+of\s+(?:water|solvent)`, "id").exec(question);
  const delta = numberAfter(question, /(?:lowers|raises|depress\w*|elevat\w*)[^.;]{0,40}?by/, "temperature_delta", "K");
  const kf = numberAfter(question, /k_?f\s*=/, "colligative_constant", "K kg/mol");
  const kb = numberAfter(question, /k_?b\s*=/, "colligative_constant", "K kg/mol");
  if (!grams || delta === null) return null;
  const solute = matchedChemistryQuantity(question, grams, 1, "mass", "g") ?? NaN;
  const solvent = matchedChemistryQuantity(question, grams, 2, "mass", "g") ?? NaN;
  if (!(solute > 0) || !(solvent > 0) || !(delta > 0)) return null;
  const i = factor ?? (/dissociat|associat|electrolyte/.test(stem) ? null : 1);
  if (i === null || !(i > 0)) return null;
  const constant = /freez/.test(stem) ? kf : /boil/.test(stem) ? kb : null;
  if (constant === null || !(constant > 0)) return null;
  const molar = (i * constant * solute * 1000) / (delta * solvent);
  return panel(question, "molar mass from the stated colligative shift", [
    fit(`M=${shown(molar)} g/mol`),
    `i=${i}`,
    `${solute} g solute`,
    `${solvent} g solvent`,
  ], `M = i K w × 1000 / (ΔT W) = ${i} × ${constant} × ${solute} × 1000 / (${delta} × ${solvent}) = ${molar} g/mol. Dissociation was not assumed.`);
}

/** The figure for a claimed solution stem, or null when the numbers do not ground one. */
export function buildSolutionLessonScene(
  question: string,
  planQuantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  if (!chemistryPlanBindingsValid(question, planQuantities)) return null;
  const stem = chemStem(question);
  const concentration = claimsConcentration(stem)
    && !claimsHenry(stem)
    && !/henry|osmotic|boiling point|freezing point|non\s*-?\s*volatile|relative lowering|van'?t hoff|vant hoff/.test(stem)
    && !(/molar mass|molecular mass/.test(stem) && !/density/.test(stem));
  if (concentration) return concentrationScene(question, stem);
  if (claimsHenry(stem)) return henryScene(question, stem);
  const molarMassAsk = /(?:apparent|true)\s+(?:molar|molecular) mass|(?:find|calculate|determine|what is)\b[^.;?]{0,45}\b(?:molar|molecular) mass|degree of dissociation|degree of association/.test(stem);
  if (molarMassAsk && !/density/.test(stem)) {
    return molarMassScene(question, stem);
  }
  if (/osmotic pressure|relative lowering|lowering of vapou?r pressure|boiling point|freezing point/.test(stem) && !/non\s*-?\s*volatile/.test(stem)) {
    return colligativeScene(question, stem);
  }
  if (/non\s*-?\s*volatile/.test(stem)) return nonvolatileScene(question, stem);
  return null;
}
