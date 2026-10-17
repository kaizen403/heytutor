/**
 * Source-grounded chemical thermodynamics figures: system boundaries,
 * the chemistry first law, heat capacity, Hess sums, entropy accounts,
 * and ΔG° = −RT ln K.
 *
 * Reaction profiles, closed Born–Haber cycles, Ellingham diagrams and
 * Maxwell distributions stay in thermoGraphs.ts. A missing number is
 * not replaced with a textbook value.
 */
import { chemistryReferenceConstantValid, chemistryPlanBindingsValid, chemistryQuantityPayloadPresent, findChemistryQuantities, readChemistryQuantity, readChemistryQuantityDeclaration, readChemistryLiteral, CHEMISTRY_SCALAR_PATTERN, chemistryUnitSymbol, chemistryQuantityCuesValid, chemistryQuestionSpan, chemistryCanonicalValuesAgree, chemistryQuantityInventoryOwned, readChemistryUnitLiteral, type ChemistryReading, type ChemistryQuantityDeclaration, type ChemistryDeclarationOccurrence } from "./quantityReader";
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, numberAfter, type ChemPlanQuantity } from "./sceneKit";

const FAMILY = "chem_thermo" as const;
const R_J = 8.314;

function fit(text: string): string {
  return text;
}

function temperatureKelvin(question: string): number | null {
  const r = findChemistryQuantities({ question, dimension: "temperature", targetUnit: "K" });
  return r.ok && r.reading.length > 0 && r.reading.every(read => read.value === r.reading[0]!.value) ? r.reading[0]!.value : null;
}

function veto(stem: string): boolean {
  return /ellingham|maxwell|boltzmann|activation energy|born\s*-?\s*haber|energy profile|reaction coordinate/.test(stem);
}

function hasEnthalpyAndEntropy(stem: string): boolean {
  const enthalpy = /(?:δ|∆|Δ)\s*h\b|enthalpy/.test(stem);
  const entropy = /(?:δ|∆|Δ)\s*s\b|entropy/.test(stem);
  return enthalpy && entropy;
}

function claimsSystems(stem: string): boolean {
  if (/\b(?:open|closed|isolated)\s+system\b/.test(stem)) return true;
  if (/intensive/.test(stem) && /extensive/.test(stem)) return true;
  return /state function/.test(stem) && /path function/.test(stem);
}

function claimsFirstLaw(stem: string): boolean {
  if (hasEnthalpyAndEntropy(stem) && /spontaneous|δg|Δg/.test(stem)) return false;
  const law = /first law|internal energy|(?:δ|∆|Δ)\s*u\b|\bdu\b/.test(stem);
  const pieces = /q\s*=|\bheat\b|\bwork\b|pext|external pressure|isochoric|adiabatic|δ\(pv\)|delta\(pv\)|δ\(pv\)/.test(stem);
  return law && pieces;
}

function claimsHeat(stem: string): boolean {
  return /heat capacity|molar heat capacity|c_?p|c_?v/.test(stem) && !/rate constant|arrhenius/.test(stem);
}

function claimsHess(stem: string): boolean {
  return /hess/.test(stem) || (/step\s*1/.test(stem) && /(?:δ|∆|Δ)\s*h\b/.test(stem) && /revers|multipl/.test(stem));
}

function claimsEntropy(stem: string): boolean {
  if (hasEnthalpyAndEntropy(stem)) return false;
  return /entropy/.test(stem) && /surroundings|universe|q_?rev|reversible|spontaneous|s_?surr|s_?sys/.test(stem);
}

function claimsEquilibrium(stem: string): boolean {
  if (hasEnthalpyAndEntropy(stem)) return false;
  return /equilibrium constant|ln k|standard gibbs|(?:δ|∆|Δ)\s*g\s*(?:°|º)/.test(stem);
}

/** True when this chapter should own the stem, including honest declines. */
export function claimsChemicalThermodynamics(question: string): boolean {
  const stem = chemStem(question);
  if (veto(stem)) return false;
  return claimsSystems(stem) || claimsFirstLaw(stem) || claimsHeat(stem) || claimsHess(stem) || claimsEntropy(stem) || claimsEquilibrium(stem);
}

function box(c: ChemScene, ids: string[]): void {
  ids.push(c.link("bound_t", { x: 0, y: 2 }, { x: 3.2, y: 2 }, "system boundary", false));
  ids.push(c.link("bound_b", { x: 0, y: 0 }, { x: 3.2, y: 0 }, "system boundary", false));
  ids.push(c.link("bound_l", { x: 0, y: 0 }, { x: 0, y: 2 }, "system boundary", false));
  ids.push(c.link("bound_r", { x: 3.2, y: 0 }, { x: 3.2, y: 2 }, "system boundary", false));
}

