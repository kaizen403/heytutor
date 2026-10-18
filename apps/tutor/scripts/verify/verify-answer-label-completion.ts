/** Captured launch figures must teach before revealing their solved labels. */
import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument } from "@heytutor/scene-engine";
import { getSegmentCommands, type VerifiedDiagramCommand } from "@heytutor/drawing";
import captures from "./fixtures/answer-label-captures.json";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

const expectedAnswers: Record<string, string[]> = { L01: ["speedResult", "distanceResult"], L11: ["a4"] };
const primitiveIds = (commands: readonly VerifiedDiagramCommand[]) => commands.map((command) => command.semanticRef?.primitiveId);
for (const capture of captures.captures) {
  const document = validateSceneDocument(capture.sceneDocument).document;
  assert(document, `${capture.id}: captured document must remain structurally valid`);
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, `${capture.id}: captured figure must compile honestly`);
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  const intro = presentation.introSegments.flatMap(getSegmentCommands);
  for (const id of expectedAnswers[capture.id]!) {
    assert(!primitiveIds(intro).includes(id), `${capture.id}: solved answer ${id} must wait until teaching finishes`);
    assert(primitiveIds(presentation.diagram.commands).includes(id), `${capture.id}: withholding must never delete the verified result`);
  }
}
console.log("answer-label completion: captured result labels wait without changing the verified figure");

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  remainingDeferredAnnotations, parseStoredSegmentCommands, serializeSegmentCommands, takeDeferredAnnotations,
  verifiedDiagramCommandToDrawCommand, type DrawCommand, type VerifiedDiagram,
} from "@heytutor/drawing";
import type { SceneDocument } from "@heytutor/scene-engine";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import type { UseTurnLifecycleParams } from "../../features/tutor-session/hooks/turn/types";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { isAnswerLabel } from "../../features/tutor-session/lib/scene/answerLabelReveal";
import { storedCodeLessonSegmentCommands } from "../../lib/code-lesson/persistedCodeLesson";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { buildLecturePlayerTimeline } from "../../lib/replay/lecturePlayer";
import { completeStoredTurnDiagram, drawReplayDiagramTimeline } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

const ref = <T>(current: T) => ({ current });
const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const react = { useRef: ref, useCallback: (fn: unknown) => fn, useEffect() {}, useState: (value: unknown) => [value, () => {}] };
function loadHook<T>(relative: string): T {
  const file = path.join(app, relative);
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => {
    if (name === "react") return react;
    const target = name.startsWith(".") ? path.resolve(path.dirname(file), name) : null;
    if (target?.startsWith(path.join(app, "features/tutor-session/hooks"))) return loadHook(path.relative(app, `${target}.ts`));
    return requireApp(target ?? name);
  }, loaded, loaded.exports);
  return loaded.exports as T;
}
const executorHook = loadHook<typeof import("../../features/tutor-session/hooks/useCommandExecution")>("features/tutor-session/hooks/useCommandExecution.ts").useCommandExecution;
const controlHook = loadHook<typeof import("../../features/tutor-session/hooks/turn/useTurnControl")>("features/tutor-session/hooks/turn/useTurnControl.ts").useTurnControl;
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)); };
function captured(id: string) {
  const capture = captures.captures.find((entry) => entry.id === id)!;
  const document = validateSceneDocument(capture.sceneDocument).document!;
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene);
  return { capture, document, ...buildVerifiedDiagramPresentation(document, compiled.renderScene) };
}
function stored(id: string): StoredTurn {
  const { capture, document } = captured(id);
  return { id, question: capture.question, status: "complete", kind: "lesson", visualStatus: "validated", sceneDocument: document,
    sceneArtifacts: capture.sceneArtifacts, segments: capture.segments.map((segment, orderIndex) => ({ ...segment, id: `${id}-${orderIndex}`, orderIndex, spokenText: segment.narration })) } as unknown as StoredTurn;
}

