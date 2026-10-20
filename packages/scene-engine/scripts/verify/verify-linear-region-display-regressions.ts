import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildLinearSourceDocument, compileSceneDocument, pruneDeadSceneEntities, validateSceneDocument } from "../../src/index";

// Authored planner captures. Full native hashes include Cartesian names and
// own-curve attachment from e591bf31; source geometry and literal text survive.
// A future region fix must preserve these complete unrelated figures.
for (const [fixture, expected] of [
  ["inverse-trig-read", "b9015670485d42f93a3c50cb8905615faa2349dee75f1f7e53c94b690d38a824"],
  ["plane-wave", "76762a62ac540d9bbcc5c3e713d43e8a63ad513439912d428d35daa3d36610dc"],
] as const) {
  const raw = JSON.parse(readFileSync(new URL(`../../fixtures/regression/linear-region-review/${fixture}.json`, import.meta.url), "utf8"));
  const validated = validateSceneDocument(pruneDeadSceneEntities(raw));
  assert.ok(validated.document, JSON.stringify(validated.report.issues));
  const result = compileSceneDocument(validated.document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const actual = createHash("sha256").update(JSON.stringify(result.renderScene)).digest("hex");
  assert.equal(actual, expected, `${fixture}: region changes must preserve the complete frozen native render`);
}

// Coincident systems retain one source-owned stroke without joining arbitrary
// function graphs to whichever axes happen to be present in the document.
for (const question of [
  "Solve -4x+y=-9 and 8x-2y=18 graphically.",
  "Solve 3y=12 and -2y=-8 graphically.",
]) {
  const document = buildLinearSourceDocument(question);
  assert.ok(document);
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const boundaries = result.renderScene.primitives.filter(p => p.provenance?.linearRole === "source_boundary");
  assert.equal(boundaries.length, 1, "Coincident source equations must render one boundary");
}

for (const [question, exactFacts] of [
  ["A continuous production model uses real quantities x and y. Its constraints are x >= 1/2, y >= 0, x + 2y <= 7, and 3x + y <= 8. Draw and shade the common feasible region, label every exact corner, and maximise profit F = 4x + 5y. Put F at each corner and mark every maximiser. Mark A = (1,1), B = (0,1), C = (9/5,13/5), and state feasibility. Fractional production is permitted.", ["3x + y=8", "(1/2, 13/4)"]],
  ["In R^2, graph the simultaneous system L1: -2(2x - y) = -6 and L2: 6x - 3y = 12. Label both lines with their names and simplified equations, and label their intercepts. Use the graph to classify the system and state its full solution set.", ["-2(2x - y)=-6"]],
] as const) {
  const document = buildLinearSourceDocument(question);
  assert.ok(document);
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const legends = result.renderScene.primitives.filter(p => p.provenance?.linearLegendTargetId);
  assert.equal(legends.length, exactFacts.length);
  for (const fact of exactFacts) assert.ok(legends.some(p => p.text?.endsWith(`: ${fact}`)), "Every exact equation and tuple survives compact lettering");
  const names = new Set<string>();
  for (const legend of legends) {
    const target = result.renderScene.primitives.find(p => p.id === legend.provenance!.linearLegendTargetId);
    assert.ok(target?.text && /^[A-Z]$/.test(target.text));
    assert.ok(!names.has(target.text), "Legend identifiers must be unique");
    assert.ok(!question.includes("Mark A") || !["A", "B", "C"].includes(target.text), "Legend names must preserve original source point names");
    names.add(target.text);
    assert.ok(legend.text!.startsWith(`${target.text}: `), "The complete fact stays bound to its mark's identifier");
    const bounds = target.provenance!.labelBounds as { x: number; y: number; width: number; height: number };
    assert.ok(target.provenance!.worldPoints, "The named mark retains its exact source anchor");
    const anchor = target.provenance!.labelAnchor as { x: number; y: number };
    assert.ok(Math.hypot(target.points[0]!.x - anchor.x, target.points[0]!.y - anchor.y) <= 56.01,
      "A compact identifier stays inside the existing point-label tether");
    assert.ok(bounds.width < 24 && bounds.height === 23, "Compact labels still use the actual live font floor");
  }
  for (const text of ["D: (1/2, 13/3)", "E: 3x+y=9"]) {
    const changed = structuredClone(document);
    changed.annotations.push({ id: "changed_legend", kind: "label", targetIds: document.requiredEntityIds, text });
    const refused = compileSceneDocument(changed);
    assert.ok(!refused.ok && refused.renderScene === null, "A planner cannot replace a source tuple or equation through a legend caption");
  }
}
console.log("verify-linear-region-display-regressions: exact frozen non-region renders, coincident systems, dense exact legends and forged-caption refusals passed");