function buildSystems(question: string, stem: string): SceneDocument | null {
  if (!chemistryQuantityCuesValid(question,[
    {after:/\btemperature\b/,dimensions:["temperature"],owner:"system temperature"},
    {after:/\binternal energy\b/,dimensions:["energy"],owner:"system internal energy"},
    ...(/isothermal|isobaric|adiabatic|isochoric/.test(stem) ? [
      {after:/\bfrom\b/,dimensions:["volume"] as const,owner:"initial process volume"},
      {after:/\bto\b/,dimensions:["volume"] as const,owner:"final process volume"},
    ] : []),
  ])) return null;
  const isolated = /\bisolated\b/.test(stem);
  const closed = /\bclosed\b/.test(stem);
  const open = /\bopen\b/.test(stem);
  const kinds = [isolated, closed, open].filter(Boolean).length;
  const intensive = /intensive/.test(stem);
  const extensive = /extensive/.test(stem);
  const statePath = /state function/.test(stem) && /path function/.test(stem);
  if (kinds > 1) return null;
  const saysMatterCrosses = /matter[^.]{0,40}(?:enter|cross|exchange|flow)|exchanges? matter/.test(stem);
  const saysEnergyCrosses = /energy[^.]{0,40}(?:enter|cross|exchange|flow)|exchanges? energy|heat[^.]{0,24}cross|work[^.]{0,24}cross/.test(stem);
  const deniesMatter = /(?:no|cannot|does not|neither)[^.]{0,24}matter|matter cannot/.test(stem);
  const deniesEnergy = /(?:no|cannot|does not|neither)[^.]{0,24}energy|energy cannot|neither matter nor energy/.test(stem);
  if (isolated && (saysMatterCrosses || saysEnergyCrosses) && !deniesMatter && !deniesEnergy) return null;
  if (closed && saysMatterCrosses && !deniesMatter) return null;
  if ((closed || open) && deniesEnergy) return null;
  if (open && deniesMatter) return null;
  if (/pv curve|p-v|indicator diagram/.test(stem) && !/\d/.test(stem)) return null;

  const c = new ChemScene(question, "system boundary and thermodynamic quantities", FAMILY);
  const ids: string[] = [];
  if (kinds === 1) {
    box(c, ids);
    const matter = open && !deniesMatter;
    const energy = (open || closed) && !deniesEnergy;
    ids.push(c.text("kind_l", { x: 4.4, y: 2 }, isolated ? "isolated" : closed ? "closed" : "open", "system type"));
    ids.push(c.text("matter_l", { x: 4.4, y: 1.1 }, matter ? "matter" : "no matter", "matter crossing"));
    ids.push(c.text("energy_l", { x: 4.4, y: 0.2 }, energy ? "energy" : "no energy", "energy crossing"));
    if (energy) ids.push(c.arrow("energy_a", { x: -1.1, y: 1 }, { x: 0, y: 1 }, "energy crossing"));
    if (matter) ids.push(c.arrow("matter_a", { x: -1.1, y: 0.4 }, { x: 0, y: 0.4 }, "matter crossing"));
  }
  if (intensive && extensive) {
    const temperature = numberAfter(question, /temperature(?:\s+is)?/, "temperature", "K");
    const energy = numberAfter(question, /internal energy(?:\s+is)?/, "energy", "J");
    const doubled = /doubl|twice/.test(stem);
    if (temperature !== null) ids.push(c.text("t_l", { x: 0, y: intensive && kinds === 0 ? 1.6 : -1.2 }, fit(`T=${temperature} K`), "intensive temperature"));
    if (energy !== null) {
      const shown = doubled ? energy * 2 : energy;
      const unit = "J";
      ids.push(c.text("u_l", { x: 0, y: kinds === 0 ? 0.6 : -2.1 }, fit(`U=${shown} ${unit}`), "extensive internal energy"));
    }
    ids.push(c.text("int_l", { x: 3.2, y: kinds === 0 ? 1.6 : -1.2 }, "intensive", "intensive quantity"));
    ids.push(c.text("ext_l", { x: 3.2, y: kinds === 0 ? 0.6 : -2.1 }, "extensive", "extensive quantity"));
  }
  if (statePath) {
    ids.push(c.text("u_state", { x: 0, y: 1.4 }, "U state", "state function"));
    ids.push(c.text("q_path", { x: 0, y: 0.4 }, "q path", "path function"));
    ids.push(c.text("w_path", { x: 0, y: -0.6 }, "w path", "path function"));
  }
  const model = /isothermal/.test(stem) ? "isothermal" : /isobaric/.test(stem) ? "isobaric" : /adiabatic/.test(stem) ? "adiabatic" : /isochoric/.test(stem) ? "isochoric" : null;
  const startVolume = numberAfter(question, /from\s+/, "volume", "L");
  const endVolume = numberAfter(question, /to\s+/, "volume", "L");
  if (model && startVolume !== null && endVolume !== null && startVolume !== endVolume) {
    ids.push(c.text("v1_l", { x: 0, y: -1.4 }, fit(`V=${startVolume} L`), "initial volume"));
    ids.push(c.text("v2_l", { x: 2.4, y: -1.4 }, fit(`V=${endVolume} L`), "final volume"));
    ids.push(c.text("model_l", { x: 4.6, y: -1.4 }, model, "declared process model"));
  }
  if (ids.length === 0) return null;
  c.scene.group("system", ids, "thermodynamic system");
  return c.build({
    caption: "Open systems let matter and energy cross. Closed systems let energy cross and keep matter in. Isolated systems let neither cross. Intensive quantities do not scale with the sample; extensive quantities do. U is a state function. q and w are path functions. No apparatus is drawn beyond the stated boundary.",
  });
}

