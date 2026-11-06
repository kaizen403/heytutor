/**
 * With verified parts on, an open endpoint is drawn as a wide hollow ring
 * (radius 6), so a hole reads as a hole. Drawn on another entity's filled
 * point, as at a smooth join where the other piece includes the point, that
 * wide ring reads as a hole round the dot. There it is drawn at radius 2 over
 * the dot, as before verified parts. Every other ring is unchanged.
 * A saved board stores its drawn ink and reopens as it was saved; the figure
 * rebuilt for pointing keeps the ring's centre.
 */
import assert from "node:assert/strict";
import { SCENE_DOCUMENT_VERSION, compileSceneDocument, validateSceneDocument, type RenderPrimitive, type SceneDocument } from "@heytutor/scene-engine";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
console.warn = () => {};

const QUESTION = "Let f(x) = x^2 for x <= 3 and f(x) = 6x - 9 for x > 3. Is f continuous at x = 3?";
/** Two pieces meeting at x = 3, the right one open at its start; options move or drop the filled join. */
function piecewise(options: { right?: string; join?: number | null; openFirst?: boolean; yield?: boolean } = {}): SceneDocument {
  const join = options.join === undefined ? 3 : options.join;
  const entities: Row[] = [
    { id: "axes", kind: "axes", role: "coordinate axes" },
    { id: "left", kind: "polyline", role: "curve" },
    { id: "right", kind: "polyline", role: "curve" },
    ...(join === null ? [] : [{ id: "join", kind: "point", role: "included point" }]),
  ];
  const filled = join === null ? [] : [{ id: "included", kind: "endpoint", targetIds: ["join"], style: { pointStyle: "filled" } }];
  const open = [{ id: "right_exclusion", kind: "endpoint", targetIds: ["right"], style: { pointStyle: "open" } }];
  const raw: Row = {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
    source: { question: QUESTION, nonMetric: true, representationTier: "qualitative_verified", ...(options.yield === false ? {} : { diagramYieldPolicy: "verified_parts" }) },
    quantities: join === null ? [] : [{ id: "x0", symbol: "x0", value: join }],
    entities,
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: 0, xMax: 5, yMin: 0, yMax: 22 }, outputs: ["axes"] },
      { id: "make_left", operator: "function_curve", inputs: { expression: "x^2", xMin: 0, xMax: 3, samples: 65 }, outputs: ["left"] },
      { id: "make_right", operator: "function_curve", inputs: { expression: options.right ?? "6*x-9", xMin: 3, xMax: 5, samples: 33 }, outputs: ["right"] },
      ...(join === null ? [] : [{ id: "make_join", operator: "curve_anchor", inputs: { curve: "left", at: "x0" }, outputs: ["join"] }]),
    ],
    annotations: options.openFirst ? [...open, ...filled] : [...filled, ...open],
    requiredEntityIds: entities.map((e) => e.id),
    revealGroups: [{ id: "g", entityIds: entities.map((e) => e.id), dependsOn: [], narrationCue: "The two pieces." }],
    assertions: [], relations: [], teachingTimeline: [],
  };
  const validated = validateSceneDocument(raw);
  assert(validated.document, `the fixture is valid: ${JSON.stringify(validated.errors?.slice(0, 2))}`);
  return validated.document;
}
const rings = (primitives: RenderPrimitive[]) => primitives.filter((p) => p.kind === "circle" && p.provenance?.pointStyle === "open");
function compiled(document: SceneDocument) {
  const result = compileSceneDocument(document);
  assert(result.ok && result.renderScene, JSON.stringify(result.report.issues.filter((i) => i.severity === "fatal")).slice(0, 200));
  return result.renderScene.primitives;
}
const radii = (document: SceneDocument) => rings(compiled(document)).map((ring) => ring.radius);

// 1. A smooth join: the other piece's filled point sits under the ring.
assert.deepEqual(radii(piecewise()), [2], "an open end on another piece's filled join point is drawn at radius 2");
assert.deepEqual(radii(piecewise({ openFirst: true })), [2], "whichever annotation comes first");
// 2. True holes keep the wide ring.
assert.deepEqual(radii(piecewise({ right: "6*x-5" })), [6], "a jump, its filled point elsewhere, keeps radius 6");
assert.deepEqual(radii(piecewise({ join: null })), [6], "a hole with no filled point keeps radius 6");
// 3. Only a dot under the ring: one 1.5 px from its centre is a different point.
const offset = (delta: number) => {
  const primitives = compiled(piecewise({ join: 3 - delta }));
  const ring = rings(primitives)[0]!.points[0]!, dot = primitives.find((p) => p.entityId === "join" && p.kind === "point")!.points[0]!;
  return Math.hypot(ring.x - dot.x, ring.y - dot.y);
};
const delta = 0.001 * 1.5 / offset(0.001);
assert(offset(delta) > 1.2 && offset(delta) < 2, `the fixture's dot sits about 1.5 px off the ring's centre: ${offset(delta)}`);
assert.deepEqual(radii(piecewise({ join: 3 - delta })), [6], "a filled point 1.5 px from the ring's centre keeps radius 6");
// 4. With verified parts off nothing changes: the ring was already radius 2.
assert.deepEqual(radii(piecewise({ yield: false })), [2], "verified parts off draws radius 2 as before");
assert.deepEqual(radii(piecewise({ yield: false, right: "6*x-5" })), [2], "for a jump too");
console.log("PASS narrow ring: radius 2 only on another entity's filled point; holes keep radius 6");

// 5. Rule 3. The save stores the drawn ink; reopen draws that ink, and rebuilds the figure only for pointing.
for (const [name, document, expected] of [["the join", piecewise(), 2], ["a true hole", piecewise({ right: "6*x-5" }), 6]] as const) {
  const admitted = admitStoredScene({ sceneDocument: document, sceneQuestion: QUESTION, turnPlan: null, submittedTier: "qualitative_verified" });
  assert(admitted.ok, `${name} saved under dev passes its next resume save: ${admitted.ok ? "" : admitted.code}`);
  const restored = restoreVerifiedPresentationFromTurn({ question: QUESTION, sceneDocument: document, sceneArtifacts: null } as never);
  assert(restored, `${name} reopens with a figure to point at`);
  const circles = restored.diagram.commands.filter((command) => command.type === "DRAW_CIRCLE").map((command) => command.params as number[]);
  const centre = rings(compiled(document))[0]!.points[0]!;
  const ring = circles.find(([x, y]) => Math.hypot(x! - centre.x, y! - centre.y) < 1e-6);
  assert(ring, `${name}'s rebuilt ring keeps the saved ring's centre, so pointing lands where the saved ink is`);
  assert.equal(ring[2], expected, `${name}'s rebuilt ring has radius ${expected}`);
}
console.log("PASS rule 3: a saved join and a saved hole pass their resume save and reopen; the ring keeps its centre");
console.log("PASS narrow open rings: 2 groups");
