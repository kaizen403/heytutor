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
  const width = source.width;
  const height = source.height;
  if (dest.width !== width) {
    dest.width = width;
  }
  if (dest.height !== height) {
    dest.height = height;
  }
  const ctx = dest.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Lecture export could not sample a frame.");
  }
  // Coarse spatial sampling can erase a thin WRITE entirely. Compare every
  // raster pixel, including additions, erasures and the visible pen. Each
  // getImageData returns an owned snapshot, so retain its buffer without a
  // second full-frame copy.
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
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
    return "Finishing…";
  }
  if (progress.totalMs <= 0) {
    return "Encoding…";
  }
  const pct = Math.min(99, Math.max(0, Math.round((100 * progress.currentMs) / progress.totalMs)));
  return `${pct}%`;
}
