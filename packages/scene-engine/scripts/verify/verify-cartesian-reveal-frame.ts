import assert from "node:assert/strict";
import { compileSceneDocument, type RenderPrimitive, type SceneDocument } from "../../src/index";

// Explicit axes ownership persists across time-step reveal groups. Each expected
// screen point below is computed from rendered axis endpoints and source math.
function documentFor(expression: string, intercept: number): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "Show a Cartesian graph." },
    source: { question: `Graph y=${expression}.` }, quantities: [],
    entities: [{ id: "axes", kind: "axes", role: "Cartesian axes" }, { id: "curve", kind: "polyline", role: "curve", label: "y" }],
    constructions: [
      { id: "frame", operator: "axes", inputs: { xMin: -5, xMax: 5, yMin: -3, yMax: 7 }, outputs: ["axes"] },
      { id: "graph", operator: "function_curve", inputs: { axes: "axes", expression, variable: "x", xMin: -5, xMax: 5, samples: 41 }, outputs: ["curve"] },
    ], relations: [], annotations: [],
    assertions: [{ id: "value", predicate: "function_value", entities: ["curve"], expected: { x: 0, y: intercept }, severity: "fatal" }],
    requiredEntityIds: ["axes", "curve"],
    revealGroups: [
      { id: "setup", entityIds: ["axes"], dependsOn: [], narrationCue: "Axes" },
      { id: "result", entityIds: ["curve"], dependsOn: ["setup"], narrationCue: "Graph" },
    ],
    teachingTimeline: [
      { id: "axes_step", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Reveal axes." },
      { id: "curve_step", action: "reveal", targetId: "result", dependsOn: ["axes_step"], narrationIntent: "Reveal graph on these axes." },
    ],
  };
}

let checks = 0;
function assertRegistered(axes: RenderPrimitive, curve: RenderPrimitive, f: (x: number) => number): void {
  assert.equal(axes.points.length, 4);
  const [left, right, bottom, top] = axes.points;
  const sx = (right!.x - left!.x) / 10;
  const sy = (top!.y - bottom!.y) / 10;
  const ox = left!.x + 5 * sx;
  const oy = bottom!.y + 3 * sy;
  curve.points.forEach((p, i) => {
    const x = -5 + 10 * i / (curve.points.length - 1);
    const expected = { x: ox + sx * x, y: oy + sy * f(x) };
    assert.ok(Math.abs(p.x - expected.x) <= 0.03 && Math.abs(p.y - expected.y) <= 0.03,
      `Detached Cartesian curve at x=${x}: got(${p.x},${p.y}), axis-bound expected(${expected.x},${expected.y})`);
    checks++;
  });
}

for (const [expression, intercept, f] of [
  ["(3*x+9)/5", 9 / 5, (x: number) => (3 * x + 9) / 5],
  ["-x/2+3", 3, (x: number) => -x / 2 + 3],
  ["x*x/8-1", -1, (x: number) => x * x / 8 - 1],
] as const) {
  for (const reverseEntities of [false, true]) {
    const document = documentFor(expression, intercept);
    if (reverseEntities) document.entities.reverse();
    const result = compileSceneDocument(document);
    assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
    const axes = result.renderScene.primitives.find(p => p.entityId === "axes" && p.kind === "axes")!;
    const curve = result.renderScene.primitives.find(p => p.entityId === "curve" && p.kind === "polyline")!;
    assert.equal(axes.groupId, "setup"); assert.equal(curve.groupId, "result"); checks += 2;
    assertRegistered(axes, curve, f);
  }
}
const wrongValue = documentFor("(3*x+9)/5", 99);
const refused = compileSceneDocument(wrongValue);
assert.ok(!refused.ok && refused.renderScene === null, "Shared display frame must not weaken scalar proof"); checks++;

// More than one Cartesian frame retains explicit construction ownership.
// Registering one graph must not pull the other panel onto the first axes.
const frames = [documentFor("(3*x+9)/5", 9 / 5), documentFor("-x/2+3", 3)].map((document, index) => {
  const prefix = `panel${index}_`;
  const renamed = JSON.parse(JSON.stringify(document).replace(/"(axes|curve|frame|graph|value|setup|result|axes_step|curve_step)"/g, (_, id: string) => JSON.stringify(prefix + id))) as SceneDocument;
  renamed.entities[0]!.kind = "axes";
  renamed.constructions[0]!.operator = "axes";
  renamed.constructions[1]!.inputs.axes = `${prefix}axes`;
  renamed.revealGroups = [{ id: `${prefix}panel`, entityIds: renamed.requiredEntityIds, dependsOn: [] }];
  renamed.teachingTimeline = [{ id: `${prefix}show`, action: "reveal", targetId: `${prefix}panel`, dependsOn: [], narrationIntent: "Show this independently owned graph panel." }];
  return renamed;
});
const multi: SceneDocument = {
  ...frames[0]!,
  entities: frames.flatMap(document => document.entities),
  constructions: frames.flatMap(document => document.constructions),
  assertions: frames.flatMap(document => document.assertions),
  requiredEntityIds: frames.flatMap(document => document.requiredEntityIds),
  revealGroups: frames.flatMap(document => document.revealGroups),
  teachingTimeline: frames.flatMap(document => document.teachingTimeline),
};
const separate = compileSceneDocument(multi);
assert.ok(separate.ok && separate.renderScene, JSON.stringify(separate.report.issues)); checks++;
for (const [index, f] of [(x: number) => (3 * x + 9) / 5, (x: number) => -x / 2 + 3].entries()) {
  const axes = separate.renderScene.primitives.find(p => p.entityId === `panel${index}_axes` && p.kind === "axes")!;
  const curve = separate.renderScene.primitives.find(p => p.entityId === `panel${index}_curve` && p.kind === "polyline")!;
  assertRegistered(axes, curve, f);
}
const a = separate.renderScene.primitives.find(p => p.entityId === "panel0_axes" && p.kind === "axes")!;
const b = separate.renderScene.primitives.find(p => p.entityId === "panel1_axes" && p.kind === "axes")!;
assert.notDeepEqual(a.points, b.points, "Explicit independent panels must retain distinct frames"); checks++;
console.log(`verify-cartesian-reveal-frame: ${checks} registration/reveal/proof checks passed`);
