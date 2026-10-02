import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import { attemptArchetypeScene } from "../../src/archetypes";
import { lensSectionOutline } from "../../src/compile/opticsSurfaces";
import type { SceneAssertion, SceneConstruction, SceneDocument } from "../../src/types";

let checks = 0;
const construction = (id: string, operator: string, inputs: Record<string, unknown>): SceneConstruction => ({ id: `make-${id}`, operator, inputs, outputs: [id] });
const base = [
  construction("O", "point", { x: 0, y: 0 }),
  construction("F", "space_frame", { origin: "O", scale: 2 }),
  construction("A", "space_point", { frame: "F", x: 0, y: 0, z: 0 }),
  construction("B", "space_point", { frame: "F", x: 2, y: 0, z: 0 }),
  // This point projects inside AB although it is not on the world segment.
  construction("P", "space_point", { frame: "F", x: 2, y: -1, z: 1 }),
];
function scene(constructions: SceneConstruction[], assertion: SceneAssertion): SceneDocument {
  const ids = constructions.flatMap((item) => item.outputs);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "Verify mathematical authority before drawing" }, source: {}, quantities: [],
    entities: constructions.map((item) => ({ id: item.outputs[0]!, kind: item.operator === "space_frame" ? "polyline" : item.operator.endsWith("segment") ? "segment" : "point", role: "explicit geometry" })),
    constructions, relations: [], assertions: [assertion], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Reveal verified geometry" }], teachingTimeline: [],
  };
}
function proof(predicate: string, entities: string[], expected: unknown): SceneAssertion {
  return { id: "proof", predicate, entities, expected, severity: "fatal" };
}
function verify(document: SceneDocument, accepted: boolean): void {
  const compiled = compileSceneDocument(document);
  assert.equal(compiled.ok, accepted, JSON.stringify(compiled.report.issues));
  assert.equal(compiled.renderScene !== null, accepted, "invalid mathematical authority must not emit partial ink");
  checks += 2;
}
verify(scene(base, proof("between", ["P", "A", "B"], true)), false);
verify(scene(base, proof("between", ["P", "A", "B"], false)), true);
for (const x of [0, 0.3, 1, 2]) {
  const correct = base.map((item) => item.outputs[0] === "P" ? { ...item, inputs: { frame: "F", x, y: 0, z: 0 } } : item);
  verify(scene(correct, proof("between", ["P", "A", "B"], true)), true);
}
verify(scene(base.map((item) => item.outputs[0] === "P" ? { ...item, inputs: { frame: "F", x: 3, y: 0, z: 0 } } : item), proof("between", ["P", "A", "B"], true)), false);
const foreign = [...base,
  construction("O2", "point", { x: 10, y: 0 }), construction("G", "space_frame", { origin: "O2", scale: 2 }),
  construction("Q", "space_point", { frame: "G", x: 1, y: 2, z: 3 }),
];
for (const expected of [0, 1, false]) verify(scene(foreign, proof("distance_ratio", ["A", "B", "P", "Q"], expected)), false);
verify(scene(base, proof("distance_ratio", ["A", "B", "A", "A"], false)), false);
const mixed = [...base, construction("AB", "space_segment", { frame: "F", a: "A", b: "B" }),
  construction("U", "point", { x: 0, y: 6 }), construction("V", "point", { x: 2, y: 6 }), construction("UV", "segment", { start: "U", end: "V" }),
];
for (const expected of [true, false]) verify(scene(mixed, proof("equal_length", ["AB", "UV"], expected)), false);
verify(scene(base, proof("same_side", ["P", "B", "A"], true)), false);
// World metadata must survive the producer boundary: a plain projected
// segment cannot become a supposedly measured world segment downstream.
const projected = [...base,
  construction("X", "space_point", { frame: "F", x: 1, y: 0, z: 0 }),
  construction("XY", "space_point", { frame: "F", x: 1, y: -1, z: 0 }),
  construction("S1", "segment", { start: "A", end: "X" }),
  construction("S2", "segment", { start: "A", end: "XY" }),
];
verify(scene(projected, proof("equal_length", ["S1", "S2"], true)), false);
for (const [operator, inputs, kind] of [
  ["line", { start: "A", end: "B" }, "line"],
  ["vector", { start: "A", end: "B" }, "vector"],
  ["translate", { point: "P", vector: [1, 0] }, "point"],
  ["rotate", { point: "P", center: "A", angle: 30 }, "point"],
  ["midpoint", { a: "A", b: "B" }, "point"],
] as const) {
  const bad = scene([...base, construction("derived", operator, inputs)], proof("exists", ["derived"], true));
  bad.entities.find((item) => item.id === "derived")!.kind = kind;
  verify(bad, false);
}
const frameVector = scene([...base, construction("derived", "vector", { start: [0, 0], direction: "F" })], proof("exists", ["derived"], true));
frameVector.entities.find((item) => item.id === "derived")!.kind = "vector";
verify(frameVector, false);
const planar = [construction("A", "point", { x: 0, y: 0 }), construction("B", "point", { x: 2, y: 0 }), construction("P", "point", { x: 1, y: 0 })];
verify(scene(planar, proof("between", ["P", "A", "B"], true)), true);

