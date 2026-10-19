/**
 * The region under a motion graph comes from the graph's own points.
 *
 * Replays scene documents the live planner wrote for "a v against t graph
 * rising from 0 to 20 m/s in 4 s then flat to 10 s, with the area under it
 * shaded" (Accelute full lesson videos, 17 Oct 2026). Before this gate:
 *   - `function_region` refused a polyline graph as a boundary, so
 *     `upper: "graph"` was `invalid_function_region_reference`;
 *   - `function_value` refused a polyline graph (`invalid_function_assertion`);
 *   - a polygon that is exactly the trapezium under the graph was a "guessed
 *     polygon" (`function_region_requires_deterministic_operator`) whenever a
 *     y = 0 function_curve was present, while a wrong polygon such as the full
 *     bounding rectangle passed freely when no function_curve was present;
 *   - `motion_graph` refused samples written as [t, value] pairs
 *     (`invalid_motion_graph_points`).
 * Every region area below is measured on the compiled scene against the
 * integral of the compiled graph.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument, validateSceneDocument } from "../../src/index";
import type { SceneDocument } from "../../src/types";

type Point = { x: number; y: number };
type Row = { id: string; document: Record<string, unknown> };

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/motion-graph-regions-recorded.json"), "utf8")) as { rows: Row[] };
const recorded = new Map(fixture.rows.map((row) => [row.id, row.document]));
const failures: string[] = [];
const check = (condition: unknown, message: string) => { if (!condition) failures.push(message); };

function codes(raw: unknown): string[] {
  const validation = validateSceneDocument(raw);
  return validation.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
}

function compiled(raw: unknown, label: string) {
  const validation = validateSceneDocument(raw);
  if (!validation.document) {
    failures.push(`${label}: validation rejected ${codes(raw).join(",")}`);
    return null;
  }
  const result = compileSceneDocument(validation.document);
  if (!result.ok || !result.renderScene) {
    failures.push(`${label}: compile failed ${result.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => `${issue.code} ${issue.message}`).join("; ")}`);
    return null;
  }
  return result.renderScene;
}

function shoelace(points: Point[]): number {
  let twice = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    twice += point.x * next.y - next.x * point.y;
  });
  return Math.abs(twice) / 2;
}

/** Area between the compiled graph and the horizontal line through its first vertex, over [x0, x1]. */
function areaUnderGraph(graph: Point[], x0: number, x1: number): number {
  const baseline = graph[0]!.y;
  const at = (x: number) => {
    for (let index = 1; index < graph.length; index += 1) {
      const start = graph[index - 1]!;
      const end = graph[index]!;
      if (x >= start.x - 1e-9 && x <= end.x + 1e-9) return start.y + (end.y - start.y) * (x - start.x) / (end.x - start.x);
    }
    return Number.NaN;
  };
  const xs = [x0, ...graph.map((point) => point.x).filter((x) => x > x0 && x < x1), x1];
  let area = 0;
  for (let index = 1; index < xs.length; index += 1) {
    const left = xs[index - 1]!;
    const right = xs[index]!;
    area += (right - left) * ((baseline - at(left)) + (baseline - at(right))) / 2;
  }
  return area;
}

function expectRegionUnderGraph(scene: NonNullable<ReturnType<typeof compiled>>, label: string, graphId: string, regionId: string): void {
  const graph = scene.primitives.find((primitive) => primitive.entityId === graphId && primitive.kind === "polyline")?.points;
  const region = scene.primitives.find((primitive) => primitive.entityId === regionId && (primitive.kind === "polygon" || primitive.kind === "rectangle"))?.points;
  if (!graph || !region) {
    failures.push(`${label}: missing compiled graph ${graphId} or region ${regionId}`);
    return;
  }
  const xs = region.map((point) => point.x);
  const expected = areaUnderGraph(graph, Math.min(...xs), Math.max(...xs));
  const actual = shoelace(region);
  check(expected > 0 && Math.abs(actual - expected) <= expected * 0.005,
    `${label}: region ${regionId} area ${actual.toFixed(1)} px² is not the area under ${graphId} (${expected.toFixed(1)} px²)`);
}

