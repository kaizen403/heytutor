import { COMPLEX_OPERATORS, evaluateComplexConstruction, type ComplexEvaluationContext, type ComplexGeometry } from "../compile/complexGeometry";
import type { SceneDocument, SceneEntity, SceneIssue } from "../types";

export interface ComplexDistanceSource {
  variable: string;
  reference: { real: number; imaginary: number };
}
type ComplexSourcePoint = { real: number; imaginary: number; frame: { origin: { x: number; y: number }; displayScale: number } };

const SCALAR = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i;
const SCALAR_FULL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const UNITS = new Set(["", "1", "unit", "units", "unitless", "dimensionless", "scalar"]);
const REFERENCE_ROLE = /^(?:(?:complex|modulus) )?distance reference(?: point)?(?: for (\|[^|]+\|))?$|^reference point for (\|[^|]+\|)$/i;
const SOURCE_DISTANCE_ROLE = /^source modulus distance(?: for (\|[^|]+\|))?$|^complex(?: modulus)? distance for (\|[^|]+\|)$/i;
type Rational = { n: bigint; d: bigint };
type Affine = { variable: string | null; count: number; coefficient: number; real: Rational; imaginary: Rational };

/**
 * A complete bounded modulus, not a topic detector or a substring calculator.
 * Supported: one complex variable with coefficient +1, finite numeric real/i
 * terms, +/−, parentheses, decimals and numeric fractions (including 3i/2).
 * Decimal/fraction arithmetic stays exact in private bounded rationals through
 * cancellation. Only final components convert to finite display numbers; this
 * is not an exact-decimal geometry/solver claim. Components must be exact zero
 * or have magnitude from 1e−12 to 1e12. Unsupported syntax/precision/capacity
 * declines, never guesses a zero. For |z+c| the reference is −c, not literal c.
 */
export function parseComplexDistanceExpression(expression: unknown): ComplexDistanceSource | null {
  if (typeof expression !== "string" || expression.length > 512) return null;
  const text = normalize(expression);
  if (!/^\|[^|]+\|$/.test(text)) return null;
  const body = text.slice(1, -1).replace(/\s/g, "");
  if (body.length > 256) return null;
  let cursor = 0;
  let operations = 0;
  const zero = (): Affine => ({ variable: null, count: 0, coefficient: 0, real: rational(0n, 1n), imaginary: rational(0n, 1n) });
  const combine = (a: Affine, b: Affine, sign: number): Affine => {
    if (a.variable && b.variable && a.variable !== b.variable) throw new Error("symbolic offset");
    const add = (left: Rational, right: Rational): Rational => rational(left.n * right.d + BigInt(sign) * right.n * left.d, left.d * right.d);
    const result = { variable: a.variable ?? b.variable, count: a.count + b.count, coefficient: a.coefficient + sign * b.coefficient, real: add(a.real, b.real), imaginary: add(a.imaginary, b.imaginary) };
    if (!rationalRange(result.real, false) || !rationalRange(result.imaginary, false)) throw new Error("numeric bound");
    return result;
  };
  const scalar = (): Rational => {
    const match = SCALAR.exec(body.slice(cursor));
    if (!match || match[0].length > 48) throw new Error("numeric literal");
    cursor += match[0].length;
    const [mantissa, exponentText] = match[0].toLowerCase().split("e");
    const exponent = exponentText === undefined ? 0 : Number(exponentText);
    if (Math.abs(exponent) > 96) throw new Error("decimal capacity");
    const scale = (mantissa!.split(".")[1]?.length ?? 0) - exponent;
    const digits = BigInt(mantissa!.replace(".", ""));
    const value = scale >= 0 ? rational(digits, 10n ** BigInt(scale)) : rational(digits * 10n ** BigInt(-scale), 1n);
    if (!rationalRange(value)) throw new Error("numeric range");
    return value;
  };
  const atom = (depth: number): Affine => {
    if (depth > 12 || ++operations > 128) throw new Error("expression capacity");
    if (body[cursor] === "+" || body[cursor] === "-") {
      const sign = body[cursor++] === "-" ? -1 : 1;
      return combine(zero(), atom(depth + 1), sign);
    }
    if (body[cursor] === "(") {
      cursor++;
      const result = sum(depth + 1);
      if (body[cursor++] !== ")") throw new Error("parentheses");
      return result;
    }
    const result = zero();
    if (body[cursor] === "i" || /[\d.]/.test(body[cursor] ?? "")) {
      let imaginary = body[cursor] === "i";
      let value = imaginary ? (cursor++, rational(1n, 1n)) : scalar();
      if (!imaginary && body[cursor] === "i") { imaginary = true; cursor++; }
      if (body[cursor] === "/") {
        cursor++;
        const denominator = scalar();
        if (denominator.n === 0n) throw new Error("zero denominator");
        value = rational(value.n * denominator.d, value.d * denominator.n);
      }
      if (!imaginary && body[cursor] === "i") { imaginary = true; cursor++; }
      if (!rationalRange(value)) throw new Error("numeric range");
      if (imaginary) result.imaginary = value; else result.real = value;
      return result;
    }
    const symbol = body[cursor];
    if (!symbol || !/^[a-hj-z]$/i.test(symbol)) throw new Error("unsupported atom");
    cursor++;
    return { ...result, variable: symbol, count: 1, coefficient: 1 };
  };
  const sum = (depth: number): Affine => {
    let result = atom(depth);
    while (body[cursor] === "+" || body[cursor] === "-") {
      const sign = body[cursor++] === "-" ? -1 : 1;
      result = combine(result, atom(depth), sign);
    }
    return result;
  };
  try {
    const result = sum(0);
    if (cursor !== body.length || result.count !== 1 || result.coefficient !== 1 || !result.variable) return null;
    return { variable: result.variable, reference: { real: rationalReference(result.real), imaginary: rationalReference(result.imaginary) } };
  } catch { return null; }
}

