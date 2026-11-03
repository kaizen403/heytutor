/**
 * Contact truth: a body in contact with a surface lies on the surface's free
 * side, and a string does not pass through it.
 *
 * Proofs on a qualitative figure certify display geometry only, so a block drawn
 * inside its wedge or across its floor passed every assertion it made. These
 * rules read the compiled geometry and the document's own surface and body
 * words, so they apply to any figure with a surface and never to one topic.
 *
 * The word lists only ever decide whether to refuse, never what draws: a miss
 * behaves as if this check did not exist. The stem is read only to withhold a
 * refusal. The rules stay silent without positive evidence of a surface, a body
 * and, for the side rule, which side is free. Saved boards compile without
 * these rules, so an old figure still reopens.
 */
import type { SceneDocument, SceneEntity, SceneIssue } from "../types";
import { isVerifiedPartsEnabled } from "./yieldPolicy";

type Point = { x: number; y: number };
type Shape = { kind: string; points?: Point[]; closed?: boolean; center?: Point; radius?: number; spaceLine?: unknown; spaceSegment?: unknown };
type Line = { id: string; a: Point; b: Point; length: number; role: string };
type Body = { id: string; role: string; points: Point[]; circle?: { center: Point; radius: number } };
type Solid = { id: string; role: string; points: Point[] };