async function gestureProtection(mode: "seek" | "scheduled" | "annotate" | "group", source = captured("L11"), answerId = "a4") {
  const { diagram } = source;
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock(); board.setTimeSource(clock.source);
  const active = ref<VerifiedDiagram | null>(diagram);
  const executor = executorHook({
    whiteboardRef: ref(board), cancelRef: ref(false), activeVerifiedDiagramRef: active,
    fbdPhaseStartedRef: ref(true), fbdPhaseMarkedRef: ref(false), boardLayoutRef: ref({ rects: [], nextY: 100 }),
    inkPaceRef: ref("follow"), speedRef: ref(1), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
    turnTelemetryRef: ref(null), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    raceWithCancel: async (promise) => promise, resolveTextPlacement: async (_command, x, y) => ({ x, y }),
    cancellableDelay: async () => {}, forgetErasedTextRects() {}, resetBoardLayout() {}, nowMs: clock.source.now,
  });
  const group = diagram.groups?.find((entry) => entry.entityIds.includes("battery"))?.id ?? "battery";
  const target = mode === "annotate" ? "battery" : mode === "group" ? group : "battery";
  const command: DrawCommand = { type: mode === "annotate" ? "ANNOTATE" : "FOCUS", params: [], text: target, charPosition: 0, narrationBefore: "" };
  const answer = diagram.deferredAnnotations!.find((entry) => entry.commands.some((candidate) => candidate.semanticRef?.primitiveId === answerId))!;
  assert.equal(answer.revealAfter, "teaching_complete");
  // Same host, ordinary setup label: its release must stay independent.
  const given = answerId === "a4" ? diagram.commands.find((entry) => entry.semanticRef?.primitiveId === "primitive_battery_label") : undefined;
  if (given) diagram.deferredAnnotations!.push({ entityId: "battery", commands: [given] });
  let done = false;
  const job = executor.executeCommandWithCancel(command, {
    durationScale: mode === "scheduled" ? 1 : 0,
    ...(mode === "scheduled" ? { focusSchedule: { targets: [{ id: "battery", startMs: 0, endMs: 1000, anchor: "label" as const }], matchedCount: 1, source: "estimated" as const }, getAudioPositionMs: () => 1_000_000 } : {}),
  }).then(() => { done = true; });
  try {
    for (let elapsed = 0; !done && elapsed < 60_000; elapsed += 1000) { clock.advance(1000); clock.pump(); await flush(); }
    assert(done, `${mode}: actual executor must finish in a bounded clock`); await job;
    assert(diagram.deferredAnnotations!.includes(answer), `${mode}: actual gesture must not consume solved answer ink`);
    if (given) assert(!diagram.deferredAnnotations!.some((entry) => entry.commands.includes(given)), `${mode}: ordinary given label must still be released`);
  } finally { board.cancelAnimations(); unmountTestWhiteboard(board); }
}

