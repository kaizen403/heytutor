import { expressionToSafeSource, type ProblemFact, type ProblemIR } from "./problemIR";
import { sourceUnquotedText } from "../document/sourceRequestScope";
import type { MechanicsProgramInput, MechanicsProgramStep } from "./mechanicsProgram";
import { parseMathExpression } from "../math/expression";
import { exactBinary64 } from "../math/exactBinary64";
import { compareRational, deserializeRational, multiplyRational, parseRational, rational, type Rational } from "../math/exactRational";
import { parseLinearAffine } from "../math/linearRegion";
import { mechanicsUnitFactor } from "../compile/mechanicsGeometry";

export interface MechanicsSourceCase {
  index: number;
  start: number;
  end: number;
  text: string;
}
export interface MechanicsSourceRead {
  path: string;
  factId: string;
  ownerLabel: string;
  modelOwnerLabel: string;
  role: string;
  dimension: string;
  roleSource: RegExp;
  sourceExpression: string;
  sourceUnit: string;
  unit: string;
  component?: number;
  variable?: string;
  variableUnit?: string;
  intervalComponent?: "start" | "end" | "duration";
  value: unknown;
}

export interface MechanicsFunctionalEpochContext {
  step: MechanicsProgramStep;
  inputs: ReadonlyMap<string, MechanicsProgramInput>;
  sourceReads: readonly MechanicsSourceRead[];
  requested: readonly ProblemFact[];
  sourceCase: MechanicsSourceCase | null;
  observable: string;
  law: { readonly expression: string; readonly at: number; readonly timeScale: number } | null;
}

function binaryRational(value: number): Rational {
  const exact = exactBinary64(value);
  return exact.power >= 0 ? rational(exact.n << BigInt(exact.power)) : rational(exact.n, 1n << BigInt(-exact.power));
}
function exactClockConstant(source: string): Rational {
  let affine: ReturnType<typeof parseLinearAffine> | undefined;
  try { affine = parseLinearAffine(source); } catch { /* Constant functions and powers keep the existing certified parser. */ }
  if (affine) {
    if (affine.a.numerator !== "0" || affine.b.numerator !== "0") fail("bare functional epoch requires a source-independent exact clock value");
    return deserializeRational(affine.constant);
  }
  const parsed = parseMathExpression(source);
  if (/\b[xy]\b/.test(parsed.source)) fail("bare functional epoch cannot sample a free clock variable");
  const value = parsed.certifiedJetAt(0);
  if (value.errorBounds.value !== 0) fail("bare functional epoch clock requires a proved exact rational identity");
  return binaryRational(value.value);
}
function exactSuppliedClock(input: MechanicsProgramInput): Rational {
  if (input.component !== undefined) fail("bare functional epoch requires a scalar source-clock instant");
  if (input.intervalComponent === undefined) return exactClockConstant(input.sourceExpression);
  if (input.intervalComponent !== "start" && input.intervalComponent !== "end") fail("bare functional epoch requires an explicitly source-bound clock instant");
  const interval = new RegExp(`^\\s*(${NUMBER})\\s*(?:-|–|to)\\s*(${NUMBER})\\s*$`).exec(input.sourceExpression)
    ?? new RegExp(`^\\s*(${NUMBER})\\s*<=\\s*[A-Za-z][A-Za-z0-9_]*\\s*<=\\s*(${NUMBER})\\s*$`).exec(input.sourceExpression);
  if (!interval) fail("bare functional epoch requires the original exact source interval");
  const start = parseRational(interval[1]!), end = parseRational(interval[2]!);
  if (compareRational(start, end) >= 0) fail("bare functional epoch source interval must be strictly increasing");
  return input.intervalComponent === "start" ? start : end;
}

