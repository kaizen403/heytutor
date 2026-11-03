/**
 * Layout checks for the measured spans (u, v, f) on the engine's lens and
 * mirror figure, read from the compiled render scene. Shared by the
 * optics-figures gate and its review probes.
 *
 * A span is a `dimension` bar with two dashed witnesses. The checks:
 * - the bar measures the figure's own points: its measured ends are the
 *   rendered element centre (P or O) and the object, image or focus point;
 * - the bar crosses no other ink (rays, element, axis, arrows, other bars);
 *   witnesses are construction lines and may cross, as on any drawing, and a
 *   label leader may meet a bar only at its witnessed end;
 * - its label exists, says the expected text, overlaps no other label or ink,
 *   and no other bar runs between the label and its own bar (a label beyond
 *   a neighbour's bar reads as the neighbour's value);
 * - bar and label stay in the diagram zone (x 400 to 1160) and the view.
 */
import { boundsOverlap, obstaclesFromPrimitives, type LabelBounds, type RenderPrimitive, type RenderScene, type SceneDocument } from "../../src";

export const DIAGRAM_ZONE = { left: 400, right: 1160, top: 140, bottom: 520 } as const;
const VIEW = { top: 55, bottom: 610 } as const;

type P = { x: number; y: number };
const near = (a: P, b: P, tolerance = 0.75) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;

function segmentDistance(a: P, b: P, c: P, d: P): number {
  const orient = (p: P, q: P, r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0;
  const toSegment = (p: P, s: P, t: P) => {
    const dx = t.x - s.x, dy = t.y - s.y;
    const length = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / length));
    return Math.hypot(p.x - (s.x + k * dx), p.y - (s.y + k * dy));
  };
  return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
}

function interior(a: P, b: P, trim: number): [P, P] {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const k = Math.min(0.49, trim / length);
  return [{ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, { x: b.x - (b.x - a.x) * k, y: b.y - (b.y - a.y) * k }];
}

function segmentHitsBox(a: P, b: P, box: LabelBounds): boolean {
  const inside = (p: P) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
  if (inside(a) || inside(b)) return true;
  const corners: P[] = [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }];
  return corners.some((corner, index) => segmentDistance(a, b, corner, corners[(index + 1) % 4]!) === 0);
}

const labelBounds = (primitive: RenderPrimitive): LabelBounds | null => {
  const bounds = primitive.provenance?.labelCollisionBounds ?? primitive.provenance?.labelBounds;
  return bounds && typeof bounds === "object" && "width" in (bounds as object) ? bounds as LabelBounds : null;
};

export interface ExpectedSpan {
  id: string;
  text: string;
  /** Entity whose rendered point is the element end (P or O). */
  element: string;
  /** Entity whose rendered point is the measured end (O_base, I_base, F, F1 or F2). */
  point: string;
}

export interface SpanLayoutReport {
  problems: string[];
  /** Span labels or bars outside the dashed diagram band (y 140 to 520): a soft measure. */
  outsideBand: number;
}