/** Constant-pressure chemistry work, w = −Pext ΔV. Expansion makes ΔV positive. */
function pressureVolumeWorkJ(stem: string): number | null {
  const compressed = /compress/i.test(stem);
  const expanded = /\bexpan/i.test(stem);
  if (compressed === expanded) return null;
  const litres = numberAfter(stem, /by\s+/, "volume", "L");
  const pressure = numberAfter(stem, /(?:external pressure(?:\s+of)?|pext(?:\s*=)?)/, "pressure", "kPa");
  if (litres === null || pressure === null || !(litres > 0) || !(pressure > 0)) return null;
  const litreWindow = stem.slice(Math.max(0, stem.search(/by\s+/) ), stem.search(/by\s+/) + 24);
  const pressureWindow = stem.slice(stem.search(/external pressure|pext/), stem.search(/external pressure|pext/) + 32);
  if (!litreWindow || !pressureWindow) return null;
  const magnitude = pressure * litres;
  return compressed ? magnitude : -magnitude;
}

/** The solver's complete symbolic identities supply no numeric given. */
function firstLawDeclaration(question: string, after: RegExp, owner: string, reference?: RegExp): ChemistryQuantityDeclaration {
  const matches = [...question.slice(0,chemistryQuestionSpan(question).end).matchAll(new RegExp(after.source,"gi"))];
  const occurrences: ChemistryDeclarationOccurrence[] = [];
  let reading: ChemistryReading | undefined;
  for (const [index,cue] of matches.entries()) {
    const end = matches[index+1]?.index ?? chemistryQuestionSpan(question).end;
    const tail = question.slice(cue.index!+cue[0].length,end);
    const identity = reference?.exec(tail);
    if (identity) {
      const rest = tail.slice(identity[0].length);
      const otherOwner = /\b(?:q|w|du|p_?ext)\b|(?:δ|∆|Δ)\s*(?:u\b|\(pv\))|internal energy|external pressure/i.exec(rest);
      const clause = /[;?!\n]|\.(?=\s|$)/.exec(rest);
      const boundary = Math.min(otherOwner?.index ?? rest.length,clause?.index ?? rest.length);
      // The identity must close before a new, independently checked owner
      // or sentence. "and equals 900 kg" extends this same owner and cannot
      // hide behind a correct identity prefix.
      const bridge = rest.slice(0,boundary);
      const extendsExpression = /[=:+*/^×·−-]/.test(bridge)
        || /^[\s,]*(?:and\s*)?(?:is|was|are|equals|equal\s+to)\b/i.test(bridge);
      if (!extendsExpression && !chemistryQuantityPayloadPresent(bridge)) continue;
    }
    const read = readChemistryQuantityDeclaration({question,after,within:{start:cue.index!,end},dimension:"energy",targetUnit:"J",owner});
    occurrences.push(...read.occurrences);
    if (read.state === "invalid") return {...read,occurrences};
    if (read.state === "valid") {
      if (reading && !chemistryCanonicalValuesAgree(reading.value,read.reading.value)) return {state:"invalid",owner,code:"source_conflict",failure:{ok:false,code:"source_conflict"},occurrences};
      reading = read.reading;
    }
  }
  return reading ? {state:"valid",owner,reading,occurrences} : {state:"absent",owner,occurrences};
}