/** Functional epochs match the exact source clock before any floating conversion. */
export function mechanicsFunctionalEpochSI(problem: ProblemIR, epoch: string, context: MechanicsFunctionalEpochContext): number | null {
  const argument = new RegExp(`^(${NUMBER})(milliseconds?|seconds?|ms|s)?$`).exec(epoch);
  if (!argument || !["theta", "omega", "alpha"].includes(context.observable) || !context.law) return null;
  const { step, inputs, sourceReads, law } = context;
  const rawLaw = step.inputs.angularLaw;
  if (!["axial_rotation", "rigid_body_motion"].includes(step.operator) || !rawLaw || typeof rawLaw !== "object" || Array.isArray(rawLaw)) return null;
  const declaration = rawLaw as Record<string, unknown>;
  const functionInput = typeof declaration.expression === "string" ? inputs.get(declaration.expression) : undefined;
  const clockInput = typeof declaration.at === "string" ? inputs.get(declaration.at) : undefined;
  if (!functionInput || !clockInput || !functionInput.variable || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(functionInput.variable) || ["pi", "e", "sin", "cos", "tan", "sqrt", "exp", "ln", "log"].includes(functionInput.variable)
    || !["s", "ms"].includes(functionInput.variableUnit ?? "") || functionInput.variableUnit !== declaration.timeUnit || functionInput.unit !== declaration.angleUnit || clockInput.variable !== undefined
    || functionInput.ownerId !== step.ownerId || clockInput.ownerId !== step.ownerId || functionInput.axisId !== step.axisId || clockInput.axisId !== undefined && clockInput.axisId !== step.axisId
    || functionInput.component !== undefined || functionInput.intervalComponent !== undefined) fail("bare functional epoch requires its declared same-owner source function, axis and clock");
  const owner = problem.entities.find(entity => entity.id === step.ownerId)?.label;
  const axis = problem.entities.find(entity => entity.id === step.axisId)?.label;
  if (!owner || !axis) fail("bare functional epoch needs its named physical owner and axis");
  const exactFact = (factId: string, kind: ProblemFact["kind"]): ProblemFact => {
    const fact = problem.facts.find(fact => fact.id === factId);
    if (!fact || fact.kind !== kind || typeof fact.evidence?.quote !== "string" || !fact.evidence.quote.trim() || !Number.isInteger(fact.evidence.start) || fact.evidence.start < 0
      || fact.evidence.end !== fact.evidence.start + fact.evidence.quote.length || problem.question.slice(fact.evidence.start, fact.evidence.end) !== fact.evidence.quote) fail("bare functional epoch requires exact original-source facts in their existing roles");
    return fact;
  };
  const functionFact = exactFact(functionInput.factId, "given"), clockFact = exactFact(clockInput.factId, "given");
  const requested = context.requested.map(fact => {
    const original = exactFact(fact.id, "requested");
    if (fact.evidence.start !== original.evidence.start || fact.evidence.end !== original.evidence.end || fact.evidence.quote !== original.evidence.quote) fail("bare functional epoch cannot borrow another requested source quote");
    return original;
  });
  const cases = mechanicsSourceCases(problem.question);
  const selected = context.sourceCase ?? (cases.length === 1 ? cases[0]! : fail("bare functional epoch requires its proved source experiment"));
  const canonical = cases[selected.index];
  if (!canonical || canonical.start !== selected.start || canonical.end !== selected.end || canonical.text !== selected.text) fail("bare functional epoch source case differs from the original question");
  if (![functionFact, clockFact, ...requested].every(fact => fact.evidence.start >= selected.start && fact.evidence.end <= selected.end)) fail("bare functional epoch cannot inherit another experiment's source function or clock");
  if (!requested.some(fact => hasName(fact.evidence.quote, owner) && hasName(fact.evidence.quote, axis)
    && fact.evidence.start <= clockFact.evidence.start && fact.evidence.end >= clockFact.evidence.end)) fail("bare functional epoch requires its binding's own requested owner, axis and source clock");

  const functionExpression = problem.expressions.find(expression => expression.id === functionInput.expressionId);
  const clockExpression = problem.expressions.find(expression => expression.id === clockInput.expressionId);
  if (!functionExpression || functionExpression.valueType !== "function" || !functionExpression.evidenceFactIds.includes(functionInput.factId)
    || !clockExpression || clockExpression.valueType !== "scalar" || !clockExpression.evidenceFactIds.includes(clockInput.factId)) fail("bare functional epoch requires the complete source function and scalar clock ASTs");
  const source = functionInput.sourceExpression.replace(new RegExp(`\\b${functionInput.variable}\\b`, "g"), "x");
  const syntax = parseMathExpression(source).syntaxKey;
  if (parseMathExpression(expressionToSafeSource(functionExpression.root, functionInput.variable)).syntaxKey !== syntax || parseMathExpression(law.expression).syntaxKey !== syntax) fail("bare functional epoch's replayed function differs from the original AST");
  const matchingRead = (read: MechanicsSourceRead, input: MechanicsProgramInput, path: string): boolean => read.path === path && read.factId === input.factId && read.ownerLabel === owner && read.modelOwnerLabel === owner
    && read.sourceExpression === input.sourceExpression && read.unit === input.unit && read.sourceUnit === (input.sourceUnit ?? input.unit) && read.component === input.component && read.intervalComponent === input.intervalComponent;
  const functionReads = sourceReads.filter(read => matchingRead(read, functionInput, "angularLaw.expression"));
  const clockReads = sourceReads.filter(read => matchingRead(read, clockInput, "angularLaw.at"));
  if (!functionReads.length || !clockReads.length || functionReads.some(read => read.role !== "angle" || read.dimension !== "angle" || read.variable !== functionInput.variable || read.variableUnit !== functionInput.variableUnit
    || typeof read.value !== "string" || parseMathExpression(read.value).syntaxKey !== syntax)
    || clockReads.some(read => read.role !== "time" || read.dimension !== "time" || read.variable !== undefined || read.variableUnit !== undefined || typeof read.value !== "number" || !Number.isFinite(read.value))) fail("bare functional epoch requires its matching source-replayed function and clock reads");
  const variableUnit = functionInput.variableUnit === "s" ? "(?:s|seconds?)" : "(?:ms|milliseconds?)";
  const evidence = `${functionFact.evidence.quote}; ${clockFact.evidence.quote}`;
  if (!new RegExp(`\\b${functionInput.variable}(?:\\s+(?:is\\s+)?(?:in|measured\\s+in)\\s+${variableUnit}\\b|\\s*(?:=|<=|<)\\s*[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)\\s*${variableUnit}\\b)`, "i").test(evidence)) fail("bare functional epoch's variable unit must be stated in the original source");
  const variableScale = mechanicsUnitFactor(functionInput.variableUnit!, "time");
  const clockScale = mechanicsUnitFactor(clockInput.unit, "time");
  const clockValue = parseMathExpression(expressionToSafeSource(clockExpression.root)).evaluate(0);
  if (!Number.isFinite(law.at) || !Number.isFinite(law.timeScale) || !(law.timeScale > 0) || law.timeScale !== variableScale || clockScale !== variableScale
    || !Number.isFinite(clockValue) || clockReads.some(read => read.value !== clockValue) || clockValue * clockScale !== law.at) fail("bare functional epoch's native time differs from its source-replayed clock and variable scale");
  // Literal/rational identities are proved before Number or SI conversion.
  // A nearby decimal must not become the supplied clock through binary64 rounding.
  const sourceClock = multiplyRational(exactSuppliedClock(clockInput), parseRational(mechanicsUnitFactor(clockInput.sourceUnit ?? clockInput.unit, "time")));
  const exactClock = exactClockConstant(expressionToSafeSource(clockExpression.root));
  if (compareRational(multiplyRational(exactClock, parseRational(clockScale)), sourceClock) !== 0) fail("bare functional epoch's scalar AST contradicts the exact supplied source time");
  if (compareRational(exactClock, parseRational(clockValue)) !== 0 && compareRational(exactClock, binaryRational(clockValue)) !== 0) fail("bare functional epoch's replayed clock loses its exact source identity");
  const argumentScale = argument[2] ? mechanicsUnitFactor(argument[2], "time") : variableScale;
  if (compareRational(multiplyRational(parseRational(argument[1]!), parseRational(argumentScale)), sourceClock) !== 0) fail("functional epoch differs from the exact source-proved evaluation time");
  // Reuse the native SI clock after exact identity. Equivalent unit spellings
  // cannot introduce another rounding path or change the requested symbol.
  return law.at;
}

