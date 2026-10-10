import assert from "node:assert/strict";
import type { RenderPrimitive, SceneDocument } from "../../src/types";
import { compileSceneDocument } from "../../src/compile/compiler";
import { evaluateNetworkConstruction } from "../../src/compile/networkGeometry";
import { appendCompiledAnnotations } from "../../src/compile/sceneAnnotations";
import { evaluateChapterRemainderConstruction } from "../../src/compile/chapterRemainderGeometry";
let checks = 0;
const failures: string[] = [];
function check(condition: unknown, message: string): void { checks++; if (!condition) failures.push(message); }
function vectorScene(direction: number[]): SceneDocument {
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source direction" }, source: {}, quantities: [],
    entities: [{ id: "O", kind: "point", role: "origin" }, { id: "v", kind: "vector", role: "source current", label: "I" }],
    constructions: [{ id: "O_make", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] }, { id: "v_make", operator: "vector", inputs: { start: "O", direction }, outputs: ["v"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["O", "v"], revealGroups: [{ id: "show", entityIds: ["O", "v"], dependsOn: [] }], teachingTimeline: [] };
}
for (const [z, count] of [[-1, 3], [1, 2]] as const) {
  const result = compileSceneDocument(vectorScene([0, 0, z]));
  check(result.ok && result.renderScene?.primitives.filter((p) => p.entityId === "v" && p.kind !== "label").length === count, `pure page ${z} renders the owned ${z < 0 ? "cross" : "dot"} glyph: ${JSON.stringify(result.report.issues)}`);
}
check(!compileSceneDocument(vectorScene([1, 0, 1])).ok, "mixed 3D vector must not lose its z component in a 2D path");
check(!compileSceneDocument(vectorScene([0, 0, 0])).ok, "zero 3D direction is invalid");
const sourceContext = { number: Number, point: () => ({ x: 0, y: 0 }), geometry: () => undefined };
for (const emf of [6, -6]) {
  const outputs = evaluateNetworkConstruction("kirchhoff_network", {
    nodes: [{ id: "a", at: [0, 0] }, { id: "b", at: [4, 0] }], ground: "a",
    branches: [{ id: "s", kind: "source", from: "a", to: "b", resistance: 0, emf }, { id: "r", kind: "resistor", from: "b", to: "a", resistance: 3 }], units: { resistance: "ohm", emf: "V" }, currentScale: 0.3,
  }, sourceContext);
  const source = outputs[2]!;
  const length = (path: Array<{ x: number; y: number }>) => Math.hypot(path[1]!.x - path[0]!.x, path[1]!.y - path[0]!.y);
  check(source.kind === "compound" && (emf > 0 ? length(source.paths[2]!) > length(source.paths[1]!) : length(source.paths[1]!) > length(source.paths[2]!)), `${emf} V source's long positive plate matches the solver's signed emf`);
}
for (const angle of [0, Math.PI / 3, Math.PI]) {
  const at = (x: number, y: number) => ({ x: 100 + x * Math.cos(angle) - y * Math.sin(angle), y: 100 + x * Math.sin(angle) + y * Math.cos(angle) });
  const paths = [[at(0, 0), at(43, 0)], [at(43, -16), at(43, 16)], [at(57, -9), at(57, 9)], [at(57, 0), at(100, 0)]];
  const marks: RenderPrimitive[] = paths.map((points, index) => ({ id: `b_${index}`, entityId: "battery", groupId: "show", kind: "polyline", points }));
  const document = vectorScene([1, 0]); document.entities.push({ id: "battery", kind: "component" });
  document.constructions.push({ id: "battery_make", operator: "symbol", inputs: { symbol: "battery", start: "O", end: "O" }, outputs: ["battery"] });
  document.annotations = [{ id: "polarity", kind: "polarity", targetIds: ["battery"] }];
  const issues: unknown[] = []; appendCompiledAnnotations(document, marks, new Map([["battery", "show"]]), issues);
  const plus = marks.find((p) => p.kind === "label" && p.text === "+")?.points[0];
  const minus = marks.find((p) => p.kind === "label" && p.text === "−")?.points[0];
  const positive = at(43, 0); const negative = at(57, 0);
  check(plus && Math.hypot(plus.x - positive.x, plus.y - positive.y) < 1e-9, "battery + belongs to the actual long plate, under rotation");
  check(minus && Math.hypot(minus.x - negative.x, minus.y - negative.y) < 1e-9, "battery − belongs to the actual short plate, under rotation");
}
// A moment vector has always set the bar axis; scalar moment would be invalid.
for (const moment of [[1, 0], [0, -1]]) {
  const output = evaluateChapterRemainderConstruction("bar_magnet", { moment, displayScale: 1 }, sourceContext)[0]!;
  check(output.kind === "path" && Math.abs((output.points[1]!.x - output.points[0]!.x) * moment[1]! - (output.points[1]!.y - output.points[0]!.y) * moment[0]!) < 1e-9, "bar magnet orientation follows its moment vector");
}
try {
  const output = evaluateChapterRemainderConstruction("bar_magnet", { moment: [0, -1], displayScale: 1, units: { moment: "A m^2" } }, sourceContext);
  check(output.length === 5, "bar magnet accepts its documented explicit SI unit contract");
} catch { check(false, "bar magnet accepts its documented explicit SI unit contract"); }
for (const units of [{ moment: "C m" }, { moment: "A m^2", current: "A" }]) {
  let refused = false;
  try { evaluateChapterRemainderConstruction("bar_magnet", { moment: [0, -1], displayScale: 1, units }, sourceContext); } catch { refused = true; }
  check(refused, "bar magnet rejects contradictory/unsupported unit metadata");
}
const falsePlanarProof = vectorScene([0, 0, -1]);
falsePlanarProof.entities.push({ id: "x", kind: "vector", role: "planar vector" });
falsePlanarProof.constructions.push({ id: "x_make", operator: "vector", inputs: { start: "O", direction: [1, 0] }, outputs: ["x"] });
falsePlanarProof.requiredEntityIds.push("x"); falsePlanarProof.revealGroups[0]!.entityIds.push("x");
falsePlanarProof.assertions.push({ id: "bad", predicate: "perpendicular", entities: ["v", "x"], expected: true, severity: "fatal" });
check(!compileSceneDocument(falsePlanarProof).ok, "page-normal glyph cannot certify an in-plane direction proof");
const stalePageLabel = vectorScene([0, 0, -1]); stalePageLabel.entities[1]!.label = "I=999";
check(!compileSceneDocument(stalePageLabel).ok, "a source direction glyph cannot certify an invented current magnitude");
console.log(`H4 page/source direction: ${checks - failures.length}/${checks} passed`);
assert.equal(failures.length, 0, failures.join("\n"));