// Recorded documents the live planner wrote.
check(!codes(recorded.get("p4c-t1/doc-4")).includes("invalid_motion_graph_points"),
  "p4c-t1/doc-4: motion_graph samples written as [t, value] pairs must be read, not rejected");
{
  const scene = compiled(recorded.get("p4c-t1/doc-5"), "p4c-t1/doc-5");
  if (scene) expectRegionUnderGraph(scene, "p4c-t1/doc-5", "graph", "area");
}
{
  const scene = compiled(recorded.get("p4c-t2/doc-4"), "p4c-t2/doc-4");
  if (scene) {
    expectRegionUnderGraph(scene, "p4c-t2/doc-4", "velocity_graph", "shaded_area");
    // 160 m of a 200 m rectangle: the triangle above the rising line is not shaded.
    const region = scene.primitives.find((primitive) => primitive.entityId === "shaded_area" && primitive.kind === "polygon")!.points;
    const xs = region.map((point) => point.x);
    const ys = region.map((point) => point.y);
    const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    check(Math.abs(shoelace(region) / box - 0.8) < 0.005, `p4c-t2/doc-4: shaded area must be 160/200 of its bounding rectangle, got ${(shoelace(region) / box).toFixed(3)}`);
    const highlight = scene.primitives.find((primitive) => primitive.provenance?.annotation === "highlight");
    check(highlight?.kind === "polygon" && highlight.points.length === region.length,
      "p4c-t2/doc-4: the highlight annotation must keep the region outline, not a bounding box");
  }
}
compiled(recorded.get("p4c-t4/doc-4"), "p4c-t4/doc-4 (function_value on a polyline graph)");
{
  const scene = compiled(recorded.get("p4c-t5/doc-6"), "p4c-t5/doc-6");
  if (scene) {
    expectRegionUnderGraph(scene, "p4c-t5/doc-6", "graph", "area1");
    expectRegionUnderGraph(scene, "p4c-t5/doc-6", "graph", "area2");
  }
}
/** Every hatch stroke lies inside the region it hatches, measured on the compiled scene. */
function expectHatchInsideRegions(scene: NonNullable<ReturnType<typeof compiled>>, raw: unknown, label: string): number {
  const annotations = (raw as { annotations?: Array<{ id: string; kind: string; targetIds: string[] }> }).annotations ?? [];
  let strokes = 0;
  for (const annotation of annotations.filter((candidate) => candidate.kind === "hatch")) {
    const region = scene.primitives.find((primitive) => primitive.entityId === annotation.targetIds[0] && (primitive.kind === "polygon" || primitive.kind === "rectangle"))?.points;
    if (!region) continue;
    const xs = region.map((point) => point.x);
    const ys = region.map((point) => point.y);
    for (const stroke of scene.primitives.filter((primitive) => primitive.provenance?.annotation === "hatch" && primitive.provenance?.annotationId === annotation.id)) {
      strokes += 1;
      const outside = stroke.points.find((point) =>
        point.x < Math.min(...xs) - 0.5 || point.x > Math.max(...xs) + 0.5 || point.y < Math.min(...ys) - 0.5 || point.y > Math.max(...ys) + 0.5);
      check(!outside, `${label}: hatch ${annotation.id} stroke reaches (${outside?.x.toFixed(1)}, ${outside?.y.toFixed(1)}) outside its region ${annotation.targetIds[0]}`);
    }
  }
  return strokes;
}
{
  const raw = recorded.get("p4c-t5/doc-6");
  const scene = compiled(raw, "p4c-t5/doc-6 hatch");
  if (scene) check(expectHatchInsideRegions(scene, raw, "p4c-t5/doc-6") > 0, "p4c-t5/doc-6: the hatch annotations must still draw strokes");
}
for (const id of ["p4c-t6/doc-4", "p4c-t6/doc-6"]) {
  const scene = compiled(recorded.get(id), id);
  if (scene) expectRegionUnderGraph(scene, id, "graph", "area");
}

