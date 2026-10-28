/**
 * A saved doubt keeps the pointing it spoke at the figure on its page.
 *
 * A doubt is saved without a scene of its own, so the server used to drop
 * every FOCUS it spoke and refuse the whole save on an ANNOTATE. The doubt now
 * names the earlier turn whose figure was in the zone (`pointsAtFigure`), and
 * the server loads that figure from the referenced turn's own row. These checks
 * hold the three edges of that trust:
 *
 * - the canonicalizer keeps only pointing that resolves on the loaded figure,
 *   filters the rest (never a 400), and never lets a doubt letter an answer;
 * - the loader resolves only a turn on the same board, of the same owner,
 *   earlier, on the same page, holding a figure of the kind claimed;
 * - the live filter (`doubtSegment` with a policy) keeps only the figure's ids.
 *
 * Mutations this gate must catch: the loader skipping the user check, and the
 * ANNOTATE filter turned back into a failure. `canonicalRowsFor` ignoring the
 * reference is caught by verify-turn-checkpoint-route.
 */
import {
  getSegmentCommands,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagram,
  type ReferencePictureRecord,
} from "@heytutor/drawing";
import { synthesizeDsaScene } from "@heytutor/scene-engine";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import { checkpointSceneFixture } from "./fixtures/checkpointScene";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { DOUBT_FIGURE_REF_VERSION, doubtFigureRefArtifacts, type DoubtFigureRef } from "../../lib/boards/doubtFigureRef";
import {
  canonicalizeTurnSceneMetadata,
  type SubmittedTurnSceneMetadata,
  type SubmittedTurnSegment,
} from "../../lib/scene/turnScenePersistence";
import {
  bindPageFigureLoader,
  memoryPageFigureStore,
  type PageFigureLoader,
  type PageFigureStore,
  type PageFigureTurn,
} from "../../lib/scene/pageFigureLoader";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { buildReferencePicturePresentation } from "../../features/tutor-session/lib/scene/referencePicturePresentation";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { DSA_DIAGRAM_ZONE } from "../../features/tutor-session/constants";
import { doubtSegment } from "../../features/tutor-session/lib/turn/doubtTurn";

let failures = 0;
let checks = 0;
function check(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}

const BOARD = "board-a";
const OWNER = "alice";
const LESSON_ID = "11111111-1111-4111-8111-111111111111";
const DOUBT_ID = "22222222-2222-4222-8222-222222222222";
const OPENER_ID = "33333333-3333-4333-8333-333333333333";
const EARLIER_DOUBT_ID = "44444444-4444-4444-8444-444444444444";
const LATER_ID = "55555555-5555-4555-8555-555555555555";

