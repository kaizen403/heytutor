import { unwrapMathMarkup } from "@heytutor/drawing";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { implicitSolverEntityIds } from "../document/validation";
import { parseMathExpression } from "../math/expression";
import { evaluateAffineConstruction } from "../compile/affineGeometry";
import { validateCoordinateDistanceSourceInputs } from "../ir/coordinateDistanceSource";
import { readSectionFormulaSource, validateSectionPointSourceInputs } from "../ir/sectionFormulaSource";
import { MATRIX_ARRAY_OPERATORS } from "../compile/matrixArrayGeometry";
import { hasMatrixSourceProgram, validateMatrixSourceBinding } from "../compile/matrixSourceBinding";

export interface RequestedPointSourceAuthority {
  applies: boolean;
  completeSourceProof: boolean;
  issues: SceneIssue[];
}
type GivenPoint = { name: string; point: RenderPoint; unit?: string };
type Request = { names: string[]; descriptor: string };
type Definition = { kind: "midpoint"; a: string; b: string } | { kind: "endpoint"; point: string } |
  { kind: "curve_anchor"; curve: string; at: number } | { kind: "section"; point: RenderPoint };
const NAME = "[\\p{L}][\\p{L}\\p{N}_'′]{0,63}";
const PAIR = "\\(\\s*([^,;]{1,96}?)\\s*,\\s*([^,;]{1,96}?)\\s*\\)";
const LENGTH: Readonly<Record<string, number>> = { mm: 0.001, cm: 0.01, m: 1, km: 1000 };
const POINT_OPERATORS = new Set(["point", "midpoint", "translate", "rotate", "affine_point", "project", "intersection", "curve_anchor"]);
const POSITION_DECLARATION = /\b(?:Cartesian|coordinates?|positions?|locations?|points?|midpoint|endpoints?|intersection|curve|cent(?:re|er)|centroid|origin|axis|(?:xy|yz|xz)\s+(?:plane|frame))\b/iu;
const POSITION_REQUEST = /^(?:(?:x|y|z)[ -])?(?:coordinates?|positions?|locations?|points?|midpoint|endpoints?|intersection|cent(?:re|er)|centroid|origin)\b/iu;
const EPS = 128 * Number.EPSILON;
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(message: string): never { throw new Error(message); }
const plain = (value: string): string => unwrapMathMarkup(value).normalize("NFKC").replace(/_\{([^{}]+)\}/g, "_$1").replace(/[′’]/g, "'").replace(/−/g, "-").trim();
const descriptor = (value: string): string => plain(value).toLowerCase().replace(/\b(?:the|their|its|a|an|of|between|computed|derived|requested|physical|source)\b/gu, " ").replace(/\s+/g, " ").trim();
function close(a: number, b: number): boolean { return a === b || a !== 0 && b !== 0 && Math.abs(a - b) <= EPS * Math.max(Math.abs(a), Math.abs(b)); }
const samePoint = (a: RenderPoint, b: RenderPoint): boolean => close(a.x, b.x) && close(a.y, b.y);
function closed(value: unknown): number {
  if (typeof value === "number") { if (!Number.isFinite(value) || Math.abs(value) > 1e12) fail("source coordinate is not bounded"); return value; }
  if (typeof value !== "string" || value.length > 256) return fail("source coordinate needs a closed scalar");
  const expression = parseMathExpression(value);
  if (expression.syntaxKey.includes('"kind":"variable"')) fail("free variables cannot certify a source coordinate");
  return closed(expression.evaluate(0));
}
function containsName(text: string, name: string): boolean {
  const wanted = plain(name), available = plain(text);
  let at = available.indexOf(wanted);
  while (at >= 0) {
    if (!/[\p{L}\p{N}_']/u.test(available[at - 1] ?? "") && !/[\p{L}\p{N}_']/u.test(available[at + wanted.length] ?? "")) return true;
    at = available.indexOf(wanted, at + 1);
  }
  return false;
}
function sourceGivenPoints(question: string): GivenPoint[] {
  const source = plain(question), result: GivenPoint[] = [];
  const declaration = new RegExp(`(?<![\\p{L}\\p{N}_'])(${NAME})\\s*(?:=|(?:is\\s+)?at|(?:has|is\\s+at)\\s+(?:(?:initial|final|fixed)\\s+)?(?:position|coordinates?|cent(?:re|er))\\s*(?:at\\s*)?|(?:of|with)\\s+[^,;()]{1,64}?\\s+at)\\s*${PAIR}\\s*(mm|cm|km|m)?`, "gu");
  for (const match of source.matchAll(declaration)) {
    try {
      // Prose such as "foci at (...)" or "ends ... are at (...)" does
      // not declare points named foci or are. Explicit identifier assignments
      // and actual named-point/body declarations retain their existing proof.
      if (!match[0].slice(match[1]!.length).trimStart().startsWith("=") &&
          /^(?:a|an|the|and|or|is|are|was|were|has|have|at|of|in|on|axis|axes|foci|focus|vertices|vertex|ends?|endpoints?|origin|centre|center|points?|positions?|locations?|coordinates?)$/.test(match[1]!)) continue;
      if (!POSITION_DECLARATION.test(source) && !(match[4] && /\bat\b/u.test(match[0].slice(match[1]!.length)))) continue;
      const trailing = source.slice(match.index! + match[0].length);
      if (match[4] && /^[\p{L}\p{N}/^]/u.test(trailing) || !match[4] && /^\s*(?:[A-Z](?:\b|\/)|m\/|kg\b|rad\b)/u.test(trailing)) continue;
      result.push({ name: plain(match[1]!), point: { x: closed(match[2]), y: closed(match[3]) }, ...(match[4] ? { unit: match[4] } : {}) });
    } catch { /* An unreadable declaration supplies no numeric authority. */ }
  }
  // The existing section reader also accepts the main A(1,2) notation. Its
  // complete original-source certificate supplies these endpoint declarations.
  const section = readSectionFormulaSource(question);
  if (section.status === "ok") for (const point of [section.source.a, section.source.b]) {
    if (point.named && !result.some(entry => entry.name === point.name && samePoint(entry.point, point)))
      result.push({ name: point.name, point: { x: point.x, y: point.y } });
  }
  return result;
}
function requests(question: string, plan?: TurnPlanV3 | null): Request[] {
  const source = plain(question), result: Request[] = [];
  const grammar = new Set(["a", "an", "the", "of", "at", "in", "to", "as", "on", "by", "is", "and", "or", "be"]);
  for (const clause of source.split(/[!?;]|\.(?!\d)/u)) {
    const verb = /\b(?:find|compute|calculate|determine|locate|obtain|derive|solve|evaluate|report|give)\b\s+/iu.exec(clause);
    if (!verb) continue;
    const head = clause.slice(verb.index + verb[0].length).split(/\b(?:and|then)\s+(?:draw|show|mark|label|sketch)\b/iu)[0]!.trim();
    const words = [...head.matchAll(new RegExp(NAME, "gu"))];
    const first = words.find(word => !grammar.has(word[0].toLowerCase()) &&
      (/^[\p{Lu}]/u.test(word[0]) || word[0].includes("_") || word[0].length <= 2));
    const prefix = first ? head.slice(0, first.index).trim() : head;
    const operand = /\b(?:of|between|about|on)\s*$/iu.test(prefix) && !/^(?:(?:the|their|its)\s+)?(?:coordinates?|positions?|locations?)\b/iu.test(prefix);
    const names = first && !operand ? [plain(first[0])] : [];
    if (first && !operand) {
      const list = head.slice(first.index! + first[0].length);
      for (const match of list.matchAll(new RegExp(`^(?:\\s*(?:,|and|&)\\s*)(${NAME})`, "gu"))) names.push(plain(match[1]!));
    }
    result.push({ names, descriptor: descriptor(prefix) });
  }
  if (result.length && plan && plan.question === question) {
    for (const quantity of plan.unknowns) if (typeof quantity.unit === "string" && Object.hasOwn(LENGTH, quantity.unit) &&
      containsName(question, quantity.symbol) && !result.some(request => request.names.includes(plain(quantity.symbol)))) result.push({ names: [plain(quantity.symbol)], descriptor: "coordinates" });
  }
  return result;
}
function geometricDefinitions(question: string, givenNames: readonly string[]): Map<string, Definition> {
  const source = plain(question), definitions = new Map<string, Definition>();
  const section = readSectionFormulaSource(question);
  if (section.status === "ok") definitions.set(section.source.point.name,
    { kind: "section", point: { x: section.source.point.x, y: section.source.point.y } });
  for (const pattern of [
    new RegExp(`(${NAME})\\s+(?:is|=)\\s*(?:the\\s+)?midpoint\\s+(?:of|between)\\s+(${NAME})\\s+(?:and|&)\\s+(${NAME})`, "gu"),
    new RegExp(`\\b(?:find|compute|calculate|determine)\\s+(?:the\\s+)?midpoint\\s+(${NAME})\\s+(?:of|between)\\s+(${NAME})\\s+(?:and|&)\\s+(${NAME})`, "giu"),
  ]) for (const match of source.matchAll(pattern)) definitions.set(plain(match[1]!), { kind: "midpoint", a: plain(match[2]!), b: plain(match[3]!) });
  const segmentPairs = (name: string): Array<[string, string]> => givenNames.flatMap(a => givenNames.filter(b => a !== b && `${a}${b}` === name).map((b): [string, string] => [a, b]));
  for (const match of source.matchAll(new RegExp(`(${NAME})\\s+(?:is|=)\\s*(?:the\\s+)?(first|second|start|end)\\s+endpoint\\s+of\\s+(?:segment\\s+)?(${NAME})`, "giu"))) {
    const pairs = segmentPairs(plain(match[3]!));
    if (pairs.length === 1) definitions.set(plain(match[1]!), { kind: "endpoint", point: pairs[0]![["first", "start"].includes(match[2]!.toLowerCase()) ? 0 : 1] });
  }
  for (const match of source.matchAll(new RegExp(`(${NAME})\\s+(?:=|coincides\\s+with)\\s*(${NAME})(?=$|[.;,])`, "gu")))
    if (givenNames.includes(plain(match[2]!))) definitions.set(plain(match[1]!), { kind: "endpoint", point: plain(match[2]!) });
  for (const match of source.matchAll(new RegExp(`(${NAME})\\s+is\\s+(?:(?:a|the)\\s+)?point\\s+on\\s+(${NAME})(?:\\(x\\))?\\s+at\\s+x\\s*=\\s*([^;,.]{1,96})`, "gu"))) {
    try { definitions.set(plain(match[1]!), { kind: "curve_anchor", curve: plain(match[2]!), at: closed(match[3]) }); } catch { /* Unsupported parameter stays unproved. */ }
  }
  return definitions;
}