function buildFirstLaw(question: string, stem: string): SceneDocument | null {
  const deltaURead = firstLawDeclaration(question,/(?:δ|∆|Δ)\s*u\b|\bdu\b|internal energy(?:\s+change)?/,"first-law internal-energy change",
    /^\s*=\s*q\s*\+\s*w\b/i);
  if (deltaURead.state === "invalid") return null;
  const duStated = deltaURead.state === "valid" ? deltaURead.reading.value : null;
  const dpvRead = readChemistryQuantityDeclaration({question,after:/(?:δ|∆|Δ)\s*\(pv\)|delta\(pv\)/,dimension:"energy",targetUnit:"J",owner:"first-law pressure-volume change",allowAgreeingRepeats:true});
  if (dpvRead.state === "invalid" || !chemistryQuantityCuesValid(question,[
    {after:/external pressure|\bp_?ext\b/,dimensions:["pressure"],owner:"external pressure"},
    ...(/\bexpan|compress/.test(stem) ? [
      {after:/\bby\b/,dimensions:["volume"] as const,owner:"process volume change"},
      {after:/\bfrom\b/,dimensions:["volume"] as const,owner:"initial process volume"},
      {after:/\bto\b/,dimensions:["volume"] as const,owner:"final process volume"},
    ] : []),
  ])) return null;
  const heatRead = firstLawDeclaration(question,/\bq\b/,"first-law heat");
  const workRead = firstLawDeclaration(question,/\bw\b/,"first-law work",
    /^\s*=\s*[-−]\s*(?:p_?ext\s*(?:[*×·]\s*)?(?:δ|∆|Δ)\s*v|(?:δ|∆|Δ)\s*v\s*(?:[*×·]\s*)?p_?ext)\b/i);
  if (heatRead.state === "invalid" || workRead.state === "invalid") return null;
  const q = heatRead.state === "valid" ? heatRead.reading.value : null;
  const statedW = workRead.state === "valid" ? workRead.reading.value : null;
  const pv = pressureVolumeWorkJ(question);
  const isochoric = /isochoric|constant volume/.test(stem);
  const adiabatic = /adiabatic/.test(stem);
  if (isochoric && pv !== null) return null;
  if (isochoric && statedW !== null && statedW !== 0) return null;
  if (adiabatic && q !== null && q !== 0) return null;
  if (pv !== null && statedW !== null && !chemistryCanonicalValuesAgree(pv,statedW)) return null;
  const w = isochoric ? 0 : adiabatic && pv === null && statedW !== null ? statedW : pv ?? statedW;
  const heat = adiabatic ? 0 : q;
  const dpv = dpvRead.state === "valid" ? dpvRead.reading.value : null;
  const c = new ChemScene(question, "chemistry first law", FAMILY);
  const ids: string[] = [];
  if (w !== null && heat !== null) {
    const du = heat + w;
    if (duStated !== null && !chemistryCanonicalValuesAgree(duStated,du)) return null;
    ids.push(c.text("q_l", { x: 0, y: 1.6 }, fit(`q=${heat > 0 ? "+" : ""}${heat} J`), "heat"));
    ids.push(c.text("w_l", { x: 0, y: 0.6 }, fit(`w=${w > 0 ? "+" : ""}${w} J`), "work on the system"));
    ids.push(c.text("du_l", { x: 0, y: -0.4 }, fit(`dU=${du > 0 ? "+" : ""}${du} J`), "internal energy change"));
    ids.push(c.text("law_l", { x: 0, y: -1.4 }, "dU=q+w", "first law"));
    if (isochoric) ids.push(c.text("path_l", { x: 3.4, y: 0.6 }, "isochoric", "constant volume"));
    if (adiabatic) ids.push(c.text("path_l", { x: 3.4, y: 0.6 }, "adiabatic", "no heat"));
  } else if (duStated !== null && dpv !== null) {
    const dh = duStated + dpv;
    ids.push(c.text("du_l", { x: 0, y: 1.2 }, fit(`dU=${duStated > 0 ? "+" : ""}${duStated} J`), "internal energy change"));
    ids.push(c.text("dpv_l", { x: 0, y: 0.2 }, fit(`dPV=${dpv > 0 ? "+" : ""}${dpv} J`), "pressure-volume change"));
    ids.push(c.text("dh_l", { x: 0, y: -0.8 }, fit(`dH=${dh > 0 ? "+" : ""}${dh} J`), "enthalpy change"));
    ids.push(c.text("rel_l", { x: 0, y: -1.8 }, "dH=dU+dPV", "enthalpy relation"));
  }
  if (ids.length === 0) return null;
  c.scene.group("first", ids, "first law account");
  return c.build({
    caption: "Chemistry sign convention: ΔU = q + w and w = −Pext ΔV. Expansion makes w negative. Compression makes w positive. Isochoric work is zero. Adiabatic heat is zero. ΔH = ΔU + Δ(PV) only when Δ(PV) is stated. Ideal gas, constant pressure and constant volume are not assumed.",
  });
}

function amountMoles(question: string): number | null {
  const r = findChemistryQuantities({ question, dimension: "amount", targetUnit: "mol" });
  return r.ok && r.reading.length === 1 ? r.reading[0]!.value : null;
}

const HEAT_DELTA_CUE = /(?:δ|∆|Δ)\s*t\s*=|delta t\s*=/i;

/** The delta value and its inventory view cite one complete original literal. */
function heatDeltaInput(question: string): { value: number; literal: ChemistryReading } | null {
  const delta = readChemistryQuantity({ question, after: HEAT_DELTA_CUE, dimension: "temperature_delta", targetUnit: "K" });
  if (!delta.ok) return null;
  const token = new RegExp(`^(${CHEMISTRY_SCALAR_PATTERN})`).exec(question.slice(delta.reading.source.span.start));
  if (!token) return null;
  // Inventory uses the absolute-temperature view; only the independently read
  // delta value above enters heat arithmetic, so Celsius offsets never enter q.
  const literal = readChemistryUnitLiteral({ question, scalarSpan: { start: delta.reading.source.span.start, end: delta.reading.source.span.start + token[0].length } });
  return literal.ok && literal.reading.dimension === "temperature" ? { value: delta.reading.value, literal: literal.reading } : null;
}

