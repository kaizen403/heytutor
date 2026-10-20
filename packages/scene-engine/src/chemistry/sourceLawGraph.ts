/** Source-owned one-dimensional laws. Spans refer to `question` (the canonical
 * pipeline input), never to an earlier raw/Unicode capture. No defaults or
 * catalogue values acquire source authority here. */
import { CHEMISTRY_SCALAR_PATTERN, parseChemistryScalar, readChemistryLiteral, chemistryUnitSymbol, convertChemistryValue, type ChemistrySpan, type ChemistryDimension, type ChemistryUnit } from "./quantityReader";
import { parseFormula } from "./formula";
import { ionicAccount } from "./bondingFigures";
import { parseMathExpression } from "../math/expression";
import { SourceLawClauses, lawWord, type LawAxisMeaning, type LawClauseKind } from "./sourceLawClauses";

export interface LawSource { span: ChemistrySpan; text: string }
export interface LawBinding {
  role: string; value: number; dimension: ChemistryDimension | "concentration_squared";
  unit: string; symbol?: string; scalarSource: LawSource; unitSource?: LawSource;
}
export interface LawAxis {
  symbol: string; label: string; unit: string; domain: [number, number]; transform: "linear" | "log10";
}
export type SourceLawRelation =
  | { operator: "affine" | "threshold_affine" | "log_coordinate"; slope: number; intercept: number }
  | { operator: "ratio_complements"; pK: number; complement: boolean }
  | { operator: "positive_quadratic"; product: number };
/** Source facts are typed separately from derived chemical consequences. */
export type LawChemicalContext = {
  kind: "solubility_equilibrium"; solid: LawSource; donor: LawSource; retained: LawSource;
  solubility: LawSource; concentration: LawSource; suppliedRelation: LawSource;
  cation: { symbol: string; charge: number }; anion: { symbol: string; charge: number };
  assumptions: { concentrationConvention: LawSource; activities: LawSource; excludedReactions: LawSource };
} | {
  kind: "ideal_monoprotic_acid"; acid: LawSource; concentration: LawSource;
  ionisation: LawSource; waterNeglect: LawSource; suppliedRelation: LawSource;
  derivedBalance: "one_proton_per_formula_unit";
};
export interface SourceLawGraph {
  version: "chemistry-source-law-graph/v1"; question: string; family: string;
  relationSource: LawSource; bindings: LawBinding[]; x: LawAxis; y: LawAxis;
  curves: Array<{ id: string; label: string; relation: SourceLawRelation; domain: [number, number] }>;
  points: Array<{ curveId: string; x: number; y: number; label?: string; detached?: boolean }>;
  notes: string[];
  chemicalContext?: LawChemicalContext;
  regions?: Array<{ domain: [number,number]; label: string; meaning: "no_emission" | "positive" | "negative" }>;
}
export type SourceLawRead = { state: "unclaimed" } | { state: "declined" } | { state: "valid"; model: SourceLawGraph };
export type SourceLawFamily = "chem_solutions" | "chem_electrochem" | "chem_orbital";
const scalar = CHEMISTRY_SCALAR_PATTERN;
const symbol = String.raw`[A-Za-z][A-Za-z_°]*(?:_[A-Za-z]+)?`;
const source = (question: string, span: ChemistrySpan): LawSource => ({ span, text: question.slice(span.start, span.end) });
const spanOf = (match: RegExpMatchArray, group: number): ChemistrySpan => ({start: match.indices![group]![0], end: match.indices![group]![1]});
function one(question: string, pattern: RegExp): RegExpMatchArray | null {
  const all = [...question.matchAll(new RegExp(pattern.source, pattern.flags.replace(/[gyd]/g, "") + "gd"))];
  return all.length === 1 ? all[0]! : null;
}
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The expression owns its complete operands and separators. Standalone
 * measurements still use the shared literal reader with its strict suffixes. */
