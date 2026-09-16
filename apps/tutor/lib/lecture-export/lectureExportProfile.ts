export const LECTURE_VIDEO_CODECS = ["avc", "vp9", "av1", "vp8"] as const;
export const LECTURE_AUDIO_CODECS = ["aac", "opus", "pcm-s16"] as const;

export type LectureVideoCodec = (typeof LECTURE_VIDEO_CODECS)[number];
export type LectureAudioCodec = (typeof LECTURE_AUDIO_CODECS)[number];
export type LectureContainer = "mp4" | "webm";

export type LectureExportProfile = {
  container: LectureContainer;
  videoCodec: LectureVideoCodec;
  audioCodec: LectureAudioCodec;
  mimeType: "video/mp4" | "video/webm";
  extension: "mp4" | "webm";
};

const MP4_VIDEO = new Set<string>(["avc", "hevc", "vp8", "vp9", "av1"]);
const MP4_AUDIO = new Set<string>(["aac", "opus", "mp3", "pcm-s16"]);
const WEBM_VIDEO = new Set<string>(["vp8", "vp9", "av1"]);
const WEBM_AUDIO = new Set<string>(["opus", "vorbis"]);

function firstOf<T extends string>(preferred: readonly T[], available: readonly string[]): T | null {
  return preferred.find((codec) => available.includes(codec)) ?? null;
}

/**
 * Pick a container Firefox can actually encode. Chrome/Safari get AVC+AAC MP4;
 * Firefox typically has VP8/VP9 and no AAC, so fall through to VP8/VP9 + Opus
 * or built-in PCM in MP4.
 */
export function pickLectureExportProfile(input: {
  videoCodecs: readonly string[];
  audioCodecs: readonly string[];
}): LectureExportProfile | null {
  const video = firstOf(LECTURE_VIDEO_CODECS, input.videoCodecs);
  const audio = firstOf(LECTURE_AUDIO_CODECS, input.audioCodecs);
  if (!video || !audio) {
    return null;
  }
  if (MP4_VIDEO.has(video) && MP4_AUDIO.has(audio)) {
    return {
      container: "mp4",
      videoCodec: video,
      audioCodec: audio,
      mimeType: "video/mp4",
      extension: "mp4",
    };
  }
  if (WEBM_VIDEO.has(video) && WEBM_AUDIO.has(audio)) {
    return {
      container: "webm",
      videoCodec: video,
      audioCodec: audio,
      mimeType: "video/webm",
      extension: "webm",
    };
  }
  return null;
}