function fail(message: string): never { throw new Error(`Mechanics source authority: ${message}`); }
const CASE_START = /(?:^|[.!?;\n])\s*(?:(?:in|for|as)\s+(?:a|an|the)\s+(?:separate|different|independent|new|second|third|fourth|next)\s+(?:comparison|case|state|scenario|experiment)|(?:now\s+)?consider\s+(?:another|a\s+(?:separate|different|new))\s+(?:comparison|case|state|scenario|experiment))\b/gi;
const QUERY = /\b(?:find|calculate|determine|compute|give|report|solve)\b[^.!?;\n]*/gi;

/** Explicit alternative experiments are source scopes, not topic identities. */
export function mechanicsSourceCases(question: string): MechanicsSourceCase[] {
  if (question.length > 16384) fail("source case reading exceeds the original-question bound");
  const starts = [0];
  for (const match of question.matchAll(CASE_START)) {
    const prefix = /^[.!?;\n]?\s*/.exec(match[0])![0].length;
    const start = match.index! + prefix;
    if (start > 0 && !starts.includes(start)) starts.push(start);
  }
  if (starts.length > 32) fail("source alternative experiments exceed32");
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? question.length;
    return { index, start, end, text: question.slice(start, end) };
  });
}

function containingCase(cases: readonly MechanicsSourceCase[], offset: number): MechanicsSourceCase {
  const found = cases.find(source => offset >= source.start && offset < source.end);
  if (!found) fail("source evidence has no original experiment scope");
  return found;
}