const CLEAR: DrawCommand = { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" };

function command(type: DrawCommand["type"], text: string, narration = "look here"): DrawCommand {
  return { type, params: [], text, charPosition: 0, narrationBefore: narration };
}
const write = (text: string): DrawCommand => ({ type: "WRITE", params: [90, 142], text, charPosition: 0, narrationBefore: "" });

function row(orderIndex: number, narration: string, commands: DrawCommand[] | null): SubmittedTurnSegment {
  return {
    orderIndex,
    narration,
    spokenText: narration,
    command: commands ? serializeSegmentCommands(commands, { trustedDiagramGeometry: false }) : null,
  };
}

function savedCommands(segments: readonly SubmittedTurnSegment[]): DrawCommand[] {
  return segments.flatMap((segment) => parseStoredSegmentCommands(segment.command));
}

function targets(commands: readonly DrawCommand[], type: DrawCommand["type"]): string[] {
  return commands.filter((entry) => entry.type === type).map((entry) => entry.text ?? "");
}

const ref = (kind: DoubtFigureRef["kind"], turnId = LESSON_ID, frameIndex?: number): DoubtFigureRef =>
  doubtFigureRefArtifacts({ schemaVersion: DOUBT_FIGURE_REF_VERSION, turnId, kind, ...(frameIndex !== undefined ? { frameIndex } : {}) }).pointsAtFigure;

function doubtMetadata(lessonQuestion: string, pointsAtFigure: DoubtFigureRef | null, segments: SubmittedTurnSegment[]): SubmittedTurnSceneMetadata {
  return {
    question: "Doubt: why does the arrow start at 2?",
    visualStatus: "text_only",
    sceneArtifacts: {
      ...boardContinuationArtifacts(lessonQuestion),
      ...(pointsAtFigure ? { pointsAtFigure } : {}),
    },
    segments,
  };
}

const loaderReturning = (figure: VerifiedDiagram | null): PageFigureLoader => async () =>
  figure ? structuredClone(figure) : null;

function memoryStore(turns: PageFigureTurn[]): PageFigureStore {
  return memoryPageFigureStore(turns);
}

function openerSegment(): PageFigureTurn["segments"][number] {
  return { orderIndex: 0, command: CLEAR };
}

function continuingDoubt(id: string, orderIndex: number, lessonQuestion: string, userId = OWNER): PageFigureTurn {
  return {
    id, boardId: BOARD, userId, orderIndex, question: "Doubt: another one", visualStatus: "text_only",
    sceneDocument: null, sceneArtifacts: boardContinuationArtifacts(lessonQuestion),
    segments: [{ orderIndex: 0, command: serializeSegmentCommands([write("v = u + at")], { trustedDiagramGeometry: false }) }],
  };
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // The lesson figure, rebuilt from a real canonical scene.
  // -------------------------------------------------------------------------
  const fixture = await checkpointSceneFixture();
  const lessonQuestion = fixture.question;
  const lessonSaved = await canonicalizeTurnSceneMetadata(fixture.metadata);
  if (!lessonSaved.ok) throw new Error(`lesson fixture must save: ${lessonSaved.error}`);
  const lessonRow: PageFigureTurn = {
    id: LESSON_ID, boardId: BOARD, userId: OWNER, orderIndex: 0, question: lessonQuestion,
    visualStatus: "validated", sceneDocument: lessonSaved.value.sceneDocument, sceneArtifacts: lessonSaved.value.sceneArtifacts,
    segments: [openerSegment()],
  };
  const lessonFigure = restoreVerifiedPresentationFromTurn(lessonRow)?.diagram ?? null;
  if (!lessonFigure) throw new Error("the lesson fixture must restore a figure");
  const anchorIds = lessonFigure.anchors.map((anchor) => anchor.id);
  check(anchorIds.includes("start_value") && anchorIds.includes("sum_value"), "fixture figure exposes start_value and sum_value");

  // -------------------------------------------------------------------------
  // Canonicalizer: pointing kept where it resolves, filtered where it does not.
  // -------------------------------------------------------------------------
  const pointed = doubtMetadata(lessonQuestion, ref("verified_scene"), [
    row(0, "The arrow starts at two.", [write("start = 2"), command("FOCUS", "start_value")]),
    row(1, "And this one is not on the board.", [command("FOCUS", "ghost_point")]),
    row(2, "Name it.", [command("ANNOTATE", "ghost_point")]),
    row(3, "The starting value.", [command("ANNOTATE", "start_value")]),
    row(4, "Both together.", [command("FOCUS", "start_value,add_three|pulse|keep")]),
  ]);
  const kept = await canonicalizeTurnSceneMetadata(structuredClone(pointed), { loadPageFigure: loaderReturning(lessonFigure) });
  check(kept.ok, `a doubt with an unknown ANNOTATE target saves (no 400): ${kept.ok ? "" : kept.error}`);
  if (kept.ok) {
    const commands = savedCommands(kept.value.segments);
    check(targets(commands, "FOCUS").includes("start_value"), "FOCUS on a lesson figure id survives the save");
    check(!targets(commands, "FOCUS").includes("ghost_point"), "FOCUS on an unknown id is dropped");
    check(!targets(commands, "ANNOTATE").includes("ghost_point"), "ANNOTATE on an unknown id is filtered");
    check(targets(commands, "ANNOTATE").includes("start_value"), "ANNOTATE on a withheld setup label of the figure survives");
    check(targets(commands, "FOCUS").includes("start_value,add_three|pulse|keep"), "FOCUS modifiers are stored verbatim");
    check(kept.value.segments.length === 5 && kept.value.segments.every((segment) => segment.narration.length > 0), "every doubt row keeps its words");
    check(targets(commands, "WRITE").includes("start = 2"), "the doubt's work row survives");
    const artifacts = kept.value.sceneArtifacts as Record<string, unknown> | null;
    check(JSON.stringify(artifacts?.pointsAtFigure) === JSON.stringify(ref("verified_scene")), "pointsAtFigure is kept in the canonical artifacts");
    check(artifacts?.boardContinuation !== undefined, "the continuation marker is kept beside it");
    check(!(artifacts?.failureTelemetry as Record<string, unknown> | undefined)?.pointsAtFigureStatus, "a resolved reference records no unresolved status");
  }

  // An answer label held until the lesson ends is never lettered by a doubt.
  const withheld: VerifiedDiagram = structuredClone(lessonFigure);
  withheld.deferredAnnotations = [
    ...(withheld.deferredAnnotations ?? []).filter((entry) => entry.entityId !== "sum_value"),
    { entityId: "sum_value", revealAfter: "teaching_complete", commands: [] },
  ];
  const answerAsk = await canonicalizeTurnSceneMetadata(
    doubtMetadata(lessonQuestion, ref("verified_scene"), [row(0, "What is the sum?", [command("ANNOTATE", "sum_value")])]),
    { loadPageFigure: loaderReturning(withheld) },
  );
  check(answerAsk.ok, "a doubt naming an answer label still saves");
  if (answerAsk.ok) {
    check(!targets(savedCommands(answerAsk.value.segments), "ANNOTATE").includes("sum_value"), "a saved doubt never releases a withheld answer label");
  }

  // A reference the server cannot resolve: pointing dropped, words kept, status recorded.
  const unresolved = await canonicalizeTurnSceneMetadata(structuredClone(pointed), { loadPageFigure: loaderReturning(null) });
  check(unresolved.ok, "an unresolved reference never fails the save");
  if (unresolved.ok) {
    const commands = savedCommands(unresolved.value.segments);
    check(targets(commands, "FOCUS").length === 0 && targets(commands, "ANNOTATE").length === 0, "unresolved: every FOCUS and ANNOTATE is dropped");
    check(targets(commands, "WRITE").includes("start = 2"), "unresolved: the work row stays");
    check(unresolved.value.segments.length === 5, "unresolved: every row keeps its words");
    const telemetry = (unresolved.value.sceneArtifacts as Record<string, unknown> | null)?.failureTelemetry as Record<string, unknown> | undefined;
    check(telemetry?.pointsAtFigureStatus === "unresolved", "unresolved: pointsAtFigureStatus is recorded in failureTelemetry");
  }
  const noLoader = await canonicalizeTurnSceneMetadata(structuredClone(pointed));
  check(noLoader.ok && targets(savedCommands(noLoader.value.segments), "FOCUS").length === 0, "no loader bound: the pointing drops and the save holds");

  // Without a reference a doubt saves exactly as before: FOCUS filtered, ANNOTATE refused.
  const plain = await canonicalizeTurnSceneMetadata(
    doubtMetadata(lessonQuestion, null, [row(0, "The arrow starts at two.", [command("FOCUS", "start_value")])]),
    { loadPageFigure: loaderReturning(lessonFigure) },
  );
  check(plain.ok && targets(savedCommands(plain.value.segments), "FOCUS").length === 0, "no reference: FOCUS still drops on a text only doubt");
  check((plain.ok ? plain.value.sceneArtifacts as unknown as Record<string, unknown> | null : null)?.pointsAtFigure === undefined, "no reference: no pointsAtFigure appears");
  const plainAnnotate = await canonicalizeTurnSceneMetadata(
    doubtMetadata(lessonQuestion, null, [row(0, "Name it.", [command("ANNOTATE", "start_value")])]),
  );
  check(!plainAnnotate.ok, "no reference: an ANNOTATE on a text only turn is still refused as before");
  // A reference without the continuation marker is not a doubt on a page.
  const unmarked = await canonicalizeTurnSceneMetadata({
    question: "Doubt: no marker", visualStatus: "text_only",
    sceneArtifacts: { pointsAtFigure: ref("verified_scene") },
    segments: [row(0, "The arrow starts at two.", [command("FOCUS", "start_value")])],
  }, { loadPageFigure: loaderReturning(lessonFigure) });
  check(unmarked.ok && targets(savedCommands(unmarked.value.segments), "FOCUS").length === 0, "a reference without the continuation marker keeps no pointing");

  // A picture reference keeps only the picture's own targets, and no ANNOTATE.
  const picturePresentation = buildReferencePicturePresentation(PICTURE);
  const pictureWithStranger: VerifiedDiagram = {
    ...picturePresentation.diagram,
    anchors: [...picturePresentation.diagram.anchors, { id: "start_value", labels: [], x: 600, y: 300, width: 20, height: 20 }],
  };
  const pictureDoubt = await canonicalizeTurnSceneMetadata(
    doubtMetadata(lessonQuestion, ref("reference_picture"), [
      row(0, "Look at the whole cell.", [command("FOCUS", "reference_picture")]),
      row(1, "And this.", [command("FOCUS", "start_value")]),
      row(2, "Name it.", [command("ANNOTATE", "reference_picture")]),
    ]),
    { loadPageFigure: loaderReturning(pictureWithStranger) },
  );
  check(pictureDoubt.ok, "a picture doubt saves");
  if (pictureDoubt.ok) {
    const commands = savedCommands(pictureDoubt.value.segments);
    check(targets(commands, "FOCUS").includes("reference_picture"), "picture: FOCUS on the picture survives");
    check(!targets(commands, "FOCUS").includes("start_value"), "picture: FOCUS on anything but the picture's pointables is dropped");
    check(targets(commands, "ANNOTATE").length === 0, "picture: ANNOTATE is filtered");
  }

  // -------------------------------------------------------------------------
  // DSA: a code board frame is checked as a figure, not waved through.
  // -------------------------------------------------------------------------
  const dsaQuestion = "Explain bubble sort with a worked example.";
  const dsaPlan = getMockCodeLessonPlan(dsaQuestion);
  const dsaScene = synthesizeDsaScene(dsaPlan.diagramHint, { question: dsaQuestion, compile: { viewport: DSA_DIAGRAM_ZONE } });
  if (!dsaScene) throw new Error("the bubble sort plan must synthesize a DSA scene");
  const dsaDocument = { ...dsaScene.document, source: { ...dsaScene.document.source, nonMetric: true, representationTier: dsaScene.tier } };
  const dsaIntro = buildVerifiedDiagramPresentation(dsaDocument, dsaScene.renderScene, { layout: "code_lesson" });
  const dsaSaved = await canonicalizeTurnSceneMetadata({
    question: dsaQuestion, sceneDocument: dsaDocument, sceneEngineVersion: "fixture", validationReport: { valid: true, issues: [] },
    visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", turnPlan: null, representationTier: dsaScene.tier, nonMetric: true,
      candidates: [], diagramResultStatus: "ready", codeLesson: dsaPlan,
    },
    segments: dsaIntro.introSegments.map((segment, orderIndex) => ({
      orderIndex, narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
    })),
  });
  if (!dsaSaved.ok) throw new Error(`the DSA lesson must save: ${dsaSaved.error}`);
  const frames = resolveDsaFrames(dsaQuestion, dsaPlan.diagramHint, dsaPlan)?.frames ?? [];
  check(frames.length >= 3, "bubble sort resolves a walk-through");
  const frameIndex = Math.min(2, frames.length - 1);
  const frameFigure = frames[frameIndex]!.presentation.diagram;
  const cell = frameFigure.anchors[0]?.id ?? "";
  check(cell.length > 0 && frameFigure.layout === "code_lesson", "the frame figure is a code lesson figure with cells");
  const dsaDoubt = await canonicalizeTurnSceneMetadata(
    doubtMetadata(dsaQuestion, ref("dsa_frame", LESSON_ID, frameIndex), [
      row(0, "This cell.", [command("FOCUS", `${cell}|spotlight`)]),
      row(1, "The next frame.", [command("FOCUS", "frame_9")]),
      row(2, "Name it.", [command("ANNOTATE", cell)]),
      row(3, "Step.", [{ type: "FRAME", params: [], charPosition: 0, narrationBefore: "" }]),
    ]),
    { loadPageFigure: loaderReturning(frameFigure) },
  );
  check(dsaDoubt.ok, "a code board doubt saves");
  if (dsaDoubt.ok) {
    const commands = savedCommands(dsaDoubt.value.segments);
    check(targets(commands, "FOCUS").includes(`${cell}|spotlight`), "DSA: FOCUS on a cell of the named frame survives");
    check(!targets(commands, "FOCUS").includes("frame_9"), "DSA: a FOCUS naming no cell is dropped, not waved through as a frame");
    check(targets(commands, "ANNOTATE").length === 0, "DSA: ANNOTATE is filtered");
    check(!commands.some((entry) => entry.type === "FRAME"), "DSA: a doubt never saves a frame advance");
  }

  // -------------------------------------------------------------------------
  // Loader: the reference must name an earlier figure on this page.
  // -------------------------------------------------------------------------
  const page = { lessonQuestion };
  const context = { boardId: BOARD, userId: OWNER, turnId: DOUBT_ID };
  const load = (turns: PageFigureTurn[], extra: Partial<typeof context> = {}, loadReferencePicture?: (id: string) => Promise<ReferencePictureRecord | null>) =>
    bindPageFigureLoader({ ...context, ...extra }, { store: memoryStore(turns), ...(loadReferencePicture ? { loadReferencePicture } : {}) });

  const resolved = await load([lessonRow])(ref("verified_scene"), page);
  check(resolved !== null && resolved.anchors.some((anchor) => anchor.id === "start_value"), "loader: a doubt with no row yet resolves the lesson figure");
  const throughDoubt = await load([lessonRow, continuingDoubt(EARLIER_DOUBT_ID, 1, lessonQuestion)])(ref("verified_scene"), page);
  check(throughDoubt !== null, "loader: an earlier doubt on the same page does not break the reference");
  const ownRow = continuingDoubt(DOUBT_ID, 2, lessonQuestion);
  check(await load([lessonRow, continuingDoubt(EARLIER_DOUBT_ID, 1, lessonQuestion), ownRow])(ref("verified_scene"), page) !== null,
    "loader: a doubt with its own row resolves a figure before it");

  check(await load([{ ...lessonRow, userId: "bob" }])(ref("verified_scene"), page) === null, "loader: another user's turn resolves null");
  check(await load([{ ...lessonRow, boardId: "board-b" }])(ref("verified_scene"), page) === null, "loader: another board's turn resolves null");
  check(await load([lessonRow], { userId: "bob" })(ref("verified_scene"), page) === null, "loader: a save by another user resolves null");
  const laterLesson: PageFigureTurn = { ...lessonRow, id: LATER_ID, orderIndex: 3 };
  check(await load([continuingDoubt(DOUBT_ID, 1, lessonQuestion), laterLesson])(ref("verified_scene", LATER_ID), page) === null,
    "loader: a turn after the doubt resolves null");
  check(await load([lessonRow], { turnId: LESSON_ID })(ref("verified_scene"), page) === null, "loader: a turn cannot point at itself");
  const opener: PageFigureTurn = { ...lessonRow, id: OPENER_ID, orderIndex: 1, sceneArtifacts: null, visualStatus: "text_only", question: lessonQuestion };
  check(await load([lessonRow, opener])(ref("verified_scene"), page) === null, "loader: a turn behind a page opener resolves null");
  const markedOpener: PageFigureTurn = { ...continuingDoubt(OPENER_ID, 1, lessonQuestion), segments: [openerSegment()] };
  check(await load([lessonRow, markedOpener])(ref("verified_scene"), page) === null, "loader: a marked turn that still opens on a CLEAR is a page opener");
  check(await load([lessonRow])(ref("verified_scene"), { lessonQuestion: "Another lesson entirely." }) === null, "loader: a different page question resolves null");
  check(await load([lessonRow])(ref("verified_scene"), { lessonQuestion: `  ${lessonQuestion.toUpperCase()}  ` }) !== null, "loader: the page question is compared after normalising");
  check(await load([lessonRow])(ref("dsa_frame", LESSON_ID, 0), page) === null, "loader: a DSA reference to a plain scene resolves null");
  check(await load([lessonRow])(ref("reference_picture"), page) === null, "loader: a picture reference to a scene resolves null");
  check(await load([{ ...lessonRow, visualStatus: "text_only" }])(ref("verified_scene"), page) === null, "loader: a scene that is not validated resolves null");

  // DSA rows: the named frame, and only a frame in range.
  const dsaRow: PageFigureTurn = {
    id: LESSON_ID, boardId: BOARD, userId: OWNER, orderIndex: 0, question: dsaQuestion, visualStatus: "validated",
    sceneDocument: dsaSaved.value.sceneDocument, sceneArtifacts: dsaSaved.value.sceneArtifacts, segments: [openerSegment()],
  };
  const dsaPage = { lessonQuestion: dsaQuestion };
  const dsaLoaded = await load([dsaRow])(ref("dsa_frame", LESSON_ID, frameIndex), dsaPage);
  check(dsaLoaded !== null && JSON.stringify(dsaLoaded.anchors.map((anchor) => anchor.id)) === JSON.stringify(frameFigure.anchors.map((anchor) => anchor.id)),
    "loader: a DSA reference loads the named frame's figure");
  check(await load([dsaRow])(ref("dsa_frame", LESSON_ID, frames.length + 5), dsaPage) === null, "loader: a frame index out of range resolves null");
  check(await load([dsaRow])(ref("verified_scene"), dsaPage) === null, "loader: a scene reference to a DSA lesson resolves null");
  const noPlan = { ...dsaRow, sceneArtifacts: { ...(dsaRow.sceneArtifacts as Record<string, unknown>), codeLesson: undefined } };
  check(await load([noPlan])(ref("dsa_frame", LESSON_ID, frameIndex), dsaPage) === null, "loader: a DSA lesson without its code plan resolves null");

  // Picture rows: the stored record must still load.
  const pictureRow: PageFigureTurn = {
    id: LESSON_ID, boardId: BOARD, userId: OWNER, orderIndex: 0, question: lessonQuestion, visualStatus: "text_only",
    sceneDocument: null, sceneArtifacts: { referencePicture: picturePresentation.stored }, segments: [openerSegment()],
  };
  const pictureLoaded = await load([pictureRow], {}, async (id) => id === PICTURE.id ? PICTURE : null)(ref("reference_picture"), page);
  check(pictureLoaded !== null && pictureLoaded.anchors.some((anchor) => anchor.id === "reference_picture"), "loader: a picture reference loads the picture's targets");
  check(await load([pictureRow], {}, async () => null)(ref("reference_picture"), page) === null, "loader: a picture whose record is gone resolves null");
  check(await load([pictureRow], {}, async (id) => id === PICTURE.id ? PICTURE : null)(ref("verified_scene"), page) === null, "loader: a scene reference to a picture resolves null");

  // End to end: the real loader behind the real canonicalizer.
  const endToEnd = await canonicalizeTurnSceneMetadata(structuredClone(pointed), { loadPageFigure: load([{ ...lessonRow, userId: "bob" }]) });
  check(endToEnd.ok && targets(savedCommands(endToEnd.value.segments), "FOCUS").length === 0, "end to end: another user's figure lends the doubt no pointing");
  const endToEndOk = await canonicalizeTurnSceneMetadata(structuredClone(pointed), { loadPageFigure: load([lessonRow]) });
  check(endToEndOk.ok && targets(savedCommands(endToEndOk.value.segments), "FOCUS").includes("start_value"), "end to end: the owner's figure keeps the doubt's pointing");

  // -------------------------------------------------------------------------
  // Live filter: doubtSegment with a policy.
  // -------------------------------------------------------------------------
  const segment = (commands: DrawCommand[]): TutorSegment => ({ narration: "Look at this.", command: commands[0] ?? null, ...(commands.length > 1 ? { commands } : {}) }) as TutorSegment;
  const figureIds = new Set(["start_value", "sum_value", "number_line", "2"]);
  const sample = segment([command("FOCUS", "start_value|keep"), command("FOCUS", "ghost"), command("ANNOTATE", "sum_value"), command("ANNOTATE", "ghost")]);
  const off = doubtSegment(sample, { codePanelShowing: false, pointing: { enabled: false, figureIds, codeBoard: false } });
  const none = doubtSegment(sample, { codePanelShowing: false });
  check(JSON.stringify(off) === JSON.stringify(none), "policy off: doubtSegment behaves exactly as with no policy");
  check(none !== null && getSegmentCommands(none).every((entry) => entry.type !== "ANNOTATE") && getSegmentCommands(none).length === 2,
    "no policy: ANNOTATE dropped and FOCUS passed as today");
  const on = doubtSegment(sample, { codePanelShowing: false, pointing: { enabled: true, figureIds, codeBoard: false } });
  const onCommands = on ? getSegmentCommands(on) : [];
  check(JSON.stringify(onCommands.map((entry) => [entry.type, entry.text])) === JSON.stringify([["FOCUS", "start_value|keep"], ["ANNOTATE", "sum_value"]]),
    "policy on: FOCUS and ANNOTATE keep only the figure's ids, modifiers intact");
  const mixed = doubtSegment(segment([command("FOCUS", "ghost,start_value|pulse")]), { codePanelShowing: false, pointing: { enabled: true, figureIds, codeBoard: false } });
  check(mixed !== null && getSegmentCommands(mixed)[0]?.text === "start_value|pulse", "policy on: a list FOCUS keeps only the figure's ids");
  const code = doubtSegment(
    segment([command("FOCUS", "start_value|pulse|keep"), command("FOCUS", "frame_3"), command("ANNOTATE", "sum_value")]),
    { codePanelShowing: true, pointing: { enabled: true, figureIds, codeBoard: true } },
  );
  check(code !== null && JSON.stringify(getSegmentCommands(code).map((entry) => [entry.type, entry.text])) === JSON.stringify([["FOCUS", "start_value|spotlight"]]),
    "code board: cell FOCUS forced to spotlight without keep, frame ids and ANNOTATE dropped");

  console.log(`verify-doubt-figure-pointing: ${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

const PICTURE: ReferencePictureRecord = {
  id: "rp_0123456789abcdef01234567",
  source: "wikimedia",
  title: "File:Animal cell structure en.svg",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Animal_cell_structure_en.svg",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  artist: "LadyofHats",
  imageUrl: "/api/reference-picture/rp_0123456789abcdef01234567/image",
  planUrl: "/api/reference-picture/rp_0123456789abcdef01234567/plan",
  width: 2000,
  height: 1280,
  shows: "A labelled diagram of an animal cell showing its organelles.",
  labels: ["Nucleus", "Cell membrane", "Mitochondrion"],
  plan: { width: 1000, height: 640, outlineLengthPx: 5_000, fillLengthPx: 20_000 },
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