// Synthetic programs around the same graph.
function graphDocument(options: {
  constructions: SceneDocument["constructions"];
  entities: SceneDocument["entities"];
  assertions?: SceneDocument["assertions"];
  annotations?: SceneDocument["annotations"];
}): Record<string, unknown> {
  const pointIds = ["p0", "p1", "p2", "f1", "f2", "top0"];
  const coordinates: Record<string, [number, number]> = { p0: [0, 0], p1: [4, 20], p2: [10, 20], f1: [4, 0], f2: [10, 0], top0: [0, 20] };
  const entities = [
    { id: "axes", kind: "axes" as const, role: "v against t axes" },
    ...pointIds.map((id) => ({ id, kind: "point" as const, role: `graph point ${id}` })),
    ...options.entities,
  ];
  const entityIds = entities.map((entity) => entity.id);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "v against t graph with the area under it shaded" },
    source: { question: "A car speeds up from 0 to 20 m/s in 4 s, then moves at 20 m/s until t = 10 s. Shade the area under the v against t graph." },
    quantities: [],
    entities,
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -1, xMax: 11, yMin: -2, yMax: 24 }, outputs: ["axes"] },
      ...pointIds.map((id) => ({ id: `make_${id}`, operator: "point", inputs: { x: coordinates[id]![0], y: coordinates[id]![1], coordinateSpace: "world" }, outputs: [id] })),
      ...options.constructions,
    ],
    relations: [],
    assertions: options.assertions ?? [],
    annotations: options.annotations ?? [],
    requiredEntityIds: entityIds,
    revealGroups: [{ id: "graph_group", entityIds, dependsOn: [], narrationCue: "The v against t graph and the area under it." }],
    teachingTimeline: [],
  };
}
const polylineGraph = {
  construction: { id: "make_graph", operator: "polyline", inputs: { points: ["p0", "p1", "p2"] }, outputs: ["graph"] },
  entity: { id: "graph", kind: "polyline" as const, role: "velocity against time graph" },
};
const zeroCurve = {
  construction: { id: "make_zero", operator: "function_curve", inputs: { expression: "0", variable: "x", xMin: 0, xMax: 10, samples: 17 }, outputs: ["zero"] },
  entity: { id: "zero", kind: "polyline" as const, role: "time axis" },
};

