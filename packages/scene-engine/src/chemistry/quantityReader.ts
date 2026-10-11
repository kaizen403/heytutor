/** SI conversions: NIST SP 330 §4 (https://www.nist.gov/pml/special-publication-330/sp-330-section-4).
 * Chemistry-only physical givens. Original JS spans and unit case are authority. */
import type { ChemPlanQuantity } from "./sceneKit";
import { parseFormula } from "./formula";

export interface ChemistrySpan { start: number; end: number }
export type ChemistryDimension = "dimensionless" | "time" | "temperature" | "temperature_delta"
  | "length" | "volume" | "mass" | "amount" | "molar_mass" | "density"
  | "concentration" | "normality" | "molality" | "pressure" | "energy" | "molar_energy"
  | "entropy" | "molar_entropy" | "heat_capacity" | "molar_heat_capacity"
  | "frequency" | "speed" | "momentum" | "action" | "energy_length" | "potential" | "current" | "charge"
  | "faraday_constant" | "avogadro_constant" | "gas_constant"
  | "rate_constant_first" | "rate_constant_zero" | "rate_constant_second"
  | "colligative_constant" | "concentration_pressure";
export type ChemistryUnit = "1" | "%" | "s" | "min" | "h" | "days" | "yr"
  | "K" | "°C" | "m" | "cm" | "nm" | "pm" | "Å" | "L" | "mL"
  | "kg" | "g" | "mol" | "g/mol" | "kg/mol" | "g/cm^3" | "kg/m^3"
  | "mol/L" | "eq/L" | "mol/kg" | "Pa" | "kPa" | "bar" | "atm" | "torr"
  | "J" | "kJ" | "cal" | "kcal" | "eV" | "J/mol" | "kJ/mol" | "cal/mol" | "kcal/mol"
  | "J/K" | "kJ/K" | "J/(mol K)" | "kJ/(mol K)" | "Hz" | "m/s" | "kg m/s" | "J s" | "eV s" | "J m" | "eV nm"
  | "V" | "A" | "mA" | "C" | "C/mol" | "mol^-1" | "L atm/(mol K)" | "L bar/(mol K)"
  | "s^-1" | "min^-1" | "h^-1" | "days^-1" | "yr^-1" | "mol/(L s)" | "L/(mol s)"
  | "K kg/mol" | "mol/(L atm)" | "mol/(L bar)";
export type ChemRead<T> = { ok: true; reading: T } | {
  ok: false; code: "missing" | "ambiguous" | "malformed" | "unsupported_unit" | "source_conflict"; span?: ChemistrySpan;
};
export interface ChemistryReading {
  value: number; canonicalUnit: ChemistryUnit; dimension: ChemistryDimension;
  rawValue: number; rawUnit: string | null;
  source: { kind: "stem_given" | "plan_given"; span: ChemistrySpan; text: string; planQuantityId?: string };
}
export interface ChemistryQuantityInput {
  question: string; after: RegExp; within?: ChemistrySpan;
  /** Opt-in semantic symbol case; numeric/unit grammar and ordinary cues are unchanged. */
  cueCaseSensitive?: boolean;
  dimension: ChemistryDimension; targetUnit?: ChemistryUnit;
  unitConvention?: { unit: ChemistryUnit; sourceSpan: ChemistrySpan };
}

const DECIMAL = String.raw`(?:\d+(?:\.\d+|\.(?!\s+[A-Za-z]))?|\.\d+)`;
const EXPONENT = String.raw`(?:[+\-−]?\d{1,4}|\(\s*[+\-−]?\d{1,4}\s*\))`;
const SCALAR = String.raw`[+\-−]?\s*(?:${DECIMAL}\s*/\s*${DECIMAL}(?:st|nd|rd|th)?|(?:${DECIMAL}\s*[x×*]\s*)?10\s*\^\s*${EXPONENT}|${DECIMAL}(?:[eE][+\-−]?\d{1,4})?)`;
/** One whole token plus two empty compatibility captures; all parsing lives here. */
export const CHEMISTRY_NUMBER_PATTERN = `(${SCALAR})()()`;
export const CHEMISTRY_SCALAR_PATTERN = SCALAR;
const SCALAR_FULL = new RegExp(`^(?:${SCALAR})$`);
const SCALAR_PREFIX = new RegExp(`^(?:${SCALAR})`);
const fail = (code: Extract<ChemRead<never>, { ok: false }>["code"], span?: ChemistrySpan): ChemRead<never> => ({ ok: false, code, ...(span ? { span } : {}) });
function validSpan(question: string, span: ChemistrySpan): boolean {
  return Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end <= question.length && span.end > span.start;
}
function continuesScalar(tail: string): boolean {
  return /^[eE\d/^~!"×*]|^\.(?=[.\d])|^[+\-−](?=\s*(?:\d|\.\d))|^\s*[x×*]\s*10|^\s*10\s*[°~!^"0-9]/.test(tail);
}
/** Match against the original question, never a caller's truncated substring. */
function completeScalarSpan(question: string, span: ChemistrySpan): boolean {
  const raw = question.slice(span.start, span.end);
  const start = span.start + raw.length - raw.trimStart().length;
  const end = span.end - (raw.length - raw.trimEnd().length);
  if (end > chemistryQuestionSpan(question).end || /[A-Za-z0-9_.]/.test(question[start - 1] ?? "")
    || /[+\-−]\s*$|[/^×*]\s*\(?\s*$/.test(question.slice(0, start))) return false;
  for (const match of question.matchAll(new RegExp(SCALAR, "g"))) {
    const tokenStart = match.index! + match[0].length - match[0].trimStart().length;
    const tokenEnd = match.index! + match[0].trimEnd().length;
    if (tokenEnd <= start) continue;
    return tokenStart === start && tokenEnd === end && !continuesScalar(question.slice(end));
  }
  return false;
}
export function parseChemistryScalar(question: string, span: ChemistrySpan): ChemRead<number> {
  if (!validSpan(question, span) || !completeScalarSpan(question, span)) return fail("malformed", span);
  return scalarValue(question, span);
}
/** Value grammar shared by literals and independently closed expressions. */
function scalarValue(question: string, span: ChemistrySpan): ChemRead<number> {
  const token = question.slice(span.start, span.end).trim().replace(/−/g, "-");
  if (!SCALAR_FULL.test(token)) return fail("malformed", span);
  const clean = token.replace(/\s/g, "");
  let value: number; let nonzero: boolean;
  const fraction = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\/((?:\d+(?:\.\d*)?|\.\d+))(?:st|nd|rd|th)?$/.exec(clean);
  const power = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)|[+-])?[x×*]?10\^\(?([+-]?\d+)\)?$/.exec(clean);
  if (fraction) {
    if (Number(fraction[2]) === 0) return fail("malformed", span);
    value = Number(fraction[1]) / Number(fraction[2]); nonzero = Number(fraction[1]) !== 0;
  } else if (power) {
    const mantissa = power[1] === undefined ? (clean.startsWith("-") ? -1 : 1) : power[1] === "-" ? -1 : power[1] === "+" ? 1 : Number(power[1]);
    value = mantissa * 10 ** Number(power[2]); nonzero = mantissa !== 0;
  } else { value = Number(clean); nonzero = /[1-9]/.test(clean.split(/[eE]/)[0]!); }
  return Number.isFinite(value) && !(nonzero && value === 0) ? { ok: true, reading: value } : fail("malformed", span);
}

