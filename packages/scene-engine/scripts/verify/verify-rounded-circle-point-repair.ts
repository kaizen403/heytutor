/**
 * Equal radii that fail by a rounding sized gap on typed points keep the
 * default tolerance, and the repair message names the typed points and says
 * to build them from the centre with rotate. Recorded case: "angle at centre
 * is twice angle at circumference" typed A (-2.598, -1.5), B (2.598, -1.5),
 * C (0, 3) and failed equal radii by 0.000333.
 */
import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneConstruction, SceneDocument } from "../../src/types";

type Point = { x: number; y: number } | { rotate: string; angle: number };
const build = (points: Record<string, Point>): SceneDocument => {
  const constructions: SceneConstruction[] = [
    ...Object.entries(points).map(([id, p]): SceneConstruction => "rotate" in p
      ? { id: `k${id}`, operator: "rotate", inputs: { point: p.rotate, center: "O", angle: p.angle, angleUnit: "degrees" }, outputs: [id] }
      : { id: `k${id}`, operator: "point", inputs: { ...p, coordinateSpace: "world" }, outputs: [id] }),
    { id: "kOA", operator: "segment", inputs: { start: "O", end: "A" }, outputs: ["OA"] },
    { id: "kOB", operator: "segment", inputs: { start: "O", end: "B" }, outputs: ["OB"] },
    { id: "kOC", operator: "segment", inputs: { start: "O", end: "C" }, outputs: ["OC"] },
  ];
  const ids = ["O", "A", "B", "C", "OA", "OB", "OC"];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "equal radii from typed points" },
    source: {}, quantities: [],
    entities: ids.map((id) => ({ id, kind: id.length === 1 ? "point" : "segment", role: id === "O" ? "centre" : "radius" })),
    constructions, relations: [],
    assertions: [
      { id: "eqOAOC", predicate: "equal_length", entities: ["OA", "OC"], expected: true, severity: "fatal" },
      { id: "eqOBOC", predicate: "equal_length", entities: ["OB", "OC"], expected: true, severity: "fatal" },
    ],
    annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "radii" }],
    teachingTimeline: [],
  };
};
const failures = (document: SceneDocument) => compileSceneDocument(document).report.issues.filter((issue) => issue.code === "assertion_failed");

let checks = 0;
const rounded = failures(build({ O: { x: 0, y: 0 }, A: { x: -2.598, y: -1.5 }, B: { x: 2.598, y: -1.5 }, C: { x: 0, y: 3.001 } }));
assert.equal(rounded.length, 2, "the 0.0003 rounding gap still fails the default tolerance");
checks++;
for (const issue of rounded) {
  assert.match(issue.message, /required under 0\.0001/);
  assert.match(issue.message, /rounding size/);
  assert.match(issue.message, /rotate \{point: <that point>, center: O/);
  assert.doesNotMatch(issue.message, /size: O\b|O, [ABC] are points/, "the exact centre is not called rounded");
  checks++;
}
assert.match(rounded[0]!.message, /A, C are points typed as rounded coordinates/);
checks++;

const rotated = failures(build({ O: { x: 0, y: 0 }, C: { x: 0, y: 3 }, A: { rotate: "C", angle: 120 }, B: { rotate: "C", angle: -120 } }));
assert.deepEqual(rotated, [], "points rotated about the centre hold equal radii exactly");
checks++;

const wrong = failures(build({ O: { x: 0, y: 0 }, A: { x: -2.4, y: -1.5 }, B: { x: 2.598, y: -1.5 }, C: { x: 0, y: 3 } }));
assert.ok(wrong.length >= 1, "a real length difference fails");
assert.ok(wrong.every((issue) => !/rounding size/.test(issue.message)), "a real length difference is not called rounding");
checks++;

// The hint names the centre of the circle the failed check names, not the
// first circle in the document, and stays off checks with no circle or centre.
const sceneOf = (points: Record<string, { x: number; y: number }>, constructions: SceneConstruction[], ids: string[], assertions: SceneDocument["assertions"]): SceneDocument => ({
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "hint scope" },
  source: {}, quantities: [],
  entities: [...Object.keys(points).map((id) => ({ id, kind: "point" as const })), ...ids.map((id) => ({ id, kind: "segment" as const }))],
  constructions: [...Object.entries(points).map(([id, p]): SceneConstruction => ({ id: `k${id}`, operator: "point", inputs: { ...p, coordinateSpace: "world" }, outputs: [id] })), ...constructions],
  relations: [], assertions, annotations: [], requiredEntityIds: [...Object.keys(points), ...ids],
  revealGroups: [{ id: "setup", entityIds: [...Object.keys(points), ...ids], dependsOn: [], narrationCue: "scope" }],
  teachingTimeline: [],
});
const twoCircles = failures(sceneOf(
  { O: { x: 0, y: 0 }, Q: { x: 10, y: 0 }, P: { x: 12.598, y: 1.501 } },
  [
    { id: "kc1", operator: "circle", inputs: { center: "O", radius: 3 }, outputs: ["c1"] },
    { id: "kc2", operator: "circle", inputs: { center: "Q", radius: 3 }, outputs: ["c2"] },
  ],
  ["c1", "c2"],
  [{ id: "onP", predicate: "on", entities: ["P", "c2"], expected: true, severity: "fatal" }],
));
assert.equal(twoCircles.length, 1, "the rounded point fails on the second circle");
assert.match(twoCircles[0]!.message, /center: Q,/, "the hint pivots on the centre of the circle the check names");
assert.doesNotMatch(twoCircles[0]!.message, /center: O,/, "the first circle's centre is not offered");
checks++;
const onLine = failures(sceneOf(
  { A: { x: 0, y: 0 }, B: { x: 10, y: 0 }, P: { x: 4.5, y: 0.0004 } },
  [{ id: "kl", operator: "line", inputs: { start: "A", end: "B" }, outputs: ["l"] }],
  ["l"],
  [{ id: "onL", predicate: "on", entities: ["P", "l"], expected: true, severity: "fatal" }],
));
assert.equal(onLine.length, 1, "the point misses the line by a rounding gap");
assert.doesNotMatch(onLine[0]!.message, /rounding size|rotate|circle_intersections/, "a point on a line gets no circle advice");
checks++;
const freeSegments = failures(sceneOf(
  { A: { x: 0, y: 0 }, B: { x: 3, y: 0 }, C: { x: 5, y: 5 }, D: { x: 8.0003, y: 5 } },
  [
    { id: "kAB", operator: "segment", inputs: { start: "A", end: "B" }, outputs: ["AB"] },
    { id: "kCD", operator: "segment", inputs: { start: "C", end: "D" }, outputs: ["CD"] },
    { id: "kc", operator: "circle", inputs: { center: "A", radius: 3 }, outputs: ["c"] },
  ],
  ["AB", "CD", "c"],
  [{ id: "eqABCD", predicate: "equal_length", entities: ["AB", "CD"], expected: true, severity: "fatal" }],
));
assert.equal(freeSegments.length, 1, "segments with no shared end differ by a rounding gap");
assert.doesNotMatch(freeSegments[0]!.message, /rounding size|rotate|circle_intersections/, "equal lengths with no shared centre get no circle advice");
checks++;

console.log(`verify-rounded-circle-point-repair: ${checks} checks passed`);
