import type { SceneDocument, SceneIssue } from "../types";
import {
  solveLinearFigure,
  parseLinearConstraint,
  linearConstraintSignature,
  parseLinearAffine,
  type IntervalExpression,
  type LinearFigureInput,
} from "../math/linearRegion";
import { isLinearSourceIdentifier, readLinearSourceIntersectionNames, readLinearSourceReferencePoints } from "./linearSourcePoints";
export { readLinearSourceReferencePoints } from "./linearSourcePoints";
import {
  evaluateLinearRegionConstruction,
  LINEAR_REGION_OPERATORS,
  type LinearRegionGeometry,
} from "./linearRegionGeometry";
import { snapshotMathSourceData } from "./mathSourceData";
import type { ExactRational } from "../math/exactRational";

export interface LinearSourceIntervalRole {
  definition: string;
  lower?: ExactRational;
  upper?: ExactRational;
  lowerIncluded: boolean;
  upperIncluded: boolean;
}

interface SourceClause {
  text: string;
  start: number;
  end: number;
  equality: boolean;
  domainScope?: "global" | "local";
}
/** A request the reader cannot prove supplies neither a figure nor a veto. */
class UnprovedLinearRequest extends Error {}
const FIRST_QUADRANT = String.raw`in\s+(?:the\s+)?first\s+quadrant|within\s+quadrant\s+I`;
/** Typed scalar-value slots already supported by the complete request grammar. */
const LINEAR_SCALAR_VALUE_QUERY = String.raw`at\s+(?:every|each)\s+corner|value`;

/** Leading/postfix qualifiers restrict the result; parenthesized domains retain local scope. */
function firstQuadrantDomains(text: string, names: readonly string[]): SourceClause[] {
  const matches = [...text.matchAll(new RegExp(`\\b(?:${FIRST_QUADRANT})\\b`, "gi"))];
  if (!matches.length) return [];
  if (names.length !== 2 || names[0] !== "x" || names[1] !== "y" || matches.length !== 1)
    throw new UnprovedLinearRequest("First-quadrant scope needs one canonical planar result");
  const match = matches[0]!, before = text.slice(0, match.index), after = text.slice(match.index! + match[0].length).trimStart();
  const depth = (before.match(/\(/g)?.length ?? 0) - (before.match(/\)/g)?.length ?? 0);
  const local = depth > 0 && /^\)+/.test(after);
  if (depth < 0 || depth > 0 && !local || !local && before.trim() && after && !/^[.;?!]/.test(after))
    throw new UnprovedLinearRequest("The first-quadrant qualifier has unresolved local scope");
  return ["x>=0", "y>=0"].map(value => ({ text: value, start: match.index!, end: match.index! + match[0].length, equality: false,
    domainScope: local ? "local" : "global" }));
}

/** A leading question ordinal is presentation syntax, not an equation name.
 * Explicit declarations such as "line named Q1" retain their name. */
function withoutQuestionOrdinal(text: string): string {
  return text.replace(/^\s*(?:Q|Question\s+)\d+[a-z]?\s*:\s*/i, "");
}

/** A colon denotes a name only for an identifier or an explicit line declaration. */
export function readLinearSourceLineName(prefix: string): string | undefined {
  const declared = /\bline\s+(?:named|called)\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*$/i.exec(prefix);
  if (declared) return declared[1];
  const short = /\b([A-Za-z][A-Za-z0-9_]*)\s*:\s*$/.exec(withoutQuestionOrdinal(prefix))?.[1];
  return short && isLinearSourceIdentifier(short) ? short : undefined;
}

/**
 * Consume the prose outside already parsed operands. This is a positive,
 * bounded request vocabulary: an unfamiliar modifier or punctuation cannot
 * silently disappear while its neighbouring math becomes source authority.
 * Operand scope is checked separately by the Boolean grammar.
 */
function consumeLinearRequest(prose: string, declaredNames: readonly string[] = []): void {
  const names = new Set(declaredNames);
  const words = new Set((
    "let and or not complement union intersection of for where when satisfy satisfies satisfying subject such under given over with to in on at as by using then " +
    "teach me how help see explain use consider considering graph graphs graphically graphical solve shade shaded shading show showing plot represent draw illustrate indicate choose choosing label mark marking find determine state give report calculate compute " +
    "the a an all both each every real continuous domain number line lines half plane coordinate coordinates xaxis yaxis axis axes xy region common feasible solution solutions set points point pair system simultaneous equations equation " +
    "one two many count unique no none infinitely infinite parallel coincident consistent inconsistent dependent independent empty bounded unbounded full complete exact simplified names intercepts corners corner vertices vertex boundary boundaries solid dashed open closed strict " +
    "whether which that do does has have is are belongs belong lies lie included it its their they them this these those why meet meets cross crossing fractional keep exists finite value values maximizing minimizing maximized minimized maximize minimize maximum minimum max min optimum optimal profit cost revenue " +
    "including whose from figure classify method equivalent unrestricted possible please also named called denoted exist there same especially " +
    "maximise minimise maximised minimised maximising minimising " +
    "x y lpp rational endpoint endpoints ray direction understand works left right interval length vertical horizontal side correct style passes through origin identify identifying membership ordered pairs " +
    "redundant constraint constraints actually limits multiple can workshop chooses production amounts model uses put maximiser maximisers maximizer maximizers minimiser minimisers minimizer minimizers attaining entire feasibility permitted decide unboundedness prevents " +
    "inclusive either inequality inequalities enough defining must hold means positions numbers labelled labeling labelling inclusion status explicitly clearly geometric even share optimisation optimization convention form actual question asks only though stating describe coefficient coefficients simultaneously"
  ).split(" "));
  prose = prose.replace(/\binteger(?:\s+|-)coefficients?\b/gi, "coefficients");
  prose = prose.replace(/\b(?:the\s+)?two\s+different\s+endpoint\s+marks\b/gi, "endpoint marks");
  prose = prose.replace(/\bif\s+possible\b/gi, "possible");
  for (const location of prose.matchAll(/\b(?:on|in)\s+(?:[A-Za-z]+\s+){0,4}(?:number[ -]lines?|graphs?|axes|planes?)\b/gi)) {
    if (!/^(?:on\s+(?:(?:a|the|one)\s+)?(?:same\s+)?(?:number[ -]line|graph)|in\s+(?:(?:a|the|real)\s+)*(?:(?:coordinate|xy)\s+)?plane)$/i.test(location[0]))
      throw new UnprovedLinearRequest("The display location has unproved figure count or shared scope");
  }
  words.add("marks");
  for (const declaration of prose.matchAll(/\bsolution\s+set\s+(?:(?:named|called|denoted\s+by)\s+)?([A-Za-z][A-Za-z0-9_]*)\s*(?=of\b|for\b|on\b|satisfying\b|=|:|[.;?!]|$)/gi)) {
    if (!words.has(declaration[1]!.toLowerCase())) names.add(declaration[1]!);
  }
  // Literal membership queries are not additional set operands. Only this
  // complete scalar noun phrase may consume digits outside a comparison.
  prose = prose.replace(/\b(?:whether|is|does|do)\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s+(?:belongs?|lies?|included|is|in|on)\b/gi, "whether belongs");
  for (const token of prose.matchAll(/[A-Za-z][A-Za-z0-9_]*|[^\s]/g)) {
    if (names.has(token[0]) || words.has(token[0].toLowerCase()) || /^[,;:.?!()"-]$/.test(token[0])) continue;
    throw new UnprovedLinearRequest(`Unconsumed original request token '${token[0]}'`);
  }
}

function normalize(text: string): string {
  if (/\d\s*·\s*\d/.test(text))
    throw new UnprovedLinearRequest("A numeric middle dot has ambiguous decimal or multiplication semantics");
  return withoutQuestionOrdinal(text)
    .replace(/\\(?:left|right)/g, "")
    .replace(/\\(?:leq|le)\b/g, "<=")
    .replace(/\\(?:geq|ge)\b/g, ">=")
    .replace(/\\(?:cdot|times)\b/g, "*")
    .replace(/\\frac\s*\{\s*([+-]?\d+)\s*\}\s*\{\s*([+-]?\d+)\s*\}/g, "($1/$2)")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[−–]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/\$/g, "")
    .replace(/∨|∪|\\(?:lor|vee|cup)\b/g, " or ")
    .replace(/∧|∩|\\(?:land|wedge|cap)\b/g, " and ")
    .replace(/¬|\\(?:neg|lnot)\b/g, " not ");
}
/** Refuse source syntax whose scope the bounded reader cannot certify. */
function assertLinearSourceGrammar(text: string): void {
  // Display cardinality belongs to the requested object, independent of a
  // preposition or where the display instruction appears in the request.
  const singular = new Set(["one", "single"]);
  const cardinality = /\b(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|single|both|many|multiple|several|each|every)\s+(?:(?:same|different|separate|distinct|coordinate|xy)\s+)*(?:number[ -]lines?|graphs?|planes?|canvases?)\b/gi;
  for (const display of text.matchAll(cardinality)) {
    const count = display[1]!.toLowerCase();
    const context = text.slice(0, display.index!);
    // "The two graphs ... show a unique solution" describes two plotted
    // functions. Frame cardinality is asserted by a display action or its
    // governing location/manner preposition, not by a descriptive noun alone.
    if (!/number[ -]lines?/i.test(display[0])
      && !/\b(?:on|in|using|with|as|use|graph|draw|plot|represent|show|illustrate)\s+(?:(?:a|an|the|me|same|exact|these|those)\s+)*$/i.test(context)) continue;
    if (!singular.has(count) && !/^0*1$/.test(count))
      throw new UnprovedLinearRequest("The requested display cardinality has no single shared figure scope");
  }
  if (/\bnumber[ -]lines\b|\b(?:each|every)\s+(?:solution\s+sets?|inequalities|intervals?|sets?|graphs?)\b/i.test(text))
    throw new UnprovedLinearRequest("Distributed source objects have no single certified result scope");
  if (/\b(?:complement\s+of|not)\s*(?:\(*\s*(?:the\s+)?)?(?:complement\s+of|not)\b/i.test(text))
    throw new Error("Repeated source complement requires an explicit supported scope");
  if (/\b(?:each\s+(?:of|inequality|interval|set|graph)|separately|separate\s+(?:axes|graphs?|number[ -]lines?))\b/i.test(text))
    throw new Error("Separate source requests cannot be merged into one linear program");
  if (/\bquadrants?\b|\bnon[- ]?negativity\b/i.test(text.replace(new RegExp(`\\b(?:${FIRST_QUADRANT})\\b`, "gi"), " ")))
    throw new Error("Implicit planar domains require explicit supported inequality clauses");
  if (/\b(?:in|over)\s+[NZW]\b/i.test(text))
    throw new Error("Discrete source domains cannot be represented by continuous linear figures");
  if (/\d\s+(?:\d+\s*\/\s*\d+|\(\s*\d+\s*\/\s*\d+\s*\))/.test(text))
    throw new Error("Mixed source fractions cannot be read as implicit multiplication");
  if (/\b(?:shad(?:e|ing)|region|strip)\b[^.;?!]*\bbetween\s+(?:the\s+)?(?:two\s+)?lines?\b/i.test(text))
    throw new Error("A region between source lines cannot become a two-equation system");
}
/** Real-domain declarations are syntax, never additional affine operands. */
function sourceNotation(text: string, names: readonly string[]): string {
  let result = text;
  if (names.length === 2 && names[0] === "x" && names[1] === "y") {
    result = result.replace(/\b(?:in|over)\s+(?:R|ℝ)(?:\^2|²)\s*(?=[,;:.]|$)/gi, " ");
    result = result.replace(/\b(?:real\s+)?pairs?\s*\(\s*x\s*,\s*y\s*\)/gi, "real pairs");
    // A Cartesian set builder explicitly declares canonical x/y order. The
    // complete body is retained for the same affine/Boolean clause reader.
    result = result.replace(/(?:\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*)?\{\s*\(\s*x\s*,\s*y\s*\)\s*:\s*([^{}]+)\}/g,
      (_, label: string | undefined, body: string) => label ? ` solution set ${label} of ${body} ` : ` ${body} `);
  }
  const variables = names.join("|");
  result = result.replace(new RegExp(`\\b(?:there\\s+is\\s+)?no\\s+constraint\\s+on\\s+(?:${variables})\\s*(?=[.;?!]|$)`, "gi"), " ");
  // Explicit continuous-domain disclaimers do not apply Boolean complement
  // to the preceding region. Restrict to these complete noun phrases; an
  // actual integer restriction or mathematical NOT remains visible.
  result = result.replace(/\b(?:the\s+)?domain\s+is\s+continuous,\s*not\s+integer-valued\s*(?=[.;?!]|$)/gi, "the domain is continuous ");
  result = result.replace(/\bnot\s+an?\s+integer\s+problem\s*(?=[.;?!]|$)/gi, " ");
  result = result.replace(/\bdo\s+not\s+impose\s+an?\s+integer\s+restriction\s*(?=[.;?!]|$)/gi, " ");
  return result;
}
const SIGN_DOMAIN_PROPERTY = "non[- ]?negative|non[- ]?positive|positive|negative";
// Existing unsupported set operators are also unsafe in an incomplete request.
const UNSUPPORTED_LINEAR_BOOLEAN_WORDS = "unless|except|xor|neither|nor";
const UNSUPPORTED_LINEAR_INTERVAL_BOOLEAN_WORDS = `${UNSUPPORTED_LINEAR_BOOLEAN_WORDS}|setminus|minus`;

/** Do not reinterpret a coordinate inside a different complete noun subject.
 * This proves only the subject's role; it does not consume the property or
 * make an otherwise uncertain source request authoritative. */
function linearIdentifierSubjectStart(text: string, subjectEnd: number): number | null {
  let cursor = subjectEnd;
  while (true) {
    while (cursor > 0 && /\s/.test(text[cursor - 1]!)) cursor--;
    const end = cursor;
    while (cursor > 0 && /[A-Za-z0-9_]/.test(text[cursor - 1]!)) cursor--;
    if (cursor === end || !/[A-Za-z]/.test(text[cursor]!)) return null;
    const start = cursor;
    while (cursor > 0 && /\s/.test(text[cursor - 1]!)) cursor--;
    if (text.slice(cursor - 3, cursor).toLowerCase() === "and" && !/[A-Za-z0-9_]/.test(text[cursor - 4] ?? "")) {
      cursor -= 3;
      while (cursor > 0 && /\s/.test(text[cursor - 1]!)) cursor--;
      if (text[cursor - 1] === ",") cursor--;
    } else if (text[cursor - 1] === ",") cursor--;
    else return start;
  }
}

function linearCoefficientSubjectStart(text: string, subjectEnd: number): number | null {
  const start = linearIdentifierSubjectStart(text, subjectEnd);
  if (start === null) return null;
  const tail = text.slice(Math.max(0, start - 96), subjectEnd);
  const offset = Math.max(0, start - 96);
  const head = /\b(?:(?:the|all|its|polynomial)\s+)?coefficients?\s+(?:of|for|on|in|multiplying)\s*$/i.exec(text.slice(offset, start));
  if (head) return offset + head.index;
  const bare = /\b(?:(?:the|all|its|polynomial)\s+)?coefficients?\s*$/i.exec(tail);
  return bare ? offset + bare.index : null;
}

function hasLinearCoefficientSubject(text: string, subjectEnd: number): boolean {
  return linearCoefficientSubjectStart(text, subjectEnd) !== null;
}

/** A shared predicate may belong to several coefficient nouns, but never to
 * a bare variable joined to them. A preceding complete mathematical operand
 * is outside that noun subject, rather than another bare variable. */
function pureLinearCoefficientSubjectStart(text: string, subjectEnd: number): number | null {
  let start = linearCoefficientSubjectStart(text, subjectEnd);
  if (start === null) return null;
  while (true) {
    const prefix = text.slice(0, start);
    const separator = /(?:\s*,\s*(?:and\s*)?|\s+and\s+)$/.exec(prefix);
    if (separator) {
      const previous = linearCoefficientSubjectStart(text, separator.index);
      if (previous !== null) { start = previous; continue; }
    }
    const before = (separator ? prefix.slice(0, separator.index) : prefix)
      .split(/[.;?!\r\n]/).at(-1)!.trimEnd();
    if (!before.trim() || /^(?:(?:if|for|given|where|with|subject\s+to)\s*)+$/i.test(before.trim())) return start;
    const context = before.replace(/\b(?:for|given|where|with|subject\s+to)\s*$/i, "").trimEnd();
    if (!/[<>=]/.test(context)) return null;
    if (/[0-9)]$/.test(context)) return start;
    const operand = /[A-Za-z][A-Za-z0-9_]*$/.exec(context);
    return operand !== null && /[<>=+*/^-]\s*$/.test(context.slice(0, operand.index)) ? start : null;
  }
}

/** Term attachment is ownership, unlike assigning the coefficient's value to
 * a native variable. Chained links retain each exact referenced term slot. */
function linearCoefficientTermEnd(source: string, start: number, plural: boolean): number {
  let end = start;
  for (let links = 0; links < 16; links++) {
    const link = /^\s+(?:(?:of|for|on|in)|multipl(?:y|ies|ying)|multiplied\s+by|attached\s+to)\s+(?:real\s+)?((?:the\s+)?[A-Za-z][A-Za-z0-9_]*(?:\s*(?:,\s*(?:and\s*)?|and\s+)(?:the\s+)?[A-Za-z][A-Za-z0-9_]*){0,8})\b/i.exec(source.slice(end));
    if (!link) break;
    const terms = link[1]!.match(/[A-Za-z][A-Za-z0-9_]*/g)!.filter(term => !/^(?:and|the)$/i.test(term));
    // A repeated term, or several terms attached to a singular coefficient,
    // may instead be a separate variable subject. Neither role is proved.
    if (new Set(terms).size !== terms.length || !plural && terms.length > 1) break;
    end += link[0].length;
  }
  return end;
}

/** Every unproved rational type word is a domain restriction. Exempt only
 * its exact occurrence in an owned coefficient/property noun or predicate;
 * no request-parser failure or verb wording can erase a remaining type. */
function linearRationalPropertySource(source: string, names: readonly string[], includeSigns = false): string {
  const typePattern = includeSigns ? `(?:${SIGN_DOMAIN_PROPERTY}|(?:ir)?rationals?)` : "(?:ir)?rationals?";
  const words = [...source.matchAll(new RegExp(`\\b${typePattern}\\b`, "gi"))];
  if (!words.length && !/\bcoefficients?\s+in\b/i.test(source) || words.length > 16) return source;
  const proved = new Set<number>();
  const nounSpans: Array<{ start: number; end: number }> = [];
  const nativePositions = [...source.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)]
    .filter(token => names.includes(token[0]) || /^(?:unknowns?|variables?)$/i.test(token[0])).map(token => token.index!);
  const mathOwned = new Set<number>();
  const coefficientTermOwned = new Set<number>();
  const comparisons: string[] = [];
  let runStart = -1, runEnd = -1;
  const finishRun = () => {
    if (runStart < 0) return;
    const start = runStart, end = runEnd;
    const text = source.slice(start, end);
    if (/[<>=]/.test(text)) try {
      parseLinearConstraint(text, names);
      comparisons.push(text);
      for (const position of nativePositions) if (position >= start && position < end) {
        const after = /^[A-Za-z][A-Za-z0-9_]*/.exec(source.slice(position))![0].length + position;
        // A dangling native token before unfamiliar prose can be a new scalar
        // subject, rather than the preceding inequality's implicit factor.
        if (after === end && !/^\s*(?:$|[,;:.?!\r\n]|(?:and|or|subject\s+to|on|in|with|for|where)\b)/i.test(source.slice(after))) continue;
        mathOwned.add(position);
      }
    } catch { /* An unproved operand supplies no alternate-role ownership. */ }
    runStart = -1; runEnd = -1;
  };
  for (const token of source.matchAll(/(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|<=|>=|[^\s]/g)) {
    if (names.includes(token[0]) || /^(?:\d|\.\d)/.test(token[0]) || /^(?:<=|>=|[<>=()+*/-])$/.test(token[0])) {
      if (runStart < 0) runStart = token.index!;
      runEnd = token.index! + token[0].length;
    } else finishRun();
  }
  finishRun();
  let objective = false;
  try {
    const parsed = sourceObjective(source, names); objective = true;
    for (const position of nativePositions) if (position >= parsed.start && position < parsed.end) mathOwned.add(position);
  } catch { /* No objective type or value is inferred from an uncertain query. */ }
  const ownsContext = (position: number, allowedStart: number, allowedEnd: number): boolean => {
    let start = position, end = position;
    while (start > 0 && !/[.;?!\r\n]/.test(source[start - 1]!)) start--;
    while (end < source.length && !/[.;?!\r\n]/.test(source[end]!)) end++;
    return nativePositions.every(native => native < start || native >= end || mathOwned.has(native) || coefficientTermOwned.has(native) || native >= allowedStart && native < allowedEnd);
  };
  const ownsNounContext = (position: number, allowedStart: number, allowedEnd: number): boolean => {
    if (!ownsContext(position, allowedStart, allowedEnd)) return false;
    let end = position;
    while (end < source.length && !/[.;?!\r\n]/.test(source[end]!)) end++;
    return nativePositions.every(native => native < allowedEnd || native >= end || coefficientTermOwned.has(native) || /\b(?:and|or|subject\s+to)\b/i.test(source.slice(allowedEnd, native)));
  };
  const unprovedScalarComplement = (position: number): boolean => {
    let start = position;
    while (start > 0 && !/[.;?!\r\n]/.test(source[start - 1]!)) start--;
    const links = [...source.slice(start, position).matchAll(/\b(?:is|are|be|equals?|becomes?)\b/gi)];
    const link = links.at(-1);
    // A typed property is not neutral when an unproved scalar subject is
    // being identified with that property. The subject's noun
    // spelling does not establish an alternate mathematical role.
    return link !== undefined && pureLinearCoefficientSubjectStart(source, start + link.index!) === null;
  };
  // Coefficient noun phrases own their scalar properties independently of
  // predicate wording. Exact native term slots, rather than request words or
  // determiners, distinguish this noun from a variable's scalar identity.
  const coefficientNouns = [...source.matchAll(/\bcoefficients?\b/gi)].slice(0, 16).map(head => {
    const beforeHeadStart = Math.max(0, head.index! - 128);
    const beforeHead = source.slice(beforeHeadStart, head.index!);
    const modifiers = /\b(?:(?:the|a|an|some|all|any|its|each|every|polynomial|rationals?|irrationals?|positive|negative|nonnegative|nonpositive|and|or)\s+)+$/i.exec(beforeHead);
    const start = modifiers ? beforeHeadStart + modifiers.index : head.index!;
    const headEnd = head.index! + head[0].length;
    const end = linearCoefficientTermEnd(source, headEnd, /coefficients$/i.test(head[0]));
    for (const position of nativePositions) if (position >= headEnd && position < end) coefficientTermOwned.add(position);
    return { start, end };
  });
  // Populate all term slots first: a later independent coefficient noun may
  // own another native reference in this same clause.
  for (const { start, end } of coefficientNouns) {
    if (unprovedScalarComplement(start)) continue;
    for (const type of words) {
      let boundaryStart = type.index!, boundaryEnd = type.index!;
      while (boundaryStart > 0 && !/[.;?!\r\n]/.test(source[boundaryStart - 1]!)) boundaryStart--;
      while (boundaryEnd < source.length && !/[.;?!\r\n]/.test(source[boundaryEnd]!)) boundaryEnd++;
      if (start < boundaryStart || end > boundaryEnd || type.index! < start || !ownsNounContext(type.index!, start, end)) continue;
      const nextValue = /^\s+([A-Za-z][A-Za-z0-9_]*)\b/.exec(source.slice(type.index! + type[0].length));
      if (nextValue && (names.includes(nextValue[1]!) || isLinearSourceIdentifier(nextValue[1]!))) continue;
      if (type.index! >= end) {
        const predicate = source.slice(end, type.index!);
        if ([...predicate.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)].some(token => isLinearSourceIdentifier(token[0]))) continue;
        const conjunction = [...predicate.matchAll(/\b(?:and|or)\b/gi)].at(-1);
        if (conjunction && !/^(?:(?:rationals?|irrationals?|positive|negative|nonnegative|nonpositive|strictly|only)\s+)*$/i.test(predicate.slice(conjunction.index! + conjunction[0].length).trimStart())) continue;
      }
      proved.add(type.index!);
      nounSpans.push({ start, end });
    }
  }
  const property = `(?:${SIGN_DOMAIN_PROPERTY}|(?:ir)?rationals?(?:\\s+numbers?)?)`;
  const predicates = new RegExp(`\\b(?:is|are)\\s+(?:an?\\s+)?${property}(?:\\s+(?:and|or)\\s+${property})*\\b|\\btakes?\\s+(?:only\\s+)?(?:ir)?rationals?\\s+values?\\b`, "gi");
  for (const predicate of source.matchAll(predicates)) {
    const subjectStart = pureLinearCoefficientSubjectStart(source, predicate.index!);
    const coefficient = subjectStart !== null && nativePositions.every(native => native < subjectStart || native >= predicate.index! || coefficientTermOwned.has(native));
    const endpoint = names.length === 1 && comparisons.length > 0 && /\b(?:the|its)\s+endpoints?\s*$/i.test(source.slice(0, predicate.index!));
    const corner = names.length === 2 && comparisons.length >= 2 && /\b(?:the|its)\s+corner\s+coordinates\s*$/i.test(source.slice(0, predicate.index!));
    const continuation = /^\s+([A-Za-z][A-Za-z0-9_]*)\b/.exec(source.slice(predicate.index! + predicate[0].length));
    if (continuation && names.includes(continuation[1]!)) continue;
    if (!coefficient && (!(endpoint || corner) || !ownsContext(predicate.index!, predicate.index!, predicate.index! + predicate[0].length))) continue;
    if (coefficient) nounSpans.push({ start: subjectStart!, end: predicate.index! });
    for (const word of predicate[0].matchAll(new RegExp(`\\b${typePattern}\\b`, "gi"))) proved.add(predicate.index! + word.index!);
  }
  const modifier = new RegExp(`(?:strictly|only|real|non[- ]?zero|${SIGN_DOMAIN_PROPERTY})\\b\\s+`, "iy");
  const propertyNoun = /(?:intercepts?|coefficients?|ax(?:is|es)|directions?)\b/iy;
  const geometricField = /(?:optimal\s+)?(endpoints?|corners?)\b/iy;
  const identifier = /[A-Za-z][A-Za-z0-9_]*/y;
  const nextSubject = /\s*(?:,\s*(?:and\s*)?|and\s+)([A-Za-z][A-Za-z0-9_]*)/iy;
  for (const type of source.matchAll(new RegExp(`\\b${typePattern}(?:[- ]valued)?\\s+`, "gi"))) {
    let cursor = type.index! + type[0].length;
    modifier.lastIndex = cursor;
    while (modifier.exec(source)) { cursor = modifier.lastIndex; modifier.lastIndex = cursor; }
    geometricField.lastIndex = cursor;
    const fieldRole = geometricField.exec(source);
    if (fieldRole) {
      const geometric = /^endpoints?$/i.test(fieldRole[1]!)
        ? names.length === 1 && comparisons.length > 0
        : names.length === 2 && objective && comparisons.length >= 2;
      if (geometric && !unprovedScalarComplement(type.index!)
        && ownsContext(type.index!, type.index!, type.index!)) proved.add(type.index!);
      continue;
    }
    propertyNoun.lastIndex = cursor;
    if (propertyNoun.exec(source)) {
      let end = propertyNoun.lastIndex;
      if (/^coefficients?$/i.test(source.slice(cursor, end))) {
        if (unprovedScalarComplement(type.index!)) continue;
        end = linearCoefficientTermEnd(source, end, /^coefficients$/i.test(source.slice(cursor, end)));
      }
      if (ownsNounContext(type.index!, cursor, end)) { proved.add(type.index!); if (includeSigns) nounSpans.push({ start: cursor, end }); }
      continue;
    }
    identifier.lastIndex = cursor;
    const first = identifier.exec(source);
    if (!first) continue;
    cursor = identifier.lastIndex;
    nextSubject.lastIndex = cursor;
    while (nextSubject.exec(source)) {
      cursor = nextSubject.lastIndex; nextSubject.lastIndex = cursor;
    }
    // x is a modifier inside these property nouns, not the declared subject.
    const field = /^(?:\s+|\s*-\s*)(?:intercepts?|coefficients?|ax(?:is|es)|directions?)\b/i.exec(source.slice(cursor));
    if (field && (!/coefficients?/i.test(field[0]) || !unprovedScalarComplement(type.index!))
      && ownsNounContext(type.index!, identifier.lastIndex - first[0].length, cursor + field[0].length)) {
      proved.add(type.index!);
      if (includeSigns) {
        const fieldEnd = cursor + field[0].length;
        const end = /coefficients?/i.test(field[0]) ? linearCoefficientTermEnd(source, fieldEnd, /coefficients/i.test(field[0])) : fieldEnd;
        nounSpans.push({ start: identifier.lastIndex - first[0].length, end });
      }
    }
  }
  for (const type of words) if (/\buse\s+$/i.test(source.slice(0, type.index!)) && /^\s+arithmetic\b/i.test(source.slice(type.index! + type[0].length))
    && comparisons.length > 0 && ownsContext(type.index!, type.index!, type.index!)) proved.add(type.index!);
  for (const type of words) {
    const prefix = source.slice(0, type.index!).split(/[.;?!\r\n]/).at(-1)!.trim();
    const after = source.slice(type.index! + type[0].length);
    const intercept = /^\s+([A-Za-z][A-Za-z0-9_]*)[- ]intercept\b/i.exec(after);
    if (comparisons.length > 0 && /\b(?:show|find|determine|give|report|state|calculate|compute)(?:\s+the)?$/i.test(prefix)
      && intercept && names.includes(intercept[1]!) && ownsNounContext(type.index!, type.index! + type[0].length, type.index! + type[0].length + intercept[0].length)) proved.add(type.index!);
  }
  const masked = source.split("");
  for (const word of words) if (proved.has(word.index!)) for (let index = word.index!; index < word.index! + word[0].length; index++) masked[index] = " ";
  if (includeSigns) for (let index = 1; index < words.length; index++) {
    const previous = words[index - 1]!, next = words[index]!;
    const start = previous.index! + previous[0].length, end = next.index!;
    if (proved.has(previous.index!) && proved.has(next.index!) && /^\s+(?:and|or)\s+$/i.test(source.slice(start, end)))
      for (let position = start; position < end; position++) masked[position] = " ";
  }
  if (includeSigns) for (const span of nounSpans)
    for (let position = span.start; position < span.end; position++) masked[position] = " ";
  // Only this owned preposition is membership-like. Keep every other token:
  // a property proof cannot remove an integer/set cue or a later predicate.
  for (const span of nounSpans) for (const head of source.slice(span.start, span.end).matchAll(/\bin\b/gi))
    for (let index = span.start + head.index!; index < span.start + head.index! + head[0].length; index++) masked[index] = " ";
  return masked.join("");
}