class SourceOperands {
  readonly bindings: LawBinding[] = [];
  readonly owned: ChemistrySpan[] = [];
  readonly clauses: SourceLawClauses;
  constructor(readonly question: string) { this.clauses = new SourceLawClauses(question); }
  statement(match: RegExpMatchArray, kind: LawClauseKind): void { this.clauses.bind(spanOf(match,0),kind); }
  syntax(body: string, kind: LawClauseKind = "context"): boolean { return this.clauses.consume(body,kind).length > 0; }
  axes(x: LawAxisMeaning, y: LawAxisMeaning): boolean {
    const notation = this.clauses.repeatedAxes(x,y);
    if (!notation) return false;
    for (const span of notation) this.own(span);
    return true;
  }
  own(span: ChemistrySpan): void { this.owned.push(span); }
  /** Only parsed operations own text; unknown tails remain unconsumed. */
  request(body: string): boolean { return this.syntax(body,"mark"); }
  number(match: RegExpMatchArray, group: number, role: string): number | null {
    const span = spanOf(match, group); const value = parseChemistryScalar(this.question, span);
    if (!value.ok) return null;
    this.own(span); this.bindings.push({role,value:value.reading,dimension:"dimensionless",unit:"1",scalarSource:source(this.question,span)});
    return value.reading;
  }
  literal(match: RegExpMatchArray, group: number, role: string, dimension: ChemistryDimension, targetUnit: ChemistryUnit): number | null {
    const span = spanOf(match,group);
    const read = readChemistryLiteral({question:this.question,scalarSpan:span,dimension,targetUnit});
    if (!read.ok) return null;
    const unitStart = span.end + /^\s*/.exec(this.question.slice(span.end))![0].length;
    this.own(read.reading.source.span);
    this.bindings.push({role,value:read.reading.value,dimension,unit:targetUnit,scalarSource:source(this.question,span),unitSource:source(this.question,{start:unitStart,end:read.reading.source.span.end})});
    return read.reading.value;
  }
  /** Explicit unit operand in a closed equation or a shared-unit list. */
  operand(match: RegExpMatchArray, scalarGroup: number, unitGroup: number, role: string, dimension: ChemistryDimension, targetUnit: ChemistryUnit, power = 1): number | null {
    const scalarSpan = spanOf(match,scalarGroup), unitSpan = spanOf(match,unitGroup);
    const read = parseChemistryScalar(this.question,scalarSpan);
    const unit = chemistryUnitSymbol(this.question.slice(unitSpan.start,unitSpan.end),dimension);
    if (!read.ok || !unit) return null;
    const converted = convertChemistryValue(1,unit,targetUnit,dimension);
    if (!converted.ok) return null;
    const value = read.reading * converted.reading ** power;
    if (!Number.isFinite(value) || (read.reading !== 0 && value === 0)) return null;
    this.own(scalarSpan); this.own(unitSpan);
    this.bindings.push({role,value,dimension:power === 2 ? "concentration_squared" : dimension,unit:power === 2 ? `(${targetUnit})^2` : targetUnit,scalarSource:source(this.question,scalarSpan),unitSource:source(this.question,unitSpan)});
    return value;
  }
  context(): boolean {
    const declared: number[] = [];
    for (const match of this.question.matchAll(new RegExp(`\\bat\\s+(${scalar})\\s*(K|°\\s*C)\\b`,"gdi"))) {
      const span = spanOf(match,1);
      if (this.owned.some(value => value.start <= span.start && value.end >= span.end)) continue;
      const temperature = this.literal(match,1,"environment temperature","temperature","K");
      if (temperature === null || temperature <= 0) return false;
      this.bindings[this.bindings.length-1]!.symbol="T";
      this.clauses.bind({start:spanOf(match,0).start,end:this.bindings[this.bindings.length-1]!.unitSource!.span.end},"context");
      declared.push(temperature);
    }
    return declared.every(value => Math.abs(value-declared[0]!) <= 1e-9);
  }
  /** Every numeric lexeme must belong to an explicitly parsed operand or
   * complete relation. Arbitrary alphanumeric adjacency is never ownership. */
  complete(): boolean {
    if (!this.context()) return false;
    for (const match of this.question.matchAll(new RegExp(scalar,"g"))) {
      const start = match.index! + match[0].length-match[0].trimStart().length, end = match.index! + match[0].trimEnd().length;
      if (this.owned.some(span => span.start <= start && span.end >= end)) continue;
      return false;
    }
    return this.clauses.complete();
  }
}
const word = lawWord;
function quantityAxis(name: string, syntax: readonly string[] = []): LawAxisMeaning {
  return {symbol:name,operation:"quantity",syntax:[esc(name),...syntax]};
}
function agreeingAxes(question: string, pattern: RegExp): RegExpMatchArray[] | null {
  const all = [...question.matchAll(new RegExp(pattern.source,pattern.flags.replace(/[gyd]/g,"")+"gd"))];
  if (!all.length) return null;
  const key = (match: RegExpMatchArray) => match.slice(1).map(value=>value?.replace(/\s/g,"").replace(/₁₀/g,"10")).join("|");
  return all.every(match=>key(match)===key(all[0]!)) ? all : null;
}
function sourceIdentity(formula: string): string | null {
  const parsed = parseFormula(formula);
  return parsed ? `${parsed.atoms.map(atom=>`${atom.symbol}:${atom.count}`).sort().join("|")}/${parsed.charge}` : null;
}

/** A charge-balanced candidate is not automatically a supported monatomic
 * solution ion. Ag(I) is explicit domain data; alkali facts reuse ionicAccount. */
function supportedSolutionCation(symbol: string, charge: number): boolean {
  const parsed = parseFormula(`${symbol}^(${charge}+)`);
  if (!parsed || parsed.charge !== charge || parsed.atoms.length !== 1 || parsed.atoms[0]!.count !== 1) return false;
  const alkali = ionicAccount(`${symbol}Cl`);
  return (alkali?.cation.symbol === symbol && alkali.cation.group === 1 && alkali.cationCharge === charge)
    || (symbol === "Ag" && charge === 1); // Silver(I), not a transition-metal default.
}
function supportedCommonIons(solidText: string, donorText: string): { cation: { symbol: string; charge: number }; anion: { symbol: string; charge: number } } | null {
  const solid = parseFormula(solidText), donor = ionicAccount(donorText);
  if (!solid || !donor || donor.cation.group !== 1 || donor.cation.block !== "s"
    || donor.anion.group !== 17 || donor.cationCount !== 1 || donor.anionCount !== 1 || donor.anionCharge !== -1
    || solid.charge !== 0 || solid.atoms.length !== 2 || solid.atoms.some(atom => atom.count !== 1)) return null;
  const anion = solid.atoms.find(atom => atom.symbol === donor.anion.symbol);
  const cation = solid.atoms.find(atom => atom.symbol !== donor.anion.symbol);
  if (!anion || !cation) return null;
  const charge = -donor.anionCharge * anion.count / cation.count;
  if (!Number.isInteger(charge) || !supportedSolutionCation(cation.symbol, charge)) return null;
  const ion = parseFormula(`${anion.symbol}^(${Math.abs(donor.anionCharge)}-)`);
  if (!ion || ion.charge !== donor.anionCharge || ion.atoms.length !== 1 || ion.atoms[0]!.count !== 1) return null;
  return { cation: { symbol: cation.symbol, charge }, anion: { symbol: anion.symbol, charge: donor.anionCharge } };
}

