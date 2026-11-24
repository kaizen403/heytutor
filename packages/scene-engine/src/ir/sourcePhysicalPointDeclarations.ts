import { parseMathExpression } from "../math/expression";
import { deriveMechanicsMass, MECHANICS_RELATIVE_ERROR, type MechanicsMassState } from "../physics/rigidBodyAuthority";
import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import type { ProblemIR, QuestionSourceEvidence, SolveResultBinding } from "./problemIR";
import type { SceneDocument } from "../types";
import { replayMechanicsProgram, type MechanicsProgramInput, type MechanicsProgramStep } from "./mechanicsProgram";

type Component = "x" | "y";
export interface SourcePhysicalPointBody {
  readonly id: string;
  readonly label: string;
  readonly mass: { readonly sourceExpression: string; readonly sourceUnit: string; readonly valueSI: number };
  readonly position: { readonly sourceExpression: string; readonly sourceUnit: string; readonly xSI: number; readonly ySI: number; readonly unitEvidence?: QuestionSourceEvidence };
  readonly evidence: QuestionSourceEvidence;
}
export interface SourcePhysicalPointDeclarations {
  readonly question: string;
  readonly bodies: readonly SourcePhysicalPointBody[];
  readonly roster: QuestionSourceEvidence;
  readonly aggregate: { readonly id: string; readonly label: string };
  readonly frame: QuestionSourceEvidence;
  readonly centre: { readonly id: string; readonly label: string; readonly components: readonly Component[]; readonly evidence: QuestionSourceEvidence };
  readonly totalMassRequested: boolean;
  readonly connector?: QuestionSourceEvidence;
  readonly masslessLinks?: QuestionSourceEvidence;
}

const NAME = "[\\p{L}][\\p{L}\\p{N}_'′]{0,63}";
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const COUNTS: Readonly<Record<string, number>> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16 };
const NON_FACT = /\b(?:not|false|incorrect|hypothetical|if|unless|maybe|might|may|would|could|possible|suppose|reported|says?|states?|claims?|alleges?|reports?|according|someone|unknown|unspecified)\b/iu;
const OTHER_CASE = /\b(?:case|experiment|scenario|alternative)\s*(?:[0-9A-Z]|one|two)\b|\b(?:another|separate|second|different)\s+(?:case|experiment|scenario|system|setup|configuration|example)\b/iu;
const normal = (text: string): string => text.normalize("NFKC").replace(/\\(?:mathrm|text|operatorname)\s*/gu, "").replace(/[{}\s]/gu, "");
const sourceHeader = () => new RegExp(`\\b(?:${Object.keys(COUNTS).join("|")}|[1-9]\\d?|only|all)\\s+(?:point\\s+masses|(?:point\\s+)?particles)\\b`, "giu");
/** Recognition does not grant numerical authority. Unsupported original
 * clauses remain in this source-model lane instead of reaching old CM ink. */
export function sourcePointBodyRecoveryApplies(question: string): boolean {
  if (typeof question !== "string" || question.length > 16384) return false;
  const source = sourceUnquotedText(question);
  const uncounted = [...source.matchAll(new RegExp(`\\bpoint\\s+masses\\b(?=\\s+(?:of\\s+)?${NUMBER}\\s*(?:kilograms?|grams?|kg|g)\\s+at\\s+${NAME}\\s*=)`, "giu"))]
    .some(match => positive(clause(source, match.index!).text));
  return (sourceHeader().test(source) || uncounted) && /(?:^|[.!?;\n])\s*(?:(?:please|kindly)\s+)?(?:find|calculate|compute|determine|locate|give)\b[^.!?;\n]*\b(?:centre|center)\s+of\s+mass\b/iu.test(source);
}
function unitFactor(unit: string, dimension: "mass" | "length"): number | undefined {
  const mass: Readonly<Record<string, number>> = { kg: 1, kilogram: 1, kilograms: 1, g: 0.001, gram: 0.001, grams: 0.001 };
  const length: Readonly<Record<string, number>> = { m: 1, metre: 1, metres: 1, meter: 1, meters: 1,
    cm: 0.01, centimetre: 0.01, centimetres: 0.01, centimeter: 0.01, centimeters: 0.01,
    mm: 0.001, millimetre: 0.001, millimetres: 0.001, millimeter: 0.001, millimeters: 0.001 };
  return (dimension === "mass" ? mass : length)[unit];
}
function scalar(source: string): number {
  if (!source.trim() || source.length > 96) throw new Error("source scalar is not bounded");
  const expression = parseMathExpression(source);
  if (expression.syntaxKey.includes('"kind":"variable"')) throw new Error("source scalar is not closed");
  const value = expression.evaluate(0);
  if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error("source scalar is outside native bounds");
  return value;
}
function evidence(question: string, start: number, end: number): QuestionSourceEvidence {
  return { source: "question", start, end, quote: question.slice(start, end) };
}
function clause(source: string, at: number): { start: number; end: number; text: string } {
  const before = [...source.slice(0, at).matchAll(/[!?;\n]|\.(?=\s|$)/gu)].at(-1);
  const start = before ? before.index! + before[0].length : 0;
  const after = /[!?;\n]|\.(?=\s|$)/u.exec(source.slice(at));
  const end = after ? at + after.index + after[0].length : source.length;
  return { start, end, text: source.slice(start, end) };
}
function positive(text: string): boolean { return !NON_FACT.test(text); }
function coordinateSymbol(raw: string, owner: string): Component | undefined {
  const value = normal(raw);
  for (const component of ["x", "y"] satisfies Component[]) if ([`${component}_${owner}`, `${owner}_${component}`, `${owner}${component}`].includes(value)) return component;
  return undefined;
}
function centreComponent(raw: string, owner: string): Component | undefined {
  const canonical = /^([xy])_CM$/u.exec(normal(raw));
  return canonical?.[1] === "x" || canonical?.[1] === "y" ? canonical[1] : coordinateSymbol(raw, owner);
}
function positionDescriptorMatches(text: string, body: SourcePhysicalPointBody, question: string): boolean {
  if (question.includes(text) && text.includes(body.evidence.quote)) return true;
  if (body.position.unitEvidence && question.includes(text) && body.evidence.quote.includes(text)) {
    const ownedTuple = new RegExp(`^\\s*${body.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(\\([^;()]{1,192}\\))\\s*$`, "u").exec(text);
    if (ownedTuple && normal(ownedTuple[1]!) === normal(body.position.sourceExpression)) return true;
  }
  const tuple = new RegExp(`(\\([^;()]{1,192}\\))\\s*(millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|mm|cm|m)(?![\\p{L}\\p{N}/^²³])`, "u").exec(text);
  if (tuple && normal(tuple[1]!) === normal(body.position.sourceExpression) &&
    unitFactor(tuple[2]!, "length") === unitFactor(body.position.sourceUnit, "length") &&
    body.evidence.quote.includes(text)) return true;
  const match = new RegExp(`^\\s*(${NAME})\\s+(?:is\\s+)?at\\s*(\\([^;()]{1,192}\\))\\s*(millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|mm|cm|m)\\s*\\.?\\s*$`, "u").exec(text);
  return Boolean(match && match[1] === body.label && normal(match[2]!) === normal(body.position.sourceExpression) &&
    unitFactor(match[3]!, "length") === unitFactor(body.position.sourceUnit, "length"));
}

