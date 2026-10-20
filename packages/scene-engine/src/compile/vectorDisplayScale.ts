import type { SceneDocument } from "../types";

/**
 * A velocity, acceleration or force drawn in a length frame has no length in
 * that frame: `vector(start, direction [1,0], length 4)` for 4 m/s in a 60 m
 * figure came out 14 px long, almost all arrowhead. Such a vector keeps its
 * tail and its exact direction; its drawn length is a display choice. Every
 * free vector of one unit shares one display factor, so they stay
 * proportional to each other, and the shortest is lifted to a readable shaft.
 *
 * A vector is free only when nothing else depends on where its tip lands:
 * - its quantity has a declared unit that is not a length (a value label
 *   such as `v_A = 4 m/s`, or a `length` bound to a quantity with a unit);
 * - its tip comes from `direction` and `length`, or is an unnamed point that
 *   nothing else uses;
 * - no other construction takes the vector as an input, and assertions about
 *   it only state directions.
 * A displacement, a position vector or a tip that other ink meets is never
 * rescaled.
 *
 * A unit group (spellings normalized, so "m/s", "ms⁻¹" and "m s^-1" are one
 * group) is scaled whole or not at all. It is left at its true length when
 * any vector of that unit is not free (a scaled one would no longer be in
 * proportion to it), when any other ink starts or ends on a free vector's tip
 * (a tip to tail sum, a resultant to that tip, a parallelogram side), or when
 * the figure has axes (the axes give vectors a scale of their own).
 */
export const READABLE_VECTOR_PX = 40;
const TARGET_VECTOR_PX = 48;
/** The longest rescaled vector in a group stays within this share of its view. */
const MAX_VIEW_SHARE = 0.4;
/** Another end within this share of a vector's length of its tip meets the tip. */
const JUNCTION_SHARE = 0.03;
const DIRECTION_PREDICATES = new Set(["parallel", "perpendicular", "opposite_direction", "same_direction", "antiparallel", "label_attached", "exists", "directed", "points_toward"]);
const LENGTH_UNIT = /^(?:m|cm|mm|km|nm|µm|μm|pm|ft|in|mi|yd|au|ly|metres?|meters?)$/i;

type Point = { x: number; y: number };
type PathGeometry = { kind: "path"; points: Point[]; directed?: boolean; infinite?: boolean };
type AnyGeometry = { kind: string };
interface FreeVector { id: string; unit: string; tipPointId?: string }

const SUPERSCRIPT: Record<string, string> = { "⁻": "-", "¹": "1", "²": "2", "³": "3", "⁰": "0", "⁴": "4" };
const TIME_UNIT = String.raw`(?:s|sec|secs|h|hr|hrs|min)`;

/**
 * One spelling per unit: "m/s", "ms⁻¹", "m s^-1", "m·s⁻¹" and "m/sec" are all
 * "m/s"; "m s⁻²" is "m/s²"; "km/hr" and "kmph" are "km/h".
 */
export function canonicalVectorUnit(unit: string): string {
  let text = unit.normalize("NFC").trim()
    .replace(/[⁻¹²³⁰⁴]+/g, (run) => `^${[...run].map((char) => SUPERSCRIPT[char]).join("")}`)
    .replace(/[−–]/g, "-")
    .replace(/[\s·⋅*]+/g, "")
    .replace(/\^\(([^)]*)\)/g, "^$1");
  text = text.replace(new RegExp(String.raw`^([a-zA-Zµμ]+?)(${TIME_UNIT})\^?-1$`), "$1/$2")
    .replace(new RegExp(String.raw`^([a-zA-Zµμ]+?)(${TIME_UNIT})\^?-2$`), "$1/$2^2");
  text = text.replace(/^kmph$/i, "km/h")
    .replace(/\/(?:sec|secs)(?=$|\^)/, "/s")
    .replace(/\/(?:hr|hrs)(?=$|\^)/, "/h")
    .replace(/\^2$/, "²").replace(/\^3$/, "³");
  return text;
}