export interface ChemistryArrheniusEquation {
  natural: boolean;
  coefficient: { value: number; span: ChemistrySpan; text: string };
  source: { span: ChemistrySpan; text: string };
}
/** A coefficient is authority only inside a complete original Arrhenius
 * expression, never through a relaxed standalone scalar boundary. */
export function readChemistryArrheniusEquation(question: string): ChemRead<ChemistryArrheniusEquation> {
  const end = chemistryQuestionSpan(question).end;
  const patterns = [
    { pattern: new RegExp(String.raw`\b(ln|log)\s*k\s*=\s*(${SCALAR})\s*[-−]\s*(${SCALAR})\s*(?:K\s*)?/\s*T\b`, "gd"), group: 3 },
    { pattern: new RegExp(String.raw`\be\s*\^?\s*\(\s*[-−]\s*(${SCALAR})\s*(?:K\s*)?/\s*T\s*\)`, "gd"), group: 1 },
    { pattern: new RegExp(String.raw`\be\s*\^?\s*[-−]\s*(${SCALAR})\s*(?:K\s*)?/\s*T\b`, "gd"), group: 1 },
  ];
  const readings: ChemistryArrheniusEquation[] = [];
  for (const {pattern, group} of patterns) for (const match of question.slice(0, end).matchAll(pattern)) {
    const start = match.index!; const stop = start + match[0].length;
    if (/(?:\p{L}|\p{N}|\p{M}|_)$/u.test(question.slice(0,start)) || /(?:\p{Sm}|[/^*·∙·-])\s*$/u.test(question.slice(0,start))
      || /^(?:\p{L}|\p{N}|\p{M}|[_⁺⁻])/u.test(question.slice(stop))
      || /^(?:\p{Sm}|[/^*·∙·-])|^\.(?=\p{L}|\p{N}|\p{M}|[_.])/u.test(question.slice(stop).trimStart())) return fail("malformed", {start,end:stop});
    if (group === 3) {
      const intercept = match.indices![2]!;
      if (!scalarValue(question,{start:intercept[0],end:intercept[1]}).ok) return fail("malformed",{start:intercept[0],end:intercept[1]});
    }
    const pair = match.indices![group]!; const span = {start:pair[0],end:pair[1]};
    const value = scalarValue(question,span);
    if (!value.ok || !(value.reading > 0)) return fail("malformed",span);
    readings.push({natural:match[1] !== "log",coefficient:{value:value.reading,span,text:question.slice(span.start,span.end)},source:{span:{start,end:stop},text:match[0]}});
  }
  if (readings.length !== 1) return fail(readings.length ? "ambiguous" : /\b(?:ln|log)\s*k\s*=|\be\s*\^?\s*\(?\s*[-−]/.test(question.slice(0,end)) ? "malformed" : "missing");
  return {ok:true,reading:readings[0]!};
}

interface UnitDefinition { unit: ChemistryUnit; dimensions: readonly ChemistryDimension[]; factor: number; pattern: RegExp; offset?: number }
const units: UnitDefinition[] = [];
function unit(unit: ChemistryUnit, dimensions: ChemistryDimension | readonly ChemistryDimension[], factor: number, pattern: string, offset?: number): void {
  units.push({ unit, dimensions: typeof dimensions === "string" ? [dimensions] : dimensions, factor, pattern: new RegExp(`^(?:${pattern})(?![A-Za-z0-9])`), offset });
}
const perMol = String.raw`(?:/\s*mol|mol\s*\^?\s*\(?[-−]1\)?)`;
const thermalMol = String.raw`(?:/\s*\(\s*mol\s*K\s*\)|/\s*mol\s*/?\s*K|/\s*K\s*/\s*mol|mol\s*\^?\(?[-−]1\)?\s*K\s*\^?\(?[-−]1\)?|K\s*\^?\(?[-−]1\)?\s*mol\s*\^?\(?[-−]1\)?|/\s*K\s*mol)`;
for (const [symbol, factor] of [["kJ", 1000], ["J", 1], ["kcal", 4184], ["cal", 4.184]] as const) {
  if (symbol === "J" || symbol === "kJ") {
    unit(`${symbol}/(mol K)`, ["molar_entropy", "molar_heat_capacity", "gas_constant"], factor, `${symbol}\\s*${thermalMol}`);
    unit(`${symbol}/K`, ["entropy", "heat_capacity"], factor, `${symbol}\\s*(?:/\\s*K|K\\s*\\^?\\(?-1\\)?)`);
  }
  unit(`${symbol}/mol`, "molar_energy", factor, `${symbol}\\s*${perMol}`);
  unit(symbol, "energy", factor, symbol);
}
unit("eV", "energy", 1.602176634e-19, "eV");
unit("g/mol", "molar_mass", 1, String.raw`g\s*(?:/\s*mol|mol\s*\^?\(?-1\)?)|amu|u`);
unit("kg/mol", "molar_mass", 1000, String.raw`kg\s*(?:/\s*mol|mol\s*\^?\(?-1\)?)`);
unit("g/cm^3", "density", 1, String.raw`g\s*(?:/\s*(?:cm\s*\^?3|mL|cc)|cm\s*\^?\(?-3\)?)`);
unit("kg/m^3", "density", .001, String.raw`kg\s*(?:/\s*m\s*\^?3|m\s*\^?\(?-3\)?)`);
unit("mol/L", "concentration", 1, String.raw`M|molar|mol\s*(?:/\s*[Ll]|[Ll]\s*\^?\(?-1\)?|dm\s*\^?\(?-3\)?|/\s*dm\s*\^?3|per litre)`);
unit("eq/L", "normality", 1, "N|normal|eq/L");
unit("mol/kg", "molality", 1, String.raw`mol\s*(?:/\s*kg|kg\s*\^?\(?-1\)?)`);
unit("mol/(L s)", "rate_constant_zero", 1, String.raw`(?:M|mol\s*/\s*[Ll])\s*(?:s\s*\^?\(?-1\)?|/\s*s)`);
unit("L/(mol s)", "rate_constant_second", 1, String.raw`(?:[Ll]\s*mol\s*\^?\(?-1\)?\s*s\s*\^?\(?-1\)?|[Ll]\s*/\s*\(\s*mol\s*s\s*\)|M\s*\^?\(?-1\)?\s*s\s*\^?\(?-1\)?)`);
unit("L atm/(mol K)", "gas_constant", 101.325, String.raw`(?:[Ll]\s*atm|atm\s*[Ll])\s*${thermalMol}`);
unit("L bar/(mol K)", "gas_constant", 100, String.raw`(?:[Ll]\s*bar|bar\s*[Ll])\s*${thermalMol}`);
unit("mol/(L atm)", "concentration_pressure", 1, String.raw`mol\s*/\s*\(\s*[Ll]\s*atm\s*\)`);
unit("mol/(L bar)", "concentration_pressure", 1.01325, String.raw`mol\s*/\s*\(\s*[Ll]\s*bar\s*\)`);
unit("K kg/mol", "colligative_constant", 1, String.raw`(?:K|°\s*C)\s*kg\s*/\s*mol|(?:K|°\s*C)\s*kg\s*mol\s*\^?\(?-1\)?`);
unit("C/mol", "faraday_constant", 1, String.raw`C\s*${perMol}`);
unit("mol^-1", "avogadro_constant", 1, String.raw`mol\s*\^?\(?-1\)?|/\s*mol`);
unit("kg m/s", "momentum", 1, String.raw`kg\s*m\s*/\s*s`);
unit("m/s", "speed", 1, String.raw`m\s*/\s*s|m\s*s\s*\^?\(?-1\)?`);
unit("J s", "action", 1, String.raw`J\s+s`);
unit("eV s", "action", 1.602176634e-19, String.raw`eV\s+s`);
unit("J m", "energy_length", 1, String.raw`J\s+m`);
unit("eV nm", "energy_length", 1.602176634e-28, String.raw`eV\s+nm`);
for (const [symbol, factor, pattern] of [["s", 1, "s|sec(?:ond)?s?"], ["min", 60, "min(?:ute)?s?"], ["h", 3600, "h|hrs?|hours?"], ["days", 86400, "d|days?"], ["yr", 31557600, "yrs?|years?"]] as const) {
  unit(`${symbol}^-1` as ChemistryUnit, symbol === "s" ? ["rate_constant_first", "frequency"] : "rate_constant_first", 1/factor, `(?:${pattern})\\s*(?:\\^\\s*\\(?-1\\)?|-1|⁻¹)`);
  unit(`${symbol}^-1` as ChemistryUnit, symbol === "s" ? ["rate_constant_first", "frequency"] : "rate_constant_first", 1/factor, `(?:per|/)\\s*(?:${pattern})`);
  unit("mol/(L s)", "rate_constant_zero", 1/factor, `(?:M|mol\\s*(?:/\\s*[Ll]|[Ll]\\s*\\^?\\(?[-−]1\\)?))\\s*(?:${pattern})\\s*(?:\\^?\\(?[-−]1\\)?|⁻¹)`);
  unit("L/(mol s)", "rate_constant_second", 1/factor, `(?:[Ll]\\s*mol\\s*\\^?\\(?[-−]1\\)?|M\\s*\\^?\\(?[-−]1\\)?)\\s*(?:${pattern})\\s*(?:\\^?\\(?[-−]1\\)?|⁻¹)`);
  unit(symbol, "time", factor, pattern);
}
unit("K", ["temperature", "temperature_delta"], 1, "K|kelvin");
unit("°C", ["temperature", "temperature_delta"], 1, String.raw`(?:°|º|o)\s*C|deg(?:rees?)?\s*(?:C|Celsius|celsius)|[Cc]elsius`, 273.15);
for (const [symbol, factor, pattern] of [["m", 1, "m|met(?:er|re)s?"], ["cm", .01, "cm"], ["nm", 1e-9, "nm"], ["pm", 1e-12, "pm"], ["Å", 1e-10, "Å|å|angstroms?|[Aa]°"]] as const) unit(symbol, symbol === "m" ? ["length", "molality"] : "length", factor, pattern);
unit("mL", "volume", .001, String.raw`mL|ml|cm\s*\^?3|cc`);
unit("L", "volume", 1, String.raw`L|l|lit(?:er|re)s?|dm\s*\^?3`);
unit("kg", "mass", 1, "kg"); unit("g", "mass", .001, "g");
unit("mol", "amount", 1, "mol(?:e|es)?");
for (const [symbol, factor, pattern] of [["Pa", 1, "Pa"], ["kPa", 1000, "[kK]Pa"], ["bar", 1e5, "bar"], ["atm", 101325, "atm"], ["torr", 101325/760, "torr|mm\\s*(?:of\\s+)?Hg"]] as const) unit(symbol, "pressure", factor, pattern);
unit("Hz", "frequency", 1, "Hz|hertz"); unit("V", "potential", 1, "V|[Vv]olts?");
unit("mA", "current", .001, "mA"); unit("A", "current", 1, "A|amp(?:ere)?s?"); unit("C", "charge", 1, "C|coulombs?");
unit("%", "dimensionless", .01, "%|percent"); unit("1", "dimensionless", 1, "1");
const canonical: Record<ChemistryDimension, ChemistryUnit> = {
  dimensionless: "1", time: "s", temperature: "K", temperature_delta: "K", length: "m", volume: "L", mass: "kg", amount: "mol", molar_mass: "g/mol", density: "g/cm^3", concentration: "mol/L", normality: "eq/L", molality: "mol/kg", pressure: "Pa", energy: "J", molar_energy: "J/mol", entropy: "J/K", molar_entropy: "J/(mol K)", heat_capacity: "J/K", molar_heat_capacity: "J/(mol K)", frequency: "Hz", speed: "m/s", momentum: "kg m/s", action: "J s", energy_length: "J m", potential: "V", current: "A", charge: "C", faraday_constant: "C/mol", avogadro_constant: "mol^-1", gas_constant: "J/(mol K)", rate_constant_first: "s^-1", rate_constant_zero: "mol/(L s)", rate_constant_second: "L/(mol s)", colligative_constant: "K kg/mol", concentration_pressure: "mol/(L atm)",
};
function definition(unitName: ChemistryUnit, dimension: ChemistryDimension): UnitDefinition | undefined {
  return units.find(u => u.unit === unitName && u.dimensions.includes(dimension));
}
function canonicalValue(value: number, def: UnitDefinition, dimension: ChemistryDimension): ChemRead<number> {
  const offset = dimension === "temperature" ? def.offset ?? 0 : 0;
  const converted = value * def.factor + offset;
  return Number.isFinite(value) && Number.isFinite(converted) && !(value !== 0 && converted === 0 && offset === 0)
    ? {ok:true,reading:converted} : fail("malformed");
}
function unitAt(text: string): { def: UnitDefinition; text: string } | null {
  // Normalize notation only, preserving an end map to the original JS span.
  // Superscript exponents and multiplication dots are parts of the unit.
  const superscript = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻"; const ascii = "0123456789+-";
  let normalized = ""; const sourceEnds: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (superscript.includes(ch)) {
      if (i === 0 || !superscript.includes(text[i-1]!)) { normalized += "^"; sourceEnds.push(i); }
      normalized += ascii[superscript.indexOf(ch)]!; sourceEnds.push(i+1);
    } else { normalized += /[·⋅]/.test(ch) ? " " : ch; sourceEnds.push(i+1); }
  }
  const matches = units.flatMap(def => { const m = def.pattern.exec(normalized); return m ? [{ def, text: text.slice(0, sourceEnds[m[0].length-1]) }] : []; });
  return matches.sort((a,b) => b.text.length - a.text.length)[0] ?? null;
}
// Internal compound factors and aliases come from the same finite registry.
const unitFactors = new Set(units.flatMap(def => [
  ...(def.unit.match(/[A-Za-zÅ°]+/g) ?? []),
  ...(def.pattern.source.match(/(?<!\\)[A-Za-zÅå°]+/g) ?? []).filter(factor => factor !== "of"),
]));
function continuesUnit(tail: string): boolean {
  const rest = tail.trimStart();
  const factor = /^[A-Za-zÅå°]+/.exec(rest)?.[0];
  return /^(?:\s*[/^~!*·⋅⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]|[A-Za-z0-9])/.test(tail)
    || (rest.length < tail.length && (!!unitAt(rest) || (!!factor && unitFactors.has(factor))));
}
/** The plain component role cannot certify a prefix of a name, charged
 * species, scripted identifier, group or physical-unit expression. */
