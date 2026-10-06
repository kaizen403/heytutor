import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { attemptArchetypeScene } from "../../src/archetypes";
import { ladderWallFromSource } from "../../src/archetypes/generators/fields";
import { generatorFor } from "../../src/archetypes/generators";
import { constantAccelerationSourceProgram, suvatSlots, resolveConstantAcceleration } from "../../src/archetypes/generators/constantAcceleration";
import { ladderSourceProgram } from "../../src/ir/ladderSourceProgram";
import { resolveLadderSource, resolveRightTriangle } from "../../src/ir/rightTriangleSource";
import { evaluateMathExpression } from "../../src/math/expression";
import { checkPictureContract } from "../../src/archetypes/contract";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
import { suvatCases, ladderCases } from "./fixtures/w2-kinematics-ladder/core";

const out = resolve(process.argv[2] ?? ".w2-kinematics-ladder");
mkdirSync(out, { recursive: true });
const failures: { name: string; message: string }[] = [];
let checks = 0;
function check(name: string, run: () => void) {
  checks++;
  try { run(); } catch (error) { failures.push({ name, message: error instanceof Error ? error.message : String(error) }); }
}
function close(actual: unknown, expected: number) {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(Number(actual) - expected) < 1e-6, `${actual} != ${expected}`);
}
for (const c of suvatCases) check(`SUVAT ${c.id}`, () => {
  const result = attemptArchetypeScene({ question: c.question });
  assert.ok(result.scene, JSON.stringify(result));
  assert.equal(result.scene.archetype, "uniform_acceleration_vt");
  for (const [role, value] of Object.entries(c.expected)) close(result.scene.document.quantities.find(q => q.symbol === role)?.value, value);
});
for (const c of ladderCases) check(`ladder ${c.id}`, () => {
  const doc = ladderWallFromSource({ question: c.question, quantities: [], slots: {}, sources: {}, schematic: false });
  assert.ok(doc, c.id);
  const compiled = compileSceneDocument(doc);
  assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  writeFileSync(resolve(out, `${c.id}.svg`), renderSceneSvg(compiled.renderScene));
  writeFileSync(resolve(out, `${c.id}.scene.json`), JSON.stringify(doc, null, 2));
  const binding = resolveLadderSource(c.question);
  assert.ok(binding.ok);
  close(binding.state.cosTheta, c.distance / c.length);
  for (const evidence of binding.evidence) assert.equal(c.question.slice(evidence.start, evidence.end), evidence.quote);
  // Parent-owned force-oriented contract cannot admit a geometry-only figure.
  assert.deepEqual(checkPictureContract(doc, "ladder_wall").map(i => i.message), [
    'ladder_wall needs an entity with role "weight"', 'ladder_wall needs an entity with role "normal"',
  ]);
  // Registry wiring and complete source/IR admission remain parent-owned;
  // this gate deliberately does not certify the legacy stock generator.
  const point = (id: string) => doc.constructions.find(x => x.outputs.includes(id))!.inputs;
  const A = point("A"), B = point("B");
  close(A.x, c.side * c.distance); close(A.y, 0); close(B.x, 0); close(B.y, c.height);
  close(Math.hypot(Number(A.x) - Number(B.x), Number(A.y) - Number(B.y)), c.length);
  close(doc.quantities.find(q => q.symbol === "d")?.value, c.distance);
  close(doc.quantities.find(q => q.symbol === "h")?.value, c.height);
  assert.ok(doc.entities.some(e => e.id === "foot_distance"));
});
check("ladder ungrounded 60 degree plan declines", () => {
  assert.ok(ladderWallFromSource({ question: ladderCases[0]!.question, quantities: [{ id: "theta", symbol: "theta", value: 60, unit: "degree", origin: "derived" }], slots: { theta: 60 }, sources: { theta: "plan" }, schematic: false }) === null);
});
check("ladder unspecified declines", () => assert.ok(ladderWallFromSource({ question: "A ladder leans against a wall. Find the angle.", slots: {}, sources: {}, quantities: [], schematic: false }) === null));