/** Explicit variable-domain grammar; these givens are never assumed by convention. */
function explicitDomains(text: string, names: readonly string[]): string {
  const quadrant = firstQuadrantDomains(text, names);
  if (quadrant.length) text = text.replace(new RegExp(`\\b(?:${FIRST_QUADRANT})\\b`, "gi"),
    quadrant[0]!.domainScope === "local" ? " and x>=0 and y>=0 " : " ");
  const name = `(?:${names.join("|")})`;
  const list = `${name}(?:\\s*(?:,\\s*(?:and\\s*)?|and\\s+)${name}){0,8}`;
  const domain = SIGN_DOMAIN_PROPERTY;
  const expand = (variables: string, word: string): string => {
    const relation = /^non[- ]?negative$/i.test(word)
      ? ">="
      : /^non[- ]?positive$/i.test(word)
        ? "<="
        : /^positive$/i.test(word)
          ? ">"
          : "<";
    const selected =
      variables
        .match(/[A-Za-z][A-Za-z0-9_]*/g)
        ?.filter((variable) => variable.toLowerCase() !== "and") ?? [];
    if (
      !selected.length ||
      selected.some((variable) => !names.includes(variable))
    )
      throw new Error(
        "Source domains must use the exact declared variable names",
      );
    return selected.map((variable) => `${variable}${relation}0`).join(" and ");
  };
  let result = text.replace(
    new RegExp(
      `\\b(?:real\\s+)?(${domain})\\s+(?:real\\s+)?(?:(?:[A-Za-z]{2,}\\s+){0,2}?(?:variables?|amounts?|quantities|values)\\s+)?(${list})\\b(?!\\s+(?:intercepts?|coefficients?|axes?|directions?))`,
      "gi",
    ),
    (_, word: string, variables: string) => expand(variables, word),
  );
  result = result.replace(
    new RegExp(
      `\\b(${list})\\s+(?:are\\s+|is\\s+|both\\s+)?(${domain})\\b`,
      "gi",
    ),
    (whole: string, variables: string, word: string, offset: number, source: string) =>
      hasLinearCoefficientSubject(source, offset + variables.length) ? whole : expand(variables, word),
  );
  const realDomain = (variables: string): string => {
    const selected =
      variables
        .match(/[A-Za-z][A-Za-z0-9_]*/g)
        ?.filter((variable) => variable.toLowerCase() !== "and") ?? [];
    if (
      !selected.length ||
      selected.some((variable) => !names.includes(variable))
    )
      throw new Error(
        "Real domains must use the exact declared variable names",
      );
    return " ";
  };
  result = result.replace(
    new RegExp(`\\breal\\s+(?:(?:variables?|quantities)\\s+)?(${list})\\b(?!\\s*(?:<=|>=|[<>=]|,\\s*${name}\\b|and\\s+${name}\\b))`, "gi"),
    (_, variables: string) => realDomain(variables),
  );
  result = result.replace(
    new RegExp(`\\b(${list})\\s+(?:are|is)\\s+real\\b`, "gi"),
    (_, variables: string) => realDomain(variables),
  );
  // A tuple comparison such as x,y>=0 distributes the scalar relation to both
  // declared variables, retaining every domain constraint in the source.
  result = result.replace(
    new RegExp(
      `\\b(${name}(?:\\s*,\\s*${name}){1,8})\\s*(<=|>=|<|>|=)\\s*([^,;?\\n]*)`,
      "g",
    ),
    (match: string, variables: string, relation: string, tail: string) => {
      const tokens = [
        ...tail.matchAll(
          /(?:\d+(?:\.\d+|\.(?=[eE][+-]?\d))?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[^\s]/g,
        ),
      ];
      let end = 0;
      for (const token of tokens) {
        const value = token[0];
        if (
          names.includes(value) ||
          /^(?:\d|\.\d)/.test(value) ||
          /^[()+*/-]$/.test(value)
        ) {
          end = token.index! + value.length;
          continue;
        }
        const prior = tail.slice(0, end).trim().at(-1);
        if (
          token.index === end ||
          /[+*/-]/.test(prior ?? "") ||
          /^[\^%!|[\]{}]$/.test(value)
        )
          throw new Error("Unsupported complete tuple-domain expression");
        break;
      }
      const affine = parseLinearAffine(tail.slice(0, end), names);
      if (affine.a.numerator !== "0" || affine.b.numerator !== "0")
        throw new Error("Tuple domains require a scalar expression");
      const value = `(${affine.constant.numerator}/${affine.constant.denominator})`;
      return (
        (variables.match(new RegExp(`\\b${name}\\b`, "g")) ?? [])
          .map((variable) => `${variable}${relation}${value}`)
          .join(" and ") + ` ${tail.slice(end)}`
      );
    },
  );
  return result;
}
/** A lexical math-span reader, independent of chapters, cue words and planner claims. */
function clauses(text: string, variables: readonly string[], sourcePointLabels: readonly string[] = [], comparisonsOnly = false): SourceClause[] {
  const lineNames = [...text.matchAll(/\b[A-Za-z][A-Za-z0-9_]*\s*:/g)]
    .flatMap(match => readLinearSourceLineName(text.slice(0, match.index! + match[0].length)) ?? []);
  const sourceNames = [...sourcePointLabels, ...lineNames];
  const tokens = [
    ...text.matchAll(
      /(?:\d+(?:\.\d+|\.(?=[eE][+-]?\d))?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|<=|>=|[<>=()+*/-]|[^\s]/g,
    ),
  ];
  const output: SourceClause[] = [];
  let chunk: RegExpMatchArray[] = [];
  const requestedAtom = (): boolean => {
    const first = chunk[0]!, last = chunk.at(-1)!;
    const before = text.slice(0, first.index);
    const after = text.slice(last.index! + last[0].length);
    if (chunk.length === 1 && variables.includes(first[0])) {
      const name = `(?:${variables.join("|")})`;
      const list = `${name}(?:\\s*(?:,|and)\\s*${name})*(?:\\s*(?:,|and)\\s*)?`;
      // Bare coordinate requests are nouns in a bounded request clause, not a
      // second graph expression. Arithmetic and display verbs cannot match.
      if (new RegExp(`\\b(?:find|determine|give|report|state|calculate|compute|solve)\\s+(?:(?:for|the|exact|values?|of|both)\\s+)*(?:${list})?$`, "i").test(before)
        && new RegExp(`^(?:\\s*(?:,|and)\\s*${name})*\\s*(?=[.;?!]|$)`, "i").test(after)) return true;
    }
    // Number-line membership questions may name a literal source scalar. It
    // is a query about the already-read set, not another source comparison.
    return variables.length === 1
      && (chunk.length === 1 && /^(?:\d|\.\d)/.test(first[0])
        || chunk.length === 2 && /^[+-]$/.test(first[0]) && /^(?:\d|\.\d)/.test(last[0]))
      && /\b(?:whether|is|does|do)\s*$/i.test(before)
      && /^\s*(?:belongs?|lies?|included|is|in|on)\b/i.test(after);
  };
  const flush = (): void => {
    if (!chunk.length) return;
    const relations = chunk.flatMap((token, i) =>
      /^(?:<=|>=|<|>|=)$/.test(token[0]) ? [i] : [],
    );
    if (relations.length) {
      const pieces: Array<{ start: number; end: number; text: string }> = [];
      let first = 0;
      for (const end of [...relations, chunk.length]) {
        let part = chunk.slice(first, end);
        first = end + 1;
        // Boolean grouping parentheses remain outside an affine clause. Balanced
        // arithmetic parentheses remain inside it and are parsed by the solver.
        let balance = part.reduce(
          (sum, token) =>
            sum + (token[0] === "(" ? 1 : token[0] === ")" ? -1 : 0),
          0,
        );
        while (balance > 0 && part[0]?.[0] === "(") {
          part = part.slice(1);
          balance--;
        }
        while (balance < 0 && part.at(-1)?.[0] === ")") {
          part = part.slice(0, -1);
          balance++;
        }
        const start = part[0]?.index ?? 0,
          finish =
            (part.at(-1)?.index ?? start) + (part.at(-1)?.[0].length ?? 0);
        pieces.push({ start, end: finish, text: text.slice(start, finish) });
      }
      relations.forEach((index, i) => {
        const left = pieces[i]!,
          right = pieces[i + 1]!,
          relation = chunk[index]![0];
        if (!left.text || !right.text)
          throw new Error(`Incomplete source comparison: '${left.text}${relation}${right.text}' at character ${chunk[index]!.index}`);
        output.push({
          text: `${left.text}${relation}${right.text}`,
          start: left.start,
          end: right.end,
          equality: relation === "=",
        });
      });
    } else if (comparisonsOnly && chunk.some(token => variables.includes(token[0])) && !requestedAtom())
      throw new Error("An unproved native-variable occurrence cannot be omitted from the source constraint inventory");
    else if (!comparisonsOnly && chunk.some((token) => !/^[()]$/.test(token[0])) && !requestedAtom())
      throw new Error("An additional source mathematical expression cannot be omitted from the complete linear program");
    chunk = [];
  };
  const prose = new Set(
    "graph graphs graphically solve shade show plot represent draw illustrate choose chooses choosing consider considering of for where when satisfy satisfies satisfying and or not with to solution set points in on at as subject such under given over using by then find determine state give report real if possible the a an all values xaxis yaxis coordinate plane line lines region common simultaneously respectively including whether has have is are belongs pair why meet cross its".split(
      " ",
    ),
  );
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const value = token[0];
    // A hyphen inside a prose compound is a word separator, not a new unary
    // affine term. Require an empty math chunk, adjacent multi-letter unknown
    // words and no math continuation; x-y, x<=foo-bar and foo-bar+x still fail.
    const previous = tokens[i - 1], next = tokens[i + 1];
    // A requested coordinate is a prose noun, not the affine subtraction
    // x-coordinate. Restrict to a complete request sentence, an empty math
    // chunk and a possessive/article; arithmetic continuations still refuse.
    const coordinateOffset = next?.[0] === "-" ? 2 : 1;
    const coordinate = tokens[i + coordinateOffset];
    if (variables.includes(value) && chunk.length === 0
      && /^(?:its|the)$/i.test(previous?.[0] ?? "")
      && coordinate?.[0] === "coordinate"
      && !/^(?:<=|>=|[<>=()+*/-])$/.test(tokens[i + coordinateOffset + 1]?.[0] ?? "")
      && /^(?:of\s+(?:(?:the|their)\s+intersection|[A-Za-z][A-Za-z0-9_]*))?$/i.test(text.slice(coordinate.index! + coordinate[0].length).split(/[.;?!]/, 1)[0]!.trim())
      && /\b(?:find|determine|give|report|state|calculate|compute)\s+(?:its|the)\s*$/i.test(text.slice(0, token.index))) {
      flush(); i += coordinateOffset; continue;
    }
    if (value === "-" && chunk.length === 0 && previous && next
      && /^[A-Za-z]{2,}$/.test(previous[0]) && /^[A-Za-z]{2,}$/.test(next[0])
      && !variables.includes(previous[0]) && !variables.includes(next[0])
      && previous.index! + previous[0].length === token.index
      && token.index! + 1 === next.index
      && !/^(?:<=|>=|[<>=()+*/-])$/.test(tokens[i + 2]?.[0] ?? "")) continue;
    if (
      variables.includes(value) ||
      /^(?:\d|\.\d)/.test(value) ||
      /^(?:<=|>=|[<>=()+*/-])$/.test(value)
    )
      chunk.push(token);
    else {
      const last = chunk.at(-1);
      const prosePunctuation = /^[,;:.?!'"`“”‘’]$/.test(value);
      const nextValue = tokens[i + 1]?.[0] ?? "";
      if (value === "." && last && /^(?:\d|\.\d)/.test(last[0]) && /^e$/i.test(nextValue)
        && token.index! + 1 === tokens[i + 1]!.index)
        throw new Error("Incomplete scientific exponent in original source comparison");
      if (/^[,:?]$/.test(value) && last && /^(?:\d|\.\d)/.test(last[0])
        && /^(?:\d|\.\d)/.test(nextValue)
        && chunk.some((part) => /^(?:<=|>=|[<>=])$/.test(part[0]))) {
        // A comma can separate complete affine comparisons; it cannot silently
        // turn an unsupported decimal comma or scalar ratio into a shorter RHS.
        let completeNextComparison = false;
        if (value === ",") for (const following of tokens.slice(i + 1)) {
          if (/^(?:<=|>=|[<>=])$/.test(following[0])) { completeNextComparison = true; break; }
          if (!variables.includes(following[0]) && !/^(?:\d|\.\d)/.test(following[0]) && !/^[()+*/-]$/.test(following[0])) break;
        }
        if (!completeNextComparison)
          throw new Error(`Ambiguous scalar punctuation in complete source comparison: '${last[0]}${value}${nextValue}' at character ${token.index}`);
      }
      if (/[\p{Sm}\p{No}\p{Lm}]/u.test(value)
        || (!/^[\p{L}_]/u.test(value) && !prosePunctuation
          && (chunk.length > 0 || variables.includes(nextValue) || /^(?:\d|\.\d)/.test(nextValue))))
        throw new Error(`Unsupported mathematical source symbol: '${value}' at character ${token.index}`);
      const mathematicalJoin =
        last &&
        (/^[+*/-]$/.test(last[0]) ||
          last.index! + last[0].length === token.index ||
          (/^[+*/]$/.test(tokens[i + 1]?.[0] ?? "") &&
            !["and", "or", "not"].includes(value.toLowerCase())));
      if (
        /^[\p{L}_]/u.test(value) &&
        (mathematicalJoin ||
          (value.length === 1 && !prose.has(value.toLowerCase()) && !sourceNames.includes(value)
            && /\b(?:graph|plot|draw|show|represent)\s+(?:(?:the|function|expression|graph|of)\s+)*$/i.test(text.slice(0, token.index))) ||
          (!prose.has(value.toLowerCase()) &&
            ((last && ((!comparisonsOnly || !/^[A-Za-z]{2,}$/.test(value)) && /^(?:\d|\.\d)/.test(last[0]) || value.length === 1)) ||
              /^[+*/(]$/.test(tokens[i + 1]?.[0] ?? "") ||
              (!comparisonsOnly && variables.includes(tokens[i + 1]?.[0] ?? "")))))
      ) {
        if (!mathematicalJoin && !last && value.length > 1
          && variables.includes(nextValue) && token.index! + value.length < tokens[i + 1]!.index! && !comparisonsOnly)
          throw new UnprovedLinearRequest(`Unconsumed request word '${value}' before an affine operand`);
        throw new Error(
          `Unknown variable or function in original source expression: '${value}' at character ${token.index}`,
        );
      }
      if (/^[\^%!|[\]{}]$/.test(value) && chunk.length)
        throw new Error("Unsupported mathematical source operator");
      flush();
    }
  }
  flush();
  // Every comparison must be consumed; an unknown variable or nonlinear source
  // clause cannot disappear behind a valid smaller substring.
  for (const match of text.matchAll(/<=|>=|<|>|=/g))
    if (
      !output.some(
        (clause) => match.index! >= clause.start && match.index! < clause.end,
      )
    )
      throw new Error("Unresolved mathematical source comparison");
  return output;
}
function booleanProgram(
  text: string,
  source: SourceClause[],
  sourcePointLabels: readonly string[] = [],
  allowConstraintSentences = false,
): IntervalExpression {
  if (!source.length)
    throw new Error("No explicit inequality program in source");
  // Chained comparisons share their middle affine term and mean intersection.
  const groups: SourceClause[][] = [];
  for (const clause of source) {
    const previous = groups.at(-1);
    if (previous && clause.start < previous.at(-1)!.end) previous.push(clause);
    else groups.push([clause]);
  }
  const atoms = groups.map((group) =>
    group.length === 1
      ? { inequality: group[0]!.text }
      : { intersection: group.map((clause) => ({ inequality: clause.text })) },
  ) as IntervalExpression[];
  // A trailing prose domain may restrict the entire union, rather than only
  // its final branch. That scope requires a grammar this reader does not own.
  let hasUnion = /\bunion\s+of\b/i.test(text.slice(0, groups[0]![0]!.start));
  for (let index = 0; index + 1 < groups.length; index++) {
    const gap = text.slice(groups[index]!.at(-1)!.end, groups[index + 1]![0]!.start);
    const explicitConnective = gap.replace(/\b(?:complement\s+of|and|or|union|intersection|not)\b/gi, "").replace(/[()\s]/g, "");
    if (hasUnion && explicitConnective.length > 0)
      throw new Error("A trailing source domain after a union has unresolved whole-set scope");
    if (/\bor\b|\bunion\b/i.test(gap)) hasUnion = true;
  }
  // No Boolean operand may disappear merely because it lacks a comparison.
  // Ordinary instructions such as "and label the axes" remain outside the
  // mathematical program, while "or x" and "or (x+y)" are incomplete math.
  const gaps = [text.slice(0, groups[0]![0]!.start), ...groups.map((group, index) => text.slice(group.at(-1)!.end, groups[index + 1]?.[0].start ?? text.length))];
  for (const [index, gap] of gaps.entries()) {
    // The first result noun after an action identifies its requested object.
    // A boundary request before its operand is not a shaded solution region;
    // an exclusive boundary request also cannot be a later annotation.
    const objects = gap.matchAll(/\b(?:graph|shade|show|plot|represent|draw|illustrate)\s+((?:[A-Za-z]+\s+)*?)(boundar(?:y|ies)|regions?|solutions?|sets?|points?|lines?)\b/gi);
    for (const object of objects)
      if (/^boundar/i.test(object[2]!) && (index === 0 || /\b(?:only|just)\b/i.test(object[1]!)))
        throw new UnprovedLinearRequest("The requested boundary object is not a filled solution set");
  }
  const names = [...sourcePointLabels, ...readLinearSourceIntersectionNames(text)];
  for (const clause of source) {
    const label = readLinearSourceLineName(text.slice(0, clause.start));
    if (label) names.push(label);
  }
  for (const [gapIndex, originalGap] of gaps.entries()) {
    let gap = originalGap;
    for (const name of names) gap = gap.replace(new RegExp(`\\b${name}\\s*:\\s*`, "g"), " ");
    // The article in "and a horizontal line" is not a Boolean variable a.
    // This bounded display instruction cannot hide a mathematical clause.
    gap = gap.replace(/\band\s+(?:a|the)\s+(?:vertical|horizontal)\s+line\b/gi, " ");
    if (sourcePointLabels.length) {
      const names = `(?:${sourcePointLabels.join("|")})`;
      gap = gap.replace(new RegExp(`\\band\\s+${names}\\s+(?:${LINEAR_SCALAR_VALUE_QUERY})\\b`, "g"), " ");
    }
    // A complete bare x/y result request is outside the set's Boolean program.
    // The sentence boundary prevents a comparison or arithmetic tail hiding
    // behind this noun phrase; those still remain mathematical source input.
    gap = gap.replace(/\b(?:find|determine|give|report|state|calculate|compute|solve)\s+(?:(?:for|the|exact|values?|of|both)\s+)*[xy](?:\s*(?:,|and)\s*[xy])*\s*(?=[.;?!]|$)/gi, " ");
    if (sourcePointLabels.length) {
      const labels = `(?:${sourcePointLabels.join("|")})`;
      // Proven original point labels in a membership question are references,
      // not Boolean operands. Bare "or P" remains an incomplete math operand.
      const membership = new RegExp(`\\b(?:[Ww]hich(?:\\s+of)?|[Ww]hether|[Dd]oes|[Dd]o)\\s+(?:points?\\s+)?${labels}(?:\\s*(?:,|and|or)\\s*${labels})*\\s+(?:belongs?|lies?|satisf(?:y|ies)|is|are)\\b`, "g");
      gap = gap.replace(membership, " ");
    }
    // A pure connective between two scanned operands is complete even when
    // the preceding operand closes a parenthesized group. The Boolean parser
    // below still owns balanced parentheses and the complete operator grammar.
    const completeConnective = gapIndex > 0 && gapIndex < gaps.length - 1
      && /^\s*(?:\)\s*)*(?:and|or)\s*(?:\(\s*)*$/i.test(gap);
    if (!completeConnective && (/\b(?:and|or|not)\b\s*\(*\s*(?:[+-]?\d|[A-Za-z](?:\b|\s*[+*/-]))/i.test(gap)
      || /(?:\b[A-Za-z]|\d|\))\s*\)*\s+\b(?:and|or)\b\s*$/i.test(gap)))
      throw new Error(`Incomplete Boolean mathematical operand in source gap: ${JSON.stringify(gap)}`);
  }
  // Every gap has to be understood, not merely skipped by the affine scanner.
  // Display locations between operands cannot be absorbed as a connective:
  // they may terminate one figure and introduce another.
  for (const gap of gaps.slice(1, -1)) {
    if (/\b(?:on|in)\s+(?:(?:a|the|one|same|coordinate|xy)\s+)*(?:number[ -]line|graphs?|axes|plane)\b/i.test(gap))
      throw new UnprovedLinearRequest("A display location between operands has unproved shared scope");
    if (/\bthen\b/i.test(gap))
      throw new UnprovedLinearRequest("Sequential or conditional operands have unproved Boolean scope");
  }
  const strictBoundary = source.some(clause => ["<", ">"].includes(/<=|>=|<|>|=/.exec(clause.text)?.[0] ?? ""));
  const prose = strictBoundary ? gaps.join(" ").replace(/\bstrict[- ]boundary\s+exclusion\b/gi, " ") : gaps.join(" ");
  consumeLinearRequest(prose, names);
  const lexemes: string[] = [];
  const context = text.slice(0, groups[0]![0]!.start);
  const complementWhole =
    /\b(?:complement\s+of\s+(?:(?:the\s+)?(?:common\s+)?(?:solution(?:\s+set)?|set|region)\s+(?:of|satisfying)\s+)?|(?:do|does)\s+not\s+satisfy\s+)\(*\s*$/i.test(context);
  const contextNegations = context.match(/\b(?:not|complement)\b/gi) ?? [];
  if (contextNegations.length > 1 || contextNegations.length === 1
    && !complementWhole && !/\bnot\s*\(*\s*$/i.test(context))
    throw new Error("Unsupported original source negation scope cannot be omitted");
  const complementAt = context.search(
    /\bcomplement\s+of\b|\b(?:do|does)\s+not\s+satisfy\b/i,
  );
  if (
    complementWhole &&
    (context.slice(0, complementAt).match(/\(/g) ?? []).length >
      (context.slice(0, complementAt).match(/\)/g) ?? []).length
  )
    throw new Error("Unsupported local complement scope in prose source");
  const unionWhole = /\bunion\s+of\b/i.test(context);
  if (/\bcomplement\b|\bnot\b/i.test(text.slice(source.at(-1)!.end)))
    throw new Error("Unsupported postfix complement source program");
  if (/\bnot\s*\(*\s*$/i.test(context)) lexemes.push("not");
  // Unbalanced outer Boolean parentheses are counted, not arithmetic ones.
  const opens =
    (context.match(/\(/g) ?? []).length - (context.match(/\)/g) ?? []).length;
  let level = Math.max(0, opens);
  for (let i = 0; i < Math.max(0, opens); i++) lexemes.push("(");
  const graphicalAction = /\b(?:graph|shade|show|plot|represent|draw|illustrate)\b/i;
  let hasGraphicalRequest = graphicalAction.test(context);
  groups.forEach((group, i) => {
    lexemes.push(String(i));
    const end = group.at(-1)!.end,
      next = groups[i + 1]?.[0].start;
    const gap = text.slice(end, next ?? text.length);
    if (next === undefined) {
      for (const ch of gap.match(/^\s*\)+/)?.[0] ?? "")
        if (ch === ")") lexemes.push(")");
      return;
    }
    const words = gap.toLowerCase();
    const negations = gap.match(/\b(?:not|complement)\b/gi) ?? [];
    if (negations.length > 1 || negations.length === 1
      && !/\b(?:not|complement\s+of)\s*\(*\s*$/i.test(gap))
      throw new Error("Unsupported local source negation scope cannot be omitted");
    if (/;|\bnumber[ -]line\b[^.;?!]*[.;?!]/i.test(gap)
      || !allowConstraintSentences && /[.?!]/.test(gap)
      || hasGraphicalRequest && graphicalAction.test(gap))
      throw new Error("Additional graphical source requests cannot become a Boolean intersection");
    hasGraphicalRequest ||= graphicalAction.test(gap);
    if (new RegExp(`\\b(?:${UNSUPPORTED_LINEAR_BOOLEAN_WORDS})\\b|!=|≠`).test(words))
      throw new Error("Unsupported source Boolean connective");
    for (const ch of gap.match(/^\s*\)+/)?.[0] ?? "")
      if (ch === ")") {
        lexemes.push(")");
        level--;
      }
    lexemes.push(
      (unionWhole && level === 0) || /\bor\b|\bunion\b|∪/.test(words)
        ? "or"
        : "and",
    );
    if (/\bnot\b|\bcomplement\s+of\b/.test(words)) lexemes.push("not");
    for (const ch of gap.match(/\(+\s*$/)?.[0] ?? "")
      if (ch === "(") {
        lexemes.push("(");
        level++;
      }
  });
  let cursor = 0;
  const atom = (): IntervalExpression => {
    const token = lexemes[cursor++];
    if (token === "not") return { complement: atom() };
    if (token === "(") {
      const result = union();
      if (lexemes[cursor++] !== ")")
        throw new Error("Unbalanced source Boolean parentheses");
      return result;
    }
    if (token === undefined || !/^\d+$/.test(token))
      throw new Error("Incomplete source Boolean expression");
    return atoms[Number(token)]!;
  };
  const intersection = (): IntervalExpression => {
    const values = [atom()];
    while (lexemes[cursor] === "and") {
      cursor++;
      values.push(atom());
    }
    return values.length === 1 ? values[0]! : { intersection: values };
  };
  const union = (): IntervalExpression => {
    const values = [intersection()];
    while (lexemes[cursor] === "or") {
      cursor++;
      values.push(intersection());
    }
    return values.length === 1 ? values[0]! : { union: values };
  };
  const result = union();
  if (cursor !== lexemes.length)
    throw new Error("Unresolved source Boolean suffix");
  return complementWhole ? { complement: result } : result;
}

/** Parse the requested set before applying independently typed global domains. */
function scopedSourceProgram(text: string, source: SourceClause[], labels: readonly string[], question: string, names: readonly string[], allowConstraintSentences = true): IntervalExpression {
  let program: IntervalExpression;
  const scopes = [...text.matchAll(/\bsubject\s+to\b/gi)].filter(match => source.some(clause => clause.end <= match.index!) &&
    source.some(clause => clause.start >= match.index! + match[0].length));
  if (scopes.length) {
    const scope = scopes[0]!, offset = scope.index! + scope[0].length, prefix = text.slice(0, scope.index);
    if (scopes.length !== 1 || (prefix.match(/\(/g)?.length ?? 0) !== (prefix.match(/\)/g)?.length ?? 0))
      throw new UnprovedLinearRequest("The source domain has unresolved local Boolean scope");
    if (/\b(?:graph|shade|show|plot|represent|draw|illustrate)\b/i.test(prefix) &&
      /\b(?:graph|shade|show|plot|represent|draw|illustrate)\b/i.test(text.slice(offset)))
      throw new UnprovedLinearRequest("Separate graphical requests cannot share a source-domain scope");
    program = { intersection: [booleanProgram(prefix, source.filter(clause => clause.end <= scope.index!), labels, allowConstraintSentences),
      booleanProgram(text.slice(offset), source.filter(clause => clause.start >= offset).map(clause => ({ ...clause, start: clause.start - offset, end: clause.end - offset })), labels, allowConstraintSentences)] };
  } else program = booleanProgram(text, source, labels, allowConstraintSentences);
  const domains = firstQuadrantDomains(question, names).filter(clause => clause.domainScope === "global");
  if (!domains.length) return program;
  source.push(...domains);
  return { intersection: [program, ...domains.map(clause => ({ inequality: clause.text }))] };
}
function signatures(
  expressions: readonly string[],
  names: readonly string[],
  equalityOnly = false,
): string[] {
  return [...new Set(expressions.flatMap((expression) =>
      parseLinearConstraint(expression, names, equalityOnly).map(
        linearConstraintSignature,
      ),
    ))].sort();
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function isIntersectionProgram(program: IntervalExpression): boolean {
  return (
    "inequality" in program ||
    ("intersection" in program &&
      program.intersection.every(isIntersectionProgram))
  );
}
function inequalityLeaves(program: IntervalExpression): string[] {
  if ("inequality" in program) return [program.inequality];
  if ("complement" in program) return inequalityLeaves(program.complement);
  return ("union" in program ? program.union : program.intersection).flatMap(inequalityLeaves);
}
/** Exact DNF under a small explicit budget; null is an unfinished proof. */
function planarBranches(program: IntervalExpression, negate = false): string[][] | null {
  if ("complement" in program) return planarBranches(program.complement, !negate);
  if ("inequality" in program) {
    if (!negate) return [[program.inequality]];
    const relation = /<=|>=|<|>|=/.exec(program.inequality);
    if (!relation) return null;
    const operators = relation[0] === "=" ? ["<", ">"] : [{ "<=": ">", ">=": "<", "<": ">=", ">": "<=" }[relation[0]]!];
    return operators.map(operator => [program.inequality.slice(0, relation.index) + operator + program.inequality.slice(relation.index + relation[0].length)]);
  }
  const union = "union" in program;
  const children = union ? program.union : program.intersection;
  const branches = children.map(child => planarBranches(child, negate));
  if (branches.some(branch => branch === null)) return null;
  if (union !== negate) {
    const values = (branches as string[][][]).flat();
    return values.length <= 32 ? values : null;
  }
  let result: string[][] = [[]];
  for (const child of branches as string[][][]) {
    if (result.length * child.length > 32) return null;
    result = result.flatMap(left => child.map(right => [...left, ...right]));
  }
  return result;
}

/** Preserve every exact source predicate after its own Boolean polarity. */
function planarPredicates(program: IntervalExpression, negate = false): string[] | null {
  if ("complement" in program) return planarPredicates(program.complement, !negate);
  if ("inequality" in program) return planarBranches(program, negate)?.flat() ?? null;
  const children = "union" in program ? program.union : program.intersection;
  const predicates = children.map(child => planarPredicates(child, negate));
  return predicates.some(child => child === null) ? null : (predicates as string[][]).flat();
}

/** A feasible symmetric-difference witness proves a Boolean contradiction. */
function planarBooleanAgreement(program: IntervalExpression, proposed: string[], variables: readonly string[]): boolean | null {
  if (variables.length !== 2) return null;
  const source = planarBranches(program), outsideSource = planarBranches(program, true);
  const candidate: IntervalExpression = { intersection: proposed.map(inequality => ({ inequality })) };
  const outsideCandidate = planarBranches(candidate, true);
  if (!source || !outsideSource || !outsideCandidate) return null;
  for (const [left, right] of [[source, outsideCandidate], [[proposed], outsideSource]] as const) {
    for (const a of left) for (const b of right) {
      // Conjunction is idempotent, including exactly scaled affine rows.
      // Deduplicate only proved-identical predicates before the native budget;
      // an unfinished witness search must never authorize a Boolean region.
      const constraints = [...new Map([...a, ...b].map(expression =>
        [JSON.stringify(signatures([expression], variables)), expression])).values()];
      if (constraints.length > 16) return null;
      const solution = solveLinearFigure({ kind: "linear_feasible_region", variables: [variables[0]!, variables[1]!], constraints });
      if (solution.kind !== "linear_feasible_region") return null;
      if (solution.feasibility.feasible) return false;
    }
  }
  return true;
}
/** Named real set builders and their explicit Boolean result definitions. */
function setBuilderSourceProgram(body: string, variable: string, setAliases?: Set<string>, roleProof?: { residual: string }): IntervalExpression | null {
  const bindings = new Map<string, IntervalExpression>();
  const spans: Array<{ start: number; end: number }> = [];
  const mask = (text: string, ranges: Array<{ start: number; end: number }>): string => {
    for (const span of ranges.slice().sort((a, b) => b.start - a.start)) text = text.slice(0, span.start) + " ".repeat(span.end - span.start) + text.slice(span.end);
    return text;
  };
  for (const match of body.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*\{\s*([A-Za-z][A-Za-z0-9_]*)(?:\s+in\s+(?:R|ℝ))?\s*:\s*([^{}]+)\}/g)) {
    if (match[2] !== variable || match[1] === variable || bindings.has(match[1]!)) throw new Error("Named set builders require one unambiguous declared real variable");
    const content = match[3]!;
    bindings.set(match[1]!, booleanProgram(content, clauses(content, [variable])));
    spans.push({ start: match.index!, end: match.index! + match[0].length });
    if (bindings.size > 16) throw new Error("Source named sets exceed 16 definitions");
    // The literal's real-set type is proved even if a later request is not.
    if (roleProof) roleProof.residual = mask(body, spans);
  }
  if (!bindings.size) return null;
  let residual = mask(body, spans);
  if (/[{}[\]]/.test(residual)) throw new Error("Every original set builder must be consumed completely");
  const read = (text: string): { program: IntervalExpression; end: number } => {
    const tokens = [...text.matchAll(/[A-Za-z][A-Za-z0-9_]*|[^\s]/g)];
    let cursor = 0;
    const word = () => tokens[cursor]?.[0].toLowerCase();
    const atom = (): IntervalExpression => {
      if (word() === "not" || word() === "complement") {
        cursor++; if (word() === "of") cursor++;
        return { complement: atom() };
      }
      if (word() === "(") { cursor++; const value = union(); if (word() !== ")") throw new Error("Unbalanced named-set expression"); cursor++; return value; }
      const token = tokens[cursor++];
      if (!token || !bindings.has(token[0])) throw new Error(`Unknown original named-set operand ${token?.[0]}`);
      return bindings.get(token[0])!;
    };
    const intersection = (): IntervalExpression => {
      let value = atom();
      while (["and", "intersect", "intersection", "minus"].includes(word() ?? "")) {
        const operation = word(); cursor++;
        const next = atom();
        value = { intersection: [value, operation === "minus" ? { complement: next } : next] };
      }
      return value;
    };
    const union = (): IntervalExpression => {
      let value = intersection();
      while (["or", "union"].includes(word() ?? "")) { cursor++; value = { union: [value, intersection()] }; }
      return value;
    };
    const program = union(), last = tokens[cursor - 1]!;
    const rest = text.slice(last.index! + last[0].length);
    if (rest.trimStart() && !/^(?:\s*[,;:.?!]|\s+(?:on|with|where|and\s+(?:draw|label|mark|state|classify))\b)/i.test(rest))
      throw new Error("Unsupported continuation of complete named-set expression");
    return { program, end: last.index! + last[0].length };
  };
  const results: IntervalExpression[] = [], resultSpans: Array<{ start: number; end: number }> = [];
  for (const definition of residual.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*/g)) {
    const label = definition[1]!;
    if (label === variable || bindings.has(label)) throw new Error("A source set result cannot redefine its givens");
    const start = definition.index! + definition[0].length;
    const selected = read(residual.slice(start));
    bindings.set(label, selected.program); results.push(selected.program);
    resultSpans.push({ start: definition.index!, end: start + selected.end });
    // Record only the exact expression consumed by the existing typed parser.
    if (roleProof) roleProof.residual = mask(roleProof.residual, [resultSpans.at(-1)!]);
  }
  if (results.length !== 1) throw new Error("Named set builders require one explicit complete result expression");
  residual = mask(residual, resultSpans);
  // A stated definition of set difference/intersection is independently
  // checked before its membership prose can be removed from the math spans.
  residual = residual.replace(/\b(?:Here\s+)?([A-Za-z][A-Za-z0-9_]*)\s+(minus|union|intersect(?:ion)?)\s+([A-Za-z][A-Za-z0-9_]*)\s+means\s+x\s+is\s+in\s+([A-Za-z][A-Za-z0-9_]*)\s+(AND|OR)\s+x\s+is\s+(not\s+)?in\s+([A-Za-z][A-Za-z0-9_]*)\s*(?=[.;?!]|$)/gi,
    (whole, a: string, operation: string, b: string, c: string, connective: string, negation: string | undefined, d: string) => {
      if (![a, b, c, d].every(name => bindings.has(name))) throw new Error("Set membership explanation uses an unknown source set");
      const lhs: IntervalExpression = /union/i.test(operation) ? { union: [bindings.get(a)!, bindings.get(b)!] } : { intersection: [bindings.get(a)!, /minus/i.test(operation) ? { complement: bindings.get(b)! } : bindings.get(b)!] };
      const right = negation ? { complement: bindings.get(d)! } : bindings.get(d)!;
      const rhs: IntervalExpression = /or/i.test(connective) ? { union: [bindings.get(c)!, right] } : { intersection: [bindings.get(c)!, right] };
      const solve = (expression: IntervalExpression) => solveLinearFigure({ kind: "number_line_set", variable, expression });
      if (!same(solve(lhs), solve(rhs))) throw new Error("Original set-membership explanation contradicts its Boolean definition");
      return " ".repeat(whole.length);
    });
  if (clauses(residual, [variable]).length) throw new Error("Additional source comparisons cannot be omitted from a named-set program");
  // Definitions and the one result expression own all parsed operation spans.
  // A remaining operator adjacent to a bound set is another mathematical
  // request, regardless of identifier length; prose consumption cannot own it.
  const remaining = [...residual.matchAll(/[A-Za-z][A-Za-z0-9_]*|[^\s]/g)]
    .map(token => token[0]).filter(token => !["(", ")", "of"].includes(token.toLowerCase()));
  for (let i = 0; i < remaining.length; i++) {
    const operation = remaining[i]!.toLowerCase();
    const before = bindings.has(remaining[i - 1] ?? ""), after = bindings.has(remaining[i + 1] ?? "");
    if (["union", "intersection", "intersect", "minus", "complement", "not"].includes(operation) && (before || after)
      || ["and", "or"].includes(operation) && before && after)
      throw new UnprovedLinearRequest("An additional named-set operation has no consumed source span");
  }
  consumeLinearRequest(residual, [...bindings.keys()]);
  for (const label of bindings.keys()) setAliases?.add(label);
  if (roleProof) roleProof.residual = residual;
  return results[0]!;
}
/** Bounded named interval literals are another spelling of the same real sets. */
function intervalSourceProgram(body: string, variable: string, setAliases?: Set<string>, intervalRoles?: Map<string, LinearSourceIntervalRole>, roleProof?: { residual: string }): IntervalExpression | null {
  const bindings = new Map<string, IntervalExpression>();
  const roles = new Map<string, LinearSourceIntervalRole>();
  const spans: Array<{ start: number; end: number }> = [];
  for (const definition of body.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*([[(])/g)) {
    const label = definition[1]!;
    if (label === variable || label.length > 32) throw new Error("Invalid named interval source identifier");
    const opening = definition[2]!, start = definition.index! + definition[0].length;
    let depth = 0, end = start, comma = -1;
    for (; end < body.length; end++) {
      const ch = body[end]!;
      if (ch === "(" ) depth++;
      else if (ch === ")" && depth > 0) depth--;
      else if ((ch === ")" || ch === "]") && depth === 0) break;
      else if (ch === "," && depth === 0) {
        if (comma !== -1) throw new Error(`Interval ${label} requires exactly two endpoints`);
        comma = end;
      }
      if (depth > 24) throw new Error("Source interval endpoint nesting exceeds 24");
    }
    if (end >= body.length || comma === -1 || depth !== 0)
      throw new Error(`Interval ${label} requires a complete two-endpoint literal`);
    const endpoint = (text: string): string | "-infinity" | "infinity" => {
      const raw = text.trim();
      if (/^-\s*(?:infinity|infty|∞)$/i.test(raw)) return "-infinity";
      if (/^\+?\s*(?:infinity|infty|∞)$/i.test(raw)) return "infinity";
      const affine = parseLinearAffine(raw, [variable]);
      if (affine.a.numerator !== "0" || affine.b.numerator !== "0")
        throw new Error(`Interval ${label} endpoints must be exact scalar givens`);
      return `(${affine.constant.numerator}/${affine.constant.denominator})`;
    };
    const lower = endpoint(body.slice(start, comma)), upper = endpoint(body.slice(comma + 1, end));
    const closing = body[end]!;
    if (lower === "infinity" || upper === "-infinity" || (lower === "-infinity" && opening !== "(") || (upper === "infinity" && closing !== ")"))
      throw new Error(`Interval ${label} has invalid infinity orientation or inclusion`);
    const leaves: IntervalExpression[] = [];
    if (lower !== "-infinity") leaves.push({ inequality: `${variable}${opening === "[" ? ">=" : ">"}${lower}` });
    if (upper !== "infinity") leaves.push({ inequality: `${variable}${closing === "]" ? "<=" : "<"}${upper}` });
    const program: IntervalExpression = leaves.length === 0 ? { inequality: "0<=1" } : leaves.length === 1 ? leaves[0]! : { intersection: leaves };
    if (bindings.has(label)) throw new Error(`Interval ${label} has repeated source definitions`);
    bindings.set(label, program);
    if (intervalRoles) roles.set(label, { definition: body.slice(definition.index!, end + 1),
      ...(lower === "-infinity" ? {} : { lower: parseLinearAffine(lower, [variable]).constant }),
      ...(upper === "infinity" ? {} : { upper: parseLinearAffine(upper, [variable]).constant }),
      lowerIncluded: opening === "[", upperIncluded: closing === "]" });
    if (bindings.size > 16) throw new Error("Source named intervals exceed 16 definitions");
    if (/^(?:<=|>=|[<>=+*/^%!|[\]{}-])/.test(body.slice(end + 1).trimStart()))
      throw new Error(`Interval ${label} has an unsupported literal operation`);
    spans.push({ start: definition.index!, end: end + 1 });
  }
  if (bindings.size === 0) return null;
  let residual = body;
  for (const span of spans.reverse()) residual = residual.slice(0, span.start) + " ".repeat(span.end - span.start) + residual.slice(span.end);
  residual = residual.replace(/\belements\s+in\s+([A-Za-z][A-Za-z0-9_]*)\s+but\s+outside\s+([A-Za-z][A-Za-z0-9_]*)\b/gi,
    (_, first: string, second: string) => {
      if (!bindings.has(first) || !bindings.has(second)) throw new Error("Set difference requires two proved continuous interval operands");
      return `${first} intersection not (${second})`;
    });
  if (["[", "]", "{", "}"].some((character) => residual.includes(character)))
    throw new Error("Unconsumed interval or unsupported source set literal");
  const namedOperands = [
    ...residual.matchAll(/\b(?:union|intersection|complement\s+of)\s+(?:(?:not|complement\s+of)\s*\(*\s*)?(?!of\b)([A-Za-z][A-Za-z0-9_]*)/gi),
    ...residual.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s+(?:union|intersection)\b/gi),
    ...residual.matchAll(/[∪∩]\s*([A-Za-z][A-Za-z0-9_]*)/g),
    ...residual.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*[∪∩]/g),
  ];
  for (const named of namedOperands) {
    const label = named[1]!;
    if (!bindings.has(label)) throw new Error(`Unknown named set in source program: ${label}`);
  }
  const boundNames = [...bindings.keys()].join("|");
  const connectiveNeighbors = [
    ...residual.matchAll(new RegExp(`\\b(?:${boundNames})\\b\\s*\\)*\\s+(?:and|or)\\s*\\(*\\s*([A-Za-z][A-Za-z0-9_]*)`, "gi")),
    ...residual.matchAll(new RegExp(`\\b([A-Za-z][A-Za-z0-9_]*)\\s*\\)*\\s+(?:and|or)\\s*\\(*\\s*(?:${boundNames})\\b`, "gi")),
  ];
  const proseActions = new Set("show state represent graph plot draw find give explain report determine".split(" "));
  for (const operand of connectiveNeighbors)
    if (!bindings.has(operand[1]!) && !proseActions.has(operand[1]!.toLowerCase()))
      throw new Error(`Unknown named set in source program: ${operand[1]}`);
  if (new RegExp(`\\b(?:${UNSUPPORTED_LINEAR_INTERVAL_BOOLEAN_WORDS})\\b`, "i").test(residual) || /[∖\\]/i.test(residual))
    throw new Error("Unsupported named-interval source connective");
  const references: SourceClause[] = [...residual.matchAll(/\b[A-Za-z][A-Za-z0-9_]*\b/g)]
    .filter((match) => bindings.has(match[0]))
    .map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length, equality: false }));
  if (!references.length) throw new Error("Source must request a complete named-interval program");
  if (new Set(references.map(reference => reference.text)).size !== references.length)
    throw new Error("Repeated named-interval operands require an unambiguous single result request");
  const replace = (program: IntervalExpression): IntervalExpression => {
    if ("inequality" in program) return bindings.get(program.inequality)!;
    if ("complement" in program) return { complement: replace(program.complement) };
    return "union" in program ? { union: program.union.map(replace) } : { intersection: program.intersection.map(replace) };
  };
  const selected = replace(booleanProgram(residual, references));
  for (const reference of references.slice().reverse())
    residual = residual.slice(0, reference.start) + " ".repeat(reference.end - reference.start) + residual.slice(reference.end);
  const domains = clauses(residual, [variable]);
  if (domains.length) throw new Error("Mixed named-interval and explicit inequality source programs require an explicit shared Boolean grammar");
  for (const label of bindings.keys()) setAliases?.add(label);
  for (const [label, role] of roles) intervalRoles?.set(label, role);
  if (roleProof) roleProof.residual = residual;
  return selected;
}

/** Whole real-set names from an independently admitted complete source program. */
export function readLinearSourceSetAliases(question: string): Set<string> {
  return readLinearSourceSetRoles(question).aliases;
}

/** Original set types and interval definitions; never planner scalar meanings. */
export function readLinearSourceSetRoles(question: string): { aliases: Set<string>; intervals: Map<string, LinearSourceIntervalRole> } {
  const empty = () => ({ aliases: new Set<string>(), intervals: new Map<string, LinearSourceIntervalRole>() });
  if (buildLinearSourceDocument(question)?.constructions[0]?.operator !== "number_line_set") return empty();
  try {
    const normalized = normalize(question);
    assertLinearSourceGrammar(normalized);
    const body = readLinearSourceReferencePoints(explicitDomains(canonicalRealDomainSource(normalized, ["x"]), ["x"]), ["x"]).maskedQuestion;
    const aliases = new Set<string>();
    const intervals = new Map<string, LinearSourceIntervalRole>();
    if (!setBuilderSourceProgram(body, "x", aliases)) intervalSourceProgram(body, "x", aliases, intervals);
    for (const name of body.matchAll(/\bsolution\s+set\s+(?:(?:named|called|denoted\s+by)\s+)?([A-Za-z][A-Za-z0-9_]*)\s*(?=of\b|for\b|on\b|satisfying\b|=|:|[.;?!]|$)/gi)) {
      if (name[1] !== "x") aliases.add(name[1]!);
    }
    return { aliases, intervals };
  } catch { return empty(); }
}
interface SourceObjective {
  expression: string;
  sense: "max" | "min";
  start: number;
  end: number;
  label?: string;
}
/** Closed prose grammar for the native two-line graphical solution builder. */
function hasNativeSystemRequest(body: string, source: SourceClause[], pointLabels: readonly string[]): boolean {
  const names = new Set([...pointLabels, ...readLinearSourceIntersectionNames(body)]);
  let prose = body;
  for (const clause of source.slice().reverse()) {
    const label = readLinearSourceLineName(body.slice(0, clause.start));
    if (label) names.add(label);
    prose = prose.slice(0, clause.start) + " ".repeat(clause.end - clause.start) + prose.slice(clause.end);
  }
  // Only names already declared by an equation or intersection can be nouns.
  const words = new Set((
    "teach me how the two graphs and show a unique solution explain graphical system whose crossing has fractional coordinates keep intersection exact graphically why have no common help see of using vertical line horizontal solve pair by method label their point lines meet at both find its x coordinate for real y many solutions does use to determine number describe them cross in simultaneous with names simplified equations intercepts classify state full set equivalent where they exist from figure there are " +
    "please graph draw sketch represent plot mark give report calculate compute all every each value values count one none infinitely infinite parallel coincident consistent inconsistent dependent independent is which this these those it them on xy plane as then also"
  ).split(" "));
  for (const token of prose.matchAll(/[A-Za-z][A-Za-z0-9_]*|[^\s]/g)) {
    if (names.has(token[0]) || words.has(token[0].toLowerCase()) || /^[,;:.?!()'"-]$/.test(token[0])) continue;
    return false;
  }
  // Calculation verbs must request one of the native result roles; the
  // surrounding display vocabulary cannot turn a different result into one.
  const resultNouns = /^(?:(?:the|their|its|both|exact|full|complete|common|values?|of|for)\s+)*(?:[xy]\b|(?:point\s+of\s+)?intersection\b|coordinates?\b|intercepts?\b|(?:number|count)\s+of\s+solutions\b|solutions?(?:\s+set)?\b|where\s+they\s+(?:meet|cross)\b)/i;
  for (const action of prose.matchAll(/\b(?:find|determine|give|report|state|calculate|compute)\b/gi)) {
    if (!resultNouns.test(prose.slice(action.index! + action[0].length).trimStart())) return false;
  }
  for (const query of prose.matchAll(/\b(?:how\s+many|count)\b/gi)) {
    if (/^\s+of\s+solutions\b/i.test(prose.slice(query.index! + query[0].length))) continue;
    if (!/^\s+(?:the\s+)?solutions\b/i.test(prose.slice(query.index! + query[0].length))) return false;
  }
  return true;
}

export interface LinearSourceSystemLabels {
  lines: Array<{ names: string[]; interceptAxes: Array<"x" | "y"> }>;
  intersectionName?: string;
}

/** Source names join complete, equivalent equations; candidate row order supplies no identity. */
export function readLinearSourceSystemLabels(
  question: string,
  input: Extract<LinearFigureInput, { kind: "linear_system" }>,
): LinearSourceSystemLabels {
  if (typeof question !== "string" || question.length > 2000)
    throw new Error("System labels require bounded original source text");
  const variables = input.variables ?? ["x", "y"];
  const authority = readLinearBindingSource(question, variables, false);
  if (!authority || !isIntersectionProgram(authority.program))
    return { lines: input.equations.map(() => ({ names: [], interceptAxes: [] })) };
  const normalized = normalize(question);
  assertLinearSourceGrammar(normalized);
  const references = readLinearSourceReferencePoints(explicitDomains(canonicalRealDomainSource(normalized, variables), variables), variables);
  const body = references.maskedQuestion.replace(/\b([A-Za-z][A-Za-z0-9_]*)\s*∈\s*ℝ/g, (_, variable: string) => {
    if (!variables.includes(variable)) throw new Error("Real domain must use a declared variable");
    return " ";
  });
  const source = clauses(body, variables, references.points.map(point => point.label));
  const program = booleanProgram(body, source, references.points.map(point => point.label), true);
  if (source.length !== 2 || !source.every(clause => clause.equality)
    || !isIntersectionProgram(program)
    || !same(signatures(source.map(clause => clause.text), variables, true), signatures(input.equations, variables, true)))
    throw new Error("System labels require the complete equivalent original two-equation program");
  const identity = (equation: string): string => JSON.stringify(signatures([equation], variables, true));
  const owners = source.map(clause => ({
    identity: identity(clause.text),
    name: readLinearSourceLineName(body.slice(0, clause.start)),
  }));
  const declared = new Map<string, string>();
  for (const owner of owners) {
    if (!owner.name) continue;
    if (owner.name.length > 32 || variables.includes(owner.name) || references.points.some(point => point.label === owner.name)
      || declared.has(owner.name) && declared.get(owner.name) !== owner.identity)
      throw new Error("Original line names must have one unambiguous geometric owner");
    declared.set(owner.name, owner.identity);
  }
  let prose = body;
  for (const clause of source.slice().reverse())
    prose = prose.slice(0, clause.start) + " ".repeat(clause.end - clause.start) + prose.slice(clause.end);
  const requested = new Map<string, Set<"x" | "y">>();
  for (const sentence of prose.split(/[.;?!]|(?:\band\s+|,\s*)(?=(?:label|mark|find|determine|give|report|state|calculate|compute)\b)/i)) {
    const action = /\b(?:label|mark|find|determine|give|report|state|calculate|compute)\b/i.exec(sentence);
    const request = action ? sentence.slice(action.index) : "";
    if (!/\bintercepts?\b/i.test(request)) continue;
    const mentioned = [...declared.keys()].filter(name => new RegExp(`\\b${name}\\b`).test(request));
    const all = !mentioned.length || /\btheir\b|\b(?:both|all|every|each)\s+(?:the\s+)?lines?\b/i.test(request);
    const axes: Array<"x" | "y"> = /\bx[- ]intercepts?\b/i.test(request) && !/\by[- ]intercepts?\b/i.test(request) ? ["x"]
      : /\by[- ]intercepts?\b/i.test(request) && !/\bx[- ]intercepts?\b/i.test(request) ? ["y"] : ["x", "y"];
    for (const owner of owners) if (all || owner.name && mentioned.includes(owner.name)) {
      const selected = requested.get(owner.identity) ?? new Set<"x" | "y">();
      axes.forEach(axis => selected.add(axis)); requested.set(owner.identity, selected);
    }
  }
  const intersectionNames = [...readLinearSourceIntersectionNames(body)];
  if (intersectionNames.length > 1 || intersectionNames.some(name => name.length > 32 || variables.includes(name) || declared.has(name)))
    throw new Error("Original intersection name must have one unambiguous geometric owner");
  return {
    lines: input.equations.map(equation => {
      const key = identity(equation);
      return { names: [...declared].filter(([, owner]) => owner === key).map(([name]) => name), interceptAxes: [...(requested.get(key) ?? [])] };
    }),
    ...(intersectionNames[0] ? { intersectionName: intersectionNames[0] } : {}),
  };

}
/** Complete affine operand reader shared by objective authority and name roles. */
function readLinearSourceAffineExpression(body: string, names: readonly string[], start: number): { expression: string; end: number } | null {
  const tail = body.slice(start);
  const tokens = [...tail.matchAll(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[^\s]/g)];
  const delimiters = new Set("subject such under where given over with for and constraints using by on then find show determine state give report if is are has maximum minimum maximized minimised minimized maximised".split(" "));
  let end = 0;
  for (const token of tokens) {
    const value = token[0];
    if (delimiters.has(value.toLowerCase()) || /^[,;:.?]$/.test(value)) break;
    if (!names.includes(value) && !/^(?:\d|\.\d)/.test(value) && !/^[()+*/-]$/.test(value)) {
      if (end === 0) return null; // an unrelated prose mention, e.g. finite maximum
      throw new Error(`Unsupported variable or operator in complete source objective: '${value}' at character ${start + token.index!}`);
    }
    end = token.index! + value.length;
  }
  if (end === 0) return null;
  const expression = tail.slice(0, end).trim();
  parseLinearAffine(expression, names);
  const continuation = /^\s+and\s+([^,;?.]*)/i.exec(body.slice(start + end))?.[1];
  if (continuation && /^(?:[+-]?\d|\(|[A-Za-z]\b)/.test(continuation.trim()) && !/[<>=]/.test(continuation))
    throw new Error("Source objective has an unsupported additional affine operand");
  return { expression, end: start + end };
}

/** Read an affine objective completely, separately from its prose direction. */
function sourceObjective(body: string, names: readonly string[]): SourceObjective {
  const directionPattern = /\b(?:maximi[sz](?:e[ds]?|ing|ation)|minimi[sz](?:e[ds]?|ing|ation)|maximum|minimum|max|min)\b/gi;
  const directions = [...body.matchAll(directionPattern)];
  if (!directions.length) throw new Error("Objective direction is not explicit in source");
  const sense = (word: string): "max" | "min" => /^max/i.test(word) ? "max" : "min";
  const targetOf = (direction: RegExpMatchArray): string | undefined => /^\s*(?:(?:the|objective|function|constant|value|of)\s+)*(?:(?:profit|cost|revenue)\s+(?=[A-Za-z][A-Za-z0-9_]*\s*=))?([A-Za-z][A-Za-z0-9_]*)\b/i.exec(body.slice(direction.index! + direction[0].length))?.[1];
  const aliasesFor = (label: string | undefined): string[] => label ? [...body.matchAll(new RegExp(`\\b([A-Za-z][A-Za-z0-9_]*)\\s+(?:is|=)\\s+${label}\\s*=`, "g"))].map((alias) => alias[1]!.toLowerCase()) : [];
  const postfixDirection = (direction: RegExpMatchArray, expressionEnd: number): boolean => direction.index! >= expressionEnd && /^\s*(?:is|are)?\s*$/i.test(body.slice(expressionEnd, direction.index!));
  const readExpression = (start: number) => readLinearSourceAffineExpression(body, names, start);
  const candidates: SourceObjective[] = [];
  for (const direction of directions) {
    const after = direction.index! + direction[0].length;
    const descriptor = /^\s*(?:(?:the|objective|function|constant|value|of)\s+)*(?:(?:profit|cost|revenue)\s+(?=[A-Za-z][A-Za-z0-9_]*\s*=))?(?:[A-Za-z][A-Za-z0-9_]*\s*=\s*)?/i.exec(body.slice(after))!;
    const expression = readExpression(after + descriptor[0].length);
    if (expression) candidates.push({ ...expression, sense: sense(direction[0]), start: direction.index! });
  }
  if (candidates.length === 0) {
    // A source may define Z first and request its maximum afterwards. A unique
    // non-axis scalar definition and an unambiguous direction are required;
    // unrelated assignments and contradictory directions cannot be discarded.
    for (const definition of body.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*/g)) {
      if (names.includes(definition[1]!)) continue;
      const expression = readExpression(definition.index! + definition[0].length);
      if (!expression) throw new Error("Unresolved source objective definition");
      const label = definition[1]!, aliases = aliasesFor(label);
      const boundDirections = directions.filter((direction) => {
        const target = targetOf(direction);
        return target === label || (target && aliases.includes(target.toLowerCase())) || postfixDirection(direction, expression.end);
      });
      if (!boundDirections.length) throw new Error(`Objective direction is not bound to source definition ${label}`);
      const senses = new Set(boundDirections.map((direction) => sense(direction[0])));
      if (senses.size !== 1) throw new Error("Source objective direction is ambiguous");
      candidates.push({ ...expression, sense: [...senses][0]!, start: definition.index! });
    }
  }
  if (candidates.length !== 1) throw new Error("Source requires one complete unambiguous objective definition");
  const selected = candidates[0]!;
  const objectiveLabel = /\b([A-Za-z][A-Za-z0-9_]*)\s*=/.exec(body.slice(selected.start, selected.end))?.[1];
  const aliases = aliasesFor(objectiveLabel);
  for (const direction of directions) {
    const target = targetOf(direction);
    const boundReference = target === objectiveLabel || (target && aliases.includes(target.toLowerCase()));
    const postfix = postfixDirection(direction, selected.end);
    const derivedResult = direction.index! >= selected.end
      && /^\s+(?:(?:points?|solutions?)(?:\s+graphically)?|exists?|is\s+(?:finite|unbounded|bounded|attained))\s*(?:[.;?!]|$)/i.test(body.slice(direction.index! + direction[0].length));
    const explicitAction = /^(?:maximi[sz]|minimi[sz])|^(?:max|min)$/i.test(direction[0]);
    const requestContext = body.slice(0, direction.index!).split(/[.;?!:]/).at(-1) ?? "";
    const requested = /\b(?:find|determine|give|report|state|calculate|compute)\b/i.test(requestContext);
    if (sense(direction[0]) !== selected.sense && (explicitAction || boundReference || postfix || derivedResult))
      throw new Error(`Source requests contradictory objective directions: ${selected.sense} and ${sense(direction[0])}`);
    if ((explicitAction || requested) && direction.index! !== selected.start && target && !names.includes(target) && !boundReference && !postfix && !derivedResult)
      throw new Error(`Additional source objective request is unresolved: ${direction[0]} ${target}`);
  }
  return { ...selected, ...(objectiveLabel ? { label: objectiveLabel } : {}) };
}
/**
 * Independently reconstruct a complete affine source program. No rejected
 * candidate, planner scalar, mark, annotation or display window is consumed.
 * The ordinary compiler must still prove and compile this whole document.
 * The supported coordinate grammar is deliberately x/y; unknown names and
 * ambiguous dimensions are refused rather than guessed from planner output.
 */
export function buildLinearSourceDocument(question: string): SceneDocument | null {
  if (typeof question !== "string" || question.length > 2000) return null;
  try {
    const normalized = normalize(question);
    assertLinearSourceGrammar(normalized);
    // This builder owns graphical solution sets and exact line intersections.
    // Additional geometric calculations stay with the planner's constructions.
    if (/\b(?:angles?|distances?|bisectors?|slopes?|areas?|tan(?:gent)?|reflections?|reflected|rotations?|rotated|translations?|translated)\b/i.test(normalized)) return null;
    const numberLineRequested = /\bnumber[ -]line\b/i.test(normalized)
      || /\breal\s+x\b/i.test(normalized) && !/\by\b|\b(?:half[ -]plane|coordinate\s+plane|pairs?)\b|(?:R|ℝ)(?:\^2|²)/i.test(normalized);
    if (hasUnsupportedDiscreteDomain(question, !numberLineRequested)) return null;
    let operator: string;
    let inputs: Record<string, unknown>;
    if (numberLineRequested) {
      const points = readLinearSourceReferencePoints(explicitDomains(canonicalRealDomainSource(normalized, ["x"]), ["x"]), ["x"]);
      const body = points.maskedQuestion;
      const program = setBuilderSourceProgram(body, "x") ?? intervalSourceProgram(body, "x") ?? scopedSourceProgram(body, clauses(body, ["x"]), points.points.map(point => point.label), normalized, ["x"], false);
      operator = "number_line_set";
      inputs = { variable: "x", expression: program };
    } else {
      const names = ["x", "y"];
      const points = readLinearSourceReferencePoints(explicitDomains(canonicalRealDomainSource(normalized, names), names), names);
      let body = points.maskedQuestion;
      const proseLabels = points.points.map(point => point.label);
      let objective: { expression: string; sense: "max" | "min" } | undefined;
      if (/\b(?:maximi[sz](?:e[ds]?|ing|ation)|minimi[sz](?:e[ds]?|ing|ation)|maximum|minimum|max|min)\b/i.test(body)) {
        const source = sourceObjective(body, names);
        if (source.label) proseLabels.push(source.label);
        objective = { expression: source.expression, sense: source.sense };
        body = body.slice(0, source.start) + " ".repeat(source.end - source.start) + body.slice(source.end);
      }
      const source = clauses(body, names, points.points.map(point => point.label));
      const program = scopedSourceProgram(body, source, proseLabels, normalized, names);
      const branches = planarBranches(program);
      if (!source.length || !branches || branches.length !== 1 || !isIntersectionProgram(program) &&
        !firstQuadrantDomains(normalized, names).length && !/\bsubject\s+to\b/i.test(body)) return null;
      const constraints = branches[0]!;
      if (source.length === 2 && source.every(clause => clause.equality) && !objective) {
        if (!hasNativeSystemRequest(body, source, proseLabels)) return null;
        operator = "linear_system";
        inputs = { variables: names, equations: source.map(clause => clause.text) };
      } else if (source.length === 1 && !source[0]!.equality && !objective) {
        operator = "linear_half_plane";
        inputs = { variables: names, inequality: source[0]!.text };
      } else if (source.every(clause => !clause.equality)) {
        operator = "linear_feasible_region";
        inputs = { variables: names, constraints, ...(objective ? { objective } : {}) };
      } else return null;
    }
    if (!readLinearBindingSource(question, operator === "number_line_set" ? ["x"] : ["x", "y"], operator === "number_line_set")) return null;
    const document: SceneDocument = {
      schemaVersion: "scene-document/v2",
      visualDecision: { mode: "scene", reason: "Complete original affine source program with engine-owned geometry and claims" },
      source: { question, representationTier: "exact_verified", nonMetric: false },
      quantities: [],
      entities: [{ id: "source_linear_region", kind: "linear_region", role: "solution" }],
      constructions: [{ id: "build_source_linear_region", operator, inputs, outputs: ["source_linear_region"] }],
      relations: [], assertions: [], annotations: [], requiredEntityIds: ["source_linear_region"],
      revealGroups: [{ id: "source_linear_setup", entityIds: ["source_linear_region"], dependsOn: [], narrationCue: "Explain the verified graphical solution and original reference points." }],
      teachingTimeline: [{ id: "show_source_linear_setup", action: "reveal", targetId: "source_linear_setup", dependsOn: [], narrationIntent: "Explain only the independently verified original source program." }],
    };
    return validateLinearSourceBinding(document).some(issue => issue.severity === "fatal") ? null : document;
  } catch { return null; }
}

/** Complete original two-equation authority for deterministic solver binding. */
export function readLinearSystemSource(question: string): Extract<LinearFigureInput, { kind: "linear_system" }> | null {
  const document = buildLinearSourceDocument(question);
  const construction = document?.constructions[0];
  if (!construction || construction.operator !== "linear_system") return null;
  const equations = construction.inputs.equations;
  if (!Array.isArray(equations) || equations.length !== 2) return null;
  const [first, second] = equations;
  if (typeof first !== "string" || typeof second !== "string") return null;
  return { kind: "linear_system", variables: ["x", "y"], equations: [first, second] };
}

interface LinearBindingSource {
  source: SourceClause[];
  program: IntervalExpression;
  objective?: SourceObjective;
  aliases?: Set<string>;
}

/** Source reconstruction has no proposed coefficients or candidate solution. */
function readLinearBindingSource(question: string, names: readonly string[], numberLine: boolean): LinearBindingSource | null {
  try {
    const normalized = normalize(question);
    assertLinearSourceGrammar(normalized);
    let body = explicitDomains(sourceNotation(canonicalRealDomainSource(normalized, names), names), names);
    const points = readLinearSourceReferencePoints(body, names);
    body = points.maskedQuestion;
    body = body.replace(/\b([A-Za-z][A-Za-z0-9_]*)\s*∈\s*ℝ/g, (_, variable: string) => {
      if (!names.includes(variable)) throw new Error("Real domain must use a declared variable");
      return " ";
    });
    const proseLabels = points.points.map(point => point.label);
    let objective: SourceObjective | undefined;
    if (!numberLine && /\b(?:maximi[sz](?:e[ds]?|ing|ation)|minimi[sz](?:e[ds]?|ing|ation)|maximum|minimum|max|min)\b/i.test(body)) {
      objective = sourceObjective(body, names);
      if (objective.label) proseLabels.push(objective.label);
      body = body.slice(0, objective.start) + " ".repeat(objective.end - objective.start) + body.slice(objective.end);
    }
    if (numberLine) {
      const aliases = new Set<string>();
      const named = setBuilderSourceProgram(body, names[0]!, aliases) ?? intervalSourceProgram(body, names[0]!, aliases);
      if (named) {
        signatures(inequalityLeaves(named), names);
        if (/\bstrict[- ]boundary\s+exclusion\b/i.test(body)
          && !inequalityLeaves(named).some(leaf => parseLinearConstraint(leaf, names).some(row => row.strict))) return null;
        if (hasUnsupportedDiscreteDomain(question, !numberLine, true, aliases, names)) return null;
        return { source: [], program: named, aliases };
      }
    }
    const source = clauses(body, names, proseLabels);
    const program = scopedSourceProgram(body, source, proseLabels, normalized, names);
    signatures(inequalityLeaves(program), names);
    const aliases = new Set([...body.matchAll(/\bsolution\s+set\s+([A-Za-z][A-Za-z0-9_]*)\s*(?=of\b|for\b|on\b|[.;?!]|$)/gi)].map(match => match[1]!).filter(isLinearSourceIdentifier));
    if (/\bstrict[- ]boundary\s+exclusion\b/i.test(body)
      && !inequalityLeaves(program).some(leaf => parseLinearConstraint(leaf, names).some(row => row.strict))) return null;
    if (hasUnsupportedDiscreteDomain(question, !numberLine, true, aliases, names)) return null;
    return { source, program, aliases, ...(objective ? { objective } : {}) };
  } catch {
    // A failed lexical, scope, or request proof is absence of authority. Only
    // the completed result above can enter a proposed/source comparison.
    return null;
  }
}

/** Native linear operators draw continuous real sets. Any remaining discrete
 * cue is incompatible, even when its prose role is unknown or hypothetical.
 * The safe list removes only the coefficient property itself; a separate
 * integer/prime/membership restriction in the same question still blocks. */
function normalizeLinearDomainNotation(question: string): string {
  return question.replace(/²/g, "^2").normalize("NFKC")
    .replace(/[−–—]/g, "-")
    .replace(/\\(?:epsilon|varepsilon|in)\b|[εє∊]/giu, "∈")
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\(?:mathbb|mathbf|mathrm|mathsf|Bbb)\s*(?:\{([^{}]*)\}|([A-Za-z]))/g,
      (whole, braced?: string, bare?: string) => braced !== undefined ? (braced.trim() || whole) : bare!)
    .replace(/\\([RZNIW])\b/g, "$1")
    .replace(/\\([{}])/g, "$1")
    .replace(/\\(?:ldots|dots|cdots)\b|…|\.\s*\.\s*\./g, "...")
    .replace(/\$/g, "");
}

/** A typed variable's continuous-domain declaration is ordinary real membership. */
function continuousDomainNotation(question: string, names: readonly string[]): string {
  const identifier = "[A-Za-z][A-Za-z0-9_]*";
  const list = `${identifier}(?:\\s*(?:,\\s*(?:and\\s+)?|and\\s+)${identifier}){0,8}`;
  return question.replace(new RegExp(`(^|[.;?!\\r\\n])(\\s*)(${list})\\s+(?:has|have)\\s+(?:(?:a|an|the)\\s+)?continuous\\s+domain\\b`, "gi"),
    (whole, boundary: string, space: string, subjects: string) => subjects.split(/\s*(?:,|\band\b)\s*/i).every(name => names.includes(name))
      ? `${boundary}${space}${subjects} in R` : whole);
}

/** Canonicalize only literal real declarations; retain every following source
 * constraint/request for the ordinary complete-program proof and comparison. */
function canonicalRealDomainSource(question: string, names: readonly string[]): string {
  // Repair domain notation without reinterpreting unrelated affine arithmetic
  // (for example, the ordinary reader deliberately declines an em dash).
  let source = sourceNotation(continuousDomainNotation(question, names)
    .replace(/\\(?:epsilon|varepsilon|in)\b|[εϵє∊]/giu, "∈")
    .replace(/\\(?:mathbb|mathbf|mathrm|mathsf|Bbb)\s*(?:\{[^{}]{1,32}\}|[A-Za-z])|\\R\b|[\p{L}]/gu,
      token => normalizeLinearDomainNotation(token) === "R" ? "R" : token), names);
  const variable = `(?:${names.join("|")})`, list = `${variable}(?:\\s*(?:,\\s*(?:and\\s*)?|and\\s+)${variable}){0,8}`;
  const real = String.raw`(?:R|real(?:\s+numbers?)?)(?![\p{L}\p{N}_]|\s+pairs?\b)`;
  source = source.replace(new RegExp(`\\b(${list})\\s*(?:(?:is|are)\\s+)?(?:∈|in\\b|ranges?\\s+over|belongs?\\s+to(?:\\s+(?:the\\s+)?set)?|(?:elements?|members?)\\s+of)\\s*(?:the\\s+)?(?:all\\s+)?${real}(\\s*(?:,|with\\b))?`, "giu"),
    (_, variables: string, connector: string | undefined, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      if (/\{\s*$/.test(before)) return `${variables} in R${connector ?? ""}`;
      if (connector && /[<>=]/.test(before) && /(?:^|[.;?!]\s*)$/.test(before)) return " subject to ";
      return ` ${connector ?? ""}`;
    });
  source = source.replace(/\bdomain\s+is\s+continuous\b/gi, " ");
  return source.replace(new RegExp(`\\b(?:U\\s*=|domain\\b(?:\\s+(?:is|as)|\\s*[:=])?|replacement\\s+set\\b(?:\\s+(?:is|as)|\\s*=)?|(?:in|over)\\b)\\s*(?:the\\s+)?(?:all\\s+)?${real}`, "giu"), " ");
}

/** A finite source point queried against the already drawn region is not a
 * variable's replacement set. Keep unknown named sets and qualified queries. */
function withoutLinearMembershipQueries(source: string, planar: boolean, sourceProved?: boolean, aliases: ReadonlySet<string> = new Set(), variables: readonly string[] = planar ? ["x", "y"] : ["x"]): string {
  let labels: string[] = [];
  try {
    const references = readLinearSourceReferencePoints(source, variables);
    labels = references.points.map(point => point.label);
    source = references.maskedQuestion;
  } catch { /* An unproved point declaration supplies no exemption. */ }
  // A known literal point remains a point when a later marking request names
  // it. Mask only those argument occurrences, never every use of its name.
  if (labels.length) source = source.replace(/\b((?:mark|label)\s+(?:points?\s+)?)([A-Za-z][A-Za-z0-9_]*(?:\s*(?:,\s*(?:and\s+)?|and\s+)[A-Za-z][A-Za-z0-9_]*){0,15})\b/gi,
    (_, action: string, targets: string) => action + targets.replace(/[A-Za-z][A-Za-z0-9_]*/g, label => labels.includes(label) ? " ".repeat(label.length) : label));
  const names = labels.length ? `(?:${labels.join("|")})(?:\\s*(?:,|and|or)\\s*(?:${labels.join("|")}))*` : "(?!)";
  if (labels.length && sourceProved !== false) {
    const known = (name: string) => sourceProved === undefined || aliases.has(name);
    source = source.replace(/\b(?:classify|state|report|determine|identify)\s+(?:(?:their|its)\s+)?membership\s+in\s+([A-Za-z][A-Za-z0-9_]*)\s*(?=[.;?!]|$)/gi,
      (whole, name: string) => known(name) ? " " : whole);
    source = source.replace(new RegExp(`\\b(?:whether|which(?:\\s+of)?)\\s+(?:each(?:\\s+point)?|points?|${names})?\\s*belongs?\\s+to\\s+([A-Za-z][A-Za-z0-9_]*)\\s*(?=[.;?!]|$)`, "gi"),
      (whole, name: string) => known(name) ? " " : whole);
  }
  if (sourceProved !== false) source = source.replace(/\bwhether\s+(?:points\s+on\s+)?the\s+boundary\s+belongs?\s+to\s+(?:it|the\s+set)\s*(?=[.;?!]|$)/gi, " ");
  if (planar && !labels.length) return source;
  const scalar = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*/\s*\d+)?`;
  const subject = planar ? `(?:points?|${names})?` : `(?:${scalar}|${names})`;
  return source.replace(new RegExp(`\\b(?:which(?:\\s+of)?|whether|does|do)\\s+${subject}\\s*(?:belongs?\\s+to|lies?\\s+in|is\\s+in)\\s+(?:the\\s+)?(?:half[ -]plane|(?:shaded\\s+)?(?:solution\\s+)?(?:region|set)|it)\\s*(?=[.;?!]|$)`, "gi"), " ");
}

/** Membership proves only its complete target. Unknown sets or qualifications
 * cannot silently become the unrestricted real domain. Location prose is not
 * membership; the existing leading real-plane notation is dimension checked. */
function hasUnsupportedMembership(remaining: string, planar: boolean, sourceProved?: boolean, aliases: ReadonlySet<string> = new Set()): boolean {
  const source = withoutLinearMembershipQueries(remaining, planar, sourceProved, aliases)
    .replace(new RegExp(`\\b(?:${FIRST_QUADRANT})\\b`, "gi"), whole => planar ? " " : whole)
    .replace(/\bin\s+this\s+(?:case|example)\b|\bexplain\s+in\s*:/gi, " ")
    .replace(/\bin\s+(?:(?:a|an|the|same|real)\s+)*(?:(?:coordinate|xy|Cartesian)[ -]+)?(?:number[ -]line|plane|graph)\b/gi, " ")
    .replace(/\belements\s+in\s+([A-Za-z][A-Za-z0-9_]*)\s+but\s+outside\s+([A-Za-z][A-Za-z0-9_]*)\b/gi,
      (whole, first: string, second: string) => sourceProved === undefined || sourceProved && aliases.has(first) && aliases.has(second) ? " " : whole);
  const heads = /∈|\b(?:in\b|over\b|belongs?\s+to\b(?:\s+(?:the\s+)?set\b)?|(?:elements?|members?)\s+of\b|restricted\s+to\b|chosen\s+from\b|taken\s+from\b|from\s+the\s+set\b|replacement\s+set\b(?:\s+(?:is\b|as\b)|\s*=)?|domain\b(?:\s+(?:is\b|as\b)|\s*[:=])?)\s*|\bU\s*=/giu;
  for (const head of source.matchAll(heads)) {
    // Word heads ignore case; the universe symbol U keeps its identity.
    if (/^u\s*=$/.test(head[0])) continue;
    const target = source.slice(head.index! + head[0].length).replace(/^\s*(?:the\s+)?(?:set\s+of\s+)?(?:all\s+)?/i, "");
    // U may be an explicit native interval/set-builder name, not a universe
    // declaration. The complete native program must subsequently bind it.
    if (/^U\s*=$/i.test(head[0]) && /^[{[(]/.test(target)
      && (sourceProved === undefined || sourceProved && aliases.has("U"))) continue;
    // "Maximized over x>=0, ..." is a proved affine constraint scope,
    // not a named replacement set. Unknown set names cannot pass this path.
    if (/^over\b/i.test(head[0]) && sourceProved !== false) {
      try {
        const variables = planar ? ["x", "y"] : ["x"];
        const comparisons = clauses(target, variables);
        if (comparisons.length) {
          signatures(comparisons.map(clause => clause.text), variables);
          booleanProgram(target, comparisons, [], true);
          continue;
        }
      } catch { /* The complete affine scope was not proved. */ }
    }
    // Preserve set-symbol identity: lowercase r is not the real set R.
    const real = /^(?:R(?:\s*\^\s*(?:2|\{\s*2\s*\}))?|[rR][eE][aA][lL](?:\s+[nN][uU][mM][bB][eE][rR][sS]?)?)(?=$|\s|[,;:.?!)}\]])/u.exec(target)
      ?? (/^domain\b/i.test(head[0]) ? /^continuous(?=$|\s|[,;:.?!)}\]])/iu.exec(target) : null);
    if (!real) return true;
    if (real[0].includes("^") && (!planar || !/^(?:in|over)\s*$/i.test(head[0]) || source.slice(0, head.index).trim() !== "")) return true;
    // Punctuation may precede a separate display request, but cannot erase
    // an unknown qualification such as "R, excluding 0".
    const continuation = target.slice(real[0].length).replace(/^[,;:.?!)}\]\s]+/u, "");
    if (continuation && sourceProved === false) return true;
  }
  return false;
}

function hasScalarRoster(remaining: string): boolean {
  // Numeric fraction braces are operands, not singleton set declarations.
  // Mask complete ordinary fractions only; a comma/ellipsis cannot hide here.
  const source = remaining.replace(/\\(?:frac|dfrac|tfrac)\s*\{([^{};,]+)\}\s*\{([^{};,]+)\}/g,
    (match, numerator: string, denominator: string) => [numerator, denominator].every(part => /^[\w\s()+*/^.-]+$/.test(part) && !/\.{2}/.test(part)) ? " " : match);
  const scalar = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*/\s*[+-]?\d+)?`;
  // Three scalar members are a roster even without braces. Two-coordinate
  // tuples and constants separated by actual comparisons cannot match.
  // Inspect the complete text: removing x=0 first would erase a list member.
  const plain = new RegExp(String.raw`(?<![\p{L}\p{N}_./])${scalar}\s*,\s*${scalar}\s*(?:,\s*|(?:,?\s*\b(?:and|or)\b\s*))${scalar}(?![\p{L}\p{N}_.])`, "giu");
  if (plain.test(source)) return true;
  const member = String.raw`(?:${scalar}|\.{3})`;
  const roster = new RegExp(String.raw`^\s*${member}(?:\s*[,;]\s*${member})*\s*$`, "u");
  return [...source.matchAll(/\{([^{}]*)\}/g)].some(match => roster.test(match[1]!));
}

/** Reject-only domain proof over normalized tokens; ordinary membership,
 * discrete and roster contradictions remain independent. */
function hasUnsupportedHindiDomain(source: string, names: readonly string[], provedSpans?: Array<{ start: number; end: number }>): boolean {
  if (source.length > 2000) return true;
  const tokens = [...source.matchAll(/[\p{L}\p{M}\p{N}_]+|[^\s]/gu)]
    .map(match => ({ raw: match[0], word: match[0].toLowerCase(), start: match.index!, end: match.index! + match[0].length }));
  const native = new Set(names), masked = new Set<number>();
  const deva = (word: string) => /\p{Script=Devanagari}/u.test(word);
  const numberCue = (word: string) => /^(?:sankhy|purn|poorn|prakr|vastavik)/i.test(word);
  const locative = new Set(["me", "mein", "mai", "main", "में"]);
  const possessive = new Set(["ka", "ki", "ke", "का", "की", "के"]);
  const copula = new Set(["hai", "hain", "ho", "है", "हैं", "हो"]);
  const word = (index: number) => tokens[index]?.word ?? "";
  const boundary = (index: number) => index === 0 || /^(?:[.,;!?।])$/.test(word(index - 1)) ||
    /[\r\n]/.test(source.slice(tokens[index - 1]!.end, tokens[index]?.start ?? source.length));
  const introducers = new Set(["where", "for", "if", "given", "let", "agar", "jahan", "जहाँ", "अगर", "यदि"]);
  // Do not start inside a noun's subject list: "coefficients of x, y are real".
  const start = (index: number) => boundary(index) && !(word(index - 1) === "," && /^[\p{L}\p{M}_]/u.test(word(index - 2))) ||
    introducers.has(word(index - 1)) && boundary(index - 1);
  const finish = (index: number) => index === tokens.length || boundary(index) ||
    /^[,;.!?।]$/.test(word(index)) || ["and", "aur", "और", "तथा"].includes(word(index));
  const postfix = (index: number) => locative.has(word(index)) &&
    (copula.has(word(index + 1)) || native.has(tokens[index - 2]?.raw ?? "") ||
      word(index - 2) === "," && native.has(tokens[index - 3]?.raw ?? "")) ||
    possessive.has(word(index)) && /^(?:sadasy|सदस्य)/u.test(word(index + 1));
  if (!provedSpans && !tokens.some((token, index) => deva(token.raw) || numberCue(token.word) || copula.has(token.word) || postfix(index))) return false;

  const mark = (first: number, end: number) => {
    for (let index = first; index < end; index += 1) masked.add(index);
    if (first < end) provedSpans?.push({ start: tokens[first]!.start, end: tokens[end - 1]!.end });
  };
  const matchWords = (index: number, pattern: readonly string[]) => pattern.every((part, offset) => word(index + offset) === part);
  // Capital R is a set; lowercase r, a coefficient, and point labels are not.
  const real = (index: number): number | null => {
    const token = tokens[index];
    if (!token) return null;
    if (token.raw === "R" || token.raw === "ℝ") return index + 1;
    if (!["real", "vastavik", "वास्तविक"].includes(token.word)) return null;
    return index + (["number", "numbers", "sankhya", "संख्या"].includes(word(index + 1)) ? 2 : 1);
  };
  const realTarget = (index: number) => {
    if (word(index) === "the") index += 1;
    if (matchWords(index, ["set", "of"])) index += 2;
    if (word(index) === "all") index += 1;
    return real(index);
  };
  const subjects = (index: number): number | null => {
    if (!native.has(tokens[index]?.raw ?? "")) return null;
    const seen = new Set<string>([tokens[index]!.raw]);
    index += 1;
    // Native subject count bounds the scan even on a long malformed comma list.
    while (seen.size < native.size) {
      let next = index;
      if (word(next) === ",") { next += 1; if (word(next) === "and") next += 1; }
      else if (word(next) === "and") next += 1;
      else break;
      const name = tokens[next]?.raw;
      if (!name || !native.has(name) || seen.has(name)) break;
      seen.add(name); index = next + 1;
    }
    return index;
  };
  const membershipHeads = [["∈"], ["in"], ["belongs", "to"], ["belong", "to"], ["element", "of"], ["member", "of"],
    ["restricted", "to"], ["chosen", "from"], ["taken", "from"], ["from", "the", "set"], ["ranges", "over"]];
  let explicitReal = false;
  for (let index = 0; index < tokens.length; index += 1) {
    if (!start(index) && !(provedSpans && word(index - 1) === "for")) continue;
    let end: number | null = null;
    const afterSubject = subjects(index);
    if (afterSubject !== null) {
      let at = afterSubject;
      const englishCopula = ["is", "are"].includes(word(at));
      if (englishCopula) at += 1;
      // Articles belong to an exact membership noun phrase, not to its
      // replacement-set target. This optional proof is refusal-only.
      if (provedSpans && englishCopula && ["a", "an"].includes(word(at))) at += 1;
      for (const head of membershipHeads) if (matchWords(at, head)) {
        end = realTarget(at + head.length); if (end !== null) break;
      }
      if (end === null) {
        if (["a", "an", "ek", "एक"].includes(word(at))) at += 1;
        const target = real(at);
        if (target !== null && (englishCopula || copula.has(word(target)))) end = target;
      }
      if (end === null) {
        const target = real(afterSubject + (word(afterSubject) === "," ? 1 : 0));
        if (target !== null) {
          if (locative.has(word(target)) && copula.has(word(target + 1))) end = target + 2;
          if (possessive.has(word(target)) && /^(?:sadasy|सदस्य)/u.test(word(target + 1)) && copula.has(word(target + 2))) end = target + 3;
        }
      }
      // Permission to take a fractional scalar is not a requirement to take
      // only rational values. Require the entire unqualified declaration.
      if (provedSpans && end === null && matchWords(afterSubject, ["can", "be", "a", "fraction"]))
        end = afterSubject + 4;
    } else {
      // Only a whole universal-domain head supplies subject-independent proof.
      let at = index;
      if (word(at) === "the") at += 1;
      if (tokens[at]?.raw === "U" && word(at + 1) === "=") end = realTarget(at + 2);
      else if (["domain", "universe"].includes(word(at)) || matchWords(at, ["replacement", "set"])) {
        at += matchWords(at, ["replacement", "set"]) ? 2 : 1;
        if (["is", "as", ":", "="].includes(word(at))) at += 1;
        end = realTarget(at);
      }
      if (provedSpans && end === null) {
        const target = real(index);
        if (target !== null) end = subjects(target);
      }
    }
    if (end !== null && copula.has(word(end))) end += 1;
    // Negations or qualifications before/after the real word cannot be consumed.
    if (end !== null && finish(end)) {
      explicitReal = true; mark(index, end);
      if (introducers.has(word(index - 1)) && boundary(index - 1)) masked.add(index - 1);
    }
  }
  if (!explicitReal) return true;

  // These are positive display phrases, never exemptions for a number domain.
  for (let index = 0; index < tokens.length; index += 1) {
    if (masked.has(index)) continue;
    const numberLine = matchWords(index, ["sankhya", "rekha"]) || matchWords(index, ["संख्या", "रेखा"]);
    if (numberLine) {
      let end = index + 2;
      if (["par", "पर"].includes(word(end))) end += 1;
      if (["dikhao", "dikhaiye", "दिखाओ", "दिखाइए"].includes(word(end))) end += 1;
      else if (matchWords(end, ["निरूपित", "कीजिए"])) end += 2;
      if (finish(end)) { mark(index, end); if (["ko", "को"].includes(word(index - 1))) masked.add(index - 1); }
    } else if (["दिखाओ", "दिखाइए"].includes(word(index)) && start(index) && finish(index + 1)) masked.add(index);
  }
  return tokens.some((token, index) => !masked.has(index) && (deva(token.raw) || numberCue(token.word) || copula.has(token.word) || postfix(index)));
}

/** An objective's NAME can be certain while its requested answer is not.
 * Prove and mask each declaration/reference occurrence independently; a later
 * membership or bare domain occurrence of the same identifier stays visible. */
function maskLinearSourceScalarNameRoles(source: string, names: readonly string[], isSetSymbol: (label: string) => boolean, definitionSpans?: Array<{ start: number; end: number }>): string {
  const scalarNames = new Set<string>();
  let residual = source.replace(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*/g,
    (whole, label: string, offset: number, original: string) => {
      if (!isSetSymbol(label) || names.includes(label)) return whole;
      try {
        const expression = readLinearSourceAffineExpression(original, names, offset + whole.length);
        if (!expression) return whole;
        definitionSpans?.push({ start: offset, end: expression.end });
        scalarNames.add(label);
        return " ".repeat(whole.length);
      } catch { return whole; }
    });
  // These are typed objective-reference fields, not domain-verb synonyms.
  const reference = /\b(?:maximi[sz](?:e[ds]?|ing|ation)|minimi[sz](?:e[ds]?|ing|ation)|maximum|minimum|max|min)\s+(?:(?:the|objective|function|constant|value|of)\s+){0,8}(?:(?:points?|solutions?|coordinates?|values?)\s+of\s+)?([A-Za-z][A-Za-z0-9_]*)\b/gi;
  residual = residual.replace(reference, (whole, label: string) => {
    if (!isSetSymbol(label)) return whole;
    scalarNames.add(label);
    return " ".repeat(whole.length);
  });
  // Only this typed numeric-value field owns the reference occurrence. A
  // declaration does not remove the same name in "on Z" or "selected from Z".
  residual = residual.replace(new RegExp(`\\b([A-Za-z][A-Za-z0-9_]*)(?=\\s+(?:${LINEAR_SCALAR_VALUE_QUERY})\\b)`, "g"),
    (whole, label: string, offset: number, original: string) => {
      if (!scalarNames.has(label)) return whole;
      // A value slot belongs to a numeric/display query. Domain language before
      // the name cannot borrow a following "at every corner" or "value" noun.
      const queryPrefix = /\b(?:show(?:ing)?|label|find|determine|state|give|report|calculate|compute|evaluate)\s+(?:(?:the|objective|function|value|of|exact|corner|coordinates|at|every|each|and|with|its|their)\s+){0,16}$/i;
      return queryPrefix.test(original.slice(0, offset)) ? " ".repeat(whole.length) : whole;
    });
  return residual;
}

/** Set-looking identifiers are restrictions until a source parser owns that
 * occurrence. A declaration never grants a name-wide exemption: objective Z
 * and a later domain Z are different roles, even in the same sentence. */
function hasUnprovedSetSymbol(source: string, names: readonly string[], planar: boolean): boolean {
  const setSymbol = /(?<![\p{L}\p{N}_])[NWZIQ](?:\d+)?(?![\p{L}\p{N}])/u;
  if (!setSymbol.test(source)) return false;
  // Alternate-role proof has the same bounded arity as native source rows.
  // Exhaustion leaves the set-looking symbols unproved; it grants no alias.
  const symbols = source.matchAll(new RegExp(setSymbol.source, "gu"));
  let symbolCount = 0;
  while (!symbols.next().done) if (++symbolCount > 16) return true;
  let residual = withoutLinearMembershipQueries(source, planar, false, undefined, names);
  // Roman I is owned by the existing, exact first-quadrant declaration.
  if (planar) residual = residual.replace(new RegExp(`\\b(?:${FIRST_QUADRANT})\\b`, "gi"), " ");
  if (!planar) {
    const proof = { residual };
    try {
      const body = explicitDomains(canonicalRealDomainSource(normalize(residual), names), names);
      proof.residual = body;
      if (setBuilderSourceProgram(body, names[0]!, undefined, proof)
        || intervalSourceProgram(body, names[0]!, undefined, undefined, proof)) residual = proof.residual;
    } catch { /* Completed occurrence type proofs survive an unproved later request. */ }
    residual = proof.residual;
  }
  residual = maskLinearSourceScalarNameRoles(residual, names, label => setSymbol.test(label));
  const intersectionNames = readLinearSourceIntersectionNames(residual);
  if (intersectionNames.size) {
    try {
      const equations = clauses(residual, names, [...intersectionNames]);
      if (equations.length === 2 && equations.every(row => row.equality)
        && isIntersectionProgram(scopedSourceProgram(residual, equations, [...intersectionNames], residual, names))) {
        // The complete original pair owns these intersection references. No
        // other occurrence of the same letter is granted an exemption.
        residual = residual.replace(/\b(?:meets?|intersects?|cross(?:es)?)(?:\s+(?:each\s+other|one\s+another))?\s+at\s+(?:(?:the\s+)?point\s+)?([A-Za-z][A-Za-z0-9_]*)\b/gi,
          (whole, label: string) => intersectionNames.has(label) ? " ".repeat(whole.length) : whole);
        residual = residual.replace(/\b(?:label|mark)\s+(?:(?:the|intersection|point)\s+)*([A-Za-z][A-Za-z0-9_]*)\b/gi,
          (whole, label: string) => intersectionNames.has(label) ? " ".repeat(whole.length) : whole);
      }
    } catch { /* The complete source pair did not prove an intersection role. */ }
  }
  if (!setSymbol.test(residual)) return false;
  // A few set-looking names among many unrelated colon declarations must not
  // multiply full-tail clause parsing. Already-proved roles were masked above.
  const lineRoles = residual.matchAll(/\b[A-Za-z][A-Za-z0-9_]*\s*:/g);
  let lineRoleCount = 0;
  while (!lineRoles.next().done) if (++lineRoleCount > 16) return true;
  residual = residual.replace(/\b(?:line\s+(?:named|called)\s+)?([A-Za-z][A-Za-z0-9_]*)\s*:/gi,
    (whole, label: string, offset: number, original: string) => {
      if (!setSymbol.test(label) || readLinearSourceLineName(original.slice(0, offset + whole.length)) !== label) return whole;
      try {
        const tail = original.slice(offset + whole.length);
        const first = clauses(tail, names)[0];
        if (!first?.equality || tail.slice(0, first.start).trim()) return whole;
        parseLinearConstraint(first.text, names);
        return " ".repeat(whole.length);
      } catch { return whole; }
    });
  return setSymbol.test(residual);
}

function hasUnsupportedDiscreteDomain(question: string, planar = false, sourceProved?: boolean, aliases?: ReadonlySet<string>,
  names: readonly string[] = planar ? ["x", "y"] : ["x"]): boolean {
  question = withoutQuestionOrdinal(continuousDomainNotation(question, names));
  // The existing named-set reader checks both sides of this complete identity.
  // Early reading may defer it; only its actual proved aliases permit removal.
  question = question.replace(/\b(?:Here\s+)?([A-Za-z][A-Za-z0-9_]*)\s+(?:minus|union|intersect(?:ion)?)\s+([A-Za-z][A-Za-z0-9_]*)\s+means\s+x\s+is\s+in\s+([A-Za-z][A-Za-z0-9_]*)\s+(?:AND|OR)\s+x\s+is\s+(?:not\s+)?in\s+([A-Za-z][A-Za-z0-9_]*)\s*(?=[.;?!]|$)/gi,
    (whole, a: string, b: string, c: string, d: string) => [a, b, c, d].some(name => /^[INZW]$/.test(name)) ? whole
      : sourceProved === undefined || sourceProved && [a, b, c, d].every(name => aliases?.has(name)) ? " " : whole);
  if (/∉|\\notin\b|\\not\s*\\in\b|\bnot\s+in\b/iu.test(question)) return true;
  let remaining = normalizeLinearDomainNotation(question)
    .replace(/\binteger(?:\s+|-)coefficients?\b/gi, " ")
    .replace(/\bcoefficients?\s+(?:is|are)\s+(?:an?\s+)?integers?\b/gi, " ");
  if (hasUnprovedSetSymbol(remaining, names, planar)) return true;
  remaining = linearRationalPropertySource(remaining, names);
  if (/\b(?:ir)?rationals?\b/i.test(remaining)) return true;
  if (/\b(?:integers?|intergers?|ints?|integral|whole|naturals?|counting|primes?|odd|even|lattices?|digits?)\b/i.test(remaining)) return true;
  if (/\\not\s*∈|\bnot\s+∈/iu.test(remaining)) return true;
  if (hasUnsupportedHindiDomain(remaining, names)) return true;
  if (/[ℤℕ]|\\mathbb\s*(?:\{\s*[INZW]\s*\}|[INZW](?![\p{L}]))/u.test(question)) return true;
  return hasUnsupportedMembership(remaining, planar, sourceProved, aliases) || hasScalarRoster(remaining);
}

/** Binding-only scalar syntax. A complete mixed number is a sum, never an
 * implicit product. The source builder deliberately retains its old grammar. */
function incompleteSourceMixedScalars(source: string): string {
  return source.replace(/(?<![\p{L}\p{N}_./])([+-]?)(\d+)\s+(\d+)\s*\/\s*(\d+)(?![\p{L}\p{N}_./])/gu,
    (_whole, sign: string, integer: string, numerator: string, denominator: string) => {
      if (BigInt(denominator) === 0n || BigInt(numerator) >= BigInt(denominator))
        throw new Error("An unproved mixed scalar requires a complete proper fractional part");
      return `${sign}(${integer}+${numerator}/${denominator})`;
    });
}

/** A unary source wrapper can be proved independently of request certainty.
 * Remove only its exact prefix tokens, then let the existing Boolean parser
 * own every remaining operand and gap. This corroborates a candidate only;
 * it never supplies a source figure or a requested-answer claim. */
function incompleteUnarySourceProgram(body: string, source: SourceClause[], labels: readonly string[], names: readonly string[]): IntervalExpression | null {
  if (!source.length || source.length > 16 || new RegExp(`\\b(?:if|then|${UNSUPPORTED_LINEAR_INTERVAL_BOOLEAN_WORDS})\\b`, "i").test(body)) return null;
  const prefix = body.slice(0, source[0]!.start);
  const tokens = [...prefix.matchAll(/[A-Za-z][A-Za-z0-9_]*|[^\s]/g)];
  let cursor = tokens.length, wrappers = 0;
  const word = (index: number) => tokens[index]?.[0].toLowerCase();
  while (wrappers < 16) {
    if (word(cursor - 2) === "complement" && word(cursor - 1) === "of") {
      cursor -= 2;
      if (word(cursor - 1) === "the") cursor--;
    } else if (word(cursor - 2) === "not" && word(cursor - 1) === "satisfying") {
      cursor -= 2;
      if (word(cursor - 1) === "set") {
        cursor--;
        if (word(cursor - 1) === "the") cursor--;
      }
    } else if (word(cursor - 2) === "opposite" && word(cursor - 1) === "to") cursor -= 2;
    else break;
    wrappers++;
  }
  if (!wrappers) return null;
  const start = tokens[cursor]!.index!;
  const plain = body.slice(0, start) + body.slice(source[0]!.start);
  const operands = clauses(plain, names, labels, true);
  if (!same(signatures(operands.map(clause => clause.text), names), signatures(source.map(clause => clause.text), names)))
    throw new Error("Unary source proof must retain every complete original operand");
  let program = booleanProgram(plain, operands, labels);
  for (let index = 0; index < wrappers; index++) program = { complement: program };
  return program;
}

/** A failed request proof cannot erase independently readable source operands.
 * This is predicate inventory only: it neither invents a result nor proves the
 * prose/Boolean request. Other native components may collectively own predicates.
 */
function requireIncompleteSourceConstraintCoverage(question: string, names: readonly string[], document: SceneDocument): void {
  const normalized = normalize(question);
  let body = sourceNotation(canonicalRealDomainSource(normalized, names), names);
  // Only an isolated affirmative postfix declaration has independent scope.
  // Unknown prefix adjectives, negations, modalities or trailing qualifiers
  // remain untouched and are refused by the unproved-sign check below.
  const native = `(?:${names.join("|")})`;
  const subjects = `${native}(?:\\s*(?:,\\s*(?:and\\s*)?|and\\s+)${native}){0,8}`;
  // A real, explicitly typed native-subject noun phrase has the existing
  // variable-domain role even if the surrounding objective prose is unknown.
  const typedSubjects = `real\\s+(?:${SIGN_DOMAIN_PROPERTY})\\s+(?:variables?|(?:production\\s+)?amounts?|quantities|values)\\s+${subjects}`;
  body = body.replace(new RegExp(`(^|[.;?!\\r\\n])(\\s*(?:(?:let|for|given)\\s+|(?:a|an|the)\\s+[A-Za-z]{2,}\\s+chooses\\s+)?)(${typedSubjects})(?=\\s*(?:[;?!\\r\\n]|\\.(?!\\d)|$))`, "gi"),
    (_whole, boundary: string, prefix: string, declaration: string) => `${boundary}${prefix}${explicitDomains(declaration, names)}`);
  body = body.replace(new RegExp(`(^|[.;?!\\r\\n]|\\band\\b)(\\s*)(${subjects})\\s+(?:is|are)\\s+(${SIGN_DOMAIN_PROPERTY})\\b(?=\\s*(?:[;?!\\r\\n]|\\.(?!\\d)|$))`, "gi"),
    (whole: string, boundary: string, space: string, variables: string, _sign: string, offset: number, original: string) => {
      const subjectEnd = offset + boundary.length + space.length + variables.length;
      if (hasLinearCoefficientSubject(original, subjectEnd)
        || boundary.toLowerCase() === "and" && new RegExp(`\\b${native}\\s*$`).test(original.slice(0, offset))) return whole;
      return `${boundary}${space}${explicitDomains(whole.slice(boundary.length + space.length), names)} `;
    });
  const realSpans: Array<{ start: number; end: number }> = [];
  hasUnsupportedHindiDomain(body, names, realSpans);
  const realMasked = body.split("");
  for (const span of realSpans) for (let index = span.start; index < span.end; index++) realMasked[index] = " ";
  body = realMasked.join("");
  const points = readLinearSourceReferencePoints(body, names);
  let objective: SourceObjective | undefined;
  try { objective = sourceObjective(incompleteSourceMixedScalars(points.maskedQuestion), names); }
  catch { /* No objective value or direction is inferred from an unproved request. */ }
  const scalarSpans: Array<{ start: number; end: number }> = [];
  body = maskLinearSourceScalarNameRoles(points.maskedQuestion, names, label => !names.includes(label), scalarSpans);
  const scalarMasked = body.split("");
  for (const span of scalarSpans) for (let index = span.start; index < span.end; index++) scalarMasked[index] = " ";
  body = scalarMasked.join("");
  // Under an unproved request even a recognized sign may be negated or
  // qualified. Exempt only exact property occurrences; never expand a
  // remaining sign into an assumed positive constraint.
  body = linearRationalPropertySource(body, names, true);
  if (new RegExp(`\\b(?:${SIGN_DOMAIN_PROPERTY})\\b`, "i").test(body))
    throw new Error("An unproved variable sign/domain occurrence cannot be omitted from a linear figure");
  body = incompleteSourceMixedScalars(body);
  const hasNative = [...body.matchAll(/(?:\d+(?:\.\d+|\.(?=[eE][+-]?\d))?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*/g)].some(token => names.includes(token[0]));
  const domains = firstQuadrantDomains(normalized, names);
  const source = hasNative && (/[<>=]/.test(body) || domains.length > 0) ? clauses(body, names, points.points.map(point => point.label), true) : [];
  const unary = incompleteUnarySourceProgram(body, source, points.points.map(point => point.label), names);
  source.push(...domains);
  const proposed: string[] = [];
  const numberPrograms: IntervalExpression[] = [];
  for (const construction of document.constructions) {
    if (!(LINEAR_REGION_OPERATORS as readonly string[]).includes(construction.operator)) continue;
    const input = evaluateLinearRegionConstruction(construction.operator, construction.inputs)[0]!.input;
    const candidateNames = input.kind === "number_line_set" ? [input.variable ?? "x"] : input.variables ?? ["x", "y"];
    if (!same(candidateNames, names)) continue;
    const suppliedObjective = input.kind === "linear_feasible_region" ? input.objective : undefined;
    if (objective) {
      if (input.kind !== "linear_feasible_region" || !suppliedObjective || objective.sense !== suppliedObjective.sense
        || !same(parseLinearAffine(objective.expression, names), parseLinearAffine(suppliedObjective.expression, names)))
        throw new Error("Candidate omits or changes the independently proved source objective expression or direction");
      if (!same(signatures(input.constraints, names), signatures(source.map(clause => clause.text), names)))
        throw new Error("An objective carrier must own the complete source constraint program without borrowing another component");
    } else if (suppliedObjective) throw new Error("Candidate objective has no complete independently proved source expression and direction");
    if (input.kind === "number_line_set") numberPrograms.push(input.expression);
    proposed.push(...(input.kind === "number_line_set" ? inequalityLeaves(input.expression) : input.kind === "linear_half_plane" ? [input.inequality] : input.kind === "linear_system" ? input.equations : input.constraints));
  }
  if (!source.length) return;
  if (unary) {
    const program: IntervalExpression = domains.length ? { intersection: [unary, ...domains.map(clause => ({ inequality: clause.text }))] } : unary;
    if (names.length === 1 && numberPrograms.length === 1) {
      const expected = solveLinearFigure({ kind: "number_line_set", variable: names[0], expression: program });
      const actual = solveLinearFigure({ kind: "number_line_set", variable: names[0], expression: numberPrograms[0]! });
      const sourcePredicates = planarPredicates(program), candidatePredicates = planarPredicates(numberPrograms[0]!);
      if (expected.kind === "number_line_set" && actual.kind === "number_line_set" && sourcePredicates && candidatePredicates
        && same(signatures(sourcePredicates, names), signatures(candidatePredicates, names)) && same(expected.intervals, actual.intervals)) return;
    } else if (names.length === 2) {
      const predicates = planarPredicates(program);
      if (predicates && same(signatures(predicates, names), signatures(proposed, names)) && planarBooleanAgreement(program, proposed, names) === true) return;
    }
    throw new Error("Candidate does not own the complete independently proved unary source program");
  }
  for (const operator of body.matchAll(new RegExp(`\\b(?:or|not|complement|union|if|then|${UNSUPPORTED_LINEAR_INTERVAL_BOOLEAN_WORDS})\\b`, "gi"))) {
    const following = source.find(clause => clause.start >= operator.index! + operator[0].length);
    const previous = source.slice().reverse().find(clause => clause.end <= operator.index!);
    // A sequential display modifier between two identical operands introduces
    // no new predicate or polarity. This does not cover mathematical "then",
    // a conditional antecedent, or different requested source constraints.
    if (operator[0].toLowerCase() === "then" && previous && following
      && /^\s*(?:graph|shade|show|plot|represent|draw|illustrate)\b/i.test(body.slice(operator.index! + operator[0].length))
      && !domains.length && same(signatures(source.map(clause => clause.text), names), signatures([previous.text], names))
      && same(signatures(proposed, names), signatures([previous.text], names))) continue;
    if (following && !/[.;?!\r\n]/.test(body.slice(operator.index! + operator[0].length, following.start))
      || previous && /^[()\s]*$/.test(body.slice(previous.end, operator.index!)))
      throw new Error("An unproved source Boolean operand scope cannot be replaced by a planner conjunction");
  }
  if (numberPrograms.some(program => !isIntersectionProgram(program)))
    throw new Error("A nonconjunctive planner cannot supply unproved source Boolean scope");
  const owned = new Set(signatures(proposed, names));
  if (signatures(source.map(clause => clause.text), names).some(signature => !owned.has(signature)))
    throw new Error("Candidate omits a stated source comparison or variable-domain predicate while the complete request is unproved");
}

export function validateLinearSourceBinding(document: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const incompleteCoverage = new Map<string, Error | null>();
  for (const [constructionIndex, construction] of document.constructions.entries()) {
    if (!(LINEAR_REGION_OPERATORS as readonly string[]).includes(construction.operator)) continue;
    try {
      const question = document.source.question;
      if (typeof question !== "string" || question.length > 2000)
        throw new Error("Linear figures require bounded original question text");
      const geometry = evaluateLinearRegionConstruction(construction.operator, construction.inputs)[0]!;
      const input = geometry.input;
      const names = input.kind === "number_line_set" ? [input.variable ?? "x"] : input.variables ?? ["x", "y"];
      // These are independent contradictions, not request-parser failures.
      if (input.kind !== "number_line_set" && names.includes("x") && names.includes("y") && (names[0] !== "x" || names[1] !== "y"))
        throw new Error("Source x/y coordinates require canonical axis order ['x','y'] for boundary, corner and solution tuples");
      if (geometry.solution.kind !== "number_line_set") {
        const rows = geometry.solution.kind === "linear_system" ? geometry.solution.equations : geometry.solution.constraints;
        for (const free of question.matchAll(/\bno\s+constraint\s+on\s+([xy])\s*(?=[.;?!]|$)/gi)) {
          const coefficient = free[1]!.toLowerCase() === "x" ? "a" : "b";
          if (rows.some(row => row[coefficient].numerator !== "0")) throw new Error("An original free-coordinate declaration contradicts a source constraint");
        }
      }
      if (input.kind === "linear_system") {
        // Independently quoted tuples and a genuine explicit intersection name
        // can contradict the candidate even when surrounding prose is unknown.
        let points: ReturnType<typeof readLinearSourceReferencePoints>["points"] = [];
        try { points = readLinearSourceReferencePoints(question, names).points; } catch { /* No complete literal tuple proof. */ }
        const intersectionNames = readLinearSourceIntersectionNames(question);
        const givens = points.filter(point => intersectionNames.has(point.label));
        const solution = geometry.solution;
        if (givens.length && (solution.kind !== "linear_system" || solution.relation !== "unique" || !solution.intersection
          || givens.some(point => !same(point.x, solution.intersection!.x) || !same(point.y, solution.intersection!.y))))
          throw new Error("An original named intersection tuple contradicts the complete source system");
      }
      const authority = readLinearBindingSource(question, names, input.kind === "number_line_set");
      if (hasUnsupportedDiscreteDomain(question, input.kind !== "number_line_set", authority !== null, authority?.aliases, names))
        throw new Error("Continuous linear figures cannot represent a source with an unsupported discrete domain cue");
      if (!authority) {
        const context = JSON.stringify(names);
        if (!incompleteCoverage.has(context)) {
          try { requireIncompleteSourceConstraintCoverage(question, names, document); incompleteCoverage.set(context, null); }
          catch (error) { incompleteCoverage.set(context, error instanceof Error ? error : new Error(String(error))); }
        }
        const failure = incompleteCoverage.get(context);
        if (failure) throw failure;
        continue;
      }
      const ownedOutputs = new Set(document.constructions
        .filter(item => (LINEAR_REGION_OPERATORS as readonly string[]).includes(item.operator))
        .flatMap(item => item.outputs));
      if (document.requiredEntityIds.some(id => !ownedOutputs.has(id) && document.entities.find(entity => entity.id === id)?.kind !== "group"))
        throw new Error("A complete native linear source requires every diagram mark to belong to its verified linear operators");
      if (input.kind === "linear_feasible_region") {
        if (Boolean(authority.objective) !== Boolean(input.objective)) throw new Error("Candidate and complete source objective presence differ");
        if (authority.objective && input.objective && (authority.objective.sense !== input.objective.sense
          || !same(parseLinearAffine(authority.objective.expression, names), parseLinearAffine(input.objective.expression, names))))
          throw new Error("Candidate objective contradicts the complete original source objective");
      } else if (authority.objective) throw new Error("Candidate omits the complete original source objective");
      if (input.kind === "number_line_set") {
        if (!same(signatures(inequalityLeaves(authority.program), names), signatures(inequalityLeaves(input.expression), names)))
          throw new Error("Candidate constraints contradict the complete original number-line source");
        const sourceSolution = solveLinearFigure({ kind: "number_line_set", variable: names[0], expression: authority.program });
        if (sourceSolution.kind !== "number_line_set" || geometry.solution.kind !== "number_line_set" || !same(sourceSolution.intervals, geometry.solution.intervals))
          throw new Error("Candidate Boolean solution contradicts the complete original number-line source");
      } else {
        const proposed = input.kind === "linear_half_plane" ? [input.inequality] : input.kind === "linear_system" ? input.equations : input.constraints;
        if (!isIntersectionProgram(authority.program)) {
          const predicates = planarPredicates(authority.program);
          if (predicates && !same(signatures(predicates, names), signatures(proposed, names)))
            throw new Error("Candidate predicates contradict exact original source boundaries or their Boolean polarity");
          const agreement = planarBooleanAgreement(authority.program, proposed, names);
          if (agreement !== true)
            throw new Error(agreement === false
              ? "An exact feasible witness proves the candidate contradicts the original source Boolean region"
              : "Candidate Boolean region requires a completed exact equivalence proof for the complete original source");
          continue;
        }
        const source = authority.source;
        if (input.kind === "linear_half_plane" && (source.length !== 1 || source[0]!.equality))
          throw new Error("Half-plane contradicts the complete source comparison count or kind");
        if (input.kind === "linear_system" && (source.length !== 2 || source.some(clause => !clause.equality)))
          throw new Error("System contradicts the complete source comparison count or kind");
        if (!same(signatures(source.map(clause => clause.text), names, input.kind === "linear_system"), signatures(proposed, names, input.kind === "linear_system")))
          throw new Error("Candidate linear constraints contradict the complete original source program");
      }
    } catch (error) {
      issues.push({ code: "linear_source_mismatch", message: error instanceof Error ? error.message : "Invalid linear candidate",
        severity: "fatal", path: `constructions[${constructionIndex}]`, entityIds: construction.outputs });
    }
  }
  return issues;
}
/** Authored semantic/derived labels cannot override the engine-owned solution. */
export function validateLinearClaims(
  document: SceneDocument,
  constructionIndex: number,
  geometry: LinearRegionGeometry,
  issues: SceneIssue[],
): void {
  const construction = document.constructions[constructionIndex]!;
  const protectedIds = new Set(construction.outputs);
  for (const entity of document.entities)
    if (entity.kind === "group") protectedIds.add(entity.id);
  for (const group of document.revealGroups)
    if (group.entityIds.some((id) => protectedIds.has(id)))
      protectedIds.add(group.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of document.constructions)
      if (
        item.outputs.some((id) => protectedIds.has(id)) ||
        Object.values(item.inputs).some(
          (value) => typeof value === "string" && protectedIds.has(value),
        )
      )
        for (const id of item.outputs)
          if (!protectedIds.has(id)) {
            protectedIds.add(id);
            changed = true;
          }
  }
  const claims = [
    ...document.entities
      .filter((entity) => protectedIds.has(entity.id))
      .flatMap((entity) => [
        entity.label,
        entity.semantic
          ? JSON.stringify(snapshotMathSourceData(entity.semantic))
          : undefined,
      ]),
    ...document.annotations
      .filter((annotation) =>
        annotation.targetIds.some((id) => protectedIds.has(id)),
      )
      .map((annotation) => annotation.text),
    ...document.constructions
      .filter(
        (item) =>
          item.outputs.some((id) => protectedIds.has(id)) &&
          item.operator === "label",
      )
      .flatMap((item) => [item.inputs.text, item.inputs.label])
      .filter((value): value is string => typeof value === "string"),
  ];
  if (
    document.annotations.some((annotation) => annotation.kind !== "narration")
  )
    issues.push({
      code: "untrusted_linear_annotation",
      message: "Linear shading, labels and endpoint marks are operator-owned",
      severity: "fatal",
      entityIds: construction.outputs,
    });
  for (const claim of claims) {
    if (!claim) continue;
    if (
      /^(?:solution|feasible region|number line|half[ -]plane|linear system|graph|region|system|inequality|inequalities)$/i.test(
        claim.trim(),
      )
    )
      continue;
    // Identity-only labels are permitted. All calculated values and solution
    // semantics are emitted by this operator, never silently overwritten.
    if (
      /[\d<>=≤≥]|\b(?:corner|vertex|vertices|feasible|infeasible|empty|maximum|minimum|optimum|supremum|infimum|unbounded|parallel|coincident|solution|shad(?:e|ed|ing)|solid|dashed|open|closed)\b/i.test(
        claim,
      )
    ) {
      // The original question may be quoted as a title, without a derived claim.
      const sourceExpressions =
        geometry.input.kind === "linear_half_plane"
          ? [geometry.input.inequality]
          : geometry.input.kind === "linear_system"
            ? geometry.input.equations
            : geometry.input.kind === "linear_feasible_region"
              ? geometry.input.constraints
              : [];
      if (
        sourceExpressions.some(
          (expression) =>
            normalize(claim).replace(/\s/g, "") ===
            normalize(expression).replace(/\s/g, ""),
        )
      )
        continue;
      issues.push({
        code: "untrusted_linear_claim",
        message:
          "Linear solution values and boundary semantics must be emitted by the verified operator",
        severity: "fatal",
        path: `constructions[${constructionIndex}]`,
        entityIds: construction.outputs,
      });
    }
  }
}
