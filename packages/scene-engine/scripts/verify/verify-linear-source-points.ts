import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument, type SceneDocument, type RenderScene } from "../../src/index";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import { linearRegionPrimitives, type LinearRegionGeometry } from "../../src/compile/linearRegionGeometry";

// Public integration gate: source tuples, never planner-authored point marks.
const documentFor = (question: string): SceneDocument => ({
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "Show the exact graphical solution and given points." },
  source: { question }, quantities: [],
  entities: [{ id: "region", kind: "linear_region", role: "solution" }],
  constructions: [{ id: "build_region", operator: "linear_half_plane", inputs: { inequality: "x + 2y < 6" }, outputs: ["region"] }],
  relations: [], assertions: [], annotations: [], requiredEntityIds: ["region"],
  revealGroups: [{ id: "view", entityIds: ["region"], dependsOn: [], narrationCue: "Verified region and source points" }],
  teachingTimeline: [{ id: "show", action: "reveal", targetId: "view", dependsOn: [], narrationIntent: "Explain membership." }],
});

const original = compileSceneDocument(documentFor("Graph x + 2y < 6. Mark P = (1, 1)."));
assert.ok(original.ok && original.renderScene, `source-point false refusal: ${JSON.stringify(original.report.issues)}`);
const developmentScenes: Array<{ question: string; scene: RenderScene }> = [{ question: "Graph x + 2y < 6. Mark P = (1, 1).", scene: original.renderScene }];
const references = original.renderScene.primitives.filter(p => p.provenance?.linearRole === "source_reference_point");
assert.equal(references.length, 1, "every original source point must be drawn");
assert.deepEqual(references[0]!.provenance?.worldPoints, [{ x: { numerator: "1", denominator: "1" }, y: { numerator: "1", denominator: "1" } }]);
assert.equal(references[0]!.provenance?.linearMembership, true);
assert.ok(original.renderScene.primitives.some(p => p.kind === "label" && p.text?.includes("P") && p.text.includes("included")));
let checks = 4;
for (const [definition, included, expectedX, expectedY] of [
  ["Q = (6, 0)", false, "6", "0"],
  ["R = (7, -1)", true, "7", "-1"],
  ["T = (8, 2)", false, "8", "2"],
  ["P = (7/3, 4/3)", true, "7/3", "4/3"],
] as const) {
  const result = compileSceneDocument(documentFor(`Graph x + 2y < 6. Mark ${definition}.`));
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  developmentScenes.push({ question: `Graph x + 2y < 6. Mark ${definition}.`, scene: result.renderScene });
  const mark = result.renderScene.primitives.find(p => p.provenance?.linearRole === "source_reference_point")!;
  assert.equal(mark.provenance?.linearMembership, included);
  assert.equal(mark.provenance?.pointStyle, included ? "filled" : "open");
  const [x, y] = [expectedX, expectedY].map(value => value.split("/"));
  assert.deepEqual(mark.provenance?.worldPoints, [{ x: { numerator: x![0], denominator: x![1] ?? "1" }, y: { numerator: y![0], denominator: y![1] ?? "1" } }]);
  checks += 4;
}
for (const definition of ["P = (x, 1)", "P = (sin(1), 1)", "P = (1, 2, 3)", "P = (1, 1) + x", "P = (1, 1). P = (2, 1)", "P = (1,)", "P = (8, 1)"]) {
  const doc = documentFor(`Graph x + 2y < 6. Mark ${definition}.`);
  if (definition === "P = (8, 1)") doc.constructions[0]!.inputs.view = { xMin: -4, xMax: 7, yMin: -4, yMax: 2 };
  const result = compileSceneDocument(doc);
  assert.ok(!result.ok && result.renderScene === null, `unsafe/missing-source-point accepted: ${definition}`);
  if (definition === "P = (8, 1)") assert.ok(result.report.issues.some(issue => issue.message.includes("source point")), JSON.stringify(result.report.issues));
  checks++;
}
for (const test of [
  { question: "Graph x>=0, y>=0 and x+2y<6. Mark P=(1,1) and Q=(6,0).", operator: "linear_feasible_region", inputs: { constraints: ["x>=0", "y>=0", "x+2y<6"] } },
  { question: "Graph x+y=5 and x-y=1. Mark P=(3,2) and Q=(4,2).", operator: "linear_system", inputs: { equations: ["x+y=5", "x-y=1"] } },
]) {
  const doc = documentFor(test.question);
  doc.constructions[0]!.operator = test.operator;
  // Explicit complete world view matches the existing planar reference gate;
  // some small default system views separately refuse on label clearance.
  doc.constructions[0]!.inputs = { ...test.inputs, view: { xMin: -2, xMax: 20, yMin: -2, yMax: 20 } };
  const result = compileSceneDocument(doc);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  developmentScenes.push({ question: test.question, scene: result.renderScene });
  const marks = result.renderScene.primitives.filter(primitive => primitive.provenance?.linearRole === "source_reference_point");
  assert.equal(marks.length, 2);
  assert.deepEqual(marks.map(mark => mark.provenance?.linearMembership), [true, false]);
  assert.deepEqual(marks.map(mark => mark.provenance?.pointStyle), ["filled", "open"]);
  checks += 4;
}
const geometry = original.renderScene.primitives.find(p => p.provenance?.linearSolution)!.provenance!.linearSolution as LinearRegionGeometry;
for (const mutate of [
  (copy: LinearRegionGeometry) => { copy.referencePoints = []; },
  (copy: LinearRegionGeometry) => { copy.referencePoints![0]!.x = { numerator: "2", denominator: "1" }; },
  (copy: LinearRegionGeometry) => { copy.referencePoints![0]!.label = "Q"; },
  (copy: LinearRegionGeometry) => { copy.referencePoints!.push({ label: "Q", x: { numerator: "0", denominator: "1" }, y: { numerator: "0", denominator: "1" } }); },
]) {
  const copy = structuredClone(geometry); mutate(copy);
  assert.throws(() => linearRegionPrimitives(copy, "region", "view"), /preserve every original/);
  checks++;
}
const authored = documentFor("Graph x + 2y < 6. Mark P = (1, 1).");
authored.constructions[0]!.inputs.points = [{ label: "P", x: "1", y: "1" }];
const refusal = compileSceneDocument(authored);
assert.ok(!refusal.ok && refusal.renderScene === null); checks++;
const swappedAxes = documentFor("Graph x + 2y < 6. Mark P = (7/3, 4/3).");
swappedAxes.constructions[0]!.inputs.variables = ["y", "x"];
swappedAxes.constructions[0]!.inputs.view = { xMin: -2, xMax: 20, yMin: -2, yMax: 20 };
const swappedRefusal = compileSceneDocument(swappedAxes);
assert.ok(!swappedRefusal.ok && swappedRefusal.renderScene === null, "planner axis reordering must not change the membership of an original Cartesian point"); checks++;
console.log(`verify-linear-source-points: ${checks} source membership/proof/adversarial checks passed`);
const renderArgument = process.argv.find(argument => argument.startsWith("--render-development="));
if (renderArgument) {
  const directory = resolve(renderArgument.slice("--render-development=".length));
  mkdirSync(directory, { recursive: true });
  developmentScenes.forEach((test, index) => writeFileSync(resolve(directory, `point-${index}.svg`), renderSceneSvg(test.scene, { guides: false }), { flag: "wx" }));
  writeFileSync(resolve(directory, "manifest.json"), JSON.stringify({ syntheticDevelopmentOnly: true, rootImageViews: 0, cases: developmentScenes.map((test, index) => ({ question: test.question, svg: `point-${index}.svg` })) }, null, 2) + "\n", { flag: "wx" });
}