function completeComponentSpan(question: string, span: ChemistrySpan): boolean {
  if (!validSpan(question, span) || span.end > chemistryQuestionSpan(question).end) return false;
  const before = question.slice(0, span.start); const after = question.slice(span.end);
  const left = before.trimEnd(); const right = after.trimStart();
  // Delimit plain names positively: unknown attached symbols are not prose.
  return (!before || /[\s,.;:!?=]$/.test(before)) && (!after || /^[\s,.;:!?=]/.test(after))
    && (!left || /[A-Za-z0-9,.;:!?=]$/.test(left)) && (!right || /^[A-Za-z,.;:!?=]/.test(right))
    && !/^\.(?=[\p{L}\p{N}\p{M}_])/u.test(after) && !continuesUnit(after);
}
export function chemistryQuestionSpan(question: string): ChemistrySpan {
  const options = /\boptions?\s*:|\(a\)\s+[^()]{3,}\(b\)/i.exec(question);
  return { start: 0, end: options?.index ?? question.length };
}
function literalAt(input: Omit<ChemistryQuantityInput, "after">, start: number, end: number, component?: { span: ChemistrySpan; text: string }): ChemRead<ChemistryReading> {
  if (start >= end) return fail("missing");
  // A caller's clause end cannot cut a token into an admissible prefix.
  const tail = input.question.slice(start, chemistryQuestionSpan(input.question).end);
  const match = SCALAR_PREFIX.exec(tail);
  if (!match) return fail("missing");
  const scalarSpan = { start, end: start + match[0].length };
  const scalar = parseChemistryScalar(input.question, scalarSpan);
  if (!scalar.ok) return scalar;
  const after = tail.slice(match[0].length);
  if (continuesScalar(after)) return fail("malformed", scalarSpan);
  const spacing = /^\s*/.exec(after)![0].length;
  const unitTail = after.slice(spacing);
  const parsedUnit = unitAt(unitTail);
  let rawUnit = parsedUnit?.text ?? null;
  let def = parsedUnit?.def;
  const unitEnd = scalarSpan.end + spacing + (rawUnit?.length ?? 0);
  // Only the checked component-amount seam may interpret a unit symbol as a
  // following species. General literal, planner and inventory APIs cannot.
  const componentBoundary = input.dimension === "amount" && def?.unit === "mol" && component
    && completeComponentSpan(input.question, component.span)
    && /^\s+$/.test(input.question.slice(unitEnd, component.span.start));
  if (def && !componentBoundary && continuesUnit(unitTail.slice(rawUnit!.length))) return fail("unsupported_unit", scalarSpan);
  if (!def && input.unitConvention) {
    const convention = input.unitConvention;
    const body = chemistryQuestionSpan(input.question); const scope = input.within ?? body;
    if (!validSpan(input.question, convention.sourceSpan) || convention.sourceSpan.start < scope.start || convention.sourceSpan.end > Math.min(scope.end, body.end)) return fail("source_conflict", convention.sourceSpan);
    const stated = unitAt(input.question.slice(convention.sourceSpan.start, convention.sourceSpan.end).trim());
    const full = unitAt(input.question.slice(convention.sourceSpan.start, body.end));
    if (!stated || !full || full.text.length !== convention.sourceSpan.end - convention.sourceSpan.start || continuesUnit(input.question.slice(convention.sourceSpan.end)) || stated.def.unit !== convention.unit || stated.text !== input.question.slice(convention.sourceSpan.start, convention.sourceSpan.end).trim()) return fail("source_conflict", convention.sourceSpan);
    if (unitTail && !/^(?:and|or|at|for|of|to|from|with|is|was|which|find|draw|plot)\b|^[,.;:)]/i.test(unitTail)) return fail("unsupported_unit", scalarSpan);
    def = definition(convention.unit, input.dimension); rawUnit = null;
  }
  if (!def && input.dimension === "dimensionless") {
    const boundedTail = input.question.slice(scalarSpan.end + spacing, end);
    if (/^[A-Za-z°%/]/.test(boundedTail) && !/^(?:and|or|at|for|of|to|from|with|is|was|which|find|draw|plot|remaining|complete|completed|reacted|decomposed|times|fold)\b/i.test(boundedTail)) return fail("unsupported_unit", scalarSpan);
    def = definition("1", "dimensionless");
  }
  if (!def || !def.dimensions.includes(input.dimension)) return fail("unsupported_unit", scalarSpan);
  const converted = canonicalValue(scalar.reading, def, input.dimension);
  if (!converted.ok) return fail("malformed", scalarSpan);
  const value = converted.reading;
  const sourceEnd = parsedUnit ? scalarSpan.end + spacing + parsedUnit.text.length : scalarSpan.end;
  if (sourceEnd > end) return fail("source_conflict", {start, end: sourceEnd});
  const reading: ChemistryReading = { value, canonicalUnit: canonical[input.dimension], dimension: input.dimension, rawValue: scalar.reading, rawUnit, source: { kind: "stem_given", span: { start, end: sourceEnd }, text: input.question.slice(start, sourceEnd) } };
  return input.targetUnit ? convertChemistryReading(reading, input.targetUnit) : { ok: true, reading };
}
/** Unit arithmetic for already-resolved/derived values; this creates no source authority. */
export function convertChemistryValue(value: number, fromUnit: ChemistryUnit, targetUnit: ChemistryUnit, dimension: ChemistryDimension): ChemRead<number> {
  const from = definition(fromUnit, dimension); const to = definition(targetUnit, dimension);
  if (!from || !to) return fail("unsupported_unit");
  const offset = (u: UnitDefinition) => dimension === "temperature" ? u.offset ?? 0 : 0;
  const source = canonicalValue(value, from, dimension);
  if (!source.ok) return source;
  const converted = (source.reading - offset(to)) / to.factor;
  return Number.isFinite(value) && Number.isFinite(converted) && !(value !== 0 && converted === 0 && offset(from) === offset(to))
    ? {ok: true, reading: converted} : fail("malformed");
}
export function chemistryUnitSymbol(raw: string, dimension: ChemistryDimension): ChemistryUnit | null {
  const parsed = unitAt(raw.trim());
  return parsed && parsed.text === raw.trim() && parsed.def.dimensions.includes(dimension) ? parsed.def.unit : null;
}
export function convertChemistryReading(reading: ChemistryReading, targetUnit: ChemistryUnit): ChemRead<ChemistryReading> {
  const value = convertChemistryValue(reading.value, reading.canonicalUnit, targetUnit, reading.dimension);
  return value.ok ? {ok: true, reading: {...reading, value: value.reading, canonicalUnit: targetUnit}} : value;

}
/** Bind a family-owned semantic number span; units still come only from original text. */
export function readChemistryLiteral(input: Omit<ChemistryQuantityInput, "after"> & { scalarSpan: ChemistrySpan }): ChemRead<ChemistryReading> {
  if (!validSpan(input.question, input.scalarSpan)) return fail("malformed", input.scalarSpan);
  const body = chemistryQuestionSpan(input.question); const scope = input.within ?? body;
  if (!validSpan(input.question, scope)) return fail("malformed", scope);
  const end = Math.min(scope.end, body.end);
  if (input.scalarSpan.start < scope.start || input.scalarSpan.end > end) return fail("source_conflict", input.scalarSpan);
  const token = SCALAR_PREFIX.exec(input.question.slice(input.scalarSpan.start));
  if (!token || token[0].length !== input.scalarSpan.end - input.scalarSpan.start) return fail("malformed", input.scalarSpan);
  const result = literalAt(input, input.scalarSpan.start, end);
  if (!result.ok) return result;
  const scalar = parseChemistryScalar(input.question, input.scalarSpan);
  return scalar.ok && scalar.reading === result.reading.rawValue ? result : fail("malformed", input.scalarSpan);
}
export function matchedChemistryQuantity(question: string, match: RegExpMatchArray | null, group: number, dimension: ChemistryDimension, targetUnit?: ChemistryUnit): number | null {
  if (!match || match.index === undefined || match[group] === undefined) return null;
  const span = match.indices?.[group];
  if (!span) return null;
  const start = span[0];
  const read = readChemistryLiteral({question, scalarSpan: {start, end: start + match[group]!.length}, dimension, targetUnit});
  return read.ok ? read.reading.value : null;
}
/** Amount of a component already resolved independently by its family.
 * This role seam never exempts suffixes in the general quantity APIs. */
