/** PRIVATE result provenance and native layout containment; no admission consumer. */
import type { RenderScene } from "../../types";
import { measureTextInkBounds } from "@heytutor/drawing";

type Box = { x: number; y: number; width: number; height: number };
// The audit always calls ordinary compileSceneDocument with no custom options.
// compiler.ts:295 declares this domain; AGENTS declares the containing board/zone.
export const NATIVE_LAYOUT_DOMAIN = Object.freeze({ x: 410, y: 55, width: 740, height: 555 });
const BOARD_DOMAIN: Box = { x: 0, y: 0, width: 1200, height: 700 };
const DIAGRAM_DOMAIN: Box = { x: 400, y: 0, width: 760, height: 700 };
// Native DRAW_LINE uses straight/polyline paths, round caps and joins. The
// whiteboard's 1.15px default shape width times maximum 1.6 instrument thickness
// gives this conservative radius (including the wider pen, not only pencil).
// No provenance strokeWidth or alternative path is supported by the graph audit.
const NATIVE_MAX_STROKE_RADIUS = 1.15 * 1.6 / 2;
const EPSILON = 0.00001;
function fail(reason: string): never { throw new Error(reason); }

/** Exact semantic descriptor equality, permitting only JSON's omission of
 * undefined optional compiler fields and object-key reorder. Paint/reveal array
 * order, all bounds, metadata and provenance remain exact. No getter/toJSON is
 * called, no supplied point is returned, and no emitter is reexecuted here. */
export function requireOrdinarySceneWitness(ordinary: RenderScene, witness: unknown): void {
  let visits = 0;
  const ancestors = new Set<object>();
  function descriptors(value: object, path: string): Record<string, PropertyDescriptor> {
    const proto = Object.getPrototypeOf(value);
    if (Object.getOwnPropertySymbols(value).length || (Array.isArray(value) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)) fail(`unsupported_scene_witness_data:${path}`);
    const fields = Object.getOwnPropertyDescriptors(value);
    for (const [key, d] of Object.entries(fields)) if (!("value" in d) || (!d.enumerable && !(Array.isArray(value) && key === "length"))) fail(`unsupported_scene_witness_data:${path}.${key}`);
    return fields;
  }
  function same(expected: unknown, actual: unknown, path: string): void {
    if (++visits > 20000) fail("unsupported_scene_witness_size");
    if (expected === null || typeof expected !== "object") {
      if (typeof actual === "number" && !Number.isFinite(actual)) fail(`unsupported_scene_witness_data:${path}`);
      if (expected !== actual) fail(`ordinary_scene_witness_mismatch:${path}`);
      return;
    }
    if (actual === null || typeof actual !== "object" || Array.isArray(expected) !== Array.isArray(actual)) fail(`ordinary_scene_witness_mismatch:${path}`);
    if (ancestors.has(actual)) fail(`unsupported_scene_witness_cycle:${path}`);
    ancestors.add(actual);
    const left = descriptors(expected, path), right = descriptors(actual, path);
    if (Array.isArray(expected) && left.length!.value !== right.length!.value) fail(`ordinary_scene_witness_mismatch:${path}.length`);
    for (const key of Object.keys(right)) if (!Object.hasOwn(left, key)) fail(`ordinary_scene_witness_mismatch:${path}.${key}`);
    for (const [key, d] of Object.entries(left)) {
      if (!Object.hasOwn(right, key)) { if (d.value === undefined) continue; fail(`ordinary_scene_witness_mismatch:${path}.${key}`); }
      same(d.value, right[key]!.value, `${path}.${key}`);
    }
    ancestors.delete(actual);
  }
  same(ordinary, witness, "scene");
}

function box(value: unknown, context: string): Box {
  if (value === null || typeof value !== "object" || Object.keys(value).sort().join("|") !== "height|width|x|y") fail(`invalid_compiled_bounds:${context}`);
  const b = value as Box;
  if (![b.x, b.y, b.width, b.height].every(n => typeof n === "number" && Number.isFinite(n)) || b.width < 0 || b.height < 0) fail(`invalid_compiled_bounds:${context}`);
  return b;
}
function contains(b: Box, domain: Box): boolean {
  return b.x >= domain.x - EPSILON && b.y >= domain.y - EPSILON && b.x + b.width <= domain.x + domain.width + EPSILON && b.y + b.height <= domain.y + domain.height + EPSILON;
}
function requireContained(b: Box, context: string): void {
  if (![NATIVE_LAYOUT_DOMAIN, BOARD_DOMAIN, DIAGRAM_DOMAIN].every(domain => contains(b, domain))) fail(`compiled_ink_outside_native_domain:${context}`);
}
function pointBox(points: readonly { x: number; y: number }[], context: string): Box {
  if (!points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) fail(`invalid_compiled_points:${context}`);
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
}
function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** Independent containment of the ordinary compiler result. Entity boxes are
 * recomputed from actual primitive points (labels legitimately have 0×0 anchor
 * boxes); text em/collision/actual handwriting ink is checked separately. This
 * does not trust equality with a supplied descriptor as a board-zone guarantee. */
export function requireSceneContainment(scene: RenderScene): void {
  const expected = new Map<string, Box>();
  for (const p of scene.primitives) {
    if (!["line", "rectangle", "label"].includes(p.kind)) fail(`unsupported_containment_primitive:${p.id}`);
    const bounds = pointBox(p.points, p.id);
    requireContained(bounds, `${p.id}:points`);
    expected.set(p.entityId, expected.has(p.entityId) ? union(expected.get(p.entityId)!, bounds) : bounds);
    if (p.kind === "label") {
      const em = box(p.provenance?.labelBounds, `${p.id}:labelBounds`);
      requireContained(em, `${p.id}:labelBounds`);
      if (p.provenance?.labelCollisionBounds !== undefined) requireContained(box(p.provenance.labelCollisionBounds, `${p.id}:labelCollisionBounds`), `${p.id}:labelCollisionBounds`);
      if (typeof p.text !== "string") fail(`unsupported_containment_label:${p.id}`);
      const ink = measureTextInkBounds(p.text, em.x + 4, em.y + 4, 24);
      if (ink) requireContained(box(ink, `${p.id}:measuredInk`), `${p.id}:measuredInk`);
    } else {
      if (p.kind === "line" && (p.points.length !== 2 || Math.hypot(p.points[1]!.x - p.points[0]!.x, p.points[1]!.y - p.points[0]!.y) < 2)) fail(`unsupported_native_stroke_path:${p.id}`);
      requireContained({ x: bounds.x - NATIVE_MAX_STROKE_RADIUS, y: bounds.y - NATIVE_MAX_STROKE_RADIUS, width: bounds.width + 2 * NATIVE_MAX_STROKE_RADIUS, height: bounds.height + 2 * NATIVE_MAX_STROKE_RADIUS }, `${p.id}:strokeInk`);
    }
  }
  if (!scene.entityBounds || Object.keys(scene.entityBounds).length !== expected.size || Object.keys(scene.entityBounds).some(id => !expected.has(id))) fail("compiled_entity_bounds_membership");
  for (const [id, computed] of expected) {
    const actual = box(scene.entityBounds[id], `${id}:entityBounds`);
    requireContained(actual, `${id}:entityBounds`);
    for (const key of ["x", "y", "width", "height"] as const) if (Math.abs(actual[key] - computed[key]) > EPSILON) fail(`compiled_entity_bounds_geometry:${id}`);
  }
}