/** null means no range; false means a stated range cannot be owned. */
function heatTemperatureRange(question: string): { first: number; second: number } | null | false {
  const body = question.slice(0, chemistryQuestionSpan(question).end);
  const scalar = new RegExp(`^(${CHEMISTRY_SCALAR_PATTERN})`);
  const ranges = [...body.matchAll(/\bfrom\s+([^;\n]*?)\s+to\s+/gid)].filter(range => {
    // Prose transfers do not own temperatures. A numeric non-temperature
    // pair is ignored only after both original unit-inclusive literals verify.
    const part = range.indices?.[1];
    if (!part || range.index === undefined) return true;
    const firstToken = scalar.exec(question.slice(part[0], part[1]));
    const secondStart = range.index + range[0].length;
    const secondToken = scalar.exec(question.slice(secondStart));
    if (!firstToken && !secondToken) return false;
    if (!firstToken || !secondToken) return true;
    const first = readChemistryUnitLiteral({ question, scalarSpan: { start: part[0], end: part[0] + firstToken[0].length } });
    const second = readChemistryUnitLiteral({ question, scalarSpan: { start: secondStart, end: secondStart + secondToken[0].length } });
    const heatOperands = ["temperature", "temperature_delta", "heat_capacity", "molar_heat_capacity", "amount", "energy"] as const;
    return !(first.ok && second.ok && first.reading.dimension !== "temperature"
      && first.reading.dimension === second.reading.dimension
      && [first.reading, second.reading].every(reading => !!reading.rawUnit
        && !heatOperands.some(dimension => chemistryUnitSymbol(reading.rawUnit!, dimension)))
      && !question.slice(first.reading.source.span.end, part[1]).trim());
  });
  if (ranges.length === 0) return null;
  if (ranges.length !== 1) return false;
  const range = ranges[0]!;
  const firstPart = range.indices?.[1];
  if (!firstPart || range.index === undefined) return false;
  const secondStart = range.index + range[0].length;
  const firstToken = scalar.exec(question.slice(firstPart[0], firstPart[1]));
  const secondToken = scalar.exec(question.slice(secondStart));
  if (!firstToken || !secondToken) return false;
  const firstSpan = { start: firstPart[0], end: firstPart[0] + firstToken[0].length };
  const secondSpan = { start: secondStart, end: secondStart + secondToken[0].length };
  const second = readChemistryLiteral({ question, scalarSpan: secondSpan, dimension: "temperature", targetUnit: "K" });
  if (!second.ok) return false;
  let first = readChemistryLiteral({ question, scalarSpan: firstSpan, dimension: "temperature", targetUnit: "K" });
  // Only a bare first endpoint can borrow the complete original trailing
  // unit. The shared reader still rejects explicit wrong or damaged units.
  if (!first.ok && second.reading.rawUnit) {
    const unit = chemistryUnitSymbol(second.reading.rawUnit, "temperature");
    if (!unit) return false;
    const sourceSpan = { start: second.reading.source.span.end - second.reading.rawUnit.length, end: second.reading.source.span.end };
    first = readChemistryLiteral({ question, scalarSpan: firstSpan, dimension: "temperature", targetUnit: "K", unitConvention: { unit, sourceSpan } });
  }
  if (!first.ok || question.slice(first.reading.source.span.end, firstPart[1]).trim()) return false;
  const consumed = [
    ...(first.reading.rawUnit ? [{ reading: first.reading, owner: "heat_temperature_1" }] : []),
    { reading: second.reading, owner: "heat_temperature_2" },
  ];
  if (HEAT_DELTA_CUE.test(body)) {
    const delta = heatDeltaInput(question);
    if (!delta || !chemistryCanonicalValuesAgree(delta.value, second.reading.value - first.reading.value)) return false;
    consumed.push({ reading: delta.literal, owner: "heat_delta_T" });
  }
  // Every original temperature literal must have one owner before deriving ΔT.
  // A bare endpoint with a shared unit is not an inventory literal.
  if (!chemistryQuantityInventoryOwned(question, "temperature", consumed)) return false;
  return { first: first.reading.value, second: second.reading.value };
}