function base(question: string, family: SourceLawFamily, relationSource: LawSource, inputs: SourceOperands, x: LawAxis, y: LawAxis, relation: SourceLawRelation): SourceLawGraph {
  return {version:"chemistry-source-law-graph/v1",question,family,relationSource,bindings:inputs.bindings,x,y,curves:[{id:"law_curve",label:y.symbol,relation,domain:[...x.domain]}],points:[],notes:[]};
}
function domain(question: string, inputs: SourceOperands, x: string): [number,number] | null {
  const bound = one(question,new RegExp(`(${scalar})\\s*(?:<=|≤)\\s*${esc(x)}\\s*(?:<=|≤)\\s*(${scalar})`));
  if (bound) {
    const a = inputs.number(bound,1,"domain lower"), b = inputs.number(bound,2,"domain upper");
    if (a === null || b === null || !(b > a)) return null;
    inputs.statement(bound,"domain");
    return [a,b];
  }
  const range = one(question,new RegExp(`\\bfrom\\s+${esc(x)}\\s*=\\s*(${scalar})\\s+to\\s+(${scalar})`));
  if (!range) return null;
  const a = inputs.number(range,1,"domain lower"), b = inputs.number(range,2,"domain upper");
  if (a === null || b === null || !(b > a)) return null;
  inputs.statement(range,"domain");
  return [a,b];
}
function list(question: string, inputs: SourceOperands, name: string): { values: number[]; span: ChemistrySpan } | null {
  const found = one(question,new RegExp(`\\b${esc(name)}\\s*=\\s*((?:${scalar})(?:\\s*,\\s*(?:and\\s+)?(?:${scalar})){1,15})\\s+(mol\\s+L\\^-1|mol/L|M)\\b`));
  if (!found) return null;
  const values: number[] = [];
  const sequence = found[1]!, start = spanOf(found,1).start;
  for (const match of sequence.matchAll(new RegExp(scalar,"gd"))) {
    // Keep original-question offsets, including the independently closed shared unit.
    const absolute = { ...match, indices: [[start+match.index!,start+match.index!+match[0].length],[start+match.index!,start+match.index!+match[0].length],found.indices![2]!] } as unknown as RegExpMatchArray;
    const value = inputs.operand(absolute,1,2,`${name} domain datum`,"concentration","mol/L");
    if (value === null || value < 0) return null;
    values.push(value);
  }
  inputs.own(spanOf(found,0));
  inputs.statement(found,"domain");
  return values.length >= 2 && new Set(values).size === values.length ? {values,span:spanOf(found,0)} : null;
}

