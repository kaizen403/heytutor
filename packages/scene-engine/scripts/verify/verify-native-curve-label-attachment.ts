import assert from "node:assert/strict";
import { attemptArchetypeScene, compileSceneDocument, obstaclesFromPrimitives, placeLabels, synthesizeFamilyScene, synthesizeLastResortScene, type RenderPoint, type SceneDocument } from "../../src/index";
import { createLeaderGeometryQuery } from "../../src/labels/leaderGeometryQuery";

function fixture(sign: number, offset: number): SceneDocument {
  const entities: SceneDocument["entities"] = [
    { id: "left", kind: "point", role: "reference end" }, { id: "right", kind: "point", role: "reference end" },
    { id: "origin", kind: "point", role: "reference point", label: "O" },
    { id: "curve", kind: "polyline", role: "curved path", label: "trajectory" },
    { id: "high", kind: "point", role: "curve point", label: "H" },
    { id: "direction", kind: "vector", role: "reference direction", label: "v₀" },
    { id: "component", kind: "vector", role: "reference direction", label: "v₀ₓ" },
  ];
  return {
    schemaVersion: "scene-document/v2", source: { question: "Show a named curved path and two references.", representationTier: "qualitative_verified", nonMetric: true },
    visualDecision: { mode: "scene", reason: "Native arch and reference geometry" }, quantities: [], entities,
    constructions: [
      { id: "make_left", operator: "point", inputs: { x: 0, y: offset, coordinateSpace: "world" }, outputs: ["left"] },
      { id: "make_right", operator: "point", inputs: { x: 12, y: offset, coordinateSpace: "world" }, outputs: ["right"] },
      { id: "make_origin", operator: "point", inputs: { x: 1, y: offset, coordinateSpace: "world" }, outputs: ["origin"] },
      { id: "make_curve", operator: "function_curve", inputs: { expression: `${offset}+(${sign})*((x-1)-0.125*(x-1)^2)`, variable: "x", xMin: 1, xMax: 9, samples: 81 }, outputs: ["curve"] },
      { id: "make_high", operator: "point", inputs: { x: 5, y: offset+sign*2, coordinateSpace: "world" }, outputs: ["high"] },
      { id: "make_direction", operator: "vector", inputs: { start: "origin", direction: [0.7071,sign*0.7071], length: 3 }, outputs: ["direction"] },
      { id: "make_component", operator: "vector", inputs: { start: "origin", direction: [1,0], length: 2.1213 }, outputs: ["component"] },
    ], annotations: [], relations: [], assertions: [
      { id: "origin_on_curve", predicate: "on", entities: ["origin", "curve"], expected: true, severity: "fatal" },
      { id: "high_on_curve", predicate: "function_value", entities: ["curve"], expected: {x: 5,y: offset+sign*2}, severity: "fatal" },
    ], requiredEntityIds: entities.map(e=>e.id),
    revealGroups: [
      { id: "setup", entityIds: ["left", "right", "origin", "direction", "component", "high"], dependsOn: [], narrationCue: "Show references." },
      { id: "path", entityIds: ["curve", "high"], dependsOn: ["setup"], narrationCue: "Show the curve." },
    ], teachingTimeline: [],
  };
}
function distance(point: RenderPoint, a: RenderPoint, b: RenderPoint): number {
  const dx=b.x-a.x,dy=b.y-a.y,squared=dx*dx+dy*dy;
  const t=squared ? Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/squared)) : 0;
  return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
}
let passed=0;
for(const sign of [1,-1]) for(const offset of [0,5]) for(const annotation of [false,true]) {
  const input=fixture(sign,offset);
  if(annotation) {
    delete input.entities.find(entity=>entity.id==="curve")!.label;
    input.annotations.push({id:"curve_name",kind:"label",targetIds:["curve"],text:"trajectory"});
  }
  const original=JSON.stringify(input);
  const result=compileSceneDocument(input);
  assert(result.ok && result.renderScene,JSON.stringify(result.report.issues));
  const curve=result.renderScene.primitives.find(p=>p.entityId==="curve"&&p.kind==="polyline")!;
  const label=result.renderScene.primitives.find(p=>p.entityId==="curve"&&p.kind==="label"&&p.text==="trajectory")!;
  assert(label,"The complete existing name must survive");
  const bounds=label.provenance!.labelBounds as {x:number;y:number;width:number;height:number};
  const corners=[{x:bounds.x,y:bounds.y},{x:bounds.x+bounds.width,y:bounds.y},
    {x:bounds.x,y:bounds.y+bounds.height},{x:bounds.x+bounds.width,y:bounds.y+bounds.height}];
  const pointToBox=(p:RenderPoint)=>Math.hypot(Math.max(bounds.x-p.x,0,p.x-bounds.x-bounds.width),Math.max(bounds.y-p.y,0,p.y-bounds.y-bounds.height));
  // Measure the text rectangle's gap, independently of layout scoring. A
  // long name's center moves as its width changes; its nearest edge does not.
  const nearest=Math.min(...curve.points.map(pointToBox),...corners.map(corner=>Math.min(...curve.points.slice(1).map((p,i)=>distance(corner,curve.points[i]!,p)))));
  const leaders=result.renderScene.primitives.filter(p=>p.entityId==="curve"&&p.provenance?.labelLeader===true);
  assert(nearest<=26 || leaders.some(l=>l.points.some(p=>Math.min(...curve.points.slice(1).map((q,i)=>distance(p,curve.points[i]!,q)))<1)),
    `A curved-path name must touch its own path by proximity or a proved leader, not the empty bounding box (${nearest}px)`);
  assert.equal(JSON.stringify(input),original,"Attachment cannot mutate geometry, source or names");
  passed++;
}
for(const kind of ["polygon","rectangle"] as const) {
  const entities: SceneDocument["entities"]=[{id:"shape",kind,role:"closed region",label:"region"}];
  const constructions: SceneDocument["constructions"] = kind==="polygon"
    ? [{id:"make_shape",operator:"polygon",inputs:{points:[[0,0],[6,0],[3,4]]},outputs:["shape"]}]
    : [{id:"make_center",operator:"point",inputs:{x:3,y:2,coordinateSpace:"world"},outputs:["center"]},
      {id:"make_shape",operator:"rectangle",inputs:{center:"center",width:6,height:4},outputs:["shape"]}];
  if(kind==="rectangle") entities.unshift({id:"center",kind:"point",role:"construction center",visibility:"hidden"});
  const document: SceneDocument={schemaVersion:"scene-document/v2",source:{question:"Show the declared native objects."},
    visualDecision:{mode:"scene",reason:"Independent closed-region preservation"},quantities:[],entities,constructions,
    annotations:[],relations:[],assertions:[],requiredEntityIds:entities.map(e=>e.id),
    revealGroups:[{id:"group",entityIds:entities.map(e=>e.id),dependsOn:[],narrationCue:"Show native objects."}],teachingTimeline:[]};
  const compiled=compileSceneDocument(document);
  assert(compiled.ok&&compiled.renderScene,JSON.stringify(compiled.report.issues));
  const label=compiled.renderScene.primitives.find(p=>p.kind==="label"&&p.entityId==="shape")!;
  // Frozen prechange positions from the independently compiled main fixture.
  assert.deepEqual(label.points,[{x:780,y:kind==="polygon"?570.5:94.5}],"Open-curve attachment must preserve closed-region labels");
  passed++;
}
for (const expression of ["2 + |x + 1|", "3 + |x - 2|"]) {
  // The first stem is an existing public repository preservation case.
  const question=`Draw a rough sketch for the curve y = ${expression}. Using integration, find the area of the region bounded by the curve y=${expression}, x=-4, x=3 and y=0.`;
  const scene=synthesizeFamilyScene({question,families:[]})??synthesizeLastResortScene({question,families:[]});
  assert(scene,"A complete native area figure must retain its long equation label");
  assert(scene.renderScene.primitives.some(p=>p.kind==="label"&&p.text?.includes("abs(")),"Equation text cannot be dropped to fit");
  passed++;
}
for (const question of [
  "Draw the third-harmonic standing wave in an open organ pipe.",
  "Draw a labelled diagram for Logic gates: OR, AND, NOT, NAND, and NOR.",
]) {
  // Existing public preservation cases: component outlines are not analytic curves.
  const result=attemptArchetypeScene({question});
  assert(result.scene,JSON.stringify(result.issues));
  passed++;
}
const detached=placeLabels([{entityId:"curve",anchor:{x:0,y:0},attachmentPath:[{x:-5,y:0},{x:0,y:1},{x:5,y:0}],
  text:"curve name",allowLeader:false,tetherPx:500,viewBounds:{x:80,y:-100,width:500,height:200}}],[]);
