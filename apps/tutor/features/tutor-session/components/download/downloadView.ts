/**
 * Pure view model for the Download control: every word it shows and every
 * visual decision it makes, so a gate can pin the copy without a DOM.
 *
 * The control renders `DownloadState` and nothing else. The legacy bridge at
 * the bottom derives that state from the old export props until the shell
 * passes `downloadState` directly; delete it then, or two sources drift.
 */
import type {
  DownloadFile,
  DownloadNote,
  DownloadState,
} from "@/features/tutor-session/lib/download/downloadState";

export type DownloadRing = "none" | "spin" | "determinate";
export type DownloadIcon = "download" | "check" | "alert";
export type DownloadTone = "frost" | "soft" | "success" | "warning";

export type DownloadPillView = {
  ring: DownloadRing;
  /** 0 to 99 while determinate, otherwise null. */
  percent: number | null;
  /** Shown in place of the ring when there is no ring. */
  icon: DownloadIcon | null;
  /** The pill's words on a wide header. */
  label: string;
  /** The right aligned figure next to the label, for example "42%". */
  figure: string | null;
  /** The words in the narrow (compact or phone) pill. Empty means glyph only. */
  shortLabel: string;
  tone: DownloadTone;
  /** A small, always visible cancel button sits in the pill. */
  canCancel: boolean;
  /** Polite live region text. Changes only at moments worth announcing. */
  live: string;
  /** The trigger button's accessible name. */
  ariaLabel: string;
};

/** Percent shown for a recording fraction. Never 100: the mux is still to come. */
export function downloadPercent(fraction: number | null): number | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  return Math.min(99, Math.max(0, Math.round(fraction * 100)));
}

/** Live text moves only at 25, 50 and 75 percent so a screen reader is not flooded. */
function percentLive(percent: number): string {
  const bucket = Math.floor(percent / 25) * 25;
  return bucket >= 25 ? `Video ${bucket} percent done` : "Making the video";
}

function fileWord(file: DownloadFile): string {
  return file === "pdf" ? "Notes" : "Video";
}

export function downloadErrorHeadline(file: DownloadFile): string {
  return file === "pdf" ? "The notes did not download." : "The video did not download.";
}

/** Extra words for a finished file, or null when the file needs none. */
export function downloadNoteCopy(note: DownloadNote): string | null {
  switch (note) {
    case "some-voice-missing":
      return "Downloaded. Some audio was missing, so those parts are silent.";
    case "no-voice":
      return "Downloaded without voice, because this lesson has no recorded voice.";
    default:
      return null;
  }
}

export function downloadPillView(state: DownloadState): DownloadPillView {
  switch (state.kind) {
    case "idle":
      return {
        ring: "none",
        percent: null,
        icon: "download",
        label: "Download",
        figure: null,
        shortLabel: "",
        tone: "frost",
        canCancel: false,
        live: "",
        ariaLabel: "Download notes or video",
      };
    case "pdf":
      return {
        ring: "spin",
        percent: null,
        icon: null,
        label: "Making PDF",
        figure: null,
        shortLabel: "PDF",
        tone: "soft",
        canCancel: false,
        live: "Making the notes PDF",
        ariaLabel: "Making the notes PDF",
      };
    case "video": {
      if (state.stage === "recording") {
        const percent = downloadPercent(state.fraction);
        if (percent !== null) {
          return {
            ring: "determinate",
            percent,
            icon: null,
            label: "Video",
            figure: `${percent}%`,
            shortLabel: `${percent}%`,
            tone: "frost",
            canCancel: true,
            live: percentLive(percent),
            ariaLabel: `Video download, ${percent} percent. Open download options`,
          };
        }
      }
      const finishing = state.stage === "finishing";
      return {
        ring: "spin",
        percent: null,
        icon: null,
        label: finishing ? "Finishing" : "Preparing",
        figure: null,
        shortLabel: "",
        tone: "soft",
        canCancel: true,
        live: finishing ? "Finishing the video" : "Preparing the video",
        ariaLabel: `${finishing ? "Finishing" : "Preparing"} the video. Open download options`,
      };
    }
    case "done": {
      const note = downloadNoteCopy(state.note);
      const upToNow = state.note === "partial" ? ", up to now" : "";
      return {
        ring: "none",
        percent: null,
        icon: "check",
        label: "Downloaded",
        figure: null,
        shortLabel: "",
        tone: "success",
        canCancel: false,
        live: note ?? `${fileWord(state.file)} downloaded${upToNow}`,
        ariaLabel: "Downloaded. Open download options",
      };
    }
    case "error":
      return {
        ring: "none",
        percent: null,
        icon: "alert",
        label: "Not downloaded",
        figure: null,
        shortLabel: "",
        tone: "warning",
        canCancel: false,
        live: `${downloadErrorHeadline(state.file)} ${state.message}`.trim(),
        ariaLabel: `${downloadErrorHeadline(state.file)} Show details`,
      };
    case "cancelled":
      return {
        ring: "none",
        percent: null,
        icon: "download",
        label: "Cancelled",
        figure: null,
        shortLabel: "",
        tone: "soft",
        canCancel: false,
        live: "Download cancelled",
        ariaLabel: "Download cancelled. Open download options",
      };
  }
}

