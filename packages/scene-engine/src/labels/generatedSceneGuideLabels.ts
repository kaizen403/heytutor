/** Internal projection of freshly proved engine labels. It grants no raster authority. */
import { measureTextInkBounds, measureTextWidth } from "@heytutor/drawing";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { atomicGeneratedLabelBindings, deferVerifiedAnswerLabels } from "../compile/answerLabels";
import { strokePieces } from "../compile/labelOwnerTruth";
import { isPointIdentifierText } from "../compile/pointLabelText";
import { nativeGivenLabelTimingProved } from "../compile/nativeGuideSourceBindings";
import { boundsInside, boundsOverlap, placeLabels, type LabelBounds } from "./labelEngine";
import type { RenderPoint, RenderPrimitive, RenderScene, SceneDocument } from "../types";

export interface GeneratedSceneGuideAffine {
  xx: number; xy: number; yx: number; yy: number; tx: number; ty: number;
}
export interface GeneratedSceneGuideLabelFrame {
  glyphOrigin: RenderPoint;
  anchor: RenderPoint;
  inkBounds: LabelBounds;
  reservedBounds: LabelBounds;
  leaderPath: RenderPoint[];
}
export interface GeneratedSceneGuideLabelSlot {
  id: string;
  primitiveId: string;
  entityId: string;
  groupId: string;
  owners: Array<{ entityId: string; role: string }>;
  text: string;
  required: boolean;
  role: "setup" | "answer";
  revealAfter: "setup" | "teaching_complete";
  timingBasis: "source_given" | "engine_answer_binding" | "conservative_numeric_deferral" | "non_numeric";
  fontPx: 24;
  imageFontPx: number;
  /** Native final-board frame. Handwriting uses this origin at exactly 24 px. */
  board: GeneratedSceneGuideLabelFrame;
  /** Guide image pixels, never independently refitted by a label adapter. */
  image: GeneratedSceneGuideLabelFrame;
}

export interface GeneratedSceneGuideCaption {
  text: string;
  fontPx: 24;
  revealAfter: "setup" | "teaching_complete";
  board: { region: LabelBounds; lines: Array<{ text: string; glyphOrigin: RenderPoint; inkBounds: LabelBounds; reservedBounds: LabelBounds }> };
}

