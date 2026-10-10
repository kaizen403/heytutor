/**
 * A directed curve (a traced field line) must reach the board as the whole
 * curve with its head on the last segment, not as a straight chord arrow, and
 * a plain two point vector must still be exactly one start to end ARROW.
 */
import { arrowPath, linePath } from "@heytutor/drawing";
import { compileSceneDocument, validateSceneDocument, type RenderScene, type SceneDocument } from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Point = { x: number; y: number };

function scene(operator: string, inputs: Record<string, unknown>, id: string, kind: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: operator },
    source: {},
    quantities: [],
    entities: [{ id, kind, role: kind }],
    constructions: [{ id: "make", operator, inputs, outputs: [id] }],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: [id],
    revealGroups: [{ id: "g", entityIds: [id], dependsOn: [], narrationCue: operator }],
    teachingTimeline: [],
  } as unknown as SceneDocument;
}

function compiled(document: SceneDocument): { document: SceneDocument; renderScene: RenderScene } {
  const validated = validateSceneDocument(document);
  const ready = validated.document ?? document;
  const result = compileSceneDocument(ready);
  assert(result.ok && result.renderScene, `scene did not compile: ${result.report.issues.map((issue) => issue.code).join(", ")}`);
  return { document: ready, renderScene: result.renderScene };
}

const sameParams = (params: readonly number[], points: readonly Point[]): boolean =>
  params.length === points.length * 2 && points.every((point, index) => params[index * 2] === point.x && params[index * 2 + 1] === point.y);

// A curved field line from a +q, -q pair.
const field = compiled(scene("field_lines", {
  charges: [{ id: "plus", position: { x: -1, y: 0 }, charge: 1 }, { id: "minus", position: { x: 1, y: 0 }, charge: -1 }],
  starts: [{ x: -0.925, y: 0.13 }], stepLength: 0.1, stepCount: 12, exclusionRadius: 0.1, k: 1,
}, "lines", "polyline"));
const line = field.renderScene.primitives.find((primitive) => primitive.entityId === "lines" && primitive.kind !== "label");
assert(line, "the field line compiles to a stroke");
assert(line.kind === "vector", `the field line keeps its direction as a vector primitive, got ${line.kind}`);
assert(line.points.length > 2, "the field line keeps its curved samples");
const fieldCommands = buildVerifiedDiagramPresentation(field.document, field.renderScene).diagram.commands;
const strokes = fieldCommands.filter((command) => command.type === "DRAW_LINE");
const arrows = fieldCommands.filter((command) => command.type === "ARROW");
assert(strokes.length === 1 && sameParams(strokes[0]!.params, line.points), "the curve is drawn once through every sampled vertex, first to last");
const last = line.points.slice(-2);
assert(last.length === 2 && last[1] === line.points[line.points.length - 1], "the head segment ends at the final vertex");
assert(arrows.length === 1 && sameParams(arrows[0]!.params, last), "one arrowhead sits on the last segment of the curve");
const chord = [line.points[0]!, line.points[line.points.length - 1]!];
assert(!fieldCommands.some((command) => command.type === "ARROW" && sameParams(command.params, chord)), "no straight chord arrow replaces the curve");

// A finely sampled field line ends in sub-pixel steps. Its head must still be
// drawn: check the rendered path, not only that an ARROW command exists.
const fine = compiled(scene("field_lines", {
  charges: [{ id: "plus", position: { x: 0, y: 0 }, charge: 1 }],
  starts: [{ x: 0.0105, y: 0 }], stepLength: 0.001, stepCount: 100, exclusionRadius: 0.01, k: 1,
}, "fine", "polyline"));
const fineCommands = buildVerifiedDiagramPresentation(fine.document, fine.renderScene).diagram.commands;
const fineArrow = fineCommands.find((command) => command.type === "ARROW");
assert(fineArrow, "a finely sampled field line still has an ARROW");
const [ax, ay, bx, by] = fineArrow.params as [number, number, number, number];
assert(arrowPath(ax, ay, bx, by) !== linePath(ax, ay, bx, by), `the fine field line's head is drawn, not a bare line (shaft ${Math.hypot(bx - ax, by - ay).toFixed(2)} px)`);

// Guard: a two point vector is still one start to end ARROW and nothing else.
const straight = compiled(scene("vector", { start: [0, 0], end: [3, 2] }, "v", "vector"));
const vector = straight.renderScene.primitives.find((primitive) => primitive.entityId === "v" && primitive.kind !== "label");
assert(vector?.kind === "vector" && vector.points.length === 2, "a straight vector compiles to a two point vector primitive");
const vectorCommands = buildVerifiedDiagramPresentation(straight.document, straight.renderScene).diagram.commands;
const vectorArrows = vectorCommands.filter((command) => command.type === "ARROW");
assert(vectorArrows.length === 1 && sameParams(vectorArrows[0]!.params, vector.points), "a two point vector is exactly one ARROW from start to end");
assert(!vectorCommands.some((command) => command.type === "DRAW_LINE"), "a two point vector adds no separate stroke");

console.log(`verify-directed-curve-ink: ok (field line ${line.points.length} vertices, head on the last segment; straight vector unchanged)`);
