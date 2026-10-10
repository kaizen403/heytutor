/**
 * Transitions of the Download control. `useLectureExport` dispatches the
 * pipeline's events here and hands `state.view` to the components.
 *
 * Every run gets a generation. Cancel, leaving the board and dismiss end the
 * run at once and bump the generation, so whatever the old pipeline reports
 * later (progress, done, an error) is ignored and never pins the control.
 */
import type { LectureExportProgress } from "@/lib/lecture-export/exportLectureMp4";
import {
  IDLE_DOWNLOAD,
  downloadIsBusy,
  type DownloadFile,
  type DownloadNote,
  type DownloadState,
} from "./downloadState";

/** How long a finished state shows before the control is back to Download. */
export const DOWNLOAD_DONE_MS = 2_500;
/** A finished file with a note stays long enough to read the note. */
export const DOWNLOAD_DONE_NOTE_MS = 6_000;
export const DOWNLOAD_CANCELLED_MS = 1_500;

export type DownloadMachine = {
  view: DownloadState;
  /** Generation of the run the view belongs to. */
  generation: number;
};

export const INITIAL_DOWNLOAD_MACHINE: DownloadMachine = {
  view: IDLE_DOWNLOAD,
  generation: 0,
};

export type DownloadEvent =
  /** Starts run `generation + 1`; ignored while another run is busy. */
  | { type: "start"; file: DownloadFile; partial: boolean }
  | { type: "progress"; generation: number; progress: LectureExportProgress }
  | { type: "pdf-stage"; generation: number; stage: "capturing" | "writing" }
  | { type: "done"; generation: number; note: DownloadNote }
  | { type: "error"; generation: number; message: string }
  /** The student pressed Cancel. Returns the control at once. */
  | { type: "cancel" }
  /** The board changed under the run. Back to idle with no message. */
  | { type: "reset" }
  /** Clears a finished, failed or cancelled state. */
  | { type: "dismiss" };

/** Generation the next `start` will get; read it before dispatching. */
export function nextDownloadGeneration(machine: DownloadMachine): number {
  return machine.generation + 1;
}

function fraction(progress: LectureExportProgress): number {
  if (progress.totalMs <= 0) return 0;
  return Math.min(1, Math.max(0, progress.currentMs / progress.totalMs));
}

function videoView(
  progress: LectureExportProgress,
  partial: boolean,
): DownloadState {
  if (progress.phase === "audio") {
    return { kind: "video", stage: "preparing", fraction: null, partial };
  }
  if (progress.phase === "mux") {
    return { kind: "video", stage: "finishing", fraction: null, partial };
  }
  return { kind: "video", stage: "recording", fraction: fraction(progress), partial };
}

function fileOf(view: DownloadState): DownloadFile | null {
  if (view.kind === "pdf") return "pdf";
  if (view.kind === "video") return "video";
  return null;
}

export function downloadReducer(
  machine: DownloadMachine,
  event: DownloadEvent,
): DownloadMachine {
  switch (event.type) {
    case "start": {
      if (downloadIsBusy(machine.view)) return machine;
      const generation = machine.generation + 1;
      const view: DownloadState =
        event.file === "pdf"
          ? { kind: "pdf", stage: "capturing" }
          : { kind: "video", stage: "preparing", fraction: null, partial: event.partial };
      return { view, generation };
    }
    case "progress": {
      if (event.generation !== machine.generation || machine.view.kind !== "video") return machine;
      return {
        ...machine,
        view: videoView(event.progress, machine.view.partial),
      };
    }
    case "pdf-stage": {
      if (event.generation !== machine.generation || machine.view.kind !== "pdf") return machine;
      return { ...machine, view: { kind: "pdf", stage: event.stage } };
    }
    case "done": {
      const file = fileOf(machine.view);
      if (event.generation !== machine.generation || !file) return machine;
      return { ...machine, view: { kind: "done", file, note: event.note } };
    }
    case "error": {
      const file = fileOf(machine.view);
      if (event.generation !== machine.generation || !file) return machine;
      return { ...machine, view: { kind: "error", file, message: event.message } };
    }
    case "cancel": {
      if (!downloadIsBusy(machine.view)) return machine;
      return { view: { kind: "cancelled" }, generation: machine.generation + 1 };
    }
    case "reset": {
      if (machine.view.kind === "idle") return machine;
      return { view: IDLE_DOWNLOAD, generation: machine.generation + 1 };
    }
    case "dismiss": {
      if (downloadIsBusy(machine.view) || machine.view.kind === "idle") return machine;
      return { ...machine, view: IDLE_DOWNLOAD };
    }
  }
}

/** How long the current view shows before the hook dismisses it, if it does. */
export function downloadAutoDismissMs(view: DownloadState): number | null {
  if (view.kind === "done") return view.note ? DOWNLOAD_DONE_NOTE_MS : DOWNLOAD_DONE_MS;
  if (view.kind === "cancelled") return DOWNLOAD_CANCELLED_MS;
  return null;
}
