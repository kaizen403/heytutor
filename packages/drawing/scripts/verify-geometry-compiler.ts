/**
 * Geometry compiler accuracy fixtures — SceneSpec → compile → assert geometry.
 * Run: pnpm --filter @heytutor/drawing exec tsx scripts/verify-geometry-compiler.ts
 * (or via tutor-core verify once wired)
 */
import {
  compileScene,
  inferSceneFromQuestion,
  validateSceneSpec,
  type SceneSpec,
} from "../src/geometry/index";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// --- Euclidean equilateral-ish triangle ---
const triangle: SceneSpec = {
  kind: "euclidean",
  diagramType: "triangle_abc",
  entities: [
    { id: "A", type: "point" },
    { id: "B", type: "point" },
    { id: "C", type: "point" },
    { id: "AB", type: "segment", from: "A", to: "B" },
    { id: "BC", type: "segment", from: "B", to: "C" },
    { id: "CA", type: "segment", from: "C", to: "A" },
    { id: "labelA", type: "label", from: "A", text: "A" },
    { id: "labelB", type: "label", from: "B", text: "B" },
    { id: "labelC", type: "label", from: "C", text: "C" },
  ],
  constraints: [
    { type: "distance", entities: ["A", "B"], value: 220 },
    { type: "distance", entities: ["B", "C"], value: 200 },
    { type: "distance", entities: ["C", "A"], value: 180 },
  ],
  givens: [],
  asks: [],
  introNarration: "triangle ABC",
  promptAddon: "triangle ABC is on the board. do NOT redraw.",
};

const triCompiled = compileScene(triangle);
assert(triCompiled.ok, "triangle scene should compile");
assert(triCompiled.commands.length >= 3, "triangle should emit at least 3 edges");
assert(
  triCompiled.commands.filter((c) => c.type === "DRAW_LINE").length >= 3,
  "triangle should have 3 DRAW_LINE edges",
);
assert(triCompiled.anchors.length >= 3, "triangle should expose A/B/C anchors");
assert(triCompiled.residual < 50, `triangle residual too high: ${triCompiled.residual}`);

const a = triCompiled.anchors.find((x) => x.id === "A" || x.labels.includes("A"));
const b = triCompiled.anchors.find((x) => x.id === "B" || x.labels.includes("B"));
assert(a && b, "A and B anchors required");
const ab = dist(
  { x: a!.x + a!.width / 2, y: a!.y + a!.height / 2 },
  { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 },
);
assert(ab > 100 && ab < 400, `AB distance out of range: ${ab}`);

// --- Optics via infer + plugin ---
const opticsQ =
  "A convex mirror has focal length 15 cm. An object is placed 20 cm in front of it. Find the image distance.";
const opticsScene = inferSceneFromQuestion(opticsQ);
assert(opticsScene?.kind === "optics", "optics question should infer optics scene");
const opticsCompiled = compileScene(opticsScene!, { question: opticsQ });
assert(opticsCompiled.ok, "optics scene should compile via plugin");
assert(opticsCompiled.plugin === "optics", "optics plugin should run");
assert(opticsCompiled.commands.length >= 4, "optics should emit skeleton commands");
assert(
  opticsCompiled.introSegments.length >= 1,
  "optics should produce intro segments",
);

// --- Circuit via infer + plugin ---
const circuitQ =
  "Three resistors 2Ω, 3Ω, 4Ω in series with a 12 V battery. Find current.";
const circuitScene = inferSceneFromQuestion(circuitQ);
assert(circuitScene?.kind === "circuit", "circuit question should infer circuit scene");
const circuitCompiled = compileScene(circuitScene!, { question: circuitQ });
assert(circuitCompiled.ok, "circuit scene should compile");
assert(circuitCompiled.plugin === "circuit", "circuit plugin should run");
assert(
  circuitCompiled.commands.some((c) => c.type === "LABEL" && c.text?.includes("R1")),
  "circuit should label R1",
);

// --- Axes / mark-the-point ---
const axesScene: SceneSpec = {
  kind: "axes_plot",
  diagramType: "mark_point",
  entities: [
    { id: "origin", type: "point", attrs: { x: 0, y: 0 } },
    { id: "curve", type: "curve" },
    { id: "P", type: "point", text: "P", attrs: { x: 2, y: 1.5 } },
  ],
  constraints: [],
  givens: [],
  asks: ["mark P"],
  introNarration: "axes and point P",
  promptAddon: "axes and P are on the board. do NOT redraw.",
};
const axesCompiled = compileScene(axesScene);
assert(axesCompiled.ok, "axes scene should compile");
assert(
  axesCompiled.commands.some((c) => c.type === "DRAW_POINT"),
  "axes plot should emit DRAW_POINT",
);
assert(
  axesCompiled.commands.filter((c) => c.type === "DRAW_LINE").length >= 2,
  "axes should draw x and y",
);

// --- validateSceneSpec rejects empty ---
assert(validateSceneSpec({}) === null, "empty object should fail validation");
assert(
  validateSceneSpec({
    kind: "generic",
    diagramType: "x",
    entities: [{ id: "a", type: "point" }],
    constraints: [],
    givens: [],
    asks: [],
    introNarration: "",
    promptAddon: "do NOT redraw.",
  }) !== null,
  "minimal valid scene should pass",
);

console.log("verify-geometry-compiler: ok");