function globalConvention(fact: ProblemFact): boolean {
  const text = fact.evidence.quote.trim();
  return /^(?:Use|Take|Choose|Assume)\b/i.test(text)
    && /\b(?:SI\s+units|inertial\s+(?:laboratory\s+)?frame)\b/i.test(text)
    && !/\b(?:mass|radius|length|velocity|speed|force|torque|couple|energy|initially|at\s+rest)\b[^.;!?]*[=\d]/i.test(text)
    && !/[=]\s*[+-]?(?:\d|\.)/.test(text);
}

const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const PAYLOAD = new RegExp(`^\\s*(?:(?:=|:|is|of|by|equals)\\s*)?(\\([^()\\n]+\\)|${NUMBER}(?:\\s*/\\s*${NUMBER})?)`);
function values(payload: string): number[] | null {
  try {
    const parts = payload.startsWith("(") ? payload.slice(1, -1).split(",") : [payload];
    if (parts.length > 3) return null;
    const result = parts.map(part => parseMathExpression(part).evaluate(0));
    return result.every(Number.isFinite) ? result : null;
  } catch { return null; }
}
function sameScalar(a: number, b: number): boolean {
  return a === b || a !== 0 && b !== 0 && Math.abs(a - b) <= 128 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
}
function unitAfter(text: string, dimension: string): { factor: number; length: number } | null {
  if (dimension === "dimensionless") return { factor: 1, length: 0 };
  let selected: { factor: number; length: number } | null = null;
  for (let end = 1; end <= Math.min(text.length, 32); end++) {
    const unit = text.slice(0, end).trim();
    const rest = text.slice(end);
    // A prefix of N*m, m/s^2 or a longer unit is not the supplied unit.
    if (!unit || /^[\p{L}\p{N}µμ°*/^²³·]/u.test(rest) || /^\s+(?:kg|g|m|s)\b/.test(rest)) continue;
    try { selected = { factor: mechanicsUnitFactor(unit, dimension), length: end }; } catch { /* Other dimensions do not override this input. */ }
  }
  return selected;
}
function differentDimensionAtAmbiguousRole(role: string, tail: string, dimension: string): boolean {
  if (!/^(?:at|from|to|through|about|initial|after|start|end)$/i.test(role.trim())) return false;
  return ["length", "time", "angle", "mass", "velocity", "acceleration", "angular_velocity", "angular_acceleration", "force", "torque", "inertia", "energy"].some(other => other !== dimension && unitAfter(tail, other));
}
type DeclarationPhase = "initial" | "final" | "duration";
interface NumericDeclaration { values: number[]; factor: number; retained: boolean; phase?: DeclarationPhase }
function declarationPhase(text: string, at: number, role: string, dimension: string): DeclarationPhase | undefined {
  if (dimension === "time" && /\b(?:for|during|interval|duration)\b/i.test(role)) return "duration";
  const before = text.slice(Math.max(0, at - 64), at).split(/[;!?]|\.(?=\s|$)/).at(-1)!;
  if (/\b(?:initial(?:ly)?|before|start)\b[^\d=;.!?]{0,64}$/i.test(before) || dimension === "time" && /\b(?:initial|start|from)\b/i.test(role)) return "initial";
  if (/\b(?:final|after|end)\b[^\d=;.!?]{0,64}$/i.test(before) || dimension === "time" && /\bend\b/i.test(role)) return "final";
  return undefined;
}
function readPhase(read: MechanicsSourceRead, fact: ProblemFact): DeclarationPhase | undefined {
  if (read.path === "finalInertia") return "final";
  if (read.dimension === "time") {
    if (read.intervalComponent === "start" || /(?:^|\.)(?:initialAt|start)$/.test(read.path)) return "initial";
    if (read.intervalComponent === "end" || /(?:^|\.)(?:at|end)$/.test(read.path)) return "final";
    if (read.intervalComponent === "duration" || read.path === "time") return "duration";
  }
  const before = fact.evidence.quote.slice(0, fact.evidence.quote.indexOf(read.sourceExpression));
  return declarationPhase(before, before.length, "", read.dimension);
}
/** Zero is a positive physical assertion; a quotation or a negated
 * proposition about zero is not. Scope remains local to its statement. */
