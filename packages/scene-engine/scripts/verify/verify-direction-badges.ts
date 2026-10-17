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

// Spin annotations enter the shared helper after world-to-screen projection.
for (const end of [{ x: 4, y: 0 }, { x: -3, y: 4 }, { x: 0, y: -4 }]) {
  for (const sense of ["clockwise", "counterclockwise", "invalid-spin"]) {
    const candidate = scene("positive", end);
    candidate.entities = candidate.entities.filter((entity) => entity.id !== "badge");
    candidate.constructions.pop();
    candidate.requiredEntityIds = candidate.requiredEntityIds.filter((id) => id !== "badge");
    candidate.revealGroups[0]!.entityIds = [...candidate.requiredEntityIds];
    candidate.annotations = [{ id: "spin", kind: "spin", targetIds: ["axis"], text: sense }];
    try {
      const result = compileSceneDocument(candidate);
      if (sense === "invalid-spin") {
        check(!result.ok && result.renderScene === null && result.report.issues.some((issue) => issue.severity === "fatal"),
          "Unknown spin must reject the scene atomically.");
        continue;
      }
      assert(result.ok && result.renderScene);
      const path = result.renderScene.primitives.find((p) => p.entityId === "spin")!.points;
      const crosses = path.slice(2).map((point, i) => {
        const a = path[i]!;
        const b = path[i + 1]!;
        return (b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x);
      });
      check(crosses.every((cross) => sense === "clockwise" ? cross > 0 : cross < 0),
        `Spin ${sense} must retain its page direction (${end.x},${end.y}).`);
    } catch (error) {
      check(false, `Spin must return a compile result instead of throwing: ${String(error)}`);
    }
  }
}

// A spin with no sense text, or on a closed outline (zero reference span), must reject the scene atomically.
function spinScene(text: string | undefined, closed: boolean): SceneDocument {
  const candidate = scene("positive");
  candidate.entities = candidate.entities.filter((entity) => entity.id !== "badge");
  candidate.constructions.pop();
  candidate.requiredEntityIds = candidate.requiredEntityIds.filter((id) => id !== "badge");
  if (closed) {
    candidate.entities.push({ id: "c", kind: "point", role: "corner" }, { id: "outline", kind: "polyline", role: "outline" });
    candidate.constructions.push(
      { id: "c0", operator: "point", inputs: { x: 2, y: 3 }, outputs: ["c"] },
      { id: "outline0", operator: "polyline", inputs: { points: ["a", "b", "c", "a"] }, outputs: ["outline"] },
    );
    candidate.requiredEntityIds.push("c", "outline");
  }
  candidate.revealGroups[0]!.entityIds = [...candidate.requiredEntityIds];
  candidate.annotations = [{ id: "spin", kind: "spin", targetIds: [closed ? "outline" : "axis"], ...(text === undefined ? {} : { text }) }];
  return candidate;
}
for (const [label, candidate] of [["no sense text", spinScene(undefined, false)], ["closed outline", spinScene("clockwise", true)]] as const) {
  try {
    const validated = validateSceneDocument(candidate);
    const result = validated.document ? compileSceneDocument(validated.document) : null;
    check(!result || (!result.ok && result.renderScene === null), `Spin with ${label} must fail closed.`);
  } catch (error) {
    check(false, `Spin with ${label} must return a result instead of throwing: ${String(error)}`);
  }
}

assert.equal(failures.length, 0, failures.join("\n"));
console.log(`Direction badge verification passed (${checks} checks).`);
