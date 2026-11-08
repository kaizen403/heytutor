/**
 * Subscript letters (fₖ) and script brackets around plain letters (v₍A₎) are
 * lettered by hand as script groups. Before, a subscript letter had no ink and
 * the board typed it on the baseline ("fₖ" read "fk"), and v₍A₎ was written
 * "v A_". The label text is unchanged; only its lettering is.
 *
 * Rule 3: a saved turn stores its intro ink, label text and spot included, and
 * reopen letters that stored text at the stored spot. A label held for
 * teaching (v₍A₎ here) is not stored; it is lettered from the figure rebuilt
 * for pointing.
 */
import assert from "node:assert/strict";
import {
  getSegmentCommands, isStoredCommandTrustedGeometry, measureTextInkBounds, parseStoredSegmentCommands,
  serializeSegmentCommands, textToStrokePaths, type DrawCommand,
} from "@heytutor/drawing";
import { SCENE_DOCUMENT_VERSION, compileSceneDocument, validateSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Box = { x: number; y: number; width: number; height: number };
console.warn = () => {};

const QUESTION = "Block A slides on a rough floor; the kinetic friction is fₖ = μₖN. Draw the forces and the velocity.";
const raw: Row = {
  schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "forces" },
  source: { question: QUESTION, nonMetric: true, representationTier: "qualitative_verified" },
  entities: [
    { id: "o", kind: "point", role: "block centre", label: "A" },
    { id: "east", kind: "point", role: "velocity head" }, { id: "west", kind: "point", role: "friction head" },
    { id: "v", kind: "vector", role: "velocity", label: "v₍A₎" }, { id: "f", kind: "vector", role: "kinetic friction", label: "fₖ" },
  ],
  constructions: [
    { id: "make_o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] },
    { id: "make_east", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["east"] },
    { id: "make_west", operator: "point", inputs: { x: -2, y: 0, coordinateSpace: "world" }, outputs: ["west"] },
    { id: "make_v", operator: "vector", inputs: { start: "o", end: "east" }, outputs: ["v"] },
    { id: "make_f", operator: "vector", inputs: { start: "o", end: "west" }, outputs: ["f"] },
  ],
  requiredEntityIds: ["o", "east", "west", "v", "f"],
  revealGroups: [{ id: "g", entityIds: ["o", "east", "west", "v", "f"], dependsOn: [], narrationCue: "The forces." }],
  assertions: [], annotations: [], quantities: [], relations: [], teachingTimeline: [],
};
const validated = validateSceneDocument(raw);
assert(validated.document, "the fixture is valid");
const document: SceneDocument = validated.document;
const compiled = compileSceneDocument(document);
assert(compiled.ok && compiled.renderScene, "the fixture compiles");
const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene, { originalQuestion: QUESTION });

/** Where dev placed and saved the friction label: its typed k took a wider box. */
const DEV_FRICTION_LABEL_X = 428.8256;

const artifacts = { schemaVersion: "scene-artifacts/v3", representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready",
  turnPlan: { schemaVersion: "turn-plan/v3", question: QUESTION, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" } };
const rows = [...presentation.introSegments, { narration: "Friction opposes the velocity.", command: null }];
const lessonOf = (extra: Row = {}) => ({
  question: QUESTION, rawResponse: "Here are the forces.", visualStatus: "validated", sceneDocument: document, sceneArtifacts: artifacts,
  segments: rows.map((segment, orderIndex) => ({ orderIndex, narration: segment.narration, spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment as never), { trustedDiagramGeometry: (segment as Row).verifiedDiagramIntro === true }) })),
  ...extra,
}) as unknown as SubmittedTurnSceneMetadata;
const inkOf = (segments: Row[]) => segments.filter((segment) => isStoredCommandTrustedGeometry(segment.command)).flatMap((segment) => parseStoredSegmentCommands(segment.command));
const boxOf = (command: DrawCommand): Box => {
  const box = measureTextInkBounds(command.text!, command.params[0]!, command.params[1]!, command.params[2] ?? 24);
  assert(box, `${command.text} has ink`);
  return box;
};
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** A stored stroke crosses a box: sampled along the segment, finer than any glyph. */
const crosses = (box: Box, [x1, y1, x2, y2]: number[]) => {
  for (let t = 0; t <= 1; t += 1 / 400) {
    const x = x1! + (x2! - x1!) * t, y = y1! + (y2! - y1!) * t;
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return true;
  }
  return false;
};
async function lettering(text: string, script: string): Promise<void> {
  const paths = await textToStrokePaths(text, 0, 100, 24);
  assert(paths.every((path) => path.strokes.length > 0 || !path.char.trim()), `${text} has no typed glyph`);
  assert(!paths.some((path) => path.char === "_"), `${text} writes no stray underscore`);
  const scripted = paths.filter((path) => path.fontSize! < 24).map((path) => path.char).join("");
  assert.equal(scripted, script, `${text} letters ${script} as its script`);
}