async function liveCompletion(mode: "complete" | "superseded" | "doubt" | "during-first" | "during-second") {
  const interruptAt = mode === "during-first" ? 1 : mode === "during-second" ? 2 : 0;
  const captureId = interruptAt ? "L01" : "L11";
  const { diagram } = captured(captureId);
  const emitted: DrawCommand[] = [];
  let attempt = 0, blockedId = "", unblock = () => {}, markBlocked = () => {};
  const blocked = new Promise<void>((resolve) => { markBlocked = resolve; });
  const blockedInk = new Promise<void>((resolve) => { unblock = resolve; });
  let alreadyBlocked = false;
  let speechDone = () => {}, inkDone = () => {};
  const speech = new Promise<void>((resolve) => { speechDone = resolve; });
  const ink = new Promise<void>((resolve) => { inkDone = resolve; });
  const lifecycle = {
    sessionId: "answer-gate", boardLayoutRef: ref({ rects: [], nextY: 100 }), phaseRef: ref("speaking"), isPausedRef: ref(false),
    whiteboardRef: ref(null), activeVerifiedDiagramRef: ref(diagram), cancelRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1),
    turnAbortRef: ref(null), segmentChainRef: ref(speech), drawChainRef: ref(ink), collectedSegmentsRef: ref([]), recordedSegmentsRef: ref([]),
    segmentPlanStatsRef: ref(null), turnTelemetryRef: ref(null), currentTraceIdRef: ref(null), pendingSegmentCountRef: ref(0),
    turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), narrationSinceEpochRef: ref(""), storedTurnsRef: ref([]), liveQuestionRef: ref("parallel circuit"),
    codeLessonControllerRef: ref(null), rawResponseRef: ref(""), fbdPhaseStartedRef: ref(true), fbdPhaseMarkedRef: ref(false),
    speedRef: ref(1), fastModeRef: ref(false), familiarityRef: ref("normal"), adaptiveFactorRef: ref(1), inkPaceRef: ref("follow"),
    notesEpochsRef: ref([]), forceSequentialWorkLayoutRef: ref(false), narrationDensityRef: ref(0),
    stopTurnRef: ref(null), replayGenerationRef: ref(0), replayCueRef: ref(null), ttsClientRef: ref(null),
    executeCommandWithCancel: async (command: DrawCommand) => {
      if (expectedAnswers[captureId]!.includes(command.semanticRef?.primitiveId ?? "")) {
        attempt++;
        if (interruptAt && !alreadyBlocked && attempt === interruptAt) {
          alreadyBlocked = true; blockedId = command.semanticRef!.primitiveId!; markBlocked();
          const owner = lifecycle.turnGenerationRef.current;
          await blockedInk;
          if (owner !== lifecycle.turnGenerationRef.current) return;
        }
      }
      emitted.push(command);
    },
    setNarrationText() {}, setCurrentSegmentText() {}, setPhase() {}, setIsPaused() {}, setLastError() {},
    ensureTTSClient() { throw new Error("No provider is allowed in the queue completion gate"); },
  } as unknown as UseTurnLifecycleParams;
  const control = controlHook(lifecycle, ref(async () => {}));
  let settled = false;
  const job = control.processResponseText("[STEP]The total current follows from the two branches.[/STEP]", [], true, 1, [], { revealDeferredAnnotations: mode !== "doubt" }).then(() => { settled = true; });
  await flush(); assert(!settled); assert.equal(emitted.length, 0, "completion waits for final narration");
  speechDone(); await flush(); assert(!settled); assert.equal(emitted.length, 0, "completion also waits for final drawing");
  if (mode === "superseded") lifecycle.turnGenerationRef.current++;
  inkDone();
  if (interruptAt) { await blocked; lifecycle.turnGenerationRef.current++; unblock(); }
  await job;
  const answerCommands = () => emitted.filter((command) => expectedAnswers[captureId]!.includes(command.semanticRef?.primitiveId ?? ""));
  assert.equal(answerCommands().length, mode === "complete" ? 1 : interruptAt ? interruptAt - 1 : 0, `${mode}: only the completed owner may flush the answer`);
  if (interruptAt) {
    assert(diagram.deferredAnnotations!.some((entry) => entry.revealAfter && entry.commands.some((command) => command.semanticRef?.primitiveId === blockedId)), "actual live Stop during ink preserves the in-flight result and its suffix");
    await control.processResponseText("[STEP]The calculation is complete.[/STEP]", [], true, lifecycle.turnGenerationRef.current);
    assert.deepEqual(primitiveIds(answerCommands()).sort(), [...expectedAnswers.L01!].sort(), "same-board resumed completion restores both labels once through the actual live terminal");
  }
}

