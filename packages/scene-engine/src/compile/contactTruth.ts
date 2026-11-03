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

type Point = { x: number; y: number };
type Shape = { kind: string; points?: Point[]; closed?: boolean; center?: Point; radius?: number; spaceLine?: unknown; spaceSegment?: unknown };
type Line = { id: string; a: Point; b: Point; length: number; role: string };
type Body = { id: string; role: string; points: Point[]; circle?: { center: Point; radius: number } };
type Solid = { id: string; role: string; points: Point[] };

const QUALIFIED_PLANE = String.raw`\b(?:inclined|rough|smooth|frictionless|sloping|tilted)\s+plane\b`;
const SURFACE_WORDS = new RegExp(String.raw`\b(?:incline|inclined|ramp|slope|wedge|ground|floor|table|tabletop|road|bank|banked|track|rails?|conveyor|belt|platform|shelf|bench|surface|wall|ceiling|roof|hill|desk|deck|bridge|plank|cliff|ledge|mountain|pavement|runway)\b|${QUALIFIED_PLANE}`, "i");
const NOT_SURFACE_WORDS = /\b(?:sand|mud|soil|pit|well|trench|tunnel|water|liquid|fluid|oil|mercury|meniscus|sea|lake|gauss\w*|equipotential|mirror|lens|optical|refract\w*|reflect\w*|interface|medium|glass|film|capacitor|plates?|sheet|conduct\w*|charge\w*|metal|coil|magnet\w*|wave\w*|image|focal|principal|axis|axes|normal|tangent|vector|field|rays?|string|rope|cord|thread|equatorial|state|energy|reference|sectional|cross|horizon|line of|path|trajectory|dimension|diameter|radius|chord|height|depth|distance|length|width|parallel|perpendicular|direction|along|above|below|to the|cutting|diagonal|molecular|infinite|imaginary|section|plane of|free surface|piston|partition|surface contact|contact geometry|ladder|rod|strut|bar|against|cone|conical|lateral|slant|hash|periodic|truth|lookup|contingency|frequency|data|row|column|circuit|node|terminal|wheatstone|metre|meter|galvanometer|ground\s+(?:rail|wire|node|terminal|symbol|bus))\b|\bin\s+(?:the\s+|its\s+)?(?:\w+\s+)?plane\b/i;
const SOLID_WORDS = new RegExp(String.raw`\b(?:wedge|incline|inclined|ramp|slope|ground|floor|table|tabletop|platform|bench|road)\b|${QUALIFIED_PLANE}`, "i");
const WEDGE_WORD = /\bwedge\b/i;
/** Nothing rests under these. A shelf, a table or a platform has a free underside, so it makes no such claim. */
const SOLID_BELOW_WORDS = new RegExp(String.raw`\b(?:incline|inclined|ramp|slope|wedge|ground|floor|road|bank|banked)\b|${QUALIFIED_PLANE}`, "i");
const BODY_WORDS = /\b(?:block|blocks|box|body|bodies|mass|masses|crate|cube|cart|trolley|car|vehicle|truck|bus|ball|sphere|cylinder|disc|disk|hoop|ring|wheel|object|particle|load|bob|sled|sledge|brick|stone|book|person|man|woman|boy|girl|barrel|drum|trunk|suitcase|package|container|sack|bag|log|train|wagon|bike|bicycle|motorcycle|scooter|locomotive|m[12]?)\b/i;
const NOT_BODY_WORDS = /\b(?:glass|prism|slab|gas|imaginary|benzene|molecule|pulley|support|clamp|hole|region|shaded|area|contact|marker|symbol|charge\w*|coil|core|magnet\w*|capacitor|resistor|cell|battery|lamp|bulb|switch|diode|ammeter|voltmeter|galvanometer|planet|sun|earth|moon|satellite|nucleus|atom|ion|electron|proton|gaussian|field)\b/i;
const STRING_WORDS = /\b(?:string|rope|thread|cord|chain)\b/i;
const NOT_STRING_WORDS = /\b(?:spinal|electric|power|carbon|polymer|side|food|charge\w*|wire)\b/i;
const NOT_A_FACE_WORDS = /\b(?:ladder|rod|beam|bar|plank|strut)\b/i;
const NORMAL_WORDS = /\bnormal\b/i;
const FORCE_ON_SURFACE = /\b(?:on|onto|against)\s+(?:the\s+)?(?:surface|plane|incline|wedge|table|ground|floor|wall|ramp)\b|\bby\s+(?:the\s+)?(?:block|body|mass|box|ball|object)\b/i;
// These read the stem and the roles only to withhold a refusal, so a false match behaves as if this check did not exist.
const PASSES_THROUGH_WORDS = /\b(?:hole|opening|slit|aperture|slot|tunnel|borewell|well|pit|mine|mineshaft|tube|pipe|eyelet|ditch|kuan|kuwan|chhed|chhid|surang)\b|कुआँ|कुएँ|कुंआ|छेद|सुरंग/i;
const SUNK_WORDS = /\b(?:sunk|sinks?|sinking|embedded|buried|immersed|submerged|floats?|floating|penetrat\w*|inscribed|of\s+its\s+volume|driven\s+(?:into|in)|fixed\s+(?:into|in)|stuck\s+in|press(?:es|ed)?\s+into|tunnel|borewell|well|pit|mine|mineshaft|trench|ditch|pipe|hole|kuan|kuwan|chhed|chhid|surang)\b|कुआँ|कुएँ|कुंआ|छेद|सुरंग/i;
const UNDERSIDE_WORDS = /\b(?:underside|underneath|beneath|overhang\w*|propped|props?|rollers?|on\s+wheels|hung|stuck\s+to|pressed\s+(?:up\s+)?against)\b/i;

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
/** As `hatchSegments`: six ticks, evenly spaced, on the right of start to end in world coordinates. */
const HATCH_TICKS = [1, 2, 3, 4, 5, 6].map((index) => index / 7);

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const words = (entity: SceneEntity) => `${entity.role ?? ""}`;
const stemWithoutIdioms = (text: string) => text.replace(/\bas\s+well\b/gi, " ");
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
function freeSideFromNormal(surface: Line, body: Body, document: SceneDocument, geometry: ReadonlyMap<string, unknown>): number | null {
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

export function validateContactTruth(document: SceneDocument, geometry: ReadonlyMap<string, unknown>): SceneIssue[] {
  if (document.visualDecision?.mode !== "scene") return [];
  const hatched = new Set((document.annotations ?? []).filter((a) => a.kind === "hatch").flatMap((a) => a.targetIds ?? []));
  const shape = (id: string) => geometry.get(id) as Shape | undefined;
  const allLines = document.entities.flatMap((e) => { const line = straightLine(e, shape(e.id)); return line ? [line] : []; });
  const surfaces = allLines.filter((line) => !NOT_SURFACE_WORDS.test(line.role) && (SURFACE_WORDS.test(line.role) || hatched.has(line.id)));
  const wedges = new Map(surfaces.flatMap((surface) => { const wedge = wedgeUnderSurface(surface, allLines); return wedge ? [[surface.id, wedge] as const] : []; }));
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
  const roleText = stemWithoutIdioms(document.entities.map(words).join(" "));
  const statedSunk = SUNK_WORDS.test(question) || SUNK_WORDS.test(roleText);
  const statedUnderside = UNDERSIDE_WORDS.test(question);
  const issues: SceneIssue[] = [];
  const fail = (code: string, ids: string[], message: string) => issues.push({ code, severity: "fatal", failureKind: "truth", entityIds: ids, message });

  for (const body of statedSunk ? [] : bodies) {
    const extent = extentOf(body.points);
    if (!(extent > SAME_POINT)) continue;
    for (const surface of surfaces) {
      // A dot marking a particle is a position, not an extended body lying across the line.
      if (extent <= surface.length * (body.circle ? BALL_MARKER_SHARE : MARKER_SHARE)) continue;
      // A ball at a line's end sits at the launch point or the table's edge, not across the line.
      if (body.circle && !insideAlong(surface, body.circle)) continue;
      if (lineInsideBody(surface, body)) continue;
      const params = body.points.map((p) => along(surface, p));
      const lo = minOf(params), hi = maxOf(params);
      if (!(hi > lo) || Math.min(hi, 1) - Math.max(lo, 0) < (hi - lo) * ALONG_SHARE) continue;
      if (straddles(surface, body)) {
        fail("body_straddles_surface", [body.id, surface.id],
          `${body.id} (${body.role}) lies across ${surface.id} (${surface.role}): the surface runs through the body. Keep both, and move the body so one face or one tangent point rests on the surface and the rest of it is on one side, or say in the question that it is sunk.`);
        continue;
      }
      const signed = body.points.map((p) => signedDistance(surface, p));
      const above = Math.max(0, maxOf(signed)), below = Math.max(0, -minOf(signed));
      const thickness = above + below;
      if (!(thickness > SAME_POINT)) continue;
      const side = above >= below ? 1 : -1;
      const gap = minOf(signed.map((value) => Math.abs(value)));
      const touching = body.circle ? Math.abs(Math.abs(signedDistance(surface, body.circle.center)) - body.circle.radius) <= thickness * TOUCH_SHARE : gap <= thickness * TOUCH_SHARE;
      if (!touching) continue;
      // A circle touches at one point, so ticks beside it stay outside it. Only a flat face covers them.
      if (!body.circle && hatched.has(surface.id) && side < 0 && HATCH_TICKS.some((tick) => tick > lo && tick < hi)) {
        fail("hatch_inside_body", [body.id, surface.id],
          `The hatch on ${surface.id} (${surface.role}) falls inside ${body.id} (${body.role}), so the body reads as part of the solid. Keep the hatch, and swap the surface's start and end so the hatch falls on the solid side.`);
      }
      const up = upSide(surface);
      const fromAbove = up !== null && SOLID_BELOW_WORDS.test(surface.role) && !statedUnderside ? up : null;
      const free = fromAbove ?? (up === null || !SOLID_BELOW_WORDS.test(surface.role) ? freeSideFromNormal(surface, body, document, geometry) : null);
      if (free !== null && side !== free) {
        fail("body_inside_surface", [body.id, surface.id],
          `${body.id} (${body.role}) touches ${surface.id} (${surface.role}) from its solid side, so the body is drawn inside the surface. Keep both, and move every corner of the body to the free side, with its contact face still on the surface.`);
      }
    }
    for (const solid of solids) {
      if (solid.id === body.id || extent <= extentOf(solid.points) * MARKER_SHARE) continue;
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

  if (strings.length && !PASSES_THROUGH_WORDS.test(question) && !PASSES_THROUGH_WORDS.test(roleText)) {
    for (const string of strings) {
      const segments = string.points.slice(1).map((end, i) => [string.points[i]!, end] as const);
      const crossed = surfaces.find((surface) => segments.some(([a, b]) => segmentsCross(a, b, surface.a, surface.b)));
      const pierced = !crossed && solids.find((solid) => solid.points.some((c, i) => {
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