export class GeneratedSceneGuideLabelError extends Error {
  constructor(readonly code: string, message: string, readonly entityIds: string[] = []) { super(message); }
}
function fail(code: string, message: string, ids: string[] = []): never {
  throw new GeneratedSceneGuideLabelError(code, message, ids);
}
export function guidePoint(matrix: GeneratedSceneGuideAffine, point: RenderPoint): RenderPoint {
  return { x: matrix.xx * point.x + matrix.xy * point.y + matrix.tx, y: matrix.yx * point.x + matrix.yy * point.y + matrix.ty };
}
export function guideBounds(matrix: GeneratedSceneGuideAffine, box: LabelBounds): LabelBounds {
  if (matrix.xy !== 0 || matrix.yx !== 0 || !(matrix.xx > 0) || matrix.xx !== matrix.yy) {
    fail("non_uniform_guide_transform", "Label frames require the same positive uniform affine as all geometry");
  }
  return { ...guidePoint(matrix, box), width: box.width * matrix.xx, height: box.height * matrix.yy };
}
function finiteBounds(value: unknown): value is LabelBounds {
  if (!value || typeof value !== "object") return false;
  const box = value as LabelBounds;
  return [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
}
function union(a: LabelBounds, b: LabelBounds): LabelBounds {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
function pad(box: LabelBounds, amount: number): LabelBounds {
  return { x: box.x - amount, y: box.y - amount, width: box.width + 2 * amount, height: box.height + 2 * amount };
}
function contains(box: LabelBounds, p: RenderPoint): boolean {
  return p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
}
function segmentHits(box: LabelBounds, a: RenderPoint, b: RenderPoint): boolean {
  let low = 0, high = 1;
  for (const axis of ["x", "y"] as const) {
    const delta = b[axis] - a[axis], min = box[axis], max = min + box[axis === "x" ? "width" : "height"];
    if (delta === 0) { if (a[axis] < min || a[axis] > max) return false; continue; }
    const first = (min - a[axis]) / delta, second = (max - a[axis]) / delta;
    low = Math.max(low, Math.min(first, second)); high = Math.min(high, Math.max(first, second));
    if (low > high) return false;
  }
  return true;
}
function angleOnArc(angle: number, primitive: RenderPrimitive): boolean {
  if (primitive.kind !== "arc") return true;
  const start = primitive.startAngle!, sweep = primitive.endAngle! - start, tau = 2 * Math.PI;
  const along = (((sweep < 0 ? start - angle : angle - start) % tau) + tau) % tau;
  return Math.abs(sweep) >= tau || along <= Math.abs(sweep) + 1e-12;
}
function ringHits(box: LabelBounds, primitive: RenderPrimitive): boolean {
  const centre = primitive.points[0]!, radius = primitive.radius!;
  const start = primitive.startAngle ?? 0;
  if (contains(box, { x: centre.x + radius * Math.cos(start), y: centre.y + radius * Math.sin(start) })) return true;
  for (const [axis, values] of [["x", [box.x, box.x + box.width]], ["y", [box.y, box.y + box.height]]] as const) {
    for (const value of values) {
      const distance = value - centre[axis];
      if (Math.abs(distance) > radius) continue;
      const other = Math.sqrt(Math.max(0, radius * radius - distance * distance));
      for (const sign of [-1, 1]) {
        const p = axis === "x" ? { x: value, y: centre.y + sign * other } : { x: centre.x + sign * other, y: value };
        if (contains(box, p) && angleOnArc(Math.atan2(p.y - centre.y, p.x - centre.x), primitive)) return true;
      }
    }
  }
  return false;
}
function polygonContains(points: RenderPoint[], p: RenderPoint): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Blank slots cannot erase even an owner's stroke, an arrow tip, or a deferred label. */
function inkHits(box: LabelBounds, primitive: RenderPrimitive): boolean {
  const width = typeof primitive.provenance?.strokeWidth === "number" ? primitive.provenance.strokeWidth : 2;
  const expanded = pad(box, width / 2 + 0.01);
  if (primitive.kind === "point") {
    const p = primitive.points[0]!, radius = primitive.radius ?? 2;
    if (primitive.provenance?.pointStyle === "open") return ringHits(expanded, { ...primitive, kind: "circle", radius });
    return Math.hypot(Math.max(expanded.x - p.x, 0, p.x - expanded.x - expanded.width), Math.max(expanded.y - p.y, 0, p.y - expanded.y - expanded.height)) <= radius;
  }
  if (primitive.kind === "circle" || primitive.kind === "arc") return ringHits(expanded, primitive);
  if (strokePieces(primitive).some(([a, b]) => segmentHits(expanded, a, b))) return true;
  return (primitive.provenance?.fillOnly === true || primitive.provenance?.fillRole === "region") &&
    polygonContains(primitive.points, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}
function nearestAnchor(point: RenderPoint, marks: RenderPrimitive[]): RenderPoint {
  let best: RenderPoint | undefined, distance = Infinity;
  const offer = (candidate: RenderPoint) => {
    const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (d < distance) { best = candidate; distance = d; }
  };
  for (const primitive of marks) {
    const centre = primitive.points[0];
    if (!centre) continue;
    if (primitive.kind === "point") { offer(centre); continue; }
    if (primitive.kind === "circle" || primitive.kind === "arc") {
      const angle = Math.atan2(point.y - centre.y, point.x - centre.x), radius = primitive.radius!;
      const angles = angleOnArc(angle, primitive) ? [angle] : [primitive.startAngle!, primitive.endAngle!];
      angles.forEach(a => offer({ x: centre.x + radius * Math.cos(a), y: centre.y + radius * Math.sin(a) }));
      continue;
    }
    for (const [a, b] of strokePieces(primitive)) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      offer({ x: a.x + t * dx, y: a.y + t * dy });
    }
  }
  return best ?? fail("guide_label_owner_missing", "A label needs a rendered source owner");
}

/** @internal Call only after complete source/numeric/native compile proofs. */
export function deriveGeneratedSceneGuideLabels(input: {
  document: SceneDocument; scene: RenderScene; plan: TurnPlanV3 | null;
  pictureBounds: LabelBounds; boardToImage: GeneratedSceneGuideAffine;
  /** All actual strokes, including the renderer's arrowheads and dimension caps. */
  inkPrimitives: RenderPrimitive[];
}): GeneratedSceneGuideLabelSlot[] {
  const { document, scene, plan, pictureBounds, boardToImage, inkPrimitives } = input;
  const staged = plan ? deferVerifiedAnswerLabels(document, plan, scene) : null;
  const deferred = (key: string, id: string) => Array.isArray(staged?.source[key]) && staged.source[key].includes(id);
  const atomic = atomicGeneratedLabelBindings(document);
  const slots: GeneratedSceneGuideLabelSlot[] = [];
  for (const label of scene.primitives.filter(primitive => primitive.kind === "label")) {
    if (!label.text || !label.points[0] || !finiteBounds(label.provenance?.labelBounds)) {
      fail("guide_label_unplaced", "Every engine label requires text and its native reserved bounds", [label.entityId]);
    }
    const font = label.provenance?.fontPx ?? 24;
    if (font !== 24) fail("guide_label_font_unsupported", "Native label layout must prove the fixed 24 px board font", [label.entityId]);
    const bounds = label.provenance.labelBounds;
    const padding = label.provenance.labelPad ?? 4;
    if (typeof padding !== "number" || !Number.isFinite(padding) || padding < 0) fail("guide_label_unplaced", "Invalid native label padding", [label.entityId]);
    const glyphOrigin = { x: bounds.x + padding, y: bounds.y + padding };
    const measured = measureTextInkBounds(label.text, glyphOrigin.x, glyphOrigin.y, 24);
    if (!finiteBounds(measured)) fail("guide_label_unmeasurable", "The complete handwritten label must have measurable ink", [label.entityId]);
    const collision = label.provenance.labelCollisionBounds;
    const reservedBounds = union(finiteBounds(collision) ? union(bounds, collision) : bounds, pad(measured, 1));
    if (!boundsInside(reservedBounds, pictureBounds)) fail("guide_label_outside_picture", "A complete label space leaves the exact picture bounds", [label.entityId]);
    const annotation = document.annotations.find(item => item.id === label.provenance?.annotationId || item.id === label.id);
    const bound = atomic.get(label.id);
    const ownerIds = bound?.text === label.text ? [bound.entityId] : annotation?.targetIds ?? [label.entityId];
    const owners = [...new Set(ownerIds)].map(entityId => {
      const entity = document.entities.find(item => item.id === entityId);
      if (!entity) fail("guide_label_owner_missing", "A label owner must survive the source document", [entityId]);
      return { entityId, role: entity.role };
    });
    const leader = scene.primitives.find(primitive => primitive.id === `${label.id}_leader` && primitive.provenance?.labelLeader === true);
    if (label.provenance.usesLeader === true && !leader) fail("guide_label_leader_missing", "A native label connector cannot be dropped", ownerIds);
    const marks = scene.primitives.filter(primitive => ownerIds.includes(primitive.entityId) && primitive.kind !== "label" && !primitive.provenance?.labelLeader);
    const anchor = leader?.points[0] ?? nearestAnchor(label.points[0], marks);
    const sourceGiven = annotation?.quantityId !== undefined && Boolean(plan?.givens.some(quantity => quantity.id === annotation.quantityId)) ||
      typeof document.source.question === "string" && nativeGivenLabelTimingProved({ question: document.source.question, document, label });
    const answer = deferred("answerLabelEntityIds", label.entityId) || deferred("answerLabelPrimitiveIds", label.id) ||
      (annotation !== undefined && deferred("answerLabelAnnotationIds", annotation.id));
    // A timing decision never proves a value. Without a proved given binding,
    // defer all numeric text; this also covers operator-generated answers that
    // the optional plan omitted. Labels are still retained in the inventory.
    const numeric = /\p{N}/u.test(label.text) && !isPointIdentifierText(label.text);
    const timingBasis = answer ? "engine_answer_binding" : sourceGiven ? "source_given" : numeric ? "conservative_numeric_deferral" : "non_numeric";
    const role = answer || numeric && !sourceGiven ? "answer" : "setup";
    const board = { glyphOrigin, anchor, inkBounds: measured, reservedBounds, leaderPath: leader?.points ?? [] };
    for (const mark of inkPrimitives) if (inkHits(reservedBounds, mark)) {
      fail("guide_label_space_not_blank", `Source label '${label.text}' intersects engine mark ${mark.id}; no knockout or omitted stroke is allowed`, [label.entityId, mark.entityId]);
    }
    if (slots.some(slot => boundsOverlap(slot.board.reservedBounds, reservedBounds))) fail("guide_label_space_overlap", "Setup and deferred label spaces must remain disjoint", ownerIds);
    slots.push({ id: `slot:${label.id}`, primitiveId: label.id, entityId: label.entityId, groupId: label.groupId,
      owners, text: label.text, required: ownerIds.some(id => document.requiredEntityIds.includes(id)), role,
      revealAfter: role === "answer" ? "teaching_complete" : "setup", timingBasis, fontPx: 24, imageFontPx: 24 * boardToImage.xx,
      board, image: { glyphOrigin: guidePoint(boardToImage, glyphOrigin), anchor: guidePoint(boardToImage, anchor),
        inkBounds: guideBounds(boardToImage, measured), reservedBounds: guideBounds(boardToImage, reservedBounds),
        leaderPath: board.leaderPath.map(point => guidePoint(boardToImage, point)) } });
  }
  for (const primitive of scene.primitives) if (primitive.kind !== "label" && primitive.text &&
    !slots.some(slot => slot.entityId === primitive.entityId && slot.text === primitive.text)) {
    fail("guide_inline_label_unplaced", "Inline engine text requires its own proved 24 px label space", [primitive.entityId]);
  }
  return slots;
}

/** Retain the compiler's complete source caption in a separate board header.
 * It never enters the conditioning bitmap or replaces any scientific mark. */
export function deriveGeneratedSceneGuideCaption(input: {
  document: SceneDocument; scene: RenderScene; plan: TurnPlanV3 | null;
  pictureBounds: LabelBounds; canvas: { width: number; height: number };
}): GeneratedSceneGuideCaption | null {
  const text = input.scene.caption?.trim();
  if (!text) return null;
  const fontPx = 24, padding = 4, rowHeight = fontPx + 2 * padding;
  const picture = input.pictureBounds;
  const regions = [
    { x: picture.x, y: padding, width: picture.width, height: picture.y - 2 * padding },
    { x: picture.x, y: picture.y + picture.height + padding, width: picture.width,
      height: input.canvas.height - picture.y - picture.height - 2 * padding },
  ];
  const staged = input.plan ? deferVerifiedAnswerLabels(input.document, input.plan, input.scene) : input.document;
  const answer = input.document.annotations.some(annotation => annotation.text && text.includes(annotation.text) &&
    Array.isArray(staged.source.answerLabelAnnotationIds) && staged.source.answerLabelAnnotationIds.includes(annotation.id));
  const revealAfter = answer || /[\p{N}=≈]/u.test(text) ? "teaching_complete" : "setup";
  for (const region of regions) {
    if (region.height < rowHeight || region.width <= 2 * padding) continue;
    const lines: string[] = [];
    let line = "", tooWide = false;
    for (const word of text.split(/\s+/u)) {
      if (measureTextWidth(word, fontPx) + 2 * padding > region.width) { tooWide = true; break; }
      const next = line ? `${line} ${word}` : word;
      if (measureTextWidth(next, fontPx) + 2 * padding > region.width) { lines.push(line); line = word; }
      else line = next;
    }
    if (tooWide) continue;
    if (line) lines.push(line);
    if (!lines.length || lines.length * rowHeight > region.height) continue;
    const startY = region.y + (region.height - lines.length * rowHeight) / 2;
    const placed = placeLabels(lines.map((row, index) => ({
      labelId: `scene_caption_${index}`, entityId: `scene_caption_${index}`, text: row,
      anchor: { x: region.x + region.width / 2, y: startY + rowHeight * (index + 0.5) },
      viewBounds: region, pinToAnchor: true, useOwnerBounds: false, allowLeader: false,
    })), [], { fontHeightPx: fontPx, paddingPx: padding, maxLabelChars: 512,
      measureTextPx: measureTextWidth, measureTextInkBounds });
    if (!placed.ok || placed.placements.length !== lines.length) continue;
    const rows = placed.placements.map(placement => {
      const glyphOrigin = { x: placement.bounds.x + padding, y: placement.bounds.y + padding };
      const inkBounds = measureTextInkBounds(placement.text, glyphOrigin.x, glyphOrigin.y, fontPx);
      const reservedBounds = finiteBounds(placement.collisionBounds) ? placement.collisionBounds : placement.bounds;
      if (!finiteBounds(inkBounds) || !boundsInside(inkBounds, region) || !boundsInside(reservedBounds, region)) return null;
      return { text: placement.text, glyphOrigin, inkBounds, reservedBounds };
    });
    if (rows.every((row): row is NonNullable<typeof row> => row !== null)) {
      return { text, fontPx, revealAfter, board: { region, lines: rows } };
    }
  }
  fail("guide_caption_unplaced", "The complete native caption has no clear readable board header or footer space");
}