{
  // function_region bounded above by the polyline graph itself. 65 default
  // samples over [0, 10] never land on t = 4, so the corner survives only if
  // the region reads the graph's own vertices.
  const raw = graphDocument({
    constructions: [polylineGraph.construction, zeroCurve.construction,
      { id: "make_area", operator: "function_region", inputs: { upper: "graph", lower: "zero" }, outputs: ["area"] }],
    entities: [polylineGraph.entity, zeroCurve.entity, { id: "area", kind: "polygon", role: "area under the v against t graph" }],
  });
  const scene = compiled(raw, "function_region upper = polyline graph");
  if (scene) {
    expectRegionUnderGraph(scene, "function_region upper = polyline graph", "graph", "area");
    const corner = scene.primitives.find((primitive) => primitive.entityId === "graph")!.points[1]!;
    const region = scene.primitives.find((primitive) => primitive.entityId === "area" && primitive.kind === "polygon")!.points;
    check(region.some((point) => Math.hypot(point.x - corner.x, point.y - corner.y) < 1e-6),
      "function_region over a polyline graph must keep the graph's corner at (4 s, 20 m/s) as a vertex");
  }
}
{
  const raw = graphDocument({
    constructions: [
      { id: "make_graph", operator: "motion_graph", inputs: { quantity: "velocity", points: [[0, 0], [4, 20], [10, 20]], timeScale: 1, ordinateScale: 1 }, outputs: ["graph"] },
      zeroCurve.construction,
      { id: "make_area", operator: "function_region", inputs: { upper: "graph", lower: "zero", xMin: 0, xMax: 10 }, outputs: ["area"] },
    ],
    entities: [polylineGraph.entity, zeroCurve.entity, { id: "area", kind: "polygon", role: "area under the v against t graph" }],
    assertions: [{ id: "corner", predicate: "function_value", entities: ["graph"], expected: { x: 4, y: 20 }, severity: "fatal" }],
  });
  const scene = compiled(raw, "function_region upper = motion_graph with [t, value] samples");
  if (scene) expectRegionUnderGraph(scene, "function_region upper = motion_graph", "graph", "area");
}
{
  // The hand polygon that is exactly the trapezium under the graph's own points.
  const raw = graphDocument({
    constructions: [polylineGraph.construction, zeroCurve.construction,
      { id: "make_area", operator: "polygon", inputs: { points: ["p0", "p1", "p2", "f2", "f1"] }, outputs: ["area"] }],
    entities: [polylineGraph.entity, zeroCurve.entity, { id: "area", kind: "polygon", role: "area under the v against t graph" }],
  });
  check(!codes(raw).includes("function_region_requires_deterministic_operator"),
    "a polygon that is exactly the region under the polyline graph must be accepted");
}
for (const withZero of [false, true]) {
  // The full 0 to 10 s by 20 m/s rectangle is not the area under the graph.
  const raw = graphDocument({
    constructions: [polylineGraph.construction, ...(withZero ? [zeroCurve.construction] : []),
      { id: "make_area", operator: "polygon", inputs: { points: ["p0", "f2", "p2", "top0"] }, outputs: ["area"] }],
    entities: [polylineGraph.entity, ...(withZero ? [zeroCurve.entity] : []), { id: "area", kind: "polygon", role: "shaded area under the v against t graph" }],
  });
  check(codes(raw).includes("function_region_requires_deterministic_operator"),
    `the bounding rectangle of the graph must be refused as the area under it (${withZero ? "with" : "without"} a y = 0 curve)`);
}
{
  const raw = graphDocument({
    constructions: [polylineGraph.construction],
    entities: [polylineGraph.entity],
    assertions: [{ id: "wrong", predicate: "function_value", entities: ["graph"], expected: { x: 4, y: 12 }, severity: "fatal" }],
  });
  const validation = validateSceneDocument(raw);
  const result = validation.document ? compileSceneDocument(validation.document) : null;
  check(validation.document && result && !result.ok, "a function_value the polyline graph does not pass through must fail");
}
{
  const raw = graphDocument({
    constructions: [
      { id: "make_graph", operator: "polyline", inputs: { points: ["p0", "p2", "p1"] }, outputs: ["graph"] },
      zeroCurve.construction,
      { id: "make_area", operator: "function_region", inputs: { upper: "graph", lower: "zero" }, outputs: ["area"] },
    ],
    entities: [polylineGraph.entity, zeroCurve.entity, { id: "area", kind: "polygon", role: "area under the graph" }],
  });
  check(codes(raw).includes("invalid_function_region_reference"),
    "a polyline whose x does not strictly increase is not a graph and cannot bound a function_region");
}
{
  // A curved graph still needs function_region: a chord polygon is a guess.
  const raw = graphDocument({
    constructions: [
      { id: "make_curve", operator: "function_curve", inputs: { expression: "x^2/5", variable: "x", xMin: 0, xMax: 10, samples: 33 }, outputs: ["curve"] },
      { id: "make_area", operator: "polygon", inputs: { points: ["p0", "p2", "f2"] }, outputs: ["area"] },
    ],
    entities: [{ id: "curve", kind: "polyline", role: "curved graph" }, { id: "area", kind: "polygon", role: "area under the curve" }],
  });
  check(codes(raw).includes("function_region_requires_deterministic_operator"),
    "a chord polygon under a curved function graph must still be refused");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("motion graph regions verified: recorded replays and synthetic graph regions come from the graph's own points");
