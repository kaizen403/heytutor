import { compileSceneDocument, validateSceneDocument, type RenderPoint, type SceneDocument } from "../../src/index";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function scene(a: RenderPoint, b: RenderPoint, pathArms = false): SceneDocument {
  const ids = ["v", "a", "b", "va", "vb", "right"];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verify truthful right-angle marks" },
    source: { question: "Mark the angle between two verified arms." },
    quantities: [],
    entities: [
      { id: "v", kind: "point", role: "angle vertex" },
      { id: "a", kind: "point", role: "first arm endpoint" },
      { id: "b", kind: "point", role: "second arm endpoint" },
      { id: "va", kind: "segment", role: "first arm" },
      { id: "vb", kind: "segment", role: "second arm" },
      { id: "right", kind: "right_angle_mark", role: "right angle" },
    ],
    constructions: [
      { id: "make_v", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["v"] },
      { id: "make_a", operator: "point", inputs: a, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: b, outputs: ["b"] },
      { id: "make_va", operator: "segment", inputs: { start: "a", end: "v" }, outputs: ["va"] },
      { id: "make_vb", operator: "segment", inputs: { start: "v", end: "b" }, outputs: ["vb"] },
      { id: "make_right", operator: "right_angle_mark", inputs: { vertex: "v", a: pathArms ? "va" : "a", b: pathArms ? "vb" : "b" }, outputs: ["right"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Mark the angle." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Show the angle." }],
  };
}

for (const [a, b] of [
  [{ x: 3, y: 0 }, { x: 1, y: 2 }],
  [{ x: 1000, y: 0 }, { x: 0.001, y: 1 }],
  [{ x: 1, y: 0 }, { x: -1, y: 0 }],
] as Array<[RenderPoint, RenderPoint]>) {
  const candidate = scene(a, b);
  const validated = validateSceneDocument(candidate);
  assert(validated.document, "A structurally valid right-angle candidate must reach deterministic geometry validation.");
  const compiled = compileSceneDocument(validated.document);
  assert(!compiled.ok && compiled.renderScene === null, "Non-perpendicular arms must fail closed rather than display a false right-angle corner.");
  assert(compiled.report.issues.some((issue) => issue.code === "construction_failed" && issue.message.includes("perpendicular")), "The failure must identify the false right-angle claim.");
}

for (const [a, b, pathArms] of [
  [{ x: 4, y: 0 }, { x: 0, y: 3 }, false],
  [{ x: 2, y: 1 }, { x: -3, y: 6 }, false],
  [{ x: -4, y: 0 }, { x: 0, y: -3 }, true],
  [{ x: 1000, y: 0 }, { x: 0, y: 300 }, true],
] as Array<[RenderPoint, RenderPoint, boolean]>) {
  const validated = validateSceneDocument(scene(a, b, pathArms));
  assert(validated.document, `validation: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document);
  assert(compiled.ok && compiled.renderScene, `Perpendicular arms must compile: ${JSON.stringify(compiled.report.issues)}`);
  assert(compiled.renderScene.primitives.some((primitive) => primitive.entityId === "right" && primitive.points.length === 3), "A proven right angle must retain its corner marker.");
}
for (const [arcEnd, equal] of [[{ x: 0, y: 3 }, true], [{ x: 3, y: 3 }, false]] as Array<[RenderPoint, boolean]>) {
  const candidate = scene({ x: 4, y: 0 }, { x: 0, y: 3 });
  candidate.entities.push({ id: "arc_end", kind: "point", role: "comparison arm endpoint" }, { id: "arc_angle", kind: "angle_mark", role: "comparison angle" });
  candidate.constructions.push(
    { id: "make_arc_end", operator: "point", inputs: arcEnd, outputs: ["arc_end"] },
    { id: "make_arc_angle", operator: "angle_mark", inputs: { vertex: "v", a: "a", b: "arc_end" }, outputs: ["arc_angle"] },
  );
  candidate.requiredEntityIds.push("arc_end", "arc_angle");
  candidate.revealGroups[0]!.entityIds = [...candidate.requiredEntityIds];
  candidate.assertions.push({ id: "same_marked_angle", predicate: "equal_angle", entities: ["arc_angle", "right"], expected: true, severity: "fatal" });
  const compiled = compileSceneDocument(candidate);
  assert(compiled.ok === equal, `The equality proof must compare an arc's real angle with the square's proven 90°: ${JSON.stringify(compiled.report.issues)}`);
  if (!equal) assert(compiled.report.issues.some((issue) => issue.code === "assertion_failed"), "A 45° arc must fail equality with a 90° square by angle proof.");
}
console.log("right-angle precision verification passed");