export function matchedChemistryComponentAmount(question: string, match: RegExpMatchArray | null, scalarGroup: number,
  componentGroup: number, resolved: { name: string; sourceSpan: ChemistrySpan }, dimension: ChemistryDimension = "amount"): number | null {
  const scalar = match?.indices?.[scalarGroup]; const component = match?.indices?.[componentGroup];
  if (dimension !== "amount" || !match || match.input !== question || !scalar || !component || !match[componentGroup]) return null;
  const span = {start:component[0],end:component[1]}; const text = match[componentGroup]!;
  const independent = resolved.sourceSpan;
  if (!completeComponentSpan(question, span) || !completeComponentSpan(question, independent)
    || (independent.start < span.end && independent.end > span.start)
    || question.slice(span.start,span.end) !== text || !/^[A-Za-z][A-Za-z0-9]*$/.test(text)
    || text.toLowerCase() !== resolved.name.toLowerCase()
    || question.slice(independent.start,independent.end).toLowerCase() !== resolved.name.toLowerCase()) return null;
  const scalarSpan = {start:scalar[0],end:scalar[1]};
  const value = parseChemistryScalar(question,scalarSpan); if (!value.ok) return null;
  const read = literalAt({question,dimension:"amount",targetUnit:"mol"},scalarSpan.start,chemistryQuestionSpan(question).end,{span,text});
  return read.ok && read.reading.rawValue === value.reading
    && /^\s+(?:of\s+)?$/i.test(question.slice(read.reading.source.span.end,span.start)) ? read.reading.value : null;
}
export function readChemistryQuantity(input: ChemistryQuantityInput): ChemRead<ChemistryReading> {
  const body = chemistryQuestionSpan(input.question); const scope = input.within ?? body;
  if (!validSpan(input.question, scope)) return fail("malformed", scope);
  const end = Math.min(body.end, scope.end); const segment = input.question.slice(scope.start, end);
  const flags = input.after.flags.replace(/[gy]/g, "");
  const cue = new RegExp(input.after.source, flags + (flags.includes("i") || input.cueCaseSensitive ? "g" : "ig"));
  const readings: ChemistryReading[] = [];
  for (const match of segment.matchAll(cue)) {
    const cueEnd = scope.start + match.index! + match[0].length;
    const connector = /^(?:\s+|[=:]|\b(?:is|was|are|of|equals|equal to|about|nearly|approximately)\b)*/i.exec(input.question.slice(cueEnd, end))![0];
    const found = literalAt(input, cueEnd + connector.length, end);
    if (found.ok) readings.push(found.reading); else if (found.code !== "missing") return found;
  }
  return readings.length === 1 ? { ok: true, reading: readings[0]! } : fail(readings.length ? "ambiguous" : "missing");
}
/** Exponent digits in a complete registered unit or parsed atomic charge are
 * notation, not independent physical scalars. Evidence uses original spans;
 * damaged or continued expressions receive no exemption. */
