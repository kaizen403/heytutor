/** Actual export producer and PCM/clock pipeline; browser codec/canvas ports are deterministic. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createVirtualWhiteboardClock } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";
import { speedPcmTrack, type PcmTrack } from "../../lib/lecture-export/lectureAudioTrack";
import type { LectureExportResult } from "../../lib/lecture-export/exportLectureMp4";
import type { LectureContainer, LectureExportProfile } from "../../lib/lecture-export/lectureExportProfile";

const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
const sampleRate = 44_100;
const durationMs = 2_000;
const tonesHz = [240, 400];
const frames = sampleRate * durationMs / 1000;
const wav = Buffer.alloc(44 + frames * tonesHz.length * 2);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(tonesHz.length, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * tonesHz.length * 2, 28);
wav.writeUInt16LE(tonesHz.length * 2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
const sourceChannels = tonesHz.map(frequency => Float32Array.from({ length: frames }, (_, index) => {
  const value = Math.round(12_000 * Math.sin(2 * Math.PI * frequency * index / sampleRate));
  wav.writeInt16LE(value, 44 + (index * tonesHz.length + tonesHz.indexOf(frequency)) * 2);
  return value / 32768;
}));

function measuredPitchHz(samples: Float32Array, rate: number): number {
  const crossings: number[] = [];
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1]!, after = samples[index]!;
    if (before <= 0 && after > 0) crossings.push(index - 1 - before / (after - before));
  }
  assert(crossings.length > 100, "a pitch verdict requires enough non-silent waveform periods");
  return rate * (crossings.length - 1) / (crossings.at(-1)! - crossings[0]!);
}

type BufferPort = { channels: Float32Array[]; sampleRate: number; copyToChannel: (data: Float32Array, channel: number) => void };
type EncodedFrame = { start: number; duration: number; mediaMs: number };

async function produce(container: LectureContainer) {
  const clock = createVirtualWhiteboardClock();
  const encoded: EncodedFrame[] = [];
  const audio: PcmTrack[] = [];
  let decoded = 0, finalized = 0;
  class Canvas {
    width = 1200; height = 700; mediaMs = 0;
    getContext() {
      return {
        fillStyle: "", fillRect: () => {},
        drawImage: (source: Canvas) => { this.mediaMs = source.mediaMs; },
        getImageData: () => {
          const value = Math.round(this.mediaMs);
          return { data: new Uint8ClampedArray([value & 255, (value >> 8) & 255, 0, 255]) };
        },
      };
    }
  }
  class OfflineAudioContext {
    async decodeAudioData(data: ArrayBuffer) {
      assert.deepEqual(new Uint8Array(data), new Uint8Array(wav), "the real decoder boundary receives the exact held WAV");
      decoded++;
      return { numberOfChannels: tonesHz.length, sampleRate,
        getChannelData: (channel: number) => sourceChannels[channel]!.slice() };
    }
    createBuffer(channels: number, length: number, rate: number): BufferPort {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { channels: data, sampleRate: rate,
        copyToChannel: (source, channel) => data[channel]!.set(source) };
    }
  }
  class AudioBufferSource {
    async add(buffer: BufferPort) {
      audio.push({ sampleRate: buffer.sampleRate, channels: buffer.channels.map(channel => channel.slice()) });
    }
  }
  class CanvasSource {
    constructor(private canvas: Canvas) {}
    async add(start: number, duration: number) {
      encoded.push({ start, duration, mediaMs: this.canvas.mediaMs });
    }
  }
  class BufferTarget { buffer = new ArrayBuffer(4); }
  class Output {
    addVideoTrack() {} addAudioTrack() {} async start() {}
    async finalize() { finalized++; } async cancel() {}
  }
  const exportModule = { exports: {} as { exportLectureMp4: (options: unknown) => Promise<LectureExportResult> } };
  const source = readFileSync(path.join(app, "lib/lecture-export/exportLectureMp4.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const context = vm.createContext({ module: exportModule, exports: exportModule.exports, require: (name: string) => {
    if (name === "mediabunny") return { AudioBufferSource, CanvasSource, BufferTarget, Output,
      Quality: class {}, Mp4OutputFormat: class {}, WebMOutputFormat: class {} };
    if (name.startsWith("@/")) return requireApp(path.join(app, name.slice(2)));
    if (name.startsWith(".")) return requireApp(path.join(app, "lib/lecture-export", name));
    return requireApp(name);
  }, document: { createElement: () => new Canvas() }, OfflineAudioContext,
  Blob, DOMException, Error, console, performance, setTimeout, clearTimeout, Uint8ClampedArray, Float32Array, ArrayBuffer });
  new vm.Script(compiled).runInContext(context);
  const turn: StoredTurn = {
    id: "pitch-fixture", orderIndex: 0, question: "Known stereo voice fixture", rawResponse: "", speedMultiplier: 1.75,
    traceId: null, sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
    segments: [{ id: "tone", orderIndex: 0, narration: "Known fixture.", spokenText: "Known fixture.",
      command: null, durationMs, timings: null, audioUrl: null }],
  };
  const profile: LectureExportProfile = container === "mp4"
    ? { container, videoCodec: "avc", audioCodec: "aac", mimeType: "video/mp4", extension: "mp4" }
    : { container, videoCodec: "vp9", audioCodec: "opus", mimeType: "video/webm", extension: "webm" };
  const result = await exportModule.exports.exportLectureMp4({
    turn, clock, profile, shouldCancel: () => false, cueBytes: () => new Uint8Array(wav),
    executeCommand: async () => { throw new Error("the pitch fixture contains no drawing commands"); },
    whiteboard: {
      setTimeSource() {}, setAnimationSpeed() {}, async clearBoard() {},
      captureFrame: () => { const frame = new Canvas(); frame.mediaMs = clock.now(); return frame; },
    },
  });
  assert.equal(decoded, 1); assert.equal(finalized, 1);
  assert.equal(audio.length, 1, "the actual producer submits one stitched PCM track");
  assert.equal(turn.speedMultiplier, 1.75, "export leaves the independent saved playback choice unchanged");
  return { container, result, encoded, pcm: audio[0]!, key: lecturePageCacheKey([turn], container) };
}

async function main(): Promise<void> {
  const oldSpeed = speedPcmTrack({ sampleRate, channels: sourceChannels }, 1.25);
  const oldPitch = measuredPitchHz(oldSpeed.channels[0]!, oldSpeed.sampleRate);
  assert(Math.abs(oldPitch - 300) < 1, "the former 1.25 resampling shifts a known 240 Hz tone to 300 Hz");
  const results = [await produce("mp4"), await produce("webm")];
  console.log(JSON.stringify({ oldSpeedPitchHz: oldPitch, exports: results.map(({ container, pcm, result }) => ({
    container, pitchHz: pcm.channels.map(channel => measuredPitchHz(channel, pcm.sampleRate)),
    audioDurationMs: pcm.channels[0]!.length / pcm.sampleRate * 1000, fileDurationMs: result.totalMs,
  })) }));
  for (const { container, pcm, encoded, result, key } of results) {
    assert.equal(pcm.channels.length, 2, `${container}: both stereo channels survive`);
    for (const [index, frequency] of tonesHz.entries()) {
      assert(Math.abs(measuredPitchHz(pcm.channels[index]!, pcm.sampleRate) - frequency) < 1,
        `${container}: actual encoded-input PCM must preserve the known ${frequency} Hz source pitch`);
      assert.deepEqual(pcm.channels[index], sourceChannels[index], `${container}: natural-speed export preserves every input sample`);
    }
    assert.equal(pcm.channels[0]!.length / pcm.sampleRate * 1000, durationMs, `${container}: voice keeps its natural duration`);
    // The finished page is held 2 s after the last word (the export end hold).
    assert(result.totalMs >= durationMs + 2_000 && result.totalMs <= durationMs + 2_000 + 2 * 1000 / 24,
      `${container}: the file, its bounded final frame and the end hold remain at natural speed`);
    const mainFrames = encoded.filter(frame => frame.start < 1.5);
    assert(mainFrames.length > 10, "the actual frame producer is observed across the spoken timeline");
    for (const frame of mainFrames)
      assert(Math.abs(frame.mediaMs - frame.start * 1000) < 1, `${container}: each picture uses matching file and lesson time`);
    assert(key.includes("@1@") && !key.includes("@1.25@"), `${container}: a pitch-shifted cached file cannot satisfy the new key`);
    assert.equal(result.extension, container); assert.equal(result.noVoice, false); assert.equal(result.tailTruncated, false);
  }
  console.log("lecture export pitch: MP4/WebM actual producer keeps 240/400 Hz stereo, samples, natural duration, picture clock and cache identity; no providers");
}
const watchdog = setTimeout(() => { console.error("pitch export verifier exceeded its 10s wall bound"); process.exit(1); }, 10_000);
void main().then(() => clearTimeout(watchdog), error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
