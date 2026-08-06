import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../../..");
const deletedPaths = [
  "packages/drawing/src/templates/registry.ts",
  "packages/drawing/src/geometry/compileScene.ts",
  "packages/drawing/src/geometrySnap.ts",
  "packages/tutor-core/src/diagramArchitect.ts",
  "packages/tutor-core/src/scenePlanner.ts",
  "packages/tutor-core/src/topicPlanner.ts",
  "apps/tutor/features/tutor-session/lib/planToTemplate.ts",
  "apps/tutor/features/tutor-session/lib/commandPreparation.ts",
];

for (const path of deletedPaths) {
  assert(!existsSync(resolve(root, path)), `legacy diagram path returned: ${path}`);
}

const drawingIndex = readFileSync(resolve(root, "packages/drawing/src/index.ts"), "utf8");
for (const symbol of ["matchDiagramTemplate", "compileScene", "inferSceneFromQuestion", "snapGeometryCommand"]) {
  assert(!drawingIndex.includes(symbol), `drawing package still exposes ${symbol}`);
}

const questionHandler = readFileSync(
  resolve(root, "apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts"),
  "utf8",
);
for (const symbol of ["matchDiagramTemplate", "compileScene(", "inferSceneFromQuestion", "planToTemplate"]) {
  assert(!questionHandler.includes(symbol), `turn handler still contains ${symbol}`);
}

const systemPrompt = readFileSync(resolve(root, "packages/tutor-core/src/systemPrompt.ts"), "utf8");
assert(!systemPrompt.includes("[DRAW_"), "teaching prompt must not contain freehand structural commands");

console.log("no legacy diagram runtime verification passed");
