import { compileSceneDocument, type SceneDocument } from "../../src/index";

const scene: SceneDocument = {
  schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "mark every target" }, source: {}, quantities: [],
  entities: ["a", "b", "c", "d"].map((id) => ({ id, kind: "point", role: "construction helper point" })).concat([
    { id: "first", kind: "segment", role: "edge" }, { id: "second", kind: "segment", role: "edge" },
  ]),
  constructions: [["a", 0, 0], ["b", 4, 0], ["c", 0, 3], ["d", 4, 3]].map(([id, x, y]) => ({ id: `make_${id}`, operator: "point", inputs: { x, y }, outputs: [String(id)] })).concat([
    { id: "make_first", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["first"] },
    { id: "make_second", operator: "segment", inputs: { start: "c", end: "d" }, outputs: ["second"] },
  ]),
  relations: [], assertions: [], annotations: [], requiredEntityIds: ["first", "second"],
  revealGroups: [{ id: "setup", entityIds: ["first", "second"], dependsOn: [], narrationCue: "corresponding edges" }], teachingTimeline: [],
};
for (const kind of ["equal_tick", "parallel_mark"] as const) {
  const result = compileSceneDocument({ ...scene, annotations: [{ id: "mark", kind, targetIds: ["first", "second"], style: { count: 2 } }] });
  if (!result.ok || !result.renderScene) throw new Error(`mark compilation failed: ${JSON.stringify(result.report.issues)}`);
  for (const id of ["first", "second"]) {
    const edge = result.renderScene.primitives.find((p) => p.entityId === id && p.kind === "line")!;
    const marks = result.renderScene.primitives.filter((p) => p.provenance?.annotationId === "mark" && Math.abs(p.points.reduce((sum, point) => sum + point.y, 0) / p.points.length - edge.points[0]!.y) < 15);
    if (marks.length < 2) throw new Error(`${kind} silently omitted target ${id}`);
  }
  const staggered = compileSceneDocument({ ...scene,
    revealGroups: [
      { id: "first_group", entityIds: ["first"], dependsOn: [], narrationCue: "first edge" },
      { id: "second_group", entityIds: ["second"], dependsOn: ["first_group"], narrationCue: "second edge" },
    ],
    annotations: [{ id: "mark", kind, targetIds: ["first", "second"], style: { count: 2 } }],
  });
  if (!staggered.ok || !staggered.renderScene) throw new Error(`Staggered marks failed: ${JSON.stringify(staggered.report.issues)}`);
  const marks = staggered.renderScene.primitives.filter((p) => p.provenance?.annotationId === "mark");
  for (const id of ["first", "second"]) {
    const edge = staggered.renderScene.primitives.find((p) => p.entityId === id && p.kind === "line")!;
    const attached = marks.filter((p) => p.groupId === edge.groupId);
    const expectedCount = kind === "parallel_mark" ? 4 : 2;
    if (attached.length !== expectedCount || attached.some((p) =>
      Math.abs(p.points.reduce((sum, point) => sum + point.y, 0) / p.points.length - edge.points[0]!.y) > 5 ||
      p.points.some((point) => point.x < Math.min(edge.points[0]!.x, edge.points[1]!.x) || point.x > Math.max(edge.points[0]!.x, edge.points[1]!.x)),
    )) throw new Error(`${kind} must wait for target ${id}'s reveal group`);
  }
}
const invalid = compileSceneDocument({ ...scene,
  entities: [...scene.entities, { id: "p", kind: "point", role: "vertex", label: "P" }],
  constructions: [...scene.constructions, { id: "make_p", operator: "point", inputs: { x: 1, y: 1 }, outputs: ["p"] }],
  requiredEntityIds: [...scene.requiredEntityIds, "p"], revealGroups: [{ id: "setup", entityIds: [...scene.requiredEntityIds, "p"], dependsOn: [], narrationCue: "point" }],
  annotations: [{ id: "mark", kind: "equal_tick", targetIds: ["p"] }],
});
if (invalid.ok || !invalid.report.issues.some((i) => i.code === "annotation_geometry_unresolved")) throw new Error(`unsupported target must fail instead of silently losing its annotation: ${JSON.stringify(invalid.report.issues)}`);
for (const kind of ["equal_tick", "parallel_mark"] as const) {
  const bent = compileSceneDocument({ ...scene,
    entities: [...scene.entities, { id: "bend", kind: "polyline", role: "bent edge" }],
    constructions: [...scene.constructions, { id: "make_bend", operator: "polyline", inputs: { points: ["a", "c", "b"] }, outputs: ["bend"] }],
    requiredEntityIds: [...scene.requiredEntityIds, "bend"],
    revealGroups: [{ ...scene.revealGroups[0]!, entityIds: [...scene.requiredEntityIds, "bend"] }],
    annotations: [{ id: "mark", kind, targetIds: ["bend"] }],
  });
  if (bent.ok || !bent.report.issues.some((i) => i.code === "annotation_geometry_unresolved")) throw new Error(`${kind} must not mark an imaginary chord across a bent stroke`);
}
for (const kind of ["enclose", "highlight", "badge", "trace"] as const) {
  const measured = compileSceneDocument({ ...scene,
    entities: [...scene.entities, { id: "length", kind: "dimension", role: "measured length" }],
    constructions: [...scene.constructions, { id: "make_length", operator: "dimension", inputs: { start: "a", end: "b" }, outputs: ["length"] }],
    requiredEntityIds: [...scene.requiredEntityIds, "length"],
    revealGroups: [{ ...scene.revealGroups[0]!, entityIds: [...scene.requiredEntityIds, "length"] }],
    annotations: [{ id: "mark", kind, targetIds: ["length"] }],
  });
  if (!measured.ok || !measured.renderScene) throw new Error(`${kind} dimension failed: ${JSON.stringify(measured.report.issues)}`);
  const bar = measured.renderScene.primitives.find((p) => p.entityId === "length" && p.kind === "dimension")!;
  const marks = measured.renderScene.primitives.filter((p) => p.provenance?.annotationId === "mark");
  if (!marks.length || marks.some((p) => p.points.some((point) => point.x < 400 || point.y < 50))) throw new Error(`${kind} must use dimension ink instead of empty origin bounds`);
  if (kind === "enclose" || kind === "highlight") {
    const bounds = marks[0]!.points;
    if (!bar.points.every((point) => point.x >= Math.min(...bounds.map((p) => p.x)) && point.x <= Math.max(...bounds.map((p) => p.x)) && point.y >= Math.min(...bounds.map((p) => p.y)) && point.y <= Math.max(...bounds.map((p) => p.y)))) throw new Error(`${kind} must surround its actual dimension bar`);
  }
}
const hiddenAnchor = compileSceneDocument({ ...scene,
  revealGroups: [{ ...scene.revealGroups[0]!, entityIds: [...scene.requiredEntityIds, "a"] }],
  annotations: [{ id: "point_box", kind: "enclose", targetIds: ["a"] }],
});
if (!hiddenAnchor.ok || !hiddenAnchor.renderScene) throw new Error(`Hidden verified point must remain an annotation anchor: ${JSON.stringify(hiddenAnchor.report.issues)}`);
if (hiddenAnchor.renderScene.primitives.some((p) => p.entityId === "a")) throw new Error("Using a construction point as an annotation anchor must not add a visible helper dot");
for (const kind of ["enclose", "highlight", "loop"] as const) {
  const result = compileSceneDocument({ ...scene,
    entities: [...scene.entities, { id: "ring", kind: "circle", role: "circle" }],
    constructions: [...scene.constructions, { id: "make_ring", operator: "circle", inputs: { center: "a", radius: 2 }, outputs: ["ring"] }],
    requiredEntityIds: [...scene.requiredEntityIds, "ring"], revealGroups: [{ ...scene.revealGroups[0]!, entityIds: [...scene.requiredEntityIds, "ring"] }],
    annotations: [{ id: "mark", kind, targetIds: ["ring"] }],
  });
  if (!result.ok || !result.renderScene) throw new Error(`${kind} circle: ${JSON.stringify(result.report.issues)}`);
  const ring = result.renderScene.primitives.find((p) => p.entityId === "ring" && p.kind === "circle")!;
  const mark = result.renderScene.primitives.find((p) => p.provenance?.annotationId === "mark")!;
  const center = ring.points[0]!;
  const radius = ring.radius!;
  if (Math.min(...mark.points.map((p) => p.x)) > center.x - radius || Math.max(...mark.points.map((p) => p.x)) < center.x + radius || Math.min(...mark.points.map((p) => p.y)) > center.y - radius || Math.max(...mark.points.map((p) => p.y)) < center.y + radius) throw new Error(`${kind} must cover the circular stroke, not just its centre`);
}
console.log("verify-annotation-target-precision: every tick/parallel target marked, unsupported marks fail closed");
