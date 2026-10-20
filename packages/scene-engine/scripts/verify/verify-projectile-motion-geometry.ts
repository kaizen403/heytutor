import assert from "node:assert/strict";
import { SceneBuilder } from "../../src/archetypes/document";
import { compileSceneDocument } from "../../src/compile/compiler";
import { evaluateChapterRemainderConstruction } from "../../src/compile/chapterRemainderGeometry";
import { validationNumber, type SourceContext } from "../../src/compile/sourceScalars";
import type { SceneDocument } from "../../src/types";

let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; assert(value, message); }
function curveLaunch(slope: number, start = { x: 0, y: 0 }, reverse = false): SceneDocument {
  const scene = new SceneBuilder("A synthetic projectile trajectory with its launch velocity.", "computed geometric consistency");
  scene.point("O", start, "launch point", "O");
  scene.curve("path", "x-x^2/8", 0, 8, "trajectory", "trajectory");
  scene.vector("v", "O", { direction: { x: reverse ? -1 : 1, y: slope }, length: 2 }, "launch velocity", "u");
  return scene.build();
}
const wrong = compileSceneDocument(curveLaunch(0.5));
check(!wrong.ok && wrong.renderScene === null, "independent launch slope 1/2 cannot contradict trajectory slope 1");
const yielding = compileSceneDocument(curveLaunch(0.5), { yieldPolicy: "verified_parts" });
check(!yielding.ok && yielding.report.issues.some(issue => issue.code === "launch_velocity_contradiction" && issue.failureKind === "truth"), "truth failure also blocks verified-parts rendering");
const right = compileSceneDocument(curveLaunch(1));
check(right.ok && right.renderScene, "the tangent positive control remains drawable");
for (const document of [curveLaunch(-1), curveLaunch(1, { x: 1, y: 0 }), curveLaunch(0.5, { x: 0, y: 1 })]) {
  const compiled = compileSceneDocument(document);
  check(!compiled.ok && compiled.report.issues.some(i => i.code === "launch_velocity_contradiction"), "reversed and detached launch arrows fail closed");
}
check(compileSceneDocument(curveLaunch(1, { x: 8, y: 0 }, true)).ok, "a leftward launch follows the tangent into the path from its right endpoint");
for (const correct of [false, true]) {
  const document = curveLaunch(correct ? 1 : 0.5);
  document.entities.push({ id: "other", kind: "polyline", role: "trajectory" });
  document.constructions.push({ id: "other_curve", operator: "function_curve", inputs: { expression: "20+x-x^2/8", xMin: 0, xMax: 8 }, outputs: ["other"] });
  document.requiredEntityIds.push("other"); document.revealGroups[0]!.entityIds.push("other");
  check(compileSceneDocument(document).ok === correct, "an unrelated trajectory cannot disable launch truth checking");
  document.constructions.at(-1)!.inputs.expression = "2*x-x^2/4";
  check(!compileSceneDocument(document).ok, "two independent trajectories at the same launch endpoint are ambiguous and stay refused");
}
const component = curveLaunch(0.5); component.entities.find(e => e.id === "v")!.role = "horizontal component";
check(compileSceneDocument(component).ok, "a component or unrelated vector is not a claim of launch tangency");
const timePath = curveLaunch(1);
timePath.constructions.find(c => c.outputs.includes("path"))!.operator = "constant_acceleration_trajectory";
timePath.constructions.find(c => c.outputs.includes("path"))!.inputs = { initialPosition: [0, 0], initialVelocity: [1, 1], acceleration: [0, -0.25], tMin: 0, tMax: 8 };
check(compileSceneDocument(timePath).ok, "a named initial launch follows its forward-time trajectory");
timePath.constructions.find(c => c.outputs.includes("O"))!.inputs = { x: 8, y: 0 };
timePath.constructions.find(c => c.outputs.includes("v"))!.inputs = { start: "O", direction: [-1, 1], length: 2 };
check(!compileSceneDocument(timePath).ok, "a time trajectory cannot acquire a reversed launch at its final state");

