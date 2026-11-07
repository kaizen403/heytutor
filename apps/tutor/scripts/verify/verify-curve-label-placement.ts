/**
 * The curve label switch (`DIAGRAM_CURVE_LABELS`, off by default) places a
 * graph's label (y = f(x)) beside its own stroke. It is a stamp on the
 * document, set only by the engine from the server's switch:
 * - off, nothing changes;
 * - a board saved without the stamp saves, resumes and reopens as dev draws it;
 * - a board saved with it reopens as drawn after the switch is turned off;
 * - no other curve moves;
 * - a doubt's figure and later lesson figures stay as dev draws them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SCENE_DOCUMENT_VERSION, compileSceneDocument, documentHasFunctionCurve, isCurveLabelPlacementOnStroke,
  parseCurveLabelSwitch, prepareVerifiedParts, validateSceneDocument, withCurveLabelPlacement,
  type SceneDocument,
} from "@heytutor/scene-engine";
import { isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { normalizeSceneDocumentModelOutput } from "@heytutor/tutor-core";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { admitLessonFigures, admitStoredScene } from "../../lib/scene/sceneAdmission";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { resolveDiagramCurveLabels } from "../../lib/scene/diagramStrategy.server";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { composeDoubtFigureQuestion, doubtFigureArtifacts } from "../../lib/boards/doubtFigure";
import { LESSON_FIGURES_VERSION, lessonFigureSceneInput } from "../../lib/boards/lessonFigures";
import { doubtPageCheck, LESSON_TURN_ID, pageRowsOf, stored } from "./fixtures/doubtFigureScene";
import { bindPageLessonCurveLabels, memoryPageFigureStore, storedCurveLabels } from "../../lib/scene/pageFigureLoader";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
console.warn = () => {};
const root = resolve(__dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

const QUESTION = "Find the area enclosed by y = x^2 - 4x - 5 and the x-axis from x = 0 to x = 6.";
/** A tall, narrow graph whose label, placed at its bounding box, sits far from the curve. */
function areaFigure(question = QUESTION): SceneDocument {
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "area figure" },
    source: { question, nonMetric: true, representationTier: "qualitative_verified" },
    entities: [
      { id: "axes", kind: "axes", role: "coordinate axes" }, { id: "curve", kind: "polyline", role: "given curve", label: "y=x²−4x−5" },
      { id: "zero", kind: "polyline", role: "x-axis boundary" }, { id: "left", kind: "point", role: "lower bound", label: "x=0" },
      { id: "right", kind: "point", role: "upper bound", label: "x=6" }, { id: "root", kind: "point", role: "root", label: "x=5" },
      { id: "below", kind: "polygon", role: "region below the x-axis" }, { id: "above", kind: "polygon", role: "region above the x-axis" },
    ],
    constructions: [
      { id: "makeAxes", operator: "axes", inputs: { xMin: -0.5, xMax: 6.5, yMin: -10, yMax: 8 }, outputs: ["axes"] },
      { id: "makeCurve", operator: "function_curve", inputs: { expression: "x^2-4*x-5", xMin: 0, xMax: 6 }, outputs: ["curve"] },
      { id: "makeZero", operator: "function_curve", inputs: { expression: "0", xMin: 0, xMax: 6 }, outputs: ["zero"] },
      { id: "makeLeft", operator: "curve_anchor", inputs: { curve: "zero", at: 0 }, outputs: ["left"] },
      { id: "makeRight", operator: "curve_anchor", inputs: { curve: "zero", at: 6 }, outputs: ["right"] },
      { id: "makeRoot", operator: "curve_anchor", inputs: { curve: "curve", at: 5 }, outputs: ["root"] },
      { id: "makeBelow", operator: "function_region", inputs: { upper: "zero", lower: "curve", xMin: 0, xMax: 5 }, outputs: ["below"] },
      { id: "makeAbove", operator: "function_region", inputs: { upper: "curve", lower: "zero", xMin: 5, xMax: 6 }, outputs: ["above"] },
    ],
    requiredEntityIds: ["axes", "curve", "zero", "left", "right", "root", "below", "above"],
    revealGroups: [
      { id: "setup", entityIds: ["axes", "curve", "zero", "left", "right"], dependsOn: [], narrationCue: "Plot the curve." },
      { id: "split", entityIds: ["root", "below", "above"], dependsOn: ["setup"], narrationCue: "Split the area." },
    ],
    assertions: [], annotations: [], quantities: [], relations: [], teachingTimeline: [],
  } as unknown as SceneDocument;
}
/** A spring drawn as a planner polyline beside a graph: its label is not a graph's and never moves. */
function springBesideGraph(): SceneDocument {
  const coils = Array.from({ length: 12 }, (_, index) => ({ x: 7 + index * 0.25, y: index % 2 === 0 ? 1 : 2 }));
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
    source: { question: "Label the spring and the graph.", nonMetric: true, representationTier: "qualitative_verified" },
    entities: [{ id: "graph", kind: "polyline", role: "graph", label: "y=x" }, { id: "spring", kind: "polyline", role: "spring", label: "k" }],
    constructions: [
      { id: "makeGraph", operator: "function_curve", inputs: { expression: "x", xMin: 0, xMax: 3 }, outputs: ["graph"] },
      { id: "makeSpring", operator: "polyline", inputs: { points: coils }, outputs: ["spring"] },
    ],
    requiredEntityIds: ["graph", "spring"],
    revealGroups: [{ id: "g", entityIds: ["graph", "spring"], dependsOn: [], narrationCue: "The graph and the spring." }],
    assertions: [], annotations: [], quantities: [], relations: [], teachingTimeline: [],
  } as unknown as SceneDocument;
}

