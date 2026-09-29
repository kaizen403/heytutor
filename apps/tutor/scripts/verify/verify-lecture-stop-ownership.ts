import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { SpeechSynthesisTTSClient } from "../../../../packages/tutor-core/src/tts/speechClient";
import { haltAllLectureAudio } from "../../../../packages/tutor-core/src/tts/audioContext";

type Voice = { onstart?: () => void; onend?: () => void; text: string };
let active: Voice | null = null;
let cancellations = 0;
const speech = {
  getVoices: () => [],
  resume() {},
  pause() {},
  cancel() { cancellations++; active = null; },
  speak(voice: Voice) { active = voice; },
};
const browser = { speechSynthesis: speech };
Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
  configurable: true,
  value: class { onstart = null; onend = null; onerror = null; volume = 1; rate = 1; pitch = 1; constructor(readonly text: string) {} },
});

// Execute the actual useTurnControl hook with inert render hooks. All of its
// imports except useSegmentRunner are irrelevant until an actual turn starts.
const source = readFileSync(new URL("../../features/tutor-session/hooks/turn/useTurnControl.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: Record<string, unknown> = {};
const fallbackClients: SpeechSynthesisTTSClient[] = [];
runInNewContext(js, {
  exports,
  window: browser,
  require(id: string) {
    if (id === "react") return {
      useCallback: (fn: unknown) => fn,
      useRef: (current: unknown) => ({ current }),
      useState: (value: unknown) => [value, () => {}],
      useEffect: () => {},
    };
    if (id === "@/lib/replay/replayAudio") return { stopReplayAudio() {} };
    if (id === "../../lib/board/spotlight") return { clearSpotlight() {} };
    if (id === "@heytutor/tutor-core") return { tutorDebug() {} };
    if (id === "./useSegmentRunner") return {
      useSegmentRunner: () => {
        const fallback = new SpeechSynthesisTTSClient();
        fallbackClients.push(fallback);
        return {
          runSegment() {}, pauseFallbackSpeech: () => fallback.pause(),
          resumeFallbackSpeech: () => fallback.resume(),
          stopFallbackSpeech: () => fallback.stop(), speakingNarrationRef: { current: "" },
        };
      },
    };
    return {};
  },
});
const useTurnControl = exports.useTurnControl as (params: Record<string, unknown>, handleQuestionRef: unknown) => {
  stopTurn: () => void;
};
assert.equal(typeof useTurnControl, "function", "load the real turn hook");
function mountShell(phase: "idle" | "speaking") {
  const tts = new SpeechSynthesisTTSClient();
  const ref = (current: unknown) => ({ current });
  // This hook runs inside a VM with inert render hooks, not a React render.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const control = useTurnControl({
    sessionId: "lecture", phase, isReplaying: false,
    ttsClientRef: ref(tts), stopTurnRef: ref(null),
    cancelRef: ref(false), turnActiveRef: ref(phase !== "idle"), turnGenerationRef: ref(0),
    pendingSegmentCountRef: ref(0), turnAbortRef: ref(null),
    whiteboardRef: ref(null), segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()),
    replayAudioRef: ref(null), replayCueRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    replayGenerationRef: ref(0), boardShowsStoppedReplayRef: ref(false), boardPageRef: ref(null),
    collectedSegmentsRef: ref([]), turnTelemetryRef: ref(null), isPausedRef: ref(false), phaseRef: ref(phase),
    clearCancelTimers() {}, setIsPaused() {}, setPhase() {}, setCurrentSegmentText() {},
    setInputInteracted() {}, setIsReplaying() {}, setReplayProgressMs() {}, setReplayTotalMs() {},
  }, ref(async () => {}));
  return { tts, control, fallback: fallbackClients.at(-1)! };
}

async function main() {
  const owner = mountShell("speaking");
  const idle = mountShell("idle");
  const speaking = owner.fallback.speakSegment("A lecture still speaking in another shell.");
  const voice = active;
  assert(voice, "owner fallback must start");
  voice.onstart?.();
  const before = cancellations;
  idle.control.stopTurn(); // The same idle Stop callback exposed by useTurnControl.
  assert.equal(cancellations, before, "idle shell Stop must not cancel another shell's browser voice");
  assert.equal(active, voice, "another shell's current utterance must survive Stop");
  voice.onend?.();
  await speaking;

  const ownSpeech = owner.fallback.speakSegment("This shell owns the current voice.");
  assert(active, "owner fallback must start again");
  owner.control.stopTurn();
  assert.equal(active, null, "stopping the owner must silence its own fallback");
  await ownSpeech;

  const pageVoice = idle.fallback.speakSegment("Page is closing.");
  assert(active, "pagehide still has an active utterance to halt");
  haltAllLectureAudio(); // Invoked by useLecturePageHalt on pagehide/beforeunload.
  assert.equal(active, null, "pagehide must retain window-global speech cancellation");
  idle.fallback.stop();
  await pageVoice;
  console.log("verify-lecture-stop-ownership: idle Stop preserves foreign fallback, owner Stop and pagehide silence it");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
