/**
 * What the Download control shows. `useLectureExport` produces it and the
 * download components only render it, so the pipeline and the visuals can
 * change apart.
 *
 * Every file covers the lesson from its start to the current point: a live
 * lesson up to its last finished step, a stopped one up to where it stopped.
 */
export type DownloadFile = "pdf" | "video";

/** Why a finished file is not the whole lesson, if it is not. */
export type DownloadNote = "partial" | "no-voice" | "some-voice-missing" | null;

export type DownloadState =
  | { kind: "idle" }
  /** Indeterminate and usually under two seconds. */
  | { kind: "pdf"; stage: "capturing" | "writing" }
  | {
      kind: "video";
      stage: "preparing" | "recording" | "finishing";
      /** 0 to 1 while recording; null while preparing or finishing. */
      fraction: number | null;
      /** The lesson is live or stopped, so the file ends at the current point. */
      partial: boolean;
    }
  /** Shown briefly, then back to idle. */
  | { kind: "done"; file: DownloadFile; note: DownloadNote }
  | { kind: "error"; file: DownloadFile; message: string }
  /** Shown briefly after the student cancels, then back to idle. */
  | { kind: "cancelled" };

export const IDLE_DOWNLOAD: DownloadState = { kind: "idle" };

/** A video export can be cancelled; a PDF is too quick to need it. */
export function downloadIsCancellable(state: DownloadState): boolean {
  return state.kind === "video";
}

export function downloadIsBusy(state: DownloadState): boolean {
  return state.kind === "pdf" || state.kind === "video";
}
