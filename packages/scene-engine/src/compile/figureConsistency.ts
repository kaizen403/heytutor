/**
 * Figure consistency: rendered ink must not tell the reader something the
 * document does not say. Each rule reads only the document's declared
 * operators and the compiled primitives, so it applies to every figure that
 * uses the operator, never to one topic or question.
 *
 * - component_glyph_overlap: one circuit symbol's glyph sits on or inside
 *   another's, so two branches read as joined.
 * - current_against_source_polarity: a current sense badge on a conductor in
 *   series with the only cell runs from its negative to its positive plate
 *   through the external circuit.
 * - vector_collinear_overlap: two arrows share a line and overlap, so one
 *   hides the other and the reader cannot tell their lengths or ends apart.
 * - vector_without_label: an arrow carries no name, so it reads as an
 *   unexplained quantity.
 * - region_label_in_nested_body: a region's name sits inside a body drawn
 *   within that region, so it names the body instead.
 */
import type { RenderPrimitive, SceneConstruction, SceneDocument, SceneIssue } from "../types";

type Point = { x: number; y: number };

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const length = (a: Point) => Math.hypot(a.x, a.y);

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const r = sub(b, a), s = sub(d, c), denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-9) return false;
  const t = cross(sub(c, a), s) / denominator, u = cross(sub(c, a), r) / denominator;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function isInk(primitive: RenderPrimitive): boolean {
  return primitive.kind !== "label" && !primitive.provenance?.labelLeader && primitive.provenance?.summary !== true;
}

function constructionOf(document: SceneDocument, entityId: string): SceneConstruction | undefined {
  return document.constructions.find((construction) => construction.outputs.includes(entityId));
}

function renderedPoint(primitives: RenderPrimitive[], entityId: unknown): Point | null {
  if (typeof entityId !== "string") return null;
  const primitive = primitives.find((candidate) => candidate.entityId === entityId && candidate.kind === "point");
  return primitive?.points[0] ?? null;
}

// ---------------------------------------------------------------------------
// Component glyphs

interface Glyph { id: string; segments: [Point, Point][]; closed: Point[][]; vertices: Point[] }

/** The part of a two terminal symbol that is not its lead wire: strokes off the
 * terminal axis, away from both terminals, plus any closed outline (a meter ring). */
function componentGlyph(id: string, start: Point, end: Point, primitives: RenderPrimitive[]): Glyph | null {
  const axis = sub(end, start), span = length(axis);
  if (span < 1e-6) return null;
  const u = { x: axis.x / span, y: axis.y / span };
  const along = (p: Point) => dot(sub(p, start), u) / span;
  const segments: [Point, Point][] = [], closed: Point[][] = [];
  for (const primitive of primitives) {
    if (primitive.entityId !== id || !isInk(primitive) || primitive.kind === "point") continue;
    const points = primitive.points;
    if (points.length > 3 && length(sub(points[0]!, points.at(-1)!)) < 1e-3 * span + 0.5) closed.push(points);
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!, b = points[index]!, direction = sub(b, a), size = length(direction);
      if (size < 1e-6) continue;
      // Lead wires run along the terminal axis.
      if (Math.abs(cross(direction, u)) / size < Math.sin(3 * Math.PI / 180)) continue;
      // Lane connectors sit at the terminals themselves.
      const ta = along(a), tb = along(b);
      if ((Math.max(ta, tb) <= 0.1) || (Math.min(ta, tb) >= 0.9)) continue;
      segments.push([a, b]);
    }
  }
  const vertices = segments.flat();
  return segments.length > 0 || closed.length > 0 ? { id, segments, closed, vertices } : null;
}

function glyphsOverlap(first: Glyph, second: Glyph): boolean {
  for (const [a, b] of first.segments) for (const [c, d] of second.segments) if (segmentsCross(a, b, c, d)) return true;
  const within = (inner: Glyph, outer: Glyph) => outer.closed.some((ring) => inner.vertices.some((vertex) => insidePolygon(vertex, ring)));
  return within(first, second) || within(second, first);
}

/** Screen terminals of a two terminal symbol, from the compiler's resolved geometry. */
export type SymbolTerminals = (entityId: string) => [Point, Point] | null;

