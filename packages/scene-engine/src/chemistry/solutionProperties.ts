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

import { CHEMISTRY_SCALAR_PATTERN, matchedChemistryScalar, matchedChemistryQuantity, findChemistryQuantities, readChemistryQuantity, convertChemistryReading, chemistryPlanBindingsValid, type ChemistryDimension, type ChemistryUnit } from "./quantityReader";

const FAMILY = "chem_solutions" as const;

function fit(text: string): string {
  return text;
}

function shown(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Number(value.toFixed(3));
  return String(rounded);
}

function take(match: RegExpMatchArray | null, group = 1): number | null {
  if (!match) return null;
  if (match[group] === undefined) group = match.findIndex((part, index) => index > 0 && part !== undefined);
  return matchedChemistryScalar(match.input!, match, group);
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

function twoVolatilePlot(stem: string): boolean {
  if (/non\s*-?\s*volatile|henry|relative lowering/.test(stem)) return false;
  return /raoult|positive deviation|negative deviation|deviations? from (?:the )?ideal|ideal solution.{0,120}(?:graph|plot|curve|deviation)|(?:graph|plot|curve).{0,120}ideal solution|vapou?r pressure.{0,160}(?:mole fraction|composition|plot|graph|deviation)|(?:mole fraction|composition|plot|graph).{0,160}vapou?r pressure/.test(stem);
}

/** True when this chapter's new models own the stem, including honest declines. */
export function claimsSolutionLesson(question: string): boolean {
  const stem = chemStem(question);
  if (/titr|thiosulph|thiosulf|redox|buffer|shown (?:in|below)|following (?:figure|graph)/.test(stem)) return false;
  if (diagramCue(stem) || twoVolatilePlot(stem)) return false;
  return claimsConcentration(stem)
    || /henry/.test(stem)
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
  const kH = numberAfter(question, /k_?h\s*=/, concentrationForm ? "concentration_pressure" : "pressure", concentrationForm ? "mol/(L atm)" : "atm");
  if (kH === null || !(kH > 0)) return null;
  const unit = "atm";
  if (!unit) return null;
  if (concentrationForm) {
    const partial = numberAfter(question, /partial pressure/, "pressure", "atm");
    if (partial === null || !(partial > 0)) return null;
    const concentration = kH * partial;
    return panel(question, "Henry concentration at the stated gas partial pressure", [
      fit(`c=${shown(concentration)} mol/L`),
      `p=${partial} ${unit}`,
      "c=kH*p",
      "T fixed",
    ], `The declared convention is c = k_H p. At partial pressure ${partial} ${unit}, c = ${kH} × ${partial} = ${concentration}. Temperature is the stated fixed temperature, and the pressure is the gas partial pressure.`);
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
  return c.build({ caption: `Henry's law in the declared form p = k_H x gives p = ${kH} × ${x} = ${pressure} ${unit}. The line is display-scaled. k_H applies at the stated fixed temperature in the dilute range, and p is the gas partial pressure.` });
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
  return c.build({ caption: `The nonvolatile solute adds no vapour pressure. p = x_solvent p° = ${solvent} × ${pure} = ${pressure} ${unit}. The line is display-scaled and is not a second volatile component.` });
}

function colligativeScene(question: string, stem: string): SceneDocument | null {
  if (/molar mass|molecular mass|van'?t hoff|vant hoff|degree of dissociation|degree of association/.test(stem)) return null;
  const dissociating = /dissociat|associat|electrolyte/.test(stem);
  const factor = take(new RegExp(String.raw`\bi\s*=\s*(${CHEMISTRY_SCALAR_PATTERN})`, "id").exec(question));
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
      fit(`p=${pressure} ${unit}`),
      "nonvolatile",
    ], `For a dilute solution of a nonvolatile solute, (p° − p)/p° = x_solute = ${solute}. With p° = ${pure} ${unit}, p = ${pressure} ${unit}.`);
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
  let factor: number | null = take(new RegExp(String.raw`\bi\s*=\s*(${CHEMISTRY_SCALAR_PATTERN})`, "id").exec(question));
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
    if (!(trueMass > 0) || !(factor > 0)) return null;
    const apparent = trueMass / factor;
    return panel(question, "apparent molar mass from the van't Hoff factor", [
      `i=${shown(factor)}`,
      `M'=${shown(apparent)} g/mol`,
      factor > 1 ? "M' < M" : factor < 1 ? "M' > M" : "M' = M",
      `M=${trueMass} g/mol`,
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
    && !/henry|osmotic|boiling point|freezing point|non\s*-?\s*volatile|relative lowering|van'?t hoff|vant hoff/.test(stem)
    && !(/molar mass|molecular mass/.test(stem) && !/density/.test(stem));
  if (concentration) return concentrationScene(question, stem);
  if (/henry/.test(stem)) return henryScene(question, stem);
  if (/molar mass|molecular mass|van'?t hoff|vant hoff|degree of dissociation|degree of association/.test(stem) && !/density/.test(stem)) {
    return molarMassScene(question, stem);
  }
  if (/osmotic pressure|relative lowering|lowering of vapou?r pressure|boiling point|freezing point/.test(stem) && !/non\s*-?\s*volatile/.test(stem)) {
    return colligativeScene(question, stem);
  }
  if (/non\s*-?\s*volatile/.test(stem)) return nonvolatileScene(question, stem);
  return null;
}