async function historicalReplay(id: string, status: "complete" | "stopped") {
  const turn = stored(id); turn.status = status;
  const original = structuredClone(turn);
  const saved = await canonicalizeTurnSceneMetadata({ question: turn.question, sceneDocument: turn.sceneDocument, sceneArtifacts: turn.sceneArtifacts, visualStatus: "validated", segments: turn.segments.map((segment) => ({ orderIndex: segment.orderIndex, narration: segment.narration, spokenText: segment.spokenText, command: segment.command, durationMs: segment.durationMs ?? undefined, timings: segment.timings ?? undefined })) });
  assert(saved.ok, `${id}: the unchanged captured authority must still save: ${saved.ok ? "" : saved.error}`);
  const savedIntro = saved.value.segments.flatMap((segment) => parseStoredSegmentCommands(segment.command));
  for (const answer of expectedAnswers[id]!) assert(!primitiveIds(savedIntro).includes(answer), `${id}: server save never republishes an answer into trusted intro ink`);
  const { diagram } = captured(id);
  const answers = expectedAnswers[id]!;
  const replay = buildReplayTimeline([turn]);
  const player = buildLecturePlayerTimeline([turn]);
  assert.deepEqual(player.cues.map((cue) => cue.commands), replay.cues.map((cue) => cue.commands), "finished player and fallback replay project the same old intro");
  for (const cue of replay.cues) for (const answer of answers) assert(!primitiveIds(cue.commands).includes(answer), `${id}: a historical trusted intro must not leak ${answer}`);
  const originalWork = turn.segments.flatMap((segment) => storedCodeLessonSegmentCommands({ status: turn.status }, segment)).filter((command) => command.type === "WRITE");
  assert.deepEqual(replay.cues.flatMap((cue) => cue.commands).filter((command) => command.type === "WRITE"), originalWork, "historical projection preserves exact WRITE rows and offsets");
  assert.deepEqual(turn, original, "runtime projection never rewrites persisted rows, audio or timings");
  const emitted: DrawCommand[] = [];
  let clock = 0;
  await drawReplayDiagramTimeline({
    cues: replay.cues, getTurn: () => turn, getDiagram: () => diagram,
    executeCommand: async (command) => {
      if (answers.includes(command.semanticRef?.primitiveId ?? "")) assert(clock >= replay.totalMs, "actual replay/export completion must follow the final speech cue");
      emitted.push(command);
    },
    getClockMs: () => clock, waitForAdvance: async () => { clock += 50; }, shouldCancel: () => false,
  });
  for (const answer of answers) assert.equal(primitiveIds(emitted).filter((id) => id === answer).length, status === "complete" ? 1 : 0, `${id}/${status}: answer completion is exact once and status-owned`);
  if (status === "complete") for (const answer of answers) assert.deepEqual(emitted.find((command) => command.semanticRef?.primitiveId === answer), verifiedDiagramCommandToDrawCommand(diagram.commands.find((command) => command.semanticRef?.primitiveId === answer)!));
}