const QUALIFIED_PLANE = String.raw`\b(?:inclined|rough|smooth|frictionless|sloping|tilted)\s+plane\b`;
const SURFACE_WORDS = new RegExp(String.raw`\b(?:incline|inclined|ramp|slope|wedge|ground|floor|table|tabletop|road|bank|banked|track|conveyor|belt|platform|shelf|bench|surface|wall|ceiling|roof|hill|desk|deck|bridge|plank|cliff|ledge|mountain|pavement|runway)\b|${QUALIFIED_PLANE}`, "i");
const NOT_SURFACE_WORDS = /\b(?:sand|mud|soil|pit|well|trench|tunnel|water|liquid|fluid|oil|mercury|meniscus|sea|lake|gauss\w*|equipotential|mirror|lens|optical|refract\w*|reflect\w*|interface|medium|glass|film|capacitor|plates?|sheet|conduct\w*|charge\w*|metal|coil|magnet\w*|wave\w*|image|focal|principal|axis|axes|normal|tangent|vector|field|rays?|string|rope|cord|thread|equatorial|state|energy|reference|sectional|cross|horizon|line of|path|trajectory|dimension|diameter|radius|chord|height|depth|distance|length|width|parallel|perpendicular|direction|along|above|below|to the|cutting|diagonal|molecular|infinite|imaginary|section|plane of|free surface|piston|partition|surface contact|contact geometry|edge|centre|center|lane|river|far|ladder|rod|strut|bar|against|cone|conical|lateral|slant|hash|periodic|truth|lookup|contingency|frequency|data|row|column|circuit|node|terminal|wheatstone|metre|meter|galvanometer|ground\s+(?:rail|wire|node|terminal|symbol|bus))\b|\bin\s+(?:the\s+|its\s+)?(?:\w+\s+)?plane\b/i;
const SOLID_WORDS = new RegExp(String.raw`\b(?:wedge|incline|inclined|ramp|slope|ground|floor|table|tabletop|platform|bench|road)\b|${QUALIFIED_PLANE}`, "i");
const WEDGE_WORD = /\bwedge\b/i;
/** Nothing rests under these. A shelf, a table or a platform has a free underside, so it makes no such claim. */
const SOLID_BELOW_WORDS = new RegExp(String.raw`\b(?:incline|inclined|ramp|slope|wedge|ground|floor|road|bank|banked)\b|${QUALIFIED_PLANE}`, "i");
const BODY_WORDS = /\b(?:block|blocks|box|body|bodies|mass|masses|crate|cube|cart|trolley|car|vehicle|truck|bus|ball|sphere|cylinder|disc|disk|hoop|ring|wheel|object|particle|load|bob|sled|sledge|brick|stone|book|person|man|woman|boy|girl|barrel|drum|trunk|suitcase|package|container|sack|bag|log|train|wagon|bike|bicycle|motorcycle|scooter|locomotive|m[12]?)\b/i;
const NOT_BODY_WORDS = /\b(?:glass|prism|slab|gas|imaginary|benzene|molecule|pulley|support|clamp|hole|region|shaded|area|contact|marker|symbol|charge\w*|coil|core|magnet\w*|capacitor|resistor|cell|battery|lamp|bulb|switch|diode|ammeter|voltmeter|galvanometer|planet|sun|earth|moon|satellite|nucleus|atom|ion|electron|proton|gaussian|field)\b/i;
const STRING_WORDS = /\b(?:string|rope|thread|cord|chain)\b/i;
const NOT_STRING_WORDS = /\b(?:spinal|electric|power|carbon|polymer|side|food|charge\w*|wire)\b/i;
const NOT_A_FACE_WORDS = /\b(?:ladder|rod|beam|bar|plank|strut|pillar|post|support|column)\b/i;
const NORMAL_WORDS = /\bnormal\b/i;
const FORCE_ON_SURFACE = /\b(?:on|onto|against)\s+(?:the\s+)?(?:surface|plane|incline|wedge|table|ground|floor|wall|ramp)\b|\bby\s+(?:the\s+)?(?:block|body|mass|box|ball|object)\b/i;
// Everything below reads the stem or the roles only to withhold a refusal, so a miss or a false match behaves as if this check did not exist.
const ROLE_OPENING_WORDS = /\b(?:hole|opening|slit|aperture|slot|tunnel|tube)\b/i;
const OPENING_WORDS = /\b(?:hole|opening|slit|aperture|slot|tunnel|borewell|well|pit|mine|mineshaft|tube|pipe|eyelet|ditch|gap|kuan|kuen|kuwan|chhed|chhid|surang|surakh|pass(?:es|ing)?\s+through)\b|कुआँ|कुएँ|कुएं|कुंआ|छेद|छिद्र|सुरंग/i;
const SUNK_WORDS = /\b(?:sunk|sinks?|sinking|embedded|buried|immersed|submerged|dipped|floats?|floating|penetrat\w*|inscribed|of\s+its\s+volume|driven\s+(?:into|in)|fixed\s+(?:into|in)\s+(?:a|an|the)|stuck\s+in|press(?:es|ed)?\s+into|tunnel|borewell|well|pit|mine|mineshaft|trench|ditch|gap|pipe|hole|cavity|cuts?|cut\s+by|section|top\s+view|plan\s+view|(?:seen|viewed)\s+from\s+above|kuan|kuen|kuwan|chhed|chhid|surang|surakh|tair\w*)\b|कुआँ|कुएँ|कुएं|कुंआ|छेद|छिद्र|सुरंग|तैर/i;
const UNDERSIDE_WORDS = /\b(?:underside|underneath|beneath|between|overhang\w*|propped|props?|rollers?|on\s+wheels|hung|stuck\s+to|pressed\s+(?:up\s+)?against|under\s+(?:a|an|the)\s+(?:\w+\s+)?(?:ramp|bridge|shelf|table|floor|road|slope|incline|wedge|roof))\b/i;
/** A contact figure shows a force or a string, or its stem is about mechanics. Without any of them the words proved nothing. */
const FORCE_WORDS = /\b(?:weight|normal|friction|tension|force|thrust|drag|reaction|acceleration|velocity|mg)\b/i;
const MECHANICS_STEM = /\b(?:force|friction\w*|incline\w*|ramp|slope|slid\w*|roll\w*|pull\w*|push\w*|mass(?:es)?|kg|newtons?|pulley|string|rope|acceler\w*|decelerat\w*|velocity|speed|weight|gravity|rests?\s+on|resting\s+on|lift|elevator|tension|momentum|collision|collides?|torque|banked|skid\w*|brak\w*)\b/i;

