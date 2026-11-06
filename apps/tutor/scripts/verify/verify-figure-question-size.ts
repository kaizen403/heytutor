/**
 * A figure saved with its plan has a question size: past it a new question
 * saves as text and the lesson still teaches. A question already saved on its
 * turn keeps its figure, and a saved board still reopens with it.
 */
import { SCENE_DOCUMENT_VERSION, SCENE_TEXT_LIMITS } from "@heytutor/scene-engine";
import { isStoredCommandTrustedGeometry } from "@heytutor/drawing";
import { FIGURE_DOUBT_NOTE, FIGURE_QUESTION_CHARS, FIGURE_QUESTION_NOTE, figureQuestionChars, figureQuestionNote, figureQuestionTooLong } from "../../lib/scene/figureQuestion";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { doubtTurnTitle } from "../../features/tutor-session/lib/input/askDoubt";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { composeDoubtFigureQuestion, doubtFigureArtifacts } from "../../lib/boards/doubtFigure";
import { checkpointSceneFixture } from "./fixtures/checkpointScene";
import { doubtPageCheck, focus, LESSON_TURN_ID, pageRowsOf, sceneMetadataOn, stored } from "./fixtures/doubtFigureScene";
import { bindPageLessonFigureQuestion, memoryPageFigureStore } from "../../lib/scene/pageFigureLoader";
import { parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";

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

  // A resume is a new turn on the page. It keeps its figure and its pointing when the page's own lesson was saved with a figure and its plan.
  const savedLong = await canonicalizeTurnSceneMetadata(metadata(pastSize), { storedQuestion: pastSize });
  if (!savedLong.ok || savedLong.value.visualStatus !== "validated") { fail("a board saved with a long question", savedLong.ok ? savedLong.value.visualStatus : savedLong.code); return; }
  const longLesson = stored(LESSON_TURN_ID, 0, pastSize, savedLong.value, { opensOnClear: true, kind: "lesson" });
  if (!longLesson.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command))) fail("the saved lesson holds its figure ink", null);
  const RESUME_TURN_ID = "44444444-4444-4444-8444-444444444444";
  const pageLesson = (turns: Parameters<typeof pageRowsOf>[0], owner = "u1") => bindPageLessonFigureQuestion({ boardId: "b1", userId: "u1", turnId: RESUME_TURN_ID }, { store: memoryPageFigureStore(pageRowsOf(turns, owner)) });
  const pointing = [{ orderIndex: 0, narration: "Look at this side.", spokenText: "Look at this side.", command: serializeSegmentCommands([focus("s")]) }];
  const resumeOf = (question: string) => ({
    ...metadata(question),
    sceneArtifacts: { ...(metadata(question).sceneArtifacts as Record<string, unknown>), ...boardContinuationArtifacts(question) },
    segments: pointing,
  } as unknown as SubmittedTurnSceneMetadata);
  const resumed = await canonicalizeTurnSceneMetadata(resumeOf(pastSize), { kind: "resume", loadPageLessonFigureQuestion: pageLesson([longLesson]) });
  if (!resumed.ok || resumed.value.visualStatus !== "validated") fail("a resume of a saved long lesson keeps its figure", resumed.ok ? resumed.value.visualStatus : resumed.code);
  else {
    if (!resumed.value.segments.some((segment) => parseStoredSegmentCommands(segment.command).some((command) => command.type === "FOCUS" && command.text === "s"))) fail("a resume of a saved long lesson keeps its pointing", resumed.value.segments);
    const resumeTurn = stored(RESUME_TURN_ID, 1, pastSize, resumed.value, { opensOnClear: false, kind: "resume" });
    if (sourceCheckedStoredTurn(resumeTurn).visualStatus !== "validated" || sourceCheckedStoredTurn(longLesson).visualStatus !== "validated") fail("replay and reopen keep both figures", null);
    if (!sourceCheckedStoredTurn(resumeTurn).segments.some((segment) => parseStoredSegmentCommands(segment.command).some((command) => command.type === "FOCUS"))) fail("replay keeps the resume's pointing", null);
  }
  if (await statusOf(resumeOf(words(FIGURE_QUESTION_CHARS + 2)), { kind: "resume", loadPageLessonFigureQuestion: pageLesson([longLesson]) }) !== "text_only") fail("a resume with another question is not exempt", null);
  if (await statusOf(resumeOf(pastSize), { kind: "resume" }) !== "text_only") fail("a resume with no page lesson is not exempt", null);
  if (await statusOf(resumeOf(pastSize), { kind: "lesson", loadPageLessonFigureQuestion: pageLesson([longLesson]) }) !== "text_only") fail("only a resume reads its page lesson", null);
  const textLesson = stored(LESSON_TURN_ID, 0, pastSize, (await canonicalizeTurnSceneMetadata(metadata(pastSize)) as { value: Parameters<typeof stored>[3] }).value, { opensOnClear: true, kind: "lesson" });
  if (await statusOf(resumeOf(pastSize), { kind: "resume", loadPageLessonFigureQuestion: pageLesson([textLesson]) }) !== "text_only") fail("a lesson saved as text lends no exemption", null);
  if (await statusOf(resumeOf(pastSize), { kind: "resume", loadPageLessonFigureQuestion: pageLesson([longLesson], "someone else") }) !== "text_only") fail("another owner's lesson lends no exemption", null);
  // The memory store reads what Prisma's select reads: the turn and the walk see each turn's first row only.
  const contractStore = memoryPageFigureStore(pageRowsOf([longLesson]));
  if (longLesson.segments.length < 2 || (await contractStore.findTurn(LESSON_TURN_ID))?.segments.length !== 1 || (await contractStore.turnsBefore("b1", null))[0]?.segments.length !== 1) fail("the memory store reads one row per turn, as production does", null);
  // The lesson's own row decides, as production reads it: its first row is the opening CLEAR, not the figure.
  if (isStoredCommandTrustedGeometry(longLesson.segments[0]?.command)) fail("the saved lesson opens on a row that is not the figure", null);
  const notValidated = { ...longLesson, visualStatus: "text_only" as const };
  if (await statusOf(resumeOf(pastSize), { kind: "resume", loadPageLessonFigureQuestion: pageLesson([notValidated]) }) !== "text_only") fail("a lesson row not saved as a validated figure lends nothing", null);
  const noDocument = { ...longLesson, sceneDocument: null };
  if (await statusOf(resumeOf(pastSize), { kind: "resume", loadPageLessonFigureQuestion: pageLesson([noDocument]) }) !== "text_only") fail("a lesson row with no scene document lends nothing", null);
  const unplannedSave = await canonicalizeTurnSceneMetadata(metadata(pastSize, false));
  if (!unplannedSave.ok || unplannedSave.value.visualStatus !== "validated") { fail("a long lesson saved with a figure and no plan", unplannedSave.ok ? unplannedSave.value.visualStatus : unplannedSave.code); return; }
  const unplannedLesson = stored(LESSON_TURN_ID, 0, pastSize, unplannedSave.value, { opensOnClear: true, kind: "lesson" });
  if (!unplannedLesson.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command))) fail("that lesson holds its figure ink", null);
  if (await statusOf(resumeOf(pastSize), { kind: "resume", loadPageLessonFigureQuestion: pageLesson([unplannedLesson]) }) !== "text_only") fail("a lesson saved without a plan lends no exemption", null);

  // The browser drops the figure before it is drawn, with the same size.
  const live = (question: string) => liveSceneSaveFailure({ document: figure(question) as never, question, turnPlan: plan(question) as never, tier: "qualitative_verified" as never });
  if (live(atSize) !== null) fail("the browser keeps a figure at the size", live(atSize));
  if (live(pastSize) === null) fail("the browser drops a figure past the size", null);
  if (figureQuestionTooLong(pastSize) !== true || figureQuestionTooLong(atSize) !== false) fail("the size check", null);
  // The note under the input box: a question past the size, and a doubt whose composed question is past it.
  if (figureQuestionNote(atSize) !== null || figureQuestionNote(pastSize) !== FIGURE_QUESTION_NOTE) fail("the note shows past the size only", null);
  const pageOfLongDoubt = words(FIGURE_QUESTION_CHARS - 100);
  if (figureQuestionNote(doubtTurnTitle("Why does this step hold?"), pageOfLongDoubt) !== null) fail("a short doubt on a lesson under the size shows no note", null);
  if (figureQuestionNote(doubtTurnTitle(words(200)), pageOfLongDoubt) !== FIGURE_DOUBT_NOTE) fail("a doubt whose composed question is past the size shows the doubt note", null);
  // The note counts the doubt's title, which keeps 160 characters, as the doubt's figure does.
  if (figureQuestionNote(doubtTurnTitle(words(1_100)), words(3_000)) !== null) fail("a long doubt on a shorter lesson counts its title, not all it typed", null);
  // The browser plans a doubt's figure on the page's whole lesson question, so the note counts all of it, even where the page keeps less.
  const cutPage = `${words(3_900)}${" ".repeat(200)}${words(3_000)}`;
  const keptPage = boardContinuationArtifacts(cutPage).boardContinuation.lessonQuestion;
  if (figureQuestionChars(composeDoubtFigureQuestion(keptPage, doubtTurnTitle("Why?"))) > FIGURE_QUESTION_CHARS || figureQuestionChars(cutPage) <= FIGURE_QUESTION_CHARS) fail("the kept page question is under the size and the whole one past it", null);
  if (figureQuestionNote(doubtTurnTitle("Why?"), cutPage) !== FIGURE_DOUBT_NOTE) fail("the note counts the whole lesson question, as the browser plans the doubt figure", null);
  if (figureQuestionNote("", pageOfLongDoubt) !== null) fail("an empty doubt shows no note", null);
  if (!/too long to draw a figure/.test(FIGURE_DOUBT_NOTE) || !/still teach/.test(FIGURE_DOUBT_NOTE)) fail("the doubt note says why there is no figure and that the answer teaches", FIGURE_DOUBT_NOTE);
  // Spacing and characters at the edge count the same on the server and in the browser.
  const edges: Array<[string, string, string]> = [
    ["line breaks", atSize.replace(/ /g, "\r\n"), "validated"],
    ["no break spaces", atSize.replace(/ /g, "\u00a0"), "validated"],
    ["a zero width character past the size", `${atSize}\u200b`, "text_only"],
    ["one more letter past the size", `${atSize}y`, "text_only"],
  ];
  for (const [name, question, expected] of edges) {
    if (await statusOf(metadata(question)) !== expected) fail(`${name}: saves as ${expected}`, await statusOf(metadata(question)));
    if ((live(question) === null) !== (expected === "validated")) fail(`${name}: the browser agrees`, live(question));
  }
  // A long question saved as text reopens, replays and shares as text.
  const textRow = stored("55555555-5555-4555-8555-555555555555", 0, pastSize, (pastSaved as { value: Parameters<typeof stored>[3] }).value, { opensOnClear: true, kind: "lesson" });
  if (sourceCheckedStoredTurn(textRow).visualStatus !== "text_only") fail("a long question saved as text reopens as text", sourceCheckedStoredTurn(textRow).visualStatus);
  if (buildReplayTimeline([textRow]).cues.length === 0) fail("a long question saved as text replays its rows", null);


  // A doubt figure counts the lesson question and the doubt together.
  const lesson = await checkpointSceneFixture();
  const lessonSaved = await canonicalizeTurnSceneMetadata(lesson.metadata);
  if (!lessonSaved.ok) { fail("the lesson saves", lessonSaved.error); return; }
  const lessonTurn = stored(LESSON_TURN_ID, 0, lesson.question, lessonSaved.value, { opensOnClear: true, kind: "lesson" });
  // A long new question on a lesson that drew its figure saves as text, without the figure's ink.
  const inkedPast = { ...sceneMetadataOn(lesson.metadata, pastSize, {}, lesson.metadata.segments), question: pastSize };
  if (!lesson.metadata.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command))) fail("the lesson draws its figure ink", null);
  const inkedSaved = await canonicalizeTurnSceneMetadata(inkedPast);
  if (!inkedSaved.ok || inkedSaved.value.visualStatus !== "text_only" || inkedSaved.value.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command))) fail("a long question saves its lesson without the figure's ink", inkedSaved.ok ? inkedSaved.value.visualStatus : inkedSaved.code);
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
