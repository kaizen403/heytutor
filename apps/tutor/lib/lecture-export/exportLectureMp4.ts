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
import { buildReplayTimeline, type ReplayCue } from "@/lib/replay/replayTimeline";
import { renderCodePanelFrame } from "@/lib/code-render/renderCodeToCanvas";
import { DSA_CODE_PANEL_RECT, WHITEBOARD_COLOR } from "@/features/tutor-session/constants";
import { canEncodeLectureMp4 } from "./canExportLectureMp4";
import {
  buildCodeLessonExportSpans,
  codeLessonFrameSpec,
  codeLessonSpanAt,
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
import { drainExportTail, pumpExportClock } from "./lectureExportTail";
import {
  LECTURE_EXPORT_PLAYBACK_RATE,
  lectureExportFileMs,
  lectureExportMediaMs,
} from "./lectureExportSpeed";

const LECTURE_EXPORT_FPS = 24;
const LECTURE_EXPORT_FRAME_MS = 1000 / LECTURE_EXPORT_FPS;
const LECTURE_EXPORT_WIDTH = 1200;
const LECTURE_EXPORT_HEIGHT = 700;
/** Main thread work between yields while a lesson is live on the main board. */
const LECTURE_EXPORT_YIELD_MS = 12;

export type LectureExportProgress = {
  currentMs: number;
  totalMs: number;
  phase: "audio" | "video" | "mux";
};

export type LectureExportResult = {
  blob: Blob;
  missingAudioCues: number;
  /** No spoken cue had usable audio, so the file is silent. */
  noVoice: boolean;
  /** The drawing still ran when the tail limit was reached; the file ends there. */
  tailTruncated: boolean;
  totalMs: number;
  mimeType: LectureExportProfile["mimeType"];
  extension: LectureExportProfile["extension"];
};

async function probeLectureExportProfile(
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
  /** In-memory audio for a cue (a live turn's clips), read before its URL. */
  cueBytes?: (cue: ReplayCue) => Uint8Array | null;
  /**
   * True while a lesson is live on the main board. The frame loop then hands
   * the main thread back every few milliseconds so the live pen and voice keep
   * their timing.
   */
  shouldYield?: () => boolean;
  /** Lesson time the drawing may run past the last word. */
  tailLimitMs?: number;
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
  // Each page's code lesson is the one its opening turn committed; a doubt on
  // it carries no plan of its own, and a page without one shows no panel.
  const codeSpans = buildCodeLessonExportSpans(pageTurns, timeline.cues);

  const profile =
    options.profile ?? (await probeLectureExportProfile(options.preferredContainer ?? "mp4"));
  if (!profile) {
    throw new Error("This browser cannot encode lecture video.");
  }

  options.onProgress?.({ currentMs: 0, totalMs: timeline.totalMs, phase: "audio" });
  if (options.shouldCancel()) {
    throw new DOMException("Lecture export cancelled", "AbortError");
  }
  const naturalAudio = await buildLectureAudioTrack({
    cues: timeline.cues,
    sampleRate: LECTURE_EXPORT_SAMPLE_RATE,
    decodeBytes: decodeMpegBytes,
    cueBytes: options.cueBytes,
    shouldCancel: options.shouldCancel,
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
        // moov stays at the end. in-memory fast start holds every encoded
        // sample until the end, then copies the whole lecture on the main
        // thread, so the Download button sits on "Finishing…" and the file
        // never starts.
        : new Mp4OutputFormat({ fastStart: false }),
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

  let tailTruncated = false;
  let encodedFileMs = fileTotalMs;
  // Set when the export stops before the drawing does (the tail limit, a
  // failure), so the drawing's waits stop instead of lingering on this clock.
  let abandoned = false;
  try {
    if (audioTrack.channels[0] && audioTrack.channels[0].length > 0) {
      await audioSource.add(pcmToAudioBuffer(audioTrack.channels, audioTrack.sampleRate));
    }

    options.whiteboard.setTimeSource(options.clock.source);
    options.whiteboard.setAnimationSpeed(1);
    await options.whiteboard.clearBoard(0);

    const drawShouldCancel = () => abandoned || options.shouldCancel();
    let drawFailed = false;
    let drawError: unknown = undefined;
    const drawPromise = drawLectureTimeline({
      cues: timeline.cues,
      executeCommand: options.executeCommand,
      getClockMs: options.clock.now,
      waitForAdvance: options.clock.waitForAdvance,
      shouldCancel: drawShouldCancel,
      setAnimationSpeed: (rate) => options.whiteboard.setAnimationSpeed(rate),
    });
    // A drawing that fails early stops the encode then, not after the whole
    // lesson has been recorded around a broken board.
    void drawPromise.catch((error: unknown) => {
      drawFailed = true;
      drawError = error;
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

    /** Capture the board as it is now and encode it as `frame`. */
    const encodeFrame = async (frame: number, mediaMs: number) => {
      const captured = options.whiteboard.captureFrame({ pixelRatio: 1, hideCursor: false });
      if (!captured) {
        throw new Error("Lecture export could not capture the board.");
      }
      copyFrameToCanvas(captured, composeCanvas);
      const codeTrack = codeLessonSpanAt(codeSpans, mediaMs);
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
        return;
      }
      copyFrameToCanvas(composeCanvas, nextCanvas);
      await flushHold(frame);
      copyFrameToCanvas(nextCanvas, holdCanvas);
      holdSample = sample;
      holdStartFrame = frame;
    };

    const cancelEncode = async (): Promise<never> => {
      await output.cancel();
      options.clock.pump();
      throw new DOMException("Lecture export cancelled", "AbortError");
    };

    let lastYieldAt = performance.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      if (options.shouldCancel()) {
        await cancelEncode();
      }
      if (drawFailed) {
        throw drawError instanceof Error ? drawError : new Error("Lecture export could not draw the board.");
      }

      const fileMs = frame * LECTURE_EXPORT_FRAME_MS;
      const mediaMs = lectureExportMediaMs(fileMs);
      options.clock.setNow(mediaMs);
      await pumpExportClock(options.clock);
      await encodeFrame(frame, mediaMs);
      options.onProgress?.({
        currentMs: Math.min((frame + 1) * LECTURE_EXPORT_FRAME_MS, fileTotalMs),
        totalMs: fileTotalMs,
        phase: "video",
      });

      if (options.shouldYield?.() && performance.now() - lastYieldAt >= LECTURE_EXPORT_YIELD_MS) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        lastYieldAt = performance.now();
      }
    }

    // The audio has ended; the drawing may not have. Keep the clock moving and
    // keep encoding until the last mark is down, bounded by the tail limit.
    const tail = await drainExportTail({
      clock: options.clock,
      drawPromise,
      shouldCancel: options.shouldCancel,
      startMs: lectureExportMediaMs(totalFrames * LECTURE_EXPORT_FRAME_MS),
      stepMs: lectureExportMediaMs(LECTURE_EXPORT_FRAME_MS),
      limitMs: options.tailLimitMs,
      onStep: (mediaMs, step) => encodeFrame(totalFrames + step, mediaMs),
    });
    if (tail.cancelled) {
      await cancelEncode();
    }
    if (tail.error !== undefined) {
      throw tail.error instanceof Error ? tail.error : new Error("Lecture export could not draw the board.");
    }
    if (!tail.settled) {
      abandoned = true;
      options.clock.pump();
    }
    tailTruncated = !tail.settled;
    const encodedFrames = totalFrames + tail.steps;
    await flushHold(encodedFrames);
    encodedFileMs = Math.max(fileTotalMs, encodedFrames * LECTURE_EXPORT_FRAME_MS);

    options.onProgress?.({
      currentMs: encodedFileMs,
      totalMs: encodedFileMs,
      phase: "mux",
    });
    await output.finalize();
  } catch (error) {
    abandoned = true;
    options.clock.pump();
    await output.cancel().catch(() => undefined);
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
    noVoice: naturalAudio.spokenCues > 0 && naturalAudio.voicedCues === 0,
    tailTruncated,
    totalMs: encodedFileMs,
    mimeType: profile.mimeType,
    extension: profile.extension,
  };
}