/**
 * Source authority ONLY for explicit distance-reference points, or a segment /
 * vector / dimension explicitly claiming a source modulus with one named
 * variable endpoint. Literal w, O→w and extrema radii do not assert this role
 * and remain untouched. `semantic.complexDistanceExpression` optionally binds
 * an explicit reference role when the question contains multiple moduli.
 * A supported affine-modulus or explicit arithmetic label with a declared
 * complex-variable endpoint, a source-modulus role, a bound complex-distance role, or
 * complexDistanceExpression opts a path in. Bars alone (ordinary |AB| or
 * vector |v|), generic distance roles and complex fixed-point producers do
 * not. Arithmetic labels also opt in through a named variable backed by a
 * complex producer; a generic labelled producer alone does not assert a norm.
 * Generic unbound reference-point roles require a complex producer;
 * complex/modulus-qualified or expression-bound roles require source proof.
 * Explicit unsupported claims still require proof/decline.
 * The caller supplies the trusted question; document.source is never read.
 */
export function validateComplexDistanceSourceInputs(document: SceneDocument, question: unknown): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const references = document.entities.flatMap((entity, index) => {
    if (entity.kind !== "point") return [];
    const role = typeof entity.role === "string" ? normalize(entity.role).split("|").map((part, index) => index % 2 === 0 ? part.replace(/[_-]/g, " ") : part).join("|").trim().replace(/\s+/g, " ") : "";
    const match = REFERENCE_ROLE.exec(role);
    if (!match) return [];
    const semantic = plain(entity.semantic) ? own(entity.semantic, "complexDistanceExpression") : undefined;
    const complexProducer = document.constructions.some((construction) => construction.outputs.includes(entity.id) && (COMPLEX_OPERATORS as readonly string[]).includes(construction.operator));
    if (semantic === undefined && !match[1] && !match[2] && !/^(?:complex|modulus) /.test(role.toLowerCase()) && !complexProducer) return [];
    const expressions = [semantic, match[1] ?? match[2]].filter((expression) => expression !== undefined);
    return [{ id: entity.id, expressions, path: `entities[${index}].role` }];
  });
  const distances = document.constructions.flatMap((construction, index) => {
    if (!["segment", "vector", "dimension"].includes(construction.operator)) return [];
    const expressions = construction.outputs.flatMap((id) => document.entities.filter((entity) => entity.id === id).flatMap((entity) => {
      const role = typeof entity.role === "string" ? normalize(entity.role).split("|").map((part, partIndex) => partIndex % 2 === 0 ? part.replace(/[_-]/g, " ") : part).join("|").trim().replace(/\s+/g, " ") : "";
      const marker = SOURCE_DISTANCE_ROLE.exec(role);
      const semantic = plain(entity.semantic) ? own(entity.semantic, "complexDistanceExpression") : undefined;
      const label = typeof entity.label === "string" && /^\|[^|]+\|$/.test(normalize(entity.label)) ? entity.label : undefined;
      const parsedLabel = parseComplexDistanceExpression(label);
      const complexEndpoint = label && plain(construction.inputs) && [endpoint(construction.inputs, ["start", "from", "a", ...(construction.operator === "vector" ? ["origin"] : [])]), endpoint(construction.inputs, ["end", "to", "b"])].some((id) => typeof id === "string" && document.entities.some((point) => {
        if (point.id !== id || point.kind !== "point") return false;
        const variable = complexVariableSymbol(point);
        const declared = variable !== null && (parsedLabel ? variable === parsedLabel.variable : explicitArithmeticLabel(label, variable));
        const computedNamed = document.constructions.some((producer) => producer.outputs.includes(point.id) && (COMPLEX_OPERATORS as readonly string[]).includes(producer.operator)) && pointVariableSymbols(point).some((symbol) => explicitArithmeticLabel(label, symbol));
        return declared || computedNamed;
      }));
      if (!marker && semantic === undefined && !complexEndpoint) return [];
      const bindings = [semantic, marker?.[1] ?? marker?.[2], label].filter((expression) => expression !== undefined);
      return bindings.length > 0 ? bindings : [undefined];
    }));
    return expressions.length > 0 ? [{ construction, expressions, path: `constructions[${index}].inputs` }] : [];
  });
  if (references.length === 0 && distances.length === 0) return [];
  const source = sourceModuli(question);
  const issues: SceneIssue[] = [];
  const issue = (code: string, path: string, message: string): void => { issues.push({ code, severity: "fatal", path, message }); };
  const bind = (expression: unknown, path: string): ComplexDistanceSource | null => {
    if (!source) { issue("complex_distance_source_unsupported", path, "A distance reference requires bounded complete source moduli, not a guessed expression."); return null; }
    if (expression !== undefined) {
      const parsed = parseComplexDistanceExpression(expression);
      if (!parsed || !source.supported.some((candidate) => sameSource(candidate, parsed))) {
        issue("complex_distance_source_binding_unsupported", path, "The explicit distance expression must be a complete supported modulus in the trusted question."); return null;
      }
      return parsed;
    }
    if (source.unsupported) { issue("complex_distance_source_unsupported", path, "An unbound reference cannot choose among unsupported source expressions."); return null; }
    const candidates = source.supported;
    const unique = candidates.filter((candidate, index) => candidates.findIndex((other) => sameSource(candidate, other)) === index);
    if (unique.length !== 1) { issue("complex_distance_source_ambiguous", path, "Multiple source distances require an explicit expression binding; no reference is inferred."); return null; }
    return unique[0]!;
  };
  const resolve = pointResolver(document);
  const audit = (id: unknown, expected: ComplexDistanceSource, path: string): void => {
    const actual = resolve(id);
    if (!actual) issue("complex_distance_input_unsupported", path, "The distance reference must resolve from one finite dimensionless complex construction or world-coordinate point.");
    else if (!close(actual.real, expected.reference.real) || !close(actual.imaginary, expected.reference.imaginary)) issue("complex_distance_reference_mismatch", path, "The computed reference disagrees with the source modulus: |z+c| measures distance from −c; a correct literal c is not that reference.");
  };
  for (const reference of references) {
    const bindings = (reference.expressions.length > 0 ? reference.expressions : [undefined]).map((expression) => bind(expression, reference.path));
    const expected = bindings[0];
    if (bindings.some((binding) => binding === null)) continue;
    if (expected && bindings.some((binding) => binding && !sameSource(expected, binding))) {
      issue("complex_distance_source_binding_unsupported", reference.path, "Reference role and semantic expression bindings disagree; no binding overrides another.");
    } else if (expected) audit(reference.id, expected, reference.path);
  }
  for (const { construction, expressions, path } of distances) {
    const bindings = expressions.map((expression) => bind(expression, path));
    const expected = bindings[0];
    if (bindings.some((binding) => binding === null)) continue;
    if (!expected) continue;
    if (bindings.some((binding) => binding && !sameSource(expected, binding))) {
      issue("complex_distance_source_binding_unsupported", path, "Path role, semantic and label bindings disagree; no source variable or expression overrides another.");
      continue;
    }
    const startKeys = ["start", "from", "a", ...(construction.operator === "vector" ? ["origin"] : [])];
    const endKeys = ["end", "to", "b"];
    if (!plain(construction.inputs) || Object.keys(construction.inputs).some((key) => ![...startKeys, ...endKeys].includes(key))) {
      issue("complex_distance_input_unsupported", path, "A source-labelled distance supports endpoint-only inputs; direction, length and other overrides cannot redefine its rendered endpoint.");
      continue;
    }
    const first = endpoint(construction.inputs, startKeys);
    const second = endpoint(construction.inputs, endKeys);
    const isVariable = (id: unknown): boolean => typeof id === "string" && document.entities.some((entity) => entity.id === id && variablePoint(entity, expected.variable));
    if (isVariable(first) === isVariable(second)) issue("complex_distance_input_unsupported", path, "A source-labelled distance requires exactly one explicitly named complex-variable endpoint; endpoints are never guessed.");
    else {
      const a = resolve(first);
      const b = resolve(second);
      if (!a || !b || a.frame.origin.x !== b.frame.origin.x || a.frame.origin.y !== b.frame.origin.y || a.frame.displayScale !== b.frame.displayScale) {
        issue("complex_distance_input_unsupported", path, "Both source-distance endpoints must retain the same computed complex display frame; ordinary world-coordinate points have the identity frame.");
      } else audit(isVariable(first) ? second : first, expected, path);
    }
  }
  return issues;
}

