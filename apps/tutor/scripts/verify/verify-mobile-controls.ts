import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InputBar } from "../../features/tutor-session/components/InputBar";
import { SessionHeader } from "../../features/tutor-session/components/SessionHeader";
import { MarkedDoubtBar } from "../../features/tutor-session/components/MarkedDoubtBar";
import { MARK_SUBMIT_LABEL, type BoardMark, type MarkTarget } from "../../features/tutor-session/lib/board/boardMarking";

Object.defineProperty(globalThis, "React", { value: React, configurable: true });

const noop = () => {};
const inputProps: ComponentProps<typeof InputBar> = {
  onSubmit: noop,
  onAskDoubt: noop,
  onPauseToggle: noop,
  onCancel: noop,
  onOpenSettings: noop,
  compact: true,
  disabled: true,
};

for (const isPaused of [false, true]) {
  const input = renderToStaticMarkup(createElement(InputBar, { ...inputProps, isPaused }));
  assert.match(input, />Ask Doubt<\/button>/, "The mobile live doubt button keeps its visible label");
  assert.match(input, /aria-label="Ask Doubt"[^>]*class="[^"]*min-h-11/, "The doubt button has a 44px touch target");
  assert.match(input, /aria-label="Board settings"[^>]*class="[^"]*h-11 w-11/, "Board settings remains touch-sized");
  assert.match(input, /flex-wrap items-center justify-between/, "Mobile controls can wrap instead of clipping");
}

const markedInput = renderToStaticMarkup(createElement(InputBar, {
  ...inputProps,
  markingArmed: true,
  markCount: 1,
}));
assert.ok(markedInput.includes(`>${MARK_SUBMIT_LABEL}</button>`), "A marked doubt retains its complete action label");

const idleInput = renderToStaticMarkup(createElement(InputBar, {
  ...inputProps,
  disabled: false,
  submitMode: "follow-up",
  familiarity: "normal",
  onFamiliarityChange: noop,
}));
assert.match(idleInput, />Ask Doubt<\/button>/);
assert.match(idleInput, />Next question<\/button>/);
assert.match(idleInput, /aria-label="Select Familiarity: Normal"[^>]*class="[^"]*h-11 min-h-11/, "Familiarity remains touch-sized");

const target: MarkTarget = {
  kind: "work",
  text: "V = a²h / 3",
  rect: { x: 0, y: 0, width: 200, height: 20 },
};
const mark: BoardMark = {
  id: "mobile-mark",
  gesture: "circle",
  points: [],
  bounds: target.rect,
  target,
  targets: [target],
};
const marker = renderToStaticMarkup(createElement(MarkedDoubtBar, {
  armed: true,
  marks: [mark],
  atMarkLimit: false,
  onRemove: noop,
  onClear: noop,
  onDone: noop,
}));
assert.match(marker, /aria-label="Put the marker away"[^>]*class="[^"]*h-11 w-11/);
assert.match(marker, /aria-label="Remove mark:[^"]*"[^>]*class="[^"]*h-11 w-11/);
assert.match(marker, /min-w-0 max-w-full/, "Marked text cannot push the mobile composer outside its width");

const headerProps: ComponentProps<typeof SessionHeader> = {
  boardTitle: "Surface area and volume of a square pyramid",
  showNavButton: true,
  onExpandSidebar: noop,
  canReplay: true,
  canDownload: true,
  canDownloadLecture: true,
  isReplaying: false,
  isDownloading: false,
  isExportingLecture: false,
  lectureExportProgress: null,
  lectureExportError: null,
  phase: "speaking",
  showNotesToggle: true,
  onToggleNotes: noop,
  onToggleFullscreen: noop,
  onReplay: noop,
  onDownload: noop,
  onDownloadLecture: noop,
  onCancelLectureExport: noop,
  onStop: noop,
};

for (const overlay of [false, true]) {
  const header = renderToStaticMarkup(createElement(SessionHeader, {
    ...headerProps,
    compactActions: true,
    overlay,
  }));
  assert.ok(header.includes(headerProps.boardTitle));
  assert.match(header, /wb-session-header-layout/, "The compact header exposes the scoped landscape layout hook");
  assert.match(header, /flex flex-col items-stretch gap-2/, "The compact title has its own row");
  assert.match(header, /line-clamp-2 break-words/, "Long board titles wrap within the mobile header");
  assert.match(header, /flex-wrap justify-between/, "Compact header actions wrap instead of pushing the title offscreen");
  assert.match(header, /aria-label="Replay lecture"[^>]*class="[^"]*h-11 w-11/, "Compact replay remains touch-sized");
}

const desktopHeader = renderToStaticMarkup(createElement(SessionHeader, headerProps));
assert.match(desktopHeader, /flex flex-nowrap items-center gap-2 sm:gap-3/, "Desktop retains the single-row header");
assert.match(desktopHeader, /block truncate/, "Desktop title truncation stays unchanged");

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
assert.match(
  css,
  /@media \(max-height: 500px\) and \(orientation: landscape\)\s*\{\s*\.wb-session-chrome--top\s*\{\s*padding-top: 3px;\s*padding-bottom: 3px;\s*\}\s*\.wb-session-chrome--top \.wb-session-header-layout\s*\{\s*flex-direction: row;\s*align-items: center;/,
  "Only the short-landscape overlay header is single-row, leaving work rows clear without resizing the board",
);
assert.match(css, /\.wb-session-chrome--top \.wb-session-header-title\s*\{\s*line-height: 1\.25;/, "Wrapped overlay titles remain within the 44px control row");

Reflect.deleteProperty(globalThis, "React");

console.log("verify-mobile-controls: readable titles, visible live/paused/marked doubt labels, touch targets, and desktop layout passed");
