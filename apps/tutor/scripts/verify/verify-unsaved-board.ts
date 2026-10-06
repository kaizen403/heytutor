/**
 * An unsaved board tells the truth: it shows the question it was asked, says
 * plainly the lesson was not saved, and offers Teach it again (exact question
 * sent, a bare topic only prefilled) and Ask something else. It never looks
 * like the home landing. A failed save says so in the header and in a banner
 * whose Try again resends the save and never teaches again.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  unsavedLessonBoard,
  unsavedNoticeAction,
  type UnsavedBoardInput,
} from "../../features/tutor-session/lib/board/unsavedBoard";
import {
  UNSAVED_BOARD_COPY,
  UnsavedBoardNotice,
} from "../../features/tutor-session/components/UnsavedBoardNotice";
import { SAVE_COPY, SaveStatusChip } from "../../features/tutor-session/components/SaveStatusChip";
import {
  BoardErrorBanner,
  SAVE_FAILURE_ACTION,
  SAVE_FAILURE_MESSAGE,
  SaveFailureBanner,
} from "../../features/tutor-session/components/BoardErrorBanner";
import { SessionHeader } from "../../features/tutor-session/components/SessionHeader";

Object.defineProperty(globalThis, "React", { value: React, configurable: true });

const noop = () => {};
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const base: UnsavedBoardInput = {
  isDraft: false,
  boardLoaded: true,
  title: "Projectile range on a slope",
  preview: "",
  turns: [],
  pendingQuestion: null,
};

// 1. The predicate.
assert.equal(unsavedLessonBoard({ ...base, isDraft: true }), null, "the home draft is the landing");
assert.equal(unsavedLessonBoard({ ...base, boardLoaded: false }), null, "nothing is decided before restore");
assert.equal(unsavedLessonBoard({ ...base, title: "New board" }), null, "the unknown id fallback stays a fresh board");
assert.equal(unsavedLessonBoard({ ...base, title: "  " }), null);
assert.equal(
  unsavedLessonBoard({ ...base, turns: [{ question: "Why is the sky blue?", segmentCount: 3 }] }),
  null,
  "a board with ink is a normal board",
);
assert.equal(
  unsavedLessonBoard({
    ...base,
    turns: [
      { question: "First", segmentCount: 0 },
      { question: "Second", segmentCount: 2 },
    ],
  }),
  null,
  "any turn with ink means there is a board to show",
);

const titleOnly = unsavedLessonBoard(base);
assert.deepEqual(titleOnly, { question: null, title: "Projectile range on a slope" }, "a real title with no turns is unsaved");
assert.deepEqual(unsavedNoticeAction(titleOnly!), { text: "Projectile range on a slope", exact: false }, "a bare title only prefills");

const stoppedTurn = unsavedLessonBoard({
  ...base,
  preview: "A ball is thrown at 20 m/s up a 30 degree slope. Find the ra",
  turns: [{ question: "A ball is thrown at 20 m/s up a 30 degree slope.\nFind the range.", segmentCount: 0 }],
  pendingQuestion: "something older",
});
assert.ok(stoppedTurn);
assert.equal(
  stoppedTurn.question,
  "A ball is thrown at 20 m/s up a 30 degree slope.\nFind the range.",
  "a stopped turn's exact question wins over the pending question and the cut preview, line breaks kept",
);
assert.equal(stoppedTurn.title, "Projectile range on a slope", "the title rides above the question");
assert.deepEqual(unsavedNoticeAction(stoppedTurn), { text: stoppedTurn.question, exact: true }, "an exact question is sent");

const pending = unsavedLessonBoard({ ...base, preview: "cut", pendingQuestion: "  What is torque?  " });
assert.deepEqual(pending, { question: "What is torque?", title: "Projectile range on a slope" }, "the pending question beats the preview");

const previewOnly = unsavedLessonBoard({ ...base, preview: "A ball is thrown at 20 m/s up a 30 degree" });
assert.deepEqual(
  previewOnly,
  { question: null, title: "A ball is thrown at 20 m/s up a 30 degree" },
  "the cut preview is closer to the question than the title, but only prefills",
);
assert.equal(unsavedNoticeAction(previewOnly!).exact, false);
assert.equal(
  unsavedLessonBoard({ ...base, title: "What is torque?", pendingQuestion: "what is torque?" })?.title,
  "",
  "a title equal to the question is not repeated",
);
assert.deepEqual(
  unsavedLessonBoard({ ...base, title: "New board", turns: [{ question: "Why?", segmentCount: 0 }] }),
  { question: "Why?", title: "" },
  "a kept question shows even under a placeholder title",
);

// 2. The notice.
function notice(question: string | null, title: string): string {
  return renderToStaticMarkup(
    createElement(UnsavedBoardNotice, { question, title, onTeachAgain: noop, onAskSomethingElse: noop }),
  );
}
const exact = notice("Why is the sky blue?", "Rayleigh scattering");
assert.match(exact, /<h2[^>]*>Why is the sky blue\?<\/h2>/, "the question is the heading");
assert.match(exact, />Rayleigh scattering</, "the title sits above it");
assert.match(exact, /was not saved/);
assert.ok(exact.includes(UNSAVED_BOARD_COPY.statusExact));
assert.match(exact, />Teach it again</);
assert.match(exact, />Ask something else</);
assert.match(exact, /data-unsaved-board="question"/);
const topic = notice(null, "Rayleigh scattering");
assert.match(topic, /<h2[^>]*>Rayleigh scattering<\/h2>/, "only a title: the title is the heading");
assert.ok(topic.includes(UNSAVED_BOARD_COPY.statusTopic));
assert.match(topic, />Teach it again</);
assert.match(topic, /data-unsaved-board="topic"/);
for (const markup of [exact, topic]) {
  assert.doesNotMatch(markup, /ac-landing|What are you stuck on|LandingPixel|doodle/i, "nothing that says home");
}
const noticeSource = read("features/tutor-session/components/UnsavedBoardNotice.tsx");
assert.match(noticeSource, /onTeachAgain\(heading, \{ exact \}\)/, "Teach it again hands over the text and whether it is exact");
assert.match(noticeSource, /unsavedNoticeAction\(/, "the notice decides exactness with the gated helper");
for (const line of Object.values(UNSAVED_BOARD_COPY)) {
  assert.doesNotMatch(line, / - | – | — |—|–/, `no dash as punctuation: "${line}"`);
}

// 3. Header: the subtitle says "Not saved", and the save chip renders SaveStatus.
const headerProps = {
  boardTitle: "Rayleigh scattering",
  onExpandSidebar: noop,
  canReplay: false,
  isReplaying: false,
  phase: "idle" as const,
  onReplay: noop,
  onStop: noop,
};
assert.match(
  renderToStaticMarkup(createElement(SessionHeader, { ...headerProps, boardStatus: "unsaved" })),
  />Not saved<\/p>/,
  "an unsaved board's subtitle says so",
);
assert.match(renderToStaticMarkup(createElement(SessionHeader, headerProps)), />Whiteboard session<\/p>/);
const failedHeader = renderToStaticMarkup(
  createElement(SessionHeader, {
    ...headerProps,
    saveStatus: { kind: "failed", message: "500" },
    onRetrySave: noop,
  }),
);
assert.match(failedHeader, /data-save-status="failed"/);
assert.match(failedHeader, />Not saved</);
assert.match(failedHeader, /text-warning/);
assert.doesNotMatch(failedHeader, /text-danger/, "a failed save is a warning, not the danger face");

function chip(status: Parameters<typeof SaveStatusChip>[0]["status"], compact = false): string {
  return renderToStaticMarkup(createElement(SaveStatusChip, { status, onRetrySave: noop, compact }));
}
assert.equal(chip({ kind: "idle" }), "", "nothing at stake, nothing shown");
assert.equal(chip({ kind: "saving" }), "", "a fast save never flickers: Saving waits 600ms");
assert.match(chip({ kind: "saved", at: Date.now() }), />Saved</);
assert.match(chip({ kind: "saved", at: Date.now() }), /aria-label="Lesson saved"/);
assert.match(chip({ kind: "offline" }), />Offline</);
assert.match(chip({ kind: "failed", message: "x" }), /aria-label="Lesson not saved\. Show details"/);
const compactFailed = chip({ kind: "failed", message: "x" }, true);
assert.doesNotMatch(compactFailed, />Not saved</, "compact is icon only");
assert.match(compactFailed, /h-11 w-11/, "compact keeps a 44px target");
const chipSource = read("features/tutor-session/components/SaveStatusChip.tsx");
assert.match(chipSource, /onRetrySave\(\)/, "the chip's Try again resends the save");
assert.doesNotMatch(chipSource, /onRetryError|handleQuestion/, "the chip never re-asks the question");
for (const line of Object.values(SAVE_COPY)) {
  assert.doesNotMatch(line, / - | – | — |—|–/, `no dash as punctuation: "${line}"`);
}

// 4. The banner: the lesson error face, with its own action.
const retrySave = () => {};
const dismiss = () => {};
const banner = SaveFailureBanner({ onRetrySave: retrySave, onDismiss: dismiss });
assert.ok(isValidElement(banner));
assert.equal(banner.type, BoardErrorBanner, "a save failure reuses the board banner");
const bannerProps = banner.props as Parameters<typeof BoardErrorBanner>[0];
assert.equal(bannerProps.onRetry, retrySave, "Try again resends the save; it is never the re-ask callback");
assert.equal(bannerProps.onDismiss, dismiss);
assert.equal(bannerProps.message, "This lesson did not save.");
assert.equal(bannerProps.actionLabel, "Try again");
assert.equal(SAVE_FAILURE_MESSAGE, "This lesson did not save.");
assert.equal(SAVE_FAILURE_ACTION, "Try again");
const bannerMarkup = renderToStaticMarkup(banner);
assert.match(bannerMarkup, /role="alert"/);
assert.match(bannerMarkup, />This lesson did not save\.</);
assert.match(bannerMarkup, />Try again</);
assert.match(
  renderToStaticMarkup(createElement(BoardErrorBanner, { message: "m", onRetry: noop, onDismiss: noop })),
  />Retry</,
  "the lesson error banner keeps its Retry",
);

// 5. The shell, once wired: an unsaved board never falls through to the landing.
const shell = read("features/tutor-session/TutorSessionShell.tsx");
if (shell.includes("unsavedLessonBoard")) {
  assert.match(shell, /showEmptyLanding\s*=[^;]*!unsavedBoard/, "showEmptyLanding must exclude the unsaved board");
  assert.match(shell, /<UnsavedBoardNotice/, "the shell renders the notice");
} else {
  console.log("verify-unsaved-board: shell not wired yet (coordinator); the shell check is pending");
}

Reflect.deleteProperty(globalThis, "React");
console.log("verify-unsaved-board: honest unsaved board, exact question sent or topic prefilled, save chip and banner never re-teach");