for (const c of suvatCases) check(`source program ${c.id}`, () => {
  const doc = constantAccelerationSourceProgram(c.question);
  assert.ok(doc);
  for (const [role, value] of Object.entries(c.expected)) close(doc.quantities.find(q => q.symbol === role)?.value, value);
  const compiled = compileSceneDocument(doc);
  assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  writeFileSync(resolve(out, `${c.id}.svg`), renderSceneSvg(compiled.renderScene));
  const graph = doc.constructions.find(x => x.outputs.includes("graph"))!;
  const y0 = evaluateMathExpression(String(graph.inputs.expression), 0);
  const yT = evaluateMathExpression(String(graph.inputs.expression), c.expected.t);
  const scale = c.expected.u > 0 ? y0 / c.expected.u : yT / c.expected.v;
  close((yT - y0) / c.expected.t / scale, c.expected.a);
  close((y0 + yT) * c.expected.t / (2 * scale), c.expected.s);
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const time = c.expected.t * fraction;
    close(evaluateMathExpression(String(graph.inputs.expression), time) / scale, c.expected.u + c.expected.a * time);
  }
  close(graph.inputs.xMin, 0); close(graph.inputs.xMax, c.expected.t);
  assert.deepEqual(doc.revealGroups.map(g => g.id), ["axes_group", "graph_group", "area_group"]);
  assert.deepEqual(doc.quantities.map(q => q.unit), ["m/s", "m/s", "m/s^2", "s", "m"]);
});
for (const question of [
  "A car moves at 4 m/s with constant acceleration 2 m/s^2. Find its final speed.",
  "A car moves at 4 m/s with constant acceleration -2 m/s^2 for 5 s. Find its velocity.",
  "A ball is thrown vertically at 4 m/s with constant acceleration -2 m/s^2 for 1 s.",
  "A car accelerates at 2 m/s^2 for 5 s then brakes at 1 m/s^2 for 3 s.",
  "Two cars start from rest with constant acceleration 2 m/s^2 for 5 s.",
  "A car has initial position 4 m and starts from rest with constant acceleration 2 m/s^2 for 5 s.",
  "A car accelerates from 2 m/s to 4 m/s with constant acceleration 1 m/s^2 for 2 s or 3 s.",
  "Relative to a moving frame a body starts from rest with constant acceleration 2 m/s^2 for 5 s.",
]) check(`SUVAT decline ${question}`, () => assert.equal(constantAccelerationSourceProgram(question), null));
check("wrong plan time cannot bind speed numeral", () => {
  const slots = suvatSlots("A cart moving at 4 m/s accelerates uniformly at 2 m/s^2. Find its final velocity.", [{ id: "t", symbol: "t", value: 4, unit: "s", sourceText: "4 m/s", origin: "given" }]);
  assert.ok("conflict" in slots || !resolveConstantAcceleration(slots.knowns, slots.claims).ok);
});
for (const claim of [
  { id: "u", symbol: "u", value: 14, unit: "m/s", sourceText: "4 m/s^2", origin: "given" as const },
  { id: "v", symbol: "v", value: 15, unit: "m/s", origin: "derived" as const },
  { id: "v", symbol: "v", value: 14.01, unit: "m/s", origin: "derived" as const },
  { id: "a", symbol: "a", value: 4, unit: "m/s", origin: "given" as const },
]) check(`SUVAT plan role/unit ${claim.id}:${claim.unit}`, () => assert.equal(constantAccelerationSourceProgram(suvatCases[1]!.question, [claim]), null));
check("duplicate stale SUVAT claim declines", () => assert.equal(constantAccelerationSourceProgram(suvatCases[1]!.question, [
  { id: "v", symbol: "v", value: 14, unit: "m/s" }, { id: "vf", symbol: "vf", value: 15, unit: "m/s" },
]), null));
check("forged cached SUVAT slots decline", () => assert.equal(generatorFor("uniform_acceleration_vt")!({ question: suvatCases[0]!.question, quantities: [], slots: { t: 11 }, sources: { t: "plan" }, schematic: false }), null));
for (const question of [
  "A 13 m ladder leans against a wall. Find the height.",
  "Two ladders of length 13 m have their foot 5 m from the wall.",
  "A ladder of length 13 m slides against a wall with its foot 5 m from the wall.",
  "A ladder of length 4 m leans against a wall. Its foot is 5 m from the wall.",
  "A ladder of length 13 m leans against a wall. Its foot is 5 m from the wall. Its top is 11 m above the floor.",
  "A ladder of length 13 m leans against a wall. Its foot is 5 m from the wall. Its angle to the floor is 60 degrees.",
  "A ladder of length 13 m leans against a wall. Its foot is 5 m from the wall and a load is 3 m up the ladder.",
  "A ladder of length 13 m leans against a wall on the left side. Its foot is 5 m from the wall.",
  "A ladder of length 13 m leans against a wall. Its foot is 5 feet from the wall.",
  "A ladder of length 13 m leans against a wall. Its foot is 5 m from the wall. Find the position of a climber.",
]) check(`ladder decline ${question}`, () => assert.equal(ladderSourceProgram(question), null));
for (const quantity of [
  { id: "theta", symbol: "theta", value: 60, unit: "degree" },
  { id: "height", symbol: "h", value: 11, unit: "m", sourceText: "13 m" },
  { id: "distance", symbol: "d", value: 5, unit: "s" },
]) check(`ladder plan claim ${quantity.id}`, () => assert.equal(ladderSourceProgram(ladderCases[0]!.question, [quantity]), null));
check("stated opposite orientation is retained", () => {
  const result = resolveLadderSource(ladderCases[0]!.question + " The wall is to the right of the foot.");
  assert.ok(result.ok); assert.equal(result.side, -1); assert.equal(result.orientationStated, true);
});
check("ladder correct converted plan rows agree", () => {
  const result = resolveLadderSource(ladderCases[0]!.question, [{ id: "distance", symbol: "d", value: 500, unit: "cm" }, { id: "height", symbol: "h", value: 12, unit: "m" }]);
  assert.ok(result.ok); close(result.state.height, 12);
});
check("nonfinite extra SUVAT given declines", () => assert.ok(!resolveConstantAcceleration({ u: 2, a: 4, t: 3, s: Infinity }).ok));
check("independent right triangle contradiction declines", () => assert.equal(resolveRightTriangle({ length: 13, distance: 5, height: 11 }), null));
check("right triangle degeneracy declines", () => assert.equal(resolveRightTriangle({ length: 5, distance: 5 }), null));
for (const mutate of [
  (doc: SceneDocument) => { doc.constructions.find(c => c.outputs.includes("A"))!.inputs.x = 6; },
  (doc: SceneDocument) => { doc.constructions = doc.constructions.filter(c => !c.outputs.includes("B")); },
]) check("mutated or partial ladder fails atomically", () => {
  const doc = ladderSourceProgram(ladderCases[0]!.question)!; mutate(doc);
  const result = compileSceneDocument(doc);
  assert.ok(!result.ok && result.renderScene === null, JSON.stringify(result.report.issues));
});

