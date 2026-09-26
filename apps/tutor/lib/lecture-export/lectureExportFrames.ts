const LECTURE_EXPORT_SAMPLE_WIDTH = 48;
const LECTURE_EXPORT_SAMPLE_HEIGHT = 28;

/** Group consecutive still frames into one encoded sample; keep moving ink as its own samples. */
export function planLectureEncodeSpans(changed: readonly boolean[]): { start: number; count: number }[] {
  if (changed.length === 0) {
    return [];
  }
  const spans: { start: number; count: number }[] = [];
  let start = 0;
  for (let index = 1; index <= changed.length; index++) {
    const boundary = index === changed.length || changed[index];
    if (!boundary) {
      continue;
    }
    spans.push({ start, count: index - start });
    start = index;
  }
  return spans;
}

export function lectureFramesLookSame(
  previous: Uint8ClampedArray | null,
  next: Uint8ClampedArray,
): boolean {
  if (!previous || previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < next.length; index++) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }
  return true;
}

export function sampleLectureFrame(
  source: HTMLCanvasElement,
  dest: HTMLCanvasElement,
): Uint8ClampedArray {
  if (dest.width !== LECTURE_EXPORT_SAMPLE_WIDTH) {
    dest.width = LECTURE_EXPORT_SAMPLE_WIDTH;
  }
  if (dest.height !== LECTURE_EXPORT_SAMPLE_HEIGHT) {
    dest.height = LECTURE_EXPORT_SAMPLE_HEIGHT;
  }
  const ctx = dest.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Lecture export could not sample a frame.");
  }
  ctx.drawImage(source, 0, 0, LECTURE_EXPORT_SAMPLE_WIDTH, LECTURE_EXPORT_SAMPLE_HEIGHT);
  return ctx.getImageData(0, 0, LECTURE_EXPORT_SAMPLE_WIDTH, LECTURE_EXPORT_SAMPLE_HEIGHT).data.slice();
}

export function lectureExportCacheKey(turn: {
  id: string;
  segments: readonly { audioUrl: string | null }[];
}): string {
  const audio = turn.segments.map((segment) => segment.audioUrl ?? "").join("|");
  return `${turn.id}:${turn.segments.length}:${audio}`;
}

export function lectureExportProgressLabel(progress: {
  currentMs: number;
  totalMs: number;
  phase: "audio" | "video" | "mux";
}): string {
  if (progress.phase === "audio") {
    return "Preparing…";
  }
  if (progress.phase === "mux") {
    return "Saving…";
  }
  if (progress.totalMs <= 0) {
    return "Encoding…";
  }
  const pct = Math.min(99, Math.max(0, Math.round((100 * progress.currentMs) / progress.totalMs)));
  return `${pct}%`;
}