export type DownloadMenuItemCopy = { title: string; detail: string };

/** The two menu entries. `partial` means the lesson is live or stopped. */
export function downloadMenuCopy(input: {
  partial: boolean;
  videoTypeLabel: string;
}): { heading: string; pdf: DownloadMenuItemCopy; video: DownloadMenuItemCopy } {
  return {
    heading: "Download this lesson",
    pdf: {
      title: "Notes (PDF)",
      detail: input.partial ? "Every board page so far" : "Every board page",
    },
    video: {
      title: `Video (${input.videoTypeLabel})`,
      detail: input.partial ? "Board and voice, up to now" : "The whole lesson, with voice",
    },
  };
}

export const DOWNLOAD_UNAVAILABLE_REASON = "Available once the first lesson has been taught";
export const DOWNLOAD_REPLAY_REASON = "Available when the replay ends";
export const DOWNLOAD_CANCEL_LABEL = "Cancel download";

/** Status line inside the menu while a file is being made. */
export function downloadStatusCopy(state: DownloadState): {
  title: string;
  figure: string | null;
  detail: string;
  percent: number | null;
} | null {
  if (state.kind === "pdf") {
    return { title: "Making the notes PDF", figure: null, detail: "Every board page so far", percent: null };
  }
  if (state.kind !== "video") return null;
  const detail = state.partial ? "Board and voice, up to now" : "The whole lesson, with voice";
  const percent = state.stage === "recording" ? downloadPercent(state.fraction) : null;
  if (percent !== null) {
    return { title: "Video", figure: `${percent}%`, detail, percent };
  }
  return {
    title: state.stage === "finishing" ? "Finishing the video" : "Preparing the video",
    figure: null,
    detail,
    percent: null,
  };
}

/** Roving focus for the menu: the same keys the speed menu answers. */
export function nextMenuIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return index < 0 ? 0 : (index + 1) % count;
    case "ArrowUp":
      return index < 0 ? count - 1 : (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** The old export progress shape, kept structural so the bridge does not pin the pipeline's types. */
export type LegacyExportProgress = {
  currentMs: number;
  totalMs: number;
  phase: "audio" | "video" | "mux";
};

/** Temporary bridge from the old LessonActions props. */
export function downloadStateFromLegacy(input: {
  isDownloading?: boolean;
  isExportingLecture?: boolean;
  progress?: LegacyExportProgress | null;
  error?: string | null;
}): DownloadState {
  if (input.isExportingLecture) {
    const progress = input.progress ?? null;
    if (!progress || progress.phase === "audio") {
      return { kind: "video", stage: "preparing", fraction: null, partial: false };
    }
    if (progress.phase === "mux") {
      return { kind: "video", stage: "finishing", fraction: null, partial: false };
    }
    return {
      kind: "video",
      stage: "recording",
      fraction: progress.totalMs > 0 ? progress.currentMs / progress.totalMs : null,
      partial: false,
    };
  }
  if (input.isDownloading) return { kind: "pdf", stage: "capturing" };
  if (input.error) return { kind: "error", file: "video", message: input.error };
  return { kind: "idle" };
}

/** Identity of a popover worth showing for this state, so a dismissal sticks to it. */
export function downloadPopoverKey(state: DownloadState): string | null {
  if (state.kind === "error") return `error:${state.file}:${state.message}`;
  if (state.kind === "done" && downloadNoteCopy(state.note)) return `note:${state.file}:${state.note}`;
  return null;
}
