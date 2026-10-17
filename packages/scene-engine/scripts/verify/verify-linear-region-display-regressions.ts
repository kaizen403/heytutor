import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildLinearSourceDocument, compileSceneDocument, pruneDeadSceneEntities, validateSceneDocument } from "../../src/index";

// Authored planner captures. Hash the complete MAIN render, including labels,
// transforms and reveal groups: a region fix must not move unrelated figures.
for (const [fixture, expected] of [
  ["inverse-trig-read", "d73e94ac49cc5227290166406f863753198f55f0d6b66be91cd08376d20a5603"],
  ["plane-wave", "214479c35cae229e89ee2bfe4d294fbf0869feb73cb2fb34c8bcf871b8cb7c65"],
] as const) {
  const raw = JSON.parse(readFileSync(new URL(`../../fixtures/regression/linear-region-review/${fixture}.json`, import.meta.url), "utf8"));
  const validated = validateSceneDocument(pruneDeadSceneEntities(raw));
  assert.ok(validated.document, JSON.stringify(validated.report.issues));
  const result = compileSceneDocument(validated.document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  const actual = createHash("sha256").update(JSON.stringify(result.renderScene)).digest("hex");
  assert.equal(actual, expected, `${fixture}: region changes must preserve the complete MAIN render`);
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
console.log("verify-linear-region-display-regressions: exact non-region MAIN renders, coincident systems, dense exact legends and forged-caption refusals passed");
