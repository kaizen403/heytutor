/** A bounded source program: formula-unit mass -> moles -> solution concentration.
 * No solvent volume, mixtures, hydration assumption, or supplied answer is inferred. */
import { equivalentRoundedMeasuredQuantity } from "../contracts/contractsV3";
import { parseFormula } from "./formula";
import { ChemScene, type ChemPlanQuantity } from "./sceneKit";
import { CHEMISTRY_SCALAR_PATTERN, readChemistryLiteral, convertChemistryValue, chemistryUnitSymbol, chemistryCanonicalValuesAgree, chemistryPlanBindingsValid, type ChemistryDimension, type ChemistryUnit, type ChemistryReading } from "./quantityReader";
import { parseMathExpression } from "../math/expression";
import type { ProblemIR, ExpressionNodeIR } from "../ir/problemIR";

export interface MassMolaritySource {
  question: string;
  formula: string;
  speciesSpan: { start: number; end: number };
  mass: ChemistryReading;
  volume: ChemistryReading;
  molarMass: number;
  moles: number;
  concentration: number;
}
const scalar = CHEMISTRY_SCALAR_PATTERN;
// Closed measurement clauses bind the numerator's species and the denominator's
// solution role. Full-source consumption keeps additional masses/qualifiers out.
const request = String.raw`(?:find|calculate|determine)\s+(?:the|its)\s+molarity`;
const material = String.raw`(?<mass>${scalar})\s*(?:kg|g)\s+of\s+(?<species>[A-Z][A-Za-z0-9_{}()₀-₉]*)\s+in\s+(?<volume>${scalar})\s*(?:mL|L|dm\^?3|cm\^?3)\s+of\s+(?:the\s+)?solution`;
const patterns = [
  new RegExp(String.raw`^\s*${request}\s+of\s+a\s+solution\s+containing\s+${material}\s*[.!?]?\s*$`, "di"),
  new RegExp(String.raw`^\s*(?:a\s+solution\s+contains\s+)?${material}\s*[.;]\s*${request}\s*[.!?]?\s*$`, "di"),
];

export function readMassMolaritySource(question: string): MassMolaritySource | null {
  const match = patterns.map(pattern => pattern.exec(question)).find(Boolean);
  if (!match?.indices?.groups || !match.groups) return null;
  const span = (name: string) => { const pair = match.indices!.groups![name]!; return { start: pair[0], end: pair[1] }; };
  const formula = match.groups.species!;
  // parseFormula preserves symbol case; case-insensitive prose cannot turn nacl into NaCl.
  const parsed = parseFormula(formula);
  if (!parsed || parsed.charge !== 0 || parsed.totalAtoms > 1000 || parsed.atoms.some(atom => !Number.isInteger(atom.count) || atom.count <= 0)) return null;
  const mass = readChemistryLiteral({ question, scalarSpan: span("mass"), dimension: "mass", targetUnit: "g" });
  const volume = readChemistryLiteral({ question, scalarSpan: span("volume"), dimension: "volume", targetUnit: "L" });
  if (!mass.ok || !volume.ok || !(mass.reading.value > 0 && volume.reading.value > 0)) return null;
  const molarMass = parsed.atoms.reduce((sum, atom) => sum + atom.count * atom.element.mass, 0);
  const moles = mass.reading.value / molarMass;
  const concentration = moles / volume.reading.value;
  if (![molarMass,moles,concentration].every(value => Number.isFinite(value) && value > 0)) return null;
  // Independently evaluate the composed relation and both inverse equalities.
  const evaluated = parseMathExpression(`${mass.reading.value}/(${molarMass}*${volume.reading.value})`).evaluate(0);
  if (!chemistryCanonicalValuesAgree(evaluated, concentration)
    || !chemistryCanonicalValuesAgree(moles * molarMass, mass.reading.value)
    || !chemistryCanonicalValuesAgree(concentration * volume.reading.value, moles)) return null;
  return { question, formula, speciesSpan: span("species"), mass: mass.reading, volume: volume.reading, molarMass, moles, concentration };
}

/** All recognized numerical plan roles must agree, after exact unit conversion.
 * Unknown physical roles fail closed; neither a correct answer nor another same-unit
 * input can vouch for a swapped role. */
export function chemistryCompositionPlanAgrees(question: string, quantities: readonly ChemPlanQuantity[], roles: readonly { aliases: readonly string[]; value: number; unit: ChemistryUnit; dimension: ChemistryDimension; allowDerivedRounding?: boolean }[]): boolean {
  if (!chemistryPlanBindingsValid(question, quantities)) return false;
  const key = (text: string) => text.replace(/[{}\s_]/g, "");
  return quantities.every(quantity => {
    const symbolic = roles.filter(role => role.aliases.some(alias => key(alias) === key(quantity.symbol)));
    if (quantity.symbol.trim() && symbolic.length !== 1) return false;
    const identified = roles.filter(role => role.aliases.some(alias => key(alias) === key(quantity.id)));
    if (symbolic.length && identified.length && symbolic[0] !== identified[0]) return false;
    const found = symbolic.length ? symbolic : identified;
    if (found.length !== 1 || !quantity.unit) return false;
    const role = found[0]!;
    const inputUnit = chemistryUnitSymbol(quantity.unit, role.dimension);
    if (!inputUnit) return false;
    const converted = convertChemistryValue(quantity.value, inputUnit, role.unit, role.dimension);
    return converted.ok && (chemistryCanonicalValuesAgree(converted.reading, role.value)
      // Only source-recomputed outputs use the existing plan rounding contract.
      // Measurements and reference inputs never acquire rounded given authority.
      || quantity.origin === "derived" && role.allowDerivedRounding === true
        && Math.abs(converted.reading - role.value) <= 0.01 * Math.abs(role.value)
        && equivalentRoundedMeasuredQuantity(role.value, role.unit, quantity.value, inputUnit));
  });
}

