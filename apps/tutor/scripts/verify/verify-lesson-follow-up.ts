import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TUTOR_SYSTEM_PROMPT } from "@heytutor/tutor-core";
import {
  PAUSED_LECTURE_ANOTHER_DOUBT_LABEL,
  PAUSED_LECTURE_BODY,
  PAUSED_LECTURE_CONTINUE_LABEL,
  PAUSED_LECTURE_TITLE,
  QUESTION_FIELD_SELECTOR,
  lessonFollowUpMode,
} from "../../features/tutor-session/lib/turn/lessonFollowUp";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(lessonFollowUpMode(false) === "ask", "a fresh board must only ask");
assert(lessonFollowUpMode(true) === "follow-up", "a finished lesson must offer doubt or next question");
assert(
  /after the last result, stop/i.test(TUTOR_SYSTEM_PROMPT),
  "teaching must stop after the last result instead of writing more",
);

assert(PAUSED_LECTURE_TITLE === "Lecture paused", "the paused lecture title is plain");
assert(
  PAUSED_LECTURE_BODY.includes("Continue the original lesson") &&
    PAUSED_LECTURE_BODY.includes("ask another doubt"),
  "after a doubt the student chooses to continue or ask again",
);
assert(PAUSED_LECTURE_CONTINUE_LABEL === "Continue lecture", "continue is the primary action");
assert(PAUSED_LECTURE_ANOTHER_DOUBT_LABEL === "Ask another doubt", "another doubt stays available");
assert(!/[—–]| - /.test(`${PAUSED_LECTURE_TITLE} ${PAUSED_LECTURE_BODY}`), "paused lecture copy carries no dash punctuation");
assert(QUESTION_FIELD_SELECTOR === "[data-question-field]", "Ask another doubt focuses the same composer");

const root = resolve(import.meta.dirname, "../..");
const chrome = readFileSync(resolve(root, "features/tutor-session/components/SessionInputChrome.tsx"), "utf8");
assert(chrome.includes("PausedLectureBar"), "the composer shows the paused lecture offer");
assert(chrome.includes("onContinueLecture"), "Continue lecture is wired through the composer");
const bar = readFileSync(resolve(root, "features/tutor-session/components/PausedLectureBar.tsx"), "utf8");
assert(bar.includes("PAUSED_LECTURE_CONTINUE_LABEL"), "the bar offers Continue lecture");
assert(bar.includes("PAUSED_LECTURE_ANOTHER_DOUBT_LABEL"), "the bar offers Ask another doubt");
assert(bar.includes("focusQuestionField"), "Ask another doubt lands in the composer");
const shell = readFileSync(resolve(root, "features/tutor-session/TutorSessionShell.tsx"), "utf8");
assert(shell.includes("pausedLessonOffer"), "the session surfaces the paused lecture offer");
assert(shell.includes("flushPausedLesson"), "Continue lecture resumes the paused lesson");

console.log("lesson follow-up verification passed");
