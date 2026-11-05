/**
 * A figure saved with its plan has a question size: past it a new question
 * saves as text and the lesson still teaches. A question already saved on its
 * turn keeps its figure, and a saved board still reopens with it.
 */
import { SCENE_DOCUMENT_VERSION, SCENE_TEXT_LIMITS } from "@heytutor/scene-engine";
import { FIGURE_QUESTION_CHARS, FIGURE_QUESTION_NOTE, figureQuestionChars, figureQuestionTooLong } from "../../lib/scene/figureQuestion";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { composeDoubtFigureQuestion, doubtFigureArtifacts } from "../../lib/boards/doubtFigure";
import { checkpointSceneFixture } from "./fixtures/checkpointScene";
import { doubtPageCheck, LESSON_TURN_ID, sceneMetadataOn, stored } from "./fixtures/doubtFigureScene";

const fail = (name: string, detail: unknown): never => {
  console.error(`FAIL ${name}: ${JSON.stringify(detail).slice(0, 200)}`);
  process.exit(1);
};
console.warn = () => {};

if (FIGURE_QUESTION_CHARS !== 4_000) fail("the figure question size moved", FIGURE_QUESTION_CHARS);
if (SCENE_TEXT_LIMITS.questionChars !== 12_000) fail("the stored question size stays", SCENE_TEXT_LIMITS.questionChars);
if (!/too long to draw a figure/.test(FIGURE_QUESTION_NOTE) || !/still teach/.test(FIGURE_QUESTION_NOTE)) fail("the note says why there is no figure and that the lesson teaches", FIGURE_QUESTION_NOTE);
if (figureQuestionChars("  a \n\t  b   ") !== 3) fail("runs of whitespace count as one", figureQuestionChars("  a \n\t  b   "));