function measured(inputs: Record<string, unknown>): SceneDocument {
  const ids = ["path", "launch", "range", "height"];
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "synthetic solved projectile" }, source: {}, quantities: [],
    entities: [{ id: "path", kind: "polyline", role: "trajectory" }, { id: "launch", kind: "vector", role: "launch velocity" },
      { id: "range", kind: "dimension", role: "horizontal range", label: "R" }, { id: "height", kind: "dimension", role: inputs.heightReference === "launch" ? "maximum rise above launch" : "maximum height above level ground", label: "H" }],
    constructions: [{ id: "shot", operator: "projectile_trajectory", inputs: { ...inputs, showMeasurements: true }, outputs: ids }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "the trajectory and its solved measurements" }], teachingTimeline: [] };
}
const shot = measured({ speed: 20, launchAngleDeg: 45, gravity: 10, displayScale: 1 });
const compiled = compileSceneDocument(shot);
check(compiled.ok && compiled.renderScene, `solved range and maximum rise compile: ${JSON.stringify(compiled.report.issues)}`);
check(compiled.renderScene.primitives.some(p => p.entityId === "range" && p.kind === "dimension"), "horizontal range reaches native dimension ink");
check(compiled.renderScene.primitives.some(p => p.entityId === "height" && p.kind === "dimension"), "maximum rise reaches native dimension ink");
check(compiled.renderScene.primitives.some(p => p.entityId === "range" && p.text === "R"), "R label stays attached to range");
check(compiled.renderScene.primitives.some(p => p.entityId === "height" && p.text === "H"), "H label stays attached to height");
const nativePath = compiled.renderScene.primitives.find(p => p.entityId === "path" && p.kind === "polyline")!;
const nativeName = compiled.renderScene.primitives.find(p => p.entityId === "path" && p.kind === "label")!;
const nativeBox = nativeName.provenance?.labelCollisionBounds ?? nativeName.provenance?.labelBounds;
check(!!nativeBox && nativeBox.y + nativeBox.height <= Math.min(...nativePath.points.map(p => p.y)) + 1e-6,
  "a native projectile name stays above its path when a competing H dimension is present");
check(compiled.renderScene.primitives.some(p => p.entityId === "path" && p.provenance?.labelLeader),
  "the native trajectory name connects to the curve, never the H dimension");