assert(!detached.ok,"A distant slot without a drawn leader must still obey native path attachment");
passed++;
for(const question of [
  "ΔH = -40 kJ/mol and the activation energy is 60 kJ/mol. A catalyst lowers the activation energy by 20 kJ/mol. Draw the numerical energy profile with and without catalyst.",
  "ΔH = -40 kJ and activation energy is 60 kJ. The catalyst lowers the activation energy by 20 kJ. Draw the numerical energy profile.",
]) {
  // Public preservation stems: two nearby curves must retain their full names.
  const result=synthesizeFamilyScene({question});
  assert(result?.renderScene,"Own-path attachment cannot erase an existing complete two-curve profile");
  assert(result.renderScene.primitives.some(p=>p.kind==="label"&&p.text==="with catalyst"),"Both complete native names must survive");
  const curveIds=new Set(result.document.entities.filter(entity=>entity.kind==="polyline").map(entity=>entity.id));
  const intersects=createLeaderGeometryQuery(obstaclesFromPrimitives(result.renderScene.primitives.filter(p=>p.kind!=="label"&&!p.provenance?.labelLeader)));
  for(const leader of result.renderScene.primitives.filter(p=>p.provenance?.labelLeader&&curveIds.has(p.entityId))) {
    assert(!intersects(leader.points),"An attached curve name cannot cross other verified strokes");
  }
  passed++;
}
console.log(`native-curve-label-attachment: ${passed}/17 passed`);
