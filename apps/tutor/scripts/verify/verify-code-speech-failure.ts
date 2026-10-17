/** Lost required TYPE stops through the real queue/Stop/Continue; render/media/producer ports are controlled. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import type { SpeakSegmentOptions, TTSClient } from "@heytutor/tutor-core";
import type { TutorSegment } from "@heytutor/drawing";
import { parseStoredSegmentCommands } from "@heytutor/drawing";
import type { ExecuteCommandOptions, UseTurnLifecycleParams } from "../../features/tutor-session/hooks/turn/types";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { CodeLessonController } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import { resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { lessonPageRecord, type PausedLessonRequest } from "../../features/tutor-session/lib/turn/doubtTurn";
import { INCOMPLETE_CODE_BEAT_MESSAGE } from "../../features/tutor-session/lib/turn/turnFailurePolicy";

const app = path.resolve(import.meta.dirname,"../..");
const requireApp = createRequire(path.join(app,"package.json"));
const runnerPath = path.join(app, "features/tutor-session/hooks/turn/useSegmentRunner.ts");
const controlPath = path.join(app, "features/tutor-session/hooks/turn/useTurnControl.ts");
const policyPath=path.join(app,"features/tutor-session/lib/turn/turnFailurePolicy.ts");
const timeoutPath = path.join(app, "features/tutor-session/lib/turn/ttsSegmentTimeout.ts");
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
type Outcome = "stall" | "reject" | "success" | "pending";
type Job = { options: SpeakSegmentOptions; resolve: () => void; reject: (error: Error) => void; outcome: Outcome };

/** Controlled render/clock/media ports; real runner, ink planner, queue and save registry. */
type PlaybackFixture = { narration: string; rate: number; durationMs: number; timings?: boolean };
const question = "Solve House Robber in Python using dynamic programming. Input: nums = [2, 7, 9, 3, 1]. Adjacent houses cannot both be robbed. Explain the choice at each house and find the maximum amount.";
const codePlan = core.validateCodeLessonPlan({
  "title": "House Robber with a DP Table",
  "language": "python",
  "question": "Solve House Robber in Python using dynamic programming. Input: nums = [2, 7, 9, 3, 1]. Adjacent houses cannot both be robbed. Explain the choice at each house and find the maximum amount.",
  "sections": [
    {
      "id": "s1",
      "title": "Compare robbing and skipping",
      "blocks": [
        {
          "id": "s1b1",
          "code": "def rob(nums):\n    if not nums:\n        return 0"
        },
        {
          "id": "s1b2",
          "code": "    dp = [0] * len(nums)\n    dp[0] = nums[0]"
        },
        {
          "id": "s1b3",
          "code": "    if len(nums) == 1:\n        return dp[0]"
        },
        {
          "id": "s1b4",
          "code": "    dp[1] = max(dp[0], nums[1])\n    for i in range(2, len(nums)):\n        skip = dp[i - 1]"
        },
        {
          "id": "s1b5",
          "code": "        take = nums[i] + dp[i - 2]\n        dp[i] = max(skip, take)"
        },
        {
          "id": "s1b6",
          "code": "    return dp[-1]\n"
        },
        {
          "id": "s1b7",
          "code": "nums = [2, 7, 9, 3, 1]\nprint(rob(nums))"
        }
      ],
      "explanation": "Each dp entry records the best amount available through that house. For the first two houses, the best amounts are 2 and max(2, 7) = 7. At house 2, skipping gives 7 while robbing gives 9 + 2 = 11; at house 3, skipping keeps 11 instead of taking 3 + 7 = 10. At house 4, robbing gives 1 + 11 = 12, beating the skip value of 11, so the driver prints 12.",
      "typeAlongRanges": [
        {
          "endLine": 4,
          "startLine": 4
        },
        {
          "endLine": 11,
          "startLine": 7
        }
      ]
    }
  ],
  "diagramHint": {
    "cells": [
      [
        "2",
        "2"
      ],
      [
        "7",
        "7"
      ],
      [
        "9",
        "11"
      ],
      [
        "3",
        "11"
      ],
      [
        "1",
        "12"
      ]
    ],
    "steps": [
      {
        "id": "input",
        "cells": [
          [
            "2",
            "2"
          ],
          [
            "7",
            ""
          ],
          [
            "9",
            ""
          ],
          [
            "3",
            ""
          ],
          [
            "1",
            ""
          ]
        ]
      },
      {
        "id": "house_1",
        "cells": [
          [
            "2",
            "2"
          ],
          [
            "7",
            "7"
          ],
          [
            "9",
            ""
          ],
          [
            "3",
            ""
          ],
          [
            "1",
            ""
          ]
        ]
      },
      {
        "id": "house_2",
        "cells": [
          [
            "2",
            "2"
          ],
          [
            "7",
            "7"
          ],
          [
            "9",
            "11"
          ],
          [
            "3",
            ""
          ],
          [
            "1",
            ""
          ]
        ]
      },
      {
        "id": "house_3",
        "cells": [
          [
            "2",
            "2"
          ],
          [
            "7",
            "7"
          ],
          [
            "9",
            "11"
          ],
          [
            "3",
            "11"
          ],
          [
            "1",
            ""
          ]
        ]
      }
    ],
    "caption": "Best haul through each house",
    "colLabels": [
      "money",
      "dp"
    ],
    "rowLabels": [
      "0",
      "1",
      "2",
      "3",
      "4"
    ],
    "structure": "table"
  },
  "schemaVersion": "code-lesson/v1"
});
assert(codePlan.plan && codePlan.issues.length===0,"Synthetic D10-shape seven-block plan validates");
const frames=resolveDsaFrames(question,codePlan.plan.diagramHint,codePlan.plan)!;
assert(frames && frames.frames.length>1,"The actual scene engine compiles the House Robber trace");
type Mode="incomplete"|"joined"|"continue"|"user-stop"|"stale"|"full-target"|"partial-complete"|"partial-incomplete"|"no-type"|"explanation-only"|"unknown"|"mismatch"|"hidden"|"plan-replaced"|"controller-replaced"|"target-mutated";
const blocks=codePlan.plan.sections.flatMap(section=>section.blocks);
const executorPath=path.join(app,"features/tutor-session/hooks/useCommandExecution.ts");
function mount(position: number | null, outcomes: Outcome[] = [], deferFirstDraw = false, playback?: PlaybackFixture, mode:Mode="incomplete") {
  let now = 1_000, sequence = 0, mint = 0, browserAttempts = 0;
  const controller = new CodeLessonController(); controller.commit(codePlan.plan!); controller.frames.commit(frames);
  const timers = new Map<number, { at: number; run: () => void }>();
  const jobs: Job[] = [], drawn: string[] = [], errors: Array<{ message: string; question: string }> = [];
  const offers:unknown[]=[]; const resumes:Array<{request:PausedLessonRequest;prefix:number;plan:core.CodeLessonPlan|null}>=[]; const commandStarts:string[]=[]; let lastTypeEnded=0;
  const telemetry: Array<{ name: string; [key: string]: unknown }> = [];
  let rejectOldDraw: ((error: Error) => void) | null = null;
  const original = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const setTimer = (run: () => void, delay = 0): number => {
    const id = ++sequence; timers.set(id, { at: now + delay, run }); return id;
  };
  const clearTimer = (id: number) => { timers.delete(id); };
  replace("performance", { now: () => now });
  replace("setTimeout", setTimer); replace("clearTimeout", clearTimer);
  replace("window", { setTimeout: setTimer, clearTimeout: clearTimer });
  replace("fetch", () => { throw new Error("gate forbids network/provider dispatch"); });
  const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  const advance = async (target: number) => {
    await flush();
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].run(); await flush();
    }
    now = target; await flush();
  };
  const durationSec = playback ? playback.durationMs / 1000 : 2;
  let rate = playback?.rate ?? 1.25, mediaPosition = 0, mediaLastAt = now, mediaPaused = false;
  const sampleMedia = () => {
    if (!mediaPaused) mediaPosition += (now - mediaLastAt) * rate;
    mediaLastAt = now;
    return mediaPosition;
  };
  const tts = {
    speakSegment: (_text: string, options: SpeakSegmentOptions) => new Promise<void>((resolve, reject) => {
      if (playback) { mediaPosition = 0; mediaLastAt = now; }
      const outcome = outcomes[jobs.length] ?? "pending";
      jobs.push({ options, resolve, reject, outcome });
      const spokenNow=core.mathToSpeech(_text); const currentTimings={totalDuration:durationSec,charStartTimes:[...spokenNow].map((_,i)=>i*durationSec/spokenNow.length),charDurations:[...spokenNow].map(()=>durationSec/spokenNow.length)};
      options.onTimings?.(currentTimings);
      options.onStart?.();
      if (outcome === "success" && playback) {
        const finish = () => {
          if (sampleMedia() >= playback.durationMs) { options.onEnd?.(); resolve(); }
          else setTimer(finish, 100);
        };
        setTimer(finish, 100);
      } else if (outcome === "success") setTimer(() => { options.onEnd?.(); resolve(); }, 1_000);
      else if (outcome === "reject") setTimer(() => reject(new Error("tts skipped (tts_budget)")), 500);
    }),
    getPlaybackPositionMs: () => playback && jobs[0]?.outcome === "success" ? sampleMedia() : position, getPlaybackRate: () => rate,
    peekSegmentTimings: () => null, prefetchSegment: noop, abandonSpeaking: noop, stop: noop,
  } as unknown as TTSClient;
  const registry = new LiveTurnSaveRegistry({ transport: {
    checkpoint: async () => { throw new Error("gate forbids persistence transport"); },
    close: async () => { throw new Error("gate forbids persistence transport"); },
  }, now: () => now, isOnline: () => false, mintId: () => `offline-${++mint}`,
  setTimer: (fn, ms) => setTimer(fn, ms), clearTimer: id => clearTimer(id as number) });
  class BrowserVoice {
    setPlaybackRate() {} stop() {} pause() {} resume() {}
    async speakSegment() { browserAttempts++; throw new Error("started primary must not start browser recovery"); }
  }
  const cache = new Map<string, Record<string, unknown>>();
  const load = (file: string): Record<string, unknown> => {
    const cached = cache.get(file); if (cached) return cached;
    const sourceFile = file === runnerPath ? process.env.CODE_SPEECH_RUNNER_SOURCE ?? file
      : file === controlPath ? process.env.CODE_SPEECH_CONTROL_SOURCE ?? file
      : file === policyPath ? process.env.CODE_SPEECH_POLICY_SOURCE ?? file
      : file === timeoutPath ? process.env.CODE_SPEECH_TIMEOUT_SOURCE ?? file : file;
    const compiled = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", compiled)((specifier: string) => {
      if (specifier === "react") return { useRef: ref, useCallback: <T,>(fn: T) => fn,
        useEffect: noop, useState: (value: unknown) => [value, (next:unknown)=>offers.push(next)] };
      if (specifier === "@heytutor/tutor-core") return { ...core, tutorDebug: noop, SpeechSynthesisTTSClient: BrowserVoice };
      if (specifier.endsWith("/liveTurnSave")) return { liveTurnSave: () => registry };
      if (specifier === "./useSegmentRunner") return load(runnerPath);
      if (specifier.endsWith("/ttsSegmentTimeout")) return load(timeoutPath);
      if (specifier.endsWith("/turnFailurePolicy")) return load(policyPath);
      return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
        : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
    }, mod, mod.exports);
    cache.set(file, mod.exports); return mod.exports;
  };
  const params = {
    sessionId: "offline-started-speech", phase: "speaking", storedTurnsRef: ref([]), isReplaying: false, boardLoaded: false, enableKeyboardControls: false,
    whiteboardRef: ref(new Proxy({getInkSettings:()=>({inkColor:"white",pencilThickness:2}),setAnimationSpeed:noop,getDrawLayer:()=>({}),setCursorState:noop,eraseRegion:async(_x:number,_y:number,_w:number,_h:number,ms:number)=>{await new Promise<void>(resolve=>setTimer(resolve,ms));},flyCursorTo:async(_x:number,_y:number,ms:number)=>{await new Promise<void>(resolve=>setTimer(resolve,ms));},cancelAnimations:noop,setPaused:noop},{get:(target,key:string)=>key in target?target[key as keyof typeof target]:()=>Promise.resolve()})), boardPageRef: ref(null), boardShowsStoppedReplayRef: ref(false),
    pendingQuestionRef: ref(null), autoSubmitDoneRef: ref(null), phaseRef: ref("speaking"),
    isPausedRef: ref(false), rewoundRef: ref(false), conversationHistoryRef: ref([]), liveQuestionRef: ref(question),
    ttsClientRef: ref(tts), ensureTTSClient: () => tts, currentTraceIdRef: ref(null),
    replayAudioRef: ref(null), replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    cancelRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1), turnAbortRef: ref(null),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()), collectedSegmentsRef: ref<TutorSegment[]>([]),
    recordedSegmentsRef: ref<UseTurnLifecycleParams["recordedSegmentsRef"]["current"]>([]), narrationSinceEpochRef: ref(""),
    activeVerifiedDiagramRef: ref(null), codeLessonControllerRef: ref(controller), fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false),
    segmentPlanStatsRef: ref({}), stopTurnRef: ref(null), replayGenerationRef: ref(0), replayCueRef: ref(null),
    turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), narrationDensityRef: ref(0),
    turnTelemetryRef: ref({ mark: (name: string, data: Record<string, unknown>) => telemetry.push({ name, ...data }),
      span: () => ({ end: noop }),meta:noop,flush:noop,durationMs:()=>now }),
    setPhase:(phase:string)=>{params.phaseRef.current=phase as "speaking";}, setIsPaused: noop, setNarrationText: noop, setCurrentSegmentText: noop, setInputInteracted: noop,
    setLastError: (error: { message: string; question: string }) => errors.push(error),
    onError: (error: { message: string; question: string }) => telemetry.push({ name: "student-error", ...error,drawEnded:lastTypeEnded,at:now }),
    setIsReplaying: noop, setReplayProgressMs: noop, setReplayTotalMs: noop, clearCancelTimers: noop,
    pendingSegmentCountRef: ref(0), boardLayoutRef: ref({ rects: [], nextY: 142 }),
    cancellableDelay: (ms: number) => new Promise<void>(resolve => setTimer(resolve, ms)),
    raceWithCancel: async <T,>(promise: Promise<T>) => promise,
    reserveTextCommandPlacements: async (command: NonNullable<TutorSegment["command"]>) => [command],
    executeCommandWithCancel: async (command: NonNullable<TutorSegment["command"]>, options: ExecuteCommandOptions) => {
      if (options.isCancelled?.()) return;
      drawn.push(command.text ?? command.type); options.onInkStarted?.();
      if (deferFirstDraw && drawn.length === 1) await new Promise<void>((_resolve, reject) => { rejectOldDraw = reject; });
    },
  };
  let resumedHandle:ReturnType<LiveTurnSaveRegistry["begin"]>|null=null;
  const begin = (continuesBoard=false) => registry.begin({ owner: params.cancelRef, generation: params.turnGenerationRef.current,
    boardId: params.sessionId, traceId: null, kind: "lesson", question, preview: question,
    speedMultiplier: 1, continuesBoard });
  const handle = begin();
  params.boardPageRef.current=lessonPageRecord(params.sessionId,question) as never;
  (params.boardPageRef.current as never as {turn:{scene:unknown}}).turn.scene={sceneDocument:null,sceneEngineVersion:null,validationReport:null,visualStatus:"text_only",sceneArtifacts:{codeLesson:codePlan.plan}};
  const commandHooks=load(executorPath) as unknown as typeof import("../../features/tutor-session/hooks/useCommandExecution");
  const executor=commandHooks.useCommandExecution({...params,speedRef:ref(1),adaptiveFactorRef:ref(1),forceSequentialWorkLayoutRef:ref(false),notesEpochsRef:ref([]),forgetErasedTextRects:noop,resetBoardLayout:noop,resolveTextPlacement:async()=>({x:0,y:0}),inkPaceRef:ref("follow"),nowMs:()=>now} as never);
  params.executeCommandWithCancel=async(command,options)=>{drawn.push(command.semanticRef?.entityId??command.type);commandStarts.push(command.type);await executor.executeCommandWithCancel(command,options);if(mode==="joined"&&command.semanticRef?.entityId==="s1b4")await new Promise<void>(resolve=>setTimer(resolve,700));lastTypeEnded=now;};
  const runnerHooks = load(runnerPath) as unknown as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner");
  const controlHooks = load(controlPath) as unknown as typeof import("../../features/tutor-session/hooks/turn/useTurnControl");
  const runner = runnerHooks.useSegmentRunner({ ...params, applyTurnPhase: noop } as unknown as Parameters<typeof runnerHooks.useSegmentRunner>[0]);
  const handleQuestion=ref(async (_question:string,options?:{resume?:PausedLessonRequest;onAdmission?:(accepted:boolean)=>void})=>{
    assert(options?.resume,"Actual Continue hands the captured resume to its producer");
    resumes.push({request:options.resume,prefix:controller.getState().revealedChars.s1b4??0,plan:controller.getActivePlan()});
    options.onAdmission?.(true);params.cancelRef.current=false;params.turnActiveRef.current=true;params.phaseRef.current="speaking";
    resumedHandle=begin(true);
    for(const block of blocks.slice(3))control.enqueueSegment(typeSegment(block),params.turnGenerationRef.current);
    await params.segmentChainRef.current;
  });
  const control = controlHooks.useTurnControl(params as unknown as UseTurnLifecycleParams, handleQuestion as never);
  params.stopTurnRef.current=control.stopTurn as never;
  return { controller, params, control, runner, handle, begin, jobs, offers,resumes,commandStarts,lastTypeEnded:()=>lastTypeEnded, resumeHandle:()=>resumedHandle, drawn, errors, telemetry, registry, flush, advance,
    now: () => now, browserAttempts: () => browserAttempts,
    setRate: (next: number) => { sampleMedia(); rate = next; },
    setPaused: (paused: boolean) => {
      sampleMedia(); mediaPaused = paused; params.isPausedRef.current = paused;
      if (paused) runner.pauseFallbackSpeech(); else runner.resumeFallbackSpeech();
    },
    rejectOldDraw: () => { assert(rejectOldDraw, "real old draw entered its asynchronous port"); rejectOldDraw(new Error("obsolete asynchronous ink failed")); },
    close: () => { for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    } },
  };
}