function buildHeat(question: string, stem: string): SceneDocument | null {
  if (/melt|boiling|boils|vapor|vapour|latent heat|fusion/.test(stem)) return null;
  if (/phase change/.test(stem) && !/no phase change/.test(stem)) return null;
  const moles = amountMoles(question);
  if (moles !== null && !(moles > 0)) return null;
  const ideal = /ideal gas/.test(stem);
  const asksR = /c_?p[^.]{0,40}c_?v|c_?v[^.]{0,24}=\s*r|difference[^.]{0,20}r\b/.test(stem);
  if (asksR && !ideal) return null;
  if (asksR && /liquid|solid|water/.test(stem)) return null;
  const c = new ChemScene(question, "heat capacity", FAMILY);
  const ids: string[] = [];
  if (ideal && asksR) {
    const cp = numberAfter(question, /c_?p(?:,m)?(?:\s*(?:=|is))?/, "molar_heat_capacity", "J/(mol K)");
    if (cp === null) return null;
    const cv = cp - R_J;
    ids.push(c.text("cp_l", { x: 0, y: 1.2 }, fit(`Cp=${cp}`), "molar heat capacity at constant pressure"));
    ids.push(c.text("cv_l", { x: 0, y: 0.2 }, fit(`Cv=${cv.toFixed(2)}`), "molar heat capacity at constant volume"));
    ids.push(c.text("r_l", { x: 0, y: -0.8 }, "ideal gas R", "ideal-gas molar relation"));
  } else {
    const molar = /molar heat capacity|j\/\(mol/.test(stem);
    const capacityDimension = molar ? "molar_heat_capacity" : "heat_capacity";
    const capacityRead = readChemistryQuantity({ question, after: /(?:molar )?heat capacity(?:\s+of a sample)?(?:\s+is)?|c\s*=/i, dimension: capacityDimension, targetUnit: molar ? "J/(mol K)" : "J/K" });
    if (!capacityRead.ok || !chemistryQuantityInventoryOwned(question, capacityDimension, [{ reading: capacityRead.reading, owner: "heat_capacity" }])) return null;
    const capacity = capacityRead.reading.value;
    const temperatures = heatTemperatureRange(question);
    if (temperatures === false) return null;
    let delta: number;
    if (temperatures) delta = temperatures.second - temperatures.first;
    else {
      const statedDelta = heatDeltaInput(question);
      if (!statedDelta || !chemistryQuantityInventoryOwned(question, "temperature", [{ reading: statedDelta.literal, owner: "heat_delta_T" }])) return null;
      delta = statedDelta.value;
    }
    if (!(capacity >= 0) || !(delta !== 0)) return null;
    const sampleC = molar ? (moles === null ? null : capacity * moles) : capacity;
    if (sampleC === null) return null;
    const q = sampleC * delta;
    c.scene.quantity("heat_capacity", molar ? "C_m" : "C", capacity, molar ? "J/(mol K)" : "J/K");
    if (temperatures) {
      c.scene.quantity("heat_temperature_1", "T_1", temperatures.first, "K");
      c.scene.quantity("heat_temperature_2", "T_2", temperatures.second, "K");
    }
    c.scene.quantity("heat_delta_T", "ΔT", delta, "K");
    c.scene.quantity("heat_q", "q", q, "J");
    ids.push(c.text("q_l", { x: 0, y: 1.2 }, fit(`q=${q} J`), "heat"));
    ids.push(c.text("kind_l", { x: 0, y: 0.2 }, molar ? "C molar" : "C sample", "heat capacity kind"));
    ids.push(c.text("law_l", { x: 0, y: -0.8 }, "q=C*dT", "constant heat capacity"));
    if (moles !== null) ids.push(c.text("n_l", { x: 0, y: -1.8 }, fit(`n=${moles} mol`), "amount"));
  }
  c.scene.group("heat", ids, "heat capacity");
  return c.build({
    caption: "q = C ΔT when C is constant and no phase change is stated. Sample heat capacity and molar heat capacity are different. Cp,m − Cv,m = R is only for an ideal gas, with R = 8.314 J/(mol K).",
  });
}

interface HessStep {
  value: number;
  reversed: boolean;
  factor: number;
}

function hessSteps(question: string): HessStep[] | null {
  const parts = [...question.matchAll(/\bstep\s*\d+\b/gi)];
  const steps: HessStep[] = [];
  for (let i = 0; i < parts.length; i++) {
    const start = parts[i]!.index! + parts[i]![0].length;
    const end = parts[i+1]?.index ?? question.length;
    const part = question.slice(start, end);
    const input = { question, within: {start, end}, after: /(?:δ|∆|Δ)\s*h\s*=/, dimension: "energy" as const, targetUnit: "kJ" as const };
    const energy = readChemistryQuantity(input);
    if (!energy.ok) return null;
    const factorRead = /multipl/i.test(part) ? readChemistryQuantity({question, within:{start,end},after:/multipl\w*\s+by/,dimension:"dimensionless"}) : null;
    if (factorRead && !factorRead.ok) return null;
    steps.push({value:energy.reading.value,reversed:/revers/i.test(part),factor:factorRead?.ok ? factorRead.reading.value : 1});
  }
  return steps;
}

function buildHess(question: string, _stem: string): SceneDocument | null {
  const steps = hessSteps(question);
  if (!steps || steps.length < 2 || steps.some((step) => !(step.factor > 0))) return null;
  const signed = steps.map((step) => step.value * step.factor * (step.reversed ? -1 : 1));
  const net = signed.reduce((sum, value) => sum + value, 0);
  const c = new ChemScene(question, "Hess sum of stated enthalpy steps", FAMILY);
  const ids: string[] = [];
  signed.forEach((value, index) => {
    const prefix = steps[index]!.reversed ? "rev " : steps[index]!.factor !== 1 ? `x${steps[index]!.factor} ` : "";
    const text = fit(`${prefix}${value > 0 ? "+" : ""}${value} kJ`);
    ids.push(c.text(`step_${index}`, { x: 0, y: 1.6 - index * 1.1 }, text, "Hess step"));
  });
  ids.push(c.text("net_l", { x: 3.6, y: 0.4 }, fit(`net=${net > 0 ? "+" : ""}${net} kJ`), "net enthalpy"));
  c.scene.group("hess", ids, "Hess enthalpy sum");
  return c.build({
    caption: "Each stated step is reversed by changing the sign of ΔH and scaled by multiplying both the step and ΔH. The net is the sum. No enthalpy is invented for a missing step.",
  });
}

function entropyValue(stem: string, which: "sys" | "surr"): number | null {
  const phrase = which === "sys"
    ? /(?:δ|∆|Δ)?\s*d?s_?sys\s*=|entropy of the system\s*(?:=|is)/
    : /(?:δ|∆|Δ)?\s*d?s_?surr\s*=|entropy of the surroundings\s*(?:=|is)/;
  return numberAfter(stem, phrase, "entropy", "J/K");
}

function buildEntropy(question: string, stem: string): SceneDocument | null {
  const sys = entropyValue(question, "sys");
  const surr = entropyValue(question, "surr");
  const reversible = /\breversible\b/.test(stem);
  const irreversible = /\birreversible\b/.test(stem);
  const qrev = numberAfter(question, /q_?rev\s*=/, "energy", "J");
  const temperature = temperatureKelvin(question);
  const c = new ChemScene(question, "entropy of system, surroundings and universe", FAMILY);
  const ids: string[] = [];
  if (qrev !== null) {
    if (!reversible || !/isothermal/.test(stem) || temperature === null || !(temperature > 0)) return null;
    const delta = qrev / temperature;
    ids.push(c.text("ds_l", { x: 0, y: 0.8 }, fit(`dS=${delta.toFixed(2)} J/K`), "system entropy from reversible heat"));
    ids.push(c.text("law_l", { x: 0, y: -0.4 }, "qrev/T", "reversible isothermal relation"));
  } else if (sys !== null && surr !== null) {
    const total = sys + surr;
    if (total === 0 && irreversible) return null;
    if (total !== 0 && reversible) return null;
    ids.push(c.text("sys_l", { x: 0, y: 1.6 }, fit(`dSsys=${sys > 0 ? "+" : ""}${sys}`), "system entropy"));
    ids.push(c.text("surr_l", { x: 0, y: 0.6 }, fit(`dSsurr=${surr > 0 ? "+" : ""}${surr}`), "surroundings entropy"));
    ids.push(c.text("univ_l", { x: 0, y: -0.4 }, fit(`dSuniv=${total > 0 ? "+" : ""}${total}`), "universe entropy"));
    ids.push(c.text("verdict_l", { x: 0, y: -1.5 }, total > 0 ? "spontaneous" : total < 0 ? "not spontaneous" : reversible ? "reversible" : "zero total", "spontaneity from the universe"));
  } else if (sys !== null) {
    ids.push(c.text("sys_l", { x: 0, y: 0.6 }, fit(`dSsys=${sys > 0 ? "+" : ""}${sys}`), "system entropy"));
    ids.push(c.text("only_l", { x: 0, y: -0.5 }, "sys only", "surroundings not stated"));
  }
  if (ids.length === 0) return null;
  c.scene.group("entropy", ids, "entropy account");
  return c.build({
    caption: "ΔS_univ = ΔS_sys + ΔS_surr. A positive system entropy does not by itself make the process spontaneous. q_rev/T is used only for a stated reversible isothermal change. A negative universe entropy is not labelled spontaneous.",
  });
}

// The owner may include a temperature; stop only at its original assignment.
// A qualitative less/greater-than clause is not a supplied thermodynamic K.
// A bare request predicate is prose; numeric or damaged continuations remain owners.
const EQUILIBRIUM_CONSTANT_CUE = /(?:equilibrium constant(?:\s+(?:of|for)\b(?:[^=,;.\n]|\.(?=\d)){0,85}?)?|\bk\b)\s*(?:\bis\b(?!\s*(?:required|needed|requested)\s*(?:[.!?](?=\s|$)|$))|=|:)(?!\s*(?:less|greater|more)\s+than\b)/i;

// A recognized assignment must still belong to K, not another predicate/quantity.
const EQUILIBRIUM_CONSTANT_OWNER = /^(?:equilibrium constant(?:\s+(?:of|for)\s+(?:(?:a|an|the|this)\s+)?reaction(?:\s+at\b(?:(?!\b(?:and|but|whose|which|where|quotient|pressure|volume)\b)[^=,;.\n]|\.(?=\d)){0,50})?)?|\bk\b)\s*(?:\bis\b|=|:)$/i;

const STANDARD_GIBBS_ENERGY_CUE = /(?:δ|∆|Δ)\s*g\s*(?:°|º)\s*=|standard gibbs[^.]{0,40}?=/i;

function buildEquilibrium(question: string, _stem: string): SceneDocument | null {
  const temperature = temperatureKelvin(question);
  if (temperature === null || !(temperature > 0)) return null;
  const source = question.slice(0, chemistryQuestionSpan(question).end);
  const kOwners = [...source.matchAll(new RegExp(EQUILIBRIUM_CONSTANT_CUE.source, "gi"))];
  // Missing-valued owners must not disappear behind a later valid literal.
  if (kOwners.length > 1 || kOwners.some(owner => !EQUILIBRIUM_CONSTANT_OWNER.test(owner[0]))) return null;
  if (!chemistryQuantityCuesValid(question, [{ after: EQUILIBRIUM_CONSTANT_CUE, dimensions: ["dimensionless"] }])) return null;
  const kRead = readChemistryQuantity({ question, after: EQUILIBRIUM_CONSTANT_CUE, dimension: "dimensionless" });
  const hasStatedK = kOwners.length > 0;
  if (!kRead.ok && (kRead.code !== "missing" || hasStatedK)) return null;
  const kGiven = kRead.ok ? kRead.reading.value : null;
  const gOwners = [...source.matchAll(new RegExp(STANDARD_GIBBS_ENERGY_CUE.source, "gi"))];
  if (gOwners.length > 1 || !chemistryQuantityCuesValid(question, [{ after: STANDARD_GIBBS_ENERGY_CUE, dimensions: ["molar_energy"] }])) return null;
  const gRead = readChemistryQuantity({ question, after: STANDARD_GIBBS_ENERGY_CUE, dimension: "molar_energy", targetUnit: "J/mol" });
  if (!gRead.ok && (gRead.code !== "missing" || gOwners.length > 0)) return null;
  const gJ = gRead.ok ? gRead.reading.value : null;
  const gGiven = gJ === null ? null : gJ / 1000;
  if (kGiven !== null && !(kGiven > 0)) return null;
  if (kGiven === null && gGiven === null) return null;
  // Both source-given operands must agree in the same canonical molar-energy unit.
  if (kGiven !== null && gJ !== null && !chemistryCanonicalValuesAgree(gJ, -R_J * temperature * Math.log(kGiven))) return null;
  const k = kGiven ?? (gJ === null ? null : Math.exp(-gJ / (R_J * temperature)));
  const gKj = gGiven ?? (k === null ? null : (-R_J * temperature * Math.log(k)) / 1000);
  if (k === null || gKj === null || !Number.isFinite(k) || !Number.isFinite(gKj) || !(k > 0)) return null;
  const c = new ChemScene(question, "standard Gibbs energy and the equilibrium constant", FAMILY);
  const ids = [
    c.text("g_l", { x: 0, y: 1.2 }, fit(`dGo=${gKj.toFixed(3)}`), "standard Gibbs energy", {preserveText:true}),
    c.text("g_unit", { x: 1.7, y: 1.2 }, "kJ/mol", "Gibbs energy unit"),
    c.text("k_l", { x: 0, y: 0.2 }, fit(`K=${Math.abs(k) < .01 || Math.abs(k) >= 1e6 ? k.toExponential(3).replace(/0+e/, "e").replace(/\.e/, "e") : k.toFixed(2)}`), "thermodynamic equilibrium constant", {preserveText:true}),
    c.text("law_l", { x: 0, y: -0.8 }, "dGo=-RT lnK", "standard relation"),
    c.text("t_l", { x: 0, y: -1.8 }, fit(`T=${temperature} K`), "absolute temperature"),
  ];
  c.scene.group("equilibrium", ids, "Gibbs energy and equilibrium constant");
  return c.build({
    caption: "ΔG° = −RT ln K with R = 8.314 J/(mol K), T in kelvin, and K the dimensionless thermodynamic equilibrium constant. This is not a rate and not an activation barrier. ΔG and ΔG° are not the same quantity.",
  });
}

/** The figure, or null when the stem is claimed but not grounded. */
export function buildChemicalThermodynamicsScene(
  question: string,
  quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  const stem = chemStem(question);
  if (!chemistryPlanBindingsValid(question, quantities)) return null;
  if (!chemistryReferenceConstantValid(question, /\bR\s*=/, "gas_constant", "J/(mol K)", R_J)) return null;
  if (claimsSystems(stem)) return buildSystems(question, stem);
  if (claimsFirstLaw(stem)) return buildFirstLaw(question, stem);
  if (claimsHeat(stem)) return buildHeat(question, stem);
  if (claimsHess(stem)) return buildHess(question, stem);
  if (claimsEntropy(stem)) return buildEntropy(question, stem);
  if (claimsEquilibrium(stem)) return buildEquilibrium(question, stem);
  return null;
}