type SourcePointBodyScalar = { readonly id: string; readonly symbol?: unknown; readonly value?: unknown; readonly unit?: unknown; readonly sourceText?: unknown; readonly provenance?: unknown };
/** A tuple can describe retained r/norm metadata; it is never a scalar x or
 * a numeric vector. The original full tuple and descriptor still prove its
 * owner, dimensions and norm through the same given-value checks below. */
function tupleNormMetadataMatches(quantity: SourcePointBodyScalar, body: SourcePhysicalPointBody): boolean {
  if (typeof quantity.symbol !== "string" || typeof quantity.sourceText !== "string" || !quantity.sourceText.trim() ||
    ![`r_${body.label}`, `r${body.label}`].includes(normal(quantity.id))) return false;
  const tuple = /^\(([^(),]+),([^(),]+)\)$/u.exec(normal(quantity.symbol));
  return Boolean(tuple && coordinateSymbol(tuple[1]!, body.label) === "x" && coordinateSymbol(tuple[2]!, body.label) === "y");
}
function sourcePointBodyGivenValue(source: SourcePhysicalPointDeclarations, quantity: SourcePointBodyScalar): number | undefined {
  if (typeof quantity.symbol !== "string" || typeof quantity.unit !== "string") return undefined;
  const key = normal(quantity.symbol), text = quantity.sourceText;
  if (text !== undefined && (typeof text !== "string" || !text.trim())) return undefined;
  for (const body of source.bodies) {
    if ([`m_${body.label}`, `m${body.label}`].includes(key)) {
      const factor = unitFactor(quantity.unit, "mass");
      if (factor === undefined) return undefined;
      if (typeof text === "string") {
        const ownedMass = new RegExp(`(?<![\\p{L}\\p{N}_'])(${NAME})\\s+(?:of|with|has\\s+(?:a\\s+)?mass(?:\\s+of)?|with\\s+(?:a\\s+)?mass(?:\\s+of)?)\\s*(${NUMBER})\\s*(kilograms?|grams?|kg|g)\\b`, "gu");
        const proof = [...text.matchAll(ownedMass)].some(match => match[1] === body.label && normal(match[2]!) === normal(body.mass.sourceExpression) &&
          unitFactor(match[3]!, "mass") === unitFactor(body.mass.sourceUnit, "mass"));
        const massFirst = new RegExp(`(${NUMBER})\\s*(kilograms?|grams?|kg|g)\\s+at\\s+(${NAME})\\s*=`, "gu");
        const beforeOwner = [...text.matchAll(massFirst)].some(match => match[3] === body.label && normal(match[1]!) === normal(body.mass.sourceExpression)
          && unitFactor(match[2]!, "mass") === unitFactor(body.mass.sourceUnit, "mass"));
        if ((!proof && !beforeOwner) || !source.question.includes(text)) return undefined;
      }
      return body.mass.valueSI / factor;
    }
    const component = coordinateSymbol(quantity.symbol, body.label), factor = unitFactor(quantity.unit, "length");
    if (component || [`r_${body.label}`, `r${body.label}`].includes(key) || tupleNormMetadataMatches(quantity, body)) {
      if (factor === undefined || typeof text === "string" && !positionDescriptorMatches(text, body, source.question)) return undefined;
      if (component) return (component === "x" ? body.position.xSI : body.position.ySI) / factor;
      const magnitude = Math.hypot(body.position.xSI, body.position.ySI);
      if (magnitude === 0) try {
        // SI conversion must not turn a nonzero original vector into an
        // asserted zero distance. Only a certified source zero may do that.
        const fields = body.position.sourceExpression.slice(1, -1).split(",");
        if (!fields.every(field => { const jet = parseMathExpression(field).certifiedJetAt(0); return jet.value === 0 && jet.errorBounds.value === 0; })) return undefined;
      } catch { return undefined; }
      return magnitude / factor;
    }
  }
  return undefined;
}

/** Re-read original values even when the scene carries a cached native IR.
 * Optional scene evidence cannot change the original owner, tuple or units;
 * fresh planner recovery separately requires every given's source descriptor. */
export function sourcePointBodyGivenIssues(question: string, quantities: readonly SourcePointBodyScalar[], scope: "givens" | "scene_quantities" = "givens"): string[] {
  const source = readSourcePhysicalPointDeclarations(question);
  if (!source) return sourcePointBodyRecoveryApplies(question) ? ["the original point-body givens are not a complete supported source declaration"] : [];
  const issues: string[] = [];
  let derivedState: MechanicsMassState | undefined;
  for (const quantity of quantities) {
    const key = typeof quantity.symbol === "string" ? normal(quantity.symbol) : "";
    const sourceSymbol = source.bodies.some(body => [`m_${body.label}`, `m${body.label}`, `r_${body.label}`, `r${body.label}`].includes(key) || coordinateSymbol(key, body.label) || tupleNormMetadataMatches(quantity, body));
    if (scope === "scene_quantities" && quantity.provenance !== "given" && !sourceSymbol) {
      const component = typeof quantity.symbol === "string" ? centreComponent(quantity.symbol, source.centre.label) : undefined;
      if (!component && key !== "M") continue;
      try {
        derivedState ??= deriveMechanicsMass({ components: source.bodies.map(body => ({ mass: body.mass.valueSI, center: { x: body.position.xSI, y: body.position.ySI },
          shape: "point", direction: { x: 0, y: 0, z: 1 }, operation: "add", principal: { parallel: 0, perpendicular: 0, relativeTolerance: MECHANICS_RELATIVE_ERROR, method: "point" } })),
          axis: { point: { x: source.bodies[0]!.position.xSI, y: source.bodies[0]!.position.ySI }, direction: { x: 0, y: 0, z: 1 } } });
        const factor = typeof quantity.unit === "string" ? unitFactor(quantity.unit, component ? "length" : "mass") : undefined;
        const expectedSI = component ? derivedState.centerOfMassSI[component] : derivedState.massSI;
        const errorSI = component ? derivedState.errorBoundsSI.centerOfMassSI[component] : derivedState.errorBoundsSI.massSI;
        const expected = factor === undefined ? undefined : expectedSI / factor;
        const error = factor === undefined ? undefined : errorSI / factor;
        const value = quantity.value;
        if (expected === undefined || error === undefined || typeof value !== "number" || !Number.isFinite(value)
          || !(value === expected || value !== 0 && expected !== 0 && Math.abs(value - expected) <= error
            && Math.abs(value - expected) <= 128 * Number.EPSILON * Math.max(Math.abs(value), Math.abs(expected))))
          issues.push(`point-body computed quantity ${quantity.id} must retain its original source owner, unit and recomputed value`);
      } catch { issues.push(`point-body computed quantity ${quantity.id} cannot be proved from the complete original source`); }
      continue;
    }
    const expected = sourcePointBodyGivenValue(source, quantity), value = quantity.value;
    if (expected === undefined || typeof value !== "number" || !Number.isFinite(value) ||
      !(value === expected || value !== 0 && expected !== 0 && Math.abs(value - expected) <= 128 * Number.EPSILON * Math.max(Math.abs(value), Math.abs(expected))))
      issues.push(`point-body given ${quantity.id} must retain its original owner, scalar value, tuple and units`);
  }
  return issues;
}

