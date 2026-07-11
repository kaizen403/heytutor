/**
 * Re-export geometry compiler verify from drawing (runs after package build).
 */
import {
  compileScene,
  inferSceneFromQuestion,
  validateSceneSpec,
  type SceneSpec,
} from "@heytutor/drawing";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

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
assert(triCompiled.commands.filter((c) => c.type === "DRAW_LINE").length >= 3, "need 3 edges");

const opticsQ =
  "A convex mirror has focal length 15 cm. An object is placed 20 cm in front of it. Find the image distance.";
const opticsScene = inferSceneFromQuestion(opticsQ);
assert(opticsScene?.kind === "optics", "infer optics");
const opticsCompiled = compileScene(opticsScene!, { question: opticsQ });
assert(opticsCompiled.ok && opticsCompiled.plugin === "optics", "optics plugin");

const circuitQ =
  "Three resistors 2Ω, 3Ω, 4Ω in series with a 12 V battery. Find current.";
const circuitScene = inferSceneFromQuestion(circuitQ);
assert(circuitScene?.kind === "circuit", "infer circuit");
assert(compileScene(circuitScene!, { question: circuitQ }).ok, "circuit compile");

assert(validateSceneSpec({}) === null, "reject empty");

console.log("verify-geometry-compiler: ok");
