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

console.log(`verify-rounded-circle-point-repair: ${checks} checks passed`);
