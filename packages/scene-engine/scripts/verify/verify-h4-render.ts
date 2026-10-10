import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneAnnotation, SceneConstruction, SceneDocument, RenderPrimitive } from "../../src/types";

const artifactDirectory = process.env.H4_RENDER_DIR;
let artifactIndex = 0;
type Spec = [id: string, operator: string, kind: string, inputs: Record<string, unknown>, label?: string];
function scene(specs: Spec[], annotations: SceneAnnotation[] = []): SceneDocument {
  const ids = specs.map(([id]) => id);
  return {
    schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "Check source geometry and rendered annotations" }, quantities: [],
    entities: specs.map(([id, , kind, , label]) => ({ id, kind, role: "explicit source geometry", ...(label ? { label } : {}) })),
    constructions: specs.map(([id, operator, , inputs]): SceneConstruction => ({ id: `make_${id}`, operator, inputs, outputs: [id] })),
    relations: [], assertions: [], annotations, requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Show verified source geometry" }], teachingTimeline: [],
  };
}
function compile(document: SceneDocument): RenderPrimitive[] {
  const result = compileSceneDocument(document);
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  if (artifactDirectory) {
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(join(artifactDirectory, `${++artifactIndex}-${document.entities[0]!.id}.svg`), renderSceneSvg(result.renderScene, { title: document.entities[0]!.id, guides: true }));
  }
  return result.renderScene.primitives;
}
function reject(document: SceneDocument): void {
  const result = compileSceneDocument(document);
  assert.equal(result.ok, false, "Invalid authority must reject");
  assert.equal(result.renderScene, null, "Invalid authority must emit no partial ink");
}
function extent(primitives: RenderPrimitive[]) {
  const points = primitives.flatMap((p) => p.points);
  return { width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) };
}
const wave: Spec = ["wave", "harmonic_wave", "polyline", { amplitude: 1, waveNumber: Math.PI, angularFrequency: 0, phase: 0, phaseUnit: "rad", time: 0, xMin: 0, xMax: 4, units: { position: "m", amplitude: "m", time: "s" } }];
const cases: Array<[string, () => void]> = [
  ["18 slope parameters select the analytic chord", () => {
    const document = scene([["curve", "function_curve", "polyline", { expression: "x^2", xMin: 0, xMax: 2, samples: 129 }]], [{ id: "slope", kind: "slope_triangle", targetIds: ["curve"], curve: "curve", first: 0.5, second: 1.5 }]);
    const primitives = compile(document); const size = extent(primitives.filter(p => p.entityId === "slope"));
    assert(size.width > 100 && size.height > 100, `slope triangle too small: ${JSON.stringify(size)}`);
    for (const [first, second] of [[-1, 1.5], [0.5, 3], [1, 1], [[500, 100], 1.5]]) {
      const changed = structuredClone(document); Object.assign(changed.annotations[0]!, { first, second }); reject(changed);
    }
    const wrongUnit = structuredClone(document); wrongUnit.annotations[0]!.first = { value: 0.5, unit: "s" }; reject(wrongUnit);
    const referenced = structuredClone(document); referenced.quantities = [{ id: "first", value: 0.5, unit: "1" }]; referenced.annotations[0]!.first = "first"; assert(compile(referenced).some(p => p.entityId === "slope"));
    const wrongReference = structuredClone(referenced); wrongReference.quantities[0]!.unit = "s"; reject(wrongReference);
    const wrongTarget = structuredClone(document); wrongTarget.annotations[0]!.curve = "invented"; reject(wrongTarget);
    const defaultChord = structuredClone(document); delete defaultChord.annotations[0]!.curve; delete defaultChord.annotations[0]!.first; delete defaultChord.annotations[0]!.second;
    assert(extent(compile(defaultChord).filter(p => p.entityId === "slope")).width > 100);
  }],
  ["19 same-unit unscaled wave anchors support a dimension", () => {
    const document = scene([wave, ["crest", "wave_sample", "point", { wave: "wave", x: 0.5 }], ["next", "wave_sample", "point", { wave: "wave", x: 2.5 }], ["lambda", "dimension", "dimension", { start: "crest", end: "next" }, "λ"]]);
    assert(compile(document).some(p => p.entityId === "lambda" && p.kind === "dimension"));
    for (const overrides of [{ xScale: 2 }, { yScale: 2 }, { xScale: 2, yScale: 2 }, { units: { position: "m", amplitude: "cm", time: "s" } }]) {
      const changed = structuredClone(document); Object.assign(changed.constructions[0]!.inputs, overrides); reject(changed);
    }
    const copied = structuredClone(document);
    copied.entities.push({ id: "copy", kind: "point", role: "derived endpoint" });
    copied.constructions.push({ id: "copy_crest", operator: "midpoint", inputs: { a: "crest", b: "next" }, outputs: ["copy"] });
    copied.constructions[3]!.inputs.start = "copy"; reject(copied);
    const falseClaim = structuredClone(document); falseClaim.entities.find(e => e.id === "lambda")!.label = "λ=3 m"; reject(falseClaim);
  }],
  ["21 a tangent line through the contact can mark the radius right angle", () => {
    const document = scene([["O", "point", "point", { x: 0, y: 0 }], ["P", "point", "point", { x: 2, y: 0 }], ["circle", "circle", "circle", { center: "O", radius: 2 }], ["radius", "segment", "segment", { start: "O", end: "P" }], ["tangent", "circle_tangent_at", "line", { circle: "circle", point: "P", span: 4 }], ["right", "right_angle_mark", "right_angle_mark", { vertex: "P", a: "radius", b: "tangent" }]]);
    assert(compile(document).some(p => p.entityId === "right"));
    const off = structuredClone(document); off.constructions[4]!.operator = "line"; off.constructions[4]!.inputs = { start: [3, -2], end: [3, 2] }; reject(off);
    const finite = structuredClone(document); finite.constructions[4]!.operator = "segment"; finite.entities.find(e => e.id === "tangent")!.kind = "segment"; finite.constructions[4]!.inputs = { start: [2, -2], end: [2, 2] }; reject(finite);
    const wrongAngle = structuredClone(document); wrongAngle.constructions[4]!.operator = "line"; wrongAngle.constructions[4]!.inputs = { start: [0, -2], end: [4, 2] }; reject(wrongAngle);
  }],
  ["22 thin rectangles preserve visible regions and an explicit height axis", () => {
    const document = scene([["plate", "rectangle", "rectangle", { center: [0, 0], width: 0.1, height: 4, axis: "height" }], ["field", "vector", "vector", { start: [-3, 0], end: [-1, 0] }], ["extent", "point", "point", { x: 6, y: 0 }]]);
    document.assertions = [{ id: "normal", predicate: "perpendicular", entities: ["field", "plate"], expected: true, severity: "fatal" }];
    assert(compile(document).some(p => p.entityId === "plate"));
    const unbound = structuredClone(document); delete unbound.constructions[0]!.inputs.axis; reject(unbound);
    const wrongAxis = structuredClone(document); wrongAxis.constructions[0]!.inputs.axis = "width"; reject(wrongAxis);
    for (const width of [0, 0.00001]) { const collapsed = structuredClone(document); collapsed.constructions[0]!.inputs.width = width; reject(collapsed); }
    const onlyRegion = structuredClone(document); onlyRegion.assertions = []; delete onlyRegion.constructions[0]!.inputs.axis;
    assert(compile(onlyRegion).some(p => p.entityId === "plate"));
  }],
  ["22b thin native rectangles preserve separate visible edges", () => {
    const document = scene([["plate", "rectangle", "rectangle", { center: [0, 0], width: 0.1, height: 4 }], ["extent", "point", "point", { x: 6, y: 0 }], ["left", "point", "point", { x: -3, y: 0 }]]);
    const plate = compile(document).find(p => p.entityId === "plate")!;
    assert(extent([plate]).width >= 4 && extent([plate]).width < 12);
  }],
  ["25 sense arrow heads have board-visible dimensions", () => {
    const primitives = compile(scene([["wire", "segment", "segment", { start: [0, 0], end: [8, 0] }]], [{ id: "sense", kind: "sense", targetIds: ["wire"], style: { count: 2 } }]));
    const heads = primitives.filter(p => p.entityId === "sense" && p.points.length === 2 && p.points[0]!.y !== p.points[1]!.y);
    assert(heads.length >= 2); assert(heads.every(p => Math.hypot(p.points[1]!.x - p.points[0]!.x, p.points[1]!.y - p.points[0]!.y) >= 7), "sense arrow heads are invisible");
  }],
  ["26 an own badge does not reroute its connector", () => {
    const primitives = compile(scene([["wire", "connect", "connector", { start: [0, 0], end: [6, 0] }], ["current", "sign_badge", "vector", { target: "wire", sense: "positive", at: 0.5 }]]));
    assert.equal(primitives.find(p => p.entityId === "wire")?.points.length, 2, "wire routes around its own badge");
    const foreign = compile(scene([["wire", "connect", "connector", { start: [0, 0], end: [6, 0] }], ["crossing", "segment", "segment", { start: [3, -2], end: [3, 2] }], ["foreign", "sign_badge", "vector", { target: "crossing", sense: "positive", at: 0.5 }]]));
    assert.equal(foreign.find(p => p.entityId === "wire")?.points.length, 4, "foreign marks must remain routing obstacles");
  }],
  ["27 long diagonal and circle labels stay near their ink", () => {
    const named = compile(scene([["bisector", "line", "line", { start: [0, 0], end: [6, 4] }], ["name", "label", "label", { target: "bisector", text: "b" }, "b"]]));
    const name = named.find(p => p.entityId === "name" && p.kind === "label")!;
    const line = named.find(p => p.entityId === "bisector")!;
    const vertex = line.points[0]!;
    assert(Math.hypot(name.points[0]!.x - vertex.x, name.points[0]!.y - vertex.y) > 100, "line label operator stays at the construction vertex");
    for (const spec of [ ["line", "line", "line", { start: [0, 0], end: [6, 4] }, "l"], ["circle", "circle", "circle", { center: [0, 0], radius: 2 }, "C"] ] as Spec[]) {
      const primitives = compile(scene([spec])); const label = primitives.find(p => p.kind === "label")!; const target = primitives.find(p => p.entityId === spec[0] && p.kind !== "label")!;
      const bounds = label.provenance?.labelBounds as { x: number; y: number; width: number; height: number };
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const a = target.points[0]!, b = target.points.at(-1)!;
      const gap = target.kind === "circle" ? Math.abs(Math.hypot(center.x-a.x,center.y-a.y)-target.radius!) : Math.abs((b.x-a.x)*(center.y-a.y)-(b.y-a.y)*(center.x-a.x))/Math.hypot(b.x-a.x,b.y-a.y);
      assert(gap < 55, `${spec[0]} label is ${gap.toFixed(1)} px from ink`);
    }
  }],
  ["27b labels use visible lines when stored spans dwarf the plot", () => {
    for (const ratio of [1e3, 1e6]) {
      const document = scene([["region", "rectangle", "rectangle", { center: [0.003, ratio * 0.003], width: 0.002, height: ratio * 0.002 }], ["line", "line", "line", { start: [0.002, ratio * 0.002], direction: [1, 0] }], ["name", "label", "label", { target: "line", text: "V" }, "V"]]);
      const primitives = compile(document); const label = primitives.find(p => p.entityId === "name" && p.kind === "label")!;
      assert(label.points[0]!.x >= 410 && label.points[0]!.x <= 1150);
    }
  }],
  ["28 subunit geometry uses its actual span and remains centered", () => {
    const primitives = compile(scene([["small", "segment", "segment", { start: [0, 0], end: [0, 0.2] }]]));
    const points = primitives.find(p => p.entityId === "small")!.points;
    assert(Math.abs((points[0]!.y + points[1]!.y)/2 - 332.5) < 1, "subunit scene sits low on the board");
    assert(Math.abs(points[1]!.y-points[0]!.y) > 400, "subunit scene does not fit available height");
  }],
];
let failures = 0;
for (const [name, run] of cases) {
  if (process.argv[2] && !name.startsWith(process.argv[2])) continue;
  try { run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
if (failures) process.exitCode = 1;
