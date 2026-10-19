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

/** A document the validator must refuse, and that must not compile either. */
function expectRefused(raw: unknown, code: string, label: string): void {
  check(codes(raw).includes(code), `${label}: expected ${code}, got ${codes(raw).join(",") || "no fatal issue"}`);
  const result = compileSceneDocument(raw as SceneDocument);
  check(!result.ok, `${label}: must not compile`);
}
{
  // The triangle ABOVE the rising line, between the graph and a horizontal
  // guide at 20 m/s, is not the area under the graph.
  const raw = graphDocument({
    constructions: [polylineGraph.construction, zeroCurve.construction,
      { id: "make_guide", operator: "polyline", inputs: { points: ["top0", "p1"] }, outputs: ["guide"] },
      { id: "make_area", operator: "polygon", inputs: { points: ["p0", "p1", "top0"] }, outputs: ["area"] }],
    entities: [polylineGraph.entity, zeroCurve.entity, { id: "guide", kind: "polyline", role: "guide line at 20 m/s" },
      { id: "area", kind: "polygon", role: "shaded area under the v against t graph" }],
  });
  expectRefused(raw, "function_region_requires_deterministic_operator", "the triangle between the graph and a guide polyline above it");
}
{
  // Under a constant curve y = 20 the full rectangle is a region, but the
  // v against t graph runs through it, so it is not the area under that graph.
  const raw = graphDocument({
    constructions: [polylineGraph.construction, zeroCurve.construction,
      { id: "make_top", operator: "function_curve", inputs: { expression: "20", variable: "x", xMin: 0, xMax: 10, samples: 17 }, outputs: ["top"] },
      { id: "make_area", operator: "polygon", inputs: { points: ["p0", "f2", "p2", "top0"] }, outputs: ["area"] }],
    entities: [polylineGraph.entity, zeroCurve.entity, { id: "top", kind: "polyline", role: "line v = 20 m/s" },
      { id: "area", kind: "polygon", role: "shaded area under the v against t graph" }],
  });
  expectRefused(raw, "function_region_requires_deterministic_operator", "the full rectangle under a constant curve y = 20 that the graph crosses");
}
{
  // Two cars on one v against t graph: car A speeds up from 0 to 20 m/s in
  // 4 s then holds 20 m/s, car B holds 10 m/s. B passes under A's region, but
  // a motion graph is a declared quantity, never a guide, so the polygon that
  // is exactly the area under A is still that area.
  const raw = graphDocument({
    constructions: [
      { id: "make_car_a", operator: "motion_graph", inputs: { quantity: "velocity", points: [[0, 0], [4, 20], [10, 20]], timeScale: 1, ordinateScale: 1 }, outputs: ["car_a"] },
      { id: "make_car_b", operator: "motion_graph", inputs: { quantity: "velocity", points: [[0, 10], [10, 10]], timeScale: 1, ordinateScale: 1 }, outputs: ["car_b"] },
      { id: "make_area", operator: "polygon", inputs: { points: ["p0", "p1", "p2", "f2"] }, outputs: ["area"] }],
    entities: [{ id: "car_a", kind: "polyline", role: "velocity of car A against time" },
      { id: "car_b", kind: "polyline", role: "velocity of car B against time" },
      { id: "area", kind: "polygon", role: "area under car A's v against t graph" }],
  });
  check(codes(raw).length === 0, `two cars: the polygon exactly under car A must be accepted, got ${codes(raw).join(",")}`);
  const scene = compiled(raw, "two cars, area under car A");
  if (scene) expectRegionUnderGraph(scene, "two cars", "car_a", "area");
}
{
  // The full bounding rectangle, with a role whose region word is joined by
  // an underscore ("shaded_area") or names the quantity instead
  // ("displacement under the graph"), is still not the area under the graph.
  for (const role of ["shaded_area", "displacement under the graph"]) {
    const raw = graphDocument({
      constructions: [polylineGraph.construction,
        { id: "make_area", operator: "polygon", inputs: { points: ["p0", "f2", "p2", "top0"] }, outputs: ["area"] }],
      entities: [polylineGraph.entity, { id: "area", kind: "polygon", role }],
    });
    expectRefused(raw, "function_region_requires_deterministic_operator", `the bounding rectangle with role "${role}"`);
  }
}
{
  // The same rectangle on corners redeclared under new ids, so it shares no
  // point id with the polyline graph; two of its corners lie on the graph.
  const raw = graphDocument({
    constructions: [polylineGraph.construction,
      { id: "make_c0", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["c0"] },
      { id: "make_c1", operator: "point", inputs: { x: 10, y: 0, coordinateSpace: "world" }, outputs: ["c1"] },
      { id: "make_c2", operator: "point", inputs: { x: 10, y: 20, coordinateSpace: "world" }, outputs: ["c2"] },
      { id: "make_c3", operator: "point", inputs: { x: 0, y: 20, coordinateSpace: "world" }, outputs: ["c3"] },
      { id: "make_area", operator: "polygon", inputs: { points: ["c0", "c1", "c2", "c3"] }, outputs: ["area"] }],
    entities: [polylineGraph.entity,
      ...["c0", "c1", "c2", "c3"].map((id) => ({ id, kind: "point" as const, role: `corner ${id}` })),
      { id: "area", kind: "polygon", role: "area under the v against t graph" }],
  });
  expectRefused(raw, "function_region_requires_deterministic_operator", "the bounding rectangle on redeclared corners");
}
{
  // A motion graph drawn at 0.4 board units per second: a zero curve written
  // in seconds (0 to 4 s) is compared in board units, so the "0 to 4 s"
  // region would span the whole 10 s graph.
  const raw = graphDocument({
    constructions: [
      { id: "make_graph", operator: "motion_graph", inputs: { quantity: "velocity", points: [[0, 0], [4, 20], [10, 20]], timeScale: 0.4, ordinateScale: 1 }, outputs: ["graph"] },
      { id: "make_zero", operator: "function_curve", inputs: { expression: "0", variable: "x", xMin: 0, xMax: 4, samples: 17 }, outputs: ["zero"] },
      { id: "make_area", operator: "function_region", inputs: { upper: "graph", lower: "zero" }, outputs: ["area"] },
    ],
    entities: [polylineGraph.entity, zeroCurve.entity, { id: "area", kind: "polygon", role: "area under the v against t graph from 0 to 4 s" }],
  });
  expectRefused(raw, "invalid_function_region_reference", "function_region over a motion_graph with timeScale 0.4");
}
{
  // The same mismatch behind a layout space origin, which the validator
  // cannot read as world coordinates: the compiler must fail closed itself.
  const raw = graphDocument({
    constructions: [
      { id: "make_origin", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "layout" }, outputs: ["graph_origin"] },
      { id: "make_graph", operator: "motion_graph", inputs: { quantity: "velocity", points: [[0, 0], [4, 20], [9, 20]], origin: "graph_origin", timeScale: 1, ordinateScale: 1 }, outputs: ["graph"] },
      zeroCurve.construction,
      { id: "make_area", operator: "function_region", inputs: { upper: "graph", lower: "zero", xMin: 1, xMax: 5 }, outputs: ["area"] },
    ],
    entities: [{ id: "graph_origin", kind: "point", role: "graph origin" },
      polylineGraph.entity, zeroCurve.entity, { id: "area", kind: "polygon", role: "area under the v against t graph from 0 to 4 s" }],
  });
  check(codes(raw).length === 0, `layout space motion graph origin: the validator leaves it to the compiler, got ${codes(raw).join(",")}`);
  const result = compileSceneDocument(raw as SceneDocument);
  check(!result.ok, "function_region over a motion_graph whose origin sits at x = 1 must fail closed in the compiler");
}