const lens = { center: { x: 0, y: 0 }, axisFrom: { x: -4, y: 0 }, axisTo: { x: 4, y: 0 }, radius1: 2, radius2: -2, halfHeight: 1 };
for (const thickness of [0.2, 0, -1, Infinity, NaN]) {
  assert.throws(() => lensSectionOutline({ ...lens, thickness })); checks++;
}
for (const [radius1, radius2] of [[2, -2], [-2, 2], [2, 3], [-2, -3]]) {
  const outline = lensSectionOutline({ ...lens, radius1: radius1!, radius2: radius2! });
  const count = outline.length / 2;
  for (let index = 0; index < count; index++) {
    const first = outline[index]!; const second = outline[outline.length - index - 1]!;
    assert(second.x > first.x, "lens surfaces must not cross");
    assert(Math.abs(first.y - second.y) < 1e-9); checks += 2;
  }
}
const lensConstructions = [construction("O", "point", { x: 0, y: 0 }), construction("axis", "line", { start: [-4, 0], end: [4, 0] }), construction("lens", "lens_section", { center: "O", axis: "axis", radius1: 2, radius2: -2, halfHeight: 1, thickness: 0.2 })];
const lensDocument = scene(lensConstructions, proof("exists", ["lens"], true));
lensDocument.entities.find((item) => item.id === "axis")!.kind = "line";
lensDocument.entities.find((item) => item.id === "lens")!.kind = "polygon";
verify(lensDocument, false);
delete lensConstructions[2]!.inputs.thickness;
verify(lensDocument, true);
const pointPlane = attemptArchetypeScene({question: "Find the distance of the point (2, 3, -1) from the plane 2x - y + 2z + 3 = 0, and show the point and plane."});
assert(pointPlane.scene, JSON.stringify(pointPlane.issues));
for (const delta of [0, 0.123, -0.27]) {
  const document = structuredClone(pointPlane.scene.document);
  document.constructions.find((item) => item.outputs.includes("plane"))!.inputs.d = Number(document.constructions.find((item) => item.outputs.includes("plane"))!.inputs.d) + delta;
  document.assertions.push(proof("on", ["N", "plane"], true));
  verify(document, true);
}
// Independently normalized physical arrows and anisotropic plots never prove
// physical lengths, including through generic constructions that erase metadata.
function displayScene(constructions: SceneConstruction[], assertion: SceneAssertion): SceneDocument {
  const document = scene(constructions, assertion);
  document.entities = constructions.flatMap((item) => item.outputs.map((id, index) => ({id, kind: item.operator === "set_partition" ? index < 2 ? "circle" : "label" : item.operator === "magnetic_force" || item.operator === "vector" ? "vector" : "point", role:"source-authoritative display"})));
  return document;
}
const normalized = [
  construction("force1", "magnetic_force", {charge:1,velocity:[1,0,0],magneticField:[0,0,1],units:{charge:"C",velocity:"m/s",magneticField:"T"},origin:[0,0],displayLength:5}),
  construction("force2", "magnetic_force", {charge:2,velocity:[1,0,0],magneticField:[0,0,1],units:{charge:"C",velocity:"m/s",magneticField:"T"},origin:[3,0],displayLength:5}),
];
verify(displayScene(normalized, proof("exists", ["force1","force2"], true)), true);
for (const expected of [true,false]) verify(displayScene(normalized, proof("equal_length", ["force1","force2"], expected)), false);
const copied = [...normalized, construction("copied", "vector", {start:[6,0],direction:"force1",length:5})];
verify(displayScene(copied, proof("equal_length", ["copied","force2"], true)), false);
const normalGlyph = [{...normalized[0]!,inputs:{...normalized[0]!.inputs,magneticField:[0,1,0]}}, construction("flat", "vector", {start:[3,0],direction:[1,0],length:5})];
verify(displayScene(normalGlyph, proof("exists", ["force1"], true)), true);
for (const expected of [true,false]) verify(displayScene(normalGlyph, proof("parallel", ["force1","flat"], expected)), false);
verify(displayScene([...normalGlyph,construction("copied","vector",{start:[6,0],direction:"force1",length:5})],proof("exists",["copied"],true)),false);
const sets: SceneConstruction[] = [{id:"sets",operator:"set_partition",inputs:{sets:[{name:"A",count:7},{name:"B",count:5}],intersections:[{sets:["A","B"],count:2}],universeCount:20,displayScale:2},outputs:["A","B","aOnly","bOnly","both","outside"]}];
verify(displayScene(sets,proof("exists",["A"],true)),true);
const fittedAnchors = compileSceneDocument(displayScene(sets,proof("exists",["A"],true)));
assert(fittedAnchors.renderScene);
for (const primitive of fittedAnchors.renderScene.primitives) for (const point of primitive.points) {
  assert(point.x >= 400 && point.x <= 1160 && point.y >= 55 && point.y <= 610, "derived label anchors and leaders fit within the diagram zone"); checks++;
}
verify(displayScene(sets,proof("degree",["A"],0)),false);
const normalizedComplex = [construction("O","point",{x:0,y:0}),construction("z","complex_point",{real:3,imaginary:4,displayScale:2})];
for (const [operator,inputs,kind] of [["dimension",{start:"O",end:"z"},"dimension"],["segment",{start:"O",end:"z"},"segment"],["vector",{start:"O",end:"z"},"vector"]] as const) {
  const document=scene([...normalizedComplex,construction("copy",operator,inputs)],proof("exists",["copy"],true));
  document.entities.find((entity)=>entity.id==="copy")!.kind=kind;
  document.entities.find((entity)=>entity.id==="copy")!.label="|z|=10";
  verify(document,false);
  delete document.entities.find((entity)=>entity.id==="copy")!.label;
  document.quantities.push({id:"false_modulus",value:10,unit:"1"});
  document.annotations.push({id:"false_value",kind:"label",targetIds:["copy"],quantityId:"false_modulus"});
  verify(document,false);
}
for (const literal of ["1e-400","-2e-999"]) {
  const point = scene([construction("P","point",{x:literal,y:1})],proof("exists",["P"],true));
  verify(point,false);
  point.constructions[0]!.inputs.x="tiny"; point.quantities.push({id:"tiny",value:literal,unit:"m"}); verify(point,false);
  point.constructions[0]!.inputs.x={value:literal}; verify(point,false);
}
for (const literal of ["0e-400","-0.000e-999","1e-300"]) verify(scene([construction("P","point",{x:literal,y:1})],proof("exists",["P"],true)),true);
console.log(`operator authority accuracy verification passed (${checks} checks)`);
