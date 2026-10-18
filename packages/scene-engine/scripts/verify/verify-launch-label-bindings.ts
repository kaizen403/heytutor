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

// Generic screen ownership: a distant label beside another stroke needs a tether.
const { validateLabelOwnerTruth } = await import("../../src/compile/labelOwnerTruth");
const ownerDoc = { entities: [{ id: "own", label: "length" }], annotations: [] } as unknown as import("../../src/types").SceneDocument;
const ownInk: import("../../src/types").RenderPrimitive[] = [
  { id: "own", entityId: "own", groupId: "g", kind: "line", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
  { id: "other", entityId: "other", groupId: "g", kind: "line", points: [{ x: 0, y: 100 }, { x: 100, y: 100 }] },
  { id: "text", entityId: "own", groupId: "g", kind: "label", text: "length", points: [{ x: 50, y: 90 }] },
];
assert.equal(validateLabelOwnerTruth(ownerDoc, ownInk).length, 1);
assert.equal(validateLabelOwnerTruth(ownerDoc, ownInk.map(p => p.kind === "label" ? { ...p, points: [{ x: 50, y: 10 }] } : p)).length, 0);
assert.equal(validateLabelOwnerTruth(ownerDoc, ownInk.map(p => p.kind === "label" ? { ...p, provenance: { usesLeader: true } } : p)).length, 0);

// Render primitive kinds must match the actual renderer (there is no "arrow" kind).
for (const kind of ["line", "polyline", "vector", "ray", "dimension"] as const) {
  assert.equal(validateLabelOwnerTruth(ownerDoc, ownInk.map(p => p.kind === "line" ? { ...p, kind } : p)).length, 1, `${kind} strokes retain attachment checks`);
}
const axes = { id: "other", entityId: "other", groupId: "g", kind: "axes" as const, points: [{ x: 0, y: 100 }, { x: 100, y: 100 }, { x: 200, y: 0 }, { x: 200, y: 100 }] };
assert.equal(validateLabelOwnerTruth(ownerDoc,[ownInk[0]!,axes,ownInk[2]!]).length,1,"coordinate axes compete with displaced line labels");
const ownAxes = { ...axes, id: "own", entityId: "own", points: [{x:-100,y:0},{x:100,y:0},{x:0,y:-100},{x:0,y:100}] };
const nearPhantom = { ...ownInk[1]!, points: [{x:40,y:-45},{x:60,y:-45}] };
assert.equal(validateLabelOwnerTruth(ownerDoc,[ownAxes,nearPhantom,{...ownInk[2]!,points:[{x:50,y:-50}]}]).length,1,"axes do not draw the diagonal between their separate strokes");
for (const kind of ["polygon","rectangle"] as const) {
  const box = { ...ownInk[0]!, kind, points: [{x:0,y:0},{x:200,y:0},{x:200,y:200},{x:0,y:200}] };
  assert.equal(validateLabelOwnerTruth(ownerDoc,[box,{...ownInk[1]!,points:[{x:-20,y:100},{x:-10,y:100}]},{...ownInk[2]!,points:[{x:-5,y:100}]}]).length,0,`${kind} closing edge retains its nearby label`);
  assert.equal(validateLabelOwnerTruth(ownerDoc,[box,{...ownInk[1]!,points:[{x:50,y:100},{x:150,y:100}]},{...ownInk[2]!,points:[{x:100,y:100}]}]).length,0,`${kind} interior names remain attached to their region`);
}
const semicircle = { ...ownInk[0]!, kind: "arc" as const, points:[{x:0,y:0}],radius:100,startAngle:0,endAngle:Math.PI };
assert.equal(validateLabelOwnerTruth(ownerDoc,[semicircle,{...ownInk[1]!,points:[{x:-20,y:-105},{x:20,y:-105}]},{...ownInk[2]!,points:[{x:0,y:-100}]}]).length,1,"an arc does not own the undrawn half of its circle");
assert.equal(validateLabelOwnerTruth(ownerDoc,[{...semicircle,kind:"circle"},ownInk[1]!,{...ownInk[2]!,points:[{x:0,y:0}]}]).length,0,"circle interior names remain attached");
assert.equal(validateLabelOwnerTruth(ownerDoc,ownInk.map(p=>p.kind === "label" ? {...p,points:[{x:50,y:21}]}:p)).length,0,"a 21px attachment is deliberately below the conservative ambiguity threshold");
const sideLabel = ownInk.map(p => p.kind === "label" ? { ...p, provenance: { annotationId: "side" } } : p);
assert.equal(validateLabelOwnerTruth(ownerDoc, sideLabel).length, 1, "model annotation identity alone is no attachment proof");
assert.equal(validateLabelOwnerTruth(ownerDoc, sideLabel, new Set(["side"])).length, 0, "a separately proved halfspace label need not hug its boundary stroke");

// A line's leader anchored inside a different body can name that body instead.
const body = { id: "body", entityId: "body", groupId: "g", kind: "circle" as const, points: [{x:50,y:0}], radius: 20 };
const tethered = { ...ownInk[2]!, id:"text", points:[{x:50,y:-100}], provenance:{usesLeader:true} };
const tether = { id:"text_leader", entityId:"own", groupId:"g", kind:"line" as const, points:[{x:50,y:0},{x:50,y:-80}], provenance:{labelLeader:true} };
assert.equal(validateLabelOwnerTruth(ownerDoc,[ownInk[0]!,body,tethered,tether]).length,1,"a line tether buried in another body is ambiguous");
assert.equal(validateLabelOwnerTruth(ownerDoc,[ownInk[0]!,{...body,points:[{x:150,y:0}]},tethered,tether]).length,0,"an unobstructed line attachment retains its leader");
assert.equal(validateLabelOwnerTruth(ownerDoc,[{...body,id:"own",entityId:"own"},tethered,tether]).length,0,"a region's own interior is a valid leader attachment");
