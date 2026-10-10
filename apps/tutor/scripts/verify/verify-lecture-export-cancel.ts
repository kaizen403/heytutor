/**
 * Cancel returns the Download control at once.
 *
 * The old hook bumped a generation on Cancel and only reset the control in the
 * `finally` of the *current* generation, which a cancelled run never is. The
 * spinner stayed, and Download, Notes and Replay stayed disabled until the
 * shell remounted. The control now runs on a pure reducer: Cancel ends the run
 * itself, and whatever the old pipeline reports afterwards is ignored.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DOWNLOAD_CANCELLED_MS,
  DOWNLOAD_DONE_MS,
  DOWNLOAD_DONE_NOTE_MS,
  INITIAL_DOWNLOAD_MACHINE,
  downloadAutoDismissMs,
  downloadReducer,
  type DownloadEvent,
  type DownloadMachine,
} from "../../features/tutor-session/lib/download/downloadReducer";
import {
  downloadIsBusy,
  downloadIsCancellable,
} from "../../features/tutor-session/lib/download/downloadState";

const run = (machine: DownloadMachine, ...events: DownloadEvent[]): DownloadMachine =>
  events.reduce(downloadReducer, machine);

const startVideo = (machine: DownloadMachine, partial = false) =>
  downloadReducer(machine, { type: "start", file: "video", partial });

{
  const started = startVideo(INITIAL_DOWNLOAD_MACHINE, true);
  const generation = started.generation;
  assert.deepEqual(started.view, { kind: "video", stage: "preparing", fraction: null, partial: true });
  assert.equal(downloadIsCancellable(started.view), true);

  const recording = run(started, {
    type: "progress",
    generation,
    progress: { currentMs: 4_000, totalMs: 10_000, phase: "video" },
  });
  assert.deepEqual(recording.view, { kind: "video", stage: "recording", fraction: 0.4, partial: true });

  // The reported hang: Cancel at 99%, while the pipeline is still unwinding.
  const at99 = run(recording, {
    type: "progress",
    generation,
    progress: { currentMs: 9_950, totalMs: 10_000, phase: "video" },
  });
  const cancelled = downloadReducer(at99, { type: "cancel" });
  assert.equal(cancelled.view.kind, "cancelled", "Cancel ends the run in the same step");
  assert.equal(downloadIsBusy(cancelled.view), false, "after Cancel the control is free at once");
  assert.notEqual(cancelled.generation, generation, "Cancel retires the run's generation");

  // The old pipeline keeps talking after Cancel; none of it may pin the control.
  const late = run(
    cancelled,
    { type: "progress", generation, progress: { currentMs: 10_000, totalMs: 10_000, phase: "mux" } },
    { type: "done", generation, note: null },
    { type: "error", generation, message: "Lecture export cancelled" },
  );
  assert.equal(late.view.kind, "cancelled", "a cancelled run's progress, done and error are ignored");
  assert.equal(downloadIsBusy(late.view), false);

  // Notes, Replay and a second video are available again straight away.
  const again = startVideo(late);
  assert.equal(again.view.kind, "video", "a second download starts right after Cancel");
  assert.equal(again.generation, late.generation + 1);
  const stale = run(again, { type: "done", generation, note: null });
  assert.equal(stale.view.kind, "video", "the first run finishing late cannot end the second");
  const second = run(again, { type: "done", generation: again.generation, note: null });
  assert.deepEqual(second.view, { kind: "done", file: "video", note: null });

  const pdfAfterCancel = downloadReducer(late, { type: "start", file: "pdf", partial: false });
  assert.deepEqual(pdfAfterCancel.view, { kind: "pdf", stage: "capturing" }, "Notes work after Cancel");

  assert.equal(downloadAutoDismissMs(cancelled.view), DOWNLOAD_CANCELLED_MS);
  assert.equal(run(cancelled, { type: "dismiss" }).view.kind, "idle", "cancelled clears to idle");
}

{
  // Every stage of a video maps to the contract.
  const started = startVideo(INITIAL_DOWNLOAD_MACHINE);
  const g = started.generation;
  const stage = (phase: "audio" | "video" | "mux", currentMs = 0, totalMs = 1_000) =>
    run(started, { type: "progress", generation: g, progress: { currentMs, totalMs, phase } }).view;
  assert.deepEqual(stage("audio"), { kind: "video", stage: "preparing", fraction: null, partial: false });
  assert.deepEqual(stage("video", 2_000, 1_000), {
    kind: "video",
    stage: "recording",
    fraction: 1,
    partial: false,
  });
  assert.deepEqual(stage("video", 5, 0), { kind: "video", stage: "recording", fraction: 0, partial: false });
  assert.deepEqual(stage("mux"), { kind: "video", stage: "finishing", fraction: null, partial: false });
}

{
  // One download at a time: a PDF cannot start over a video, nor a video over a PDF.
  const video = startVideo(INITIAL_DOWNLOAD_MACHINE);
  assert.equal(downloadReducer(video, { type: "start", file: "pdf", partial: false }), video);
  const pdf = downloadReducer(INITIAL_DOWNLOAD_MACHINE, { type: "start", file: "pdf", partial: false });
  assert.equal(startVideo(pdf), pdf);
  const writing = run(pdf, { type: "pdf-stage", generation: pdf.generation, stage: "writing" });
  assert.deepEqual(writing.view, { kind: "pdf", stage: "writing" });
  const pdfDone = run(writing, { type: "done", generation: pdf.generation, note: "partial" });
  assert.deepEqual(pdfDone.view, { kind: "done", file: "pdf", note: "partial" });
  assert.equal(downloadAutoDismissMs(pdfDone.view), DOWNLOAD_DONE_NOTE_MS);
  assert.equal(run(pdfDone, { type: "dismiss" }).view.kind, "idle", "done clears to idle");
}

{
  // An error stays until dismissed or the next download starts.
  const video = startVideo(INITIAL_DOWNLOAD_MACHINE);
  const failed = run(video, { type: "error", generation: video.generation, message: "No." });
  assert.deepEqual(failed.view, { kind: "error", file: "video", message: "No." });
  assert.equal(downloadIsBusy(failed.view), false);
  assert.equal(downloadAutoDismissMs(failed.view), null, "an error does not vanish on its own");
  assert.equal(run(failed, { type: "dismiss" }).view.kind, "idle");
  assert.equal(startVideo(failed).view.kind, "video", "the next download replaces the error");
  assert.equal(run(failed, { type: "cancel" }), failed, "Cancel does nothing when nothing runs");

  const done = run(video, { type: "done", generation: video.generation, note: null });
  assert.equal(downloadAutoDismissMs(done.view), DOWNLOAD_DONE_MS);
  assert.equal(run(done, { type: "cancel" }).view.kind, "done");
}

{
  // Leaving the board ends the run quietly.
  const video = startVideo(INITIAL_DOWNLOAD_MACHINE);
  const reset = run(video, { type: "reset" });
  assert.equal(reset.view.kind, "idle");
  assert.equal(run(reset, { type: "done", generation: video.generation, note: null }).view.kind, "idle");
  assert.equal(run(INITIAL_DOWNLOAD_MACHINE, { type: "reset" }), INITIAL_DOWNLOAD_MACHINE);
  assert.equal(run(video, { type: "dismiss" }), video, "dismiss cannot end a running download");
}

{
  // The hook wires Cancel to the reducer and releases the clock waits, so the
  // pipeline unwinds instead of waiting on a clock nobody pumps. Both anchors
  // are checked so a moved function cannot widen the slice.
  const source = readFileSync(
    resolve(import.meta.dirname, "../../features/tutor-session/hooks/useLectureExport.ts"),
    "utf8",
  );
  const between = (start: string, end: string): string => {
    const from = source.indexOf(start);
    assert.ok(from >= 0, `useLectureExport.ts: start anchor "${start}" is gone; repoint this gate`);
    const to = source.indexOf(end, from + start.length);
    assert.ok(to > from, `useLectureExport.ts: end anchor "${end}" is gone; repoint this gate`);
    return source.slice(from, to);
  };
  const stop = between("const stopPipeline = useCallback(", "const releaseControl = useCallback(");
  assert.ok(stop.includes("clockRef.current?.pump()"), "Cancel must pump the export clock to release its waits");
  assert.ok(stop.includes("exportCancelRef.current = true"), "Cancel must raise the pipeline's cancel flag");
  const cancel = between("const cancelDownload = useCallback(", "const dismissDownload = useCallback(");
  assert.ok(cancel.includes('dispatch({ type: "cancel" })'), "Cancel must go through the reducer");
  assert.ok(cancel.includes("stopPipeline()"), "Cancel must stop the pipeline");
  assert.ok(cancel.includes("releaseControl()"), "Cancel must unmount the export board at once");
  const effects = between("// Leaving the board ends any run on it.", "const snapshotSource = useCallback(");
  assert.equal(
    /phase/.test(effects),
    false,
    "a lesson starting or stopping must not cancel a download",
  );
}

console.log("verify-lecture-export-cancel: Cancel frees the control at once; stale runs are ignored");