for (const mutate of [
  (doc: SceneDocument) => { doc.constructions.find(c => c.outputs.includes("end"))!.inputs.y = 123; },
  (doc: SceneDocument) => { doc.constructions = doc.constructions.filter(c => !c.outputs.includes("graph")); },
]) check("mutated or partial SUVAT fails atomically", () => {
  const doc = constantAccelerationSourceProgram(suvatCases[1]!.question)!; mutate(doc);
  const result = compileSceneDocument(doc);
  assert.ok(!result.ok && result.renderScene === null, JSON.stringify(result.report.issues));
});

// Preserve the two native compiler observations with freshly authored inputs.
// They remain observations, not a waiver or a replacement for full IR admission.
function nativeDocument(): SceneDocument {
  const ids = ["motion", "position", "velocity", "acceleration"];
  return {
    schemaVersion: "scene-document/v2", source: { question: "In an inertial +x right frame, at t=0 s a body has x=3 m, velocity 2 m/s and constant acceleration 4 m/s^2. Find position and velocity at t=3 s." },
    visualDecision: { mode: "scene", reason: "independent native control" }, quantities: [],
    entities: [
      { id: "motion", kind: "polyline", role: "physical trajectory" },
      { id: "position", kind: "point", role: "computed physical position", label: "x=27 m" },
      { id: "velocity", kind: "vector", role: "scaled velocity illustration", label: "vx=14 m/s" },
      { id: "acceleration", kind: "vector", role: "scaled acceleration illustration", label: "ax=4 m/s^2" },
    ],
    constructions: [
      { id: "make_motion", operator: "constant_acceleration_trajectory", inputs: { initialPosition: [3, 0], initialVelocity: [2, 0], acceleration: [4, 0], tMin: 0, tMax: 3, samples: 65, units: { length: "m", time: "s" } }, outputs: ["motion"] },
      { id: "make_state", operator: "trajectory_state", inputs: { trajectory: "motion", time: 3, kind: "state", timeScale: 0.25 }, outputs: ["position", "velocity", "acceleration"] },
    ], relations: [], assertions: [{ id: "state_incidence", predicate: "incident", entities: ["position", "motion"], tolerance: 1e-8, severity: "fatal" }], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "computed state" }], teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "computed state" }],
  };
}
const nativeResults = ["source-text", "source-quantity"].map(kind => {
  const doc = nativeDocument();
  if (kind === "source-text") doc.source.question += " The supplied position at t=3 s is 28 m.";
  else doc.quantities.push({ id: "supplied_position", symbol: "x", value: 28, unit: "m" });
  const result = compileSceneDocument(doc);
  const serialized = JSON.stringify(result);
  writeFileSync(resolve(out, `native-${kind}.json`), serialized);
  return { kind, ok: result.ok, scenePresent: result.renderScene !== null, resultDigest: createHash("sha256").update(serialized).digest("hex") };
});
writeFileSync(resolve(out, "native-digests.json"), JSON.stringify(nativeResults, null, 2));
if (process.argv[3]) check("native result digests unchanged", () => assert.deepEqual(nativeResults, JSON.parse(readFileSync(resolve(process.argv[3]), "utf8"))));
writeFileSync(resolve(out, "report.json"), JSON.stringify({ checks, failures, nativeResults, parentAdmission: "NOT_RUN", ladderRegistry: "LEGACY_UNCHANGED_PARENT_WIRING_REQUIRED", studentLifecycle: "NOT_RUN" }, null, 2));
console.log(JSON.stringify({ checks, failures, nativeResults }, null, 2));
if (failures.length) process.exitCode = 1;