function inventoryNotationSpans(question: string, end: number): ChemistrySpan[] {
  const spans: ChemistrySpan[] = [];
  const body = question.slice(0, end);
  for (const match of body.matchAll(/[A-Za-zÅå°/]/g)) {
    const start = match.index!;
    if (/[A-Za-z0-9_]/.test(body[start - 1] ?? "")) continue;
    const parsed = unitAt(body.slice(start));
    if (parsed && !continuesUnit(body.slice(start + parsed.text.length))) spans.push({ start, end: start + parsed.text.length });
  }
  const ions = /[A-Z][a-z]?(?:\d*[+-]|\^(?:\(\d*[+-]\)|\{\d*[+-]\}|\d*[+-])|[⁰¹²³⁴⁵⁶⁷⁸⁹]*[⁺⁻])/g;
  for (const match of body.matchAll(ions)) {
    const start = match.index!; const finish = start + match[0].length;
    if (/[\p{L}\p{N}\p{M}_^+−-]/u.test(body[start - 1] ?? "")) continue;
    const parsed = parseFormula(match[0]);
    if (!parsed || parsed.atoms.length !== 1 || parsed.totalAtoms !== 1 || !parsed.charge) continue;
    const tail = body.slice(finish);
    // A cell potential may name an independently parsed redox partner.
    const partner = /^\/([A-Z][a-z]?)(?=[\s,.;:|)\]]|$)/.exec(tail);
    const cellPair = partner && parseFormula(partner[1]!)?.totalAtoms === 1;
    const phase = /^\((?:aq|s|l|g)\)(?=[\s,.;:|)\]]|$)/.test(tail);
    if (!cellPair && !phase && /^[\p{L}\p{N}\p{M}_^+−\-⁺⁻/·*([{}]/u.test(tail)) continue;
    spans.push({ start, end: finish });
  }
  return spans;
}
/** Literal inventory for semantic consumers that bind species/clause spans themselves. */
export function findChemistryQuantities(input: Omit<ChemistryQuantityInput, "after">): ChemRead<readonly ChemistryReading[]> {
  const body = chemistryQuestionSpan(input.question); const scope = input.within ?? body;
  if (!validSpan(input.question, scope)) return fail("malformed", scope);
  const end = Math.min(scope.end, body.end);
  const readings: ChemistryReading[] = []; let consumed = -1;
  const notation = inventoryNotationSpans(input.question, end);
  for (const match of input.question.matchAll(new RegExp(SCALAR, "g"))) {
    const start = match.index! + match[0].length - match[0].trimStart().length;
    const tokenEnd = match.index! + match[0].trimEnd().length;
    if (tokenEnd <= scope.start || start >= end || start < consumed) continue;
    if (start < scope.start || tokenEnd > end) return fail("source_conflict", {start,end:tokenEnd});
    if (/[A-Za-z0-9_.]/.test(input.question[start-1] ?? "") || notation.some(span => start > span.start && tokenEnd <= span.end)) continue;
    // A failed joined token is atomic: never restart at digits following a
    // thousands/decimal comma or an unsupported multiplication separator.
    const prefix = input.question.slice(scope.start, start);
    const suffix = input.question.slice(tokenEnd, end);
    if (/\d\s*,\s*$|\d(?:\.\d+)?\s*[Xx×·⋅*]\s*$/.test(prefix)
      || /^\s*,\s*\d|^\s*[X·⋅]\s*10/.test(suffix)) return fail("malformed", {start,end:tokenEnd});
    consumed = tokenEnd;
    const found = literalAt(input, start, end);
    if (found.ok) { readings.push(found.reading); consumed = found.reading.source.span.end; }
    else if (found.code === "source_conflict") return found;
    else if (found.code === "malformed") {
      const clause = input.question.slice(start, end).split(/[;\n]/)[0]!.slice(0, 100);
      if (units.some(u => u.dimensions.includes(input.dimension) && new RegExp(u.pattern.source.slice(1)).test(clause))) return found;
    }
  }
  return { ok: true, reading: readings };
}
function bindingSpan(question: string, quantity: ChemPlanQuantity): ChemistrySpan | null {
  if (quantity.sourceSpan) return quantity.sourceSpan.end <= chemistryQuestionSpan(question).end && validSpan(question, quantity.sourceSpan) && (!quantity.sourceText || question.slice(quantity.sourceSpan.start, quantity.sourceSpan.end) === quantity.sourceText) ? quantity.sourceSpan : null;
  if (!quantity.sourceText) return null;
  const start = question.indexOf(quantity.sourceText);
  if (start < 0 || start + quantity.sourceText.length > chemistryQuestionSpan(question).end || question.indexOf(quantity.sourceText, start + 1) >= 0) return null;
  const cited = { start, end: start + quantity.sourceText.length };
  const scalarEnd = cited.end - (quantity.sourceText.length - quantity.sourceText.trimEnd().length);
  const notation = inventoryNotationSpans(question, chemistryQuestionSpan(question).end);
  // Free prose may stop after a complete scalar. Its immediately contiguous
  // original unit corroborates the citation; explicit spans above never grow.
  for (const match of question.matchAll(new RegExp(SCALAR, "g"))) {
    const span = { start: match.index! + match[0].length - match[0].trimStart().length, end: match.index! + match[0].trimEnd().length };
    if (span.start < cited.start || span.end !== scalarEnd || notation.some(unit => span.start > unit.start && span.end <= unit.end)) continue;
    if (!parseChemistryScalar(question, span).ok) break;
    const originalUnit = unitAt(question.slice(span.end).trimStart());
    if (!originalUnit) break;
    const reading = literalAt({ question, dimension: originalUnit.def.dimensions[0]! }, span.start, chemistryQuestionSpan(question).end);
    if (reading.ok && reading.reading.rawUnit && reading.reading.source.span.end > cited.end) return { start: cited.start, end: reading.reading.source.span.end };
    break;
  }
  return cited;
}
const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
function valuesAgree(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (actual === expected) return true;
  if (actual === 0 || expected === 0 || Math.sign(actual) !== Math.sign(expected)) return false;
  return Math.abs(actual - expected) <= Math.max(Math.abs(actual), Math.abs(expected)) * 1e-9;
}
/** Compare already-read values in the same canonical unit; this grants no source or unit authority. */
export const chemistryCanonicalValuesAgree = valuesAgree;
/** A fixed-reference solver may run only when its stated constant agrees.
 * A different supplied value requires a parameterized solver; until then decline. */
