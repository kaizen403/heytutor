import type { MechanicsGeometry, MechanicsModel } from "../compile/mechanicsGeometry";
import type { MechanicsProgramInput, MechanicsProgramStep } from "../ir/mechanicsProgram";
import type { ProblemIR } from "../ir/problemIR";
import { parseMathExpression } from "../math/expression";

export interface MechanicsTranslationFreedom { readonly id: string; readonly x: number; readonly y: number; readonly xExact?: string; readonly yExact?: string }
export interface MechanicsPointAuthority { readonly freedoms: readonly MechanicsTranslationFreedom[] }
export interface MechanicsPositionAuthority {
  readonly schemaVersion: "mechanics-position-source/v1";
  readonly points: Readonly<Record<string, MechanicsPointAuthority>>;
  readonly unprovedClaims: readonly string[];
  readonly unprovedGeometry: boolean;
  readonly sourceMismatches: readonly string[];
}
type Point = { x: number; y: number };
const known = (): MechanicsPointAuthority => ({ freedoms: [] });
type Rational = { n: bigint; d: bigint };
const gcd = (left: bigint, right: bigint): bigint => { let a = left < 0n ? -left : left, b = right < 0n ? -right : right; while (b) { const next = a % b; a = b; b = next; } return a || 1n; };
function ratio(n: bigint, d: bigint): Rational { if (!d) return fail("zero freedom denominator"); const divisor = gcd(n, d); return { n: n / divisor * (d < 0n ? -1n : 1n), d: (d < 0n ? -d : d) / divisor }; }
function exact(value: number | string): Rational {
  if (typeof value === "string" && value.includes("/")) {
    if (value.length > 8192 || !/^-?\d+\/[1-9]\d*$/.test(value)) return fail("invalid exact freedom coefficient");
    const [n, d] = value.split("/"); return ratio(BigInt(n!), BigInt(d!));
  }
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return fail("freedom arithmetic requires a finite scalar");
  const power = Number(match[4] ?? 0) - (match[3]?.length ?? 0), n = BigInt(`${match[2]}${match[3] ?? ""}`) * (match[1] ? -1n : 1n);
  return power >= 0 ? ratio(n * 10n ** BigInt(power), 1n) : ratio(n, 10n ** BigInt(-power));
}
const sum = (a: Rational, b: Rational): Rational => ratio(a.n * b.d + b.n * a.d, a.d * b.d);
const product = (a: Rational, b: Rational): Rational => ratio(a.n * b.n, a.d * b.d);
const negative = (value: Rational): Rational => ({ n: -value.n, d: value.d });
const encoded = (value: Rational): string => `${value.n}/${value.d}`;
const component = (freedom: MechanicsTranslationFreedom, key: "x" | "y"): Rational => exact(key === "x" ? freedom.xExact ?? freedom.x : freedom.yExact ?? freedom.y);
function numeric(value: Rational): number {
  if (!value.n) return 0;
  const sign = value.n < 0n ? -1 : 1, n = String(value.n < 0n ? -value.n : value.n), d = String(value.d);
  const a = n.slice(0, 16), b = d.slice(0, 16);
  return sign * Number(a) / Number(b) * 10 ** (n.length - a.length - d.length + b.length);
}
function freedom(id: string, x: Rational, y: Rational): MechanicsTranslationFreedom { return { id, x: numeric(x), y: numeric(y), xExact: encoded(x), yExact: encoded(y) }; }
const cross = (value: MechanicsTranslationFreedom, vector: Point): Rational => sum(product(component(value, "x"), exact(vector.y)), negative(product(component(value, "y"), exact(vector.x))));
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(message: string): never { throw new Error(`Mechanics position source: ${message}`); }
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function names(text: string, name: string): boolean { return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(name)}(?![\\p{L}\\p{N}_])`, "u").test(text); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12; }
function identical(a: MechanicsPointAuthority, b: MechanicsPointAuthority): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export function combineMechanicsPointAuthority(parts: readonly { authority: MechanicsPointAuthority; factor: number | string }[]): MechanicsPointAuthority {
  const terms = new Map<string, { x: Rational; y: Rational }>();
  for (const part of parts) for (const freedom of part.authority.freedoms) {
    const before = terms.get(freedom.id) ?? { x: exact(0), y: exact(0) }, factor = exact(part.factor);
    terms.set(freedom.id, { x: sum(before.x, product(component(freedom, "x"), factor)), y: sum(before.y, product(component(freedom, "y"), factor)) });
  }
  return { freedoms: [...terms].filter(([, value]) => value.x.n !== 0n || value.y.n !== 0n).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, value]) => freedom(id, value.x, value.y)) };
}
export function differenceMechanicsPointAuthority(a: MechanicsPointAuthority, b: MechanicsPointAuthority): MechanicsPointAuthority {
  return identical(a, b) ? known() : combineMechanicsPointAuthority([{ authority: a, factor: 1 }, { authority: b, factor: -1 }]);
}
export function mechanicsPositionComponentProved(authority: MechanicsPointAuthority, component: "x" | "y"): boolean {
  return authority.freedoms.every(freedom => exact(component === "x" ? freedom.xExact ?? freedom.x : freedom.yExact ?? freedom.y).n === 0n);
}
export function mechanicsPositionCrossProved(authority: MechanicsPointAuthority, vector: Point): boolean {
  return authority.freedoms.every(freedom => cross(freedom, vector).n === 0n);
}
function unknown(id: string): MechanicsPointAuthority { return { freedoms: [{ id: `${id}:x`, x: 1, y: 0 }, { id: `${id}:y`, x: 0, y: 1 }] }; }
function weighted(parts: readonly { authority: MechanicsPointAuthority; mass: number }[], total: number): MechanicsPointAuthority {
  // The centre of points with one common translation has precisely that
  // translation, independent of floating-point summation of the mass weights.
  if (parts.length && parts.every(part => identical(part.authority, parts[0]!.authority))) return parts[0]!.authority;
  const denominator = exact(total);
  return combineMechanicsPointAuthority(parts.map(part => { const mass = exact(part.mass); return { authority: part.authority,
    factor: encoded(ratio(mass.n * denominator.d, mass.d * denominator.n)) }; }));
}
function normalProjection(authority: MechanicsPointAuthority, normal: Point): MechanicsPointAuthority {
  return { freedoms: authority.freedoms.map(value => {
    const projection = sum(product(component(value, "x"), exact(normal.x)), product(component(value, "y"), exact(normal.y)));
    return freedom(value.id, product(exact(normal.x), projection), product(exact(normal.y), projection));
  }).filter(value => component(value, "x").n !== 0n || component(value, "y").n !== 0n) };
}
/** Structural validation only. A candidate's record is never source proof;
 * the authority boundary replaces it with fresh original-source replay. */
export function readMechanicsPositionAuthority(value: unknown): MechanicsPositionAuthority | undefined {
  if (value === undefined) return undefined;
  if (!object(value) || value.schemaVersion !== "mechanics-position-source/v1" || !object(value.points) ||
    !Array.isArray(value.unprovedClaims) || !Array.isArray(value.sourceMismatches) || typeof value.unprovedGeometry !== "boolean" ||
    Object.keys(value).some(key => !["schemaVersion", "points", "unprovedClaims", "unprovedGeometry", "sourceMismatches"].includes(key)) || Object.keys(value.points).length > 128) fail("invalid position certificate");
  const points: Record<string, MechanicsPointAuthority> = {};
  for (const [path, raw] of Object.entries(value.points)) {
    if (path.length > 256 || !object(raw) || Object.keys(raw).some(key => key !== "freedoms") || !Array.isArray(raw.freedoms) || raw.freedoms.length > 64) fail("invalid point freedom");
    const freedoms: MechanicsTranslationFreedom[] = [];
    for (const freedom of raw.freedoms) {
      if (!object(freedom) || Object.keys(freedom).some(key => !["id", "x", "y", "xExact", "yExact"].includes(key)) || typeof freedom.id !== "string" || !freedom.id || freedom.id.length > 256 || !finite(freedom.x) || !finite(freedom.y) ||
        freedom.xExact !== undefined && typeof freedom.xExact !== "string" || freedom.yExact !== undefined && typeof freedom.yExact !== "string") fail("invalid translation freedom");
      if (typeof freedom.xExact === "string") exact(freedom.xExact); if (typeof freedom.yExact === "string") exact(freedom.yExact);
      freedoms.push({ id: freedom.id, x: freedom.x, y: freedom.y, ...(typeof freedom.xExact === "string" ? { xExact: freedom.xExact } : {}), ...(typeof freedom.yExact === "string" ? { yExact: freedom.yExact } : {}) });
    }
    points[path] = { freedoms };
  }
  const strings = (raw: unknown[]): string[] => raw.map(value => { if (typeof value !== "string" || !value || value.length > 256) return fail("invalid claim source record"); return value; });
  if (value.unprovedClaims.length > 128 || value.sourceMismatches.length > 128) fail("position certificate exceeds its bounds");
  return { schemaVersion: "mechanics-position-source/v1", points, unprovedClaims: strings(value.unprovedClaims),
    unprovedGeometry: value.unprovedGeometry, sourceMismatches: strings(value.sourceMismatches) };
}
/** Complete numeric coordinate captions are physical positions, including
 * captions which have lost their quantity id. Symbolic and vector text keep
 * their established guards. */
export function mechanicsPositionCaptionIssue(text: unknown, geometry: MechanicsGeometry): string | undefined {
  if (typeof text !== "string" || text.length > 4096 || geometry.mechanicsValue?.kind === "com_displacement") return undefined;
  const model = modelOf(geometry), value = geometry.mechanicsValue;
  const authority = value?.sourcePositionAuthority ?? model?.sourcePositionAuthority;
  let position: Point | undefined, proof: MechanicsPointAuthority | undefined;
  if (model?.kind === "mass_moments") { position = model.state.centerOfMassSI; proof = authority?.points.position; }
  else if (model?.kind === "rolling_contact") { position = model.state.motion.positionSI; proof = authority?.points.position; }
  else if (model?.kind === "rigid_body_motion" || model?.kind === "rigid_body_kinematics" || model?.kind === "particle_motion") { position = model.state.positionSI; proof = authority?.points.position; }
  else if (model?.kind === "wrench" || model?.kind === "equilibrium") { position = model.source.referencePoint; proof = authority?.points.referencePoint; }
  else if (value) { position = value.physicalPointSI ?? (["point_position", "instantaneous_center"].includes(value.kind) ? value.componentsSI : undefined); proof = authority?.points.position; }
  for (const match of text.normalize("NFKC").matchAll(/\(\s*([^,;()]{1,96}),\s*([^,;()]{1,96})\)\s*(mm|cm|m)\b(?!\s*[/^²³])/gu)) {
    let coordinates: Point;
    try {
      const x = parseMathExpression(match[1]!), y = parseMathExpression(match[2]!);
      if (x.syntaxKey.includes('"kind":"variable"') || y.syntaxKey.includes('"kind":"variable"')) continue;
      const factor = match[3] === "mm" ? 0.001 : match[3] === "cm" ? 0.01 : 1;
      coordinates = { x: x.evaluate(0) * factor, y: y.evaluate(0) * factor };
      if (!finite(coordinates.x) || !finite(coordinates.y)) return "coordinate caption is outside the supported source range";
    } catch { continue; }
    if (!position || !proof || proof.freedoms.length) return "a numeric coordinate caption needs its complete original source position; a model layout gauge is not a measurement";
    const same = (a: number, b: number) => a === b || a !== 0 && b !== 0 && Math.abs(a - b) <= 128 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
    if (!same(position.x, coordinates.x) || !same(position.y, coordinates.y)) return "coordinate caption differs from its independently source-proved physical position";
  }
  return undefined;
}
function modelOf(geometry: MechanicsGeometry | undefined): MechanicsModel | undefined { return geometry?.kind === "point" ? geometry.mechanicsModel : undefined; }
function sourceOwner(step: MechanicsProgramStep, path: string): string {
  let current = path;
  while (current) { if (step.sourceOwners?.[current]) return step.sourceOwners[current]!; const end = current.lastIndexOf("."); current = end < 0 ? "" : current.slice(0, end); }
  return path.startsWith("axis.") || path.startsWith("referencePoint") ? step.axisId : step.ownerId;
}
function partsOwnerExplicit(step: MechanicsProgramStep, index: number): boolean {
  return step.sourceOwners?.[`components.${index}`] !== undefined || step.sourceOwners?.[`components.${index}.mass`] !== undefined;
}
/** Prove source positions and propagate their remaining affine translation
 * freedom. Native geometry supplies arithmetic; only original declarations
 * supply absolute coordinate authority. There is no planner authority input. */
export function deriveMechanicsPositionAuthority(problem: ProblemIR, step: MechanicsProgramStep,
  inputs: ReadonlyMap<string, MechanicsProgramInput>, geometry: MechanicsGeometry,
  dependencies: ReadonlyMap<string, MechanicsGeometry>): MechanicsPositionAuthority | undefined {
  const model = modelOf(geometry);
  if (model && ["central_axial_mass_moments", "axial_mass_moments", "com_motion", "axial_rotation", "angular_impulse"].includes(model.kind)) return undefined;
  if (!model && !geometry.mechanicsValue) return undefined;
  const labels = new Map(problem.entities.map(entity => [entity.id, entity.label ?? entity.id]));
  const admittedIds = new Set(step.evidenceFactIds);
  let evidenceReads = 0;
  const inputFacts = (value: unknown, depth = 0): void => {
    if (++evidenceReads > 8192 || depth > 24) return fail("position source evidence exceeds its bounds");
    if (typeof value === "string") { const input = inputs.get(value); if (input) admittedIds.add(input.factId); }
    else if (Array.isArray(value)) value.forEach(child => inputFacts(child, depth + 1));
    else if (object(value)) Object.values(value).forEach(child => inputFacts(child, depth + 1));
  };
  inputFacts(step.inputs);
  const positiveFact = (fact: ProblemIR["facts"][number]): boolean => {
    if (!["given", "assumption"].includes(fact.kind) || !admittedIds.has(fact.id)) return false;
    const before = problem.question.slice(0, fact.evidence.start), after = problem.question.slice(fact.evidence.end);
    const boundary = [...before.matchAll(/[;!?]|\.(?=\s|$)/gu)].at(-1);
    const end = after.search(/[;!?]|\.(?=\s|$)/u);
    const clause = problem.question.slice(boundary ? boundary.index! + 1 : 0, fact.evidence.end + (end < 0 ? after.length : end));
    const quoted = [...problem.question.matchAll(/"([^"\n]{1,2048})"|“([^”\n]{1,2048})”|(?<![\p{L}\p{N}_])'([^'\n]{1,2048})'(?![\p{L}\p{N}_])/gu)];
    const quoteContainsAssertion = quoted.some(span => span.index! < fact.evidence.end && span.index! + span[0].length > fact.evidence.start &&
      !/^[\p{L}][\p{L}\p{N}_′]{0,63}$/u.test(span[1] ?? span[2] ?? span[3]!));
    return !quoteContainsAssertion && !/\b(?:reported|reportedly|says?|claims?|alleges?|hypothetical(?:ly)?|suppose|imagine|if|unless|maybe|might|may|possible|possibly|not|false|incorrect|unknown|unspecified)\b|\b(?:could|would)\s+(?:be|have|lie|start)\b|\b(?:a|the)\s+(?:report|account|claim|message|note)\s+(?:states?|says?|gives?|indicates?|suggests?|asserts?)\b/iu.test(clause);
  };
  const admitted = problem.facts.filter(positiveFact);
  const original = admitted.map(fact => fact.evidence.quote).join("; ").normalize("NFKC").replace(/−/g, "-")
    .replace(/["“']([\p{L}][\p{L}\p{N}_′]{0,63})["”']/gu, "$1");
  const ownerName = labels.get(step.ownerId) ?? step.ownerId;
  const bodyCentre = (owner: string, body = step.ownerId): boolean => {
    const name = labels.get(owner) ?? owner;
    const bodyName = labels.get(body) ?? body;
    if (owner === body) return true;
    const namedCentre = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(name)}\\s+(?:is|denotes|represents)\\s+(?:the\\s+)?(?:centre|center|COM|centre\\s+of\\s+mass|center\\s+of\\s+mass)\\s+of\\s+${escape(bodyName)}(?![\\p{L}\\p{N}_])`, "iu");
    const located = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(bodyName)}\\s+(?:(?:is\\s+)?(?:located\\s+|positioned\\s+)?at|has\\s+(?:position|location|centre|center)\\s+(?:at\\s+)?|of\\s+[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)\\s+(?:kg|g)\\s+at)\\s+(?:point\\s+)?${escape(name)}(?![\\p{L}\\p{N}_])`, "iu");
    const centralAxis = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(bodyName)}[^;!?]{0,128}\\b(?:central|COM|centre|center)\\s+(?:normal\\s+)?axis\\s+${escape(name)}(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])${escape(name)}[^;!?]{0,128}\\bthrough\\s+(?:the\\s+)?(?:centre|center|COM)\\s+of\\s+${escape(bodyName)}(?![\\p{L}\\p{N}_])`, "iu");
    return namedCentre.test(original) || located.test(original) || owner === step.axisId && centralAxis.test(original);
  };
  const canonical = (owner: string) => bodyCentre(owner) ? `body:${step.ownerId}:centre` : `point:${owner}`;
  const points: Record<string, MechanicsPointAuthority> = {}, blocked = new Set<string>(), mismatches: string[] = [];
  let reads = 0;
  function sourceScalarKnown(raw: unknown, path: string, component: number): boolean {
    if (typeof raw === "string") {
      const input = inputs.get(raw);
      if (!input || !["m", "cm", "mm"].includes(input.unit)) return false;
      const fact = problem.facts.find(fact => fact.id === input.factId);
      if (!fact || fact.kind !== "given" || !positiveFact(fact) || input.ownerId !== sourceOwner(step, path)) { mismatches.push("native position component is not a positive original source measurement for its owner"); return false; }
      if (input.component !== undefined) { if (input.component !== component) mismatches.push("native position component changed its original source tuple coordinate"); return input.component === component; }
      const index = fact.evidence.quote.indexOf(input.sourceExpression);
      const prefix = index < 0 ? "" : fact.evidence.quote.slice(0, index);
      return new RegExp(`\\b${component === 0 ? "x|horizontal|first" : "y|vertical|second"}(?:[- ]coordinate|[- ]position|\\b)[^;!?]*$`, "i").test(prefix);
    }
    if (!object(raw) || raw.constant !== "zero" || typeof raw.factId !== "string") return false;
    const fact = problem.facts.find(fact => fact.id === raw.factId);
    if (!fact || !positiveFact(fact)) return false;
    const owner = labels.get(sourceOwner(step, path)) ?? sourceOwner(step, path);
    const text = fact.evidence.quote.replace(/["“']([\p{L}][\p{L}\p{N}_′]{0,63})["”']/gu, "$1");
    if (/\b(?:not|never)\b/i.test(text)) return false;
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(owner)}\\s+(?:(?:is|starts?|initially|lies?)\\s+){0,3}at\\s+(?:the\\s+)?origin\\b|\\b(?:choose|take|set|put|use)\\s+(?:the\\s+)?origin\\s+(?:at|through)\\s+${escape(owner)}(?![\\p{L}\\p{N}_])|\\borigin\\s+(?:is\\s+)?(?:at|through)\\s+${escape(owner)}(?![\\p{L}\\p{N}_])`, "iu").test(text);
  }
  function provePoint(raw: unknown, path: string, depth = 0): MechanicsPointAuthority {
    if (++reads > 8192 || depth > 24) return fail("source point dependency exceeds its bounds");
    let result: MechanicsPointAuthority;
    if (Array.isArray(raw) && raw.length >= 2) {
      const id = canonical(sourceOwner(step, path));
      result = { freedoms: [0, 1].flatMap(component => sourceScalarKnown(raw[component], `${path}.${component}`, component) ? [] :
        [{ id: `${id}:${component === 0 ? "x" : "y"}`, x: component === 0 ? 1 : 0, y: component === 1 ? 1 : 0 }]) };
    } else if (object(raw) && raw.kind === "midpoint" && Array.isArray(raw.endpoints) && raw.endpoints.length === 2) {
      const a = provePoint(raw.endpoints[0], `${path}.endpoints.0`, depth + 1), b = provePoint(raw.endpoints[1], `${path}.endpoints.1`, depth + 1);
      result = identical(a, b) ? a : combineMechanicsPointAuthority([{ authority: a, factor: 0.5 }, { authority: b, factor: 0.5 }]);
    } else if (object(raw) && raw.kind === "center_of_mass" && typeof raw.reference === "string") {
      result = modelOf(dependencies.get(raw.reference))?.sourcePositionAuthority?.points.position ?? unknown(canonical(sourceOwner(step, path)));
    } else result = unknown(canonical(sourceOwner(step, path)));
    points[path] = result; return result;
  }
  function originalCentre(initial: Point, authority: MechanicsPointAuthority): MechanicsPointAuthority {
    if (!authority.freedoms.length || !bodyCentre(sourceOwner(step, "position"))) return authority;
    const targetOwner = sourceOwner(step, "position"), target = labels.get(targetOwner) ?? targetOwner;
    const factors: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001 };
    const declarations = [...original.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escape(target)}\\s*(?:=|(?:has|is\\s+at)\\s+(?:(?:initial|fixed)\\s+)?(?:position|centre|center)\\s*(?:at\\s*)?|(?:is\\s+)?at)\\s*\\(\\s*([^,;()]{1,96}),\\s*([^,;()]{1,96})\\)\\s*(m|cm|mm)\\b(?!\\s*[/^²³])`, "gu"))];
    let result = authority;
    for (const declaration of declarations) {
      const boundary = [...original.slice(0, declaration.index).matchAll(/[;!?]|\.(?!\d)/gu)].at(-1);
      const prefix = original.slice(boundary ? boundary.index! + boundary[0].length : 0, declaration.index);
      if (/\b(?:final|after)\b|\bat\s+(?:t\s*=\s*)?(?!0(?:\.0*)?\s)(?:\d+(?:\.\d*)?|\.\d+)\s*(?:s|ms)\b/i.test(prefix)) continue;
      try {
        const x = parseMathExpression(declaration[1]!), y = parseMathExpression(declaration[2]!);
        if (x.syntaxKey.includes('"kind":"variable"') || y.syntaxKey.includes('"kind":"variable"')) continue;
        const expected = { x: x.evaluate(0) * factors[declaration[3]!]!, y: y.evaluate(0) * factors[declaration[3]!]! };
        if (!finite(expected.x) || !finite(expected.y)) continue;
        if (initial.x !== expected.x || initial.y !== expected.y) { mismatches.push("native initial centre differs from the original source-given centre"); continue; }
        result = known();
      } catch { /* Unreadable declarations cannot supply position authority. */ }
    }
    return result;
  }
  function contactCentre(rawContact: Record<string, unknown>, path: string, tangent: Point): MechanicsPointAuthority {
    const rawSurface = object(rawContact.surface) ? rawContact.surface : {};
    const declaredSurface = provePoint(rawSurface.point, `${path}.surface.point`), pointOwner = sourceOwner(step, `${path}.surface.point`);
    const surfaceOwner = sourceOwner(step, `${path}.surface`), name = labels.get(pointOwner) ?? pointOwner, surfaceName = labels.get(surfaceOwner) ?? surfaceOwner;
    const membership = pointOwner === surfaceOwner || admitted.some(fact => {
      const text = fact.evidence.quote.replace(/["“']([\p{L}][\p{L}\p{N}_′]{0,63})["”']/gu, "$1");
      return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(surfaceName)}\\s+(?:contains|has\\s+(?:the\\s+)?point|passes\\s+through|goes\\s+through)\\s+${escape(name)}(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])${escape(name)}(?:\\s*=\\s*\\([^()]*\\)\\s*(?:mm|cm|m))?\\s+(?:is|lies)\\s+(?:(?:a|the|initial|contact)\\s+)*(?:point\\s+)?on\\s+${escape(surfaceName)}(?![\\p{L}\\p{N}_])`, "iu").test(text);
    });
    const surface = membership ? declaredSurface : unknown(`plane:${surfaceOwner}`);
    const actualContact = admitted.some(fact => names(fact.evidence.quote, name) && names(fact.evidence.quote, ownerName) &&
      new RegExp(`${escape(name)}\\s+(?:is|denotes)\\s+(?:(?:the|initial)\\s+)?contact\\s+point|contact\\s+point\\s+${escape(name)}\\b`, "iu").test(fact.evidence.quote));
    if (actualContact && membership) return surface;
    const normal = { x: -tangent.y, y: tangent.x };
    return combineMechanicsPointAuthority([{ authority: normalProjection(surface, normal), factor: 1 },
      { authority: { freedoms: [{ id: `body:${step.ownerId}:contact-tangent`, ...tangent }] }, factor: 1 }]);
  }
  function coordinateClaims(authority: MechanicsPointAuthority, x: string, y: string): void {
    if (!mechanicsPositionComponentProved(authority, "x")) blocked.add(x);
    if (!mechanicsPositionComponentProved(authority, "y")) blocked.add(y);
  }
  if (model?.kind === "mass_moments") {
    const components = Array.isArray(step.inputs.components) ? step.inputs.components : [];
    const parts = model.source.components.map((component, index) => {
      const raw = object(components[index]) ? components[index] : {};
      const componentOwner = sourceOwner(step, `components.${index}.mass`), centreOwner = sourceOwner(step, `components.${index}.center`);
      const declaredPart = partsOwnerExplicit(step, index) || components.length === 1;
      const authority = !declaredPart || !bodyCentre(centreOwner, componentOwner) ? unknown(`part:${step.id}:${index}:${componentOwner}:centre`) : Array.isArray(raw.endpoints) && raw.endpoints.length === 2
        ? weighted(raw.endpoints.map((value, endpoint) => ({ authority: provePoint(value, `components.${index}.endpoints.${endpoint}`), mass: 1 })), 2)
        : provePoint(raw.center, `components.${index}.center`);
      points[`components.${index}.center`] = authority;
      return { authority, mass: component.mass * (component.operation === "remove" ? -1 : 1) };
    });
    points.position = weighted(parts, model.state.massSI);
    const axis = object(step.inputs.axis) ? step.inputs.axis : {};
    points.referencePoint = provePoint(axis.point, "axis.point");
    coordinateClaims(points.position, "x_CM", "y_CM");
    const relative = parts.map(part => differenceMechanicsPointAuthority(part.authority, points.position!));
    if (relative.some(authority => authority.freedoms.length)) ["I_CM", "I_x", "I_y", "I_z"].forEach(symbol => blocked.add(symbol));
    const direction = model.source.axis.direction;
    if (parts.some(part => { const relative = differenceMechanicsPointAuthority(part.authority, points.referencePoint!); return !mechanicsPositionCrossProved(relative, direction) ||
      direction.z !== 0 && relative.freedoms.some(value => component(value, "x").n !== 0n || component(value, "y").n !== 0n); })) ["I", "k"].forEach(symbol => blocked.add(symbol));
  } else if (model && ["rigid_body_motion", "rigid_body_kinematics", "particle_motion"].includes(model.kind)) {
    const source = model.source;
    if (!("position" in source)) return undefined;
    let authority: MechanicsPointAuthority;
    const contact = "circularContact" in source ? source.circularContact : undefined;
    const boundary = "bodyGeometry" in source ? source.bodyGeometry : undefined;
    const rawContact = object(step.inputs.circularContact) ? step.inputs.circularContact : undefined;
    const rawBoundary = object(step.inputs.bodyGeometry) ? step.inputs.bodyGeometry : undefined;
    const collision = "derivation" in source && source.derivation?.kind === "sticking_collision" ? source.derivation : undefined;
    if (step.inputs.position !== undefined) authority = bodyCentre(sourceOwner(step, "position")) ? provePoint(step.inputs.position, "position") :
      contact && rawContact ? contactCentre(rawContact, "circularContact", contact.surface.tangent) : unknown(`body:${step.ownerId}:centre`);
    else if (collision) {
      const rawDerivation = object(step.inputs.derivation) ? step.inputs.derivation : {};
      const bodies = Array.isArray(rawDerivation.bodies) ? rawDerivation.bodies : [];
      authority = weighted(collision.bodies.map((body, index) => ({ authority: provePoint(object(bodies[index]) ? bodies[index].position : undefined, `derivation.bodies.${index}.position`), mass: body.mass })), collision.bodies.reduce((sum, body) => sum + body.mass, 0));
    } else if (contact && rawContact) authority = contactCentre(rawContact, "circularContact", contact.surface.tangent);
    else if (boundary?.center && rawBoundary?.center !== undefined) authority = provePoint(rawBoundary.center, "bodyGeometry.center");
    else if (boundary?.endpoints && Array.isArray(rawBoundary?.endpoints)) authority = weighted(rawBoundary.endpoints.map((value, index) => ({ authority: provePoint(value, `bodyGeometry.endpoints.${index}`), mass: 1 })), 2);
    else authority = unknown(canonical(sourceOwner(step, "position")));
    points.position = originalCentre(source.position, authority);
    if ("referencePoint" in source) points.referencePoint = provePoint(step.inputs.referencePoint, "referencePoint");
    coordinateClaims(points.position, "x_CM", "y_CM");
    if (model.kind !== "rigid_body_kinematics" && "momentumSI" in model.state && points.referencePoint &&
      (!model.state.momentumSI || !mechanicsPositionCrossProved(differenceMechanicsPointAuthority(points.position, points.referencePoint), model.state.momentumSI))) blocked.add("L");
  } else if (model?.kind === "rolling_contact") {
    const upstream = modelOf(dependencies.get(String(step.inputs.motion)))?.sourcePositionAuthority;
    Object.assign(points, upstream?.points ?? {});
    points.position ??= unknown(canonical(sourceOwner(step, "position")));
    points.referencePoint ??= unknown(canonical(sourceOwner(step, "referencePoint")));
    coordinateClaims(points.position, "x_CM", "y_CM");
    if (!mechanicsPositionCrossProved(differenceMechanicsPointAuthority(points.position, points.referencePoint), model.state.motion.momentumSI)) blocked.add("L");
    mismatches.push(...upstream?.sourceMismatches ?? []);
  } else if (model?.kind === "wrench" || model?.kind === "equilibrium") {
    points.referencePoint = provePoint(step.inputs.referencePoint, "referencePoint");
    const rawForces = Array.isArray(step.inputs.forces) ? step.inputs.forces : [];
    const torqueFreedom = new Map<string, Rational>();
    model.source.forces.forEach((force, index) => {
      const raw = object(rawForces[index]) ? rawForces[index] : {};
      const authority = provePoint(raw.point, `forces.${index}.point`);
      for (const freedom of differenceMechanicsPointAuthority(authority, points.referencePoint!).freedoms)
        torqueFreedom.set(freedom.id, sum(torqueFreedom.get(freedom.id) ?? exact(0), cross(freedom, force.force)));
    });
    if ([...torqueFreedom.values()].some(value => value.n !== 0n)) blocked.add("tau");
  } else if (!model && geometry.mechanicsValue) {
    const parent = modelOf(dependencies.get(String(step.inputs.motion ?? step.inputs.distribution)));
    if (parent && ["central_axial_mass_moments", "axial_mass_moments", "com_motion", "axial_rotation", "angular_impulse"].includes(parent.kind)) return undefined;
    const inherited = parent?.sourcePositionAuthority;
    Object.assign(points, inherited?.points ?? {});
    mismatches.push(...inherited?.sourceMismatches ?? []);
    const value = geometry.mechanicsValue;
    const position = points.position ?? unknown(canonical(sourceOwner(step, "position")));
    const definition = object(step.inputs.pointDefinition) ? step.inputs.pointDefinition : undefined;
    if (definition?.kind === "position") points.position = provePoint(definition.point, "pointDefinition.point");
    else points.position = position;
    if (value.kind === "point_position") coordinateClaims(points.position, "x", "y");
    if (value.kind === "instantaneous_center") coordinateClaims(points.position, "x_IC", "y_IC");
    if (["inertia", "central_inertia", "gyration_radius", "inertia_x", "inertia_y", "inertia_z"].includes(value.kind))
      for (const claim of value.claims) if (inherited?.unprovedClaims.includes(claim.symbol)) blocked.add(claim.symbol);
    if (value.kind === "angular_momentum" && inherited?.unprovedClaims.includes("L")) blocked.add("L");
    if (value.kind === "net_torque") {
      const about = step.inputs.about === undefined ? points.referencePoint : provePoint(step.inputs.about, "about");
      const state = parent?.kind === "rolling_contact" ? parent.state.motion : parent && "wrenchSI" in parent.state ? parent.state : undefined;
      if (!about || !state?.wrenchSI || !mechanicsPositionCrossProved(differenceMechanicsPointAuthority(points.referencePoint ?? position, about), state.wrenchSI.forceSI) || inherited?.unprovedClaims.includes("tau")) blocked.add("tau");
    }
    const parentState = parent?.kind === "rolling_contact" ? parent.state.motion : parent?.state;
    if (definition?.kind === "position" && /(?:velocity|acceleration)$/.test(value.kind) && parentState && "angularVelocitySI" in parentState) {
      const offsetFreedom = differenceMechanicsPointAuthority(points.position, position);
      const omega = parentState.angularVelocitySI;
      const alpha = "angularAccelerationSI" in parentState ? parentState.angularAccelerationSI ?? 0 : 0;
      const velocity = value.kind.endsWith("velocity");
      const freedoms = offsetFreedom.freedoms.map(value => freedom(value.id,
        velocity ? negative(product(exact(omega), component(value, "y"))) : negative(sum(product(exact(alpha), component(value, "y")), product(product(exact(omega), exact(omega)), component(value, "x")))),
        velocity ? product(exact(omega), component(value, "x")) : sum(product(exact(alpha), component(value, "x")), negative(product(product(exact(omega), exact(omega)), component(value, "y"))))));
      const effect = { freedoms };
      if (!mechanicsPositionComponentProved(effect, "x")) blocked.add(velocity ? "vx" : "ax");
      if (!mechanicsPositionComponentProved(effect, "y")) blocked.add(velocity ? "vy" : "ay");
      if (freedoms.some(value => component(value, "x").n !== 0n || component(value, "y").n !== 0n)) blocked.add(velocity ? "v" : "a");
    }
  }
  if (!model && !geometry.mechanicsValue) return undefined;
  return { schemaVersion: "mechanics-position-source/v1", points, unprovedClaims: [...blocked].sort(),
    unprovedGeometry: geometry.kind === "path" && [...blocked].some(symbol => /^(?:v|a)(?:x|y)?$/.test(symbol)), sourceMismatches: [...new Set(mismatches)] };
}