/** Relation-based claim only. It does not consult species, chapter, or gold IDs. */
export function claimsSourceLawGraph(question: string, family: SourceLawFamily): boolean {
  if (!/\b(?:plot|draw|sketch)\b/i.test(question)) return false;
  if (family === "chem_orbital") return /\b(?:photoelectron|photoelectric)\b/i.test(question) && /\benergy\b[^.]{0,40}\b(?:against|versus)\b[^.]{0,60}\bfrequency\b/i.test(question);
  if (family === "chem_electrochem") return /\blog(?:10|₁₀)\s*Q\b/i.test(question) && /\bversus\b|\bagainst\b/i.test(question);
  return (/\bmole fraction\b/i.test(question) && new RegExp(`\\b${symbol}\\s*=\\s*${symbol}\\s+${symbol}\\b`).test(question))
    || /\bmolar solubility\b|\bspecies fractions\b|\bpH\b[^.]*\blog(?:10|₁₀)\s*\(/i.test(question);
}
export function readSourceLawGraph(question: string, family: SourceLawFamily): SourceLawRead {
  if (!claimsSourceLawGraph(question,family)) return {state:"unclaimed"};
  const readers = family === "chem_orbital" ? [threshold] : family === "chem_electrochem" ? [potential]
    : [product,complements,negativeLog,proportional];
  for (const read of readers) {
    const inputs = new SourceOperands(question), model = read(question,inputs);
    if (model && inputs.complete()) return {state:"valid",model};
  }
  return {state:"declined"};
}

function proportional(question: string, inputs: SourceOperands): SourceLawGraph | null {
  const eq = one(question,new RegExp(`\\b(${symbol})\\s*=\\s*(${symbol})\\s+(${symbol})\\b`));
  if (!eq) return null;
  const [y,k,x] = [eq[1]!,eq[2]!,eq[3]!];
  if (new Set([x,y,k]).size !== 3 || !/mole fraction/i.test(question)) return null;
  const constant = one(question,new RegExp(`\\b${esc(k)}\\s*=\\s*(${scalar})`));
  const mark = one(question,new RegExp(`\\b${esc(y)}\\s*=\\s*(${scalar})`));
  if (!constant || !mark) return null;
  const slope = inputs.literal(constant,1,k,"pressure","bar");
  const marked = inputs.literal(mark,1,`${y} marked given`,"pressure","bar");
  const range = domain(question,inputs,x);
  if (slope === null || marked === null || !(slope > 0) || !(marked >= 0) || !range || range[0] < 0 || range[1] > 1 || marked/slope < range[0] || marked/slope > range[1]) return null;
  const xAxis = quantityAxis(x,[`${word("dissolved")}\\s+${word("mole fraction")}\\s+${esc(x)}`,`${word("mole fraction")}\\s+${esc(x)}`]);
  const yAxis = quantityAxis(y,[`${word("pressure")}\\s+${esc(y)}`]);
  if (!inputs.clauses.graph(yAxis,xAxis) || !inputs.axes(xAxis,yAxis)) return null;
  inputs.statement(eq,"relation"); inputs.statement(constant,"declaration"); inputs.statement(mark,"declaration");
  // Unit suffixes are parsed by the shared literal reader, not by a text mask.
  for (const given of [constant,mark]) {
    const binding = inputs.bindings.find(value=>value.scalarSource.span.start===spanOf(given,1).start)!;
    inputs.clauses.bind({start:spanOf(given,0).start,end:binding.unitSource!.span.end},"declaration");
  }
  // A formal model identifier is one capital symbol with an optional
  // subscript, not an arbitrary prose word. Its governing clause must attach
  // to this exact supplied relation; gas and variable subscripts need not match.
  const subject = one(question,new RegExp(`${word("for")}\\s+(?:${word("a")}\\s+)?${word("hypothetical gas")}\\s+([A-Z](?:_[A-Za-z]+)?)\\s+${word("obeying")}\\s+`));
  if (!subject || spanOf(subject,0).end!==spanOf(eq,0).start
    || !inputs.syntax(`${word("assume")}\\s+(?:${word("a")}\\s+)?${word("dilute solution")}\\s+${word("and")}\\s+${word("ideal gas")}`)) return null;
  inputs.statement(subject,"context");
  inputs.request(`${word("mark")}\\s+(?:${word("the")}\\s+)?${word("point for")}\\s+${esc(y)}\\s*=\\s*${scalar}\\s*(?:bar|atm|kPa|Pa)`);
  const model = base(question,"chem_solutions",source(question,spanOf(eq,0)),inputs,
    {symbol:x,label:`${x} / 1`,unit:"1",domain:range,transform:"linear"},
    {symbol:y,label:`${y} / bar`,unit:"bar",domain:[0,slope*range[1]],transform:"linear"},
    {operator:"affine",slope,intercept:0});
  model.points = [range[0],marked/slope,range[1]].map(xValue=>({curveId:"law_curve",x:xValue,y:slope*xValue}));
  inputs.bindings.find(binding=>binding.role===k)!.symbol=k;
  model.notes.push(`${k} = ${slope} bar; line slope in pressure per mole fraction.`);
  return model;
}
function threshold(question: string, inputs: SourceOperands): SourceLawGraph | null {
  const eq = one(question,/\b(K_?max)\s*=\s*h\s*ν\s*[-−]\s*φ/);
  const phiGiven = one(question,new RegExp(`\\bwork function\\s+(${scalar})`,"i"));
  const action = one(question,new RegExp(`\\bh\\s*=\\s*(${scalar})`));
  const range = one(question,new RegExp(`\\bover\\s+(${scalar})\\s+to\\s+(${scalar})\\s*(Hz)\\b`));
  if (!eq || !phiGiven || !action || !range) return null;
  const phi = inputs.literal(phiGiven,1,"work function","energy","eV");
  const h = inputs.literal(action,1,"action coefficient","action","eV s");
  const lo = inputs.operand(range,1,3,"frequency domain lower","frequency","Hz"), hi = inputs.literal(range,2,"frequency domain upper","frequency","Hz");
  if (phi === null || h === null || lo === null || hi === null || !(phi > 0 && h > 0 && lo >= 0 && hi > lo)) return null;
  const threshold = phi/h;
  if (!(threshold >= lo && threshold < hi) || !/no (?:photoelectron )?emission/i.test(question)) return null;
  const xAxis = quantityAxis("ν",[`${word("incident")}[- ]${word("light frequency")}`,`${word("frequency")}\\s+ν`]);
  const yAxis = quantityAxis(eq[1]!,[word("maximum photoelectron kinetic energy")]);
  if (!inputs.clauses.graph(yAxis,xAxis) || !inputs.axes(xAxis,yAxis)) return null;
  inputs.statement(eq,"relation");
  const hBinding = inputs.bindings.find(binding=>binding.role==="action coefficient")!;
  inputs.clauses.bind({start:spanOf(action,0).start,end:hBinding.unitSource!.span.end},"declaration");
  const phiBinding = inputs.bindings.find(binding=>binding.role==="work function")!;
  const surface = one(question,new RegExp(`${word("for")}\\s+(?:${word("a")}\\s+)?${word("metal with work function")}\\s+${scalar}\\s*(?:eV|kJ|J)`));
  if (!surface || spanOf(surface,0).end!==phiBinding.unitSource!.span.end) return null;
  inputs.statement(surface,"context"); inputs.statement(range,"domain");
  inputs.request(`${word("mark")}\\s+(?:${word("the")}\\s+)?${word("threshold and")}\\s+(?:${word("the")}\\s+)?${word("region with no")}\\s+(?:${word("photoelectron")}\\s+)?${word("emission")}`);
  const model = base(question,"chem_orbital",source(question,spanOf(eq,0)),inputs,
    {symbol:"ν",label:"frequency ν / Hz",unit:"Hz",domain:[lo,hi],transform:"linear"},
    {symbol:eq[1]!,label:`${eq[1]} / eV`,unit:"eV",domain:[0,h*hi-phi],transform:"linear"},
    {operator:"threshold_affine",slope:h,intercept:-phi});
  model.curves[0]!.domain = [threshold,hi];
  model.regions = threshold > lo ? [{domain:[lo,threshold],label:"no emission",meaning:"no_emission"}] : [];
  model.points = [threshold,threshold+(hi-threshold)/2,hi].map((x,index)=>({curveId:"law_curve",x,y:index===0?0:h*x-phi}));
  inputs.bindings.find(binding=>binding.role==="work function")!.symbol="φ";
  inputs.bindings.find(binding=>binding.role==="action coefficient")!.symbol="h";
  model.notes.push(`ν < ${threshold} Hz: no photoelectrons`, `φ = ${phi} eV; slope h = ${h} eV s`);
  return model;
}
function product(question: string, inputs: SourceOperands): SourceLawGraph | null {
  const eq = one(question,new RegExp(`\\b(${symbol})\\s*\\(\\s*(${symbol})\\s*\\+\\s*\\1\\s*\\)\\s*=\\s*(${symbol})\\b`));
  if (!eq) return null;
  const [y,x,k] = [eq[1]!,eq[2]!,eq[3]!];
  const constant = one(question,new RegExp(`\\b${esc(k)}\\s*=\\s*(${scalar})\\s*\\((mol\\s+L\\^-1|mol/L)\\)\\^2`));
  const values = list(question,inputs,x);
  if (!constant || !values || !/activities as concentrations/i.test(question) || !/keep solid\b[^.]*present/i.test(question)) return null;
  const K = inputs.operand(constant,1,2,k,"concentration","mol/L",2);
  if (K === null || !(K > 0)) return null;
  inputs.bindings.find(binding=>binding.role===k)!.unitSource=source(question,{start:spanOf(constant,2).start-1,end:spanOf(constant,0).end});
  inputs.own(spanOf(constant,0)); inputs.own(spanOf(eq,0));
  for (const repeat of question.matchAll(new RegExp(`\\b${esc(x)}\\s*=\\s*(${scalar})`,"gd"))) {
    if (inputs.owned.some(span=>span.start<=repeat.index! && span.end>=repeat.index!+repeat[0].length)) continue;
    const value = inputs.number(repeat,1,`${x} repeated datum`);
    if (value === null || !values.values.includes(value)) return null;
  }
  const positive = values.values.filter(x=>x>0).sort((a,b)=>a-b);
  if (positive.length < 2) return null;
  const formulaSyntax = String.raw`(?:[A-Z][a-z]?\d*)+(?:\^?\(?\d*[+-]\)?)?`;
  const equilibrated = one(question,new RegExp(`${word("excess solid")}\\s+(${formulaSyntax})\\s+${word("is equilibrated")}`));
  const initial = one(question,new RegExp(`${word("with solutions containing")}\\s+(?:${word("an")}\\s+)?${word("initial")}\\s+(${formulaSyntax})\\s+${word("concentration")}\\s+(${symbol})`));
  const requested = one(question,new RegExp(`${word("molar solubility")}\\s+(${symbol})\\s+${word("of")}\\s+(${formulaSyntax})`));
  const kept = one(question,new RegExp(`${word("keep solid")}\\s+(${formulaSyntax})\\s+${word("present")}`));
  if (!equilibrated || !initial || !requested || !kept || initial[2]!==x || requested[1]!==y) return null;
  const solid = parseFormula(equilibrated[1]!), donor = parseFormula(initial[1]!);
  if (!solid || !donor || sourceIdentity(equilibrated[1]!)!==sourceIdentity(requested[2]!)
    || sourceIdentity(equilibrated[1]!)!==sourceIdentity(kept[1]!)) return null;
  // Conditional on the explicit supplied concentration-equilibrium model:
  // this is unit stoichiometry, never a general inference of ionic bonding.
  if ([solid,donor].some(formula=>formula.charge!==0 || formula.atoms.length!==2 || formula.atoms.some(atom=>atom.count!==1))
    || solid.atoms.filter(atom=>donor.atoms.some(other=>other.symbol===atom.symbol)).length!==1) return null;
  const ions = supportedCommonIons(equilibrated[1]!,initial[1]!);
  if (!ions) return null;
  for (const [match,group] of [[equilibrated,1],[initial,1],[requested,2],[kept,1]] as const) inputs.own(spanOf(match,group));
  for (const match of [equilibrated,initial,kept]) inputs.statement(match,"context");
  inputs.statement(constant,"declaration"); inputs.statement(eq,"relation");
  if (!inputs.syntax(word("in the concentration convention"))
    || !inputs.syntax(word("treat activities as concentrations"))
    || !inputs.syntax(word("ignore complex formation and all other reactions"))) return null;
  const xAxis = quantityAxis(x), yAxis = quantityAxis(y,[`${word("molar solubility")}\\s+${esc(y)}\\s+${word("of")}\\s+${esc(requested[2]!)}`]);
  if (!inputs.clauses.graph(yAxis,xAxis) || !inputs.axes(xAxis,yAxis)) return null;
  inputs.syntax(word("choose linear or logarithmic axes that display the trend"));
  inputs.syntax(`${word("on logarithmic")}\\s+${esc(x)}\\s+${word("axes")}`);
  inputs.request(`${word("show")}\\s+${esc(x)}\\s*=\\s*0\\s+${word("separately")}`);
  const value = (C: number) => 2*K/(Math.sqrt(C*C+4*K)+C);
  const lo = positive[0]!, hi = positive[positive.length-1]!;
  const model = base(question,"chem_solutions",source(question,spanOf(eq,0)),inputs,
    {symbol:x,label:`${x}/M (log10)`,unit:"mol/L",domain:[lo,hi],transform:"log10"},
    {symbol:y,label:`${y}/M (log10)`,unit:"mol/L",domain:[value(hi),value(lo)],transform:"log10"},
    {operator:"positive_quadratic",product:K});
  const convention = one(question,new RegExp(word("in the concentration convention")));
  const activities = one(question,new RegExp(word("treat activities as concentrations")));
  const excluded = one(question,new RegExp(word("ignore complex formation and all other reactions")));
  if (!convention || !activities || !excluded) return null;
  model.chemicalContext = { kind: "solubility_equilibrium", solid: source(question,spanOf(equilibrated,1)),
    donor: source(question,spanOf(initial,1)), retained: source(question,spanOf(kept,1)),
    solubility: source(question,spanOf(requested,1)), concentration: source(question,spanOf(initial,2)),
    suppliedRelation: source(question,spanOf(eq,0)), ...ions,
    assumptions: { concentrationConvention: source(question,spanOf(convention,0)), activities: source(question,spanOf(activities,0)), excludedReactions: source(question,spanOf(excluded,0)) } };
  model.points = values.values.map(x=>({curveId:"law_curve",x,y:value(x),...(x===0?{detached:true}:{})}));
  inputs.bindings.find(binding=>binding.role===k)!.symbol=k;
  model.notes.push(`Positive root; total common-ion concentration is ${x}+${y}.`, `Excess ${equilibrated[1]} retained; supplied concentration-equilibrium model.`, "Zero datum is separate from logarithmic axes.");
  return model;
}
function negativeLog(question: string, inputs: SourceOperands): SourceLawGraph | null {
  const eq = one(question,/\bpH\s*=\s*[-−]\s*log(?:10|₁₀)\s*\(\s*\[H(?:\^)?\+\]\s*\/\s*\(mol\s+L\^-1\)\s*\)/);
  const axisDeclarations = agreeingAxes(question,/\blog(?:10|₁₀)\s*\(\s*([A-Za-z])\s*\/\s*\(mol\s+L\^-1\)\s*\)/);
  const axis = axisDeclarations?.[0];
  const acid = one(question,/\bfully ioni[sz]ed aqueous (H[A-Z][A-Za-z0-9]*)\b/i);
  const formula = acid ? parseFormula(acid[1]!) : null;
  if (!eq || !axis || !formula || formula.charge !== 0 || formula.atoms[0]?.symbol !== "H" || formula.atoms[0]?.count !== 1
    || formula.atoms.slice(1).some(atom=>atom.element.block !== "p") || !/neglect water self[- ]ionisation over this range/i.test(question)) return null;
  inputs.own(spanOf(acid!,0));
  const x = axis[1]!; const values = list(question,inputs,x);
  if (!values || values.values.some(x=>x<=0)) return null;
  const xs = values.values.map(Math.log10); const lo = Math.min(...xs), hi = Math.max(...xs);
  if (!(lo < hi && lo >= -6 && hi <= 0)) return null;
  const xAxis: LawAxisMeaning = {symbol:x,operation:"log10",syntax:[`log(?:10|₁₀)\\s*\\(\\s*${esc(x)}\\s*/\\s*\\(mol\\s+L\\^-1\\)\\s*\\)`]};
  const acidDescription = `${word("ideal fully")}\\s+${word("ionised").replace("[sS]","[sSzZ]")}\\s+${word("aqueous")}\\s+${esc(acid![1]!)}`;
  const yAxis = quantityAxis("pH",[`pH\\s+${word("of")}\\s+${acidDescription}`]);
  if (!inputs.clauses.graph(yAxis,xAxis) || !inputs.axes(xAxis,yAxis)) return null;
  if (!inputs.syntax(word("neglect water self-ionisation over this range"))) return null;
  inputs.own(spanOf(eq,0)); inputs.statement(eq,"relation");
  for (const declared of axisDeclarations!) inputs.own(spanOf(declared,0));
  const model = base(question,"chem_solutions",source(question,spanOf(eq,0)),inputs,
    {symbol:`log10(${x}/(mol L^-1))`,label:`log10(${x}/M)`,unit:"1",domain:[lo,hi],transform:"linear"},
    {symbol:"pH",label:"pH / 1",unit:"1",domain:[-hi,-lo],transform:"linear"},
    {operator:"log_coordinate",slope:-1,intercept:0});
  const ionisation = one(question,new RegExp(acidDescription));
  const water = one(question,new RegExp(word("neglect water self-ionisation over this range")));
  if (!ionisation || !water) return null;
  model.chemicalContext = { kind: "ideal_monoprotic_acid", acid: source(question,spanOf(acid!,1)), concentration: source(question,spanOf(axis,1)),
    ionisation: source(question,spanOf(ionisation,0)), waterNeglect: source(question,spanOf(water,0)),
    suppliedRelation: source(question,spanOf(eq,0)), derivedBalance: "one_proton_per_formula_unit" };
  model.points = xs.map(x=>({curveId:"law_curve",x,y:-x}));
  model.notes.push(`Fully ionised ${acid![1]}: [H+] = ${x}; water self-ionisation neglected only over supplied range.`);
  return model;
}
function complements(question: string, inputs: SourceOperands): SourceLawGraph | null {
  const eq = one(question,/\[([A-Za-z]+(?:\^)?-)\]\s*\/\s*\[([A-Za-z]+)\]\s*=\s*10\^\(pH\s*[-−]\s*([\d.]+)\)/);
  const pK = one(question,new RegExp(`\\bpK_?a\\s*=\\s*(${scalar})`));
  const total = one(question,new RegExp(String.raw`\[([A-Za-z]+)\]\s*\+\s*\[([A-Za-z]+(?:\^)?-)\]\s*=\s*(${scalar})`));
  const range = one(question,new RegExp(`\\bfrom pH\\s+(${scalar})\\s+to\\s+(${scalar})`));
  if (!eq || !pK || !total || !range || !/pH as externally set/i.test(question) || eq[1]!==total[2] || eq[2]!==total[1]) return null;
  const pKa = inputs.number(pK,1,"pKa"), amount = inputs.literal(total,3,"total species concentration","concentration","mol/L");
  const lo = inputs.number(range,1,"pH domain lower"), hi = inputs.number(range,2,"pH domain upper");
  if (pKa === null || amount === null || lo === null || hi === null || !(amount > 0 && lo < pKa && pKa < hi && hi-lo <= 12)) return null;
  // This is a closed source relation, evaluated by the existing expression AST;
  // it cannot be relaxed into a standalone scalar-prefix read.
  const expression = `10^(x-${eq[3]})`;
  try { if (Math.abs(parseMathExpression(expression).evaluate(pKa)-1)>1e-10) return null; } catch { return null; }
  const header = one(question,new RegExp(`${word("for")}\\s+(?:${word("an")}\\s+)?${word("ideal")}\\s+(${symbol})\\s*/\\s*(${symbol}(?:\\^)?-)\\s+${word("system")}`));
  if (!header || header[1]!==eq[2] || header[2]!==eq[1]) return null;
  const xAxis = quantityAxis("pH"), yAxis: LawAxisMeaning = {symbol:"fraction",operation:"fraction",syntax:[`(?:${word("two")}\\s+)?(?:${word("equilibrium")}\\s+)?${word("species fraction")}s?`]};
  if (!inputs.clauses.graph(yAxis) || !inputs.axes(xAxis,yAxis)) return null;
  inputs.statement(header,"context"); inputs.statement(pK,"declaration"); inputs.statement(range,"domain");
  const totalBinding = inputs.bindings.find(binding=>binding.role==="total species concentration")!;
  inputs.clauses.bind({start:spanOf(total,0).start,end:totalBinding.unitSource!.span.end},"declaration");
  if (!inputs.syntax(word("treat pH as externally set"))) return null;
  inputs.request(`${word("mark where")}\\s+(?:${word("the")}\\s+)?${word("curves cross")}`);
  inputs.own(spanOf(eq,0)); inputs.statement(eq,"relation");
  const model = base(question,"chem_solutions",source(question,spanOf(eq,0)),inputs,
    {symbol:"pH",label:"pH / 1",unit:"1",domain:[lo,hi],transform:"linear"},
    {symbol:"species fraction",label:"fraction / 1",unit:"1",domain:[0,1],transform:"linear"},
    {operator:"ratio_complements",pK:pKa,complement:false});
  model.curves[0]!.label = `f_${eq[1]}`;
  model.curves.push({id:"complement_curve",label:`f_${eq[2]}`,relation:{operator:"ratio_complements",pK:pKa,complement:true},domain:[lo,hi]});
  for (const x of [lo,pKa,hi]) for (const curve of model.curves) {
    const r = 10**(x-pKa), y = curve.id === "law_curve" ? r/(1+r) : 1/(1+r);
    model.points.push({curveId:curve.id,x,y});
  }
  inputs.bindings.find(binding=>binding.role==="pKa")!.symbol="pKa";
  model.notes.push(`Fractions sum to 1; at pH ${pKa} each species concentration is ${amount/2} mol/L.`);
  return model;
}
function potential(question: string, inputs: SourceOperands): SourceLawGraph | null {
  const eq = one(question,new RegExp(`\\b(${symbol})\\s*=\\s*(${symbol})\\s*[-−]\\s*\\((${scalar})\\s+(V)\\s*/\\s*(${symbol})\\)\\s*log(?:10|₁₀)\\s*Q\\b`));
  const aliases = agreeingAxes(question,new RegExp(`\\b(${symbol})\\s*=\\s*log(?:10|₁₀)\\s*Q\\b`));
  const xAlias = aliases?.[0];
  if (!eq || !xAlias) return null;
  const E = one(question,new RegExp(`${esc(eq[2]!)}\\s*=\\s*(${scalar})`));
  const n = one(question,new RegExp(`\\b${esc(eq[5]!)}\\s*=\\s*(${scalar})`));
  if (!E || !n) return null;
  const intercept = inputs.literal(E,1,"standard potential","potential","V");
  const coefficient = inputs.operand(eq,3,4,"log potential coefficient","potential","V");
  const count = inputs.number(n,1,"electron count"); const range = domain(question,inputs,xAlias[1]!);
  if (intercept === null || coefficient === null || count === null || !range || !(coefficient > 0 && count > 0 && Number.isInteger(count))) return null;
  inputs.own(spanOf(eq,0)); inputs.own(spanOf(xAlias,0));
  // Q must be explicitly dimensionless. The complete supplied quotient is
  // retained in the source proof; no silent reciprocal is constructed.
  const q = one(question,/\bQ\s*=\s*a\(([A-Z][A-Za-z]*\^?\d*\+)\)\s*\/\s*a\(([A-Z][A-Za-z]*\^?\d*\+)\)/);
  const standard = one(question,new RegExp(`\\bdivided by\\s+(${scalar})\\s+mol\\s+L\\^-1`));
  const solids = one(question,new RegExp(`\\bpure solids activity\\s+(${scalar})`));
  if (!q || !standard || !solids || !/activity by its concentration/i.test(question)) return null;
  const standardValue = inputs.literal(standard,1,"activity reference concentration","concentration","mol/L");
  const solidsValue = inputs.number(solids,1,"pure solid activity");
  if (standardValue !== 1 || solidsValue !== 1) return null;
  const reaction = one(question,/\b([A-Z][a-z]?)\(s\)\s*\+\s*([A-Z][a-z]?)\^(\d+)\+\(aq\)\s*(?:->|→)\s*([A-Z][a-z]?)\^(\d+)\+\(aq\)\s*\+\s*([A-Z][a-z]?)\(s\)/);
  if (!reaction || reaction[1]!==reaction[4] || reaction[2]!==reaction[6]
    || Number(reaction[3])!==count || Number(reaction[5])!==count
    || q[1]!==`${reaction[4]}^${reaction[5]}+` || q[2]!==`${reaction[2]}^${reaction[3]}+`) return null;
  inputs.own(spanOf(q,0)); inputs.own(spanOf(reaction,0));
  // Mark requests in this same variable are source-owned domain samples.
  const marks = one(question,new RegExp(`\\bMark\\s+${esc(xAlias[1]!)}\\s*=\\s*(${scalar})\\s*,\\s*(${scalar})\\s+and\\s+(${scalar})`,"i"));
  if (!marks) return null;
  const xs = [1,2,3].map(group=>inputs.number(marks,group,"marked log quotient"));
  if (xs.some(x=>x===null || x<range[0] || x>range[1])) return null;
  const logarithm = `log(?:10|₁₀)\\s*Q`;
  const xAxis: LawAxisMeaning = {symbol:"Q",operation:"log10",syntax:[esc(xAlias[1]!),logarithm,`${esc(xAlias[1]!)}\\s*=\\s*${logarithm}`]};
  const yAxis = quantityAxis(eq[1]!);
  if (!inputs.clauses.graph(yAxis,xAxis) || !inputs.axes(xAxis,yAxis)) return null;
  for (const alias of aliases!) { inputs.own(spanOf(alias,0)); inputs.statement(alias,"relation"); }
  inputs.statement(eq,"relation"); inputs.statement(n,"declaration");
  const potentialBinding = inputs.bindings.find(binding=>binding.role==="standard potential")!;
  inputs.clauses.bind({start:spanOf(E,0).start,end:potentialBinding.unitSource!.span.end},"declaration");
  inputs.statement(q,"relation"); inputs.statement(reaction,"reaction");
  if ([reaction[1],reaction[2],reaction[4],reaction[6]].some(element=>!parseFormula(element!))) return null;
  if (!inputs.syntax(`${word("approximate each activity by its concentration divided by")}\\s+${scalar}\\s+mol\\s+L\\^-1`)
    || !inputs.syntax(`${word("give pure solids activity")}\\s+${scalar}`)) return null;
  inputs.statement(marks,"mark");
  inputs.request(word("explain the slope"));
  const slope = -coefficient/count, ys = range.map(x=>intercept+slope*x);
  const model = base(question,"chem_electrochem",source(question,spanOf(eq,0)),inputs,
    {symbol:xAlias[1]!,label:`${xAlias[1]}=log10 Q / 1`,unit:"1",domain:range,transform:"linear"},
    {symbol:eq[1]!,label:`${eq[1]} / V`,unit:"V",domain:[Math.min(...ys),Math.max(...ys)],transform:"linear"},
    {operator:"affine",slope,intercept});
  model.points = xs.map(x=>({curveId:"law_curve",x:x!,y:intercept+slope*x!}));
  inputs.bindings.find(binding=>binding.role==="standard potential")!.symbol=eq[2];
  inputs.bindings.find(binding=>binding.role==="electron count")!.symbol=eq[5];
  model.notes.push(`Slope = ${slope} V per unit ${xAlias[1]}; ${q[0]}. Activities are dimensionless.`);
  return model;
}