function labelAndLeaderOwnership() {
  const { document, diagram } = captured("L11");
  const compiled = compileSceneDocument(document); assert(compiled.ok && compiled.renderScene);
  const labels = compiled.renderScene.primitives.filter((primitive) => primitive.kind === "label" && primitive.entityId === "battery");
  assert.equal(labels.length, 2, "the same battery has a setup voltage and solved current label");
  const leaders = labels.map((label, index) => ({ id: `${label.id}_leader`, entityId: "battery", groupId: label.groupId,
    kind: "line" as const, points: [{ x: 700, y: 200 + index * 40 }, { x: 730, y: 215 + index * 40 }],
    provenance: { labelLeader: true, strokeRole: "construction" } }));
  // A renderer fixture isolates labels that narration has not named yet. It
  // retains the exact compiler label IDs and leader ownership convention.
  const presentation = buildVerifiedDiagramPresentation(document, { ...compiled.renderScene, primitives: [...labels, ...leaders] });
  const batches = presentation.diagram.deferredAnnotations!.filter((entry) => entry.entityId === "battery");
  assert.equal(batches.length, 2, "one host must retain separate setup and answer release policies");
  const answer = batches.find((entry) => entry.revealAfter === "teaching_complete")!;
  assert.deepEqual(primitiveIds(answer.commands), ["a4", "a4_leader"], "only the exact answer leader follows its result label");
  const setup = takeDeferredAnnotations(presentation.diagram, { entityIds: ["battery"] });
  assert.deepEqual(primitiveIds(setup), ["primitive_battery_label", "primitive_battery_label_leader"], "the given label and its own leader remain gesture-revealable");
  const final = remainingDeferredAnnotations(presentation.diagram);
  assert.deepEqual(primitiveIds(final), ["a4", "a4_leader"]);
  assert.deepEqual(final.find((command) => command.semanticRef?.primitiveId === "a4")?.params,
    diagram.commands.find((command) => command.semanticRef?.primitiveId === "a4")?.params, "withholding does not relayout verified text");
  const { document: motion } = captured("L01");
  const dimension: DrawCommand = { type: "DIMENSION", params: [600, 200, 700, 200, 0], text: "s = 25 m", semanticRef: { entityId: "area", primitiveId: "distanceResult" }, charPosition: 0, narrationBefore: "" };
  const witness: DrawCommand = { ...dimension, type: "DRAW_LINE", text: undefined, params: [600, 195, 600, 205] };
  const geometry: DrawCommand = { ...witness, semanticRef: { entityId: "area", primitiveId: "area_outline" } };
  const annotationPiece: DrawCommand = { ...witness, semanticRef: { entityId: "speedResult", primitiveId: "speedResult_0" } };
  const oldDimension = { command: serializeSegmentCommands([dimension, witness, geometry, annotationPiece], { trustedDiagramGeometry: true }), durationMs: 100 };
  const projected = storedCodeLessonSegmentCommands({ status: "complete", sceneDocument: motion }, oldDimension);
  assert.deepEqual(projected, [geometry], "historical projection withholds every exact answer-dimension primitive and annotation-owned piece, preserving other host geometry");
  const motionCompiled = compileSceneDocument(motion); assert(motionCompiled.ok && motionCompiled.renderScene);
  const dimensionScene = { ...motionCompiled.renderScene, primitives: [{ id: "distanceResult", entityId: "area", groupId: motion.revealGroups[0]!.id, kind: "dimension" as const, text: "s = 25 m", points: [{ x: 600, y: 200 }, { x: 700, y: 200 }] },
    { id: "speedResult_0", entityId: "speedResult", groupId: motion.revealGroups[0]!.id, kind: "line" as const, points: [{ x: 600, y: 195 }, { x: 600, y: 205 }], provenance: { annotationId: "speedResult" } }] };
  const heldDimension = buildVerifiedDiagramPresentation(motion, dimensionScene);
  assert(heldDimension.introSegments.every((segment) => getSegmentCommands(segment).length === 0), "all compiled pieces of an answer annotation stay out of the opening");
  assert(heldDimension.diagram.deferredAnnotations!.flatMap((entry) => entry.commands).some((command) => command.type === "DIMENSION"), "withholding retains the exact dimension, not just its text");
  const code = buildVerifiedDiagramPresentation(document, compiled.renderScene, { layout: "code_lesson" });
  assert(!code.diagram.deferredAnnotations!.some((entry) => entry.revealAfter), "DSA worked-example values retain existing reveal ownership");
  const symbolic: SceneDocument = { ...document, quantities: [
    { id: "arbitrary_result", symbol: "ζ₂", value: 10, provenance: "derived" },
    { id: "given", symbol: "G", value: 10, provenance: "given" },
  ], annotations: [] };
  assert(isAnswerLabel(symbolic, { text: "ζ_2 = a + b" }), "a renamed assigned symbol uses provenance, not question IDs or scalar matches");
  assert(!isAnswerLabel(symbolic, { text: "G = 10" }), "an equal-valued given is still setup");
  assert(!isAnswerLabel(symbolic, { text: "ζ₂" }), "a bare unknown symbol is not a solved result");
}