/** World points added to a graph document, each with its own point entity. */
function extraPoints(points: Record<string, [number, number]>) {
  return {
    constructions: Object.entries(points).map(([id, [x, y]]) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] })),
    entities: Object.keys(points).map((id) => ({ id, kind: "point" as const, role: `point ${id}` })),
  };
}

/** The compiled region's share of its own bounding box, which an affine board mapping keeps. */
function boxShare(scene: NonNullable<ReturnType<typeof compiled>>, regionId: string): number {
  const region = scene.primitives.find((primitive) => primitive.entityId === regionId && (primitive.kind === "polygon" || primitive.kind === "rectangle"))?.points ?? [];
  const xs = region.map((point) => point.x);
  const ys = region.map((point) => point.y);
  return shoelace(region) / ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)));
}

const displacementRole = "area under the v-t graph = displacement";
{
  // u is not zero: v rises from 10 to 20 m/s in 4 s. The graph shares only
  // its end point p1 with the full rectangle 0 to 4 s by 0 to 20 m/s, which
  // shades 80 m where the displacement is 60 m.
  const extra = extraPoints({ u0: [0, 10] });
  const graph = { id: "make_graph", operator: "polyline", inputs: { points: ["u0", "p1"] }, outputs: ["graph"] };
  const wrong = graphDocument({
    constructions: [...extra.constructions, graph,
      { id: "make_area", operator: "polygon", inputs: { points: ["p0", "f1", "p1", "top0"] }, outputs: ["area"] }],
    entities: [...extra.entities, polylineGraph.entity, { id: "area", kind: "polygon", role: displacementRole }],
  });
  expectRefused(wrong, "function_region_requires_deterministic_operator", "u = 10 m/s: the rectangle sharing one vertex with the graph");
  const right = graphDocument({
    constructions: [...extra.constructions, graph,
      { id: "make_area", operator: "polygon", inputs: { points: ["p0", "u0", "p1", "f1"] }, outputs: ["area"] }],
    entities: [...extra.entities, polylineGraph.entity, { id: "area", kind: "polygon", role: displacementRole }],
  });
  check(codes(right).length === 0, `u = 10 m/s: the trapezium under the graph must be accepted, got ${codes(right).join(",")}`);
  const scene = compiled(right, "u = 10 m/s trapezium");
  if (scene) check(Math.abs(boxShare(scene, "area") - 60 / 80) < 0.005, `u = 10 m/s: the shaded area must be 60 of its 80 bounding box, got ${(boxShare(scene, "area") * 80).toFixed(2)}`);
}
{
  // A three point graph from u = 10 m/s, and the full 0 to 10 s by 20 m/s
  // rectangle on corners redeclared under new ids: only its corner (10, 20)
  // lies on the graph.
  const extra = extraPoints({ u0: [0, 10], c0: [0, 0], c1: [10, 0], c2: [10, 20], c3: [0, 20] });
  const graph = { id: "make_graph", operator: "polyline", inputs: { points: ["u0", "p1", "p2"] }, outputs: ["graph"] };
  const wrong = graphDocument({
    constructions: [...extra.constructions, graph,
      { id: "make_area", operator: "polygon", inputs: { points: ["c0", "c1", "c2", "c3"] }, outputs: ["area"] }],
    entities: [...extra.entities, polylineGraph.entity, { id: "area", kind: "polygon", role: displacementRole }],
  });
  expectRefused(wrong, "function_region_requires_deterministic_operator", "three point graph from u = 10 m/s: the rectangle on redeclared corners");
  const right = graphDocument({
    constructions: [...extra.constructions, graph,
      { id: "make_area", operator: "polygon", inputs: { points: ["c0", "u0", "p1", "c2", "c1"] }, outputs: ["area"] }],
    entities: [...extra.entities, polylineGraph.entity, { id: "area", kind: "polygon", role: displacementRole }],
  });
  check(codes(right).length === 0, `three point graph from u = 10 m/s: the region under it must be accepted, got ${codes(right).join(",")}`);
  const scene = compiled(right, "three point graph from u = 10 m/s");
  if (scene) check(Math.abs(boxShare(scene, "area") - 180 / 200) < 0.005, `three point graph from u = 10 m/s: the shaded area must be 180 of its 200 bounding box, got ${(boxShare(scene, "area") * 200).toFixed(2)}`);
}
{
  // Coordinate geometry on axes: triangle ABC with the median from A drawn
  // as a polyline, which is a graph of x. The triangle shares only A with it
  // and reaches past the median's x span, so it is never claimed as a region
  // under that graph, with or without a region word in its role.
  const extra = extraPoints({ a: [1, 1], b: [9, 1], c: [5, 9], m: [7, 5] });
  for (const role of ["triangle ABC", "shaded region of triangle ABC"]) {
    const raw = graphDocument({
      constructions: [...extra.constructions,
        { id: "make_median", operator: "polyline", inputs: { points: ["a", "m"] }, outputs: ["median"] },
        { id: "make_triangle", operator: "polygon", inputs: { points: ["a", "b", "c"] }, outputs: ["triangle"] }],
      entities: [...extra.entities, { id: "median", kind: "polyline", role: "median from A" }, { id: "triangle", kind: "polygon", role }],
    });
    check(codes(raw).length === 0, `triangle sharing one vertex with a median (role "${role}") must not be claimed, got ${codes(raw).join(",")}`);
  }
}
{
  // A motion graph drawn from an origin at (1, 2): its zero velocity line is
  // y = 2, so the polygon through the graph's own drawn points down to y = 2
  // is the area under it, and the same shape closed on y = 0 is not.
  const extra = extraPoints({ graph_origin: [1, 2], o0: [1, 0], o9: [10, 0], g9: [10, 2] });
  const graph = { id: "make_graph", operator: "motion_graph", inputs: { quantity: "velocity", points: [[0, 0], [4, 20], [9, 20]], origin: "graph_origin", timeScale: 1, ordinateScale: 1 }, outputs: ["graph"] };
  const drawn = extraPoints({ d1: [5, 22], d2: [10, 22] });
  const right = graphDocument({
    constructions: [...extra.constructions, ...drawn.constructions, graph,
      { id: "make_area", operator: "polygon", inputs: { points: ["graph_origin", "d1", "d2", "g9"] }, outputs: ["area"] }],
    entities: [...extra.entities, ...drawn.entities, polylineGraph.entity, { id: "area", kind: "polygon", role: displacementRole }],
  });
  check(codes(right).length === 0, `motion graph from origin (1, 2): the region down to its own zero line must be accepted, got ${codes(right).join(",")}`);
  const scene = compiled(right, "motion graph from origin (1, 2)");
  if (scene) check(Math.abs(boxShare(scene, "area") - 140 / 180) < 0.005, `motion graph from origin (1, 2): the shaded area must be 140 of its 180 bounding box, got ${(boxShare(scene, "area") * 180).toFixed(2)}`);
  const wrong = graphDocument({
    constructions: [...extra.constructions, ...drawn.constructions, graph,
      { id: "make_area", operator: "polygon", inputs: { points: ["o0", "graph_origin", "d1", "d2", "o9"] }, outputs: ["area"] }],
    entities: [...extra.entities, ...drawn.entities, polylineGraph.entity, { id: "area", kind: "polygon", role: displacementRole }],
  });
  expectRefused(wrong, "function_region_requires_deterministic_operator", "motion graph from origin (1, 2): the region closed on y = 0");
}

