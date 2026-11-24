/** Original literal declarations only. The definition is the number-fraction
 * weighted sum of isotopic masses (CIAAW TSAW-2009; IUPAC R05258 distinguishes
 * dimensionless relative atomic mass). No natural abundance/mass table, supplied
 * AST, planner law, sourceText, or dependency list participates in this proof. */
import { resolveElement } from "../chemistry/elements";
import { CHEMISTRY_SCALAR_PATTERN, convertChemistryValue, parseChemistryScalar, readChemistryUnitLiteral, type ChemistrySpan } from "../chemistry/quantityReader";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import type { ProblemIR } from "../ir/problemIR";
import { exactBinary64 } from "../math/exactBinary64";
import { addRational, compareRational, divideRational, exactRationalToNumber, multiplyRational, parseRational, Q_ZERO, rational, serializeRational, type ExactRational, type Rational } from "../math/exactRational";
import { ATOMIC_MASS_UNIT_KG, sourceMassContexts } from "./atomicMassSource";

type Span = ChemistrySpan;
type MassUnit = "u" | "kg" | "g";
interface Literal { span: Span; scalarSpan: Span; exact: ExactRational }
export interface IsotopeMeanMassTerm {
  declaration: Span;
  owner: { A: number; Z: number; name: string; span: Span };
  mass: Literal & { unit: MassUnit };
  abundance: Literal & { unit: "%"; numberFraction: ExactRational };
}
interface CertifiedScalar { approximate: number; errorBound: number; exact: ExactRational }
export interface IsotopeMeanMassSourceCertificate extends CertifiedScalar {
  version: "isotope-mean-mass-source/v1";
  meaning: "number_weighted_mean_atomic_mass";
  unit: "kg";
  element: { Z: number; symbol: string };
  terms: IsotopeMeanMassTerm[];
  requested: { span: Span; meaningSpan: Span; symbol?: { text: string; span: Span }; unit?: MassUnit };
}
export type IsotopeMeanMassSourceRead = { status: "unproved"; reason: string } |
  { status: "certified"; certificate: IsotopeMeanMassSourceCertificate };
export type IsotopeMeanMassOutputRead = { status: "unproved"; reason: string } | {
  status: "certified"; certificate: IsotopeMeanMassSourceCertificate;
  binding: CertifiedScalar & { resultId: string; symbol: string; unit: MassUnit };
};

export const ISOTOPE_MEAN_SOURCE_LIMITS = Object.freeze({ characters: 4096, scalars: 64, scalarCharacters: 96, isotopes: 12 });
const MIN_NORMAL = 2 ** -1022;
const HUNDRED = parseRational(100);
const SCALAR_PREFIX = new RegExp(`^(?:${CHEMISTRY_SCALAR_PATTERN})`);
const massUnit = (unit: unknown): unit is MassUnit => unit === "kg" || unit === "g" || unit === "u";
function fail(reason: string): never { throw new Error(reason); }
function unproved(error: unknown): { status: "unproved"; reason: string } {
  return { status: "unproved", reason: error instanceof Error ? error.message : "unsupported original isotope declarations" };
}
function scale(unit: MassUnit): Rational {
  if (unit === "u") return parseRational(ATOMIC_MASS_UNIT_KG);
  const converted = convertChemistryValue(1, unit, "kg", "mass");
  if (!converted.ok) return fail("unsupported mass conversion");
  return parseRational(converted.reading);
}
function finiteNormal(value: Rational): number {
  const approximate = exactRationalToNumber(serializeRational(value));
  if (!Number.isFinite(approximate) || approximate < MIN_NORMAL) fail("positive mass/fraction contribution exceeds normal finite precision");
  return approximate;
}
function certifyScalar(value: Rational): CertifiedScalar {
  const approximate = finiteNormal(value), binary = exactBinary64(approximate);
  const represented = binary.power >= 0 ? rational(binary.n << BigInt(binary.power)) : rational(binary.n, 1n << BigInt(-binary.power));
  // One correctly rounded rational-to-binary64 conversion. A full relative
  // epsilon bounds its rounding; exact representable values earn zero error.
  const errorBound = compareRational(value, represented) === 0 ? 0 : Math.abs(approximate) * Number.EPSILON;
  if (!Number.isFinite(errorBound) || errorBound < 0 || errorBound >= approximate) fail("unresolved mass precision");
  return { approximate, errorBound, exact: serializeRational(value) };
}
function preflight(question: string): void {
  if (typeof question !== "string" || !question.trim() || question.length > ISOTOPE_MEAN_SOURCE_LIMITS.characters) fail("source text budget");
  // Bound digit runs before invoking the shared scalar/context regexes.
  if (/\d{81}/.test(question)) fail("source scalar character budget");
  let count = 0;
  for (const match of question.matchAll(new RegExp(CHEMISTRY_SCALAR_PATTERN, "g"))) {
    if (++count > ISOTOPE_MEAN_SOURCE_LIMITS.scalars || match[0].trim().length > ISOTOPE_MEAN_SOURCE_LIMITS.scalarCharacters) fail("source scalar budget");
  }
}