async function consumedAnnotationControl() {
  const base = captured("L11");
  const combinedId = "primitive_battery_label";
  const compile = (document: SceneDocument) => {
    const compiled = compileSceneDocument(document);
    assert(compiled.ok && compiled.renderScene, `consumed annotation variant must compile honestly: ${JSON.stringify(compiled.report.issues)}`);
    return { document, renderScene: compiled.renderScene, ...buildVerifiedDiagramPresentation(document, compiled.renderScene) };
  };
  for (const leader of [false, true]) {
    const document = structuredClone(base.document);
    document.annotations.find((annotation) => annotation.id === "a4")!.kind = "label";
    if (leader) document.entities.find((entity) => entity.id === "battery")!.provenance = { requireLabelLeader: true, leaderGeometrySafe: true };
    const shown = compile(document);
    const composite = shown.renderScene.primitives.find((primitive) => primitive.id === combinedId)!;
    assert.equal(composite.text, "V I_total = 3 A", "actual compiler consumes the current annotation into the voltage designator");
    assert.equal(composite.provenance?.annotationId, "a4", "the compiled label preserves exactly its consumed annotation owner");
    const answerIds = leader ? [combinedId, `${combinedId}_leader`] : [combinedId];
    if (leader) assert.equal(shown.renderScene.primitives.find((primitive) => primitive.id === answerIds[1])?.provenance?.annotationId, "a4", "the actual compiled leader retains the same consumed owner");
    for (const id of answerIds) {
      assert(!primitiveIds(shown.introSegments.flatMap(getSegmentCommands)).includes(id), "the consumed derived annotation must override the host's given quantity reveal timing");
      assert(shown.diagram.deferredAnnotations!.some((batch) => batch.revealAfter === "teaching_complete" && primitiveIds(batch.commands).includes(id)), "the complete combined label and its leader remain held");
    }
    assert(!shown.renderScene.primitives.some((primitive) => primitive.id === "a4"), "a consumed annotation must not be duplicated as standalone ink");
    // Drop only the new metadata to exercise recordings made before this fix.
    const legacyScene = structuredClone(shown.renderScene);
    for (const primitive of legacyScene.primitives) if (primitive.id === combinedId || primitive.id === `${combinedId}_leader`) delete primitive.provenance?.annotationId;
    const legacy = buildVerifiedDiagramPresentation(document, legacyScene);
    for (const id of answerIds) assert(!primitiveIds(legacy.introSegments.flatMap(getSegmentCommands)).includes(id), "old compiled IDs without provenance obey the same completion policy");
    const commands = shown.diagram.commands.map((command) => verifiedDiagramCommandToDrawCommand(command));
    const turn = stored("L11"); turn.sceneDocument = document;
    turn.segments = [{ ...turn.segments[0]!, durationMs: 100, command: serializeSegmentCommands(commands, { trustedDiagramGeometry: true }) }];
    const original = structuredClone(turn);
    const cues = buildReplayTimeline([turn]);
    assert.deepEqual(cues.cues.flatMap((cue) => cue.commands), commands.filter((command) => !answerIds.includes(command.semanticRef?.primitiveId ?? "")), "historical projection removes only the actual composite and its exact leader, keeping givens and geometry");
    assert.deepEqual(buildLecturePlayerTimeline([turn]).cues.map((cue) => cue.commands), cues.cues.map((cue) => cue.commands), "finished player uses the identical historical combined-label projection");
    let clock = 0;
    const emitted: DrawCommand[] = [];
    await drawReplayDiagramTimeline({ cues: cues.cues, getTurn: () => turn, getDiagram: () => shown.diagram,
      executeCommand: async (command) => { if (answerIds.includes(command.semanticRef?.primitiveId ?? "")) assert(clock >= cues.totalMs); emitted.push(command); },
      getClockMs: () => clock, waitForAdvance: async () => { clock += 50; }, shouldCancel: () => false });
    for (const id of answerIds) assert.deepEqual(emitted.filter((command) => command.semanticRef?.primitiveId === id), commands.filter((command) => command.semanticRef?.primitiveId === id), "completed replay/export restores exact original label text, points and leader once");
    assert.deepEqual(turn, original, "historical ownership projection leaves saved commands, timings and audio intact");
    for (const mode of ["seek", "scheduled", "annotate", "group"] as const) await gestureProtection(mode, { ...base, ...compile(document) }, combinedId);
  }
  // Compiler selection wins in both directions and uses only the first label.
  for (const mode of ["given", "second", "long", "callout", "unbound", "placeholder"] as const) {
    const document = structuredClone(base.document);
    const annotation = document.annotations.find((entry) => entry.id === "a4")!;
    annotation.kind = "label";
    if (mode === "unbound" || mode === "placeholder") {
      delete annotation.quantityId;
      if (mode === "placeholder") annotation.text = "I_total = ? A";
    } else if (mode === "callout") annotation.kind = "callout";
    else {
      document.entities.find((entity) => entity.id === "battery")!.label = "I";
      document.quantities.find((quantity) => quantity.id === "i")!.symbol = "I";
      if (mode === "second") document.annotations.unshift({ id: "first-given", kind: "label", targetIds: ["battery"], quantityId: "v", text: "6 V" });
      else { annotation.quantityId = "v"; annotation.text = mode === "long" ? "V =           6 V" : "6 V"; }
    }
    const shown = compile(document);
    const composite = shown.renderScene.primitives.find((primitive) => primitive.id === combinedId)!;
    const held = mode === "unbound";
    assert.equal(primitiveIds(shown.introSegments.flatMap(getSegmentCommands)).includes(combinedId), !held, `${mode}: selected annotation provenance controls setup versus completion`);
    const expected = mode === "long" ? "I" : mode === "callout" ? "V 6 V" : mode === "unbound" ? "V I_total = 3 A" : mode === "placeholder" ? "V I_total = ? A" : "I 6 V";
    assert.equal(composite.text, expected, `${mode}: timing never changes the compiler's chosen label text`);
    assert.equal(composite.provenance?.annotationId, mode === "long" || mode === "callout" ? undefined : mode === "second" ? "first-given" : "a4");
    const commands = shown.diagram.commands.map((command) => verifiedDiagramCommandToDrawCommand(command));
    const old = { command: serializeSegmentCommands(commands, { trustedDiagramGeometry: true }), durationMs: 100 };
    const projected = storedCodeLessonSegmentCommands({ status: "complete", sceneDocument: document }, old);
    assert.equal(primitiveIds(projected).includes(combinedId), !held, `${mode}: historical projection must not synthesize an unconsumed quantity fallback`);
    if (mode === "second") assert(!primitiveIds(projected).includes("a4"), "a later derived annotation remains separately held without replacing the first given owner");
    if (mode === "callout") assert(!primitiveIds(projected).includes("a4"), "callout results remain separate from the component's given value");
  }
}