const valid = (document: SceneDocument) => {
  const validated = validateSceneDocument(document);
  assert(validated.document, `the fixture is a valid document: ${JSON.stringify(validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code)).slice(0, 200)}`);
  return validated.document;
};
const throughYield = (document: SceneDocument) => {
  const prepared = prepareVerifiedParts(document, { enabled: true, figureConsistency: true });
  const compiled = prepared.compiledScene ?? compileSceneDocument(prepared.document, { figureConsistency: true });
  assert(compiled.ok && compiled.renderScene, "the figure compiles");
  return { prepared, scene: compiled.renderScene };
};
const throughYieldOk = (document: SceneDocument) => {
  const prepared = prepareVerifiedParts(document, { enabled: true, figureConsistency: true });
  const compiled = prepared.compiledScene ?? compileSceneDocument(prepared.document, { figureConsistency: true });
  return compiled.ok && !!compiled.renderScene;
};
const labelOf = (scene: Row, entityId: string) => scene.primitives.find((primitive: Row) => primitive.kind === "label" && primitive.entityId === entityId);
const segmentDistance = (p: Row, a: Row, b: Row) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const strokeDistance = (scene: Row, label: Row, entityId: string) => {
  const stroke = scene.primitives.find((primitive: Row) => primitive.entityId === entityId && primitive.kind === "polyline");
  return Math.min(...stroke.points.slice(1).map((point: Row, index: number) => segmentDistance(label.points[0], stroke.points[index], point)));
};

const plan = (question: string) => ({ schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" });
const artifacts = (question: string) => ({ schemaVersion: "scene-artifacts/v3", turnPlan: plan(question), diagramResultStatus: "ready", representationTier: "qualitative_verified", nonMetric: true });
const rows = [{ orderIndex: 0, narration: "Here is the curve.", spokenText: "Here is the curve.", command: null }];
const metadataOf = (sceneDocument: SceneDocument, extra: Row = {}): SubmittedTurnSceneMetadata => ({
  question: QUESTION, rawResponse: "Here is the curve.", segments: rows, visualStatus: "validated", sceneDocument,
  sceneArtifacts: artifacts(QUESTION), ...extra,
} as unknown as SubmittedTurnSceneMetadata);
const savedDocument = async (submitted: SubmittedTurnSceneMetadata, options: Parameters<typeof canonicalizeTurnSceneMetadata>[1]) => {
  const saved = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify(submitted)), options);
  assert(saved.ok, `the save passes: ${saved.ok ? "" : `${saved.code} ${saved.error}`}`);
  assert.equal(saved.value.visualStatus, "validated", "with its figure");
  return saved.value;
};