const words = (count: number) => "Find the value of the unknown in this stem. ".repeat(Math.ceil(count / 44)).slice(0, count).trimEnd().padEnd(count, "x");
const plan = (question: string) => ({ schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" });
const figure = (question: string) => ({
  schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
  source: { question, nonMetric: true, representationTier: "qualitative_verified" },
  entities: [{ id: "a", kind: "point", role: "point" }, { id: "b", kind: "point", role: "point" }, { id: "s", kind: "segment", role: "segment" }],
  constructions: [
    { id: "ca", operator: "point", inputs: { x: 500, y: 200, coordinateSpace: "layout" }, outputs: ["a"] },
    { id: "cb", operator: "point", inputs: { x: 800, y: 200, coordinateSpace: "layout" }, outputs: ["b"] },
    { id: "cs", operator: "segment", inputs: { a: "a", b: "b" }, outputs: ["s"] },
  ],
  requiredEntityIds: ["a", "b", "s"],
  revealGroups: [{ id: "g", dependsOn: [], entityIds: ["a", "b", "s"], narrationCue: "the figure" }],
  assertions: [], annotations: [], quantities: [], relations: [], teachingTimeline: [],
});
const rows = [{ orderIndex: 0, narration: "Here is the idea.", spokenText: "Here is the idea.", command: null }];
const metadata = (question: string, withPlan = true): SubmittedTurnSceneMetadata => ({
  question, rawResponse: "x", segments: rows, visualStatus: "validated", sceneDocument: figure(question),
  sceneArtifacts: { schemaVersion: "scene-artifacts/v3", ...(withPlan ? { turnPlan: plan(question) } : {}), diagramResultStatus: "ready", representationTier: "qualitative_verified", nonMetric: true },
} as unknown as SubmittedTurnSceneMetadata);
const statusOf = async (submitted: SubmittedTurnSceneMetadata, options: Parameters<typeof canonicalizeTurnSceneMetadata>[1] = {}) => {
  const saved = await canonicalizeTurnSceneMetadata(submitted, options);
  return saved.ok ? saved.value.visualStatus : `refused ${saved.code}`;
};

const main = async () => {
  const atSize = words(FIGURE_QUESTION_CHARS);
  const pastSize = words(FIGURE_QUESTION_CHARS + 1);
  const padded = atSize.replace(/ /g, "   ");
  if (figureQuestionChars(padded) !== FIGURE_QUESTION_CHARS || padded.length <= FIGURE_QUESTION_CHARS) fail("a padded question at the size", padded.length);

  if (await statusOf(metadata(atSize)) !== "validated") fail("a figure with its plan at the size", await statusOf(metadata(atSize)));
  if (await statusOf(metadata(padded)) !== "validated") fail("a padded question counts as its words", await statusOf(metadata(padded)));
  if (await statusOf(metadata(pastSize)) !== "text_only") fail("a new question past the size saves as text", await statusOf(metadata(pastSize)));
  const pastSaved = await canonicalizeTurnSceneMetadata(metadata(pastSize));
  if (!pastSaved.ok || pastSaved.value.sceneDocument !== null || pastSaved.value.segments.length !== rows.length) fail("the text save keeps the teaching and drops the figure", pastSaved.ok ? pastSaved.value.visualStatus : pastSaved.code);
  if (await statusOf(metadata(pastSize, false)) !== "validated") fail("a figure without a plan is not this check", await statusOf(metadata(pastSize, false)));
  if (await statusOf({ ...metadata(pastSize), visualStatus: "text_only", sceneDocument: null } as SubmittedTurnSceneMetadata) !== "text_only") fail("a text lesson past the size saves", null);

  // A question already saved on its turn saves again with its figure, and reopens with it.
  if (await statusOf(metadata(pastSize), { storedQuestion: pastSize }) !== "validated") fail("a saved question past the size keeps its figure", null);
  if (await statusOf(metadata(pastSize), { storedQuestion: pastSize.replace(/ /g, "  ") }) !== "validated") fail("a saved question is the same however it is spaced", null);
  if (await statusOf(metadata(pastSize), { storedQuestion: words(FIGURE_QUESTION_CHARS + 2) }) !== "text_only") fail("a different saved question does not count", null);
  const longest = words(SCENE_TEXT_LIMITS.questionChars);
  const reopened = sourceCheckedStoredTurn({ question: longest, rawResponse: "x", visualStatus: "validated", sceneDocument: figure(longest), sceneArtifacts: metadata(longest).sceneArtifacts, segments: [] } as never);
  if (reopened.visualStatus !== "validated") fail("a board saved with the longest question reopens with its figure", reopened.visualStatus);
  if (await statusOf(metadata(longest), { storedQuestion: longest }) !== "validated") fail("a board saved with the longest question saves again", null);

  // The browser drops the figure before it is drawn, with the same size.
  const live = (question: string) => liveSceneSaveFailure({ document: figure(question) as never, question, turnPlan: plan(question) as never, tier: "qualitative_verified" as never });
  if (live(atSize) !== null) fail("the browser keeps a figure at the size", live(atSize));
  if (live(pastSize) === null) fail("the browser drops a figure past the size", null);
  if (figureQuestionTooLong(pastSize) !== true || figureQuestionTooLong(atSize) !== false) fail("the size check", null);

  // A doubt figure counts the lesson question and the doubt together.
  const lesson = await checkpointSceneFixture();
  const lessonSaved = await canonicalizeTurnSceneMetadata(lesson.metadata);
  if (!lessonSaved.ok) { fail("the lesson saves", lessonSaved.error); return; }
  const lessonTurn = stored(LESSON_TURN_ID, 0, lesson.question, lessonSaved.value, { opensOnClear: true, kind: "lesson" });
  const doubtOf = (title: string) => ({
    ...sceneMetadataOn(lesson.metadata, composeDoubtFigureQuestion(lesson.question, title), { ...boardContinuationArtifacts(lesson.question), ...doubtFigureArtifacts(LESSON_TURN_ID) }, lesson.metadata.segments),
    question: title,
  });
  const doubtOptions = { kind: "doubt" as const, doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck([lessonTurn]) };
  const shortDoubt = "Doubt: why do we add three?";
  const longDoubt = `Doubt: ${words(FIGURE_QUESTION_CHARS - 20)}`;
  if (figureQuestionChars(longDoubt) > FIGURE_QUESTION_CHARS || figureQuestionChars(composeDoubtFigureQuestion(lesson.question, longDoubt)) <= FIGURE_QUESTION_CHARS) fail("the long doubt is under the size and its composed question is past it", null);
  if (await statusOf(doubtOf(shortDoubt), doubtOptions) !== "validated") fail("a short doubt keeps its figure", await statusOf(doubtOf(shortDoubt), doubtOptions));
  if (await statusOf(doubtOf(longDoubt), doubtOptions) !== "text_only") fail("a doubt whose composed question is past the size answers as text", await statusOf(doubtOf(longDoubt), doubtOptions));
  console.log("figure question size: all rows passed");
};
main().catch((error) => fail("the gate threw", String(error).slice(0, 160)));
