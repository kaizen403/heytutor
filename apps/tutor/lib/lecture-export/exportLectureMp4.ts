import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import type { VirtualWhiteboardClock } from "@heytutor/whiteboard";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import { buildReplayTimeline } from "@/lib/replay/replayTimeline";
import { renderCodePanelFrame } from "@/lib/code-render/renderCodeToCanvas";
import { DSA_CODE_PANEL_RECT, WHITEBOARD_COLOR } from "@/features/tutor-session/constants";
import { canEncodeLectureMp4 } from "./canExportLectureMp4";
import {
  buildCodeLessonExportTrack,
  codeLessonFrameSpec,
} from "./codeLessonExportTrack";
import { drawLectureTimeline, type ExportExecuteCommand } from "./drawLectureTimeline";
import {
  LECTURE_EXPORT_SAMPLE_RATE,
  buildLectureAudioTrack,
  speedPcmTrack,
  type PcmTrack,
} from "./lectureAudioTrack";
import {
  LECTURE_VIDEO_CODECS,
  pickLectureExportProfile,
  type LectureAudioCodec,
  type LectureContainer,
  type LectureExportProfile,
  type LectureVideoCodec,
} from "./lectureExportProfile";
import {
  lectureFramesLookSame,
  sampleLectureFrame,
} from "./lectureExportFrames";
import {
  LECTURE_EXPORT_PLAYBACK_RATE,
  lectureExportFileMs,
  lectureExportMediaMs,
} from "./lectureExportSpeed";

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
  mimeType: LectureExportProfile["mimeType"];
  extension: LectureExportProfile["extension"];
};

