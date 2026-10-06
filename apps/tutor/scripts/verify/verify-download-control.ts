/**
 * The Download control renders `DownloadState` at one fixed width, with a
 * determinate ring, an always visible cancel while a video is made, calm
 * finished, cancelled and failed states, and no red anywhere.
 *
 * Static markup plus pure asserts, in the style of verify-mobile-controls.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonActions } from "../../features/tutor-session/components/LessonActions";
import { SessionHeader } from "../../features/tutor-session/components/SessionHeader";
import { DownloadMenu } from "../../features/tutor-session/components/download/DownloadMenu";
import {
  downloadErrorHeadline,
  downloadMenuCopy,
  downloadNoteCopy,
  downloadPercent,
  downloadPillView,
  downloadStateFromLegacy,
  downloadStatusCopy,
  nextMenuIndex,
} from "../../features/tutor-session/components/download/downloadView";
import type { DownloadState } from "../../features/tutor-session/lib/download/downloadState";

Object.defineProperty(globalThis, "React", { value: React, configurable: true });

const noop = () => {};
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const STATES: Record<string, DownloadState> = {
  idle: { kind: "idle" },
  pdf: { kind: "pdf", stage: "capturing" },
  pdfWriting: { kind: "pdf", stage: "writing" },
  preparing: { kind: "video", stage: "preparing", fraction: null, partial: true },
  recording: { kind: "video", stage: "recording", fraction: 0.42, partial: true },
  recordingUnknown: { kind: "video", stage: "recording", fraction: null, partial: false },
  finishing: { kind: "video", stage: "finishing", fraction: null, partial: false },
  done: { kind: "done", file: "video", note: null },
  donePartial: { kind: "done", file: "pdf", note: "partial" },
  doneNoVoice: { kind: "done", file: "video", note: "no-voice" },
  doneMissing: { kind: "done", file: "video", note: "some-voice-missing" },
  errorVideo: { kind: "error", file: "video", message: "This browser cannot make a video. Try Chrome or Edge." },
  errorPdf: { kind: "error", file: "pdf", message: "The board pages could not be read." },
  cancelled: { kind: "cancelled" },
};

function render(state: DownloadState, compact: boolean): string {
  return renderToStaticMarkup(
    createElement(LessonActions, {
      canReplay: true,
      onReplay: noop,
      compact,
      alwaysVisible: true,
      downloadState: state,
      canDownloadPdf: true,
      canDownloadVideo: true,
      onDownloadPdf: noop,
      onDownloadVideo: noop,
      onCancelDownload: noop,
      onDismissDownload: noop,
    }),
  );
}

function pillClass(markup: string): string {
  const match = markup.match(/class="(download-pill [^"]*)"/);
  assert.ok(match, "the pill root renders with its download-pill class");
  return match[1];
}

// 1. One width in every state: nothing beside the pill can move.
for (const [name, state] of Object.entries(STATES)) {
  const wide = pillClass(render(state, false));
  assert.ok(wide.split(" ").includes("sm:w-[8.5rem]"), `${name}: the wide pill is fixed at 8.5rem`);
  assert.ok(wide.split(" ").includes("w-[4.75rem]"), `${name}: the phone pill is fixed at 4.75rem`);
  assert.doesNotMatch(wide, /w-auto|min-w-|max-w-/, `${name}: the pill never sizes to its text`);
  const compact = pillClass(render(state, true));
  assert.ok(compact.split(" ").includes("w-[4.75rem]"), `${name}: the compact pill is fixed at 4.75rem`);
  assert.ok(compact.split(" ").includes("h-11"), `${name}: the compact pill is a 44px target`);
  assert.doesNotMatch(compact, /w-auto|sm:w-/, `${name}: the compact pill never grows`);
}

// 2. Recording: a determinate ring, tabular figures, and a separate cancel.
const recording = render(STATES.recording, false);
assert.match(recording, /role="progressbar"[^>]*aria-valuenow="42"/, "the ring is determinate at 42");
assert.match(recording, /data-ring="determinate"/);
assert.match(recording, /tabular-nums[^>]*>42%</, "the percent is set in tabular figures");
assert.match(
  recording,
  /<button[^>]*aria-label="Cancel video download"[^>]*title="Cancel download"/,
  "cancel is its own always rendered button, not a hover swap of the readout",
);
assert.match(recording, /aria-label="Video download, 42 percent\. Open download options"/);
const recordingCompact = render(STATES.recording, true);
assert.match(recordingCompact, />42%</, "compact still shows the number");
assert.doesNotMatch(recordingCompact, /Cancel video download/, "compact cancels from the menu, at 44px");
assert.match(recordingCompact, /aria-valuenow="42"/);

// Preparing and finishing are cancellable too; a PDF is not.
for (const name of ["preparing", "finishing", "recordingUnknown"]) {
  const markup = render(STATES[name], false);
  assert.match(markup, /aria-label="Cancel video download"/, `${name}: the video can be cancelled`);
  assert.match(markup, /data-ring="indeterminate"/, `${name}: an unknown amount spins`);
  assert.doesNotMatch(markup, /aria-valuenow/, `${name}: no fake number on an indeterminate ring`);
}
for (const name of ["idle", "pdf", "pdfWriting", "done", "errorVideo", "cancelled"]) {
  assert.doesNotMatch(render(STATES[name], false), /Cancel video download/, `${name}: nothing to cancel`);
}

// 3. Reduced motion: every spin is motion-safe.
const spinning = render(STATES.preparing, false);
assert.match(spinning, /motion-safe:animate-spin/);
assert.doesNotMatch(spinning.replace(/motion-safe:animate-spin/g, ""), /animate-spin/, "no unconditional spin");

// 4. Finished, cancelled and failed.
assert.match(render(STATES.done, false), />Downloaded</);
assert.match(render(STATES.done, false), /text-success/);
assert.match(render(STATES.cancelled, false), />Cancelled</);
const failed = render(STATES.errorVideo, false);
assert.match(failed, />Not downloaded</);
assert.match(failed, /role="alert"/, "a failure opens its explanation as an alert");
assert.match(failed, />The video did not download\.</);
assert.match(failed, />Try again</);
assert.match(failed, /aria-label="Dismiss"/);
assert.match(render(STATES.errorPdf, false), />The notes did not download\.</);
const noted = render(STATES.doneMissing, false);
assert.match(noted, /Some audio was missing, so those parts are silent\./, "a finished file with a note says so");
assert.doesNotMatch(noted, /role="alert"/, "a note is not an error");

// 5. Nothing red, no hover reveal, no old helpers.
const sources = [
  "features/tutor-session/components/LessonActions.tsx",
  ...readdirSync(new URL("../../features/tutor-session/components/download/", import.meta.url)).map(
    (file) => `features/tutor-session/components/download/${file}`,
  ),
];
for (const path of sources) {
  const source = read(path);
  assert.doesNotMatch(source, /onPointerEnter|onPointerLeave|onMouseEnter|onMouseLeave/, `${path}: no hover reveal`);
  assert.doesNotMatch(source, /text-danger|bg-danger|--danger/, `${path}: no red in the download control`);
  assert.doesNotMatch(source, /lectureExportCancel/, `${path}: the hover cancel helpers are gone`);
}
for (const [name, state] of Object.entries(STATES)) {
  for (const compact of [false, true]) {
    assert.doesNotMatch(render(state, compact), /danger/, `${name}: no danger face`);
  }
}

// 6. The menu: the speed menu's surface, two clear entries, honest coverage.
function menu(state: DownloadState, extra: Partial<Parameters<typeof DownloadMenu>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(DownloadMenu, {
      id: "m",
      state,
      partial: false,
      videoTypeLabel: "MP4",
      canDownloadPdf: true,
      canDownloadVideo: true,
      unavailableReason: "Available once the first lesson has been taught",
      touch: false,
      onDownloadPdf: noop,
      onDownloadVideo: noop,
      onCancel: noop,
      onClose: noop,
      ...extra,
    }),
  );
}
const idleMenu = menu(STATES.idle);
assert.match(idleMenu, /role="menu"/);
assert.match(idleMenu, />Download this lesson</);
assert.match(idleMenu, />Notes \(PDF\)</);
assert.match(idleMenu, />Video \(MP4\)</);
assert.match(idleMenu, />The whole lesson, with voice</, "a finished lesson's video is the whole lesson");
assert.match(idleMenu, /shadow-\[0_16px_40px_-16px_rgba\(0,0,0,0\.7\)\]/, "a menu leaves the page, so it gets the shadow");
assert.match(idleMenu, /focus-visible:bg-white\/5/, "keyboard focus is visible");
assert.equal((idleMenu.match(/role="menuitem"/g) ?? []).length, 2);
assert.match(menu(STATES.idle, { partial: true }), />Board and voice, up to now</, "a live or stopped lesson says up to now");
assert.match(menu(STATES.idle, { partial: true }), />Every board page so far</);
const blockedMenu = menu(STATES.idle, { canDownloadVideo: false });
assert.match(blockedMenu, /disabled=""[^>]*>.*Video \(MP4\).*Available once the first lesson has been taught/s, "a disabled entry says why");
assert.match(menu(STATES.idle, { touch: true }), /min-h-11/, "touch rows are 44px");
assert.match(idleMenu, /\[@media\(pointer:coarse\)\]:min-h-11/, "coarse pointers get 44px rows");
const busyMenu = menu(STATES.recording);
assert.match(busyMenu, />42%</);
assert.match(busyMenu, />Cancel download</, "the menu always offers cancel while a video is made");
assert.doesNotMatch(busyMenu, /Notes \(PDF\)/, "one file at a time");
assert.doesNotMatch(menu(STATES.pdf), /Cancel download/, "a PDF has nothing to cancel");

// 7. Keys: the speed menu's roving focus.
assert.equal(nextMenuIndex("ArrowDown", -1, 2), 0);
assert.equal(nextMenuIndex("ArrowDown", 1, 2), 0);
assert.equal(nextMenuIndex("ArrowUp", 0, 2), 1);
assert.equal(nextMenuIndex("ArrowUp", -1, 3), 2);
assert.equal(nextMenuIndex("Home", 1, 3), 0);
assert.equal(nextMenuIndex("End", 0, 3), 2);
assert.equal(nextMenuIndex("Tab", 0, 3), null);
assert.equal(nextMenuIndex("ArrowDown", 0, 0), null);
const menuSource = read("features/tutor-session/components/download/DownloadMenu.tsx");
assert.match(menuSource, /event\.key === "Escape"[\s\S]{0,120}onClose\(true\)/, "Escape returns focus to the trigger");
assert.match(menuSource, /first\?\.focus/, "the first enabled item takes focus on open");

// 8. Percent and copy.
assert.equal(downloadPercent(1), 99, "never 100 before the mux");
assert.equal(downloadPercent(0.999), 99);
assert.equal(downloadPercent(-0.2), 0);
assert.equal(downloadPercent(Number.NaN), null);
assert.equal(downloadPercent(null), null);
const copy: string[] = [];
for (const state of Object.values(STATES)) {
  const view = downloadPillView(state);
  copy.push(view.label, view.shortLabel, view.live, view.ariaLabel, view.figure ?? "");
  const status = downloadStatusCopy(state);
  if (status) copy.push(status.title, status.detail);
}
for (const partial of [true, false]) {
  const m = downloadMenuCopy({ partial, videoTypeLabel: "MP4" });
  copy.push(m.heading, m.pdf.title, m.pdf.detail, m.video.title, m.video.detail);
}
copy.push(downloadErrorHeadline("pdf"), downloadErrorHeadline("video"));
for (const note of ["partial", "no-voice", "some-voice-missing", null] as const) copy.push(downloadNoteCopy(note) ?? "");
for (const line of copy) {
  assert.doesNotMatch(line, / - | – | — |—|–/, `no dash as punctuation: "${line}"`);
}
assert.ok(copy.includes("Board and voice, up to now"));
assert.ok(copy.includes("The whole lesson, with voice"));
assert.ok(copy.includes("Notes (PDF)") && copy.includes("Video (MP4)"));

// 9. The legacy bridge keeps the shell compiling and honest until it passes downloadState.
assert.deepEqual(downloadStateFromLegacy({}), { kind: "idle" });
assert.deepEqual(downloadStateFromLegacy({ isDownloading: true }), { kind: "pdf", stage: "capturing" });
assert.equal(downloadStateFromLegacy({ isExportingLecture: true }).kind, "video");
const legacyRecording = downloadStateFromLegacy({
  isExportingLecture: true,
  progress: { currentMs: 420, totalMs: 1000, phase: "video" },
});
assert.equal(legacyRecording.kind === "video" && legacyRecording.stage, "recording");
assert.equal(downloadPillView(legacyRecording).figure, "42%");
assert.equal(
  downloadStateFromLegacy({ isExportingLecture: true, progress: { currentMs: 0, totalMs: 1, phase: "mux" } }).kind === "video",
  true,
);
assert.deepEqual(downloadStateFromLegacy({ error: "x" }), { kind: "error", file: "video", message: "x" });
const legacyMarkup = renderToStaticMarkup(
  createElement(LessonActions, {
    canReplay: true,
    onReplay: noop,
    canDownload: true,
    canDownloadLecture: true,
    isExportingLecture: true,
    lectureExportProgress: { currentMs: 420, totalMs: 1000, phase: "video" },
    onDownload: noop,
    onDownloadLecture: noop,
    onCancelLectureExport: noop,
  }),
);
assert.match(legacyMarkup, /aria-valuenow="42"/, "old props still render through the bridge");
assert.match(legacyMarkup, /Cancel video download/);

// 10. The header's right side is one family: one height, one radius, one type size.
const header = renderToStaticMarkup(
  createElement(SessionHeader, {
    boardTitle: "Projectile motion",
    showNavButton: true,
    onExpandSidebar: noop,
    canReplay: true,
    isReplaying: false,
    phase: "speaking",
    showNotesToggle: true,
    onToggleNotes: noop,
    onToggleFullscreen: noop,
    onReplay: noop,
    onStop: noop,
    downloadState: STATES.recording,
    canDownloadPdf: true,
    canDownloadVideo: true,
    onDownloadPdf: noop,
    onDownloadVideo: noop,
    onCancelDownload: noop,
  }),
);
for (const label of ["Ask me anything", "Replay lecture", "Full screen board", "Stop teaching"]) {
  const match = header.match(new RegExp(`aria-label="${label}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*aria-label="${label}"`));
  assert.ok(match, `${label} renders`);
  const cls = match[1] ?? match[2];
  assert.match(cls, /rounded-full/, `${label}: fully rounded`);
  assert.match(cls, /sm:h-8/, `${label}: 32px on a wide header`);
  assert.match(cls, /type-accent-s/, `${label}: 12px label face`);
  assert.doesNotMatch(cls, /btn-sm|h-\[34px\]|text-\[11px\]/, `${label}: no second size`);
}
assert.match(pillClass(header), /sm:h-8/, "the download pill matches the row height");
assert.match(header, /aria-label="Open navigation"[^>]*class="[^"]*sm:h-8 sm:w-8/, "the nav button sits on the same line");
assert.match(header, /class="flex items-center gap-1\.5 sm:gap-2"/, "the actions share the header's gap");

Reflect.deleteProperty(globalThis, "React");
console.log("verify-download-control: fixed width in every state, determinate ring, visible cancel, calm finish and failure, menu and header unified");
