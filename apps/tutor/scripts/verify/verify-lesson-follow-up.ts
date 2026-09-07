import { TUTOR_SYSTEM_PROMPT } from "@heytutor/tutor-core";
import {
  LESSON_DONE_PROMPT,
  lessonFollowUpMode,
} from "../../features/tutor-session/lib/turn/lessonFollowUp";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(lessonFollowUpMode(false) === "ask", "a fresh board must only ask");
assert(lessonFollowUpMode(true) === "follow-up", "a finished lesson must offer doubt or next question");
assert(LESSON_DONE_PROMPT.includes("doubt"), "the follow-up prompt must offer a doubt");
assert(LESSON_DONE_PROMPT.includes("next question"), "the follow-up prompt must offer the next question");
assert(
  /after the last result, stop/i.test(TUTOR_SYSTEM_PROMPT),
  "teaching must stop after the last result instead of writing more",
);

console.log("lesson follow-up verification passed");
