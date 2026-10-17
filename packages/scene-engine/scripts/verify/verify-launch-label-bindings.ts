import { strict as assert } from "node:assert";
import { compileSceneDocument as compileWithPolicy } from "../../src/compile/compiler";
const compileSceneDocument: typeof compileWithPolicy = (document, options) => compileWithPolicy(document, { ...options, yieldPolicy: "verified_parts" });
import type { SceneDocument } from "../../src/types";
const base: SceneDocument = { schemaVersion: "scene-document/v2", source: { question: "Show a marked crossing and an interval." }, visualDecision: { mode: "scene", reason: "Bindings." }, quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
function compile(d: SceneDocument) { d.requiredEntityIds = d.entities.map(e => e.id); d.revealGroups = [{ id: "all", entityIds: d.requiredEntityIds, dependsOn: [], narrationCue: "Bindings." }]; const r = compileSceneDocument(d); assert(r.ok && r.renderScene, JSON.stringify(r.report.issues)); return r.renderScene; }
for (const pointStyle of ["filled", "cross"] as const) {
    const d = structuredClone(base);
    d.entities = [{ id: "o", kind: "point", role: "crossing" }, { id: "ring", kind: "circle", role: "boundary" }];
    d.constructions = [{ id: "make_o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] }, { id: "make_ring", operator: "circle", inputs: { center: "o", radius: 3 }, outputs: ["ring"] }];
    d.annotations = [{ id: "crossing", kind: "endpoint", targetIds: ["o"], style: { pointStyle } }, { id: "name", kind: "label", targetIds: ["o"], text: "I" }];
    const scene = compile(d);
    assert(scene.primitives.find(p => p.id === "name")?.provenance?.usesLeader, "a crossing label must explicitly attach to its direction marker");
    const leader = scene.primitives.find(p => p.id === "name_leader")!;
    const point = scene.primitives.find(p => p.entityId === "o" && p.kind === "point")!;
    assert.deepEqual(leader.points[0], point.points[0]);
}
{
    const d = structuredClone(base);
    d.quantities = [{ id: "duration", symbol: "t_stage", value: 4, unit: "s" }];
    d.entities = [{ id: "a", kind: "point", role: "stage start" }, { id: "b", kind: "point", role: "stage end" }, { id: "stage", kind: "segment", role: "stage" }];
    d.constructions = [{ id: "make_a", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "world" }, outputs: ["a"] }, { id: "make_b", operator: "point", inputs: { x: 6, y: 0, coordinateSpace: "world" }, outputs: ["b"] }, { id: "make_stage", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["stage"] }];
    d.annotations = [{ id: "duration_label", kind: "callout", targetIds: ["a", "b"], text: "4 s", quantityId: "duration" }];
    const scene = compile(d);
    const label = scene.primitives.find(p => p.id === "duration_label")!;
    assert.equal(label.text, "t_stage=4 s");
    assert(label.provenance?.usesLeader);
    const leader = scene.primitives.find(p => p.id === "duration_label_leader")!;
    const line = scene.primitives.find(p => p.entityId === "stage" && p.kind === "line")!;
    assert(Math.abs(leader.points[0]!.x - (line.points[0]!.x + line.points[1]!.x) / 2) < 0.03, "interval annotation must attach to its span, not just the first endpoint");
    d.annotations[0]!.text = "t_stage = 4 s";
    const named = compile(d);
    const legacy = compileWithPolicy(d, { yieldPolicy: "off" });
    assert(legacy.ok && legacy.renderScene);
    assert.deepEqual(named.primitives, legacy.renderScene.primitives,
        "a named interval quantity keeps its established label placement");
}
{
    const d = structuredClone(base);
    d.entities = [{ id: "curve", kind: "polyline", role: "function" }, { id: "secant", kind: "line", role: "secant" }];
    d.constructions = [{ id: "curve_c", operator: "function_curve", inputs: { expression: "abs(x)", xMin: -2, xMax: 2 }, outputs: ["curve"] }, { id: "secant_c", operator: "curve_secant", inputs: { curve: "curve", first: -1, second: 0 }, outputs: ["secant"] }];
    d.annotations = [{ id: "name", kind: "label", targetIds: ["secant"], text: "left slope" }];
    const scene = compile(d);
    assert(scene.primitives.find(p => p.id === "name")?.provenance?.usesLeader, "a secant label must identify its original parameter interval");
    d.annotations=[]; d.entities[1]!.label="slope";
    const named=compile(d);assert(named.primitives.find(p=>p.id==="primitive_secant_label")?.provenance?.usesLeader,"named secants retain their parameter interval");
}
console.log("launch: crossing, interval and secant labels retain their exact owners");