const STRADDLE_SHARE = 0.12;
const TOUCH_SHARE = 0.08;
const MARKER_SHARE = 0.05;
/** A small ball on a line reads as a position on it, more readily than a small box does. */
const BALL_MARKER_SHARE = 0.1;
const ALONG_SHARE = 0.25;
const SAME_POINT = 1e-6;
const END_SHARE = 0.08;
const NORMAL_TOLERANCE_DEG = 12;
const STEEPEST_RESTING_DEG = 80;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const words = (entity: SceneEntity) => `${entity.role ?? ""}`;
const stemWithoutIdioms = (text: string) => text.replace(/\b(?:as\s+well|well[-\s](?:labell?ed|known|defined|drawn|marked|shown))\b/gi, " ");
const closedPath = (points: Point[], closed?: boolean) => Boolean(closed) || (points.length >= 4 && dist(points[0]!, points.at(-1)!) <= SAME_POINT);

function maxOf(values: number[]): number {
  let result = -Infinity;
  for (const value of values) if (value > result) result = value;
  return result;
}
function minOf(values: number[]): number {
  let result = Infinity;
  for (const value of values) if (value < result) result = value;
  return result;
}

/** The diagonal of the bounding box. */
function extentOf(points: Point[]): number {
  return Math.hypot(maxOf(points.map((p) => p.x)) - minOf(points.map((p) => p.x)), maxOf(points.map((p) => p.y)) - minOf(points.map((p) => p.y)));
}

function straightLine(entity: SceneEntity, shape: Shape | undefined): Line | null {
  if (entity.kind !== "segment" && entity.kind !== "line" && entity.kind !== "polyline") return null;
  if (shape?.kind !== "path" || shape.spaceLine || shape.spaceSegment || !shape.points || shape.points.length < 2) return null;
  if (closedPath(shape.points, shape.closed)) return null;
  const a = shape.points[0]!, b = shape.points.at(-1)!;
  const length = dist(a, b);
  if (!(length > SAME_POINT)) return null;
  const straight = shape.points.every((p) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / length <= length * 1e-6);
  return straight ? { id: entity.id, a, b, length, role: words(entity) } : null;
}

const signedDistance = (line: Line, p: Point) => ((p.y - line.a.y) * (line.b.x - line.a.x) - (p.x - line.a.x) * (line.b.y - line.a.y)) / line.length;
const along = (line: Line, p: Point) => ((p.x - line.a.x) * (line.b.x - line.a.x) + (p.y - line.a.y) * (line.b.y - line.a.y)) / (line.length * line.length);
/** Which way is up, as a sign of signedDistance. Null on a wall, where gravity says nothing. */
function upSide(line: Line): number | null {
  const slopeDeg = (Math.atan2(Math.abs(line.b.y - line.a.y), Math.abs(line.b.x - line.a.x)) * 180) / Math.PI;
  if (slopeDeg > STEEPEST_RESTING_DEG) return null;
  return line.b.x >= line.a.x ? 1 : -1;
}

function circlePoints(center: Point, radius: number): Point[] {
  return Array.from({ length: 16 }, (_, i) => ({
    x: center.x + radius * Math.cos((i * Math.PI) / 8),
    y: center.y + radius * Math.sin((i * Math.PI) / 8),
  }));
}

function bodyOf(entity: SceneEntity, shape: Shape | undefined): Body | null {
  if (!BODY_WORDS.test(words(entity)) || NOT_BODY_WORDS.test(words(entity))) return null;
  if (shape?.kind === "circle" && shape.center && typeof shape.radius === "number") {
    return { id: entity.id, role: words(entity), points: circlePoints(shape.center, shape.radius), circle: { center: shape.center, radius: shape.radius } };
  }
  if (shape?.kind === "path" && shape.points && shape.points.length >= 3 && closedPath(shape.points, shape.closed)) return { id: entity.id, role: words(entity), points: shape.points };
  return null;
}