/** Coordinate authority comes from original declarations or a corresponding
 * source-defined mathematical operation. A display role, a literal answer,
 * and an incidence assertion cannot establish a computed physical identity. */
export function validateRequestedPointSourceAuthority(document: SceneDocument, question: string, plan?: TurnPlanV3 | null): RequestedPointSourceAuthority {
  const empty = { applies: false, completeSourceProof: false, issues: [] };
  if (document.visualDecision?.mode !== undefined && document.visualDecision.mode !== "scene" || typeof question !== "string" || !question.trim() || question.length > 16384) return empty;
  const given = sourceGivenPoints(question), requested = requests(question, plan);
  const definitions = geometricDefinitions(question, given.map(point => point.name));
  // A matrix result or an equation's display anchor is not a source position.
  // Original spatial declarations establish this boundary, not an output kind,
  // a provider subject, or the spelling of a requested result.
  if (!given.length && !definitions.size && !POSITION_DECLARATION.test(plain(question))) return empty;
  const allNames = [...new Set([...given.map(point => point.name), ...requested.flatMap(request => request.names), ...definitions.keys()])];
  const worldUnit = given.find(point => point.unit)?.unit;
  const worldFactor = worldUnit ? LENGTH[worldUnit]! : 1;
  const sourcePoints = new Map<string, RenderPoint>(), ambiguous = new Set<string>();
  for (const point of given) {
    const factor = point.unit ? LENGTH[point.unit]! / worldFactor : 1;
    const value = { x: point.point.x * factor, y: point.point.y * factor };
    if (sourcePoints.has(point.name) && !samePoint(sourcePoints.get(point.name)!, value)) ambiguous.add(point.name);
    else sourcePoints.set(point.name, value);
  }
  for (const name of ambiguous) sourcePoints.delete(name);
  const byOutput = new Map<string, SceneConstruction>();
  for (const construction of document.constructions) for (const id of construction.outputs) byOutput.set(id, construction);
  const entities = new Map(document.entities.map(entity => [entity.id, entity]));
  let matrixProof: boolean | undefined;
  const dataDisplay = (id: string): boolean => {
    const producer = byOutput.get(id);
    return Boolean(producer && MATRIX_ARRAY_OPERATORS.some(operator => operator === producer.operator) &&
      (matrixProof ??= hasMatrixSourceProgram(question) && !validateMatrixSourceBinding(document, question, plan).some(issue => issue.severity === "fatal")));
  };
  const helpers = implicitSolverEntityIds({ ...document, relations: document.relations ?? [], assertions: document.assertions ?? [],
    requiredEntityIds: document.requiredEntityIds ?? [], annotations: document.annotations ?? [], revealGroups: document.revealGroups ?? [] });
  const revealed = new Set([...document.requiredEntityIds ?? [], ...document.revealGroups.flatMap(group => group.entityIds)]);
  const pointRequest = (request: Request): boolean => POSITION_REQUEST.test(request.descriptor) || !request.descriptor && request.names.some(name =>
    sourcePoints.has(name) || definitions.has(name) || new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:is|denotes|represents)\\s+(?:(?:the|a|an)\\s+)?(?:point|position|location|cent(?:re|er)|centroid|midpoint|endpoint)\\b`, "iu").test(plain(question)));
  const slotNames = (id: string): string[] => {
    const entity = entities.get(id);
    const text = [id, entity?.label, entity?.semantic?.name, entity?.semantic?.symbol,
      ...document.annotations.filter(annotation => annotation.kind === "label" && annotation.targetIds.includes(id) &&
        (!annotation.quantityId || document.quantities.some(quantity => quantity.id === annotation.quantityId &&
          (!quantity.unit || typeof quantity.unit === "string" && Object.hasOwn(LENGTH, quantity.unit))))).map(annotation => annotation.text)]
      .filter((value): value is string => typeof value === "string");
    const role = plain(entity?.role ?? "");
    const primary = (value: string, name: string): boolean => {
      const head = plain(value).split(/[([=:;,]/u)[0]!.trim();
      return head === name || head.startsWith(`${name} `) || !/\b(?:of|at|on|from|to|about|through|around|between|toward|towards)\b/iu.test(head) && head.endsWith(` ${name}`);
    };
    return allNames.filter(name => text.some(value => primary(value, name)) || primary(role, name));
  };
  const requestedFor = (id: string): Request[] => {
    const entity = entities.get(id), names = slotNames(id), role = descriptor(entity?.role ?? "");
    return requested.filter(request => pointRequest(request) && (request.names.some(name => names.includes(name)) || request.descriptor &&
      (role === request.descriptor || role.startsWith(`${request.descriptor} `))));
  };
  const claims = document.entities.filter(entity => !dataDisplay(entity.id) && (requestedFor(entity.id).length || slotNames(entity.id).some(name => given.some(point => point.name === name)) ||
    !helpers.has(entity.id) && (revealed.has(entity.id) || entity.label) && entity.kind === "point"));
  if (!given.length && !claims.some(entity => requestedFor(entity.id).length) && !definitions.size) return empty;
  const issues: SceneIssue[] = [];
  const issue = (code: string, message: string, id?: string): void => { issues.push({ code, message, severity: "fatal", failureKind: "truth",
    ...(id ? { entityIds: [id], path: `constructions[${document.constructions.findIndex(construction => construction.outputs.includes(id))}]` } : { path: "source.question" }) }); };
  const quantity = new Map(document.quantities.map(value => [value.id, value]));
  let reads = 0;
  function number(value: unknown, seen = new Set<string>()): number {
    if (++reads > 16384 || seen.size > 32) return fail("source point scalar references exceed their bound");
    if (record(value)) {
      if (Object.keys(value).some(key => !["value", "unit"].includes(key))) fail("coordinate wrapper contains unsupported fields");
      const factor = typeof value.unit === "string" && Object.hasOwn(LENGTH, value.unit) ? LENGTH[value.unit]! / worldFactor : 1;
      if (value.unit !== undefined && !(typeof value.unit === "string" && Object.hasOwn(LENGTH, value.unit))) fail("coordinate wrapper needs a source length unit");
      return number(value.value, seen) * factor;
    }
    if (typeof value === "string" && quantity.has(value)) {
      if (seen.has(value)) fail("cyclic source point scalar"); seen.add(value);
      const q = quantity.get(value)!;
      try { return q.unit ? number({ value: q.value, unit: q.unit }, seen) : number(q.value, seen); } finally { seen.delete(value); }
    }
    return closed(value);
  }
  const expectedCache = new Map(sourcePoints), expectedActive = new Set<string>();
  function sourceCurve(name: string) {
    const expression = new RegExp(`(?<![\\p{L}\\p{N}_'])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\(x\\))?\\s*=\\s*([^;!?]{1,256})`, "gu");
    const candidates = [...plain(question).matchAll(expression)].flatMap(match => { try { return [parseMathExpression(match[1]!.split(/\.(?!\d)|\s+(?:and|for|where|with)\b/iu)[0]!.trim())]; } catch { return []; } });
    if (!candidates.length || candidates.some(candidate => candidate.syntaxKey !== candidates[0]!.syntaxKey)) return fail("source curve definition is absent or ambiguous");
    return candidates[0]!;
  }
  function expected(name: string): RenderPoint {
    const saved = expectedCache.get(name); if (saved) return saved;
    if (expectedActive.has(name) || expectedActive.size > 32) return fail("source point definitions must be acyclic");
    const definition = definitions.get(name); if (!definition) return fail("requested point has no independent coordinate definition");
    expectedActive.add(name);
    try {
      const point = definition.kind === "section" ? definition.point : definition.kind === "endpoint" ? expected(definition.point) : definition.kind === "midpoint"
        ? (() => { const a = expected(definition.a), b = expected(definition.b); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; })()
        : { x: definition.at, y: sourceCurve(definition.curve).evaluate(definition.at) };
      closed(point.x); closed(point.y); expectedCache.set(name, point); return point;
    } finally { expectedActive.delete(name); }
  }
  const pointCache = new Map<string, RenderPoint>(), active = new Set<string>();
  const first = (inputs: Record<string, unknown>, keys: string[]): unknown => keys.map(key => inputs[key]).find(value => value !== undefined);
  function actual(value: unknown): RenderPoint {
    if (++reads > 32768) fail("source point geometry exceeds its bound");
    if (Array.isArray(value) && value.length === 2) return { x: number(value[0]), y: number(value[1]) };
    if (record(value) && value.x !== undefined && value.y !== undefined) return { x: number(value.x), y: number(value.y) };
    if (typeof value !== "string") return fail("source point geometry requires a point");
    const saved = pointCache.get(value); if (saved) return saved;
    const construction = byOutput.get(value); if (!construction || active.has(value) || active.size > 32) return fail("source point dependencies must be bounded and acyclic");
    active.add(value);
    try {
      const inputs = construction.inputs;
      let point: RenderPoint;
      if (construction.operator === "point") point = { x: number(inputs.x), y: number(inputs.y) };
      else if (construction.operator === "label") point = actual(first(inputs, ["target", "at", "point"]));
      else if (construction.operator === "section_point") {
        const section = readSectionFormulaSource(question);
        if (section.status !== "ok" || validateSectionPointSourceInputs(document, question).some(issue => issue.severity === "fatal"))
          return fail("section point requires its complete existing source certificate");
        point = { x: section.source.point.x, y: section.source.point.y };
      }
      else if (construction.operator === "midpoint") { const a = actual(first(inputs, ["a", "start"])), b = actual(first(inputs, ["b", "end"])); point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
      else if (construction.operator === "rotate") { const p = actual(first(inputs, ["point", "source"])), c = actual(first(inputs, ["center", "origin"])); const angle = number(inputs.angle) * (inputs.angleUnit === "radians" || inputs.angleUnit === "rad" ? 1 : Math.PI / 180); point = { x: c.x + (p.x - c.x) * Math.cos(angle) - (p.y - c.y) * Math.sin(angle), y: c.y + (p.x - c.x) * Math.sin(angle) + (p.y - c.y) * Math.cos(angle) }; }
      else if (construction.operator === "translate") { const p = actual(first(inputs, ["point", "source"])), delta = actual(first(inputs, ["vector", "delta"])); point = { x: p.x + delta.x, y: p.y + delta.y }; }
      else if (construction.operator === "affine_point") { const output = evaluateAffineConstruction("affine_point", inputs, { number, point: actual, geometry(ref) { return { kind: "point", point: actual(ref) }; } })[0]; if (output?.kind !== "point") fail("affine source point changed its type"); point = output.point; }
      else if (construction.operator === "curve_anchor") {
        const curve = typeof inputs.curve === "string" ? byOutput.get(inputs.curve) : undefined;
        if (!curve || curve.operator !== "function_curve" || typeof curve.inputs.expression !== "string") fail("source anchor needs an exact function curve");
        const aliases = [String(inputs.curve), entities.get(String(inputs.curve))?.label].filter((text): text is string => typeof text === "string");
        const expressions = aliases.flatMap(alias => { try { return [sourceCurve(plain(alias).replace(/\(x\)$/, ""))]; } catch { return []; } });
        const expression = parseMathExpression(curve.inputs.expression);
        if (!expressions.some(candidate => candidate.syntaxKey === expression.syntaxKey)) fail("anchor curve differs from the original source function");
        const at = number(inputs.at); point = { x: at, y: expression.evaluate(at) };
      } else return fail("a scalar or unrelated constructor cannot supply a physical point pose");
      closed(point.x); closed(point.y); pointCache.set(value, point); return point;
    } finally { active.delete(value); }
  }
  const proven = new Set<string>(), proving = new Set<string>();
  function corresponding(request: Request, definition: Definition): boolean {
    const descriptor = request.descriptor;
    return !descriptor || /^(?:(?:point|position|location|coordinates?)\s*)+$/u.test(descriptor) || descriptor.split(" ").includes(definition.kind === "curve_anchor" ? "curve" : definition.kind);
  }
  function prove(id: string): boolean {
    if (proven.has(id)) return true;
    if (proving.has(id) || proving.size > 32) return false;
    const construction = byOutput.get(id); if (!construction) return false;
    const names = slotNames(id), requirement = requestedFor(id), owned = names.filter(name => sourcePoints.has(name) || definitions.has(name));
    const available = owned.filter(name => !requirement.some(request => request.names.includes(name) && definitions.has(name) && !corresponding(request, definitions.get(name)!)));
    proving.add(id);
    try {
      if (construction.operator === "coordinate_distance" && validateCoordinateDistanceSourceInputs(document, question).length === 0 ||
        construction.operator === "section_point" && validateSectionPointSourceInputs(document, question).length === 0) { proven.add(id); return true; }
      for (const request of requirement) {
        const named = request.names.filter(name => names.includes(name));
        const targets = named.length ? named : request.names;
        if (!targets.length || targets.some(name => !available.includes(name))) return false;
      }
      if (requirement.length && !available.length) return false;
      if (available.length) { const point = actual(id); if (!available.every(name => samePoint(point, expected(name)))) return false; proven.add(id); return true; }
      if (construction.operator === "label") {
        const target = first(construction.inputs, ["target", "at", "point"]);
        if (typeof target !== "string" || !prove(target)) return false;
        actual(id); proven.add(id); return true;
      }
      if (!["midpoint", "rotate", "translate", "affine_point", "curve_anchor"].includes(construction.operator)) return false;
      const references = Object.values(construction.inputs).filter((value): value is string => typeof value === "string" && byOutput.has(value));
      if (construction.operator !== "curve_anchor" && (!references.length || !references.every(prove))) return false;
      actual(id); proven.add(id); return true;
    } catch { return false; } finally { proving.delete(id); }
  }
  for (const entity of claims) {
    const constructor = byOutput.get(entity.id);
    const required = requestedFor(entity.id).length > 0;
    const namedGiven = slotNames(entity.id).some(name => given.some(point => point.name === name));
    if (!constructor || !required && !POINT_OPERATORS.has(constructor.operator)) continue;
    if (!prove(entity.id)) issue(!required && namedGiven ? "given_point_source_mismatch" : "requested_point_source_missing",
      !required && namedGiven ? "The displayed source point must retain its original owner, complete coordinates and units." :
        "A requested or computed physical coordinate needs its native recomputed source model or a complete corresponding source proof; a literal, role, matching caption or incidence is insufficient.", entity.id);
  }
  const coordinateText = new RegExp(`${PAIR}\\s*(mm|cm|km|m)?`, "gu");
  const labels = [
    ...document.annotations.filter(annotation => typeof annotation.text === "string").map(annotation => ({ text: annotation.text!, targets: annotation.targetIds })),
    ...document.entities.filter(entity => typeof entity.label === "string").map(entity => ({ text: entity.label!, targets: [entity.id] })),
    ...document.constructions.filter(construction => construction.operator === "label" && typeof construction.inputs.text === "string").map(construction => ({ text: String(construction.inputs.text), targets: [first(construction.inputs, ["target", "at", "point"])].filter((id): id is string => typeof id === "string") })),
  ];
  for (const label of labels) for (const match of plain(label.text).matchAll(coordinateText)) {
    try {
      const prefix = plain(label.text).slice(0, match.index).trim(), explicit = allNames.filter(name => containsName(prefix, name));
      const names = explicit.length ? explicit : [...new Set(label.targets.flatMap(slotNames))];
      if (!names.length) { issue("requested_point_source_missing", "An unowned coordinate caption cannot establish a requested physical position."); continue; }
      const factor = match[3] ? LENGTH[match[3]]! / worldFactor : 1;
      const position = { x: closed(match[1]) * factor, y: closed(match[2]) * factor };
      for (const name of names) {
        if (!sourcePoints.has(name) && (!definitions.has(name) || requested.some(request => request.names.includes(name) && !corresponding(request, definitions.get(name)!)))) { issue("requested_point_source_missing", "A computed coordinate caption has no original numeric/source point authority.", label.targets[0]); continue; }
        if (!samePoint(position, expected(name))) issue("given_point_caption_mismatch", "A point coordinate caption must retain its full original or independently computed source position and units.", label.targets[0]);
      }
    } catch { /* Symbolic coordinate labels are checked by their existing source guards. */ }
  }
  const supported = new Set(["point", "midpoint", "rotate", "translate", "affine_point", "curve_anchor", "function_curve", "axes", "segment", "line", "ray", "polyline", "dimension", "label", "angle_mark"]);
  const completeSourceProof = !issues.length && document.constructions.every(construction => supported.has(construction.operator) &&
    (!POINT_OPERATORS.has(construction.operator) || construction.outputs.every(output => helpers.has(output) || prove(output)))) &&
    document.constructions.filter(construction => ["segment", "line", "ray", "polyline", "dimension"].includes(construction.operator)).every(construction => {
      const references = Object.values(construction.inputs).flatMap(value => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string" && byOutput.has(value));
      return references.length >= 2 && references.every(prove);
    });
  return { applies: true, completeSourceProof, issues };
}
