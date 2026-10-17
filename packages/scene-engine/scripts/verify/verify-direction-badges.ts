import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument, type SceneDocument } from "../../src/index";

function scene(sense: unknown, end = { x: 4, y: 0 }, at = 0.5): SceneDocument {
  const ids = ["a", "b", "axis", "badge"];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "Verify a direction convention." },
    source: { question: "Show the specified direction relative to the reference segment." },
    quantities: [],
    entities: [
      { id: "a", kind: "point", role: "start" },
      { id: "b", kind: "point", role: "end" },
      { id: "axis", kind: "segment", role: "reference" },
      { id: "badge", kind: "sign_badge", role: "direction" },
    ],
    constructions: [
      { id: "a0", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "b0", operator: "point", inputs: end, outputs: ["b"] },
      { id: "axis0", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["axis"] },
      { id: "badge0", operator: "sign_badge", inputs: { target: "axis", ...(sense === undefined ? {} : { sense }), at }, outputs: ["badge"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Show the direction." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Show the direction." }],
  };
}

const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string) {
  checks++;
  if (!condition) failures.push(message);
}

for (const end of [{ x: 4, y: 0 }, { x: -4, y: 0 }, { x: 0, y: 4 }, { x: 0, y: -4 }, { x: 3, y: 4 }]) {
  for (const at of [0, 0.5, 1]) {
    for (const sense of ["positive", "negative", "clockwise", "counterclockwise"]) {
      const validated = validateSceneDocument(scene(sense, end, at));
      assert(validated.document, JSON.stringify(validated.report.issues));
      const result = compileSceneDocument(validated.document);
      assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
      const reference = result.renderScene.primitives.find((p) => p.entityId === "axis")!.points;
      const paths = result.renderScene.primitives.filter((p) => p.entityId === "badge").map((p) => p.points);
      assert.equal(paths.length, 3, "A badge has a shaft or arc and two arrowhead strokes.");
      const path = paths[0]!;
      const start = reference[0]!;
      const endPoint = reference.at(-1)!;
      const dx = endPoint.x - start.x;
      const dy = endPoint.y - start.y;
      if (sense === "positive" || sense === "negative") {
        const dot = (path.at(-1)!.x - path[0]!.x) * dx + (path.at(-1)!.y - path[0]!.y) * dy;
        check(sense === "positive" ? dot > 0 : dot < 0, `${sense} arrow points in the wrong direction (${end.x},${end.y}; at=${at}).`);
      } else {
        const center = { x: start.x + at * dx, y: start.y + at * dy };
        const crosses = path.slice(1).map((point, i) =>
          (path[i]!.x - center.x) * (point.y - center.y) - (path[i]!.y - center.y) * (point.x - center.x));
        // Render coordinates have y increasing downward: positive cross = clockwise.
        check(crosses.every((cross) => sense === "clockwise" ? cross > 0 : cross < 0), `${sense} arc rotates in the wrong direction (${end.x},${end.y}; at=${at}).`);
      }
      const tip = path.at(-1)!;
      const previous = path.at(-2)!;
      for (const head of paths.slice(1)) {
        check(Math.hypot(head[0]!.x - tip.x, head[0]!.y - tip.y) < 0.01, "Arrowhead must meet the shaft tip.");
        check((head[1]!.x - tip.x) * (tip.x - previous.x) + (head[1]!.y - tip.y) * (tip.y - previous.y) < 0,
          "Arrowhead wings must point behind the tip.");
      }
    }
  }
}

for (const sense of ["backwards", "counter-clockwize", "", 1, {}, true, null, undefined]) {
  const result = compileSceneDocument(scene(sense));
  check(!result.ok && result.renderScene === null, `Unknown sense ${JSON.stringify(sense)} must fail closed.`);
}

for (const sense of [" POSITIVE ", " NEGATIVE ", " CLOCKWISE ", " COUNTERCLOCKWISE "]) {
  const result = compileSceneDocument(scene(sense));
  check(result.ok && result.renderScene !== null, `Normalized supported sense ${String(sense)} must remain valid: ${JSON.stringify(result.report.issues)}`);
}
const degenerate = compileSceneDocument(scene("positive", { x: 0, y: 0 }));
check(!degenerate.ok && degenerate.renderScene === null, "A zero-length reference cannot establish a direction.");

assert.equal(failures.length, 0, failures.join("\n"));
console.log(`Direction badge verification passed (${checks} checks).`);