function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const span = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = span > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / span)) : 0;
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

function centroid(points: Point[]): Point {
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
}

/** Both ends of the line within the body: a truck's floor, a cylinder's partition. */
function lineInsideBody(line: Line, body: Body): boolean {
  const tolerance = extentOf(body.points) * 0.02;
  const within = (p: Point) => body.circle
    ? dist(p, body.circle.center) <= body.circle.radius + tolerance
    : insidePolygon(p, body.points) || body.points.some((a, i) => distanceToSegment(p, a, body.points[(i + 1) % body.points.length]!) <= tolerance);
  return within(line.a) && within(line.b);
}

/** Three straight lines closing below a slanted surface are a wedge seen from the side, so they enclose a solid. */
function wedgeUnderSurface(surface: Line, lines: Line[]): Solid | null {
  // An attic's roof closes a triangle of air.
  const up = upSide(surface);
  const slopeDeg = (Math.atan2(Math.abs(surface.b.y - surface.a.y), Math.abs(surface.b.x - surface.a.x)) * 180) / Math.PI;
  if (up === null || slopeDeg < 5) return null;
  const near = (p: Point, q: Point) => dist(p, q) <= surface.length * 1e-3;
  const closing = lines.filter((line) => line.id !== surface.id && !STRING_WORDS.test(line.role) && !NOT_A_FACE_WORDS.test(line.role));
  for (const first of closing) {
    const apex = near(first.a, surface.a) ? first.b : near(first.b, surface.a) ? first.a : null;
    if (!apex) continue;
    for (const second of closing) {
      if (second.id === first.id) continue;
      const closes = (near(second.a, surface.b) && near(second.b, apex)) || (near(second.b, surface.b) && near(second.a, apex));
      if (!closes) continue;
      const side = signedDistance(surface, apex);
      if (Math.abs(side) > surface.length * 1e-3 && Math.sign(side) === -up) return { id: surface.id, role: surface.role, points: [surface.a, surface.b, apex] };
    }
  }
  return null;
}

/** A reaction whose tail is on this body points away from the surface. Only for a surface gravity says nothing about. */
function freeSideFromNormal(surface: Line, body: Body, contacts: Line[], document: SceneDocument, geometry: ReadonlyMap<string, unknown>): number | null {
  // With two touching faces in line, either could supply the reaction, so the arrow names neither side.
  const inLine = (other: Line) => Math.abs((other.b.x - other.a.x) * (surface.b.x - surface.a.x) + (other.b.y - other.a.y) * (surface.b.y - surface.a.y)) / (other.length * surface.length);
  // Two parts of one wall share a line, so they are one face.
  const apart = (other: Line) => Math.abs(signedDistance(surface, other.a)) > surface.length * 0.02;
  if (contacts.some((other) => other.id !== surface.id && apart(other) && inLine(other) >= Math.cos((NORMAL_TOLERANCE_DEG * Math.PI) / 180))) return null;
  const reach = extentOf(body.points) * 0.1;
  let side: number | null = null;
  for (const entity of document.entities) {
    if (entity.kind !== "vector" || !NORMAL_WORDS.test(words(entity)) || FORCE_ON_SURFACE.test(words(entity))) continue;
    const shape = geometry.get(entity.id) as Shape | undefined;
    if (shape?.kind !== "path" || !shape.points || shape.points.length < 2) continue;
    const a = shape.points[0]!, b = shape.points.at(-1)!;
    const length = dist(a, b);
    if (!(length > SAME_POINT)) continue;
    const onBody = body.circle
      ? dist(a, body.circle.center) <= body.circle.radius + reach
      : insidePolygon(a, body.points) || body.points.some((p, i) => distanceToSegment(a, p, body.points[(i + 1) % body.points.length]!) <= reach);
    if (!onBody) continue;
    const across = ((b.y - a.y) * (surface.b.x - surface.a.x) - (b.x - a.x) * (surface.b.y - surface.a.y)) / (surface.length * length);
    if (Math.abs(across) < Math.cos((NORMAL_TOLERANCE_DEG * Math.PI) / 180)) continue;
    // A block between two walls has a reaction from each, so neither names the free side.
    if (side !== null && side !== Math.sign(across)) return null;
    side = Math.sign(across);
  }
  return side;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return false;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
  // A pulley clamped at a table's edge sends the string down just inside the end of the drawn line.
  return t > END_SHARE && t < 1 - END_SHARE && u > END_SHARE && u < 1 - END_SHARE;
}

