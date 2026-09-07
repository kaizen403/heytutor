import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import type { VirtualWhiteboardClock } from "@heytutor/whiteboard";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { buildReplayTimeline } from "@/lib/replay/replayTimeline";
import { renderCodePanelFrame } from "@/lib/code-render/renderCodeToCanvas";
import { DSA_CODE_PANEL_RECT } from "@/features/tutor-session/constants";
import { canEncodeLectureMp4 } from "./canExportLectureMp4";
import {
  buildCodeLessonExportTrack,
  codeLessonFrameSpec,
} from "./codeLessonExportTrack";
import { drawLectureTimeline, type ExportExecuteCommand } from "./drawLectureTimeline";
import {
  LECTURE_EXPORT_SAMPLE_RATE,
  buildLectureAudioTrack,
  type PcmTrack,
} from "./lectureAudioTrack";

export const LECTURE_EXPORT_FPS = 24;
export const LECTURE_EXPORT_FRAME_MS = 1000 / LECTURE_EXPORT_FPS;
export const LECTURE_EXPORT_WIDTH = 1200;
export const LECTURE_EXPORT_HEIGHT = 700;

export type LectureExportProgress = {
  currentMs: number;
  totalMs: number;
  phase: "audio" | "video" | "mux";
};

export type LectureExportResult = {
  blob: Blob;
  missingAudioCues: number;
  totalMs: number;
};

export async function supportsLectureMp4Encode(): Promise<boolean> {
  if (!canEncodeLectureMp4()) {
    return false;
  }
  const [video, audio] = await Promise.all([
    canEncodeVideo("avc", { width: LECTURE_EXPORT_WIDTH, height: LECTURE_EXPORT_HEIGHT }),
    canEncodeAudio("aac"),
  ]);
  return video && audio;
}

async function decodeMpegBytes(data: ArrayBuffer): Promise<PcmTrack | null> {
  const context = new OfflineAudioContext(1, 1, LECTURE_EXPORT_SAMPLE_RATE);
  try {
    const buffer = await context.decodeAudioData(data);
    const channels: Float32Array[] = [];
    for (let index = 0; index < buffer.numberOfChannels; index++) {
      channels.push(buffer.getChannelData(index).slice());
    }
    return { channels, sampleRate: buffer.sampleRate };
  } catch {
    return null;
  }
}

function pcmToAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const frames = Math.max(channels[0]?.length ?? 0, 1);
  const context = new OfflineAudioContext(Math.max(channels.length, 1), frames, sampleRate);
  const buffer = context.createBuffer(Math.max(channels.length, 1), frames, sampleRate);
  channels.forEach((channel, index) => {
    const copy = new Float32Array(channel.length);
    copy.set(channel);
    buffer.copyToChannel(copy, index);
  });
  return buffer;
}

function copyFrameToCanvas(
  source: HTMLCanvasElement,
  dest: HTMLCanvasElement,
): void {
  if (dest.width !== LECTURE_EXPORT_WIDTH) {
    dest.width = LECTURE_EXPORT_WIDTH;
  }
  if (dest.height !== LECTURE_EXPORT_HEIGHT) {
    dest.height = LECTURE_EXPORT_HEIGHT;
  }
  const ctx = dest.getContext("2d");
  if (!ctx) {
    throw new Error("Lecture export could not create a 2D canvas.");
  }
  ctx.drawImage(source, 0, 0, LECTURE_EXPORT_WIDTH, LECTURE_EXPORT_HEIGHT);
}

async function pumpExportFrame(clock: VirtualWhiteboardClock): Promise<void> {
  clock.pump();
  await Promise.resolve();
  for (let extra = 0; extra < 8; extra++) {
    if (clock.pendingCount() === 0) {
      break;
    }
    clock.pump();
    await Promise.resolve();
  }
}