function currentCaseAssertion(text: string, at: number): boolean {
  const prefix = text.slice(0, at).split(/[;!?\n]|\.(?=\s|$)|\b(?:but|however)\b/i).at(-1) ?? "";
  return !/\b(?:not|false|incorrect|hypothetical|if|unless|maybe|suppose|would|could|claims?|reported|says?|said)\b|\b(?:don['’]t|doesn['’]t|isn['’]t|aren['’]t)\b/i.test(prefix);
}
function unknownCaseTime(text: string, phase: DeclarationPhase | undefined): boolean {
  for (const match of text.matchAll(/\b(?:duration|interval|time|clock|history)\b/gi)) {
    if (!currentCaseAssertion(text, match.index!)) continue;
    const declaredPhase = declarationPhase(text, match.index!, match[0], "time");
    if (phase && declaredPhase && phase !== declaredPhase || phase === "initial" && /duration|interval|history/i.test(match[0])) continue;
    const before = text.slice(Math.max(0, match.index! - 48), match.index!);
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 80);
    if (/\b(?:unknown|unspecified|undetermined)\s*$/i.test(before) ||
      /^\s*(?:(?:is|remains|becomes|still|new|and)\s+)*(?:unknown|unspecified|undetermined)\b/i.test(after)) return true;
  }
  return false;
}
function retainedCaseTime(text: string): boolean {
  const clock = "(?:duration|interval|time|clock|history)";
  const pattern = new RegExp(`\\b(?:same|identical)\\s+(?:(?:source|initial|elapsed|total)\\s+)?${clock}\\b|\\b(?:retain(?:s|ed|ing)?|keep(?:s|ing)?)\\s+(?:(?:the|its|this|same|initial|elapsed|total)\\s+)*${clock}\\b|\\ball\\s+other\\s+(?:conditions|quantities|parameters)\\s+(?:(?:are|remain)\\s+)?(?:the\\s+same|unchanged)\\b`, "gi");
  return [...text.matchAll(pattern)].some(match => currentCaseAssertion(text, match.index!));
}
function explicitBodyZeroLoad(text: string, owner: string, kind: string): boolean {
  const escaped = owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b(?:no|zero|without)\\s+(?:(?:horizontal|vertical|net|external|applied|driving|motor)\\s+){0,4}${kind}\\s+(?:on|for)\\s+(?:(?:the|same|this|that)\\s+)*${escaped}(?![\\p{L}\\p{N}_])`, "giu");
  return [...text.matchAll(pattern)].some(match => currentCaseAssertion(text, match.index!));
}
function hasZeroDeclaration(text: string, read: MechanicsSourceRead, phase: DeclarationPhase | undefined, positiveOnly = false): boolean {
  const matcher = new RegExp(read.roleSource.source, read.roleSource.ignoreCase ? "gi" : "g");
  for (const match of text.matchAll(matcher)) {
    if (positiveOnly && !currentCaseAssertion(text, match.index!)) continue;
    if (/^(?:at|from|to|through|about|initial|after|start|end)$/i.test(match[0].trim())) continue;
    const declaredPhase = declarationPhase(text, match.index!, match[0], read.dimension);
    if (phase && declaredPhase && phase !== declaredPhase) continue;
    const before = text.slice(Math.max(0, match.index! - 48), match.index!);
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 64);
    if (/\bzero\s*(?:(?:initial|final|constant|axial|angular|net|external)\s+)*$/i.test(before)
      || /^\s*(?:(?:=|:|is|of|equals)\s*)?zero\b/i.test(after)) return true;
  }
  return false;
}
function numericDeclarations(text: string, read: MechanicsSourceRead, positiveOnly = false): NumericDeclaration[] {
  const result: NumericDeclaration[] = [];
  const matcher = new RegExp(read.roleSource.source, read.roleSource.ignoreCase ? "gi" : "g");
  for (const match of text.matchAll(matcher)) {
    if (positiveOnly && !currentCaseAssertion(text, match.index!)) continue;
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 128);
    if (read.dimension === "time") {
      const interval = new RegExp(`^\\s*(?:(?:=|:|is|of)\\s*)?(${NUMBER})\\s*(?:-|–|to|<=\\s*[A-Za-z][A-Za-z0-9_]*\\s*<=)\\s*(${NUMBER})`).exec(after);
      if (interval) {
        const unit = unitAfter(after.slice(interval[0].length), "time");
        if (!unit) fail("a changed source time interval needs supported physical units");
        const first = Number(interval[1]), last = Number(interval[2]);
        if (first > last) fail("a changed source time interval must preserve its ordered endpoints");
        const component = read.intervalComponent ?? (/(?:^|\.)(?:initialAt|start)$/.test(read.path) ? "start" : /(?:^|\.)(?:at|end)$/.test(read.path) ? "end" : "duration");
        result.push({ values: [component === "start" ? first : component === "end" ? last : last - first], factor: unit.factor, retained: false, phase: component === "start" ? "initial" : component === "end" ? "final" : "duration" });
        continue;
      }
    }
    const payload = PAYLOAD.exec(after);
    if (payload) {
      const parsed = values(payload[1]!);
      const suppliedUnit = unitAfter(after.slice(payload[0].length), read.dimension);
      const retained = /\b(?:retain|retains|keep|keeps)\s*(?:the\s+|initial\s+)?$/i.test(text.slice(Math.max(0, match.index! - 48), match.index!));
      if (parsed && !suppliedUnit && /^\s*[\p{L}µμ°]/u.test(after.slice(payload[0].length))) {
        // "at" can introduce a spatial coordinate or an evaluation time.
        if (differentDimensionAtAmbiguousRole(match[0], after.slice(payload[0].length), read.dimension)) continue;
        fail("a changed physical source declaration has unsupported or mismatching units");
      }
      if (parsed && suppliedUnit) result.push({ values: parsed, factor: suppliedUnit.factor, retained, phase: declarationPhase(text, match.index!, match[0], read.dimension) });
    }
    // Compact prose also puts the number/unit before the role: a 2.8 N m motor couple.
    const before = text.slice(Math.max(0, match.index! - 96), match.index!);
    for (const number of before.matchAll(new RegExp(NUMBER, "g"))) {
      const tail = before.slice(number.index! + number[0].length);
      const suppliedUnit = unitAfter(tail, read.dimension);
      if (!suppliedUnit || !/^\s*(?:(?:a|an|the|signed|positive|negative|constant|net|external|applied|motor|central|axial|initial|horizontal|vertical)\s+)*$/i.test(tail.slice(suppliedUnit.length))) continue;
      result.push({ values: [Number(number[0])], factor: suppliedUnit.factor, retained: false, phase: declarationPhase(text, match.index!, match[0], read.dimension) });
    }
    if (result.length > 64) fail("source quantity declarations exceed the bounded case reader");
  }
  return result;
}
function validateEarlierFunction(text: string, read: MechanicsSourceRead): void {
  if (!read.variable || typeof read.value !== "string") fail("source functions need their original variable metadata");
  const expected = parseMathExpression(read.value).syntaxKey;
  const matcher = new RegExp(read.roleSource.source, read.roleSource.ignoreCase ? "gi" : "g");
  for (const match of text.matchAll(matcher)) {
    const after = text.slice(match.index! + match[0].length).split(/[;!?]|\.(?=\s|$)/)[0]!;
    // The role may consume the opening parenthesis (I(t)) or just theta.
    const declaration = /^\s*(?:\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)|([A-Za-z][A-Za-z0-9_]*)\s*\))?\s*(?:=|:|is|equals)\s*/.exec(after);
    if (!declaration) continue;
    const variable = declaration[1] ?? declaration[2] ?? read.variable;
    const body = after.slice(declaration[0].length);
    let found = false;
    for (const boundary of body.matchAll(/\s+(?=[\p{L}µμ°])/gu)) {
      if (boundary.index! > 512) break;
      let candidate;
      try { candidate = parseMathExpression(body.slice(0, boundary.index!).replace(new RegExp(`\\b${variable}\\b`, "g"), "x")); } catch { continue; }
      const unit = unitAfter(body.slice(boundary.index!), read.dimension);
      if (!unit) fail("a changed source function has unsupported or mismatching units");
      if (candidate.syntaxKey !== expected || unit.factor !== mechanicsUnitFactor(read.sourceUnit, read.dimension)) fail("an earlier source function cannot replace a changed alternative source law");
      found = true;
      break;
    }
    if (!found) fail("a changed source function must declare a supported expression and physical unit");
    if (read.variableUnit) {
      const unit = new RegExp(`\\b${variable}\\s+(?:is\\s+)?(?:in|measured\\s+in)\\s+(\\S+)`, "i").exec(after);
      if (unit && mechanicsUnitFactor(unit[1]!, "time") !== mechanicsUnitFactor(read.variableUnit, "time")) fail("an earlier source function cannot inherit a changed time-variable scale");
    }
  }
}
function hasName(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u").test(text);
}
function ownedCaseText(problem: ProblemIR, sourceCase: MechanicsSourceCase, read: MechanicsSourceRead, modelHistory: boolean): string {
  const text = modelHistory ? sourceUnquotedText(sourceCase.text) : sourceCase.text;
  const names = problem.entities.flatMap(entity => typeof entity.label === "string" ? [entity.label] : []);
  const bodies = problem.entities.filter(entity => (["body", "solid"].includes(entity.kind) || entity.label === read.modelOwnerLabel) && entity.label && hasName(text, entity.label)).map(entity => entity.label!);
  let currentOwner = bodies.length === 1 ? bodies[0] : undefined;
  const result: string[] = [];
  for (const clause of text.split(/[;!?\n]|\.(?=\s|$)/)) {
    const subjects = names.flatMap(name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matcher = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])(?=['’]s\\b|\\s+(?:has|have|is|are|was|were|keeps?|retains?|starts?|receives?|rotates?|rolls?|spins?|moves?|remains?|experiences?)\\b)`, "giu");
      // An explicit imperative selects its named body even when other bodies
      // are present; the single-body default must not erase that context.
      const introduced = new RegExp(`\\b(?:use|consider|take|assume)\\s+(?:(?:a|an|the|same|another|this|that)\\s+)*(${escaped})(?![\\p{L}\\p{N}_])`, "giu");
      const starts = new Set([
        ...[...clause.matchAll(matcher)].map(match => match.index!),
        ...(modelHistory ? [...clause.matchAll(introduced)].map(match => match.index! + match[0].length - match[1]!.length) : []),
      ]);
      return [...starts].map(at => ({ at, name }));
    }).sort((a, b) => a.at - b.at).filter(subject => !modelHistory || currentCaseAssertion(clause, subject.at));
    const add = (text: string, owner: string | undefined): void => {
      if (owner === read.ownerLabel || owner === read.modelOwnerLabel && (modelHistory || hasName(text, read.ownerLabel))) result.push(text);
    };
    if (!subjects.length) {
      const namedBodies = modelHistory ? bodies.filter(name => hasName(clause, name)) : [];
      const recipients = modelHistory ? names.filter(name =>
        [...clause.matchAll(/\b(?:on|for|at)\s+(?:(?:a|an|the|same|this|that)\s+)*/giu)].some(match => {
          const target = clause.slice(match.index! + match[0].length);
          return target.startsWith(name) && !/^[\p{L}\p{N}_]/u.test(target.slice(name.length));
        })) : [];
      const explicitOwner = recipients.length === 1 ? recipients[0] : namedBodies.length === 1 ? namedBodies[0] : undefined;
      const roles = read.role === "time" ? /\b(?:duration|interval|time|clock|history)\b/gi : new RegExp(read.roleSource.source, read.roleSource.ignoreCase ? "gi" : "g");
      if (modelHistory && !explicitOwner && currentOwner !== read.ownerLabel && currentOwner !== read.modelOwnerLabel &&
        [...clause.matchAll(roles)].some(match => currentCaseAssertion(clause, match.index!))) {
        fail("an alternative physical restriction with unproved owner cannot be discarded into another entity's history");
      }
      const queryOwner = explicitOwner ?? (/\b(?:find|calculate|determine|compute|give|report|solve)\b/i.test(clause) && hasName(clause, read.ownerLabel) ? read.ownerLabel : currentOwner);
      add(clause, queryOwner);
      if (explicitOwner && (bodies.includes(explicitOwner) || problem.entities.some(entity => entity.label === explicitOwner && entity.kind === "point"))) currentOwner = explicitOwner;
      continue;
    }
    add(clause.slice(0, subjects[0]!.at), currentOwner);
    subjects.forEach((subject, index) => add(clause.slice(subject.at, subjects[index + 1]?.at), subject.name));
    const last = subjects.at(-1)!.name;
    const entity = problem.entities.find(value => value.label === last);
    // A coordinate/field/surface declaration does not select a body history.
    if (!modelHistory || ["body", "solid", "point", "component"].includes(entity?.kind ?? "") || last === read.ownerLabel || last === read.modelOwnerLabel) currentOwner = last;
  }
  return result.join("; ");
}
function validateEarlierRead(
  problem: ProblemIR, sourceCase: MechanicsSourceCase, read: MechanicsSourceRead,
  sourceRest: (text: string, owner: string) => boolean,
): void {
  const fact = problem.facts.find(value => value.id === read.factId);
  if (!fact || globalConvention(fact) || fact.evidence.start >= sourceCase.start) return;
  // A delegated load or clock still acts on this model. Its named body's
  // alternative-case restrictions survive when the application point is not
  // repeated. Point/velocity ownership keeps its existing narrower scope.
  const modelHistory = ["force", "torque", "time"].includes(read.role);
  const text = ownedCaseText(problem, sourceCase, read, modelHistory);
  if (typeof read.value === "string") { validateEarlierFunction(text, read); return; }
  if (typeof read.value !== "number") fail("physical source reads need primitive validated values");
  const ownContext = (read.ownerLabel === read.modelOwnerLabel || modelHistory) && hasName(text, read.modelOwnerLabel);
  const expected = read.value * mechanicsUnitFactor(read.unit, read.dimension);
  if (ownContext && ["velocity", "angularVelocity", "initialAngularMomentum"].includes(read.role)
    && /\b(?:initial(?:ly)?|starts?|from\s+rest)\b/i.test(text)
    && sourceRest(sourceCase.text, read.modelOwnerLabel) && expected !== 0) {
    fail("the alternative source initial rest cannot inherit a nonzero earlier state");
  }
  const zeroKind = read.role === "force" ? "forces?" : read.role === "torque" ? "(?:torques?|couples?)" : null;
  const zeroMatches = zeroKind ? [...text.matchAll(new RegExp(`\\b(?:no|zero|without)\\s+(?:(?:horizontal|vertical|net|external|applied|driving|motor)\\s+){0,4}${zeroKind}\\b`, "gi"))] : [];
  if (zeroKind && expected !== 0 && (ownContext && zeroMatches.some(match => currentCaseAssertion(text, match.index!)) ||
    modelHistory && explicitBodyZeroLoad(sourceUnquotedText(sourceCase.text), read.modelOwnerLabel, zeroKind))) {
    fail("an earlier load cannot replace the alternative source's zero load");
  }
  if (!text) return;
  const phase = readPhase(read, fact);
  // The case reader already recognises retained durations. Explicit duration
  // values and zero declarations must use the same clock vocabulary too.
  const caseRead = read.role === "time" ? { ...read, roleSource: new RegExp(`(?:${read.roleSource.source})|\\bduration\\b`, read.roleSource.flags) } : read;
  if (expected !== 0 && hasZeroDeclaration(text, caseRead, phase, modelHistory)) fail("an earlier physical quantity cannot replace an explicit zero source condition");
  const declarations = numericDeclarations(text, caseRead, modelHistory).filter(declaration => !phase || !declaration.phase || phase === declaration.phase);
  if (read.role === "time" && unknownCaseTime(text, phase)) fail("an unknown alternative source clock cannot inherit an earlier numeric history");
  if (read.role === "time" && expected !== 0 && !declarations.length && !retainedCaseTime(text)) {
    fail("an alternative experiment cannot inherit an unstated nonzero source time history");
  }
  for (const declaration of declarations) {
    const original = read.component === undefined ? null : values(read.sourceExpression);
    if (read.role === "velocity" && original && original.length > 1 && declaration.values.length === 1) {
      if (!declaration.retained) fail("a new scalar speed cannot establish the original vector's direction");
      if (sameScalar(Math.hypot(...original) * mechanicsUnitFactor(read.sourceUnit, read.dimension), declaration.values[0]! * declaration.factor)) continue;
      fail("a retained source speed cannot replace a changed velocity magnitude");
    }
    let candidate = declaration.values[read.component ?? 0];
    if (candidate === undefined) continue;
    candidate *= declaration.factor;
    if (!sameScalar(candidate, expected)) fail("an earlier physical quantity cannot replace a changed alternative source condition");
  }
}