function insideAlong(line: Line, circle: { center: Point; radius: number }): boolean {
  const at = along(line, circle.center), margin = circle.radius / line.length;
  return at >= margin && at <= 1 - margin;
}

/** The drawn line itself, not its extension past either end, enters the body. */
function segmentEntersBody(line: Line, body: Body): boolean {
  if (body.circle) return distanceToSegment(body.circle.center, line.a, line.b) < body.circle.radius;
  if (insidePolygon(line.a, body.points) || insidePolygon(line.b, body.points)) return true;
  return body.points.some((a, i) => {
    const b = body.points[(i + 1) % body.points.length]!;
    const rx = line.b.x - line.a.x, ry = line.b.y - line.a.y, sx = b.x - a.x, sy = b.y - a.y;
    const denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) < 1e-12) return false;
    const t = ((a.x - line.a.x) * sy - (a.y - line.a.y) * sx) / denominator;
    const u = ((a.x - line.a.x) * ry - (a.y - line.a.y) * rx) / denominator;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  });
}

/** Which side of the drawn line the body rests on, or null. A corner near only the line's extension is not touching it. */
function restingSide(surface: Line, body: Body): number | null {
  const params = body.points.map((p) => along(surface, p));
  const lo = minOf(params), hi = maxOf(params);
  if (!(hi > lo) || Math.min(hi, 1) - Math.max(lo, 0) < (hi - lo) * ALONG_SHARE || straddles(surface, body)) return null;
  const signed = body.points.map((p) => signedDistance(surface, p));
  const above = Math.max(0, maxOf(signed)), below = Math.max(0, -minOf(signed));
  const thickness = above + below;
  if (!(thickness > SAME_POINT)) return null;
  const side = above >= below ? 1 : -1;
  if (body.circle) {
    const at = along(surface, body.circle.center);
    return at >= 0 && at <= 1 && Math.abs(Math.abs(signedDistance(surface, body.circle.center)) - body.circle.radius) <= thickness * TOUCH_SHARE ? side : null;
  }
  const near = params.filter((_, i) => Math.abs(signed[i]!) <= thickness * TOUCH_SHARE);
  return near.length > 0 && minOf(near) <= 1 && maxOf(near) >= 0 ? side : null;
}

/** The line runs through the body with a real share of it on each side. */
function straddles(line: Line, body: Body): boolean {
  if (!segmentEntersBody(line, body)) return false;
  const params = body.points.map((p) => along(line, p));
  const lo = minOf(params), hi = maxOf(params);
  if (!(hi > lo) || Math.min(hi, 1) - Math.max(lo, 0) < (hi - lo) * ALONG_SHARE) return false;
  const signed = body.points.map((p) => signedDistance(line, p));
  const above = Math.max(0, maxOf(signed)), below = Math.max(0, -minOf(signed));
  const thickness = above + below;
  return thickness > SAME_POINT && Math.min(above, below) > thickness * STRADDLE_SHARE;
}

/**
 * The compiler fits each unconnected part of a figure into its own slot when each has one reveal group of its own, so
 * world coordinates compare nothing across them. This mirrors `createEntityTransformPlan`'s packing decision.
 */
