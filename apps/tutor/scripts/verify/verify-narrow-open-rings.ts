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
import { isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
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
    quantities: [],
    entities,
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: 0, xMax: 5, yMin: 0, yMax: 22 }, outputs: ["axes"] },
      { id: "make_left", operator: "function_curve", inputs: { expression: "x^2", xMin: 0, xMax: 3, samples: 65 }, outputs: ["left"] },
      { id: "make_right", operator: "function_curve", inputs: { expression: options.right ?? "6*x-9", xMin: 3, xMax: 5, samples: 33 }, outputs: ["right"] },
      ...(join === null ? [] : [{ id: "make_join", operator: "curve_anchor", inputs: { curve: "left", at: join }, outputs: ["join"] }]),
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
// An open end on a point: its own dot becomes a ring, and both it and the mark are narrowed over another piece's filled mark.
function openOnPoint(right: string): SceneDocument {
  const raw: Row = {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
    source: { question: QUESTION, nonMetric: true, representationTier: "qualitative_verified", diagramYieldPolicy: "verified_parts" },
    quantities: [{ id: "x0", symbol: "x0", value: 3 }], relations: [], assertions: [], teachingTimeline: [],
    entities: [{ id: "axes", kind: "axes", role: "coordinate axes" }, { id: "left", kind: "polyline", role: "curve" }, { id: "right", kind: "polyline", role: "curve" }, { id: "end", kind: "point", role: "excluded point" }],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: 0, xMax: 5, yMin: 0, yMax: 22 }, outputs: ["axes"] },
      { id: "make_left", operator: "function_curve", inputs: { expression: "x^2", xMin: 0, xMax: 3, samples: 65 }, outputs: ["left"] },
      { id: "make_right", operator: "function_curve", inputs: { expression: right, xMin: 3, xMax: 5, samples: 33 }, outputs: ["right"] },
      { id: "make_end", operator: "curve_anchor", inputs: { curve: "left", at: "x0" }, outputs: ["end"] },
    ],
    annotations: [{ id: "left_exclusion", kind: "endpoint", targetIds: ["end"], style: { pointStyle: "open" } }, { id: "right_inclusion", kind: "endpoint", targetIds: ["right"], style: { pointStyle: "filled" } }],
    requiredEntityIds: ["axes", "left", "right", "end"], revealGroups: [{ id: "g", entityIds: ["axes", "left", "right", "end"], dependsOn: [], narrationCue: "The two pieces." }],
  };
  const validated = validateSceneDocument(raw);
  assert(validated.document, "the open point fixture is valid");
  return validated.document;
}
assert.deepEqual(radii(openOnPoint("6*x-9")), [2, 2], "an open end on a point: its own dot, now a ring, and the mark are both drawn at radius 2");
assert.deepEqual(radii(openOnPoint("6*x-5")), [6, 6], "and at a jump both keep radius 6");
// The same entity marked both included and excluded at one spot is not a join: its ring is left as drawn.
{
  const raw: Row = {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
    source: { question: "Show the set [1, 3) on a number line.", nonMetric: true, representationTier: "qualitative_verified", diagramYieldPolicy: "verified_parts" },
    quantities: [], relations: [], assertions: [], teachingTimeline: [],
    entities: [{ id: "line", kind: "axes", role: "axes" }, { id: "A", kind: "point", role: "lower end" }, { id: "C", kind: "point", role: "upper end" }, { id: "K", kind: "segment", role: "segment" }],
    constructions: [
      { id: "make_line", operator: "axes", inputs: { xMin: 0, xMax: 4, yMin: -1, yMax: 1 }, outputs: ["line"] },
      { id: "make_a", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "world" }, outputs: ["A"] },
      { id: "make_c", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["C"] },
      { id: "make_k", operator: "segment", inputs: { start: "A", end: "C" }, outputs: ["K"] },
    ],
    // Each mark on the segment lands on its first point, so the open one sits on A too, over K's own filled mark.
    annotations: [{ id: "closed", kind: "endpoint", targetIds: ["A", "K"], style: { pointStyle: "filled" } }, { id: "open", kind: "endpoint", targetIds: ["C", "K"], style: { pointStyle: "open" } }],
    requiredEntityIds: ["line", "A", "C", "K"], revealGroups: [{ id: "g", entityIds: ["line", "A", "C", "K"], dependsOn: [], narrationCue: "The set." }],
  };
  const validated = validateSceneDocument(raw);
  assert(validated.document, "the set fixture is valid");
  const drawn = rings(compiled(validated.document));
  assert(drawn.length >= 2 && drawn.every((ring) => ring.radius === 6), `a segment marked both ways keeps its rings at radius 6: ${JSON.stringify(drawn.map((ring) => ring.radius))}`);
}
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
// A drawn circle centred on a filled point is not an open end, and keeps its size.
{
  const raw: Row = {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
    source: { question: "Draw a circle of radius 3 about O.", nonMetric: true, representationTier: "qualitative_verified", diagramYieldPolicy: "verified_parts" },
    quantities: [], relations: [], assertions: [], teachingTimeline: [],
    entities: [{ id: "o", kind: "point", role: "centre", label: "O" }, { id: "ring", kind: "circle", role: "circle" }],
    constructions: [{ id: "make_o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] }, { id: "make_ring", operator: "circle", inputs: { center: "o", radius: 3 }, outputs: ["ring"] }],
    annotations: [{ id: "centre", kind: "endpoint", targetIds: ["o"], style: { pointStyle: "filled" } }],
    requiredEntityIds: ["o", "ring"], revealGroups: [{ id: "g", entityIds: ["o", "ring"], dependsOn: [], narrationCue: "The circle." }],
  };
  const validated = validateSceneDocument(raw);
  assert(validated.document, "the circle fixture is valid");
  const circle = compiled(validated.document).find((p) => p.entityId === "ring" && p.kind === "circle")!;
  assert(circle.radius! > 20, `a circle centred on a filled point keeps its drawn radius: ${circle.radius}`);
}
// 4. With verified parts off nothing changes: the ring was already radius 2.
assert.deepEqual(radii(piecewise({ yield: false })), [2], "verified parts off draws radius 2 as before");
assert.deepEqual(radii(piecewise({ yield: false, right: "6*x-5" })), [2], "for a jump too");
console.log("PASS narrow ring: radius 2 only on another entity's filled point; holes keep radius 6");

// 5. Rule 3. A saved turn stores the drawn ink in its intro rows; reopen draws those rows as stored, and rebuilds the
// figure from the document only for pointing. A resume save admits the page's document again.
const narrationRows = [{ orderIndex: 0, narration: "Here are the two pieces.", spokenText: "Here are the two pieces.", command: null }];
const artifacts = { schemaVersion: "scene-artifacts/v3", representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready",
  turnPlan: { schemaVersion: "turn-plan/v3", question: QUESTION, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" } };
const lessonOf = (document: SceneDocument, extra: Row = {}) => ({ question: QUESTION, rawResponse: "Here are the two pieces.", segments: narrationRows, visualStatus: "validated", sceneDocument: document, sceneArtifacts: artifacts, ...extra }) as unknown as SubmittedTurnSceneMetadata;
const inkRows = (segments: Row[]) => segments.filter((segment) => isStoredCommandTrustedGeometry(segment.command));
const circlesIn = (segments: Row[]) => inkRows(segments).flatMap((segment) => parseStoredSegmentCommands(segment.command)).filter((command) => command.type === "DRAW_CIRCLE").map((command) => command.params as number[]);
async function ruleThree(): Promise<void> {
  for (const [name, document, rebuilt] of [["the join", piecewise(), 2], ["a true hole", piecewise({ right: "6*x-5" }), 6]] as const) {
    const centre = rings(compiled(document))[0]!.points[0]!;
    const atRing = ([x, y]: number[]) => Math.hypot(x! - centre.x, y! - centre.y) < 1e-6;
    // The board as dev saved it: the same intro ink with the ring at radius 6.
    const savedNow = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify(lessonOf(document))));
    assert(savedNow.ok && savedNow.value.visualStatus === "validated", `${name} saves: ${savedNow.ok ? savedNow.value.visualStatus : `${savedNow.code} ${savedNow.error}`}`);
    const devSegments = savedNow.value.segments.map((segment) => isStoredCommandTrustedGeometry(segment.command)
      ? { ...segment, command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command).map((command) => command.type === "DRAW_CIRCLE" && atRing(command.params as number[]) ? { ...command, params: [...(command.params as number[]).slice(0, 2), 6, ...(command.params as number[]).slice(3)] } : command), { trustedDiagramGeometry: true }) }
      : segment);
    assert(circlesIn(devSegments).some((params) => atRing(params) && params[2] === 6), `${name}'s stored dev ink holds the ring at radius 6`);
    const storedDev = { ...savedNow.value, id: "ring-lesson", kind: "lesson", status: "complete", segments: devSegments } as never;
    // Its next resume save passes.
    const resumed = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify(lessonOf(document, { sceneArtifacts: { ...artifacts, ...boardContinuationArtifacts(QUESTION) } }))), { kind: "resume" });
    assert(resumed.ok && resumed.value.visualStatus === "validated", `${name} saved under dev passes its next resume save: ${resumed.ok ? "" : resumed.code}`);
    assert(admitStoredScene({ sceneDocument: document, sceneQuestion: QUESTION, turnPlan: null, submittedTier: "qualitative_verified" }).ok, `${name}'s document is admitted again`);
    // It reopens as saved: the stored rows, ring and all, are kept and drawn as they are.
    const reopened = sourceCheckedStoredTurn(storedDev) as unknown as Row;
    assert.equal(reopened.visualStatus, "validated", `${name} reopens with its figure`);
    assert.deepEqual(reopened.segments, devSegments, `${name} reopens with the ink dev saved, ring at radius 6`);
    // The figure rebuilt for pointing keeps the ring's centre.
    const restored = restoreVerifiedPresentationFromTurn({ question: QUESTION, sceneDocument: document, sceneArtifacts: artifacts } as never);
    assert(restored, `${name} rebuilds a figure to point at`);
    const ring = restored.diagram.commands.filter((command) => command.type === "DRAW_CIRCLE").map((command) => command.params as number[]).find(atRing);
    assert(ring && ring[2] === rebuilt, `${name}'s rebuilt ring sits at the saved ring's centre, radius ${rebuilt}`);
  }
  console.log("PASS rule 3: a board saved under dev with a join ring, and one with a true hole, pass their resume save and reopen as saved");
  console.log("PASS narrow open rings: 2 groups");
}
void ruleThree().catch((error) => { console.error(error); process.exitCode = 1; });