/** Existing IR/evaluate solver contract, with original-source facts and explicit
 * versioned table provenance. Callers must regenerate this from the question. */
export function massMolarityProblem(question: string): ProblemIR | null {
  const source = readMassMolaritySource(question);
  if (!source) return null;
  const fact = (id: string, start: number, end: number) => ({ id, kind: "given" as const, statement: question.slice(start,end), evidence: { source: "question" as const, start, end, quote: question.slice(start,end) } });
  const n = (value: number): ExpressionNodeIR => ({kind:"number",value});
  const div = (left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({kind:"binary",operator:"/",left,right});
  const root = div(div(n(source.mass.value),n(source.molarMass)),n(source.volume.value));
  return { schemaVersion: "problem-ir/v1", id: "mass_molarity", question,
    facts: [fact("solute_mass",source.mass.source.span.start,source.mass.source.span.end),fact("species",source.speciesSpan.start,source.speciesSpan.end),fact("solution_volume",source.volume.source.span.start,source.volume.source.span.end)],
    entities: [], constraints: [], representationIntents: [],
    expressions: [{id:"concentration",valueType:"scalar",root,evidenceFactIds:["solute_mass","species","solution_volume"]}],
    solveRequests: [{id:"molarity",kind:"evaluate",expressionId:"concentration"}] };
}

export function buildMassMolarityScene(question: string, quantities: readonly ChemPlanQuantity[]) {
  const source = readMassMolaritySource(question);
  if (!source || !chemistryCompositionPlanAgrees(question, quantities, [
    {aliases:["mass","m","solute_mass"],value:source.mass.value,unit:"g",dimension:"mass"},
    {aliases:["V","volume","solution_volume"],value:source.volume.value,unit:"L",dimension:"volume"},
    {aliases:["M_s","molar_mass"],value:source.molarMass,unit:"g/mol",dimension:"molar_mass"},
    {aliases:["n","moles","solute_amount"],value:source.moles,unit:"mol",dimension:"amount",allowDerivedRounding:true},
    {aliases:["M","c","molarity","concentration"],value:source.concentration,unit:"mol/L",dimension:"concentration",allowDerivedRounding:true},
  ])) return null;
  const c = new ChemScene(question,"source-bound formula mass, amount and solution concentration","chem_solutions");
  const show = (value: number) => String(Number(value.toPrecision(6)));
  const formula = source.formula.replace(/_?[0-9]+/g, digits => `_${digits.replace("_","")}`);
  const rows = [
    ["solute", formula, `${show(source.mass.value)} g`],
    ["formula mass", `${show(source.molarMass)} g/mol`, "element table"],
    ["solute amount", `${show(source.moles)} mol`, "n = mass / M_s"],
    ["solution volume", `${show(source.volume.value)} L`, "whole solution"],
    ["molarity", `${show(source.concentration)} mol/L`, "c = n / V"],
  ];
  rows.forEach((texts,i) => texts.forEach((text,j) => c.text(`row_${i}_${j}`,{x:j*3.5,y:4-i*1.4},text,texts[0],{preserveText:true})));
  const document = c.build({caption:"Formula-unit molar mass uses the existing NCERT / IUPAC 2021 element table. The volume belongs to the whole solution. This is a nonmetric calculation diagram."});
  const values = [
    {id:"solute_mass",symbol:"mass",value:source.mass.value,unit:"g"},
    {id:"molar_mass",symbol:"M_s",value:source.molarMass,unit:"g/mol"},
    {id:"solute_amount",symbol:"n",value:source.moles,unit:"mol"},
    {id:"solution_volume",symbol:"V",value:source.volume.value,unit:"L"},
    {id:"molarity",symbol:"c",value:source.concentration,unit:"mol/L"},
  ];
  document.quantities = values;
  document.source.slotSources = Object.fromEntries(values.map(q=>[q.id,"stem"]));
  document.source.answerQuantityIds = ["molarity"];
  document.source.defaultAnswerQuantityIds = ["molarity"];
  document.source.answerQuantityValues = Object.fromEntries(values.map(q=>[q.id,q.value]));
  document.source.answerLabelEntityIds = ["row_4_1"];
  document.source.answerLabelAnnotationIds = [];
  document.source.sourceModel = "formula_mass_molarity/v1";
  return document;
}