async function main() {
  // The switch.
  for (const raw of ["on", " ON ", "On"]) assert.equal(parseCurveLabelSwitch(raw), true, `"${raw}" turns it on`);
  for (const raw of [undefined, "", "off", "1", "true", "yes", "on_stroke"]) assert.equal(parseCurveLabelSwitch(raw), false, `"${raw}" leaves it off`);
  assert.equal(resolveDiagramCurveLabels(undefined), false, "unset is off");
  assert.equal(resolveDiagramCurveLabels("on"), true);
  console.log("PASS switch: only \"on\" turns it on");

  // The stamp: only a document that graphs y = f(x) carries it.
  const area = valid(areaFigure());
  const stamped = withCurveLabelPlacement(area, true);
  assert(isCurveLabelPlacementOnStroke(stamped) && !isCurveLabelPlacementOnStroke(area));
  assert.equal(withCurveLabelPlacement(stamped, true), stamped, "stamping twice changes nothing");
  assert.deepEqual(withCurveLabelPlacement(stamped, false), area, "off removes the stamp");
  const springAlone = springBesideGraph() as unknown as Row;
  const noGraph = valid({ ...springAlone, entities: springAlone.entities.filter((e: Row) => e.id === "spring"), constructions: springAlone.constructions.filter((c: Row) => c.operator !== "function_curve"), requiredEntityIds: ["spring"], revealGroups: [{ id: "g", entityIds: ["spring"], dependsOn: [], narrationCue: "The spring." }] } as unknown as SceneDocument);
  assert.equal(documentHasFunctionCurve(noGraph), false);
  assert.equal(withCurveLabelPlacement(noGraph, true), noGraph, "a figure without a graph is never stamped");
  console.log("PASS stamp: only a figure with a graph of y = f(x), and off removes it");

  // The placement: off, the label sits where dev puts it, far from the curve, and the yield removes it.
  const dev = throughYield(area);
  assert.equal(labelOf(dev.scene, "curve"), undefined, "unstamped, the graph's label is removed as dev removes it");
  assert(dev.prepared.issues.some((issue) => issue.code === "yield_label_omitted" && issue.expected === "label_owner_ambiguous"));
  const placed = throughYield(stamped);
  const curveLabel = labelOf(placed.scene, "curve");
  assert(curveLabel, "stamped, the graph keeps its label");
  assert(curveLabel.provenance?.usesLeader || strokeDistance(placed.scene, curveLabel, "curve") <= 40, "beside its own stroke");
  assert(!placed.prepared.issues.some((issue) => issue.code === "yield_label_omitted"), "and no label is removed");
  // A stamp value the engine does not write changes nothing.
  const bogus = { ...area, source: { ...area.source, curveLabelPlacement: "elsewhere" } } as SceneDocument;
  assert.deepEqual(compileSceneDocument(bogus).renderScene, compileSceneDocument(area).renderScene, "an unknown stamp value is dev");
  console.log("PASS placement: unstamped as dev, stamped beside its stroke and kept");

  // Only graphs of y = f(x) move: the spring's label is where dev puts it.
  const spring = valid(springBesideGraph());
  const springStamped = withCurveLabelPlacement(spring, true);
  assert(isCurveLabelPlacementOnStroke(springStamped));
  const springLabel = (document: SceneDocument) => labelOf(compileSceneDocument(document).renderScene as Row, "spring");
  assert.deepEqual(springLabel(springStamped)?.provenance?.labelBounds, springLabel(spring)?.provenance?.labelBounds, "a spring's label does not move");
  console.log("PASS scope: a label that is not a graph's stays where dev puts it");

  // Engine only: a planner cannot write the stamp, and validation sets it from the switch alone.
  const planned = normalizeSceneDocumentModelOutput({ ...areaFigure(), source: { ...areaFigure().source, curveLabelPlacement: "on_stroke" } } as never, QUESTION) as Row;
  assert.equal(planned.source.curveLabelPlacement, undefined, "the planner's stamp is dropped");
  const validateCandidate = (candidate: Row, curveLabels: boolean) => validateProductionSceneCandidate({ candidate, question: QUESTION, turnPlan: plan(QUESTION) as never, yieldPolicy: "verified_parts", curveLabels });
  const offResult = validateCandidate({ ...areaFigure(), source: { ...areaFigure().source, curveLabelPlacement: "on_stroke" } }, false);
  assert(offResult.valid && offResult.value && !isCurveLabelPlacementOnStroke(offResult.value.document), "switch off, a candidate's own stamp is removed");
  const onResult = validateCandidate(areaFigure() as unknown as Row, true);
  assert(onResult.valid && onResult.value && isCurveLabelPlacementOnStroke(onResult.value.document), "switch on, the engine stamps it");
  // Completion of an admitted figure validates its proposal with no switch: the figure's own stamp stays.
  const stampedValid = onResult.value!.document as unknown as Row;
  const completed = validateProductionSceneCandidate({ candidate: structuredClone(stampedValid), question: QUESTION, turnPlan: plan(QUESTION) as never });
  assert(completed.valid && completed.value && isCurveLabelPlacementOnStroke(completed.value.document), "an absent switch leaves an admitted figure's stamp");
  console.log("PASS engine only: dropped from planner output; validation stamps from the switch alone; completion keeps it");

  // Moved labels never cost a label: here the line's name moves into a spot that reads as another stroke's, so dev's figure stands.
  const regionQuestion = "Shade the region between y = 7 - x^2 and y = x + 1.";
  const between = {
    schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
    source: { question: regionQuestion, nonMetric: true, representationTier: "qualitative_verified" },
    quantities: [], relations: [], assertions: [], teachingTimeline: [], annotations: [],
    entities: [{ id: "ax", kind: "axes", role: "coordinate axes" }, { id: "parab", kind: "polyline", role: "parabola", label: "y = 7 - x²" }, { id: "line", kind: "polyline", role: "line", label: "y = x + 1" },
      { id: "left", kind: "point", role: "left intersection" }, { id: "right", kind: "point", role: "right intersection" }, { id: "region", kind: "polygon", role: "enclosed region" }],
    constructions: [
      { id: "kax", operator: "axes", inputs: { xMin: -4, xMax: 3, yMin: -7, yMax: 8 }, outputs: ["ax"] },
      { id: "kparab", operator: "function_curve", inputs: { expression: "7-x^2", xMin: -3.5, xMax: 2.5 }, outputs: ["parab"] },
      { id: "kline", operator: "function_curve", inputs: { expression: "1*x+1", xMin: -3.5, xMax: 2.5 }, outputs: ["line"] },
      { id: "kleft", operator: "curve_anchor", inputs: { curve: "parab", at: -3 }, outputs: ["left"] },
      { id: "kright", operator: "curve_anchor", inputs: { curve: "parab", at: 2 }, outputs: ["right"] },
      { id: "kregion", operator: "function_region", inputs: { upper: "parab", lower: "line", xMin: -3, xMax: 2 }, outputs: ["region"] },
    ],
    requiredEntityIds: ["ax", "parab", "line", "left", "right", "region"],
    revealGroups: [{ id: "g", entityIds: ["ax", "parab", "line", "left", "right", "region"], dependsOn: [], narrationCue: "The region." }],
  } as unknown as Row;
  const regionCandidate = (curveLabels: boolean) => validateProductionSceneCandidate({ candidate: structuredClone(between), question: regionQuestion, turnPlan: plan(regionQuestion) as never, yieldPolicy: "verified_parts", curveLabels });
  const omittedIn = (result: ReturnType<typeof regionCandidate>) => result.errors.filter((issue) => issue.code === "yield_label_omitted").map((issue) => issue.path);
  const devRegion = regionCandidate(false);
  assert(devRegion.valid && omittedIn(devRegion).length === 0, `dev draws every label: ${JSON.stringify(devRegion.errors.filter((issue) => issue.severity === "fatal").map((issue) => issue.code))} ${JSON.stringify(omittedIn(devRegion))}`);
  const plainStamp = prepareVerifiedParts(withCurveLabelPlacement(valid(between as never), true), { enabled: true, figureConsistency: true });
  assert(plainStamp.issues.some((issue) => issue.code === "yield_label_omitted"), "the moved labels alone would leave a name out");
  const onRegion = regionCandidate(true);
  assert(onRegion.valid && onRegion.value && !isCurveLabelPlacementOnStroke(onRegion.value.document), "so with the switch on, dev's figure stands");
  assert.deepEqual(omittedIn(onRegion), [], "with every label");
  assert.deepEqual(onRegion.value.renderScene, devRegion.value!.renderScene, "drawn exactly as dev");
  // The switch fixes, it never admits: a figure dev refuses stays refused, even
  // when its moved label would have let it pass.
  const refusedByDev = { ...areaFigure(), assertions: [{ id: "curveLabelled", predicate: "label_attached", entities: ["curve"] }] } as unknown as Row;
  const devRefusal = validateCandidate(structuredClone(refusedByDev), false);
  assert(!devRefusal.valid, "dev refuses the figure, its curve label unplaced");
  const rawStamped = throughYieldOk(withCurveLabelPlacement(valid(refusedByDev as unknown as SceneDocument), true));
  assert(rawStamped, "the moved label alone would let it pass");
  const switchOnRefusal = validateCandidate(structuredClone(refusedByDev), true);
  assert(!switchOnRefusal.valid, "with the switch on it is still refused");
  assert.deepEqual(switchOnRefusal, devRefusal, "with dev's refusal");
  const admitRefused = (sceneDocument: SceneDocument, curveLabels: boolean) => admitStoredScene({ sceneDocument, sceneQuestion: QUESTION, turnPlan: null, submittedTier: "qualitative_verified", curveLabels });
  // Saved figures carry the yield stamp live validation gives them.
  const yieldStamped = valid({ ...refusedByDev, source: { ...refusedByDev.source, diagramYieldPolicy: "verified_parts" } } as unknown as SceneDocument);
  const devRefused = admitRefused(yieldStamped, false);
  const stampedRefused = admitRefused(withCurveLabelPlacement(yieldStamped, true), true);
  assert(!devRefused.ok && !stampedRefused.ok && stampedRefused.code === devRefused.code, `and the server refuses a stamped copy with dev's code: ${JSON.stringify([devRefused.ok ? "ok" : devRefused.code, stampedRefused.ok ? "ok" : stampedRefused.code])}`);
  console.log("PASS never admits: a figure dev refuses stays refused with the switch on, in validation and at the server");

  // The server keeps a submitted stamp only with its own switch on.
  const admit = (sceneDocument: SceneDocument, curveLabels?: boolean) => admitStoredScene({ sceneDocument, sceneQuestion: QUESTION, turnPlan: null, submittedTier: "qualitative_verified", ...(curveLabels === undefined ? {} : { curveLabels }) });
  const strippedAdmission = admit(stamped);
  assert(strippedAdmission.ok && !isCurveLabelPlacementOnStroke(strippedAdmission.document), "admission drops a stamp by default");
  const devAdmission = admit(area);
  assert(devAdmission.ok);
  assert.deepEqual(strippedAdmission.presentation, devAdmission.presentation, "and presents the figure as dev");
  const keptAdmission = admit(stamped, true);
  assert(keptAdmission.ok && isCurveLabelPlacementOnStroke(keptAdmission.document), "with the switch on it keeps it");
  assert.notDeepEqual(keptAdmission.presentation.diagram.commands, devAdmission.presentation.diagram.commands, "and draws the new placement");
  // Later lesson figures stay as dev draws them.
  const view = "graph";
  const laterQuestion = lessonFigureSceneInput(QUESTION, plan(QUESTION), view as never).question;
  const laterFigure = withCurveLabelPlacement(valid(areaFigure(laterQuestion)), true);
  const lessonFigures = admitLessonFigures({ schemaVersion: LESSON_FIGURES_VERSION, figures: [{ id: "figure_2", view, sceneDocument: laterFigure, tier: "qualitative_verified", family: view, figureSource: "fast_family" }] } as never, { lessonQuestion: QUESTION, lessonPlan: plan(QUESTION) });
  assert.equal(lessonFigures.artifact.figures.length, 1, `the later figure is admitted: ${JSON.stringify(lessonFigures.droppedFigureIds)}`);
  for (const figure of lessonFigures.artifact.figures) assert(!isCurveLabelPlacementOnStroke(figure.sceneDocument as SceneDocument), "a later lesson figure is admitted without the stamp");
  // The browser saves the figure as live validation left it. The server judges dev's figure the same way
  // (the unstamped document through the same label removal), so a drawn graph saves with the switch on or off.
  const liveDrawn = onResult.value!.document;
  assert(isCurveLabelPlacementOnStroke(liveDrawn) && liveDrawn.source.diagramYieldPolicy === "verified_parts", "the browser's figure carries both stamps");
  const savedLiveOn = admit(liveDrawn, true);
  assert(savedLiveOn.ok && isCurveLabelPlacementOnStroke(savedLiveOn.document), `with the switch on the server saves it stamped: ${savedLiveOn.ok ? "" : savedLiveOn.code}`);
  assert(labelOf(savedLiveOn.compiled.renderScene, "curve"), "with its label");
  const savedLiveOff = admit(liveDrawn, false);
  assert(savedLiveOff.ok && !isCurveLabelPlacementOnStroke(savedLiveOff.document), `with it off the server saves dev's figure, not a refusal: ${savedLiveOff.ok ? "" : savedLiveOff.code}`);
  console.log("PASS server: a submitted stamp is kept only with the switch on; a live drawn graph saves either way; later lesson figures stay dev");

  // Saves.
  const off = { curveLabelsEnabled: false };
  const on = { curveLabelsEnabled: true };
  assert(!isCurveLabelPlacementOnStroke((await savedDocument(metadataOf(stamped), off)).sceneDocument as SceneDocument), "switch off, a save drops the stamp");
  const savedOn = await savedDocument(metadataOf(stamped), on);
  assert(isCurveLabelPlacementOnStroke(savedOn.sceneDocument as SceneDocument), "switch on, the save keeps it");
  // The save rebuilds the figure's ink from its own compile and never compares the label positions it was sent.
  const presentedOn = buildVerifiedDiagramPresentation(savedOn.sceneDocument as SceneDocument, compileSceneDocument(savedOn.sceneDocument as SceneDocument).renderScene!, { originalQuestion: QUESTION, turnPlan: plan(QUESTION) as never });
  const shifted = presentedOn.introSegments.map((segment, orderIndex) => ({
    orderIndex, narration: segment.narration, spokenText: segment.narration,
    command: serializeSegmentCommands((segment.commands ?? []).map((command) => command.type === "LABEL" ? { ...command, params: command.params.map((value, index) => index < 2 ? value + 37 : value) } : command), { trustedDiagramGeometry: true }),
  }));
  const resent = await savedDocument(metadataOf(stamped, { segments: shifted }), on);
  const inkOf = (segments: Row[]) => segments.filter((segment) => isStoredCommandTrustedGeometry(segment.command)).map((segment) => parseStoredSegmentCommands(segment.command));
  assert.deepEqual(inkOf(resent.segments), inkOf(savedOn.segments), "label positions sent by the browser are replaced by the server's own");
  console.log("PASS save: the stamp follows the server's switch; submitted label positions are replaced, never compared");

  // Rule 3: a board saved under dev resumes with the switch on, as dev draws it.
  const devSaved = await savedDocument(metadataOf(area), off);
  const resumeOf = (sceneDocument: unknown) => metadataOf(sceneDocument as SceneDocument, { sceneArtifacts: { ...artifacts(QUESTION), ...boardContinuationArtifacts(QUESTION) } });
  const resumed = await savedDocument(resumeOf(devSaved.sceneDocument), { ...on, kind: "resume" });
  assert(!isCurveLabelPlacementOnStroke(resumed.sceneDocument as SceneDocument), "a dev board's resume save keeps it unstamped");
  assert.deepEqual(resumed.sceneDocument, devSaved.sceneDocument, "and saves the figure exactly as dev");
  // A board saved with the switch on reopens as it was drawn after the switch is turned off.
  const reopen = (saved: Row) => restoreVerifiedPresentationFromTurn({ question: QUESTION, sceneDocument: saved.sceneDocument, sceneArtifacts: saved.sceneArtifacts } as never);
  const reopenedOn = reopen(savedOn);
  assert(reopenedOn, "the stamped board reopens");
  assert.deepEqual(reopenedOn.diagram.commands, presentedOn.diagram.commands, "with the placement it was drawn with, whatever the switch says now");
  assert.notDeepEqual(reopenedOn.diagram.commands, reopen(devSaved)!.diagram.commands);
  // A resume keeps the figure as its page's lesson saved it, read from the lesson's own row, so replay finishes the
  // figure (it needs every resume's document equal to the opening one).
  const RESUME_ID = "33333333-3333-4333-8333-333333333333";
  const pageOf = (saved: Row) => bindPageLessonCurveLabels({ boardId: "b1", userId: "u1", turnId: RESUME_ID }, { store: memoryPageFigureStore(pageRowsOf([stored(LESSON_TURN_ID, 0, QUESTION, saved as never, { opensOnClear: true, kind: "lesson" })])) });
  assert.equal(await pageOf(savedOn)(), true, "the loader reads the lesson's stamp from its own row");
  assert.equal(await pageOf(devSaved)(), false, "and a dev lesson's lack of it");
  const resumedOff = await savedDocument(resumeOf(savedOn.sceneDocument), { ...off, kind: "resume", loadPageLessonCurveLabels: pageOf(savedOn) });
  assert.deepEqual(resumedOff.sceneDocument, savedOn.sceneDocument, "with the switch off, a stamped board's resume saves the lesson's own document");
  const forged = await savedDocument(resumeOf(withCurveLabelPlacement(devSaved.sceneDocument as SceneDocument, true)), { ...on, kind: "resume", loadPageLessonCurveLabels: pageOf(devSaved) });
  assert.deepEqual(forged.sceneDocument, devSaved.sceneDocument, "with it on, a dev board's resume drops a forged stamp and saves the lesson's own document");
  // A later checkpoint or close of a saved lesson (missing rows, late audio) is rebuilt with that row's own stamp.
  assert.equal(storedCurveLabels(savedOn as never), true, "a stamped saved row reads as stamped");
  assert.equal(storedCurveLabels(devSaved as never), false, "a dev saved row reads as unstamped");
  assert.equal(storedCurveLabels({ visualStatus: "text_only", sceneDocument: null }), null, "a row with no figure has no stamp, so a first figure follows the switch");
  assert.equal(storedCurveLabels(null), null, "nor does a turn with no row");
  const ownRow = (saved: Row) => ({ curveLabelsEnabled: storedCurveLabels(saved as never)! });
  const laterOff = await savedDocument(metadataOf(savedOn.sceneDocument as SceneDocument, { segments: savedOn.segments }), ownRow(savedOn));
  assert.equal(resolveDiagramCurveLabels(), false, "the switch is off here");
  assert.deepEqual(laterOff.sceneDocument, savedOn.sceneDocument, "with the switch off, a stamped lesson's later checkpoint saves its own document");
  assert.deepEqual(inkOf(laterOff.segments), inkOf(savedOn.segments), "and the ink the student saw");
  const laterOn = await savedDocument(metadataOf(withCurveLabelPlacement(devSaved.sceneDocument as SceneDocument, true), { segments: devSaved.segments }), ownRow(devSaved));
  assert.deepEqual(laterOn.sceneDocument, devSaved.sceneDocument, "with it on, a dev lesson's later checkpoint stays as dev");
  assert.deepEqual(inkOf(laterOn.segments), inkOf(devSaved.segments));
  // The checkpoint and close routes pass that stamp to both of their saves.
  const checkpoint = source("lib/boards/turnCheckpoint.ts");
  assert.match(checkpoint, /const ownCurveLabels = storedCurveLabels\(before\);\n\s*const curveLabelsOption = ownCurveLabels === null \? \{\} : \{ curveLabelsEnabled: ownCurveLabels \};/);
  assert.equal(checkpoint.match(/lessonFigureStart, kind: turnKind, \.\.\.curveLabelsOption \}\);/g)?.length, 2, "both checkpoint saves pass the row's own stamp");
  console.log("PASS rule 3: a dev board resumes as dev with the switch on; a stamped board reopens, resumes and checkpoints as drawn with it off");

  // A doubt's own figure stays as dev draws it, even with the switch on.
  const lessonTurn = stored(LESSON_TURN_ID, 0, QUESTION, devSaved as never, { opensOnClear: true, kind: "lesson" });
  const title = "Doubt: why is the area below the axis negative?";
  const composed = composeDoubtFigureQuestion(QUESTION, title);
  const doubtFigure = withCurveLabelPlacement(valid(areaFigure(composed)), true);
  const doubt = await canonicalizeTurnSceneMetadata({
    question: title, rawResponse: "Here is the curve.", segments: rows, visualStatus: "validated", sceneDocument: doubtFigure,
    sceneArtifacts: { ...artifacts(composed), ...boardContinuationArtifacts(QUESTION), ...doubtFigureArtifacts(LESSON_TURN_ID) },
  } as unknown as SubmittedTurnSceneMetadata, { ...on, kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck([lessonTurn]), loadPageLessonCurveLabels: pageOf(savedOn) });
  assert(doubt.ok && doubt.value.visualStatus === "validated", `the doubt saves its figure: ${doubt.ok ? doubt.value.visualStatus : doubt.code}`);
  assert(!isCurveLabelPlacementOnStroke(doubt.value.sceneDocument as SceneDocument), "a doubt's own figure is saved without the stamp");
  console.log("PASS doubt: a doubt's own figure stays as dev draws it");

  // Plumbing, as the yield policy is passed: server switch, begin-turn, the browser's candidate validation and the lab.
  assert.match(source("app/api/billing/begin-turn/route.ts"), /diagramCurveLabels: resolveDiagramCurveLabels\(\),/);
  assert.match(source("lib/billing/billingClient.ts"), /diagramCurveLabels: payload\.diagramCurveLabels === true,/);
  assert.match(source("features/tutor-session/hooks/turn/useQuestionHandler.ts"), /validateProductionSceneCandidate\(\{[^}]*curveLabels: context !== "recovery" && billed\.diagramCurveLabels === true[^}]*\}\)/);
  assert.match(source("scripts/lecture-lab/lecturePipeline.ts"), /curveLabels: parseCurveLabelSwitch\(process\.env\.DIAGRAM_CURVE_LABELS\)/);
  assert.match(source(".env.example"), /^# DIAGRAM_CURVE_LABELS=on$/m);
  console.log("PASS plumbing: begin-turn, the browser's validation, the lab and .env.example");
  console.log("PASS curve label placement: 11 groups");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
