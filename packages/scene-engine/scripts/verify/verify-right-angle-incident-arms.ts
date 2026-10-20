import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument } from "../../src/index";

/** Authored native operator contract; incidence must hold without extra assertions. */
function fixture(endpoint = false): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "authored incident line arms" },
    source: { question: "Show the right angle of the constructed straight arms." }, quantities: [],
    entities: [
      ...["O", "A", "B", "C", "D"].map(id => ({ id, kind: "point", role: "constructed point" })),
      { id: "horizontal", kind: "segment", role: "first straight arm" }, { id: "vertical", kind: "segment", role: "second straight arm" },
      { id: "mark", kind: "right_angle_mark", role: "native angle proof" },
    ],
    constructions: [
      ...[["O", 0, 0], ["A", -2, 0], ["B", 2, 0], ["C", 0, -2], ["D", 0, 2]].map(([id, x, y]) =>
        ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [String(id)] })),
      { id: "make_horizontal", operator: "segment", inputs: { start: endpoint ? "O" : "A", end: "B" }, outputs: ["horizontal"] },
      { id: "make_vertical", operator: "segment", inputs: { start: endpoint ? "O" : "C", end: "D" }, outputs: ["vertical"] },
      { id: "make_mark", operator: "right_angle_mark", inputs: { vertex: "O", a: "horizontal", b: "vertical", size: 0.5, incidentLineArms: true }, outputs: ["mark"] },
    ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["horizontal", "vertical", "mark"],
    revealGroups: [{ id: "setup", entityIds: ["O", "A", "B", "C", "D", "horizontal", "vertical", "mark"], dependsOn: [], narrationCue: "Show the arms and their mark." }], teachingTimeline: [],
  };
}
interface Case { id: string; document: SceneDocument; draws: boolean }
function vary(id: string, draws: boolean, edit: (doc: SceneDocument) => void, endpoint = false): Case {
  const document = fixture(endpoint); edit(document); return { id, document, draws };
}
const input = (doc: SceneDocument, id: string) => doc.constructions.find(candidate => candidate.outputs.includes(id))!.inputs;
const cases: Case[] = [
  { id: "finite-interior-incidence", document: fixture(), draws: true },
  vary("infinite-straight-line-interior", true, doc => {
    doc.constructions.filter(c => ["horizontal", "vertical"].some(id => c.outputs.includes(id))).forEach(c => { c.operator = "line"; });
    doc.entities.filter(e => ["horizontal", "vertical"].includes(e.id)).forEach(e => { e.kind = "line"; });
  }),
  vary("incident-arm-input-aliases", true, doc => {
    const mark = input(doc, "mark"); mark.first = mark.a; mark.second = mark.b; delete mark.a; delete mark.b;
  }),
  vary("legacy-interior-remains-unsupported", false, doc => { delete input(doc, "mark").incidentLineArms; }),
  vary("explicit-false-retains-legacy-interior-rule", false, doc => { input(doc, "mark").incidentLineArms = false; }),
  vary("legacy-endpoint-remains-supported", true, doc => { delete input(doc, "mark").incidentLineArms; }, true),
  vary("point-away-from-owner-is-not-incidence", false, doc => { input(doc, "O").x = 0.25; }),
  vary("finite-extension-is-not-visible-incidence", false, doc => {
    input(doc, "O").x = 3; input(doc, "C").x = 3; input(doc, "D").x = 3;
  }),
  vary("ray-behind-origin-is-not-visible-incidence", false, doc => {
    doc.constructions.find(c => c.outputs.includes("horizontal"))!.operator = "ray";
    doc.entities.find(e => e.id === "horizontal")!.kind = "ray";
    input(doc, "horizontal").start = "B"; input(doc, "horizontal").end = "D";
    input(doc, "B").x = 1; input(doc, "B").y = 0; input(doc, "D").x = 2; input(doc, "D").y = 0;
    input(doc, "vertical").end = "A"; input(doc, "A").x = 0; input(doc, "A").y = 2;
  }),
  vary("ray-forward-interior-incidence", true, doc => {
    doc.constructions.find(c => c.outputs.includes("horizontal"))!.operator = "ray";
    doc.entities.find(e => e.id === "horizontal")!.kind = "ray";
    input(doc, "A").x = -1; input(doc, "B").x = 1;
  }),
  vary("nonperpendicular-incident-arms-are-rejected", false, doc => {
    input(doc, "C").x = -1; input(doc, "D").x = 1;
  }),
  vary("curved-polyline-is-not-a-straight-arm", false, doc => {
    const construction = doc.constructions.find(c => c.outputs.includes("horizontal"))!;
    construction.operator = "polyline"; construction.inputs = { points: [[-2, 0], [0, 0], [2, 1]] };
    doc.entities.find(e => e.id === "horizontal")!.kind = "polyline";
  }),
  vary("world-space-owner-cannot-be-flattened", false, doc => {
    doc.entities.push({ id: "space", kind: "polyline", role: "world frame" }, { id: "S", kind: "point", role: "world point" });
    doc.constructions.splice(5, 0,
      { id: "make_space", operator: "space_frame", inputs: { origin: "O" }, outputs: ["space"] },
      { id: "make_S", operator: "space_point", inputs: { frame: "space", x: 0, y: 0, z: 0 }, outputs: ["S"] });
    const construction = doc.constructions.find(c => c.outputs.includes("horizontal"))!;
    construction.operator = "space_line"; construction.inputs = { frame: "space", point: "S", direction: [1, 0, 0], tMin: -2, tMax: 2 };
    doc.entities.find(e => e.id === "horizontal")!.kind = "line";
    doc.requiredEntityIds.push("space", "S"); doc.revealGroups[0]!.entityIds.push("space", "S");
  }),
  vary("incident-mode-needs-stroke-ids-not-point-ids", false, doc => { input(doc, "mark").a = "B"; input(doc, "mark").b = "D"; }, true),
  ...["true", 1, null, undefined].map((value, index) => vary(`nonboolean-option-${index}`, false, doc => { input(doc, "mark").incidentLineArms = value; }, true)),
  vary("angle-mark-cannot-request-the-new-mode", false, doc => {
    doc.constructions.find(c => c.outputs.includes("mark"))!.operator = "angle_mark";
    doc.entities.find(e => e.id === "mark")!.kind = "angle_mark";
  }, true),
];
const failed: string[] = [];
for (const test of cases) {
  const before = structuredClone(test.document), result = compileSceneDocument(test.document);
  try {
    assert.deepEqual(test.document, before, "the native constructor cannot mutate its caller's document");
    assert.equal(result.ok && result.renderScene !== null, test.draws, JSON.stringify(result.report.issues));
    if (test.draws) assert.ok(result.renderScene!.primitives.some(primitive => primitive.entityId === "mark" && primitive.kind !== "label"));
    console.log(`PASS ${test.id}`);
  } catch (error) { failed.push(test.id); console.error(`FAIL ${test.id}: ${error instanceof Error ? error.message : String(error)}`); }
}
console.log(`right-angle-incident-arms: ${cases.length - failed.length}/${cases.length} passed`);
assert.deepEqual(failed, [], "native incident-arm contract failed");