function compiledOwnerControls() {
  const { document } = captured("L11");
  const current = structuredClone(document);
  current.entities.find((entity) => entity.id === "battery")!.label = "I";
  current.quantities.find((quantity) => quantity.id === "i")!.symbol = "I";
  current.annotations = current.annotations.filter((annotation) => annotation.id !== "a4");
  const result = compileSceneDocument(current); assert(result.ok && result.renderScene, "renamed current component must compile through existing authority");
  const composite = result.renderScene.primitives.find((primitive) => primitive.id === "primitive_battery_label");
  assert.equal(composite?.text, "I 3 A", "actual compiler must generate the owned component value");
  const presentation = buildVerifiedDiagramPresentation(current, result.renderScene);
  assert(!primitiveIds(presentation.introSegments.flatMap(getSegmentCommands)).includes("primitive_battery_label"), "engine-generated derived component value cannot be pulled into setup");
  const old = { command: serializeSegmentCommands([verifiedDiagramCommandToDrawCommand(presentation.diagram.commands.find((command) => command.semanticRef?.primitiveId === "primitive_battery_label")!)], { trustedDiagramGeometry: true }), durationMs: 100 };
  assert.equal(storedCodeLessonSegmentCommands({ status: "complete", sceneDocument: current }, old).length, 0, "historical generated component value follows the same release policy");
  assert(!isAnswerLabel(current, { id: "primitive_battery_label", entityId: "battery", text: "I" }), "bare component designator is setup");
  const dimension: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "computed exact span" }, source: { question: "A computed rod length is 2 m." },
    quantities: [{ id: "d", symbol: "D", value: 2, unit: "m", provenance: "derived" }],
    entities: [{ id: "a", kind: "point", role: "endpoint" }, { id: "b", kind: "point", role: "endpoint" }, { id: "rod", kind: "segment", role: "rod" }, { id: "measure", kind: "dimension", role: "length", label: "D = 2 m" }],
    constructions: [{ id: "a0", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] }, { id: "b0", operator: "point", inputs: { x: 2, y: 0 }, outputs: ["b"] }, { id: "rod0", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["rod"] }, { id: "measure0", operator: "dimension", inputs: { start: "a", end: "b" }, outputs: ["measure"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["rod", "measure"], revealGroups: [{ id: "setup", entityIds: ["a", "b", "rod", "measure"], dependsOn: [], narrationCue: "Here is the rod and length." }], teachingTimeline: [],
  };
  const measured = compileSceneDocument(dimension); assert(measured.ok && measured.renderScene, JSON.stringify(measured.report.issues));
  const witnesses = measured.renderScene.primitives.filter((primitive) => primitive.provenance?.measurementRole === "witness");
  assert.equal(witnesses.length, 2, "actual dimension compiler must exercise separate witness primitive IDs");
  const shown = buildVerifiedDiagramPresentation(dimension, measured.renderScene);
  const introIds = primitiveIds(shown.introSegments.flatMap(getSegmentCommands));
  assert(!introIds.includes("primitive_measure"));
  for (const witness of witnesses) assert(!introIds.includes(witness.id), "derived dimension witnesses must wait with the computed measurement");
  const historical = { command: serializeSegmentCommands(shown.diagram.commands.map((command) => verifiedDiagramCommandToDrawCommand(command)), { trustedDiagramGeometry: true }), durationMs: 100 };
  const projected = storedCodeLessonSegmentCommands({ status: "complete", sceneDocument: dimension }, historical);
  assert(projected.some((command) => command.semanticRef?.entityId === "rod"), "base geometry remains in the historical setup");
  assert(!projected.some((command) => command.type === "DIMENSION" || command.visualStyle?.measurementRole === "witness"), "historical measurement bar and both separately-owned witnesses wait together");
}

