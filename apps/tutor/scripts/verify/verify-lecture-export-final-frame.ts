/** Actual export loop and drawing timeline; only browser canvas/encoder/audio-decoder adapters are faked. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";

const app = resolve(import.meta.dirname, "../..");
const load = createRequire(resolve(app, "package.json"));
const ts = load("typescript") as typeof import("typescript");
const { createVirtualWhiteboardClock } = load("@heytutor/whiteboard");
const realDraw = load(resolve(app, "lib/lecture-export/drawLectureTimeline.ts"));

type Event = { kind: string; value?: number; at?: number };
type Frame = { value: number; start: number; duration: number };
type Scenario = "already-captured" | "main-flush" | "tail-flush" | "unchanged" | "unfinished" | "error" | "cancel";
type Result = { tailTruncated: boolean; totalMs: number; missingAudioCues: number; noVoice: boolean };


async function run(scenario: Scenario, voice: "silent" | "voiced" | "missing" = "silent") {
  const durationMs = scenario === "tail-flush" ? 1015 : 995;
  const clock = createVirtualWhiteboardClock(0);
  const events: Event[] = [];
  const encoded: Frame[] = [];
  let board = 0;
  let capture = 0;
  let release!: () => void;
  const canCommit = new Promise<void>(done => { release = done; });
  const finalFrame = Math.ceil((durationMs / 1.25) / (1000 / 24)) - 1;
  let drawDone = false;
  let cancelled = false;
  let cancelCalls = 0, finalizeCalls = 0;
  const audioSamples: number[] = [];

  class Canvas {
    width = 1200;
    height = 700;
    value = 0;
    getContext() {
      return {
        fillStyle: "",
        fillRect: () => { this.value = 0; },
        drawImage: (source: Canvas) => { this.value = source.value; },
        getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4).fill(this.value * 100) }),
      };
    }
  }
  class CanvasSource {
    constructor(private canvas: Canvas) {}
    async add(start: number, duration: number) {
      encoded.push({ value: this.canvas.value, start, duration });
      events.push({ kind: "encode", value: this.canvas.value });
      // A real encoder add is asynchronous. Let the drawing's committed mark
      // and promise finish while a prior captured span is being submitted.
      await new Promise<void>(done => setTimeout(done, 0));
    }
  }
  class BufferTarget { buffer = new ArrayBuffer(4); }
  class Output {
    addVideoTrack() {}
    addAudioTrack() {}
    async start() {}
    async finalize() { finalizeCalls += 1; events.push({ kind: "finalize" }); }
    async cancel() { cancelCalls += 1; }
  }
  class AudioBufferSource {
    async add(buffer: { samples: Float32Array[] }) { audioSamples.push(buffer.samples[0]?.[0] ?? 0); }
  }
  class OfflineAudioContext {
    async decodeAudioData() {
      return { numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array(48).fill(0.25) };
    }
    createBuffer(channels: number, frames: number) {
      const samples = Array.from({ length: channels }, () => new Float32Array(frames));
      return { samples, copyToChannel: (source: Float32Array, channel: number) => samples[channel]!.set(source) };
    }
  }
  const mediabunny = { CanvasSource, BufferTarget, Output, AudioBufferSource,
    Quality: class {}, Mp4OutputFormat: class {}, WebMOutputFormat: class {} };
  const sourcePath = process.env.EXPORT_BOUNDARY_SOURCE ?? resolve(app, "lib/lecture-export/exportLectureMp4.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const hookModule = { exports: {} as { exportLectureMp4: (options: unknown) => Promise<Result> } };
  const requireModule = (name: string) => {
    if (name === "mediabunny") return mediabunny;
    if (name === "./drawLectureTimeline") return { ...realDraw,
      drawLectureTimeline: (options: unknown) => {
        const promise = realDraw.drawLectureTimeline(options);
        void promise.then(() => { drawDone = true; events.push({ kind: "draw-settled" }); }, () => { events.push({ kind: "draw-failed" }); });
        return promise;
      },
    };
    if (name.startsWith("@/")) return load(resolve(app, name.slice(2) + ".ts"));
    if (name.startsWith(".")) return load(resolve(app, "lib/lecture-export", name + ".ts"));
    return load(name);
  };
  const context = vm.createContext({ exports: hookModule.exports, module: hookModule, require: requireModule,
    document: { createElement: () => new Canvas() }, Blob, DOMException, Error, console,
    setTimeout, clearTimeout, performance, Uint8ClampedArray, Float32Array, ArrayBuffer, OfflineAudioContext });
  new vm.Script(transpiled, { filename: sourcePath }).runInContext(context);
  const executeCommand = async (_command: unknown, options: { isCancelled?: () => boolean }) => {
    if (scenario === "error") throw new Error("fixture drawing failed");
    await canCommit;
    if (options.isCancelled?.()) return;
    board = scenario === "unchanged" ? 0 : 2;
    events.push({ kind: "last-mark-committed", value: board, at: clock.now() });
  };
  const whiteboard = {
    setTimeSource() {}, setAnimationSpeed() {}, clearBoard: async () => {},
    captureFrame() {
      const commitCapture = scenario === "tail-flush" ? finalFrame + 1 : finalFrame;
      if (capture === commitCapture && !["unfinished", "error", "cancel"].includes(scenario)) {
        // Cursor movement makes this frame differ. Its awaited encoder flush
        // gives a pending WRITE time to land after the frame was captured.
        board = scenario === "unchanged" ? 0 : 1;
        if (scenario === "already-captured") { board = 2; release(); }
      }
      const canvas = new Canvas(); canvas.value = board;
      events.push({ kind: "capture", value: canvas.value, at: clock.now() });
      if (capture === commitCapture && ["main-flush", "tail-flush", "unchanged"].includes(scenario)) release();
      if (scenario === "cancel" && capture === 0) cancelled = true;
      capture += 1;
      return canvas;
    },
  };
  const command = { type: "WRITE", text: "last committed mark", params: [90, 300], charPosition: 0, narrationBefore: "" };
  const turn = { id: "final-mark", orderIndex: 0, question: "A public asynchronous drawing fixture", rawResponse: "",
    speedMultiplier: 1, traceId: null, sceneDocument: null, sceneEngineVersion: null,
    validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
    segments: [{ id: "mark", orderIndex: 0, narration: voice === "silent" ? "" : "One voiced row.", spokenText: "", command,
      audioUrl: null, durationMs, timings: null }] };
  let result: Result | null = null;
  let failure: unknown;
  try {
    result = await hookModule.exports.exportLectureMp4({
      turn, whiteboard, executeCommand, clock, shouldCancel: () => cancelled,
      profile: { container: "mp4", videoCodec: "avc", audioCodec: "pcm-s16", mimeType: "video/mp4", extension: "mp4" },
      tailLimitMs: 100,
      cueBytes: () => voice === "voiced" ? new Uint8Array([1, 2, 3]) : null,
    });
  } catch (error) { failure = error; }
  finally { cancelled = true; release(); clock.pump(); await Promise.resolve(); }
  return { scenario, voice, durationMs, turn, encoded, events, result, failure, drawDone,
    finalBoard: board, finalEncoded: encoded.at(-1)?.value, cancelCalls, finalizeCalls, audioSamples };

}

async function main() {
  const captured = await run("already-captured");
  const mainFlush = await run("main-flush");
  const tailFlush = await run("tail-flush");
  const unchanged = await run("unchanged");
  const unfinished = await run("unfinished");
  const failed = await run("error");
  const cancelled = await run("cancel");
  const voiced = await run("main-flush", "voiced");
  const missing = await run("main-flush", "missing");
  const outcomes = [captured, mainFlush, tailFlush, unchanged, unfinished, failed, cancelled, voiced, missing];
  console.log(JSON.stringify(outcomes.map(({ scenario, voice, finalBoard, finalEncoded, result, drawDone, cancelCalls, finalizeCalls }) =>
    ({ scenario, voice, finalBoard, finalEncoded, result, drawDone, cancelCalls, finalizeCalls })), null, 2));
  const cache = load(resolve(app, "lib/lecture-export/canExportLectureMp4.ts"));
  assert.notEqual(cache.lecturePageCacheKey([captured.turn]), "final-mark:1:@1.25@audio2", "a previously successful incomplete MP4 cache entry is invalidated");
  assert.notEqual(cache.lecturePageCacheKey([captured.turn], "webm"), "final-mark:1:@1.25@audio2.webm", "the same old WebM cache entry is invalidated");
  assert.equal(captured.finalEncoded, 2, "already captured final ink remains encoded");
  for (const outcome of [mainFlush, tailFlush, voiced, missing]) {
    assert.equal(outcome.drawDone, true, `${outcome.scenario}: actual drawing timeline settled`);
    assert.equal(outcome.finalBoard, 2, `${outcome.scenario}: final WRITE committed`);
    assert.equal(outcome.finalEncoded, 2,
      `${outcome.scenario}: encode samples the last WRITE committed while the previous captured span flushed`);
    assert.equal(outcome.result!.tailTruncated, false);
  }
  assert.equal(unchanged.result!.totalMs, captured.result!.totalMs, "a terminal sample with no changed ink adds no duration");
  assert.equal(mainFlush.result!.totalMs, 875, "20 normal frames plus one terminal frame at 24fps last 875ms");
  assert.equal(mainFlush.encoded.at(-1)!.duration, 1 / 24, "the changed terminal picture occupies one bounded frame");
  assert.equal(unchanged.finalEncoded, 0);
  assert.equal(unfinished.result!.tailTruncated, true, "an unfinished drawing remains truthfully truncated");
  assert.equal(unfinished.finalEncoded, 0);
  assert.equal(failed.failure instanceof Error, true); assert.match(String(failed.failure), /fixture drawing failed/);
  assert.equal(failed.finalizeCalls, 0); assert.ok(failed.cancelCalls > 0);
  assert.equal((cancelled.failure as { name: string }).name, "AbortError");
  assert.equal(cancelled.finalizeCalls, 0); assert.ok(cancelled.cancelCalls > 0);
  assert.equal(voiced.result!.missingAudioCues, 0); assert.equal(voiced.result!.noVoice, false);
  assert.ok(voiced.audioSamples[0]! > 0, "actual audio preparation keeps decoded voiced samples");
  assert.equal(missing.result!.missingAudioCues, 1); assert.equal(missing.result!.noVoice, true);
  assert.equal(missing.audioSamples[0], 0, "a missing speaking clip remains silence");
  console.log("verify-lecture-export-final-frame: final main/tail flush ink, unchanged duration, cancellation, error, truncation and voice metadata");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