function panels(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): (a: string, b: string) => boolean {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const collect = (value: unknown, visit: (text: string) => void): void => {
    if (typeof value === "string") visit(value);
    else if (Array.isArray(value)) value.forEach((item) => collect(item, visit));
    else if (value && typeof value === "object") Object.values(value).forEach((item) => collect(item, visit));
  };
  for (const construction of document.constructions) {
    const ids = construction.outputs.filter((id) => geometry.has(id));
    collect(construction.inputs, (id) => { if (geometry.has(id)) ids.push(id); });
    ids.slice(1).forEach((id) => { if (find(ids[0]!) !== find(id)) parent.set(find(id), find(ids[0]!)); });
  }
  const groupOf = new Map(document.revealGroups.flatMap((group) => group.entityIds.map((id) => [id, group.id] as const)));
  const groupsByRoot = new Map<string, Set<string>>();
  for (const [id, group] of groupOf) {
    if (!geometry.has(id)) continue;
    const root = find(id);
    groupsByRoot.set(root, (groupsByRoot.get(root) ?? new Set()).add(group));
  }
  const allGroups = [...groupsByRoot.values()].flatMap((groups) => [...groups]);
  const verifiedParts = isVerifiedPartsEnabled(document);
  const joined = document.assertions.some((assertion) => (verifiedParts || (assertion.predicate === "connected" && assertion.expected !== false)) &&
    new Set(assertion.entities.filter((id) => geometry.has(id)).map(find)).size > 1);
  const hasAxes = verifiedParts && [...geometry.values()].some((value) => (value as Shape).kind === "axes");
  const packed = document.source.synthesizedDsa !== true && groupsByRoot.size > 1 && !joined && !hasAxes &&
    [...groupsByRoot.values()].every((groups) => groups.size === 1) && new Set(allGroups).size === allGroups.length;
  return (a, b) => !packed || find(a) === find(b);
}