export function checkOpticsSpanLayout(document: SceneDocument, scene: RenderScene, expected: readonly ExpectedSpan[]): SpanLayoutReport {
  const problems: string[] = [];
  let outsideBand = 0;
  const primitives = scene.primitives;
  const world = (entityId: string): P | null => {
    const inputs = document.constructions.find((construction) => construction.operator === "point" && construction.outputs.includes(entityId))?.inputs;
    return inputs && typeof inputs.x === "number" && typeof inputs.y === "number" ? { x: inputs.x, y: inputs.y } : null;
  };
  // Coincident points (an object at the focus) render once, under either id.
  const pointOf = (entityId: string): P | null => {
    const at = world(entityId);
    const ids = new Set([entityId, ...document.entities.filter((entity) => {
      const other = at ? world(entity.id) : null;
      return other !== null && at !== null && Math.hypot(other.x - at.x, other.y - at.y) < 1e-9;
    }).map((entity) => entity.id)]);
    const point = primitives.find((primitive) => ids.has(primitive.entityId) && primitive.kind === "point")?.points[0];
    return point ?? null;
  };
  const bars = primitives.filter((primitive) => primitive.kind === "dimension" && primitive.provenance?.measurementRole === "bar");
  const ids = expected.map((span) => span.id);
  const extra = bars.filter((bar) => !ids.includes(bar.entityId)).map((bar) => bar.entityId);
  if (extra.length) problems.push(`spans not expected: ${extra.join(", ")}`);
  const labels = primitives.filter((primitive) => primitive.kind === "label");
  const ink = primitives.filter((primitive) => primitive.kind !== "label" && primitive.provenance?.measurementRole !== "witness" && primitive.points.length >= 2);

  for (const span of expected) {
    const bar = bars.find((primitive) => primitive.entityId === span.id);
    if (!bar || bar.points.length < 2) { problems.push(`${span.id}: no bar drawn`); continue; }
    const [a, b] = [bar.points[0]!, bar.points[1]!];
    // Ends: the measured points are the rendered figure points.
    const start = bar.provenance?.measuredStart as P | undefined;
    const end = bar.provenance?.measuredEnd as P | undefined;
    const element = pointOf(span.element);
    const target = pointOf(span.point);
    if (!start || !end || !element || !target) problems.push(`${span.id}: measured ends or figure points missing`);
    else if (!near(start, element) || !near(end, target)) {
      problems.push(`${span.id}: measures (${start.x},${start.y})..(${end.x},${end.y}), figure points ${span.element}=(${element.x},${element.y}) ${span.point}=(${target.x},${target.y})`);
    }
    // The bar is parallel to the axis it measures along.
    if (start && end && Math.abs((b.x - a.x) * (end.y - start.y) - (b.y - a.y) * (end.x - start.x)) > 1) problems.push(`${span.id}: bar is not parallel to the measured span`);
    // Bar vs other ink.
    for (const other of ink) {
      if (other.entityId === span.id) continue;
      // A label leader may meet a bar only at its end, where the witness already stands.
      const leader = other.provenance?.labelLeader === true;
      const [from, to] = leader ? interior(a, b, 6) : [a, b];
      for (let index = 0; index < other.points.length - 1; index++) {
        if (segmentDistance(from, to, other.points[index]!, other.points[index + 1]!) < 2) {
          problems.push(`${span.id}: bar touches ${other.entityId}`);
          break;
        }
      }
    }
    // Label.
    const label = labels.find((primitive) => primitive.entityId === span.id);
    const box = label ? labelBounds(label) : null;
    if (!label || !box) { problems.push(`${span.id}: no label`); continue; }
    if (label.text !== span.text) problems.push(`${span.id}: label ${JSON.stringify(label.text)} is not ${JSON.stringify(span.text)}`);
    for (const otherLabel of labels) {
      if (otherLabel === label) continue;
      const otherBox = labelBounds(otherLabel);
      if (otherBox && boundsOverlap(box, otherBox)) problems.push(`${span.id}: label overlaps label ${otherLabel.entityId} ${JSON.stringify(otherLabel.text)}`);
    }
    for (const obstacle of obstaclesFromPrimitives(primitives.filter((primitive) => primitive.kind !== "label" && primitive.kind !== "point" && primitive.entityId !== span.id))) {
      if (obstacle.segments?.some(([s, t]) => segmentHitsBox(s, t, box))) {
        problems.push(`${span.id}: label crosses ${obstacle.entityId}`);
      }
    }
    // No other bar between the label and its own bar.
    const labelY = box.y + box.height / 2;
    const barY = (a.y + b.y) / 2;
    const [lowX, highX] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    for (const other of bars) {
      if (other === bar) continue;
      const otherY = (other.points[0]!.y + other.points[1]!.y) / 2;
      const [otherLow, otherHigh] = [Math.min(other.points[0]!.x, other.points[1]!.x), Math.max(other.points[0]!.x, other.points[1]!.x)];
      const xOverlap = Math.min(box.x + box.width, otherHigh) - Math.max(box.x, otherLow) > 0;
      if (xOverlap && (otherY - labelY) * (otherY - barY) < 0) problems.push(`${span.id}: label sits beyond ${other.entityId}'s bar`);
    }
    // Text sits beside its own bar: horizontally over it, vertically within one lane.
    if (box.x + box.width < lowX - 4 || box.x > highX + 4) problems.push(`${span.id}: label is not over its bar`);
    // Zone and view.
    const xs = [a.x, b.x, box.x, box.x + box.width];
    const ys = [a.y, b.y, box.y, box.y + box.height];
    if (xs.some((x) => x < DIAGRAM_ZONE.left || x > DIAGRAM_ZONE.right)) problems.push(`${span.id}: outside the diagram zone x 400 to 1160`);
    if (ys.some((y) => y < VIEW.top || y > VIEW.bottom)) problems.push(`${span.id}: outside the view`);
    if (ys.some((y) => y < DIAGRAM_ZONE.top || y > DIAGRAM_ZONE.bottom)) outsideBand++;
  }
  // Bars do not overlap each other (also covered by the ink check above).
  return { problems, outsideBand };
}