function sourceModuli(question: unknown): { supported: ComplexDistanceSource[]; unsupported: boolean } | null {
  if (typeof question !== "string" || question.length > 4096) return null;
  const text = normalize(question);
  const expressions = text.match(/\|[^|]*\|/g) ?? [];
  if (expressions.length === 0 || expressions.length > 16 || expressions.length * 2 !== (text.match(/\|/g) ?? []).length) return null;
  const parsed = expressions.map(parseComplexDistanceExpression);
  return { supported: parsed.filter((item): item is ComplexDistanceSource => item !== null), unsupported: parsed.some((item) => item === null) };
}

function pointResolver(document: SceneDocument): (id: unknown) => ComplexSourcePoint | null {
  const quantities = new Map<string, unknown>();
  for (const quantity of document.quantities) {
    if (!plain(quantity) || quantities.has(quantity.id)) return () => null;
    quantities.set(quantity.id, quantity);
  }
  const number = (value: unknown, depth = 0): number => {
    if (depth > 32) throw new Error("numeric capacity");
    if (typeof value === "string" && quantities.has(value)) return number(quantities.get(value), depth + 1);
    if (plain(value) && Object.keys(value).every((key) => ["id", "symbol", "value", "unit", "provenance", "expression", "sourceText"].includes(key))) {
      const unit = own(value, "unit");
      if (unit !== undefined && (typeof unit !== "string" || !UNITS.has(unit.trim().toLowerCase()))) throw new Error("physical component");
      return number(own(value, "value"), depth + 1);
    }
    const result = typeof value === "number" ? value : typeof value === "string" && SCALAR_FULL.test(value) ? Number(value) : NaN;
    if (typeof value === "string" && result === 0 && /[1-9]/.test(value.split(/e/i)[0]!)) throw new Error("numeric underflow");
    if (!finite(result)) throw new Error("numeric input");
    return result;
  };
  const cache = new Map<string, { kind: "point"; point: { x: number; y: number } } | ComplexGeometry>();
  const pending = new Set<string>();
  let resolutions = 0;
  const context: ComplexEvaluationContext = {
    number,
    point(value) {
      if (typeof value === "string") return geometry(value).point;
      if (Array.isArray(value) && value.length === 2) return { x: number(value[0]), y: number(value[1]) };
      if (plain(value)) return { x: number(own(value, "x")), y: number(own(value, "y")) };
      throw new Error("point input");
    },
    geometry: (value) => geometry(value),
  };
  const geometry = (id: unknown): { kind: "point"; point: { x: number; y: number } } | ComplexGeometry => {
    if (typeof id !== "string") throw new Error("point identity");
    const existing = cache.get(id);
    if (existing) return existing;
    if (pending.has(id) || pending.size >= 32 || ++resolutions > 4096) throw new Error("point capacity");
    const entities = document.entities.filter((entity) => entity.id === id);
    const producers = document.constructions.filter((construction) => construction.outputs.includes(id));
    if (entities.length !== 1 || entities[0]!.kind !== "point" || producers.length !== 1) throw new Error("point identity");
    const producer = producers[0]!;
    if (!dataTree(producer.inputs)) throw new Error("point data");
    pending.add(id);
    try {
      if (producer.operator === "point") {
        if (Object.keys(producer.inputs).some((key) => !["x", "y", "coordinateSpace"].includes(key)) || producer.inputs.coordinateSpace !== undefined && producer.inputs.coordinateSpace !== "world") throw new Error("point frame");
        const result = { kind: "point" as const, point: { x: number(producer.inputs.x), y: number(producer.inputs.y) } };
        cache.set(id, result);
      } else {
        if (!(COMPLEX_OPERATORS as readonly string[]).includes(producer.operator)) throw new Error("point producer");
        const results = evaluateComplexConstruction(producer.operator, producer.inputs, context);
        if (results.length !== producer.outputs.length || new Set(producer.outputs).size !== producer.outputs.length) throw new Error("point outputs");
        producer.outputs.forEach((output, index) => cache.set(output, results[index]!));
      }
      return cache.get(id)!;
    } finally { pending.delete(id); }
  };
  return (id) => {
    try {
      const result = geometry(id);
      return "complexNumber" in result
        ? { real: result.complexNumber.real, imaginary: result.complexNumber.imaginary, frame: { origin: { ...result.complexNumber.origin }, displayScale: result.complexNumber.displayScale } }
        : { real: result.point.x, imaginary: result.point.y, frame: { origin: { x: 0, y: 0 }, displayScale: 1 } };
    } catch { return null; }
  };
}