export async function probeLectureExportProfile(
  preferredContainer: LectureContainer = "mp4",
): Promise<LectureExportProfile | null> {
  if (!canEncodeLectureMp4()) {
    return null;
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const firefox = /firefox/i.test(ua);
  const videoOrder: readonly LectureVideoCodec[] =
    preferredContainer === "webm"
      ? ["vp9", "vp8", "av1"]
      : firefox
        ? ["vp9", "vp8", "av1", "avc"]
        : [...LECTURE_VIDEO_CODECS];
  let video: LectureVideoCodec = videoOrder[0] ?? "vp8";
  try {
    const probed = await getFirstEncodableVideoCodec([...videoOrder], {
      width: LECTURE_EXPORT_WIDTH,
      height: LECTURE_EXPORT_HEIGHT,
    });
    if (probed === "avc" || probed === "vp9" || probed === "av1" || probed === "vp8") {
      video = probed;
    }
  } catch {
    video = videoOrder[0] ?? "vp8";
  }
  let audio: LectureAudioCodec = preferredContainer === "webm" ? "opus" : "pcm-s16";
  try {
    const compressed = await getFirstEncodableAudioCodec(
      preferredContainer === "webm" ? ["opus"] : ["aac", "opus"],
      {
        numberOfChannels: 1,
        sampleRate: LECTURE_EXPORT_SAMPLE_RATE,
      },
    );
    if (compressed === "aac" || compressed === "opus") {
      audio = compressed;
    }
  } catch {
    audio = preferredContainer === "webm" ? "opus" : "pcm-s16";
  }
  return pickLectureExportProfile({
    videoCodecs: [video],
    audioCodecs: [audio],
    preferredContainer,
  });
}

export async function supportsLectureMp4Encode(): Promise<boolean> {
  return (await probeLectureExportProfile()) != null;
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
  ctx.fillStyle = WHITEBOARD_COLOR;
  ctx.fillRect(0, 0, dest.width, dest.height);
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
  /**
   * Every turn that drew the page `turn` ends on, oldest first. A doubt answers
   * on the lesson's page, so the export records the lesson and its doubts as
   * the one page the student watched. Defaults to `[turn]`.
   */
  pageTurns?: StoredTurn[];
  whiteboard: WhiteboardHandle;
  executeCommand: ExportExecuteCommand;
  clock: VirtualWhiteboardClock;
  shouldCancel: () => boolean;
  onProgress?: (progress: LectureExportProgress) => void;
  profile?: LectureExportProfile;
  preferredContainer?: LectureContainer;
}): Promise<LectureExportResult> {
  const pageTurns = options.pageTurns && options.pageTurns.length > 0
    ? options.pageTurns
    : [options.turn];
  const timeline = buildReplayTimeline(pageTurns);
  if (timeline.cues.length === 0 || timeline.totalMs <= 0) {
    throw new Error("This lecture has nothing to export.");
  }

  // DSA turns type code into a DOM panel the board capture cannot see; the
  // export composites a deterministic canvas rendering per frame instead.
  // The page's code lesson is the one its opening turn committed; a doubt on
  // it carries no plan of its own.
  let codeTrack: ReturnType<typeof buildCodeLessonExportTrack> = null;
  for (const pageTurn of pageTurns) {
    codeTrack = buildCodeLessonExportTrack(pageTurn, timeline.cues);
    if (codeTrack) break;
  }

  const profile =
    options.profile ?? (await probeLectureExportProfile(options.preferredContainer ?? "mp4"));
  if (!profile) {
    throw new Error("This browser cannot encode lecture video.");
  }

  options.onProgress?.({ currentMs: 0, totalMs: timeline.totalMs, phase: "audio" });
  const naturalAudio = await buildLectureAudioTrack({
    cues: timeline.cues,
    sampleRate: LECTURE_EXPORT_SAMPLE_RATE,
    decodeBytes: decodeMpegBytes,
  });
  const audioTrack = speedPcmTrack(naturalAudio, LECTURE_EXPORT_PLAYBACK_RATE);
  const fileTotalMs = lectureExportFileMs(timeline.totalMs);
  if (options.shouldCancel()) {
    throw new DOMException("Lecture export cancelled", "AbortError");
  }

  const composeCanvas = document.createElement("canvas");
  composeCanvas.width = LECTURE_EXPORT_WIDTH;
  composeCanvas.height = LECTURE_EXPORT_HEIGHT;

  const target = new BufferTarget();
  const output = new Output({
    format:
      profile.container === "webm"
        ? new WebMOutputFormat()
        : new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const videoSource = new CanvasSource(composeCanvas, {
    codec: profile.videoCodec,
    quality: new Quality({ bitrate: 2_500_000 }),
  });
  const audioSource = new AudioBufferSource(
    profile.audioCodec === "pcm-s16"
      ? { codec: "pcm-s16" }
      : { codec: profile.audioCodec, quality: new Quality({ bitrate: 128_000 }) },
  );
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

    const totalFrames = Math.max(1, Math.ceil(fileTotalMs / LECTURE_EXPORT_FRAME_MS));
    options.onProgress?.({ currentMs: 0, totalMs: fileTotalMs, phase: "video" });

    const holdCanvas = document.createElement("canvas");
    holdCanvas.width = LECTURE_EXPORT_WIDTH;
    holdCanvas.height = LECTURE_EXPORT_HEIGHT;
    const nextCanvas = document.createElement("canvas");
    nextCanvas.width = LECTURE_EXPORT_WIDTH;
    nextCanvas.height = LECTURE_EXPORT_HEIGHT;
    const sampleCanvas = document.createElement("canvas");
    let holdStartFrame = 0;
    let holdSample: Uint8ClampedArray | null = null;

    const flushHold = async (endFrame: number) => {
      if (!holdSample || endFrame <= holdStartFrame) {
        return;
      }
      copyFrameToCanvas(holdCanvas, composeCanvas);
      await videoSource.add(
        holdStartFrame / LECTURE_EXPORT_FPS,
        (endFrame - holdStartFrame) / LECTURE_EXPORT_FPS,
      );
    };

    for (let frame = 0; frame < totalFrames; frame++) {
      if (options.shouldCancel()) {
        await output.cancel();
        await drawPromise.catch(() => undefined);
        throw new DOMException("Lecture export cancelled", "AbortError");
      }

      const fileMs = frame * LECTURE_EXPORT_FRAME_MS;
      const mediaMs = lectureExportMediaMs(fileMs);
      options.clock.setNow(mediaMs);
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
            codeLessonFrameSpec(codeTrack, mediaMs),
            DSA_CODE_PANEL_RECT,
          );
        }
      }
      const sample = sampleLectureFrame(composeCanvas, sampleCanvas);
      if (holdSample && lectureFramesLookSame(holdSample, sample)) {
        options.onProgress?.({
          currentMs: Math.min((frame + 1) * LECTURE_EXPORT_FRAME_MS, fileTotalMs),
          totalMs: fileTotalMs,
          phase: "video",
        });
        continue;
      }
      copyFrameToCanvas(composeCanvas, nextCanvas);
      await flushHold(frame);
      copyFrameToCanvas(nextCanvas, holdCanvas);
      holdSample = sample;
      holdStartFrame = frame;
      options.onProgress?.({
        currentMs: Math.min((frame + 1) * LECTURE_EXPORT_FRAME_MS, fileTotalMs),
        totalMs: fileTotalMs,
        phase: "video",
      });
    }
    await flushHold(totalFrames);

    options.clock.setNow(timeline.totalMs);
    await pumpExportFrame(options.clock);
    await drawPromise;

    options.onProgress?.({
      currentMs: fileTotalMs,
      totalMs: fileTotalMs,
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
    blob: new Blob([buffer], { type: profile.mimeType }),
    missingAudioCues: naturalAudio.missingAudioCues,
    totalMs: fileTotalMs,
    mimeType: profile.mimeType,
    extension: profile.extension,
  };
}