async function ruleThree(): Promise<void> {
  // 1. The board as dev saved it: the same intro ink, the friction label at dev's spot.
  const savedNow = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify(lessonOf())));
  assert(savedNow.ok && savedNow.value.visualStatus === "validated", `the lesson saves: ${savedNow.ok ? savedNow.value.visualStatus : `${savedNow.code} ${savedNow.error}`}`);
  const devSegments = savedNow.value.segments.map((segment) => isStoredCommandTrustedGeometry(segment.command)
    ? { ...segment, command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command).map((command) => command.type === "LABEL" && command.text === "fₖ" ? { ...command, params: [DEV_FRICTION_LABEL_X, ...command.params.slice(1)] } : command), { trustedDiagramGeometry: true }) }
    : segment);
  const storedLabels = inkOf(devSegments).filter((command) => command.type === "LABEL");
  const friction = storedLabels.find((command) => command.text === "fₖ");
  assert(friction && friction.params[0] === DEV_FRICTION_LABEL_X, "the stored friction label keeps its text and dev's spot");
  assert(!storedLabels.some((command) => command.text === "v₍A₎"), "v₍A₎ waits for teaching; the intro does not store it");
  const storedDev = { ...savedNow.value, id: "script-letter-lesson", kind: "lesson", status: "complete", segments: devSegments } as never;

  // 2. Its next resume save passes, and its document is admitted again.
  const resumed = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify(lessonOf({ sceneArtifacts: { ...artifacts, ...boardContinuationArtifacts(QUESTION) } }))), { kind: "resume" });
  assert(resumed.ok && resumed.value.visualStatus === "validated", `saved under dev, it passes its next resume save: ${resumed.ok ? "" : resumed.code}`);
  assert(admitStoredScene({ sceneDocument: document, sceneQuestion: QUESTION, turnPlan: null, submittedTier: "qualitative_verified" }).ok, "its document is admitted again");

  // 3. It reopens as saved: the stored rows are kept, label text and spot included.
  const reopened = sourceCheckedStoredTurn(storedDev) as unknown as Row;
  assert.equal(reopened.visualStatus, "validated", "it reopens with its figure");
  assert.deepEqual(reopened.segments, devSegments, "it reopens with the rows dev saved");

  // 4. The stored text is lettered by hand at the stored spot, clear of the stored ink.
  await lettering(friction.text!, "k");
  const frictionBox = boxOf(friction);
  const strokes = inkOf(devSegments).filter((command) => command.type === "ARROW" || command.type === "DRAW_LINE").map((command) => command.params as number[]);
  assert(strokes.length >= 2, "the fixture stores both force arrows");
  assert(!strokes.some((stroke) => crosses(frictionBox, stroke)), "the friction label, lettered by hand at dev's spot, crosses no stored stroke");
  for (const other of storedLabels.filter((command) => command !== friction)) assert(!overlaps(frictionBox, boxOf(other)), `the friction label clears ${other.text}`);

  // 5. Teaching's reveal: v₍A₎ is lettered from the figure rebuilt for pointing, v with subscript A, clear of the stored ink.
  const restored = restoreVerifiedPresentationFromTurn({ question: QUESTION, sceneDocument: document, sceneArtifacts: artifacts } as never);
  assert(restored, "it rebuilds a figure to point at");
  const velocity = restored.diagram.deferredAnnotations?.flatMap((entry) => entry.commands).find((command) => command.type === "LABEL" && command.text === "v₍A₎");
  assert(velocity, "the rebuilt figure holds v₍A₎ for teaching to reveal");
  await lettering(velocity.text!, "A");
  const velocityBox = boxOf(velocity as DrawCommand);
  assert(!strokes.some((stroke) => crosses(velocityBox, stroke)), "v₍A₎ crosses no stored stroke");
  for (const other of storedLabels) assert(!overlaps(velocityBox, boxOf(other)), `v₍A₎ clears the stored ${other.text}`);
  console.log("PASS rule 3: a board saved under dev with fₖ passes its resume save, reopens as saved and letters fₖ by hand at the stored spot; v₍A₎ is revealed as v with subscript A, clear of the stored ink");
}

async function main(): Promise<void> {
  // The label text is what the planner wrote; only the lettering changes.
  assert.deepEqual(presentation.diagram.commands.filter((command) => command.type === "LABEL").map((command) => command.text).sort(), ["A", "fₖ", "v₍A₎"].sort(), "labels keep their text");
  await lettering("fₖ", "k");
  await lettering("vₘₐₓ", "max");
  await lettering("v₍A/B₎", "A/B");
  console.log("PASS lettering: subscript letters and v₍A₎ are written by hand as script, with no typed glyph and no stray underscore");
  await ruleThree();
  console.log("PASS script letter labels: 2 groups");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