function endpoint(inputs: Record<string, unknown>, keys: string[]): unknown {
  const present = keys.filter((key) => own(inputs, key) !== undefined);
  return present.length === 1 ? own(inputs, present[0]!) : undefined;
}
function variablePoint(entity: SceneEntity, variable: string): boolean {
  const symbols = pointVariableSymbols(entity);
  return symbols.length === 1 && symbols[0] === variable;
}
function complexVariableSymbol(entity: SceneEntity): string | null {
  const role = typeof entity.role === "string" ? normalize(entity.role).replace(/[_-]/g, " ").replace(/\s+/g, " ").trim() : "";
  const match = /^(?:complex variable|variable complex point) ([a-hj-z])$/i.exec(role);
  return entity.kind === "point" && match ? match[1]! : null;
}
function pointVariableSymbols(entity: SceneEntity): string[] {
  if (entity.kind !== "point") return [];
  const label = typeof entity.label === "string" && /^[a-hj-z]$/i.test(entity.label.trim()) ? entity.label.trim() : null;
  const role = typeof entity.role === "string" ? normalize(entity.role).replace(/[_-]/g, " ").replace(/\s+/g, " ").trim() : "";
  const match = /^(?:complex variable|variable complex point|variable point) ([a-hj-z])$/i.exec(role);
  return [...new Set([label, match?.[1]].filter((symbol): symbol is string => typeof symbol === "string"))];
}
// This is an opt-in marker, never a fallback expression parser. Arithmetic
// containing the declared complex variable must still pass the complete,
// bounded source parser; unsupported syntax/precision cannot escape proof.
// Plain point-pair/identifier bars remain ordinary length or norm notation.
function explicitArithmeticLabel(label: string, variable: string): boolean {
  const body = normalize(label).slice(1, -1);
  return /[+\-*/^()\d]/.test(body) && new RegExp(`(?:^|[^a-zA-Z])${variable}(?:$|[^a-zA-Z])`).test(body);
}
function normalize(value: string): string { return value.replace(/−/g, "-").replace(/\\(?:left|right)\s*/g, "").replace(/\\[lr]vert/g, "|").trim(); }
function rational(n: bigint, d: bigint): Rational {
  if (d <= 0n) throw new Error("rational denominator");
  if (n === 0n) return { n: 0n, d: 1n };
  let a = n < 0n ? -n : n;
  let b = d;
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
  const result = { n: n / a, d: d / a };
  if ((result.n < 0n ? -result.n : result.n).toString(2).length > 512 || result.d.toString(2).length > 512) throw new Error("rational capacity");
  return result;
}
function rationalRange(value: Rational, minimum = true): boolean {
  const magnitude = value.n < 0n ? -value.n : value.n;
  return magnitude <= 1000000000000n * value.d && (!minimum || magnitude === 0n || magnitude * 1000000000000n >= value.d);
}
function rationalReference(value: Rational): number {
  if (!rationalRange(value)) throw new Error("reference numeric bound");
  if (value.n === 0n) return 0;
  // The private 512-bit cap keeps both conversions finite. Exact cancellation
  // and nonzero magnitude checks happened before this sole display conversion.
  const reference = -Number(value.n) / Number(value.d);
  if (!finite(reference) || reference === 0) throw new Error("reference representation");
  return reference;
}
function finite(value: number): boolean { return Number.isFinite(value) && Math.abs(value) <= 1e12 && (value === 0 || Math.abs(value) >= 1e-12); }
function close(a: number, b: number): boolean { return a === b || Math.abs(a - b) <= 64 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)); }
// Source joins are exact retained identities, not the scene's numerical audit
// tolerance. Equivalent decimal/fraction forms may share the final bounded
// Number representation; this is not an exact-decimal geometry proof.
function sameSource(a: ComplexDistanceSource, b: ComplexDistanceSource): boolean { return a.variable === b.variable && a.reference.real === b.reference.real && a.reference.imaginary === b.reference.imaginary; }
function own(value: object, key: string): unknown { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined; }
function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"));
}
function dataTree(value: unknown, depth = 0, budget = { remaining: 4096, seen: new Set<object>() }): boolean {
  if (depth > 32 || --budget.remaining < 0) return false;
  if (value === null || typeof value !== "object") return true;
  if (budget.seen.has(value)) return false;
  budget.seen.add(value);
  if (Array.isArray(value)) return Object.getPrototypeOf(value) === Array.prototype && value.length <= 64 && Reflect.ownKeys(value).length === value.length + 1 && Reflect.ownKeys(value).every((key) => key === "length" || typeof key === "string" && /^\d+$/.test(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) && value.every((item) => dataTree(item, depth + 1, budget));
  return plain(value) && Object.keys(value).length <= 64 && Object.values(value).every((item) => dataTree(item, depth + 1, budget));
}
