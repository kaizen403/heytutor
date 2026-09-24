/**
 * Downloaded lectures are time-compressed to this rate so QuickTime, VLC, and
 * the phone player play them at 1.25× without a speed control. In-app replay
 * still uses the student's slider (default 1.25×).
 */
export const LECTURE_EXPORT_PLAYBACK_RATE = 1.25;

export function clampLectureExportPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return rate;
}

/** Wall duration of the downloaded file for a lesson of `mediaMs`. */
export function lectureExportFileMs(
  mediaMs: number,
  rate = LECTURE_EXPORT_PLAYBACK_RATE,
): number {
  return Math.max(0, mediaMs) / clampLectureExportPlaybackRate(rate);
}

/** Lesson time captured by one encoded frame at file time `fileMs`. */
export function lectureExportMediaMs(
  fileMs: number,
  rate = LECTURE_EXPORT_PLAYBACK_RATE,
): number {
  return Math.max(0, fileMs) * clampLectureExportPlaybackRate(rate);
}