export function chemistryReferenceConstantValid(question: string, after: RegExp, dimension: ChemistryDimension, unit: ChemistryUnit, reference: number): boolean {
  const cue = new RegExp(after.source, after.flags.replace(/[gy]/g, ""));
  if (!cue.test(question.slice(0, chemistryQuestionSpan(question).end))) return true;
  const read = readChemistryQuantity({question,after,dimension,targetUnit:unit});
  return read.ok && valuesAgree(read.reading.value,reference);
}
export function resolveChemistryGiven(input: ChemistryQuantityInput & { quantities: readonly ChemPlanQuantity[]; aliases: readonly string[] }): ChemRead<ChemistryReading> {
  const stem = readChemistryQuantity(input);
  const givens = input.quantities.filter(q => q.origin === "given" && input.aliases.some(a => key(a) === key(q.id) || key(a) === key(q.symbol)));
  const boundGivens: ChemPlanQuantity[] = [];
  for (const given of givens) {
    const bound = bindingSpan(input.question, given);
    // Planner prose is not a source citation. An explicit invalid span is a
    // damaged authority claim; absent/nonliteral free text has no authority.
    if (!bound) { if (given.sourceSpan) return fail("source_conflict"); continue; }
    boundGivens.push(given);
    if (!stem.ok || stem.reading.source.span.start < bound.start || stem.reading.source.span.end > bound.end || !Number.isFinite(given.value) || !given.unit) return fail("source_conflict", bound ?? undefined);
    const statedUnit = unitAt(given.unit.trim());
    if (!statedUnit || statedUnit.text !== given.unit.trim() || !statedUnit.def.dimensions.includes(input.dimension)) return fail("source_conflict", bound);
    const value = canonicalValue(given.value, statedUnit.def, input.dimension);
    if (!value.ok) return fail("source_conflict", bound);
    const plan: ChemistryReading = { ...stem.reading, value: value.reading, canonicalUnit: canonical[input.dimension] };
    const converted = convertChemistryReading(plan, stem.reading.canonicalUnit);
    if (!converted.ok || !valuesAgree(converted.reading.value, stem.reading.value)) return fail("source_conflict", bound);
  }
  if (!stem.ok || !boundGivens.length) return stem;
  return { ok: true, reading: { ...stem.reading, source: { ...stem.reading.source, kind: "plan_given", planQuantityId: boundGivens[0]!.id } } };
}
/** Family-local semantic expectations: a present damaged or incompatible literal is never omitted. */
export function chemistryQuantityCuesValid(question: string, cues: readonly {after: RegExp; dimensions: readonly ChemistryDimension[]; cueCaseSensitive?: boolean}[]): boolean {
  return cues.every(cue => {
    const reads = cue.dimensions.map(dimension => readChemistryQuantity({question, after: cue.after, dimension, cueCaseSensitive:cue.cueCaseSensitive}));
    return reads.some(r => r.ok) || reads.every(r => !r.ok && r.code === "missing");
  });
}
/** Reject contradictory supported physical givens before a legacy adapter can mask a failed binding. */
export function chemistryPlanBindingsValid(question: string, quantities: readonly ChemPlanQuantity[]): boolean {
  return quantities.every(q => {
    if (q.origin !== "given") return true;
    const span = bindingSpan(question, q);
    if (!span) return !q.sourceSpan;
    if (!Number.isFinite(q.value)) return false;
    if (!q.unit) return true;
    const parsedUnit = unitAt(q.unit.trim()); if (!parsedUnit || parsedUnit.text !== q.unit.trim()) return false;
    const dimension = parsedUnit.def.dimensions[0]!;
    const literals = findChemistryQuantities({question, within: span, dimension});
    const expected = canonicalValue(q.value, parsedUnit.def, dimension);
    return literals.ok && literals.reading.length === 1 && expected.ok
      && valuesAgree(literals.reading[0]!.value, expected.reading);
  });
}
/** Semantic capture bindings require the d flag for exact original indices; no indexOf guessing. */
export function matchedChemistryScalar(question: string, match: RegExpMatchArray | null, group = 1): number | null {
  const token = match?.[group]; if (!match || token === undefined || match.index === undefined) return null;
  const span = match.indices?.[group]; if (!span) return null;
  const [start, end] = span;
  const parsed = parseChemistryScalar(question, { start, end }); return parsed.ok ? parsed.reading : null;
}