/** Shoelace area of a compiled region, in board pixels. */
function regionArea(scene: NonNullable<ReturnType<typeof compiled>>, regionId: string): number {
  const region = scene.primitives.find((primitive) => primitive.entityId === regionId && (primitive.kind === "polygon" || primitive.kind === "rectangle"))?.points ?? [];
  return shoelace(region);
}

{
  // The graphical derivation of s = ut + ½at²: v rises from u to v over t,
  // and the area under it is split by the line v = u into the rectangle ut
  // and the triangle ½at² above it. Each piece is a region of the graph, and
  // the two together are the whole area, so each is accepted when the other
  // is drawn too. Board corners are written in drawn units: a motion graph
  // at timeScale 2 puts t = 4 s at x = 8.
  type Form = { label: string; graph: Record<string, unknown>; xEnd: number; low: number; high: number; guide: boolean };
  const rising = (samples: unknown) => ({ id: "make_graph", operator: "motion_graph", inputs: { quantity: "velocity", points: samples, timeScale: 2, ordinateScale: 1 }, outputs: ["graph"] });
  const forms: Form[] = [];
  for (const guide of [false, true]) {
    forms.push({ label: `polyline${guide ? " with a guide at v = u" : ""}`, graph: { id: "make_graph", operator: "polyline", inputs: { points: ["s_u", "s_v"] }, outputs: ["graph"] }, xEnd: 4, low: 10, high: 20, guide });
    forms.push({ label: `motion_graph [t, value] at timeScale 2${guide ? " with a guide at v = u" : ""}`, graph: rising([[0, 10], [4, 20]]), xEnd: 8, low: 10, high: 20, guide });
    forms.push({ label: `motion_graph {t, value} at timeScale 2${guide ? " with a guide at v = u" : ""}`, graph: rising([{ t: 0, value: 10 }, { t: 4, value: 20 }]), xEnd: 8, low: 10, high: 20, guide });
  }
  // Slowing down from 20 to 10 m/s: the split line is the graph's last height.
  forms.push({ label: "motion_graph slowing down, split at its last height", graph: rising([[0, 20], [4, 10]]), xEnd: 8, low: 10, high: 20, guide: false });
  for (const form of forms) {
    const slowing = form.label.includes("slowing");
    const { xEnd, low, high } = form;
    const extra = extraPoints({
      s_o: [0, 0], s_e: [xEnd, 0], s_low_end: [xEnd, low], s_low_start: [0, low],
      s_u: [0, slowing ? high : low], s_v: [xEnd, slowing ? low : high],
    });
    const rectangle = { id: "make_rect", operator: "polygon", inputs: { points: ["s_o", "s_e", "s_low_end", "s_low_start"] }, outputs: ["rect"] };
    const triangle = slowing
      ? { id: "make_tri", operator: "polygon", inputs: { points: ["s_u", "s_v", "s_low_start"] }, outputs: ["tri"] }
      : { id: "make_tri", operator: "polygon", inputs: { points: ["s_u", "s_v", "s_low_end"] }, outputs: ["tri"] };
    const guide = form.guide ? [{ id: "make_guide", operator: "polyline", inputs: { points: ["s_low_start", "s_low_end"] }, outputs: ["guide"] }] : [];
    const guideEntity = form.guide ? [{ id: "guide", kind: "polyline" as const, role: "guide line at v = u" }] : [];
    const both = graphDocument({
      constructions: [...extra.constructions, form.graph, ...guide, rectangle, triangle] as SceneDocument["constructions"],
      entities: [...extra.entities, polylineGraph.entity, ...guideEntity,
        { id: "rect", kind: "polygon", role: "area = ut" }, { id: "tri", kind: "polygon", role: "area = ½at²" }],
    });
    check(codes(both).length === 0, `s = ut + ½at², ${form.label}: the rectangle and the triangle must both be accepted, got ${codes(both).join(",")}`);
    const scene = compiled(both, `s = ut + ½at², ${form.label}`);
    if (scene) {
      // ut = 10 × 4 = 40 m and ½at² = ½ × 2.5 × 16 = 20 m, so 2 to 1 on any board scale.
      const ratio = regionArea(scene, "rect") / regionArea(scene, "tri");
      check(Math.abs(ratio - 2) < 0.01, `s = ut + ½at², ${form.label}: ut must be twice ½at² on the board, got ${ratio.toFixed(3)}`);
    }
    // The rectangle alone, labelled as the whole displacement, is a quarter
    // short of it: the triangle that completes it is not drawn.
    const lone = graphDocument({
      constructions: [...extra.constructions, form.graph, ...guide, rectangle] as SceneDocument["constructions"],
      entities: [...extra.entities, polylineGraph.entity, ...guideEntity, { id: "rect", kind: "polygon", role: displacementRole }],
    });
    if (!form.guide) expectRefused(lone, "function_region_requires_deterministic_operator", `s = ut + ½at², ${form.label}: the lone ut rectangle as the whole displacement`);
  }
  {
    // A function curve is read only through function_region: the same two
    // pieces under v = 10 + 2.5t written as a curve are not split pieces.
    const extra = extraPoints({ s_o: [0, 0], s_e: [4, 0], s_low_end: [4, 10], s_low_start: [0, 10], s_v: [4, 20] });
    const raw = graphDocument({
      constructions: [...extra.constructions,
        { id: "make_curve", operator: "function_curve", inputs: { expression: "10 + 2.5*x", variable: "x", xMin: 0, xMax: 4, samples: 17 }, outputs: ["curve"] },
        { id: "make_rect", operator: "polygon", inputs: { points: ["s_o", "s_e", "s_low_end", "s_low_start"] }, outputs: ["rect"] },
        { id: "make_tri", operator: "polygon", inputs: { points: ["s_low_start", "s_v", "s_low_end"] }, outputs: ["tri"] }],
      entities: [...extra.entities, { id: "curve", kind: "polyline", role: "v against t curve" },
        { id: "rect", kind: "polygon", role: "area = ut" }, { id: "tri", kind: "polygon", role: "area = ½at²" }],
    });
    expectRefused(raw, "function_region_requires_deterministic_operator", "s = ut + ½at² pieces under a function_curve");
  }
}
{
  // Rectangles 0 to 4 s tall 15 and 25 m/s under a graph from (0, 10) to
  // (4, 20): neither has a corner on the graph, but both sit inside its x
  // range, and neither is the area under it.
  for (const height of [15, 25]) {
    const extra = extraPoints({ u0: [0, 10], r0: [0, 0], r1: [4, 0], r2: [4, height], r3: [0, height] });
    const raw = graphDocument({
      constructions: [...extra.constructions,
        { id: "make_graph", operator: "polyline", inputs: { points: ["u0", "p1"] }, outputs: ["graph"] },
        { id: "make_area", operator: "polygon", inputs: { points: ["r0", "r1", "r2", "r3"] }, outputs: ["area"] }],
      entities: [...extra.entities, polylineGraph.entity, { id: "area", kind: "polygon", role: displacementRole }],
    });
    expectRefused(raw, "function_region_requires_deterministic_operator", `a rectangle ${height} m/s tall with no corner on the graph`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
console.log("motion graph regions verified: recorded replays and synthetic graph regions come from the graph's own points");