/** A numeric mass before a named original point owner remains a mass role.
 * This supplies only the source role/owner link; native literal, dimensional,
 * AST, roster and value verification remain mandatory at the caller. */
export function sourcePointBodyMassOwnerMatches(question: string, ownerLabel: string, sourceExpression: string, sourceUnit: string, givenEvidence: QuestionSourceEvidence): boolean {
  const source = readSourcePhysicalPointDeclarations(question);
  const body = source?.bodies.find(body => body.label === ownerLabel);
  if (!body || normal(sourceExpression) !== normal(body.mass.sourceExpression) || sourceUnit !== body.mass.sourceUnit
    || givenEvidence.start !== body.evidence.start || givenEvidence.end !== body.evidence.end || givenEvidence.quote !== body.evidence.quote
    || question.slice(givenEvidence.start, givenEvidence.end) !== givenEvidence.quote) return false;
  const match = new RegExp(`^(${NUMBER})\\s*(kilograms?|grams?|kg|g)\\s+at\\s+(${NAME})\\s*=`, "u").exec(body.evidence.quote);
  return Boolean(match && match[3] === ownerLabel && normal(match[1]!) === normal(sourceExpression) && match[2] === sourceUnit);
}
function unusedId(preferred: string, used: ReadonlySet<string>): string {
  let id = preferred;
  for (let suffix = 0; used.has(id); suffix++) id = `${preferred.slice(0, 56)}_${suffix}`;
  return id;
}
function sourceDrawingCovered(source: SourcePhysicalPointDeclarations, numericalOnly = false): boolean {
  const names = new Set([...source.bodies.map(body => body.label), source.centre.label, ...(source.connector ? ["connector"] : [])]);
  const grammar = new Set(["draw", "sketch", "show", "mark", "label", "identify", "name", "plot", "graph", "keep", "separate",
    "a", "an", "the", "their", "its", "and", "or", "all", "each", "both", "only", "please", "with", "labels", "point", "points", "mass", "masses", "particle", "particles", "centre", "center", "of", "figure", "diagram", "in", "plane"]);
  if (numericalOnly && source.masslessLinks) for (const word of ["links", "rigid", "massless"]) grammar.add(word);
  for (const request of readSourceDrawingRequests(source.question)) if (["current", "negated", "retracted"].includes(request.scope)) {
    // Explicit metric captions/axes and additional owners need their own
    // source renderer; a point-only recovery must not silently omit them.
    if (/(?:^|[^\p{L}\p{N}_])\d/u.test(request.text)) return false;
    const words = request.text.match(new RegExp(NAME, "gu")) ?? [];
    if (words.some(word => !names.has(word) && !grammar.has(word.toLowerCase()) && !["requested", "previous", "above", "drawing", "view"].includes(word.toLowerCase()))) return false;
  }
  return true;
}

type SourceSpan = { start: number; end: number };
/** A candidate answer explicitly submitted for checking is a proposition,
 * never a physical given or a replacement output. Consume only a complete
 * local proposal/check pair naming a requested coordinate of this source. */