/** Exact companion to the existing original-span numeric reader. Only literal
 * decimal/fraction/power spellings already accepted by that reader are used. */
function sourceRational(question: string, span: Span): Rational {
  const numeric = parseChemistryScalar(question, span);
  if (!numeric.ok) fail("incomplete or unsupported original scalar");
  const text = question.slice(span.start, span.end).replace(/\s/g, "").replace(/−/g, "-");
  if (text.length > ISOTOPE_MEAN_SOURCE_LIMITS.scalarCharacters) fail("source scalar character budget");
  const fraction = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\/((?:\d+(?:\.\d*)?|\.\d+))$/.exec(text);
  if (fraction) return divideRational(parseRational(fraction[1]!), parseRational(fraction[2]!));
  const power = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)|[+-])?[x×*]?10\^\(?([+-]?\d+)\)?$/.exec(text) ??
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)|[+-])?[x×*]?10([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(text);
  if (power) {
    const exponent = [...power[2]!].map(character => {
      const digit = "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(character);
      return digit >= 0 ? String(digit) : character === "⁻" ? "-" : character === "⁺" ? "+" : character;
    }).join("");
    if (Math.abs(Number(exponent)) > 300) fail("source exponent budget");
    const mantissa = power[1] === undefined || power[1] === "+" ? "1" : power[1] === "-" ? "-1" : power[1];
    return multiplyRational(parseRational(mantissa), parseRational(`1e${exponent}`));
  }
  const exponent = /[eE]([+-]?\d+)$/.exec(text);
  if (exponent && Math.abs(Number(exponent[1])) > 300) fail("source exponent budget");
  return parseRational(text);
}

/** A complete small declaration grammar, not a search for useful substrings.
 * Unknown prose (including reporting, quotation, conditions and prohibitions)
 * cannot disappear between the consumed quantities and request. */
class SourceReader {
  at = 0;
  private readonly masses;
  constructor(readonly question: string) { this.masses = sourceMassContexts(question); }
  take(pattern: RegExp): RegExpExecArray | null {
    const reader = new RegExp(`\\s*(?:${pattern.source})`, `${pattern.ignoreCase ? "i" : ""}dy`);
    reader.lastIndex = this.at;
    const result = reader.exec(this.question);
    if (result) this.at = reader.lastIndex;
    return result;
  }
  need(pattern: RegExp, reason: string): RegExpExecArray { return this.take(pattern) ?? fail(reason); }
  skip(): number { this.at += /^\s*/.exec(this.question.slice(this.at))![0].length; return this.at; }
  header(): number | undefined {
    const header = this.take(/(?:a|the)\s+(?:simplified\s+)?(?:([A-Za-z]{1,20})\s+(?:sample|mixture)|(?:sample|mixture)(?:\s+of\s+([A-Za-z]{1,20}))?)\s+(?:has|contains|consists\s+of)\b\s*:?/i);
    const name = header?.[1] ?? header?.[2];
    if (!name) return undefined;
    return resolveElement(name)?.z ?? fail("unresolved source sample element");
  }
  scalar(): { span: Span; value: Rational } {
    this.skip(); const start = this.at, token = SCALAR_PREFIX.exec(this.question.slice(start));
    if (!token) fail("expected an original literal scalar");
    this.at += token[0].trimEnd().length;
    return { span: { start, end: this.at }, value: sourceRational(this.question, { start, end: this.at }) };
  }
  percentage(): IsotopeMeanMassTerm["abundance"] {
    const scalar = this.scalar(); this.need(/%/, "explicit number percentage required");
    if (/^\s*[-−]/.test(this.question.slice(scalar.span.start, scalar.span.end)) || scalar.value.n < 0n || compareRational(scalar.value, HUNDRED) > 0) fail("number abundance must lie between zero and 100 percent");
    const literal = readChemistryUnitLiteral({ question: this.question, scalarSpan: scalar.span });
    if (!literal.ok || literal.reading.rawUnit !== "%" || literal.reading.source.span.end !== this.at) fail("incomplete source percentage unit");
    return { span: { start: scalar.span.start, end: this.at }, scalarSpan: scalar.span, exact: serializeRational(scalar.value),
      unit: "%", numberFraction: serializeRational(divideRational(scalar.value, HUNDRED)) };
  }
  owner(): IsotopeMeanMassTerm["owner"] {
    this.take(/(?:the\s+)?isotope\s+/i);
    const owner = this.need(/([A-Za-z]{1,20})(?:\s*[-–−]\s*|\s+)(\d{1,3})(?![\d.])/, "explicit named isotope owner required");
    const name = owner[1]!, element = resolveElement(name), A = Number(owner[2]);
    if (!element || !Number.isInteger(A) || A < element.z || A > 300) fail("invalid or unresolved isotope owner");
    const start = owner.indices![1]![0];
    return { A, Z: element.z, name, span: { start, end: this.at } };
  }
  mass(): IsotopeMeanMassTerm["mass"] {
    const scalar = this.scalar(), unit = this.need(/(kg|g|u)(?![A-Za-z0-9_])/, "explicit isotopic mass unit required")[1]!;
    if (!massUnit(unit) || scalar.value.n <= 0n) fail("isotopic masses must be positive finite literals");
    const context = this.masses.find(item => item.literalStart === scalar.span.start && item.scalarEnd === scalar.span.end && item.literalEnd === this.at);
    if (!context || context.value === undefined || context.unit !== unit) fail("mass literal must retain its original source context");
    if (unit !== "u") {
      const literal = readChemistryUnitLiteral({ question: this.question, scalarSpan: scalar.span });
      if (!literal.ok || literal.reading.dimension !== "mass" || literal.reading.source.span.end !== this.at) fail("whole source unit must be a mass");
    }
    finiteNormal(scalar.value); finiteNormal(multiplyRational(scalar.value, scale(unit)));
    return { span: { start: scalar.span.start, end: this.at }, scalarSpan: scalar.span, unit, exact: serializeRational(scalar.value) };
  }
  term(): IsotopeMeanMassTerm {
    const start = this.skip();
    let owner: IsotopeMeanMassTerm["owner"];
    let mass: IsotopeMeanMassTerm["mass"] | undefined;
    let abundance: IsotopeMeanMassTerm["abundance"] | undefined;
    if (/^[+\-−\d.]/.test(this.question.slice(this.at))) {
      abundance = this.percentage();
      this.take(/of\s+(?:the\s+)?atoms\s+(?:are\s+)?/i);
      owner = this.owner();
      this.need(/(?:of|with)\s+(?:(?:an?|the)\s+)?(?:isotope\s+|isotopic\s+|atomic\s+)?mass\b\s*(?:of\b|is\b|=)?/i, "isotope mass must be attached to the same owner");
      mass = this.mass();
    } else {
      owner = this.owner(); this.take(/has\b|:/i);
      const grouped = Boolean(this.take(/\(/));
      const attribute = () => {
        if (this.take(/(?:(?:isotope|isotopic|atomic)\s+)?mass\b\s*(?:of\b|is\b|=)?/i)) {
          if (mass) fail("duplicate isotope mass"); mass = this.mass();
        } else {
          this.need(/(?:(?:number|isotopic)\s+)?abundance\b\s*(?:of\b|is\b|=)?/i, "only isotopic mass and number-abundance attributes are supported");
          if (abundance) fail("duplicate isotope abundance"); abundance = this.percentage();
          this.take(/by\s+number\b/i);
        }
      };
      attribute(); this.need(/,\s*(?:and\s+)?|and\b/i, "each isotope requires both mass and abundance"); attribute();
      if (grouped) this.need(/\)/, "unclosed isotope declaration");
    }
    if (!mass || !abundance) return fail("each isotope requires its own mass and number abundance");
    return { declaration: { start, end: this.at }, owner, mass, abundance };
  }
  request(): IsotopeMeanMassSourceCertificate["requested"] {
    const start = this.skip();
    const request = this.need(/(?:compute|find|calculate|determine)\s+(?:(?:the|its)\s+)?(?:abundance[- ]weighted\s+)?((?:mean|average)\s+(?:atomic\s+)?mass)\b/i, "an affirmative mean atomic mass request is required");
    const meaningSpan = { start: request.indices![1]![0], end: request.indices![1]![1] };
    if (this.take(/of\s+(?:the\s+|this\s+)?/i)) {
      const subject = this.need(/(?:([A-Za-z]{1,20})\s+)?(?:sample|mixture)\b/i, "requested mean must belong to this sample");
      if (subject[1]) {
        const Z = resolveElement(subject[1])?.z;
        if (!Z || this.masses.length === 0) fail("unresolved requested sample element");
        this.requestedZ = Z;
      }
    }
    let symbol: IsotopeMeanMassSourceCertificate["requested"]["symbol"];
    // Source-declared output aliases, including an opaque literal identifier.
    const named = this.take(/\(\s*(m̄|mbar|\\bar\{m\}|\\overline\{m\}|[A-Za-z][A-Za-z0-9_]{0,63})\s*\)|(?:denoted\s+)([A-Za-z][A-Za-z0-9_]{0,63})\b|(m̄|mbar|\\bar\{m\}|\\overline\{m\})(?=\s|[.;?]|$)/);
    if (named) {
      const group = named[1] ? 1 : named[2] ? 2 : 3, pair = named.indices![group]!;
      // Parentheses alone cannot turn an English modifier into an output
      // symbol. Word aliases require explicit 'denoted'; a single letter,
      // ordinary mean alias, or identifier with digits/underscores is lexical.
      if (group === 1 && alias(named[group]!) !== "m̄" && !/^[A-Za-z]$/.test(named[group]!) && !/[\d_]/.test(named[group]!)) fail("ambiguous parenthesized request text");
      symbol = { text: named[group]!, span: { start: pair[0], end: pair[1] } };
    }
    const explicitUnit = this.take(/in\s+(kg|g|u)(?![A-Za-z0-9_])/i);
    if (explicitUnit && !massUnit(explicitUnit[1])) fail("unsupported requested mass unit");
    if (this.take(/and\s+(?:illustrate|show|draw)\s+(?:the\s+)?(?:number\s+)?abundance\s+(?:weights|percentages|fractions)\b/i)) {
      this.take(/without\s+changing\s+(?:the\s+)?integer\s+mass\s+numbers\b/i);
    }
    this.take(/[.?]/);
    return { span: { start, end: this.at }, meaningSpan, ...(symbol ? { symbol } : {}), ...(explicitUnit ? { unit: explicitUnit[1] as MassUnit } : {}) };
  }
  requestedZ?: number;
  read() {
    let requested: IsotopeMeanMassSourceCertificate["requested"] | undefined;
    if (/^\s*(?:compute|find|calculate|determine)\b/i.test(this.question)) { requested = this.request(); this.take(/;/); }
    const headerZ = this.header(), terms: IsotopeMeanMassTerm[] = [];
    for (;;) {
      if (terms.length >= ISOTOPE_MEAN_SOURCE_LIMITS.isotopes) fail("isotope owner count budget");
      terms.push(this.term());
      if (this.take(/[.;]/)) {
        if (/^\s*(?:compute|find|calculate|determine)\b/i.test(this.question.slice(this.at))) break;
        if (requested && this.skip() === this.question.length) break;
      } else this.need(/,\s*(?:and\s+)?|and\b/i, "isotope declarations require an explicit separator");
    }
    if (!requested) requested = this.request();
    if (this.skip() !== this.question.length) fail("unconsumed or ambiguous original source text");
    if (terms.length < 2) fail("at least two distinct isotope owners are required");
    const Z = terms[0]!.owner.Z;
    if (terms.some(term => term.owner.Z !== Z) || headerZ !== undefined && headerZ !== Z || this.requestedZ !== undefined && this.requestedZ !== Z) fail("all isotope declarations and the requested sample must name the same element");
    if (new Set(terms.map(term => term.owner.A)).size !== terms.length) fail("duplicate or contradictory isotope owners");
    if (this.masses.length !== terms.length) fail("unowned original mass declaration");
    return { terms, requested, Z };
  }
}

function asRational(value: ExactRational): Rational { return rational(BigInt(value.numerator), BigInt(value.denominator)); }
/** Recompute from the complete original question every time; stored metadata
 * is never an input. Source spans always index the unchanged JS source string. */
export function readIsotopeMeanMassSource(question: string): IsotopeMeanMassSourceRead {
  try {
    preflight(question);
    const { terms, requested, Z } = new SourceReader(question).read();
    let percent = Q_ZERO, total = Q_ZERO;
    for (const term of terms) {
      percent = addRational(percent, asRational(term.abundance.exact));
      const contribution = multiplyRational(asRational(term.abundance.numberFraction), multiplyRational(asRational(term.mass.exact), scale(term.mass.unit)));
      if (contribution.n !== 0n) finiteNormal(contribution);
      total = addRational(total, contribution);
    }
    if (compareRational(percent, HUNDRED) !== 0) fail("complete original number abundances must sum to exactly 100 percent");
    const element = resolveElement(terms[0]!.owner.name)!;
    return { status: "certified", certificate: { version: "isotope-mean-mass-source/v1", meaning: "number_weighted_mean_atomic_mass", unit: "kg",
      element: { Z, symbol: element.symbol }, terms, requested, ...certifyScalar(total) } };
  } catch (error) { return unproved(error); }
}

function alias(symbol: string): string {
  const original = symbol.normalize("NFKC").trim();
  const ordinary = original.replace(/\\(?:bar|overline)\s*\{m\}/g, "m̄").replace(/[\s_{}()]/g, "").toLowerCase();
  // Typographic mean aliases have semantic compatibility. Opaque identifiers
  // retain case and underscores; they do not inherit the auditor's looser
  // symbol spelling equivalence.
  return /^(?:m̄|mbar|mean|meanmass|meanatomicmass|averagemass|averageatomicmass)$/.test(ordinary) ? "m̄" : original;
}

/** Mean notation has semantic aliases; opaque source symbols retain identity. */
export function isotopeMeanMassSymbolsAgree(first: string, second: string): boolean {
  return first.length <= 96 && second.length <= 96 && alias(first) === alias(second);
}

export type IsotopeMeanMassSourceInputRead = { status: "not_applicable" } | { status: "unproved" } | {
  status: "certified";
  binding: CertifiedScalar & { kind: "number_abundance" | "mass_number" | "atomic_number"; owner: { A: number; Z: number } };
};

/** Resolve conventional indexed input notation against the independently read
 * isotope inventory. This never binds an unknown/output as an original given.
 * Fraction and percent displays have different numerical centres. */
export function bindIsotopeMeanMassSourceInput(certificate: IsotopeMeanMassSourceCertificate, symbol: string, unit: unknown): IsotopeMeanMassSourceInputRead {
  const name = symbol.normalize("NFKC").replace(/[\s_{}]/g, "");
  const match = /^([faxAZ])(\d{1,3})$/.exec(name);
  if (!match) return { status: "not_applicable" };
  const term = certificate.terms.find(item => item.owner.A === Number(match[2]));
  if (!term) return { status: "unproved" };
  const fraction = /[fax]/.test(match[1]!);
  let value: Rational;
  if (fraction) {
    if (unit !== "%" && unit !== "1" && unit !== undefined) return { status: "unproved" };
    value = asRational(unit === "%" ? term.abundance.exact : term.abundance.numberFraction);
  } else {
    if (unit !== "1" && unit !== "count" && unit !== undefined) return { status: "unproved" };
    value = parseRational(match[1] === "A" ? term.owner.A : term.owner.Z);
  }
  const numeric = value.n === 0n ? { approximate: 0, errorBound: 0, exact: serializeRational(value) } : certifyScalar(value);
  return { status: "certified", binding: { ...numeric, kind: fraction ? "number_abundance" : match[1] === "A" ? "mass_number" : "atomic_number",
    owner: { A: term.owner.A, Z: term.owner.Z } } };
}

function originalRequestBinding(problem: ProblemIR, certificate: IsotopeMeanMassSourceCertificate, question: string, id: string, symbol: string, unit: MassUnit): boolean {
  if (problem.question !== question || problem.facts.length > 64 || problem.solveRequests.length !== 1 || new Set(problem.facts.map(fact => fact.id)).size !== problem.facts.length) return false;
  const bindings = problem.solveRequests.filter(request => request.resultBinding?.turnPlanQuantityId === id).map(request => request.resultBinding!);
  if (bindings.length !== 1) return false;
  const binding = bindings[0]!;
  if (typeof binding.symbol !== "string" || binding.symbol.length > 96 || alias(binding.symbol) !== alias(symbol) || binding.unit !== unit || !binding.evidenceFactIds.length || binding.evidenceFactIds.length > 4 || new Set(binding.evidenceFactIds).size !== binding.evidenceFactIds.length) return false;
  return binding.evidenceFactIds.every(factId => {
    const fact = problem.facts.find(item => item.id === factId), evidence = fact?.evidence, request = certificate.requested;
    return fact?.kind === "requested" && evidence?.source === "question" && Number.isInteger(evidence.start) && Number.isInteger(evidence.end) &&
      evidence.start >= request.span.start && evidence.end <= request.span.end && evidence.start <= request.meaningSpan.start && evidence.end >= request.meaningSpan.end &&
      evidence.quote === question.slice(evidence.start, evidence.end);
  });
}

/** Bind only the retained requested mass unknown. Standard mean aliases work
 * without IR (legacy save/restore); opaque symbols need an original requested
 * fact plus its result binding, or an explicit alias in the source request.
 * Returned numbers are recomputed truth, not approval of any plan/candidate
 * number. The caller must compare both numbers in common units, preserve the
 * candidate symbol, and retain the existing original-given anti-forgery checks. */
export function bindIsotopeMeanMassSourceOutput(input: { question: string; turnPlan: TurnPlanV3; quantityId: string; problemIR?: ProblemIR | null }): IsotopeMeanMassOutputRead {
  try {
    const { question, turnPlan: plan, quantityId, problemIR } = input;
    if (typeof quantityId !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(quantityId) || plan.question !== question || plan.unknowns.length > 64 || plan.givens.length > 64 || plan.derived.length > 64) fail("retained plan must match the original question within quantity budgets");
    if (plan.unknowns.filter(quantity => quantity.id === quantityId).length !== 1) fail("the requested output identity must be unique across all unknown units");
    const unknowns = plan.unknowns.filter(quantity => massUnit(quantity.unit));
    if (unknowns.length !== 1 || unknowns[0]!.id !== quantityId || plan.givens.some(quantity => quantity.id === quantityId)) fail("exactly one requested mass unknown must own this output id");
    const output = unknowns[0]!, derived = plan.derived.filter(quantity => quantity.id === quantityId);
    if (typeof output.symbol !== "string" || output.symbol.length > 96 || !output.symbol.trim() || derived.length > 1 || derived.some(quantity => typeof quantity.symbol !== "string" || quantity.symbol.length > 96 || alias(quantity.symbol) !== alias(output.symbol) || !massUnit(quantity.unit))) fail("retained output aliases or units conflict");
    if (!massUnit(output.unit)) fail("requested mean requires an explicit mass unit");
    const read = readIsotopeMeanMassSource(question);
    if (read.status !== "certified") return read;
    const certificate = read.certificate, sourceSymbol = certificate.requested.symbol;
    if (sourceSymbol ? alias(sourceSymbol.text) !== alias(output.symbol) : alias(output.symbol) !== "m̄") {
      if (sourceSymbol || !problemIR || !originalRequestBinding(problemIR, certificate, question, quantityId, output.symbol, output.unit)) fail("output symbol is not independently bound to the original mean request");
    }
    if (problemIR && !originalRequestBinding(problemIR, certificate, question, quantityId, output.symbol, output.unit)) fail("retained IR request evidence does not identify this original mean output");
    const value = divideRational(asRational(certificate.exact), scale(output.unit));
    return { status: "certified", certificate, binding: { resultId: quantityId, symbol: output.symbol, unit: output.unit, ...certifyScalar(value) } };
  } catch (error) { return unproved(error); }
}