async function interruptedCompletion() {
  for (const failure of ["cancel", "throw"] as const) {
    const { diagram } = captured("L01");
    let cancelled = false, first = true;
    const drawn: string[] = [];
    const execute = async (command: DrawCommand) => {
      if (!expectedAnswers.L01!.includes(command.semanticRef?.primitiveId ?? "")) return;
      if (first) {
        first = false;
        if (failure === "throw") throw new Error("test interrupted result ink");
        cancelled = true; return;
      }
      drawn.push(command.semanticRef!.primitiveId!);
    };
    const run = () => completeStoredTurnDiagram({ turn: stored("L01"), diagram, executeCommand: execute, shouldCancel: () => cancelled });
    if (failure === "throw") await assert.rejects(run(), /test interrupted result ink/);
    else await run();
    assert.equal(drawn.length, 0, "the interrupted result has not completed ink");
    assert.equal(diagram.deferredAnnotations!.filter((entry) => entry.revealAfter).flatMap((entry) => entry.commands).length, 2, "replay cancellation or rejection preserves both in-flight result and suffix");
    cancelled = false; await run();
    assert.deepEqual(drawn.sort(), [...expectedAnswers.L01!].sort(), "same-diagram recovery retires only successfully completed result ink");
  }
}

async function main() {
  labelAndLeaderOwnership();
  compiledOwnerControls();
  await consumedAnnotationControl();
  await interruptedCompletion();
  for (const mode of ["seek", "scheduled", "annotate", "group"] as const) await gestureProtection(mode);
  for (const mode of ["complete", "superseded", "doubt", "during-first", "during-second"] as const) await liveCompletion(mode);
  for (const id of ["L01", "L11"]) for (const status of ["complete", "stopped"] as const) await historicalReplay(id, status);
  const { document } = captured("L01");
  for (const [text, held] of [["v", false], ["v = ?", false], ["v = ? m/s", false], ["a = ? m/s²", false], ["u = 0 m/s", false], ["v = u + a t", true], ["25 m", false], ["arbitrary prose about 25 m", false]] as const) assert.equal(isAnswerLabel(document, { text }), held, `bounded symbol/formula classification: ${text}`);
  const boundPlaceholder = { ...document, annotations: [...document.annotations, { id: "unknown-speed", kind: "label", targetIds: ["finalState"], quantityId: "v", text: "v = ? m/s" }] };
  assert(!isAnswerLabel(boundPlaceholder, { id: "unknown-speed", text: "v = ? m/s" }), "binding an unknown placeholder to a derived quantity does not turn it into the solved value");
  const { diagram } = captured("L11");
  const answers = diagram.deferredAnnotations!.filter((entry) => entry.revealAfter === "teaching_complete");
  takeDeferredAnnotations(diagram, { entityIds: ["battery", "a4"] });
  assert(answers.every((entry) => diagram.deferredAnnotations!.includes(entry)), "direct public release cannot bypass completion-only policy");
  let cancelled = true;
  const commands: DrawCommand[] = [];
  await completeStoredTurnDiagram({ turn: stored("L11"), diagram, executeCommand: async (command) => { commands.push(command); }, shouldCancel: () => cancelled });
  assert.equal(commands.length, 0, "cancelled completion emits no result");
  cancelled = false;
  const remaining = remainingDeferredAnnotations(diagram);
  assert(remaining.some((command) => command.semanticRef?.primitiveId === "a4"), "only final release returns the solved answer");
  console.log("answer-label completion: actual FOCUS/ANNOTATE, live terminal ownership, historical replay/player/export and final fidelity pass");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