function checkedCoordinateProposalSpans(question: string, source: SourcePhysicalPointDeclarations): SourceSpan[] {
  const unquoted = sourceUnquotedText(question), clauses: Array<SourceSpan & { text: string }> = [];
  let start = 0;
  for (const boundary of unquoted.matchAll(/[!?;\n]|\.(?=\s|$)/gu)) {
    clauses.push({ start, end: boundary.index!, text: unquoted.slice(start, boundary.index!).trim() });
    start = boundary.index! + boundary[0].length;
  }
  clauses.push({ start, end: unquoted.length, text: unquoted.slice(start).trim() });
  const nonempty = clauses.filter(value => value.text), spans: SourceSpan[] = [];
  const proposed = new RegExp(`^(?:a|the)\\s+(?:proposed|suggested)\\s+(?:answer|result)\\s+(?:claims|states|says)\\s+(${NAME})\\s*=\\s*(${NUMBER})\\s*(millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|mm|cm|m)$`, "iu");
  const check = /^(?:check|verify|test)\s+(?:that|this|the)\s+(?:claim|proposal|answer|result)\s+against\s+(?:the\s+(?:same|original)\s+|the\s+)?source(?:\s+and\s+(?:correct|revise)\s+it\s+if\s+needed)?$/iu;
  for (let index = 0; index < nonempty.length - 1; index++) {
    const proposal = nonempty[index]!, next = nonempty[index + 1]!, match = proposed.exec(proposal.text);
    const component = match && centreComponent(match[1]!, source.centre.label);
    if (!match || !component || !source.centre.components.includes(component) || !check.test(next.text) ||
      !Number.isFinite(Number(match[2])) || unitFactor(match[3]!.toLowerCase(), "length") === undefined) continue;
    spans.push(proposal, next);
    const retain = nonempty[index + 2];
    if (retain && /^(?:retain|keep)\s+(?:the\s+)?requested\s+(?:diagram|drawing|figure|sketch|view)$/iu.test(retain.text) &&
      readSourceDrawingRequests(question).some(request => request.scope === "current")) spans.push(retain);
  }
  return spans;
}
function completeOriginalCoverage(question: string, source: SourcePhysicalPointDeclarations, header: SourceSpan, queries: readonly SourceSpan[]): boolean {
  const unquoted = sourceUnquotedText(question), spans = [header, ...source.bodies.map(body => body.evidence), ...source.bodies.flatMap(body => body.position.unitEvidence ? [body.position.unitEvidence] : [])];
  const checkedProposals = checkedCoordinateProposalSpans(question, source);
  const requests = readSourceDrawingRequests(question);
  const ends = [...unquoted.matchAll(/[!?;\n]|\.(?=\s|$)/gu)].map(match => ({ end: match.index!, next: match.index! + match[0].length }));
  ends.push({ end: unquoted.length, next: unquoted.length });
  let start = 0;
  for (const end of ends) {
    const at = start, text = unquoted.slice(start, end.end); start = end.next;
    if (!text.trim()) continue;
    const overlap = (span: SourceSpan) => span.start < end.end && span.end > at;
    const bodySpans = spans.filter(overlap);
    if (bodySpans.length) {
      if (question.slice(at, end.end) !== text) return false;
      const chars = text.split("");
      for (const span of bodySpans) for (let index = Math.max(span.start, at); index < Math.min(span.end, end.end); index++) chars[index - at] = " ";
      const residual = chars.join("").replace(/[,:]/gu, " ").replace(/\s+/gu, " ").trim().toLowerCase()
        .replace(/\b(?:are|is)(?:\s+both)?\s+(?:fixed|attached|joined|connected)\s+to\s+(?:a|an|the)\s+massless(?:\s+rigid)?\s+connector\b/gu, "")
        .replace(/\b(?:are|is)\s+connected\s+by\s+massless\s+rigid\s+links\b/gu, "")
        .replace(/\b(?:are|is)\s+(?:supplied|given)\b/gu, "").trim();
      if (residual && !/^(?:(?:a|an|the|there|are|is|exactly|only|all|and|of|system|consists|consider)\s*)+$/u.test(residual)) return false;
      continue;
    }
    if (queries.some(overlap)) {
      const chars = text.split("");
      for (const span of queries.filter(overlap)) for (let index = Math.max(span.start, at); index < Math.min(span.end, end.end); index++) chars[index - at] = " ";
      if (chars.join("").trim() || !sourceDrawingCovered(source, true)) return false;
      continue;
    }
    if (checkedProposals.some(span => span.start === at && span.end === end.end)) continue;
    const frame = text.replace(/[,:]/gu, " ").replace(/\s+/gu, " ").trim();
    if (/^positive\s+(?:angular\s+quantities|rotations?)\s+about\s+\+z\s+are\s+(?:anticlockwise|counterclockwise)$/iu.test(frame)) continue;
    const axis = /\+x\s+right|\+y\s+up|\+z\s+out\s+(?:of\s+)?(?:the\s+)?page/giu;
    const axes = [...frame.matchAll(axis)];
    const intro = frame.replace(axis, "").replace(/\s+/gu, " ").trim();
    if (axes.length && (!intro || /^(?:(?:use\s+SI\s+units\s+and|in)\s+)?(?:an?|the)?\s*inertial\s+(?:(?:laboratory|Cartesian|xy)\s+)?frame$/iu.test(intro)) || /^use\s+SI\s+units$/iu.test(frame)) continue;
    const drawing = requests.filter(request => overlap(request) && ["current", "negated", "retracted"].includes(request.scope));
    if (drawing.length && sourceDrawingCovered(source, true)) {
      const first = drawing[0]!, prefix = unquoted.slice(at, first.start).trim();
      if (/^(?:(?:please|kindly)|do\s+not|don['’]t|never|you\s+(?:must|should)\s+not)?$/iu.test(prefix)) continue;
    }
    if (/^(?:ignore|cancel|withdraw|retract|omit|skip|disregard)\s+(?:(?:the|previous|requested|above)\s+)*(?:drawing|diagram|sketch|plot|graph|view|request)$/iu.test(frame) ||
      /^(?:(?:a|the)\s+)?(?:verbal|written|text(?:ual)?)\s+(?:answer|explanation|response)\s+only$/iu.test(frame)) continue;
    return false;
  }
  return true;
}

export interface SourcePointBodyDrawingScope { readonly ownerLabels: readonly string[]; readonly restricted: boolean; readonly forbidTextFor: readonly string[]; readonly forbidMarksFor: readonly string[] }
function drawingOwners(source: SourcePhysicalPointDeclarations, text: string): string[] {
  const words: readonly string[] = text.match(new RegExp(NAME, "gu")) ?? [], bodies = source.bodies.map(body => body.label);
  const explicit = [...bodies, source.centre.label, ...(source.connector ? ["connector"] : [])].filter(name => words.includes(name));
  let pool: string[] = [];
  if (/\b(?:masses|particles)\b/iu.test(text)) pool.push(...bodies);
  if (/\b(?:centre|center)\b/iu.test(text)) pool.push(source.centre.label);
  if (/\bpoints\b/iu.test(text)) pool.push(...bodies, source.centre.label);
  if (/\bconnector\b/iu.test(text) && source.connector) pool.push("connector");
  if (!pool.length) pool = [...bodies, source.centre.label, ...(source.connector ? ["connector"] : [])];
  return explicit.length ? explicit.filter(name => pool.includes(name)) : [...new Set(pool)];
}
export function sourcePointBodyDrawingScope(source: SourcePhysicalPointDeclarations): SourcePointBodyDrawingScope {
  const requests = readSourceDrawingRequests(source.question), only = requests.filter(request => request.scope === "current" && /\bonly\b/iu.test(request.text));
  const forbidden = (actions: readonly string[]): string[] => [...new Set(requests.filter(request => ["negated", "retracted"].includes(request.scope) && actions.includes(request.action)).flatMap(request => drawingOwners(source, request.text)))];
  return { ownerLabels: only.length ? [...new Set(only.flatMap(request => drawingOwners(source, request.text)))] : [...source.bodies.map(body => body.label), source.centre.label, ...(source.connector ? ["connector"] : [])],
    restricted: only.length > 0, forbidTextFor: forbidden(["label", "identify", "name"]), forbidMarksFor: forbidden(["mark", "draw", "sketch", "plot", "graph", "show", "separate", "keep"]) };
}

/** A fresh original-source assertion, shared by native numerical replays. */
export function assertOriginalSourcePointBodyCoverage(question: string): void {
  if (sourcePointBodyRecoveryApplies(question) && !readSourcePhysicalPointDeclarations(question)) throw new Error("the original point-body source contains unsupported, unconsumed, ambiguous or uncertain state/member declarations");
}

/** A retained native full source model can prove point geometry without a
 * numeric result request for every coordinate. This is only a scope witness:
 * the normal native scene input/owner/boundary checks still certify the actual
 * glyphs. It supplies no result binding and no numeric-completeness claim.
 */
function sourcePointGeometryOnlyScope(document: SceneDocument, problem: ProblemIR, source: SourcePhysicalPointDeclarations, visibleIds: ReadonlySet<string>): boolean {
  if (problem.question !== source.question || document.source.question !== source.question) return false;
  const quantities = document.quantities ?? [];
  for (const quantity of quantities) {
    if (quantity.provenance === "given") {
      if (sourcePointBodyGivenIssues(source.question,[quantity]).length) return false;
      continue;
    }
    const bindings = problem.solveRequests.filter(request => request.kind === "mechanics" && request.resultBinding?.turnPlanQuantityId === quantity.id);
    if (bindings.length !== 1 || !bindings[0]!.resultBinding || quantity.symbol !== bindings[0]!.resultBinding!.symbol || quantity.unit !== bindings[0]!.resultBinding!.unit) return false;
  }
  const centres = document.entities.filter(entity => entity.kind === "point" && entity.label === source.centre.label && visibleIds.has(entity.id));
  if (centres.length !== 1 || !document.requiredEntityIds.includes(centres[0]!.id)) return false;
  const outputId = centres[0]!.id, producers = document.constructions.filter(construction => construction.outputs.includes(outputId));
  if (producers.length !== 1 || producers[0]!.operator !== "mass_moments" || producers[0]!.outputs.length !== 1) return false;
  const rawBindings = document.source.mechanicsBindings;
  if (!Array.isArray(rawBindings)) return false;
  const selectors = rawBindings.filter(value => value && typeof value === "object" && !Array.isArray(value) && Reflect.get(value,"outputId") === outputId);
  if (selectors.length !== 1) return false;
  const selector = selectors[0]!, request = problem.solveRequests.find(request => request.id === Reflect.get(selector,"requestId"));
  if (!request || request.kind !== "mechanics") return false;
  try {
    const models = new Set<string>();
    for (const current of problem.solveRequests) if (current.kind === "mechanics") {
      for (const value of replayMechanicsProgram(problem,current.program,current.resultBinding).values()) if (value.step.operator === "mass_moments") {
        if (value.geometry.kind !== "point" || value.geometry.mechanicsModel?.kind !== "mass_moments" ||
          sourcePointBodyCoordinateSymbol(problem,value.step,`${source.centre.components[0]}_${source.centre.label}`) === null) return false;
        models.add(JSON.stringify({ownerId:value.step.ownerId,axisId:value.step.axisId,sourceOwners:value.step.sourceOwners,source:value.geometry.mechanicsModel.source}));
      }
    }
    if (models.size !== 1) return false;
    const native = replayMechanicsProgram(problem,request.program,request.resultBinding);
    const snapshot = native.get(String(Reflect.get(selector,"stepId")));
    if (!snapshot || snapshot.step.operator !== "mass_moments" || snapshot.step.inputs.mode !== undefined ||
      Reflect.get(selector,"ownerId") !== snapshot.step.ownerId || Reflect.get(selector,"axisId") !== snapshot.step.axisId ||
      sourcePointBodyCoordinateSymbol(problem,snapshot.step,`${source.centre.components[0]}_${source.centre.label}`) === null ||
      snapshot.geometry.kind !== "point" || snapshot.geometry.mechanicsModel?.kind !== "mass_moments") return false;
    const model = snapshot.geometry.mechanicsModel, position = model.sourcePositionAuthority;
    if (!position || position.unprovedGeometry || position.unprovedClaims.length || position.sourceMismatches.length ||
      Object.values(position.points).some(point => point.freedoms.length) || model.source.components.length !== source.bodies.length ||
      !Number.isFinite(model.state.centerOfMassSI.x) || !Number.isFinite(model.state.centerOfMassSI.y)) return false;
    return true;
  } catch { return false; }
}

/** Actual saved glyphs/text retain the original display scope. It does not
 * certify coordinates or masses; the existing native guards still do that. */
export function sourcePointBodySceneScopeIssues(document: SceneDocument, question: string, problem: ProblemIR, visibleIds: ReadonlySet<string>): string[] {
  if (!sourcePointBodyRecoveryApplies(question)) return [];
  const source = readSourcePhysicalPointDeclarations(question);
  if (!source) return ["the original point-body source is not a complete supported current-state declaration"];
  const scope = sourcePointBodyDrawingScope(source), issues: string[] = [];
  if (source.masslessLinks && readSourceDrawingRequests(question).some(request => request.scope === "current"
    && ["draw", "sketch", "show", "plot", "graph", "mark", "label"].includes(request.action) && /\blinks\b/iu.test(request.text)))
    issues.push("the original source requires massless-link geometry whose topology is unspecified and cannot be proved");
  for (const component of source.centre.components) {
    const requests = problem.solveRequests.filter(request => {
      if (request.kind !== "mechanics" || !request.resultBinding) return false;
      const step = request.program.steps.find(step => step.id === request.program.output.stepId);
      return Boolean(step && sourcePointBodyCoordinateSymbol(problem, step, request.resultBinding.symbol) === `${component}_CM`);
    });
    if (requests.length === 0 && sourcePointGeometryOnlyScope(document, problem, source, visibleIds)) continue;
    if (requests.length !== 1 || requests[0]!.kind !== "mechanics" || !requests[0]!.resultBinding) {
      issues.push(`the original requested ${component}-coordinate needs one retained native source result binding or an undisplayed-result original-source point geometry proof`); continue;
    }
    const binding = requests[0]!.resultBinding!;
    const quantities = document.quantities?.filter(quantity => quantity.id === binding.turnPlanQuantityId) ?? [];
    if (quantities.length !== 1 || quantities[0]!.symbol !== binding.symbol || quantities[0]!.unit !== binding.unit)
      issues.push(`the original requested ${binding.turnPlanQuantityId} must retain its native symbol and unit identity`);
  }
  const aliases = [...source.bodies.map(body => body.label), source.centre.label, ...(source.connector ? ["connector"] : [])];
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const boundaries = Array.isArray(document.source.mechanicsBoundaryBindings) ? document.source.mechanicsBoundaryBindings.filter(record) : [];
  const names = (id: string): string[] => {
    const entity = document.entities.find(entity => entity.id === id), construction = document.constructions.find(value => value.outputs.includes(id));
    const values = [id, entity?.label, entity?.semantic?.name, entity?.semantic?.symbol].filter((value): value is string => typeof value === "string");
    const named = aliases.filter(name => values.some(value => value === name || value.startsWith(`${name} `) || value.startsWith(`${name}=`)));
    const boundary = boundaries.find(value => value.outputId === id);
    if (typeof boundary?.componentOwnerId === "string") {
      const label = problem.entities.find(value => value.id === boundary.componentOwnerId)?.label;
      if (label && aliases.includes(label)) named.push(label);
    }
    if (construction?.operator === "mass_moments") named.push(source.centre.label);
    if (source.connector && construction && ["segment", "line", "polyline"].includes(construction.operator) &&
      (entity?.role === "connection" || entity?.label === "connector" || /connector/iu.test(id))) named.push("connector");
    return [...new Set(named)];
  };
  for (const entity of document.entities) if (visibleIds.has(entity.id)) {
    const owners = names(entity.id);
    if (scope.restricted && owners.some(owner => !scope.ownerLabels.includes(owner))) issues.push("a source only-request forbids an additional physical owner or connector glyph");
    if (owners.some(owner => scope.forbidMarksFor.includes(owner))) issues.push("the original source forbids this point/body mark");
    if (entity.label && owners.some(owner => scope.forbidTextFor.includes(owner))) issues.push("the original source forbids this point/body label");
  }
  for (const annotation of document.annotations) if (annotation.text && annotation.targetIds.flatMap(names).some(owner => scope.forbidTextFor.includes(owner))) issues.push("the original source forbids this attached point/body text");
  for (const construction of document.constructions) if (construction.operator === "label" && construction.inputs.text) {
    const target = construction.inputs.target ?? construction.inputs.at ?? construction.inputs.point;
    if (typeof target === "string" && names(target).some(owner => scope.forbidTextFor.includes(owner))) issues.push("the original source forbids this point/body label constructor");
  }
  return [...new Set(issues)];
}

/** Complete positive declarations, with original UTF-16 ranges. A provider
 * subject, plan quantity, quoted statement or display role supplies no fact. */
export function readSourcePhysicalPointDeclarations(question: string): SourcePhysicalPointDeclarations | null {
  if (typeof question !== "string" || !question.trim() || question.length > 2048) return null;
  const source = sourceUnquotedText(question);
  if (OTHER_CASE.test(source)) return null;
  const count = `(?:${Object.keys(COUNTS).join("|")}|[1-9]\\d?|only|all)`;
  const headers = [...source.matchAll(new RegExp(`\\b(?:(${count})\\s+(?:point\\s+)?(masses|particles)|(point\\s+masses))\\b`, "giu"))]
    .filter(match => /\bpoint\s+masses\b|\bparticles\b/iu.test(match[0]) && positive(clause(source, match.index!).text)
      && (!match[3] || new RegExp(`^\\s+(?:of\\s+)?${NUMBER}\\s*(?:kilograms?|grams?|kg|g)\\s+at\\s+${NAME}\\s*=`, "u").test(source.slice(match.index! + match[0].length))));
  if (headers.length !== 1) return null;
  const header = headers[0]!, word = header[1]?.toLowerCase() ?? "";
  if (["only", "all"].includes(word) && !/^\s*(?:are|:)/iu.test(source.slice(header.index! + header[0].length))) return null;
  const expectedCount = COUNTS[word] ?? (/^\d+$/u.test(word) ? Number(word) : undefined);
  if (expectedCount !== undefined && (expectedCount < 2 || expectedCount > 16)) return null;
  const queries = [...source.matchAll(/(?:^|[!?;\n]|\.(?=\s))\s*(?:(?:please|kindly)\s+)?(?:find|calculate|compute|determine|locate|give)\s+([^!?;\n]*?)(?=\.(?=\s|$)|$)/giu)];
  if (!queries.length) return null;
  const centres: Array<{ label: string; components: Component[]; start: number; end: number }> = [];
  let totalMassRequested = false;
  for (const query of queries) {
    const head = query[1]!.replace(/^(?:and\s+)?(?:draw|sketch|show|mark|label)\s+/iu, "").split(/\b(?:and|then)\s+(?:(?:do\s+not|don't|never)\s+)?(?:draw|sketch|show|mark|label)\b/iu)[0]!.trim();
    if (!positive(head) || /\b(?:after|before|initial|final|later|time|seconds?|milliseconds?)\b/iu.test(head)) return null;
    // A closed verbal task is consumed in the original question but adds no
    // physical operand or requested numeric identity.
    if (/^(?:(?:a|the)\s+)?(?:(?:brief|short|concise)\s+)?(?:explanation|reasoning)(?:\s+of\s+(?:the\s+)?(?:answer|result|method))?$/iu.test(head)) continue;
    const centre = new RegExp(`^(?:(x|y)[ -](?:coordinate|component)\\s+of\\s+)?(?:(?:the|their|its)\\s+)?(?:current\\s+)?(?:centre|center)\\s+of\\s+mass\\s+(${NAME})(?:\\s+in\\s+the\\s+plane)?(?:\\s+and\\s+(?:the\\s+)?total\\s+mass(?:\\s+${NAME})?)?$`, "iu").exec(head);
    if (centre) {
      const component = centre[1]?.toLowerCase();
      centres.push({ label: centre[2]!, components: component === "x" || component === "y" ? [component] : ["x", "y"],
        start: query.index!, end: query.index! + query[0].length });
      totalMassRequested ||= /\btotal\s+mass\b/iu.test(head);
    } else if (/^(?:(?:the|their)\s+)?total\s+mass(?:\s+[\p{L}][\p{L}\p{N}_]*)?$/iu.test(head)) totalMassRequested = true;
    else return null;
  }
  const centreNames = [...new Set(centres.map(value => value.label))];
  if (centreNames.length !== 1) return null;
  const centreName = centreNames[0]!;
  const bodyPattern = new RegExp(`(?<![\\p{L}\\p{N}_'])(${NAME})\\s+(?:of|with|has\\s+(?:a\\s+)?mass(?:\\s+of)?|with\\s+(?:a\\s+)?mass(?:\\s+of)?)\\s*(${NUMBER})\\s*(kilograms?|grams?|kg|g)\\b\\s*(?:,\\s*)?(?:at|(?:position|coordinates?)\\s*(?:is|are|=)?\\s*(?:at)?)\\s*(\\([^;()]{1,192}\\))\\s*(millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|mm|cm|m)(?![\\p{L}\\p{N}/^²³])`, "gu");
  const bodies: SourcePhysicalPointBody[] = [];
  try {
    const sharedUnits = [...source.matchAll(/\bin\s+(millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|mm|cm|m)(?![\p{L}\p{N}/^²³])/gu)]
      .filter(match => match.index! > header.index! && match.index! < centres[0]!.start);
    if (sharedUnits.length > 1) return null;
    const sharedUnit = sharedUnits[0];
    const reversedPattern = new RegExp(`(?<![\\p{L}\\p{N}_.])(${NUMBER})\\s*(kilograms?|grams?|kg|g)\\s+at\\s+(${NAME})\\s*=\\s*(\\([^;()]{1,192}\\))(?:\\s*(millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|mm|cm|m)(?![\\p{L}\\p{N}/^²³]))?`, "gu");
    const owned = [...source.matchAll(bodyPattern)];
    const reversed = [...source.matchAll(reversedPattern)].map(match => {
      const ordered = [match[0], match[3]!, match[1]!, match[2]!, match[4]!, match[5] ?? sharedUnit?.[1]];
      return Object.assign(ordered, { index: match.index! });
    });
    const all = [...owned, ...reversed].sort((a, b) => a.index! - b.index!);
    for (const match of all) {
      if (match.index! < header.index! || match.index! >= centres[0]!.start || !positive(clause(source, match.index!).text)) return null;
      const label = match[1]!, massUnit = match[3]!, lengthUnit = match[5]!;
      if (!lengthUnit || sharedUnit && unitFactor(lengthUnit, "length") !== unitFactor(sharedUnit[1]!, "length")) return null;
      const massFactor = unitFactor(massUnit, "mass"), lengthFactor = unitFactor(lengthUnit, "length");
      if (massFactor === undefined || lengthFactor === undefined) return null;
      const fields = match[4]!.slice(1, -1).split(",");
      if (fields.length !== 2 && fields.length !== 3 || fields.length === 3 && scalar(fields[2]!) !== 0) return null;
      const massSI = scalar(match[2]!) * massFactor, xSI = scalar(fields[0]!) * lengthFactor, ySI = scalar(fields[1]!) * lengthFactor;
      if (!(massSI > 0) || ![massSI, xSI, ySI].every(value => Number.isFinite(value) && Math.abs(value) <= 1e12)) return null;
      bodies.push({ id: unusedId(ID.test(label) ? label : `source_body_${bodies.length}`, new Set(bodies.map(body => body.id))), label,
        mass: { sourceExpression: match[2]!, sourceUnit: massUnit, valueSI: massSI },
        position: { sourceExpression: match[4]!, sourceUnit: sharedUnit ? (unitFactor(lengthUnit, "length") === 1 ? "m" : unitFactor(lengthUnit, "length") === 0.01 ? "cm" : "mm") : lengthUnit, xSI, ySI,
          ...(sharedUnit ? { unitEvidence: evidence(question, sharedUnit.index!, sharedUnit.index! + sharedUnit[0].length) } : {}) },
        evidence: evidence(question, match.index!, match.index! + match[0].length) });
    }
    if (bodies.length < 2 || bodies.length > 16 || expectedCount !== undefined && bodies.length !== expectedCount ||
      new Set(bodies.map(body => body.label)).size !== bodies.length || bodies.some(body => body.label === centreName)) return null;
    const insideBody = (at: number): boolean => bodies.some(body => at >= body.evidence.start && at < body.evidence.end);
    for (const match of source.matchAll(new RegExp(`${NUMBER}\\s*(?:kilograms?|grams?|kg|g)\\b`, "gu"))) if (!insideBody(match.index!)) return null;
    for (const match of source.matchAll(/\([^;()]{1,192}\)\s*(?:millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|mm|cm|m)(?![\p{L}\p{N}/^²³])/gu)) if (!insideBody(match.index!)) return null;
    const frames = [...source.matchAll(/\binertial\b[^.!?\n]{0,512}\+x\s+right[^.!?\n]{0,128}\+y\s+up[^.!?\n]{0,128}\+z\s+out\s+(?:of\s+)?(?:the\s+)?page/giu)];
    if (frames.length !== 1 || !positive(frames[0]![0])) return null;
    const frame = frames[0]!, frameClause = clause(source, frame.index!);
    const frameEnd = Math.max(frame.index! + frame[0].length, frameClause.end);
    const frameEvidence = evidence(question, frameClause.start, frameEnd);
    if (!positive(frameEvidence.quote)) return null;
    const links = [...source.matchAll(/\bmassless\s+(?:rigid\s+)?connector\b/giu)];
    const masslessLinks = [...source.matchAll(/\bmassless\s+rigid\s+links\b/giu)];
    if (masslessLinks.length > 1 || masslessLinks.length && (links.length || !positive(clause(source, masslessLinks[0]!.index!).text)
      || !/\bare\s+connected\s+by\s+massless\s+rigid\s+links\b/iu.test(clause(source, masslessLinks[0]!.index!).text))) return null;
    if (links.length > 1 || links.length && (bodies.length !== 2 || !positive(clause(source, links[0]!.index!).text) ||
      !/\b(?:fixed|attached|joined|connected)\b[^.!?;]*\bmassless\s+(?:rigid\s+)?connector\b/iu.test(clause(source, links[0]!.index!).text))) return null;
    const firstCentre = centres[0]!, components = [...new Set(centres.flatMap(value => value.components))];
    const connectorEnd = links.length ? clause(source, links[0]!.index!).end : 0;
    const connectorFactEnd = connectorEnd && /[.!?;\n]/u.test(question[connectorEnd - 1]!) ? connectorEnd - 1 : connectorEnd;
    const entityIds = new Set(bodies.map(body => body.id)), aggregateId = unusedId("source_distribution", entityIds);
    entityIds.add(aggregateId);
    const declared: SourcePhysicalPointDeclarations = { question, bodies, roster: evidence(question, header.index!, Math.max(bodies.at(-1)!.evidence.end, sharedUnit ? sharedUnit.index! + sharedUnit[0].length : 0)),
      aggregate: { id: aggregateId, label: header[2] ?? "masses" }, frame: frameEvidence,
      centre: { id: unusedId(ID.test(centreName) ? centreName : "source_centre", entityIds), label: centreName, components,
        evidence: evidence(question, firstCentre.start, firstCentre.end) }, totalMassRequested,
      ...(links.length ? { connector: evidence(question, header.index!, connectorFactEnd) } : {}),
      ...(masslessLinks.length ? { masslessLinks: evidence(question, clause(source, masslessLinks[0]!.index!).start, clause(source, masslessLinks[0]!.index!).end) } : {}) };
    if (!completeOriginalCoverage(question, declared, { start: header.index!, end: header.index! + header[0].length }, queries.map(query => ({ start: query.index!, end: query.index! + query[0].length })))) return null;
    return declared;
  } catch { return null; }
}

/** Only source-declared coordinate owners select a native centre component.
 * This resolves syntax; native source replay still proves every operand. */
export function sourcePointBodyCoordinateSymbol(problem: ProblemIR, step: MechanicsProgramStep, raw: string): string | null {
  const source = readSourcePhysicalPointDeclarations(problem.question);
  if (!source || step.operator !== "mass_moments" || step.inputs.mode !== undefined || !Array.isArray(step.inputs.components) ||
    step.inputs.components.length !== source.bodies.length) return null;
  const component = centreComponent(raw, source.centre.label);
  if (!component || !source.centre.components.includes(component)) return null;
  const labels = step.inputs.components.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "shape") || Reflect.get(value, "shape") !== "point") return undefined;
    const ownerId = step.sourceOwners?.[`components.${index}`];
    return problem.entities.find(entity => entity.id === ownerId)?.label;
  });
  if (new Set(labels).size !== labels.length || source.bodies.some(body => !labels.includes(body.label))) return null;
  return `${component}_CM`;
}

/** Assemble native operands only from original complete declarations. Plan
 * values never enter the model; IDs/symbols/units select its proved outputs. */
export function recoverSourcePointBodyProblemIR(question: string, plan: TurnPlanV3 | null | undefined): ProblemIR | null {
  const source = readSourcePhysicalPointDeclarations(question);
  if (!source || !sourceDrawingCovered(source, true) || !plan || plan.question !== question || !Array.isArray(plan.unknowns) || !plan.unknowns.length || plan.unknowns.length > 32 ||
    !Array.isArray(plan.givens) || !Array.isArray(plan.derived)) return null;
  const targets: Array<{ binding: SolveResultBinding; symbol: string }> = [], ids = new Set<string>(), components = new Set<string>();
  const agrees = (a: number, b: number): boolean => a === b || a !== 0 && b !== 0 && Math.abs(a - b) <= 128 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
  let massTarget = false;
  for (const target of plan.unknowns) {
    if (!ID.test(target.id) || ids.has(target.id) || typeof target.symbol !== "string" || typeof target.unit !== "string") return null;
    ids.add(target.id);
    const component = centreComponent(target.symbol, source.centre.label);
    if (component && source.centre.components.includes(component) && unitFactor(target.unit, "length") !== undefined) {
      if (components.has(component)) return null; components.add(component);
      targets.push({ symbol: target.symbol, binding: { turnPlanQuantityId: target.id, symbol: target.symbol, unit: target.unit, evidenceFactIds: ["source_requested"] } });
    } else if (normal(target.symbol) === "M" && unitFactor(target.unit, "mass") !== undefined) {
      if (massTarget) return null; massTarget = true;
      targets.push({ symbol: "M", binding: { turnPlanQuantityId: target.id, symbol: target.symbol, unit: target.unit, evidenceFactIds: ["source_requested"] } });
    } else return null;
    const derived = plan.derived.filter(value => value.id === target.id);
    if (derived.length !== 1 || derived[0]!.symbol !== target.symbol || derived[0]!.unit !== target.unit || typeof derived[0]!.value !== "number" || !Number.isFinite(derived[0]!.value)) return null;
  }
  if (!source.centre.components.every(component => components.has(component))) return null;
  if (source.totalMassRequested && !massTarget) {
    const mass = plan.derived.filter(value => normal(value.symbol) === "M" && typeof value.unit === "string" && unitFactor(value.unit, "mass") !== undefined);
    if (mass.length !== 1 || !ID.test(mass[0]!.id) || ids.has(mass[0]!.id) || typeof mass[0]!.value !== "number" || !Number.isFinite(mass[0]!.value)) return null;
    const factor = unitFactor(mass[0]!.unit!, "mass");
    if (factor === undefined || !agrees(mass[0]!.value, source.bodies.reduce((sum, body) => sum + body.mass.valueSI, 0) / factor)) return null;
    const target = mass[0]!; ids.add(target.id); massTarget = true;
    targets.push({ symbol: "M", binding: { turnPlanQuantityId: target.id, symbol: target.symbol, unit: target.unit, evidenceFactIds: ["source_requested"] } });
  }
  if (plan.givens.some(given => typeof given.sourceText !== "string") || sourcePointBodyGivenIssues(question, plan.givens).length) return null;
  for (const derived of plan.derived) if (!ids.has(derived.id)) {
    if (normal(derived.symbol) !== "M" || typeof derived.unit !== "string" || typeof derived.value !== "number") return null;
    const factor = unitFactor(derived.unit, "mass");
    if (factor === undefined || !agrees(derived.value, source.bodies.reduce((sum, body) => sum + body.mass.valueSI, 0) / factor)) return null;
  }
  const facts: ProblemIR["facts"] = [
    { id: "source_roster", kind: "given", statement: source.roster.quote, evidence: source.roster },
    ...source.bodies.map((body, index) => ({ id: `source_body_${index}`, kind: "given" as const, statement: body.evidence.quote, evidence: body.evidence })),
    { id: "source_frame", kind: "given", statement: source.frame.quote, evidence: source.frame },
    ...(source.connector ? [{ id: "source_connector", kind: "given" as const, statement: source.connector.quote, evidence: source.connector }] : []),
    ...source.bodies.flatMap((body, index) => body.position.unitEvidence ? [{ id: `source_length_unit_${index}`, kind: "given" as const, statement: body.position.unitEvidence.quote, evidence: body.position.unitEvidence }] : []),
    ...(source.masslessLinks ? [{ id: "source_massless_links", kind: "given" as const, statement: source.masslessLinks.quote, evidence: source.masslessLinks }] : []),
    { id: "source_requested", kind: "requested", statement: question, evidence: evidence(question, 0, question.length) },
  ];
  const expressions: ProblemIR["expressions"] = [], inputs: MechanicsProgramInput[] = [];
  source.bodies.forEach((body, index) => {
    for (const [field, value, sourceExpression, sourceUnit, unit, component] of [
      ["mass", body.mass.valueSI, body.mass.sourceExpression, body.mass.sourceUnit, "kg", undefined],
      ["x", body.position.xSI, body.position.sourceExpression, body.position.sourceUnit, "m", 0],
      ["y", body.position.ySI, body.position.sourceExpression, body.position.sourceUnit, "m", 1],
    ] satisfies Array<[string, number, string, string, string, number | undefined]>) {
      const id = `source_${index}_${field}`, expressionId = `expression_${index}_${field}`, factId = `source_body_${index}`;
      expressions.push({ id: expressionId, valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: [factId] });
      inputs.push({ id, expressionId, ownerId: body.id, factId, sourceExpression, sourceUnit, unit, ...(component === undefined ? {} : { component }),
        ...(component !== undefined && body.position.unitEvidence ? { unitFactId: `source_length_unit_${index}` } : {}) });
    }
  });
  const modelId = "source_mass_moments", axisId = source.bodies[0]!.id;
  const model: MechanicsProgramStep = { id: modelId, operator: "mass_moments", ownerId: source.aggregate.id, axisId,
    sourceOwners: Object.fromEntries(source.bodies.map((body, index) => [`components.${index}`, body.id])),
    evidenceFactIds: facts.filter(fact => fact.kind === "given").map(fact => fact.id),
    inputs: { units: { mass: "kg", length: "m" }, components: source.bodies.map((_body, index) => ({ shape: "point", mass: `source_${index}_mass`, center: [`source_${index}_x`, `source_${index}_y`] })),
      axis: { id: axisId, point: ["source_0_x", "source_0_y"], direction: ["zero", "zero", "one"].map(constant => ({ constant, factId: "source_frame", unit: "1" })) } } };
  const drawing = readSourceDrawingRequests(question).filter(request => request.scope === "current");
  const visualOwners = [...source.bodies, source.centre];
  const drawingScope = sourcePointBodyDrawingScope(source);
  const intentIds = visualOwners.filter(owner => drawingScope.ownerLabels.includes(owner.label)).map(owner => owner.id);
  return { schemaVersion: "problem-ir/v1", id: "source_point_distribution", question, facts,
    entities: [{ ...source.aggregate, kind: "body", evidenceFactIds: ["source_roster"] },
      ...source.bodies.map((body, index) => ({ id: body.id, label: body.label, kind: "point" as const, evidenceFactIds: [`source_body_${index}`, "source_roster"] })),
      { id: source.centre.id, label: source.centre.label, kind: "point", evidenceFactIds: ["source_requested"] }],
    expressions, constraints: source.connector ? [{ id: "source_connection", kind: "connected", entityIds: source.bodies.map(body => body.id), evidenceFactIds: ["source_connector"] }] : [],
    representationIntents: plan.visualRequirement !== "none" && drawing.length
      ? [{ id: "source_points", kind: "apparatus", entityIds: intentIds, evidenceFactIds: ["source_roster", "source_requested"] }] : [],
    solveRequests: targets.map((target, index) => ({ id: `source_solve_${index}`, kind: "mechanics", program: { model: "mechanics", inputs: structuredClone(inputs), steps: [structuredClone(model)],
      output: { stepId: modelId, ownerId: source.aggregate.id, axisId, symbol: target.symbol, unit: target.binding.unit! } }, resultBinding: target.binding })) };
}