function unitFromText(text: string | undefined): string | null {
  const match = text?.trim().match(/=\s*[+−-]?\s*\d[\d.,]*(?:\s*[×x]\s*10\^?[−-]?\d+)?\s*([^\s\d=][^=]*)$/u);
  const unit = match?.[1]?.trim();
  return unit ? canonicalVectorUnit(unit) : null;
}

function isPath(value: AnyGeometry | undefined): value is PathGeometry & AnyGeometry {
  return value?.kind === "path" && Array.isArray((value as PathGeometry).points);
}

/** Points where other ink starts, ends or turns (a vertex of a path, a point, a dimension end). */
function inkEnds(value: AnyGeometry): Point[] {
  const geometry = value as AnyGeometry & { point?: Point; points?: Point[]; paths?: Point[][]; a?: Point; b?: Point; terminals?: Point[]; infinite?: boolean };
  if (geometry.kind === "point" && geometry.point) return [geometry.point];
  if (geometry.kind === "path" && Array.isArray(geometry.points)) return geometry.infinite ? [] : geometry.points;
  if (geometry.kind === "multi_path" && Array.isArray(geometry.paths)) return geometry.paths.flatMap((path) => path.length ? [path[0]!, path[path.length - 1]!] : []);
  if (geometry.kind === "dimension" && geometry.a && geometry.b) return [geometry.a, geometry.b];
  if (geometry.kind === "compound" && Array.isArray(geometry.terminals)) return geometry.terminals;
  return [];
}

export function freeLengthVectors(document: SceneDocument, geometry: Map<string, AnyGeometry>, constructionOnlyIds: ReadonlySet<string>): FreeVector[] {
  if (document.entities.some((entity) => entity.kind === "axes") || [...geometry.values()].some((value) => value.kind === "axes")) return [];
  const required = new Set(document.requiredEntityIds);
  const producers = new Map(document.constructions.flatMap((construction) => construction.outputs.map((output) => [output, construction] as const)));
  const mentions = (id: string, except: ReadonlySet<string>) =>
    document.constructions.some((construction) => !except.has(construction.id) && JSON.stringify(construction.inputs).includes(`"${id}"`)) ||
    document.assertions.some((assertion) => assertion.entities.includes(id)) ||
    document.relations.some((relation) => relation.entities.includes(id)) ||
    document.annotations.some((annotation) => annotation.targetIds.includes(id) && annotation.kind !== "narration");
  const unitOf = (entityId: string, quantityId: string | undefined): string | null => {
    const entity = document.entities.find((candidate) => candidate.id === entityId);
    const labels = [entity?.label, ...document.annotations
      .filter((annotation) => (annotation.kind === "label" || annotation.kind === "callout") && annotation.targetIds.includes(entityId))
      .map((annotation) => annotation.text)];
    const annotationQuantity = document.annotations.find((annotation) => annotation.targetIds.includes(entityId) && annotation.quantityId)?.quantityId;
    const quantityUnit = [quantityId, annotationQuantity]
      .map((id) => document.quantities.find((quantity) => quantity.id === id)?.unit)
      .map((unit) => typeof unit === "string" ? unit.trim() : "")
      .find((unit) => unit.length > 0);
    return quantityUnit ? canonicalVectorUnit(quantityUnit) : labels.map(unitFromText).find((candidate): candidate is string => Boolean(candidate)) ?? null;
  };
  const freeTip = (entityId: string): { free: true; tipPointId?: string } | { free: false } => {
    const construction = producers.get(entityId);
    const value = geometry.get(entityId);
    if (construction?.operator !== "vector" || construction.outputs.length !== 1 || !isPath(value) || value.infinite || value.points.length !== 2) return { free: false };
    if (document.constructions.some((other) => other !== construction && JSON.stringify(other.inputs).includes(`"${entityId}"`))) return { free: false };
    if (document.assertions.some((assertion) => assertion.entities.includes(entityId) && !DIRECTION_PREDICATES.has(assertion.predicate))) return { free: false };
    const inputs = construction.inputs;
    const endInput = inputs.end ?? inputs.to ?? inputs.b;
    if (endInput === undefined) return inputs.direction === undefined || inputs.length === undefined ? { free: false } : { free: true };
    if (typeof endInput !== "string") return { free: false };
    const tip = document.entities.find((candidate) => candidate.id === endInput);
    const tipProducer = producers.get(endInput);
    if (!tip || tip.kind !== "point" || tip.label?.trim() || tipProducer?.operator !== "point") return { free: false };
    if (mentions(endInput, new Set([construction.id, tipProducer.id]))) return { free: false };
    return { free: true, tipPointId: endInput };
  };

  interface Candidate { id: string; unit: string; free: boolean; tipPointId?: string }
  const candidates: Candidate[] = [];
  for (const entity of document.entities) {
    if (entity.kind !== "vector" || !required.has(entity.id) || constructionOnlyIds.has(entity.id)) continue;
    const construction = producers.get(entity.id);
    const quantityId = typeof construction?.inputs.length === "string" ? construction.inputs.length : undefined;
    const unit = unitOf(entity.id, quantityId);
    if (!unit || LENGTH_UNIT.test(unit)) continue;
    const tip = freeTip(entity.id);
    candidates.push({ id: entity.id, unit, free: tip.free, ...(tip.free && tip.tipPointId ? { tipPointId: tip.tipPointId } : {}) });
  }
  /** Other ink meets this vector's tip: scaling would pull the tip off it. */
  const tipMet = (candidate: Candidate): boolean => {
    const value = geometry.get(candidate.id) as PathGeometry;
    const [tail, tip] = value.points as [Point, Point];
    const tolerance = Math.max(1e-6, JUNCTION_SHARE * Math.hypot(tip.x - tail.x, tip.y - tail.y));
    for (const [id, other] of geometry) {
      if (id === candidate.id || id === candidate.tipPointId) continue;
      if (inkEnds(other).some((end) => Math.hypot(end.x - tip.x, end.y - tip.y) <= tolerance)) return true;
    }
    return false;
  };
  const out: FreeVector[] = [];
  for (const unit of new Set(candidates.map((candidate) => candidate.unit))) {
    const group = candidates.filter((candidate) => candidate.unit === unit);
    if (group.some((candidate) => !candidate.free) || group.some(tipMet)) continue;
    out.push(...group.map(({ id, tipPointId }) => ({ id, unit, ...(tipPointId ? { tipPointId } : {}) })));
  }
  return out;
}

