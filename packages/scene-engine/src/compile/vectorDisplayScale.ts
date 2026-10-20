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
 */
export const READABLE_VECTOR_PX = 40;
const TARGET_VECTOR_PX = 48;
/** The longest rescaled vector in a group stays within this share of its view. */
const MAX_VIEW_SHARE = 0.4;
const DIRECTION_PREDICATES = new Set(["parallel", "perpendicular", "opposite_direction", "same_direction", "antiparallel", "label_attached", "exists", "directed", "points_toward"]);
const LENGTH_UNIT = /^(?:m|cm|mm|km|nm|µm|μm|pm|ft|in|mi|yd|au|ly|metres?|meters?)$/i;

type Point = { x: number; y: number };
type PathGeometry = { kind: "path"; points: Point[]; directed?: boolean; infinite?: boolean };
type AnyGeometry = { kind: string };
interface FreeVector { id: string; unit: string; tipPointId?: string }

function unitFromText(text: string | undefined): string | null {
  const match = text?.trim().match(/=\s*[+−-]?\s*\d[\d.,]*(?:\s*[×x]\s*10\^?[−-]?\d+)?\s*([^\s\d=][^=]*)$/u);
  const unit = match?.[1]?.trim().replace(/\^2/g, "²").replace(/\^3/g, "³").replace(/\s+/g, "");
  return unit ? unit : null;
}

function isPath(value: AnyGeometry | undefined): value is PathGeometry & AnyGeometry {
  return value?.kind === "path" && Array.isArray((value as PathGeometry).points);
}

export function freeLengthVectors(document: SceneDocument, geometry: Map<string, AnyGeometry>, constructionOnlyIds: ReadonlySet<string>): FreeVector[] {
  const required = new Set(document.requiredEntityIds);
  const producers = new Map(document.constructions.flatMap((construction) => construction.outputs.map((output) => [output, construction] as const)));
  const mentions = (id: string, except: ReadonlySet<string>) =>
    document.constructions.some((construction) => !except.has(construction.id) && JSON.stringify(construction.inputs).includes(`"${id}"`)) ||
    document.assertions.some((assertion) => assertion.entities.includes(id)) ||
    document.relations.some((relation) => relation.entities.includes(id)) ||
    document.annotations.some((annotation) => annotation.targetIds.includes(id) && annotation.kind !== "narration");
  const out: FreeVector[] = [];
  for (const entity of document.entities) {
    if (entity.kind !== "vector" || !required.has(entity.id) || constructionOnlyIds.has(entity.id)) continue;
    const construction = producers.get(entity.id);
    const value = geometry.get(entity.id);
    if (construction?.operator !== "vector" || construction.outputs.length !== 1 || !isPath(value) || value.infinite || value.points.length !== 2) continue;
    if (document.constructions.some((other) => other !== construction && JSON.stringify(other.inputs).includes(`"${entity.id}"`))) continue;
    if (document.assertions.some((assertion) => assertion.entities.includes(entity.id) && !DIRECTION_PREDICATES.has(assertion.predicate))) continue;
    const inputs = construction.inputs;
    const endInput = inputs.end ?? inputs.to ?? inputs.b;
    let tipPointId: string | undefined;
    if (endInput !== undefined) {
      if (typeof endInput !== "string") continue;
      const tip = document.entities.find((candidate) => candidate.id === endInput);
      const tipProducer = producers.get(endInput);
      if (!tip || tip.kind !== "point" || tip.label?.trim() || tipProducer?.operator !== "point") continue;
      if (mentions(endInput, new Set([construction.id, tipProducer.id]))) continue;
      tipPointId = endInput;
    } else if (inputs.direction === undefined || inputs.length === undefined) continue;
    const quantityId = typeof inputs.length === "string" ? inputs.length : undefined;
    const labels = [entity.label, ...document.annotations
      .filter((annotation) => (annotation.kind === "label" || annotation.kind === "callout") && annotation.targetIds.includes(entity.id))
      .map((annotation) => annotation.text)];
    const annotationQuantity = document.annotations.find((annotation) => annotation.targetIds.includes(entity.id) && annotation.quantityId)?.quantityId;
    const quantityUnit = [quantityId, annotationQuantity]
      .map((id) => document.quantities.find((quantity) => quantity.id === id)?.unit)
      .map((unit) => typeof unit === "string" ? unit.trim() : "")
      .find((unit) => unit.length > 0);
    const unit = quantityUnit?.replace(/\s+/g, "") ?? labels.map(unitFromText).find((candidate): candidate is string => Boolean(candidate));
    if (!unit || LENGTH_UNIT.test(unit)) continue;
    out.push({ id: entity.id, unit, ...(tipPointId ? { tipPointId } : {}) });
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