function typeSegment(block:core.CodeLessonPlan["sections"][number]["blocks"][number], shownChars?:number):TutorSegment{
 return {narration:"Explain the admitted code block.",command:{type:"TYPE",params:[],text:block.code,charPosition:0,narrationBefore:"",semanticRef:{entityId:block.id},...(shownChars===undefined?{}:{shownChars})}};
}
async function run(mode:Mode){
 const blocked=["incomplete","joined","continue","partial-incomplete","target-mutated"].includes(mode);
 const h=mount(0,["success","success","success","pending","success","success","success","success"],false,{narration:"Explain the admitted code block.",rate:1,durationMs:8560},mode);
 let failed=false,failedAt=0;
 try{
  const first=blocks.slice(0,3).map(block=>typeSegment(block));
  const target=typeSegment(blocks[3]!,mode==="partial-complete"?7:(mode==="partial-incomplete"||mode==="target-mutated")?12:undefined);
  if(mode==="unknown")target.command!.semanticRef={entityId:"unknown-block"};
  if(mode==="mismatch")target.command!.text="different admitted text";
  if(mode==="no-type")target.command=null;
  if(mode==="explanation-only")target.command={type:"WRITE",params:[],text:"Compare robbing and skipping.",charPosition:0,narrationBefore:""};
  const rows=[...first,target,{narration:"Walk the next verified decision.",command:{type:"FRAME",params:[],charPosition:0,narrationBefore:""}} as TutorSegment,...blocks.slice(4).map(block=>typeSegment(block))];
  const fail=()=>{
   if(failed)return;failed=true;failedAt=h.now();
   if(mode==="user-stop")h.control.stopTurn();
   if(mode==="stale")h.control.stopTurn({supersede:true});
   if(mode==="target-mutated")h.params.collectedSegmentsRef.current[3]!.command!.shownChars=7;
   if(mode==="hidden")h.controller.commit(codePlan.plan!);
   if(mode==="plan-replaced"){h.controller.commit(structuredClone(codePlan.plan!));h.controller.revealPanel();}
   if(mode==="controller-replaced"){const replacement=new CodeLessonController();replacement.commit(codePlan.plan!);replacement.revealPanel();h.params.codeLessonControllerRef.current=replacement;}
   h.jobs.at(-1)!.reject(new Error("tts skipped (tts_budget)"));
  };
  const threshold=mode==="full-target"?blocks[3]!.code.length:7;
  const un=h.controller.subscribe(()=>{if((h.controller.getState().revealedChars.s1b4??0)>=threshold)fail();});
  for(const row of rows)h.control.enqueueSegment(row,1);
  if(mode==="unknown"||mode==="no-type"||mode==="explanation-only"){
   await h.advance(h.now()+3*8560+1000);assert.equal(h.jobs.length,4,"The failed unknown/nonTYPE sentence is the current owner");fail();
  }
  await h.advance(h.now()+120000);await h.params.segmentChainRef.current;un();
  assert(failed,"Actual current speech promise failed after its admitted TYPE/voice started");
  const state=h.controller.getState();
  if(blocked){
   assert.equal(h.params.cancelRef.current,true,"Incomplete current TYPE must stop rather than let later code masquerade as complete");
   assert.equal(h.jobs.length,4,"No later frame/voice/TYPE may start past the stopped current target");
   assert.equal(state.mode,"lesson","The partial code panel remains a lesson rather than complete/type-along");
   assert.equal(state.revealedChars.s1b4,7,"Stop retains exactly the actual seven-character prefix");
   assert.equal(state.revealedChars.s1b5??0,0,"No future code is filled");
   assert.equal(h.controller.frames.currentIndex(),0,"No unseen next verified frame is exposed");
   assert(!h.commandStarts.includes("FRAME"),"Later queued frame never enters its executor");
   assert.deepEqual(h.errors,[{message:INCOMPLETE_CODE_BEAT_MESSAGE,question}],"Exactly one clear student error without a durable-save claim");
   assert.equal(h.telemetry.filter(e=>e.name==="student-error").length,1);
   const failure=h.telemetry.find(e=>e.name==="code-beat-incomplete");
   assert.equal(failure?.block_id,"s1b4");assert.equal(failure?.shown_chars,7);
   assert.equal(failure?.intended_chars,mode==="partial-incomplete"||mode==="target-mutated"?12:blocks[3]!.code.length);
   assert.equal(failure?.cause,"tts skipped (tts_budget)","Original owned speech failure is retained without inventing a quota cause");
   assert(h.offers.some(value=>typeof value==="object"&&value!==null&&(value as {reason?:string}).reason==="stop"),"Actual Stop offers Continue");
   const stored=h.handle.submittedRows().flatMap(row=>parseStoredSegmentCommands(row.command));
   const kept=stored.find(command=>command.type==="TYPE"&&command.semanticRef?.entityId==="s1b4");
   assert.equal(kept?.shownChars,7,"Actual prepared-save/Stop capture preserves its executed prefix receipt");
   assert(!stored.some(command=>command.semanticRef?.entityId==="s1b5"),"No unseen command enters the captured Stop receipt");
   const stopped=h.registry.liveTurnFor(h.params.cancelRef,h.params.sessionId);
   assert.equal(stopped?.status,"stopped","The actual local save registry closes this turn as stopped, with no durable ACK claim");
   assert.equal(stopped?.sceneDocument,null,"Planned but unexecuted geometry never enters the stopped scene receipt");
   if(mode==="joined")assert(h.telemetry.some(e=>e.name==="student-error"&&Number(e.drawEnded)>=failedAt+700),"The current draw cleanup is joined before Stop/error publication");
   if(mode==="continue"){
    h.control.flushPausedLesson();await h.flush();
    assert.equal(h.resumes.length,1,"One actual Continue callback resumes the captured lesson");
    const resumed=h.resumes[0]!;assert.equal(resumed.prefix,7,"No silent catchup before Continue producer");assert.equal(resumed.plan,codePlan.plan,"Same retained validated plan identity");
    assert.equal((resumed.request.scene?.sceneArtifacts as {codeLesson:core.CodeLessonPlan}).codeLesson,codePlan.plan);
    assert.equal(resumed.request.figureDrawn,false,"Planned but undrawn geometry remains withheld");
    await h.advance(h.now()+60000);await h.params.segmentChainRef.current;
    assert.equal(h.controller.getState().revealedChars.s1b4,blocks[3]!.code.length,"Continue finishes the original owed prefix only through real TYPE execution");
    assert.deepEqual(h.controller.unrevealedBlockIds(),[],"Only subsequently executed TYPEs complete the retained plan");
    assert(!h.resumeHandle()?.submittedRows().some(row=>parseStoredSegmentCommands(row.command).some(command=>command.type==="CLEAR")),"No fresh page/CLEAR is manufactured by Continue");
   }
  }else if(mode==="user-stop"||mode==="stale"){
   assert.equal(h.errors.length,0,"Intentional Stop/stale owner remains quiet");assert.equal(h.jobs.length,4);assert.equal(h.controller.getState().revealedChars.s1b4,7);assert.equal(h.controller.frames.currentIndex(),0);
  }else{
   assert.equal(h.params.cancelRef.current,true,"A fully typed block still owes its failed narration; no later beat may skip it");assert.equal(h.errors.length,1);assert.match(h.errors[0]!.message,/Continue the lesson/);assert.equal(h.jobs.length,4,"Terminal speech failure stops before later owned segments");
   if(mode==="partial-complete")assert.equal(h.controller.getState().revealedChars.s1b4,7,"Completed intentional partial target stays partial");
  }
  console.log(`code speech failure ${mode}: actual consumer PASS`);
 }finally{h.close();}
}
async function main(){const cases:Mode[]=["incomplete","joined","continue","user-stop","stale","full-target","partial-complete","partial-incomplete","no-type","explanation-only","unknown","mismatch","hidden","plan-replaced","controller-replaced","target-mutated"];
 const selected=cases.filter(mode=>!process.env.CODE_SPEECH_CASE||mode===process.env.CODE_SPEECH_CASE);assert(selected.length>0,"Actual requested consumer case exists");for(const mode of selected)await run(mode);console.log(`verify-code-speech-failure: ${selected.length} actual consumer groups passed; no providers`);}
const watchdog=setTimeout(()=>{console.error("Code speech failure verifier exceeded15s");process.exit(1);},15000);
void main().then(()=>clearTimeout(watchdog),error=>{clearTimeout(watchdog);console.error(error);process.exitCode=1;});
