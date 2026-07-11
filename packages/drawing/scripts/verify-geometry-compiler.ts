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

// --- Sampled curve on axes ---
const sampled: SceneSpec = {
  kind: "axes_plot",
  diagramType: "sampled_curve",
  entities: [
    {
      id: "curve",
      type: "curve",
      attrs: {
        dataSpace: true,
        xScale: 50,
        yScale: 40,
        samples: [0, 0, 1, 1, 2, 0.5, 3, 2, 4, 1.5],
      },
    },
  ],
  constraints: [],
  givens: [],
  asks: [],
  introNarration: "sampled curve",
  promptAddon: "curve is on the board. do NOT redraw.",
};
const sampledCompiled = compileScene(sampled);
assert(sampledCompiled.ok, "sampled curve should compile");
assert(
  sampledCompiled.commands.some((c) => c.type === "DRAW_LINE" && c.params.length >= 8),
  "sampled curve should emit a multi-point DRAW_LINE",
);

// --- Intersect constraint ---
const intersectSpec: SceneSpec = {
  kind: "euclidean",
  diagramType: "intersect_ab_cd",
  entities: [
    { id: "A", type: "point", attrs: { x: 450, y: 200 } },
    { id: "B", type: "point", attrs: { x: 750, y: 450 } },
    { id: "C", type: "point", attrs: { x: 450, y: 450 } },
    { id: "D", type: "point", attrs: { x: 750, y: 200 } },
    { id: "P", type: "point" },
    { id: "AB", type: "segment", from: "A", to: "B" },
    { id: "CD", type: "segment", from: "C", to: "D" },
    { id: "labelP", type: "label", from: "P", text: "P" },
  ],
  constraints: [
    { type: "intersect", entities: ["P", "A", "B", "C", "D"] },
  ],
  givens: [],
  asks: [],
  introNarration: "intersecting lines",
  promptAddon: "intersection P is on the board. do NOT redraw.",
};
const intersectCompiled = compileScene(intersectSpec);
assert(intersectCompiled.ok, "intersect scene should compile");
const pAnchor = intersectCompiled.anchors.find((a) => a.id === "P" || a.labels.includes("P"));
assert(pAnchor, "intersection point P should be anchored");
const px = pAnchor!.x + pAnchor!.width / 2;
const py = pAnchor!.y + pAnchor!.height / 2;
assert(Math.abs(px - 600) < 40 && Math.abs(py - 325) < 40, `P should be near crossing, got (${px},${py})`);

// --- Lens combo via infer ---
const comboQ =
  "A convex lens of focal length 20 cm is placed in contact with a concave lens of focal length 30 cm. An object is placed 40 cm to the left of the combination. Find the equivalent focal length.";
const comboScene = inferSceneFromQuestion(comboQ);
assert(comboScene?.diagramType === "optics_lens_combo", "combo should infer optics_lens_combo");
const comboCompiled = compileScene(comboScene!, { question: comboQ });
assert(comboCompiled.ok, "lens combo should compile");
assert(comboCompiled.diagramType === "optics_lens_combo", "combo compile type");
assert(
  comboCompiled.commands.some((c) => c.type === "DRAW_LINE"),
  "combo should draw skeleton lines",
);

// --- Arc entity emits DRAW_ARC ---
const arcSpec: SceneSpec = {
  kind: "euclidean",
  diagramType: "angle_arc",
  entities: [
    { id: "O", type: "point", attrs: { x: 600, y: 350 } },
    {
      id: "arc1",
      type: "arc",
      center: "O",
      attrs: { r: 40, start_deg: 0, end_deg: 90 },
    },
  ],
  constraints: [],
  givens: [],
  asks: [],
  introNarration: "angle mark",
  promptAddon: "arc is on the board. do NOT redraw.",
};
const arcCompiled = compileScene(arcSpec);
assert(arcCompiled.ok, "arc scene should compile");
assert(
  arcCompiled.commands.some((c) => c.type === "DRAW_ARC"),
  "euclidean arc should emit DRAW_ARC",
);

// --- Reflect constraint ---
const reflectSpec: SceneSpec = {
  kind: "euclidean",
  diagramType: "reflect_point",
  entities: [
    { id: "A", type: "point", attrs: { x: 500, y: 300 } },
    { id: "M1", type: "point", attrs: { x: 600, y: 200 } },
    { id: "M2", type: "point", attrs: { x: 600, y: 450 } },
    { id: "Aprime", type: "point" },
    { id: "labelA", type: "label", from: "A", text: "A" },
    { id: "labelAp", type: "label", from: "Aprime", text: "A'" },
  ],
  constraints: [
    { type: "reflect", entities: ["Aprime", "A", "M1", "M2"] },
  ],
  givens: [],
  asks: [],
  introNarration: "reflection",
  promptAddon: "reflection is on the board. do NOT redraw.",
};
const reflectCompiled = compileScene(reflectSpec);
assert(reflectCompiled.ok, "reflect scene should compile");
const aPrime = reflectCompiled.anchors.find(
  (a) => a.id === "Aprime" || a.labels.includes("A'"),
);
assert(aPrime, "reflected point should be anchored");
const apx = aPrime!.x + aPrime!.width / 2;
assert(Math.abs(apx - 700) < 50, `A' should be right of mirror, got x=${apx}`);

// --- FBD / incline via mechanics plugin ---
const fbdQ = "Draw the free-body diagram for a 5 kg block on a rough horizontal surface.";
const fbdScene = inferSceneFromQuestion(fbdQ);
assert(fbdScene?.kind === "fbd", "fbd question should infer fbd scene");
const fbdCompiled = compileScene(fbdScene!, { question: fbdQ });
assert(fbdCompiled.ok, "fbd scene should compile");
assert(fbdCompiled.plugin === "mechanics", "mechanics plugin should run for fbd");
assert(fbdCompiled.commands.length >= 4, "fbd should emit block + forces");

const inclineQ =
  "A block rests on a 30 degree incline. Draw the free-body diagram showing friction and normal.";
const inclineScene = inferSceneFromQuestion(inclineQ);
assert(
  inclineScene?.kind === "incline" || inclineScene?.kind === "fbd",
  "incline question should infer incline/fbd",
);
const inclineCompiled = compileScene(inclineScene!, { question: inclineQ });
assert(inclineCompiled.ok, "incline scene should compile");
assert(inclineCompiled.plugin === "mechanics", "mechanics plugin for incline");

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
