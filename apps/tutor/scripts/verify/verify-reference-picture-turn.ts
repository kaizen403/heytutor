/**
 * The reference picture tier in the turn: its presentation, its prompt, its
 * persistence branch (server rebuild, missing record, forged ids), the client
 * partial save, restore, the request client and the bounded preload.
 *
 * No network and no database: the record loader, fetch and the asset preload
 * are injected.
 *
 *   npx tsx scripts/verify/verify-reference-picture-turn.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  REFERENCE_PICTURE_ZONE,
  getSegmentCommands,
  referencePictureLayout,
  referencePictureLegendEntryRect,
  referencePicturePartBoardRect,
  resolveVerifiedDiagramFocusTargets,
  isBlockedVerifiedDiagramCommand,
  isStoredCommandTrustedGeometry,
  parsePictureCommandParams,
  parseStoredSegmentCommands,
  prepareVerifiedLessonSegments,
  referencePictureCommands,
  serializeSegmentCommands,
  type DrawCommand,
  type ReferencePictureRecord,
  type TutorSegment,
} from "@heytutor/drawing";
import {
  buildReferencePicturePresentation,
  isDistinctivePictureLabel,
  pointsAtReferencePicture,
  readStoredReferencePicture,
  referencePictureDiagram,
  referencePictureIntroLines,
  referencePicturePointables,
  shownSubject,
} from "../../features/tutor-session/lib/scene/referencePicturePresentation";
import {
  referencePictureIdsOfTurns,
  restoreReferencePictureFromTurn,
} from "../../features/tutor-session/lib/scene/restoreReferencePicture";
import {
  parseReferencePictureRecord,
  referencePictureResultFromResponse,
  requestReferencePicture,
} from "../../features/tutor-session/lib/scene/referencePictureClient";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { preloadReferencePictureWithin } from "../../features/tutor-session/lib/scene/referencePicturePreload";
import { partialTurnScene, partialTurnSegments, lessonPageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import {
  canonicalizeTurnSceneMetadata,
  type SubmittedTurnSegment,
} from "../../lib/scene/turnScenePersistence";
import { recordForPartFocus, sceneKeepsReferencePictureRows } from "../../lib/scene/referencePicturePersistence";
import type { RecordedSegmentPayload, StoredTurn } from "../../lib/boards/boardsClient";

/**
 * The presentation at 15b35dab0, the commit before part focus, for a
 * labelled and a numbered record that both carry parts. Part focus off must
 * give exactly this: the prompt, the diagram and the stored artifact.
 */
interface PartFocusOffSnapshot {
  cases: { name: string; record: ReferencePictureRecord; promptAddon: string; diagram: unknown; stored: unknown }[];
}
const PART_FOCUS_OFF: PartFocusOffSnapshot = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/reference-picture-part-focus-off.json", import.meta.url)), "utf8"),
);

let failures = 0;
let checks = 0;
function check(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}

const RECORD: ReferencePictureRecord = {
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
const OTHER_ID = "rp_fedcba9876543210fedcba98";
const QUESTION = "Explain the structure of an animal cell.";

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
const presentation = buildReferencePicturePresentation(RECORD);
const introCommands = presentation.introSegments.flatMap(getSegmentCommands);
check(presentation.introSegments.length === 2, "two intro beats");
check(presentation.introSegments.every((segment) => segment.verifiedDiagramIntro === true), "intro beats are runtime figure intro beats");
check(introCommands.length === 2 && introCommands.every((command) => command.type === "DRAW_PICTURE"), "two DRAW_PICTURE commands");
check(introCommands.every((command) => command.type.startsWith("DRAW_")), "the figure intro transaction admits every intro command");
const passes = introCommands.map((command) => parsePictureCommandParams(command.params)?.pass);
check(passes[0] === "outline" && passes[1] === "fill", "outline first, then fill");
const zone = REFERENCE_PICTURE_ZONE;
for (const command of introCommands) {
  const parsed = parsePictureCommandParams(command.params);
  check(parsed && parsed.placement.x >= zone.x && parsed.placement.y >= zone.y &&
    parsed.placement.x + parsed.placement.width <= zone.x + zone.width &&
    parsed.placement.y + parsed.placement.height <= zone.y + zone.height, "picture placement inside the zone");
  check(command.text === RECORD.id, "command names the record id");
  check(!isBlockedVerifiedDiagramCommand(command, null), "the board admits the runtime picture command");
  check(JSON.stringify(command.params) === JSON.stringify(referencePictureCommands(RECORD)[passes.indexOf(parsed?.pass)]?.params), "params are the contract's commands");
}
for (const segment of presentation.introSegments) {
  const [command] = getSegmentCommands(segment);
  const token = command?.spokenCue?.token ?? "";
  check(token && new RegExp(`\\b${token}\\b`, "i").test(segment.narration), `spoken cue "${token}" is a word of "${segment.narration}"`);
  check(command?.spokenCue?.entityId === "reference_picture", "cue names the picture entity");
}
check(presentation.introSegments[0]!.narration === "Here is a labelled diagram of an animal cell.", `outline line reads naturally: ${presentation.introSegments[0]!.narration}`);
check(presentation.introSegments[1]!.narration === "Let me colour it in.", "fill line");
const hinglish = referencePictureIntroLines(presentation.stored, "hinglish");
check(/\p{Script=Devanagari}/u.test(hinglish.outline.narration) && hinglish.outline.narration.includes(hinglish.outline.token), "Hinglish outline keeps its cue word");
check(hinglish.fill.narration.includes(hinglish.fill.token), "Hinglish fill keeps its cue word");
check(shownSubject("Diagram of the human heart, with chambers labelled") === "the human heart", "subject drops lead and trailing clause");
check(shownSubject("DNA double helix") === "the DNA double helix", "acronym kept");
check(shownSubject("Human heart showing the four chambers and valves") === "the human heart", "subject drops a showing clause");
check(shownSubject("") === "", "empty subject");

const diagram = presentation.diagram;
check(diagram.id === ("reference_picture" as string), "diagram id is the picture entity");
check(diagram.anchors.length === 1 && diagram.anchors[0]!.id === "reference_picture", "one anchor for the whole picture");
const outlinePlacement = parsePictureCommandParams(introCommands[0]!.params)!.placement;
check(diagram.anchors[0]!.x === outlinePlacement.x && diagram.anchors[0]!.width === outlinePlacement.width, "anchor covers the placement");
for (const label of RECORD.labels) check(presentation.promptAddon.includes(`"${label}"`), `addon lists label ${label}`);
check(presentation.promptAddon.includes("[FOCUS:reference_picture]"), "addon names the one focus target");
check(/Never emit DRAW_\*/.test(presentation.promptAddon), "addon forbids drawing tags");
check(/not a figure you drew/i.test(presentation.promptAddon), "addon says the model did not draw it");
check(presentation.stored.credit === "LadyofHats, CC BY-SA 4.0, via Wikimedia Commons", "credit line");

// FOCUS on the picture passes the live filter; FOCUS on a printed label does not.
const focusSegment = (target: string): TutorSegment => {
  const command: DrawCommand = { type: "FOCUS", params: [], text: target, charPosition: 0, narrationBefore: "" };
  return { narration: "Notice the whole cell.", command, commands: [command] };
};
const kept = prepareVerifiedLessonSegments([focusSegment("reference_picture")], diagram);
check(kept.blockedCommandCount === 0 && getSegmentCommands(kept.segments[0]!).some((command) => command.type === "FOCUS"), "FOCUS:reference_picture passes");
const blocked = prepareVerifiedLessonSegments([focusSegment("nucleus")], diagram);
check(blocked.blockedCommandCount === 1, "FOCUS on a part of the picture is blocked");
const spoken = prepareVerifiedLessonSegments([{ narration: "The reference picture shows the nucleus and the diagram.", command: null }], diagram);
check(!spoken.segments.some((segment) => getSegmentCommands(segment).some((command) => command.type === "FOCUS")), "spoken names infer no FOCUS on the picture");

// The prompt carries the picture addon and none of the text only contract.
const prompt = buildTurnTeachingPrompt({
  question: QUESTION,
  diagramPromptAddon: presentation.promptAddon,
  figureExampleSpecies: null,
  turnPlan: null,
  solverProjection: null,
  codeLesson: null,
  isDsa: false,
  familiarity: "normal",
  fastMode: false,
  teachingNote: "",
  alwaysShowUnits: false,
  alwaysStateLawFirst: false,
  narrationLanguage: "english",
} as Parameters<typeof buildTurnTeachingPrompt>[0]);
check(prompt.systemPrompt.includes("BOARD STATE: A REFERENCE PICTURE"), "teaching prompt carries the picture addon");
check(!prompt.systemPrompt.includes("selected text-only mode") && !prompt.systemPrompt.includes("BOARD STATE: NO VERIFIED FIGURE"), "no text only addon beside the picture");

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const trusted = (commands: DrawCommand[]) => serializeSegmentCommands(commands, { trustedDiagramGeometry: true });
const write: DrawCommand = { type: "WRITE", params: [40, 160], text: "cell: smallest unit of life", charPosition: 10, narrationBefore: "" };
const focus = (target: string): DrawCommand => ({ type: "FOCUS", params: [], text: target, charPosition: 12, narrationBefore: "" });
const tamperedOutline: DrawCommand = { ...introCommands[0]!, params: [introCommands[0]!.params[0]! + 100, ...introCommands[0]!.params.slice(1)] };
function rows(outline: DrawCommand, fill: DrawCommand): SubmittedTurnSegment[] {
  return [
    { orderIndex: 0, narration: "Let us look at an animal cell.", spokenText: "Let us look at an animal cell.", command: null },
    { orderIndex: 1, narration: presentation.introSegments[0]!.narration, spokenText: presentation.introSegments[0]!.narration, command: trusted([outline]) },
    { orderIndex: 2, narration: presentation.introSegments[1]!.narration, spokenText: presentation.introSegments[1]!.narration, command: trusted([fill]) },
    { orderIndex: 3, narration: "A cell is the smallest unit of life.", spokenText: "A cell is the smallest unit of life.", command: serializeSegmentCommands([write, focus("reference_picture")]) },
    { orderIndex: 4, narration: "The nucleus holds the DNA.", spokenText: "The nucleus holds the DNA.", command: serializeSegmentCommands([focus("nucleus")]) },
    { orderIndex: 5, narration: "Forged.", spokenText: "Forged.", command: serializeSegmentCommands([{ ...introCommands[0]!, text: OTHER_ID }]) },
  ];
}
const artifacts = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: "scene-artifacts/v3",
  turnPlan: null,
  figureSource: "text_only",
  diagramResultStatus: "text_only",
  referencePicture: presentation.stored,
  referencePictureOutcome: { attempted: true, status: "shown", reason: null, ms: 18_000, speculative: true },
  ...extra,
});
const loader = async (id: string) => (id === RECORD.id ? RECORD : null);
const pictureRows = (segments: readonly SubmittedTurnSegment[]) =>
  segments.filter((segment) => isStoredCommandTrustedGeometry(segment.command));