export function validateComponentGlyphOverlap(document: SceneDocument, primitives: RenderPrimitive[], terminalsOf?: SymbolTerminals): SceneIssue[] {
  const glyphs: Glyph[] = [];
  for (const construction of document.constructions) {
    if (construction.operator !== "symbol") continue;
    const id = construction.outputs[0];
    if (!id) continue;
    const terminals = terminalsOf?.(id) ?? null;
    const start = terminals?.[0] ?? renderedPoint(primitives, construction.inputs.start ?? construction.inputs.from ?? construction.inputs.a);
    const end = terminals?.[1] ?? renderedPoint(primitives, construction.inputs.end ?? construction.inputs.to ?? construction.inputs.b);
    if (!start || !end) continue;
    const glyph = componentGlyph(id, start, end, primitives);
    if (glyph) glyphs.push(glyph);
  }
  const issues: SceneIssue[] = [];
  for (let i = 0; i < glyphs.length; i++) for (let j = i + 1; j < glyphs.length; j++) {
    if (!glyphsOverlap(glyphs[i]!, glyphs[j]!)) continue;
    issues.push({ code: "component_glyph_overlap", severity: "fatal", failureKind: "truth", entityIds: [glyphs[i]!.id, glyphs[j]!.id],
      message: `Circuit symbols ${glyphs[i]!.id} and ${glyphs[j]!.id} are drawn on top of each other, so their branches read as joined.` });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Current sense against the cell's polarity

const POLARISED_SOURCES = new Set(["battery", "cell"]);
const OTHER_SOURCES = new Set(["ac_source", "alternating_source", "dc_current_source", "current_source", "voltage_source", "dc_source", "source"]);

interface Conductor { id: string; start: string; end: string }

function symbolName(construction: SceneConstruction): string {
  return String(construction.inputs.symbol ?? "").trim().toLowerCase();
}

function conducts(construction: SceneConstruction): boolean {
  const symbol = symbolName(construction);
  if (symbol === "open") return false;
  if (symbol === "switch") return String(construction.inputs.state ?? "closed").trim().toLowerCase() === "closed";
  return true;
}

function connected(edges: Conductor[], from: string, to: string): boolean {
  const seen = new Set([from]), queue = [from];
  while (queue.length) {
    const node = queue.shift()!;
    if (node === to) return true;
    for (const edge of edges) {
      const next = edge.start === node ? edge.end : edge.end === node ? edge.start : null;
      if (next !== null && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return false;
}

/** The document draws a cell's long (positive) plate at its start terminal. Conventional
 * current leaves that plate, so on any conductor every external path must cross, it
 * flows from the side joined to the start terminal towards the side joined to the end. */
export function validateCurrentSourcePolarity(document: SceneDocument): SceneIssue[] {
  const symbols = document.constructions.filter((construction) => construction.operator === "symbol");
  const sources = symbols.filter((construction) => POLARISED_SOURCES.has(symbolName(construction)));
  if (sources.length !== 1 || symbols.some((construction) => OTHER_SOURCES.has(symbolName(construction)))) return [];
  const source = sources[0]!;
  const positive = source.inputs.start, negative = source.inputs.end;
  if (typeof positive !== "string" || typeof negative !== "string" || positive === negative) return [];
  const edges: Conductor[] = [];
  for (const construction of document.constructions) {
    if (construction === source || !construction.outputs[0]) continue;
    if (construction.operator !== "symbol" && construction.operator !== "connect") continue;
    if (construction.operator === "symbol" && !conducts(construction)) continue;
    const start = construction.inputs.start ?? construction.inputs.from ?? construction.inputs.a;
    const end = construction.inputs.end ?? construction.inputs.to ?? construction.inputs.b;
    if (typeof start === "string" && typeof end === "string" && start !== end) edges.push({ id: construction.outputs[0], start, end });
  }
  if (!connected(edges, positive, negative)) return [];
  const issues: SceneIssue[] = [];
  for (const badge of document.constructions) {
    if (badge.operator !== "sign_badge" || !badge.outputs[0]) continue;
    const entity = document.entities.find((candidate) => candidate.id === badge.outputs[0]);
    // Electron flow is declared to run the other way; it is not a conventional current mark.
    if (/electron/i.test(`${entity?.role ?? ""} ${entity?.label ?? ""}`)) continue;
    const target = badge.inputs.target ?? badge.inputs.axis ?? badge.inputs.path;
    const sense = String(badge.inputs.sense ?? badge.inputs.kind ?? "").trim().toLowerCase();
    if (sense !== "positive" && sense !== "negative") continue;
    const edge = edges.find((candidate) => candidate.id === target);
    if (!edge) continue;
    const rest = edges.filter((candidate) => candidate !== edge);
    // Only a series conductor carries the source current in a direction the polarity fixes.
    if (connected(rest, positive, negative)) continue;
    const startSide = connected(rest, positive, edge.start);
    const endSide = connected(rest, positive, edge.end);
    if (startSide === endSide) continue;
    const drawnForward = sense === "positive";
    if (drawnForward === startSide) continue;
    issues.push({ code: "current_against_source_polarity", severity: "fatal", failureKind: "truth", entityIds: [badge.outputs[0], edge.id, source.outputs[0] ?? ""],
      constructionId: badge.id,
      message: `The current mark on ${edge.id} runs against the cell: conventional current leaves the positive plate at ${positive} and reaches ${edge.id} from its ${startSide ? "start" : "end"}.` });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Arrows

function arrowSegment(primitive: RenderPrimitive): [Point, Point] | null {
  if (primitive.kind !== "vector" || primitive.points.length < 2) return null;
  const a = primitive.points[0]!, b = primitive.points.at(-1)!;
  return length(sub(b, a)) > 1e-6 ? [a, b] : null;
}

/** Collinear arrows overlapping by more than this many pixels hide one another. */
const ARROW_OVERLAP_PX = 6;

/** A projection or a resolved component lies on its basis line by definition. */
const ALONG_BASIS_OPERATORS = new Set(["vector_projection", "vector_components", "project"]);

export function validateArrowOverlap(document: SceneDocument, primitives: RenderPrimitive[]): SceneIssue[] {
  const alongBasis = (entityId: string) => ALONG_BASIS_OPERATORS.has(constructionOf(document, entityId)?.operator ?? "");
  const arrows = primitives.flatMap((primitive) => {
    const segment = isInk(primitive) ? arrowSegment(primitive) : null;
    return segment ? [{ primitive, segment }] : [];
  });
  const issues: SceneIssue[] = [];
  for (let i = 0; i < arrows.length; i++) for (let j = i + 1; j < arrows.length; j++) {
    const first = arrows[i]!, second = arrows[j]!;
    if (first.primitive.entityId === second.primitive.entityId) continue;
    if (alongBasis(first.primitive.entityId) || alongBasis(second.primitive.entityId)) continue;
    const [a, b] = first.segment, [c, d] = second.segment;
    const span = length(sub(b, a)), u = { x: (b.x - a.x) / span, y: (b.y - a.y) / span };
    const other = sub(d, c), otherSpan = length(other);
    if (Math.abs(cross(other, u)) / otherSpan > Math.sin(2 * Math.PI / 180)) continue;
    if (Math.abs(cross(sub(c, a), u)) > 2 || Math.abs(cross(sub(d, a), u)) > 2) continue;
    const tc = dot(sub(c, a), u), td = dot(sub(d, a), u);
    const overlap = Math.min(span, Math.max(tc, td)) - Math.max(0, Math.min(tc, td));
    if (overlap <= ARROW_OVERLAP_PX) continue;
    issues.push({ code: "vector_collinear_overlap", severity: "fatal", failureKind: "truth",
      entityIds: [first.primitive.entityId, second.primitive.entityId],
      message: `Arrows ${first.primitive.entityId} and ${second.primitive.entityId} lie on one line and overlap by ${Math.round(overlap)} px, so one hides the other.` });
  }
  return issues;
}

/** Every owner a rendered label names: its entity, its annotation targets, or a label entity's target. */
function labelOwners(document: SceneDocument, label: RenderPrimitive): string[] {
  const annotationId = label.provenance?.annotationId ?? (document.annotations.some((annotation) => annotation.id === label.id) ? label.id : undefined);
  const annotation = document.annotations.find((candidate) => candidate.id === annotationId);
  if (annotation?.targetIds?.length) return annotation.targetIds;
  const entity = document.entities.find((candidate) => candidate.id === label.entityId);
  if (entity?.kind === "label") {
    const construction = constructionOf(document, entity.id);
    const target = construction?.inputs.target ?? construction?.inputs.of ?? construction?.inputs.entity;
    if (typeof target === "string") return [target];
    if (Array.isArray(target)) return target.filter((value): value is string => typeof value === "string");
  }
  return [label.entityId];
}

function isHelper(document: SceneDocument, entityId: string): boolean {
  const entity = document.entities.find((candidate) => candidate.id === entityId);
  return /\b(helper|construction)\b/i.test(entity?.role ?? "");
}

export function validateArrowLabels(document: SceneDocument, primitives: RenderPrimitive[]): SceneIssue[] {
  const named = new Set<string>();
  for (const primitive of primitives) {
    if (primitive.kind !== "label" || !(primitive.text ?? "").trim()) continue;
    for (const owner of labelOwners(document, primitive)) named.add(owner);
  }
  // A set of like arrows (a field pattern, a series of transitions) shares one
  // declared role; the family is named once, not arrow by arrow.
  const roleCount = new Map<string, number>();
  const roleOf = (entityId: string) => {
    const entity = document.entities.find((candidate) => candidate.id === entityId);
    const role = (entity?.role ?? "").trim().toLowerCase();
    return role && role !== entity?.kind && role !== "vector" ? role : "";
  };
  for (const entity of document.entities) {
    const role = entity.kind === "vector" ? roleOf(entity.id) : "";
    if (role) roleCount.set(role, (roleCount.get(role) ?? 0) + 1);
  }
  // An arrow from one named point to another reads as "from P to Q".
  const namedPoints = primitives.filter((primitive) => primitive.kind === "point" && primitive.points[0] && named.has(primitive.entityId)).map((primitive) => primitive.points[0]!);
  const atNamedPoint = (p: Point) => namedPoints.some((q) => length(sub(p, q)) <= 3);
  // A symmetric figure names one side: an arrow that mirrors a named arrow (same
  // length, reflected across a vertical or horizontal axis) is read as its twin.
  const namedArrows = primitives.flatMap((primitive) => {
    const segment = isInk(primitive) && named.has(primitive.entityId) ? arrowSegment(primitive) : null;
    return segment ? [sub(segment[1], segment[0])] : [];
  });
  const mirrorsNamedArrow = (direction: Point) => namedArrows.some((twin) => {
    const size = length(direction), twinSize = length(twin);
    if (Math.abs(size - twinSize) > 0.03 * twinSize) return false;
    return [{ x: -twin.x, y: twin.y }, { x: twin.x, y: -twin.y }].some((mirror) => dot(mirror, direction) / (size * twinSize) > Math.cos(2 * Math.PI / 180));
  });
  const issues: SceneIssue[] = [];
  const reported = new Set<string>();
  for (const primitive of primitives) {
    const segment = isInk(primitive) ? arrowSegment(primitive) : null;
    if (!segment || reported.has(primitive.entityId)) continue;
    if (named.has(primitive.entityId) || isHelper(document, primitive.entityId)) continue;
    if ((roleCount.get(roleOf(primitive.entityId)) ?? 0) >= 2) continue;
    if (atNamedPoint(segment[0]) && atNamedPoint(segment[1])) continue;
    if (mirrorsNamedArrow(sub(segment[1], segment[0]))) continue;
    reported.add(primitive.entityId);
    issues.push({ code: "vector_without_label", severity: "fatal", failureKind: "truth", entityIds: [primitive.entityId],
      message: `Arrow ${primitive.entityId} carries no name; an unnamed arrow reads as an unexplained quantity.` });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Region names

function closedOutline(primitive: RenderPrimitive): Point[] | null {
  if (!isInk(primitive)) return null;
  if (primitive.kind === "rectangle" || primitive.kind === "polygon") return primitive.points.length >= 3 ? primitive.points : null;
  if (primitive.kind === "circle" && primitive.points[0] && primitive.radius) {
    const center = primitive.points[0], radius = primitive.radius;
    return Array.from({ length: 48 }, (_, index) => ({ x: center.x + radius * Math.cos(index / 48 * Math.PI * 2), y: center.y + radius * Math.sin(index / 48 * Math.PI * 2) }));
  }
  return null;
}

/** A region's untethered name inside a smaller body drawn within that region names the body. */
export function validateRegionLabelPlacement(document: SceneDocument, primitives: RenderPrimitive[]): SceneIssue[] {
  const outlines = primitives.flatMap((primitive) => {
    const outline = closedOutline(primitive);
    return outline ? [{ entityId: primitive.entityId, outline }] : [];
  });
  const issues: SceneIssue[] = [];
  for (const label of primitives) {
    if (label.kind !== "label" || !label.points[0] || label.provenance?.usesLeader || label.provenance?.summary) continue;
    const owners = labelOwners(document, label);
    const ownerOutlines = outlines.filter((outline) => owners.includes(outline.entityId));
    if (ownerOutlines.length === 0) continue;
    const at = label.points[0];
    const nested = outlines.find((body) => !owners.includes(body.entityId)
      && insidePolygon(at, body.outline)
      && ownerOutlines.some((owner) => body.outline.every((vertex) => insidePolygon(vertex, owner.outline))));
    if (!nested) continue;
    issues.push({ code: "region_label_in_nested_body", severity: "fatal", failureKind: "truth", entityIds: [...owners, nested.entityId],
      message: `The name "${label.text ?? ""}" of ${owners.join(", ")} sits inside ${nested.entityId}, a body drawn within it, so it names that body instead.` });
  }
  return issues;
}

export function validateFigureConsistency(document: SceneDocument, primitives: RenderPrimitive[], terminalsOf?: SymbolTerminals): SceneIssue[] {
  return [
    ...validateComponentGlyphOverlap(document, primitives, terminalsOf),
    ...validateCurrentSourcePolarity(document),
    ...validateArrowOverlap(document, primitives),
    ...validateArrowLabels(document, primitives),
    ...validateRegionLabelPlacement(document, primitives),
  ];
}