export async function exportLectureMp4(options: {
  turn: StoredTurn;
  whiteboard: WhiteboardHandle;
  executeCommand: ExportExecuteCommand;
  clock: VirtualWhiteboardClock;
  shouldCancel: () => boolean;
  onProgress?: (progress: LectureExportProgress) => void;
}): Promise<LectureExportResult> {
  const timeline = buildReplayTimeline([options.turn]);
  if (timeline.cues.length === 0 || timeline.totalMs <= 0) {
    throw new Error("This lecture has nothing to export.");
  }

  // DSA turns type code into a DOM panel the board capture cannot see; the
  // export composites a deterministic canvas rendering per frame instead.
  const codeTrack = buildCodeLessonExportTrack(options.turn, timeline.cues);

  options.onProgress?.({ currentMs: 0, totalMs: timeline.totalMs, phase: "audio" });
  const audioTrack = await buildLectureAudioTrack({
    cues: timeline.cues,
    sampleRate: LECTURE_EXPORT_SAMPLE_RATE,
    decodeBytes: decodeMpegBytes,
  });
  if (options.shouldCancel()) {
    throw new DOMException("Lecture export cancelled", "AbortError");
  }

  const composeCanvas = document.createElement("canvas");
  composeCanvas.width = LECTURE_EXPORT_WIDTH;
  composeCanvas.height = LECTURE_EXPORT_HEIGHT;

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const videoSource = new CanvasSource(composeCanvas, {
    codec: "avc",
    quality: new Quality({ bitrate: 2_500_000 }),
  });
  const audioSource = new AudioBufferSource({
    codec: "aac",
    quality: new Quality({ bitrate: 128_000 }),
  });
  output.addVideoTrack(videoSource, { frameRate: LECTURE_EXPORT_FPS });
  output.addAudioTrack(audioSource);

  await output.start();

  try {
    if (audioTrack.channels[0] && audioTrack.channels[0].length > 0) {
      await audioSource.add(pcmToAudioBuffer(audioTrack.channels, audioTrack.sampleRate));
    }

    options.whiteboard.setTimeSource(options.clock.source);
    options.whiteboard.setAnimationSpeed(1);
    await options.whiteboard.clearBoard(0);

    const drawPromise = drawLectureTimeline({
      cues: timeline.cues,
      executeCommand: options.executeCommand,
      getClockMs: options.clock.now,
      waitForAdvance: options.clock.waitForAdvance,
      shouldCancel: options.shouldCancel,
      setAnimationSpeed: (rate) => options.whiteboard.setAnimationSpeed(rate),
    });

    const totalFrames = Math.max(1, Math.ceil(timeline.totalMs / LECTURE_EXPORT_FRAME_MS));
    options.onProgress?.({ currentMs: 0, totalMs: timeline.totalMs, phase: "video" });

    for (let frame = 0; frame < totalFrames; frame++) {
      if (options.shouldCancel()) {
        await output.cancel();
        await drawPromise.catch(() => undefined);
        throw new DOMException("Lecture export cancelled", "AbortError");
      }

      const frameMs = frame * LECTURE_EXPORT_FRAME_MS;
      options.clock.setNow(frameMs);
      await pumpExportFrame(options.clock);

      const captured = options.whiteboard.captureFrame({ pixelRatio: 1, hideCursor: false });
      if (!captured) {
        throw new Error("Lecture export could not capture the board.");
      }
      copyFrameToCanvas(captured, composeCanvas);
      if (codeTrack) {
        const composeCtx = composeCanvas.getContext("2d");
        if (composeCtx) {
          renderCodePanelFrame(
            composeCtx,
            codeLessonFrameSpec(codeTrack, frameMs),
            DSA_CODE_PANEL_RECT,
          );
        }
      }
      await videoSource.add(frame / LECTURE_EXPORT_FPS, 1 / LECTURE_EXPORT_FPS);
      options.onProgress?.({
        currentMs: Math.min((frame + 1) * LECTURE_EXPORT_FRAME_MS, timeline.totalMs),
        totalMs: timeline.totalMs,
        phase: "video",
      });
    }

    options.clock.setNow(timeline.totalMs);
    await pumpExportFrame(options.clock);
    await drawPromise;

    options.onProgress?.({
      currentMs: timeline.totalMs,
      totalMs: timeline.totalMs,
      phase: "mux",
    });
    await output.finalize();
  } catch (error) {
    if (options.shouldCancel()) {
      await output.cancel().catch(() => undefined);
    }
    throw error;
  } finally {
    options.whiteboard.setTimeSource(null);
    options.whiteboard.setAnimationSpeed(1);
  }

  const buffer = target.buffer;
  if (!buffer) {
    throw new Error("Lecture export did not produce a file.");
  }

  return {
    blob: new Blob([buffer], { type: "video/mp4" }),
    missingAudioCues: audioTrack.missingAudioCues,
    totalMs: timeline.totalMs,
  };
}