/**
 * Bind a requested observable to one actual source experiment. A complete
 * question quote cannot merge two requests for the same observable, and a
 * later alternative's conditions cannot answer the preceding experiment.
 */
export function validateMechanicsRequestedCase(
  problem: ProblemIR,
  requested: readonly ProblemFact[],
  usedFactIds: ReadonlySet<string>,
  isRequestedObservable: (text: string) => boolean,
  sourceReads: readonly MechanicsSourceRead[] = [],
  sourceRest: (text: string, owner: string) => boolean = () => false,
): MechanicsSourceCase | null {
  const cases = mechanicsSourceCases(problem.question);
  if (cases.length === 1) return null;
  const selected = new Set<number>();
  for (const fact of requested) {
    let queries = 0;
    for (const query of fact.evidence.quote.matchAll(QUERY)) {
      if (!isRequestedObservable(query[0])) continue;
      queries++;
      selected.add(containingCase(cases, fact.evidence.start + query.index!).index);
    }
    if (!queries && isRequestedObservable(fact.evidence.quote)) {
      const first = containingCase(cases, fact.evidence.start);
      const last = containingCase(cases, fact.evidence.end - 1);
      if (first.index !== last.index) fail("requested observable quote spans different source experiments");
      selected.add(first.index);
    }
  }
  if (selected.size !== 1) fail("requested observable must select exactly one original source experiment");
  const sourceCase = cases[[...selected][0]!]!;
  for (const factId of usedFactIds) {
    const fact = problem.facts.find(value => value.id === factId);
    if (!fact || globalConvention(fact)) continue;
    const first = containingCase(cases, fact.evidence.start);
    const last = containingCase(cases, fact.evidence.end - 1);
    if (first.index > sourceCase.index || last.index > sourceCase.index) {
      fail("a later alternative experiment cannot supply the requested source state");
    }
  }
  if (sourceReads.length > 8192) fail("physical source reads exceed the bounded case reader");
  for (const read of sourceReads) validateEarlierRead(problem, sourceCase, read, sourceRest);
  return sourceCase;
}
