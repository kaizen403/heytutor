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
import {
  REFERENCE_PICTURE_ZONE,
  getSegmentCommands,
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
  readStoredReferencePicture,
  referencePictureIntroLines,
  shownSubject,
} from "../../features/tutor-session/lib/scene/referencePicturePresentation";
import {
  referencePictureIdsOfTurns,
  restoreReferencePictureFromTurn,
} from "../../features/tutor-session/lib/scene/restoreReferencePicture";
import {
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
import { sceneKeepsReferencePictureRows } from "../../lib/scene/referencePicturePersistence";
import type { RecordedSegmentPayload, StoredTurn } from "../../lib/boards/boardsClient";

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

  finished = true;
  if (failures > 0) {
    console.error(`verify-reference-picture-turn: ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log(`verify-reference-picture-turn: ${checks} checks passed`);
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
