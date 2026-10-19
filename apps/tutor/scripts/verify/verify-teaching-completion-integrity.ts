/** The real segment queue must persist terminal teaching failures before Stop closes it. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import { buildLessonSegments, type TutorSegment, type VerifiedDiagram } from "@heytutor/drawing";
import type { UseTurnLifecycleParams } from "../../features/tutor-session/hooks/turn/types";
import type { BoardPageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";
import { classifyTurnFailure } from "../../lib/obs/turnFailureClassification";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const controlPath = path.join(app, "features/tutor-session/hooks/turn/useTurnControl.ts");
const ref = <T,>(current: T) => ({ current });
const noop = () => {};

function page(boardId = "offline-segment-board"): BoardPageRecord {
  return {
    boardId, lessonQuestion: "PRIVATE_SYNTHETIC_QUESTION", turnPlan: null, solverProjection: null,
    figureDrawn: true, failureTelemetry: { subject: "physics", requestCount: 2 },
    turn: { kind: "lesson", question: "PRIVATE_SYNTHETIC_QUESTION", continuesBoard: false, saved: false,
      scene: { sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "validated",
        sceneArtifacts: { turnPlan: { visualRequirement: "required" } } } },
  };
}

function mount(runSegment: (segment: TutorSegment, index: number) => Promise<void>) {
  const drawn: unknown[] = [];
  const errors: unknown[] = [], receipts: Array<NonNullable<ReturnType<LiveTurnSaveRegistry["liveTurnFor"]>>> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const registry = new LiveTurnSaveRegistry({
    // The save registry is real; the network boundary cannot reach any service.
    transport: { checkpoint: () => new Promise(() => {}), close: () => new Promise(() => {}) },
    setTimer: (callback) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimer: (id) => { timers.delete(id as number); },
    now: () => 1_000, isOnline: () => false, mintId: () => "offline-segment-turn",
  });
  const params = {
    sessionId: "offline-segment-board", phase: "speaking", isReplaying: false, boardLoaded: false, enableKeyboardControls: false,
    boardLayoutRef: ref({ rects: [], nextY: 142 }), boardPageRef: ref<BoardPageRecord | null>(page()),
    whiteboardRef: ref(null), boardShowsStoppedReplayRef: ref(false), pendingQuestionRef: ref(null), autoSubmitDoneRef: ref(null),
    phaseRef: ref("speaking"), isPausedRef: ref(false), rewoundRef: ref(false), conversationHistoryRef: ref([]),
    liveQuestionRef: ref("PRIVATE_SYNTHETIC_QUESTION"), ttsClientRef: ref(null), ensureTTSClient: () => ({ prefetchSegment: noop }),
    currentTraceIdRef: ref(null), replayAudioRef: ref(null), replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    cancelRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1), turnAbortRef: ref(null),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()), collectedSegmentsRef: ref<TutorSegment[]>([]),
    recordedSegmentsRef: ref([]), narrationSinceEpochRef: ref(""), activeVerifiedDiagramRef: ref<VerifiedDiagram | null>(null), codeLessonControllerRef: ref(null),
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false), setActiveVerifiedDiagram: noop, segmentPlanStatsRef: ref({}),
    stopTurnRef: ref<(() => void) | null>(null), replayGenerationRef: ref(0), replayCueRef: ref(null), turnTelemetryRef: ref(null),
    setPhase: noop, setIsPaused: noop, setNarrationText: noop, setCurrentSegmentText: noop, setInputInteracted: noop,
    setLastError: (error: unknown) => errors.push(error), onError: () => captureStoppedReceipt(), setIsReplaying: noop,
    setReplayProgressMs: noop, setReplayTotalMs: noop, clearCancelTimers: noop, pendingSegmentCountRef: ref(0), executeCommandWithCancel: async (command: unknown) => { drawn.push(command); },
  };
  const captureStoppedReceipt = () => {
    registry.closeOwner(params.cancelRef);
    const receipt = registry.liveTurnFor(params.cancelRef, params.sessionId);
    assert(receipt, "the real save registry retains the already-taught lesson");
    receipts.push(structuredClone(receipt));
  };
  registry.begin({ owner: params.cancelRef, generation: 1, boardId: params.sessionId, traceId: null,
    kind: "lesson", question: "PRIVATE_SYNTHETIC_QUESTION", preview: "PRIVATE_SYNTHETIC_QUESTION",
    speedMultiplier: 1, continuesBoard: false, page: params.boardPageRef.current });
  registry.recordRow(params.cancelRef, 1, { orderIndex: 0, narration: "Previously taught step.", spokenText: "Previously taught step.",
    command: null, audioBytes: null, durationMs: null, timings: null }, { intro: false });
  params.stopTurnRef.current = () => { captureStoppedReceipt(); params.turnGenerationRef.current++; };
  const compiled = ts.transpileModule(readFileSync(process.env.TEACHING_SEGMENT_CONTROL_SOURCE ?? controlPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return { useRef: ref, useCallback: <T,>(fn: T) => fn, useEffect: noop,
      useState: (value: unknown) => [value, noop] };
    if (specifier === "@heytutor/tutor-core") return { ...core, tutorDebug: noop };
    if (specifier.endsWith("/liveTurnSave")) return { liveTurnSave: () => registry };
    if (specifier === "./useSegmentRunner") return { useSegmentRunner: () => ({ runSegment: async (segment: TutorSegment, index: number) => {
      await runSegment(segment, index);
      if (!params.cancelRef.current) registry.recordRow(params.cancelRef, params.turnGenerationRef.current, { orderIndex: index + 1, narration: segment.narration, spokenText: segment.narration, command: segment.command, audioBytes: null, durationMs: 100, timings: null }, { intro: false });
    },
      pauseFallbackSpeech: noop, resumeFallbackSpeech: noop, stopFallbackSpeech: noop, speakingNarrationRef: ref("") }) };
    return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(controlPath), specifier) : specifier);
  }, mod, mod.exports);
  const hooks = mod.exports as unknown as typeof import("../../features/tutor-session/hooks/turn/useTurnControl");
  const control = hooks.useTurnControl(params as unknown as UseTurnLifecycleParams, ref(async () => {}));
  return { params, control, registry, errors, receipts, drawn };
}


// Same pair counts as the two recorded incident payloads. Prose/IDs are synthetic;
// full private recorded-payload replay receipts remain in .context.
function response(count: number): string {
  return Array.from({ length: count }, (_, i) => `[STEP]Explain verified step ${i + 1}. [WRITE:x_${i + 1} = ${i + 1},90,211][/STEP]`).join("\n");
}
async function completion(count: number, failedAt: number | null, streamed: boolean, text = response(count)) {
  const segments = buildLessonSegments(text);
  assert.equal(segments.length, count);
  const h = mount(async (_segment, index) => { if (index === failedAt) throw new Error("Synthetic draw failure"); });
  h.params.activeVerifiedDiagramRef.current = { id: "synthetic", anchors: [], commands: [], deferredAnnotations: [{ entityId: "answer", commands: [{ type: "LABEL", params: [500, 300], text: "Result = 2" }] }] } as unknown as VerifiedDiagram;
  if (streamed) for (const segment of segments) h.control.enqueueSegment(segment, 1);
  await h.control.processResponseText(text, [], streamed, 1);
  if (failedAt !== null) {
    assert.equal(h.params.cancelRef.current, true, "a missed beat cannot complete when later beats succeed");
    assert.equal(h.errors.length, 1);
    const saved = h.registry.liveTurnFor(h.params.cancelRef, h.params.sessionId)!;
    assert.equal(saved.status, "stopped");
    assert.equal(classifyTurnFailure(saved).classification, "failed", "the persisted completion failure remains observable");
    assert.equal(saved.segments.length, count + 1, "only successful rows, prior intro and the runtime CLEAR are saved");
    assert.equal(h.drawn.length, 0, "incomplete teaching cannot flush a deferred answer");
    assert.equal(h.params.activeVerifiedDiagramRef.current?.deferredAnnotations?.length, 1);
  } else {
    assert.equal(h.params.cancelRef.current, false);
    assert.equal(h.errors.length, 0);
    assert.equal(h.registry.liveTurnFor(h.params.cancelRef, h.params.sessionId)!.segments.length, count + 2);
    assert.equal(h.drawn.length, 1, "healthy completion releases the answer once");
  }
}
async function main() {
  const originalError = console.error; console.error = noop;
  try {
    for (const streamed of [false, true]) {
      await completion(20, 1, streamed); await completion(18, 0, streamed);
      await completion(1, 0, streamed); await completion(20, null, streamed);
    }
    if (process.env.TEACHING_COMPLETION_PAYLOAD_FILE) {
      const recorded: Array<{ text: string; steps: number }> = JSON.parse(readFileSync(process.env.TEACHING_COMPLETION_PAYLOAD_FILE, "utf8"));
      for (const payload of recorded) for (const streamed of [false, true]) {
        const parsedCount = buildLessonSegments(payload.text).length;
        await completion(parsedCount, 1, streamed, payload.text);
        await completion(parsedCount, null, streamed, payload.text);
      }
      console.log(`Recorded private payloads: ${recorded.length}; streamed/batch missing-beat and healthy controls pass`);
    }
  } finally { console.error = originalError; }
  console.log("verify-teaching-completion-integrity: 8 real parser/queue/save/terminal groups pass; zero providers");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