/**
 * Lift each unit group so its shortest drawn vector reaches a readable shaft.
 * Returns true when any geometry changed; the caller replans the view.
 */
export function scaleFreeVectors(
  vectors: FreeVector[],
  geometry: Map<string, AnyGeometry>,
  screen: (id: string) => (point: Point) => Point,
  viewFor: (id: string) => { width: number; height: number },
  applied: Map<string, number>,
): boolean {
  let changed = false;
  for (const unit of new Set(vectors.map((vector) => vector.unit))) {
    const group = vectors.filter((vector) => vector.unit === unit);
    const drawn = group.map((vector) => {
      const value = geometry.get(vector.id) as PathGeometry;
      const transform = screen(vector.id);
      const [a, b] = [transform(value.points[0]!), transform(value.points[1]!)];
      const view = viewFor(vector.id);
      return { vector, value, px: Math.hypot(b.x - a.x, b.y - a.y), cap: MAX_VIEW_SHARE * Math.min(view.width, view.height) };
    });
    const shortest = Math.min(...drawn.map((entry) => entry.px));
    if (!(shortest > 0) || shortest >= READABLE_VECTOR_PX) continue;
    let factor = TARGET_VECTOR_PX / shortest;
    for (const entry of drawn) factor = Math.min(factor, entry.cap / Math.max(entry.px, 1e-9));
    if (factor <= 1.0001) continue;
    for (const { vector, value } of drawn) {
      const [start, end] = value.points as [Point, Point];
      const tip = { x: start.x + (end.x - start.x) * factor, y: start.y + (end.y - start.y) * factor };
      geometry.set(vector.id, { ...value, points: [start, tip] } as PathGeometry);
      if (vector.tipPointId && geometry.get(vector.tipPointId)?.kind === "point") geometry.set(vector.tipPointId, { kind: "point", point: tip } as AnyGeometry);
      applied.set(vector.id, (applied.get(vector.id) ?? 1) * factor);
    }
    changed = true;
  }
  return changed;
}