async function main(): Promise<void> {
  // Record found: both passes rebuilt from the record, even from tampered params.
  const found = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: artifacts(), segments: rows(tamperedOutline, introCommands[1]!) },
    { loadReferencePicture: loader },
  );
  check(found.ok, `found: save succeeds (${found.ok ? "" : found.error})`);
  if (found.ok) {
    const value = found.value;
    check(value.visualStatus === "text_only" && value.sceneDocument === null, "found: still text only for the engine");
    check(value.sceneArtifacts?.figureSource === "text_only" && value.sceneArtifacts?.diagramResultStatus === "text_only", "found: figure source and result status unchanged");
    check(value.sceneArtifacts?.referencePicture?.id === RECORD.id, "found: artifact kept");
    check(value.sceneArtifacts?.referencePictureOutcome?.status === "shown", "found: outcome kept");
    const saved = pictureRows(value.segments).flatMap((segment) => parseStoredSegmentCommands(segment.command));
    check(saved.length === 2, "found: two trusted picture passes");
    check(JSON.stringify(saved.map((command) => command.params)) === JSON.stringify(referencePictureCommands(RECORD).map((command) => command.params)), "found: passes are the server rebuild, not the tampered params");
    check(saved.every((command) => command.spokenCue?.entityId === "reference_picture"), "found: rebuilt passes keep their cue");
    const teaching = value.segments.find((segment) => segment.narration.startsWith("A cell"));
    const teachingCommands = parseStoredSegmentCommands(teaching?.command);
    check(teachingCommands.some((command) => command.type === "WRITE") && teachingCommands.some((command) => command.type === "FOCUS" && command.text === "reference_picture"), "found: WRITE and FOCUS on the picture kept");
    const stale = value.segments.find((segment) => segment.narration.startsWith("The nucleus"));
    check(stale && parseStoredSegmentCommands(stale.command).length === 0, "found: FOCUS on a part dropped, words kept");
    const forged = value.segments.find((segment) => segment.narration === "Forged.");
    check(forged && parseStoredSegmentCommands(forged.command).length === 0, "found: untrusted DRAW_PICTURE dropped, words kept");

    // Restore from what the server saved.
    const turn = { sceneDocument: null, sceneArtifacts: value.sceneArtifacts, segments: value.segments, question: QUESTION } as unknown as StoredTurn;
    const restored = restoreReferencePictureFromTurn(turn);
    check(restored?.id === ("reference_picture" as string) && restored.commands.length === 2, "restore: picture diagram rebuilt from the saved rows");
    check(restored?.anchors[0]?.x === outlinePlacement.x && restored.anchors[0]?.height === outlinePlacement.height, "restore: anchor at the saved placement");
    check(restored?.promptAddon.includes('"Mitochondrion"'), "restore: labels from the artifact");
    check(restoreVerifiedDiagramFromTurn(turn) === null, "restore: the verified restore declines a picture turn first");
    check(JSON.stringify(referencePictureIdsOfTurns([turn, null])) === JSON.stringify([RECORD.id]), "restore: preload ids");
    check(restoreReferencePictureFromTurn({ ...turn, segments: [] }) === null, "restore: no ink, no picture");
    check(restoreReferencePictureFromTurn({ ...turn, sceneArtifacts: null }) === null, "restore: no artifact, no picture");
    check(readStoredReferencePicture({ referencePicture: { ...presentation.stored, id: "rp_nothex" } }) === null, "restore: malformed id refused");
  }

  // Record missing: the picture's ink goes, its words stay, the save succeeds.
  const missing = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: artifacts(), segments: rows(introCommands[0]!, introCommands[1]!) },
    { loadReferencePicture: async () => null },
  );
  check(missing.ok, `missing: save succeeds (${missing.ok ? "" : missing.error})`);
  if (missing.ok) {
    check(pictureRows(missing.value.segments).length === 0, "missing: no trusted ink");
    check(!missing.value.sceneArtifacts?.referencePicture, "missing: artifact dropped");
    check(missing.value.sceneArtifacts?.referencePictureOutcome?.status === "shown", "missing: the client's outcome is kept as telemetry");
    check(missing.value.segments.some((segment) => segment.narration === presentation.introSegments[0]!.narration && segment.command == null), "missing: intro words kept");
    const teaching = missing.value.segments.find((segment) => segment.narration.startsWith("A cell"));
    check(parseStoredSegmentCommands(teaching?.command).every((command) => command.type === "WRITE"), "missing: FOCUS on the absent picture dropped");
  }

  // A resume under a picture an earlier turn drew: no passes of its own, so
  // no artifact, but its FOCUS on the picture is kept.
  const resumed = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: artifacts(), segments: rows(introCommands[0]!, introCommands[1]!).filter((row) => !isStoredCommandTrustedGeometry(row.command)) },
    { loadReferencePicture: loader },
  );
  check(resumed.ok, "resume: save succeeds");
  if (resumed.ok) {
    check(!resumed.value.sceneArtifacts?.referencePicture && pictureRows(resumed.value.segments).length === 0, "resume: no passes, no artifact");
    const teaching = resumed.value.segments.find((segment) => segment.narration.startsWith("A cell"));
    check(parseStoredSegmentCommands(teaching?.command).some((command) => command.type === "FOCUS" && command.text === "reference_picture"), "resume: FOCUS on the page's picture kept");
  }

  // Loader failure is a missing record, not a failed save.
  const thrown = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: artifacts(), segments: rows(introCommands[0]!, introCommands[1]!) },
    { loadReferencePicture: async () => { throw new Error("db down"); } },
  );
  check(thrown.ok && pictureRows(thrown.value.segments).length === 0, "loader error: save succeeds as text");
  const badOutcome = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: artifacts({ referencePictureOutcome: { attempted: true, status: "shown", reason: "<script>", ms: -1, speculative: false } }), segments: [] },
    { loadReferencePicture: loader },
  );
  check(badOutcome.ok && badOutcome.value.sceneArtifacts?.referencePictureOutcome === undefined, "malformed outcome dropped");

  // Forged id on a trusted pass: only the pass naming the record survives.
  const forgedPass = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: artifacts(), segments: rows(introCommands[0]!, { ...introCommands[1]!, text: OTHER_ID }) },
    { loadReferencePicture: loader },
  );
  check(forgedPass.ok, "forged pass: save succeeds");
  if (forgedPass.ok) {
    const saved = pictureRows(forgedPass.value.segments).flatMap((segment) => parseStoredSegmentCommands(segment.command));
    check(saved.length === 1 && parsePictureCommandParams(saved[0]!.params)?.pass === "outline", "forged pass: the other id's pass dropped");
  }
  // Artifact claims one id, every pass names another: no picture is kept.
  const allForged = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: artifacts(), segments: rows({ ...introCommands[0]!, text: OTHER_ID }, { ...introCommands[1]!, text: OTHER_ID }) },
    { loadReferencePicture: async () => RECORD },
  );
  check(allForged.ok && pictureRows(allForged.value.segments).length === 0 && !allForged.value.sceneArtifacts?.referencePicture, "all forged: no picture kept");
  // A loader answering another record for the id is not that id's record.
  const wrongRecord = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: artifacts(), segments: rows(introCommands[0]!, introCommands[1]!) },
    { loadReferencePicture: async () => ({ ...RECORD, id: OTHER_ID }) },
  );
  check(wrongRecord.ok && pictureRows(wrongRecord.value.segments).length === 0, "record for another id: refused");

  // A picture turn with other trusted ink, POINT and ANNOTATE: dropped, saved.
  const line: DrawCommand = { type: "DRAW_LINE", params: [500, 200, 600, 300], charPosition: 0, narrationBefore: "" };
  const extra = [
    ...rows(introCommands[0]!, introCommands[1]!),
    { orderIndex: 6, narration: "A line.", spokenText: "A line.", command: trusted([line]) },
    { orderIndex: 7, narration: "Point.", spokenText: "Point.", command: serializeSegmentCommands([{ type: "POINT", params: [], text: "nucleus", charPosition: 0, narrationBefore: "" }]) },
    { orderIndex: 8, narration: "Annotate.", spokenText: "Annotate.", command: serializeSegmentCommands([{ type: "ANNOTATE", params: [], text: "nucleus", charPosition: 0, narrationBefore: "" }]) },
  ];
  const mixed = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "retry_required", sceneArtifacts: artifacts({ diagramResultStatus: "retry_required" }), segments: extra },
    { loadReferencePicture: loader },
  );
  check(mixed.ok, `mixed: save succeeds (${mixed.ok ? "" : mixed.error})`);
  if (mixed.ok) {
    check(mixed.value.visualStatus === "retry_required", "mixed: retry status kept");
    check(pictureRows(mixed.value.segments).length === 2, "mixed: only the picture passes stay trusted");
    check(mixed.value.segments.some((segment) => segment.narration === "A line." && segment.command == null), "mixed: other trusted ink dropped, words kept");
  }

  // No picture claimed: a text only turn's trusted geometry still fails as before,
  // and a stray DRAW_PICTURE never fails a save.
  const plainArtifacts = { schemaVersion: "scene-artifacts/v3", turnPlan: null, diagramResultStatus: "text_only" };
  const geometry = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: plainArtifacts, segments: [{ orderIndex: 0, narration: "A line.", spokenText: "A line.", command: trusted([line]) }] },
    { loadReferencePicture: loader },
  );
  check(!geometry.ok && geometry.code === "scene_unvalidated_trusted_geometry", "no picture: trusted geometry still refused");
  const stray = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: plainArtifacts, segments: [
      { orderIndex: 0, narration: "Stray.", spokenText: "Stray.", command: serializeSegmentCommands([introCommands[0]!, write]) },
      { orderIndex: 1, narration: "Stray pass.", spokenText: "Stray pass.", command: trusted([introCommands[1]!]) },
    ] },
    { loadReferencePicture: loader },
  );
  check(stray.ok, `no picture: stray picture commands never fail a save (${stray.ok ? "" : stray.error})`);
  if (stray.ok) {
    check(pictureRows(stray.value.segments).length === 0 && !stray.value.sceneArtifacts?.referencePicture, "no picture: stray picture ink dropped");
    check(parseStoredSegmentCommands(stray.value.segments[0]!.command).some((command) => command.type === "WRITE"), "no picture: the row's WRITE kept");
  }
  check(sceneKeepsReferencePictureRows(artifacts()) && !sceneKeepsReferencePictureRows(plainArtifacts), "checkpoint gate reads the picture claim");

  // ---------------------------------------------------------------------------
  // Client partial save
  // ---------------------------------------------------------------------------
  const recorded = rows(introCommands[0]!, introCommands[1]!).map((row) => ({ ...row, audioBytes: null, durationMs: 1000 }) as unknown as RecordedSegmentPayload);
  const pictureScene = { sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only" as const, sceneArtifacts: artifacts() };
  const partial = partialTurnSegments(recorded, pictureScene);
  check(partial.filter((row) => isStoredCommandTrustedGeometry(row.command)).length === 2, "partial: picture passes kept");
  check(parseStoredSegmentCommands(partial.find((row) => row.narration.startsWith("A cell"))?.command).some((command) => command.type === "FOCUS"), "partial: FOCUS on the picture kept");
  check(!partial.some((row) => parseStoredSegmentCommands(row.command).some((command) => command.text === "nucleus")), "partial: FOCUS on a part dropped");
  const plain = partialTurnSegments(recorded, { ...pictureScene, sceneArtifacts: plainArtifacts });
  check(plain.every((row) => !isStoredCommandTrustedGeometry(row.command)), "partial: no picture claimed, passes stripped as before");
  const page = lessonPageRecord("board-1", QUESTION);
  page.turn.scene = pictureScene;
  page.figureDrawn = false;
  check(readStoredReferencePicture(partialTurnScene(page).sceneArtifacts) === null, "partial scene: an undrawn picture is not saved as shown");
  page.figureDrawn = true;
  check(readStoredReferencePicture(partialTurnScene(page).sceneArtifacts)?.id === RECORD.id, "partial scene: a drawn picture is saved");

  // ---------------------------------------------------------------------------
  // Request client
  // ---------------------------------------------------------------------------
  check(referencePictureResultFromResponse({ status: "ready", picture: RECORD }).status === "ready", "client: ready parses");
  check(referencePictureResultFromResponse({ status: "ready", picture: { ...RECORD, id: "rp_bad" } }).status === "unavailable", "client: bad id refused");
  check(referencePictureResultFromResponse({ status: "ready", picture: { ...RECORD, plan: { width: 0 } } }).status === "unavailable", "client: bad plan refused");
  const generated = referencePictureResultFromResponse({ status: "ready", picture: { ...RECORD, source: "generated", pageUrl: null, licenseUrl: null } });
  check(generated.status === "ready" && generated.picture.pageUrl === null, "client: generated picture with null urls parses");
  const declined = referencePictureResultFromResponse({ status: "declined", reason: "judge_rejected" });
  check(declined.status === "declined" && declined.reason === "judge_rejected", "client: decline reason");
  check(referencePictureResultFromResponse("nope").status === "unavailable", "client: garbage is unavailable");
  let sentBody: unknown = null;
  let sentHeaders: Headers | null = null;
  const okFetch = (async (_url: unknown, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    sentHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ status: "ready", picture: RECORD }), { status: 200 });
  }) as typeof fetch;
  const ok = await requestReferencePicture({ question: QUESTION, subject: "other", boardId: "board-1", traceId: "trace-1", fetchImpl: okFetch });
  check(ok.status === "ready", "client: ready result");
  check(JSON.stringify(sentBody) === JSON.stringify({ question: QUESTION, subject: "other", boardId: "board-1" }), "client: body shape");
  check((sentHeaders as Headers | null)?.get("x-heytutor-trace-id") === "trace-1", "client: trace header for the lesson grant");
  const http = await requestReferencePicture({ question: QUESTION, fetchImpl: (async () => new Response("{}", { status: 503 })) as typeof fetch });
  check(http.status === "unavailable" && http.reason === "http_503", "client: error status");
  const transport = await requestReferencePicture({ question: QUESTION, fetchImpl: (async () => { throw new TypeError("offline"); }) as typeof fetch });
  check(transport.status === "unavailable" && transport.reason === "transport", "client: transport failure");
  const hanging = (async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as typeof fetch;
  // AbortSignal.timeout is unref'd in Node: hold the loop open while it fires.
  const keepAlive = setInterval(() => {}, 1_000);
  const deadline = await requestReferencePicture({ question: QUESTION, timeoutMs: 30, fetchImpl: hanging });
  clearInterval(keepAlive);
  check(deadline.status === "unavailable" && deadline.reason === "deadline", "client: deadline");
  const controller = new AbortController();
  const aborting = requestReferencePicture({ question: QUESTION, signal: controller.signal, fetchImpl: hanging });
  controller.abort();
  const aborted = await aborting;
  check(aborted.status === "unavailable" && aborted.reason === "aborted", "client: abort");

  // ---------------------------------------------------------------------------
  // Bounded preload
  // ---------------------------------------------------------------------------
  check(await preloadReferencePictureWithin(RECORD.id, 100, RECORD, async () => ({})), "preload: loaded");
  check(!(await preloadReferencePictureWithin(RECORD.id, 100, RECORD, async () => { throw new Error("404"); })), "preload: failure is false");
  const slowStarted = Date.now();
  check(!(await preloadReferencePictureWithin(RECORD.id, 30, RECORD, () => new Promise(() => {}))), "preload: slow is false");
  check(Date.now() - slowStarted < 1_000, "preload: bounded");
  let passedRecord: unknown = null;
  await preloadReferencePictureWithin(RECORD.id, 100, RECORD, async (_id, record) => { passedRecord = record; });
  check(passedRecord === RECORD, "preload: the live record is handed to the board");

  await partFocusChecks();

  finished = true;
  if (failures > 0) {
    console.error(`verify-reference-picture-turn: ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log(`verify-reference-picture-turn: ${checks} checks passed`);
}

// ---------------------------------------------------------------------------
// Part focus (REFERENCE_PICTURE_PART_FOCUS): the pen points at located parts
// and key rows; off, everything above is byte for byte what it was.
// ---------------------------------------------------------------------------
const PART_RECORD: ReferencePictureRecord = {
  ...RECORD,
  id: "rp_00112233445566778899aabb",
  title: "File:Von Neumann architecture.svg",
  shows: "A labelled diagram of a simple CPU with its registers.",
  labels: ["Accumulator", "R1", "Input", "A", "Program counter"],
  parts: [
    { id: "reference_picture.part.1", label: "Accumulator", box: { x: 100, y: 100, width: 120, height: 22 }, source: "svg" },
    { id: "reference_picture.part.2", label: "r 1", box: { x: 300, y: 200, width: 28, height: 20 }, source: "svg" },
    { id: "reference_picture.part.3", label: "Input", box: { x: 500, y: 300, width: 60, height: 20 }, source: "svg" },
    { id: "reference_picture.part.4", label: "A", box: { x: 600, y: 400, width: 14, height: 20 }, source: "ocr" },
    // Not a judged label, and a box off the picture: both dropped alone.
    { id: "reference_picture.part.6", label: "Cache", box: { x: 10, y: 10, width: 40, height: 20 }, source: "svg" },
    { id: "reference_picture.part.5", label: "Program counter", box: { x: 990, y: 10, width: 40, height: 20 }, source: "svg" },
  ],
};
const KEYED_RECORD: ReferencePictureRecord = {
  ...RECORD,
  id: "rp_aabbccddeeff00112233aabb",
  title: "File:Kidney nephron numbered.svg",
  shows: "A numbered diagram of a nephron.",
  labels: ["Glomerulus", "Proximal tubule", "Loop of Henle", "Cortex"],
  legend: [{ mark: "1", label: "Glomerulus" }, { mark: "2", label: "Proximal tubule" }, { mark: "3", label: "Loop of Henle" }],
  parts: [
    { id: "reference_picture.part.1", label: "Glomerulus", mark: "1", box: { x: 200, y: 120, width: 12, height: 18 }, source: "svg" },
    // Part ids follow the name's place in labels, not the order located.
    { id: "reference_picture.part.3", label: "Loop of Henle", mark: "3", box: { x: 420, y: 500, width: 12, height: 18 }, source: "svg" },
    { id: "reference_picture.part.4", label: "Cortex", box: { x: 700, y: 60, width: 70, height: 20 }, source: "svg" },
  ],
};
const withoutParts = (record: ReferencePictureRecord): ReferencePictureRecord => {
  const copy = { ...record };
  delete copy.parts;
  return copy;
};
const focusCommand = (target: string): DrawCommand => ({ type: "FOCUS", params: [], text: target, charPosition: 0, narrationBefore: "" });
const anchorIds = (diagram: { anchors: { id: string }[] } | null | undefined) => (diagram?.anchors ?? []).map((anchor) => anchor.id);
const inferred = (narration: string, diagram: Parameters<typeof prepareVerifiedLessonSegments>[1]) =>
  prepareVerifiedLessonSegments([{ narration, command: null }], diagram).segments
    .flatMap(getSegmentCommands).filter((command) => command.type === "FOCUS").map((command) => command.semanticRef?.entityId ?? command.text);

async function partFocusChecks(): Promise<void> {
  // Flag off: a record with parts gives today's diagram, prompt and artifact.
  const today = buildReferencePicturePresentation(withoutParts(PART_RECORD));
  const off = buildReferencePicturePresentation(PART_RECORD);
  check(JSON.stringify(off.diagram) === JSON.stringify(today.diagram), "part focus off: the diagram is today's, parts ignored");
  check(JSON.stringify(off.stored) === JSON.stringify(today.stored) && !("partFocus" in off.stored), "part focus off: the stored artifact is today's");
  check(off.promptAddon === today.promptAddon && off.promptAddon.includes("no part of the picture can be focused on its own"), "part focus off: the prompt is today's");
  const keyedOff = buildReferencePicturePresentation(KEYED_RECORD);
  check(JSON.stringify(anchorIds(keyedOff.diagram)) === JSON.stringify(["reference_picture"]) && !keyedOff.diagram.groups, "part focus off: a numbered picture has no key targets");
  // Flag on with nothing to point at: unchanged too.
  const plainOn = buildReferencePicturePresentation(RECORD, { partFocus: true });
  check(JSON.stringify(plainOn.diagram) === JSON.stringify(presentation.diagram) && JSON.stringify(plainOn.stored) === JSON.stringify(presentation.stored), "part focus on, no parts and no key: unchanged");

  // Flag on, printed labels.
  const on = buildReferencePicturePresentation(PART_RECORD, { partFocus: true });
  const onDiagram = on.diagram;
  check(JSON.stringify(anchorIds(onDiagram)) === JSON.stringify(["reference_picture", "reference_picture.part.1", "reference_picture.part.2", "reference_picture.part.3", "reference_picture.part.4"]), `part focus: one anchor per checked part, whole picture first (${anchorIds(onDiagram).join(", ")})`);
  const placement = parsePictureCommandParams(getSegmentCommands(on.introSegments[0]!)[0]!.params)!.placement;
  const r1 = onDiagram.anchors.find((anchor) => anchor.id === "reference_picture.part.2");
  const r1Rect = referencePicturePartBoardRect(PART_RECORD.parts![1]!, placement, PART_RECORD.plan);
  check(r1 && r1.x === r1Rect.x && r1.y === r1Rect.y && r1.width === r1Rect.width && r1.height === r1Rect.height, "part focus: a part's anchor is its printed box on the board");
  check(r1 && r1.x > placement.x && r1.width < 40, "part focus: the anchor is the label, not the card");
  const labelsOf = (id: string) => JSON.stringify(onDiagram.anchors.find((anchor) => anchor.id === id)?.labels);
  check(labelsOf("reference_picture.part.1") === '["Accumulator"]' && labelsOf("reference_picture.part.2") === '["R1"]', "part focus: distinctive labels name their anchors (judged spelling)");
  check(labelsOf("reference_picture.part.3") === "[]" && labelsOf("reference_picture.part.4") === "[]", "part focus: a common word and a single letter name nothing");
  check(on.promptAddon.includes('"R1" = [FOCUS:reference_picture.part.2]') && on.promptAddon.includes('"Input" = [FOCUS:reference_picture.part.3]'), "part focus: the prompt lists each pointable part with its tag");
  check(!on.promptAddon.includes("no part of the picture can be focused") && !on.promptAddon.includes("Cache") && !on.promptAddon.includes("part.5"), "part focus: the no part sentence goes, dropped parts are not offered");
  check(on.promptAddon.includes("[FOCUS:reference_picture] may point at the whole picture"), "part focus: the whole picture stays a target");
  check(on.stored.partFocus?.parts.length === 4 && on.stored.partFocus.plan.width === PART_RECORD.plan.width, "part focus: the artifact carries the checked parts and the plan size");
  check(isDistinctivePictureLabel("Loop of Henle") && !isDistinctivePictureLabel("12") && !isDistinctivePictureLabel("Top view") && !isDistinctivePictureLabel("x"), "distinctive: names yes, numbers, common words and letters no");

  // Live filter and spoken inference.
  const live = prepareVerifiedLessonSegments([
    { narration: "Notice R1.", command: focusCommand("reference_picture.part.2"), commands: [focusCommand("reference_picture.part.2")] },
    { narration: "And this.", command: focusCommand("reference_picture.part.9"), commands: [focusCommand("reference_picture.part.9")] },
  ], onDiagram);
  check(live.blockedCommandCount === 1 && getSegmentCommands(live.segments[0]!).some((command) => command.text === "reference_picture.part.2"), "live: a listed part passes, an unknown part is blocked");
  check(live.segments.some((segment) => segment.narration === "And this."), "live: the blocked part's words are kept");
  check(prepareVerifiedLessonSegments([{ narration: "Here.", command: focusCommand("reference_picture.part.2"), commands: [focusCommand("reference_picture.part.2")] }], off.diagram).blockedCommandCount === 1, "live, part focus off: a part FOCUS is blocked as before");
  check(JSON.stringify(inferred("Now look at the Accumulator, it keeps the running sum.", onDiagram)) === '["reference_picture.part.1"]', "inference: a distinctive name spoken infers its part");
  check(JSON.stringify(inferred("R1 is a general purpose register.", onDiagram)) === '["reference_picture.part.2"]', "inference: a short name in its printed case infers its part");
  check(inferred("The input is read first, and this is A for short.", onDiagram).length === 0, "inference: common words and single letters infer nothing");
  check(inferred("The reference picture shows the diagram of a CPU.", onDiagram).length === 0, "inference: the whole picture is never inferred");

  // Numbered picture: key targets, mark first then row.
  const keyed = buildReferencePicturePresentation(KEYED_RECORD, { partFocus: true });
  const keyedDiagram = keyed.diagram;
  const layout = referencePictureLayout(KEYED_RECORD)!;
  const groupOf = (id: string) => JSON.stringify(keyedDiagram.groups?.find((group) => group.id === id)?.entityIds);
  check(groupOf("reference_picture.key.1") === '["reference_picture.key.1.mark","reference_picture.key.1.row"]', "key: a located mark, then its row");
  check(groupOf("reference_picture.key.2") === '["reference_picture.key.2.row"]', "key: no mark located, the row alone stays pointable");
  check(groupOf("reference_picture.key.3") === '["reference_picture.key.3.mark","reference_picture.key.3.row"]', "key: entry 3");
  const row3 = keyedDiagram.anchors.find((anchor) => anchor.id === "reference_picture.key.3.row");
  const row3Rect = referencePictureLegendEntryRect(layout.legend!, 2)!;
  check(row3 && JSON.stringify({ x: row3.x, y: row3.y, width: row3.width, height: row3.height }) === JSON.stringify(row3Rect), "key: the row anchor is the key entry's box");
  check(row3 && row3.x > layout.picture.x + layout.picture.width, "key: the row sits beside the picture, not on it");
  const mark3 = keyedDiagram.anchors.find((anchor) => anchor.id === "reference_picture.key.3.mark");
  const mark3Rect = referencePicturePartBoardRect(KEYED_RECORD.parts![1]!, layout.picture, KEYED_RECORD.plan);
  check(mark3 && mark3.x === mark3Rect.x && mark3.y === mark3Rect.y, "key: the mark anchor is the located mark");
  const resolved = resolveVerifiedDiagramFocusTargets(focusCommand("reference_picture.key.3"), keyedDiagram).map((anchor) => anchor.id);
  check(JSON.stringify(resolved) === '["reference_picture.key.3.mark","reference_picture.key.3.row"]', "key: the group resolves mark first, then the row");
  check(keyedDiagram.anchors.every((anchor) => anchor.labels.length === 0 || anchor.id === "reference_picture.part.4"), "key: key targets carry no spoken labels");
  check(anchorIds(keyedDiagram).includes("reference_picture.part.4"), "key: a printed name on a numbered picture is its own part");
  check(keyed.promptAddon.includes("part 3, the loop of Henle = [FOCUS:reference_picture.key.3]") && keyed.promptAddon.includes("part 2, the proximal tubule = [FOCUS:reference_picture.key.2]"), "key: the prompt lists every key entry with its tag");
  check(!anchorIds(keyedDiagram).some((id) => /^reference_picture\.part\.[123]$/.test(id)), "key: a mark is not offered twice as a part");
  const unlocated = buildReferencePicturePresentation(withoutParts(KEYED_RECORD), { partFocus: true });
  check(unlocated.diagram.groups?.length === 3 && unlocated.stored.partFocus?.parts.length === 0, "key: with nothing located every key row is still pointable");

  // Key targets are named by the printed mark, never the entry's place: on a
  // key that skips 3, "part 4" is key.4 and rings mark 4's row; key.3 is
  // refused, live and on save.
  const gappedRecord = PART_FOCUS_OFF.cases.find((entry) => entry.name === "numbered")!.record;
  const gapped = buildReferencePicturePresentation(gappedRecord, { partFocus: true });
  const gappedLayout = referencePictureLayout(gappedRecord)!;
  const rectOf = (anchor: { x: number; y: number; width: number; height: number } | null | undefined) =>
    anchor ? JSON.stringify({ x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height }) : "none";
  const resolvedIds = (diagram: Parameters<typeof resolveVerifiedDiagramFocusTargets>[1], id: string) =>
    resolveVerifiedDiagramFocusTargets(focusCommand(id), diagram).map((anchor) => anchor.id);
  check(JSON.stringify(gapped.diagram.groups?.map((group) => group.id)) === '["reference_picture.key.1","reference_picture.key.2","reference_picture.key.4","reference_picture.key.5"]', "gapped key: one target per printed mark (1, 2, 4, 5)");
  check(JSON.stringify(resolvedIds(gapped.diagram, "reference_picture.key.4")) === '["reference_picture.key.4.mark","reference_picture.key.4.row"]', "gapped key: key.4 is mark 4 then its row");
  const gappedRow4 = gapped.diagram.anchors.find((anchor) => anchor.id === "reference_picture.key.4.row");
  check(rectOf(gappedRow4) === rectOf(referencePictureLegendEntryRect(gappedLayout.legend!, 2)), "gapped key: key.4 rings the row of mark 4 (the third entry), not mark 5's");
  check(rectOf(gapped.diagram.anchors.find((anchor) => anchor.id === "reference_picture.key.5.row")) === rectOf(referencePictureLegendEntryRect(gappedLayout.legend!, 3)), "gapped key: key.5 rings the row of mark 5");
  const gappedMark4 = gapped.diagram.anchors.find((anchor) => anchor.id === "reference_picture.key.4.mark");
  check(rectOf(gappedMark4) === rectOf(referencePicturePartBoardRect(gappedRecord.parts!.find((part) => part.mark === "4")!, gappedLayout.picture, gappedRecord.plan)), "gapped key: key.4's mark anchor is the located mark 4");
  check(gapped.promptAddon.includes("part 4, the loop of Henle = [FOCUS:reference_picture.key.4]") && gapped.promptAddon.includes("part 5, the collecting duct = [FOCUS:reference_picture.key.5]") && !gapped.promptAddon.includes("reference_picture.key.3"), "gapped key: the prompt pairs each spoken mark with its own id");
  check(resolvedIds(gapped.diagram, "reference_picture.key.3").length === 0 && !pointsAtReferencePicture(focusCommand("reference_picture.key.3"), referencePicturePointables(gapped.stored)), "gapped key: key.3 resolves to nothing and the save filter refuses it");
  check(prepareVerifiedLessonSegments([{ narration: "And part 3.", command: focusCommand("reference_picture.key.3"), commands: [focusCommand("reference_picture.key.3")] }], gapped.diagram).blockedCommandCount === 1, "gapped key: a live key.3 is blocked");
  check(pointsAtReferencePicture(focusCommand("reference_picture.key.4"), referencePicturePointables(gapped.stored)), "gapped key: the save filter keeps key.4");
  const reordered: ReferencePictureRecord = {
    ...withoutParts(gappedRecord),
    labels: ["Collecting duct", "Glomerulus", "Loop of Henle"],
    legend: [{ mark: "5", label: "Collecting duct" }, { mark: "1", label: "Glomerulus" }, { mark: "3", label: "Loop of Henle" }],
  };
  const reorderedOn = buildReferencePicturePresentation(reordered, { partFocus: true });
  const reorderedLayout = referencePictureLayout(reordered)!;
  check(["5", "1", "3"].every((mark, index) => rectOf(reorderedOn.diagram.anchors.find((anchor) => anchor.id === `reference_picture.key.${mark}.row`)) === rectOf(referencePictureLegendEntryRect(reorderedLayout.legend!, index))), "reordered key (5, 1, 3): each key.<mark> rings its own row");
  check(resolvedIds(reorderedOn.diagram, "reference_picture.key.2").length === 0 && reorderedOn.promptAddon.includes("part 5, the collecting duct = [FOCUS:reference_picture.key.5]"), "reordered key: key.2 resolves to nothing, mark 5 is key.5");
  // An artifact saved with an older numbering loses those parts, never points them elsewhere.
  const renumbered = readStoredReferencePicture({ referencePicture: { ...on.stored, partFocus: { ...on.stored.partFocus!, parts: on.stored.partFocus!.parts.map((part) => part.label === "Input" ? { ...part, id: "reference_picture.part.4" } : part) } } });
  check(renumbered?.partFocus?.parts.length === 3 && !renumbered.partFocus.parts.some((part) => part.label === "Input"), "artifact: a part whose id is not its label's place is dropped");

  // Part focus off is the pre-branch presentation, frozen at 15b35dab0.
  for (const snapshot of PART_FOCUS_OFF.cases) {
    check(snapshot.record.parts && parseReferencePictureRecord(JSON.parse(JSON.stringify(snapshot.record)))?.parts?.length === snapshot.record.parts.length, `snapshot ${snapshot.name}: the record's parts are all valid, so off really ignores them`);
    for (const [how, built] of [
      ["default", buildReferencePicturePresentation(snapshot.record)],
      ["partFocus false", buildReferencePicturePresentation(snapshot.record, { partFocus: false })],
      ["server stripped", buildReferencePicturePresentation(recordForPartFocus(snapshot.record, false))],
    ] as const) {
      check(built.promptAddon === snapshot.promptAddon, `snapshot ${snapshot.name} (${how}): the prompt addon is the pre-branch text`);
      check(JSON.stringify(built.diagram) === JSON.stringify(snapshot.diagram), `snapshot ${snapshot.name} (${how}): the diagram is the pre-branch diagram`);
      check(JSON.stringify(built.stored) === JSON.stringify(snapshot.stored), `snapshot ${snapshot.name} (${how}): the stored artifact is the pre-branch artifact`);
      const rebuilt = referencePictureDiagram(built.stored, built.diagram.commands, built.diagram.reveals);
      check(JSON.stringify(rebuilt) === JSON.stringify(snapshot.diagram), `snapshot ${snapshot.name} (${how}): referencePictureDiagram rebuilds the pre-branch diagram`);
    }
  }
  const labelledSnapshot = PART_FOCUS_OFF.cases.find((entry) => entry.name === "labelled")!;
  const strippedOn = buildReferencePicturePresentation(recordForPartFocus(labelledSnapshot.record, false), { partFocus: true });
  check(strippedOn.promptAddon === labelledSnapshot.promptAddon && JSON.stringify(strippedOn.diagram) === JSON.stringify(labelledSnapshot.diagram), "snapshot labelled: part focus on with no parts and no key is the pre-branch presentation");

  // A placement the record's layout does not give: no part targets at all.
  const shifted = getSegmentCommands(on.introSegments[0]!).map((command) => ({ type: command.type, params: [command.params[0]! + 30, ...command.params.slice(1)], text: command.text }));
  check(JSON.stringify(anchorIds(referencePictureDiagram(on.stored, shifted))) === '["reference_picture"]', "placement disagreeing with the record: whole picture only");

  // Filters for saves that see only the artifact.
  const pointables = referencePicturePointables(on.stored);
  check(pointsAtReferencePicture(focusCommand("reference_picture.part.2|pulse"), pointables), "filter: a listed part is kept");
  check(pointsAtReferencePicture(focusCommand("reference_picture,reference_picture.part.1"), pointables), "filter: the whole picture with a part is kept");
  check(!pointsAtReferencePicture(focusCommand("reference_picture.part.2,nucleus"), pointables), "filter: one unknown target drops the FOCUS");
  check(!pointsAtReferencePicture(focusCommand("reference_picture.part.9"), pointables), "filter: an unknown part is dropped");
  check(!pointsAtReferencePicture(focusCommand("reference_picture.part.2"), null) && !pointsAtReferencePicture(focusCommand("reference_picture.part.2"), referencePicturePointables(off.stored)), "filter: no part focus, only the whole picture");
  check(pointsAtReferencePicture(focusCommand("reference_picture.key.2"), referencePicturePointables(keyed.stored)), "filter: a key target is kept");
  check(!pointsAtReferencePicture(focusCommand("P"), { anchors: [...pointables.anchors, { id: "P", labels: ["P"], x: 0, y: 0, width: 10, height: 10 }] }), "filter: an anchor that is not the picture's is never kept");
  check(!("parts" in recordForPartFocus(PART_RECORD, false)) && recordForPartFocus(PART_RECORD, true).parts?.length === PART_RECORD.parts!.length, "loader: parts stripped when part focus is off, kept when on");

  // The artifact reader.
  const back = readStoredReferencePicture({ referencePicture: JSON.parse(JSON.stringify(on.stored)) });
  check(back && JSON.stringify(back) === JSON.stringify(on.stored), "artifact: part focus round trips");
  const badPlan = readStoredReferencePicture({ referencePicture: { ...on.stored, partFocus: { plan: { width: 0, height: 10 }, parts: on.stored.partFocus!.parts } } });
  check(badPlan?.id === PART_RECORD.id && !badPlan.partFocus, "artifact: broken part focus loses its pointing, keeps the picture");
  const forgedPart = readStoredReferencePicture({ referencePicture: { ...on.stored, partFocus: { ...on.stored.partFocus!, parts: [...on.stored.partFocus!.parts, { id: "reference_picture.part.7", label: "Cache", box: { x: 1, y: 1, width: 20, height: 10 }, source: "svg" }] } } });
  check(forgedPart?.partFocus?.parts.length === 4, "artifact: a part the record does not name is dropped");

  // The request client keeps checked parts only.
  const parsed = parseReferencePictureRecord(JSON.parse(JSON.stringify(PART_RECORD)));
  check(parsed?.parts?.length === 4 && parsed.parts[1]!.label === "R1", "client: parts parsed and checked against the labels");
  check(parseReferencePictureRecord(JSON.parse(JSON.stringify(RECORD))) && !("parts" in parseReferencePictureRecord(JSON.parse(JSON.stringify(RECORD)))!), "client: no parts, no field");

  // Persistence: the server checks targets against its own record and flag.
  const partRows = (): SubmittedTurnSegment[] => {
    const intro = on.introSegments.flatMap(getSegmentCommands);
    return [
      { orderIndex: 0, narration: on.introSegments[0]!.narration, spokenText: on.introSegments[0]!.narration, command: trusted([intro[0]!]) },
      { orderIndex: 1, narration: on.introSegments[1]!.narration, spokenText: on.introSegments[1]!.narration, command: trusted([intro[1]!]) },
      { orderIndex: 2, narration: "Notice R1, a register.", spokenText: "Notice R1, a register.", command: serializeSegmentCommands([write, focus("reference_picture.part.2")]) },
      { orderIndex: 3, narration: "And the cache.", spokenText: "And the cache.", command: serializeSegmentCommands([focus("reference_picture.part.5")]) },
    ];
  };
  const partArtifacts = (stored: unknown) => ({ ...artifacts(), referencePicture: stored });
  const partLoader = async (id: string) => (id === PART_RECORD.id ? PART_RECORD : null);
  const savedFocus = (segments: readonly SubmittedTurnSegment[], narration: string) =>
    parseStoredSegmentCommands(segments.find((segment) => segment.narration.startsWith(narration))?.command).filter((command) => command.type === "FOCUS").map((command) => command.text);

  process.env.REFERENCE_PICTURE_PART_FOCUS = "on";
  const savedOn = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: partArtifacts(on.stored), segments: partRows() },
    { loadReferencePicture: partLoader },
  );
  delete process.env.REFERENCE_PICTURE_PART_FOCUS;
  check(savedOn.ok, `save, part focus on: succeeds (${savedOn.ok ? "" : savedOn.error})`);
  if (savedOn.ok) {
    check(JSON.stringify(savedFocus(savedOn.value.segments, "Notice R1")) === '["reference_picture.part.2"]', "save, part focus on: FOCUS on a listed part kept");
    check(savedFocus(savedOn.value.segments, "And the cache").length === 0 && savedOn.value.segments.some((segment) => segment.narration === "And the cache."), "save, part focus on: unknown part dropped, words kept");
    check(JSON.stringify(savedOn.value.sceneArtifacts?.referencePicture) === JSON.stringify(on.stored), "save, part focus on: the artifact is the server's, with its parts");
    // Restore and replay point exactly where the live turn pointed.
    const turn = { sceneDocument: null, sceneArtifacts: savedOn.value.sceneArtifacts, segments: savedOn.value.segments, question: QUESTION } as unknown as StoredTurn;
    const restored = restoreReferencePictureFromTurn(turn);
    check(restored && JSON.stringify(restored.anchors) === JSON.stringify(onDiagram.anchors) && JSON.stringify(restored.groups) === JSON.stringify(onDiagram.groups), "restore: the same part anchors as the live turn");
    check(restored?.promptAddon === on.promptAddon, "restore: the same prompt as the live turn");
    const replayed = prepareVerifiedLessonSegments(savedOn.value.segments.filter((segment) => segment.orderIndex >= 2).map((segment) => {
      const commands = parseStoredSegmentCommands(segment.command) as DrawCommand[];
      return { narration: segment.narration, command: commands[0] ?? null, commands };
    }), restored);
    check(replayed.blockedCommandCount === 0 && replayed.segments.flatMap(getSegmentCommands).some((command) => command.text === "reference_picture.part.2"), "replay: the saved part FOCUS resolves on the restored picture");
  }
  // A forged artifact cannot add a part: the server rebuilds it from the record.
  const forgedStored = { ...on.stored, partFocus: { ...on.stored.partFocus!, parts: [...on.stored.partFocus!.parts, { id: "reference_picture.part.5", label: "Cache", box: { x: 10, y: 10, width: 40, height: 20 }, source: "svg" }] } };
  process.env.REFERENCE_PICTURE_PART_FOCUS = "on";
  const savedForged = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: partArtifacts(forgedStored), segments: partRows() },
    { loadReferencePicture: partLoader },
  );
  delete process.env.REFERENCE_PICTURE_PART_FOCUS;
  check(savedForged.ok && savedFocus(savedForged.value.segments, "And the cache").length === 0 &&
    savedForged.value.sceneArtifacts?.referencePicture?.partFocus?.parts.length === 4, "save: a part the browser added is not kept");

  // Flag off on the server: the same submission saves as today.
  const savedOff = await canonicalizeTurnSceneMetadata(
    { question: QUESTION, visualStatus: "text_only", sceneArtifacts: partArtifacts(on.stored), segments: partRows() },
    { loadReferencePicture: partLoader },
  );
  check(savedOff.ok, "save, part focus off: succeeds");
  if (savedOff.ok) {
    check(savedFocus(savedOff.value.segments, "Notice R1").length === 0 && savedOff.value.segments.some((segment) => segment.narration === "Notice R1, a register."), "save, part focus off: part FOCUS dropped, words kept");
    check(JSON.stringify(savedOff.value.sceneArtifacts?.referencePicture) === JSON.stringify(off.stored), "save, part focus off: the artifact is today's");
  }

  // The client's partial save keeps only targets of the picture it showed.
  const recordedParts = partRows().map((row) => ({ ...row, audioBytes: null, durationMs: 1000 }) as unknown as RecordedSegmentPayload);
  const sceneWith = (stored: unknown) => ({ sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only" as const, sceneArtifacts: partArtifacts(stored) });
  const partialOn = partialTurnSegments(recordedParts, sceneWith(on.stored));
  const partialFocus = (rows: RecordedSegmentPayload[], narration: string) =>
    parseStoredSegmentCommands(rows.find((row) => row.narration.startsWith(narration))?.command).filter((command) => command.type === "FOCUS").map((command) => command.text);
  check(JSON.stringify(partialFocus(partialOn, "Notice R1")) === '["reference_picture.part.2"]', "partial: FOCUS on a listed part kept");
  check(partialFocus(partialOn, "And the cache").length === 0, "partial: unknown part dropped");
  const partialOff = partialTurnSegments(recordedParts, sceneWith(off.stored));
  check(partialFocus(partialOff, "Notice R1").length === 0, "partial, part focus off: part FOCUS dropped as before");
}

// A promise left pending with nothing on the loop exits 0 without a word.
let finished = false;
process.on("exit", (code) => {
  if (!finished && code === 0) {
    console.error("verify-reference-picture-turn: main never finished");
    process.exitCode = 1;
  }
});

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