export function validateContactTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
  if (document.visualDecision?.mode !== "scene") return [];
  const hatched = new Set((document.annotations ?? []).filter((a) => a.kind === "hatch").flatMap((a) => a.targetIds ?? []));
  const shape = (id: string) => geometry.get(id) as Shape | undefined;
  const allLines = document.entities.flatMap((e) => { const line = straightLine(e, shape(e.id)); return line ? [line] : []; });
  const surfaces = allLines.filter((line) => !NOT_SURFACE_WORDS.test(line.role) && (SURFACE_WORDS.test(line.role) || hatched.has(line.id)));
  const wedges = new Map(surfaces.filter((surface) => SOLID_BELOW_WORDS.test(surface.role) || hatched.has(surface.id)).flatMap((surface) => { const wedge = wedgeUnderSurface(surface, allLines); return wedge ? [[surface.id, wedge] as const] : []; }));
  const solids: Solid[] = [...wedges.values(), ...document.entities.flatMap((e) => {
    const value = shape(e.id);
    const named = SOLID_WORDS.test(words(e)) && !NOT_SURFACE_WORDS.test(words(e)) && (WEDGE_WORD.test(words(e)) || !BODY_WORDS.test(words(e)));
    return named && value?.kind === "path" && value.points && value.points.length >= 3 && closedPath(value.points, value.closed)
      ? [{ id: e.id, role: words(e), points: value.points }]
      : [];
  })];
  const bodies = document.entities.flatMap((e) => { const body = bodyOf(e, shape(e.id)); return body ? [body] : []; });
  const strings = document.entities.filter((e) => STRING_WORDS.test(words(e)) && !NOT_STRING_WORDS.test(words(e))).flatMap((e) => {
    const value = shape(e.id);
    return value?.kind === "path" && !value.closed && value.points && value.points.length >= 2 ? [{ id: e.id, points: value.points }] : [];
  });
  const question = stemWithoutIdioms(typeof document.source?.question === "string" ? document.source.question : "");
  const roleText = document.entities.map(words).join(" ");
  const shownForce = document.entities.some((e) => e.kind === "vector" && FORCE_WORDS.test(`${words(e)} ${e.label ?? ""}`));
  if (!shownForce && strings.length === 0 && !MECHANICS_STEM.test(question)) return [];
  const statedSunk = SUNK_WORDS.test(question);
  const samePanel = panels(document, geometry);
  const statedUnderside = UNDERSIDE_WORDS.test(question);
  const issues: SceneIssue[] = [];
  const fail = (code: string, ids: string[], message: string) => issues.push({ code, severity: "fatal", failureKind: "truth", entityIds: ids, message });

  for (const body of statedSunk ? [] : bodies) {
    const extent = extentOf(body.points);
    if (!(extent > SAME_POINT)) continue;
    const inPanel = surfaces.filter((surface) => samePanel(surface.id, body.id));
    const contacts = inPanel.filter((surface) => restingSide(surface, body) !== null);
    for (const surface of inPanel) {
      // A dot marking a particle is a position, not an extended body lying across the line.
      if (extent <= surface.length * (body.circle ? BALL_MARKER_SHARE : MARKER_SHARE)) continue;
      // A ball at a line's end sits at the launch point or the table's edge, not across the line.
      if (body.circle && !insideAlong(surface, body.circle)) continue;
      if (lineInsideBody(surface, body)) continue;
      if (straddles(surface, body)) {
        fail("body_straddles_surface", [body.id, surface.id],
          `${body.id} (${body.role}) lies across ${surface.id} (${surface.role}): the surface runs through the body. Keep both, and move the body so one face or one tangent point rests on the surface and the rest of it is on one side, or say in the question that it is sunk.`);
        continue;
      }
      const side = restingSide(surface, body);
      if (side === null) continue;
      const up = upSide(surface);
      const fromAbove = up !== null && SOLID_BELOW_WORDS.test(surface.role) && !statedUnderside ? up : null;
      const free = fromAbove ?? (up === null || !SOLID_BELOW_WORDS.test(surface.role) ? freeSideFromNormal(surface, body, contacts, document, geometry) : null);
      if (free !== null && side !== free) {
        fail("body_inside_surface", [body.id, surface.id],
          `${body.id} (${body.role}) touches ${surface.id} (${surface.role}) from its solid side, so the body is drawn inside the surface. Keep both, and move every corner of the body to the free side, with its contact face still on the surface.`);
      }
    }
    for (const solid of solids) {
      if (solid.id === body.id || !samePanel(solid.id, body.id) || extent <= extentOf(solid.points) * MARKER_SHARE) continue;
      const edges = solid.points.map((a, i): Line => {
        const b = solid.points[(i + 1) % solid.points.length]!;
        return { id: solid.id, a, b, length: dist(a, b), role: solid.role };
      }).filter((edge) => edge.length > SAME_POINT);
      if (insidePolygon(centroid(body.points), solid.points) || edges.some((edge) => straddles(edge, body))) {
        fail("body_inside_surface", [body.id, solid.id],
          `${body.id} (${body.role}) overlaps the solid ${solid.id}. Keep both, and move the body so that it rests against the solid's face from outside.`);
        break;
      }
    }
  }

  if (strings.length && !OPENING_WORDS.test(question) && !ROLE_OPENING_WORDS.test(roleText)) {
    for (const string of strings) {
      const segments = string.points.slice(1).map((end, i) => [string.points[i]!, end] as const);
      const crossed = surfaces.filter((surface) => samePanel(surface.id, string.id)).find((surface) => segments.some(([a, b]) => segmentsCross(a, b, surface.a, surface.b)));
      const pierced = !crossed && solids.filter((solid) => samePanel(solid.id, string.id)).find((solid) => solid.points.some((c, i) => {
        const d = solid.points[(i + 1) % solid.points.length]!;
        return segments.some(([a, b]) => segmentsCross(a, b, c, d));
      }));
      if (crossed || pierced) {
        const target = crossed ? crossed.id : (pierced as Solid).id;
        fail("string_through_surface", [string.id, target],
          `String ${string.id} passes through ${target}. Keep the string and the surface, and either route the string around the surface's edge, or draw and name the opening it passes through.`);
      }
    }
  }
  return issues;
}