const context: SourceContext = { number: value => validationNumber(value, shot), point: () => { throw new Error("literal fixture"); }, geometry: () => undefined };
const values = evaluateChapterRemainderConstruction("projectile_trajectory", shot.constructions[0]!.inputs, context, shot);
check(values.length === 4 && values[2]!.kind === "dimension" && values[3]!.kind === "dimension", "four ordered computed outputs");
const range = values[2]!, height = values[3]!;
if (range.kind === "dimension" && height.kind === "dimension") {
  check(Math.abs(range.b.x - range.a.x - 40) < 1e-10 && range.a.y === range.b.y, "R = u^2 sin(2theta)/g is horizontal");
  check(Math.abs(height.b.y - height.a.y - 10) < 1e-10 && height.a.x === height.b.x, "H = u^2 sin(theta)^2/(2g) is vertical above launch");
}
function geometry(inputs: Record<string, unknown>) {
  const document = measured(inputs);
  return evaluateChapterRemainderConstruction("projectile_trajectory", document.constructions[0]!.inputs,
    { ...context, number: value => validationNumber(value, document) }, document);
}
const vertical = geometry({ speed: 20, launchAngleDeg: 90, gravity: 10, displayScale: 1 });
check(vertical[2]!.kind === "point" && vertical[2]!.remainder.magnitude === 0, "vertical launch has exactly zero horizontal range, not a roundoff dimension");
check(Math.abs(vertical[3]!.remainder.magnitude - 20) < 1e-10, "vertical maximum rise is solved from velocity and gravity");
for (const angle of [0, -30, 270]) {
  const values = geometry({ speed: 20, launchAngleDeg: angle, gravity: 10, initialHeight: 15, heightReference: "launch", displayScale: 1 });
  check(values[3]!.kind === "point" && values[3]!.remainder.magnitude === 0, "horizontal/downward launch has zero rise, not a guessed height");
}
const elevated = geometry({ speed: 20, launchAngleDeg: 30, gravity: 10, initialHeight: 15, heightReference: "launch", displayScale: 2, origin: [3, 4] });
check(Math.abs(elevated[3]!.remainder.magnitude - 5) < 1e-10, "H above launch excludes a tower's source height");
if (elevated[3]!.kind === "dimension") check(elevated[3]!.a.y === 34 && Math.abs(elevated[3]!.b.y - 44) < 1e-10, "translated/scaled height anchors remain at launch level and apex");
const incline = geometry({ speed: 20, launchAngleDeg: 30, gravity: 10, inclineAngleDeg: 29, heightReference: "launch", displayScale: 1 });
check(incline[3]!.remainder.magnitude < 5, "flight ending before the free-flight apex uses the actual maximum over that flight");
const aboveGround = measured({ speed: 20, launchAngleDeg: 30, gravity: 10, initialHeight: 15, displayScale: 1 });
check(compileSceneDocument(aboveGround).ok, "default H is maximum height above level ground");
const aboveGroundGeometry = geometry(aboveGround.constructions[0]!.inputs);
check(Math.abs(aboveGroundGeometry[3]!.remainder.magnitude - 20) < 1e-10, "H includes the source tower height");
aboveGround.constructions[0]!.inputs.heightReference = "launch";
check(!compileSceneDocument(aboveGround).ok, "a rise dimension cannot be relabelled as H above ground");
aboveGround.entities.find(e => e.id === "height")!.label = "Δh";
aboveGround.entities.find(e => e.id === "height")!.role = "maximum rise above launch";
check(compileSceneDocument(aboveGround).ok, "a distinct Δh label admits the explicit rise measurement");
for (const angle of [1e-14, -1e-14, 90 - 1e-12, 90 + 1e-12]) {
  const tiny = geometry({ speed: 20, launchAngleDeg: angle, gravity: 10, initialHeight: 15, heightReference: "launch", displayScale: 1 });
  const launch = tiny[1]!.remainder.components;
  check(launch.x !== 0 && launch.y !== 0, "near-cardinal nonzero components are never snapped to zero");
  if (angle > 0) check(tiny[3]!.remainder.magnitude > 0, "tiny positive rise retains its physical value");
  if (angle > 0) {
    const unresolved = measured({ speed: 20, launchAngleDeg: angle, gravity: 10, initialHeight: 15, heightReference: "launch", displayScale: 1 });
    unresolved.entities[3]!.label = "Δh";
    const projected = compileSceneDocument(unresolved);
    check(!projected.ok && projected.report.issues.some(i => i.code === "projectile_measurement_collapsed"), "a nonzero measurement that collapses on screen is refused, never made a false zero marker");
  }
}
for (const angle of [1e-200, Number.MIN_VALUE]) {
  checks++;
  assert.throws(() => geometry({ speed: 20, launchAngleDeg: angle, gravity: 10, initialHeight: 15, heightReference: "launch", displayScale: 1 }),
    /underflowed/, "positive unresolved flight/rise cannot become a false zero marker");
}
check(JSON.stringify(geometry({ speed: { value: 72, unit: "km/h" }, launchAngleDeg: 45, gravity: 10, displayScale: 1 })) === JSON.stringify(values), "stated km/h is converted before both dimensions are solved");
for (const inputs of [{ showMeasurements: "yes" }, { showMeasurements: true }, { showMeasurements: false }]) {
  const document = measured({ speed: 20, launchAngleDeg: 45, gravity: 10, displayScale: 1 });
  Object.assign(document.constructions[0]!.inputs, inputs);
  if (inputs.showMeasurements === true) document.constructions[0]!.outputs.pop();
  check(!compileSceneDocument(document).ok, "measurement input type and ordered output count are enforced");
}
const legacy = structuredClone(shot);
delete legacy.constructions[0]!.inputs.showMeasurements;
legacy.constructions[0]!.outputs = ["path", "launch"];
legacy.entities = legacy.entities.slice(0, 2); legacy.requiredEntityIds = ["path", "launch"]; legacy.revealGroups[0]!.entityIds = ["path", "launch"];
const legacyGeometry = evaluateChapterRemainderConstruction("projectile_trajectory", legacy.constructions[0]!.inputs, context, legacy);
check(JSON.stringify(values.slice(0, 2)) === JSON.stringify(legacyGeometry), "legacy two-output path/launch geometry is retained");
check(compileSceneDocument(legacy).ok, "legacy two-output documents remain supported");
// A trajectory label must identify the flight path, never the ground below it.
for (const annotation of [false, true]) for (const policy of ["strict", "verified_parts"] as const) {
  const document = curveLaunch(1);
  document.entities.push({ id: "ground", kind: "segment", role: "level ground" });
  document.constructions.push({ id: "ground_line", operator: "segment", inputs: { start: [0, 0], end: [8, 0] }, outputs: ["ground"] });
  document.requiredEntityIds.push("ground"); document.revealGroups[0]!.entityIds.push("ground");
  if (annotation) {
    delete document.entities.find(e => e.id === "path")!.label;
    document.annotations.push({ id: "path_name", kind: "label", targetIds: ["path"], text: "trajectory", placementIntent: "below" });
  }
  const result = compileSceneDocument(document, { yieldPolicy: policy });
  check(result.ok && result.renderScene, "a trajectory name retains a legal position under both policies");
  const path = result.renderScene.primitives.find(p => p.entityId === "path" && p.kind === "polyline")!;
  const label = result.renderScene.primitives.find(p => p.entityId === "path" && p.kind === "label")!;
  const box = label.provenance?.labelCollisionBounds ?? label.provenance?.labelBounds;
  check(!!box && box.y + box.height <= Math.min(...path.points.map(p => p.y)) + 1e-6,
    "the entire trajectory name stays above its path apex, even when the model requests below");
  check(result.renderScene.primitives.some(p => p.entityId === "path" && p.provenance?.labelLeader),
    "the trajectory name has a verified connector to its own path");
}
console.log(`projectile motion geometry: ${checks} checks passed`);
