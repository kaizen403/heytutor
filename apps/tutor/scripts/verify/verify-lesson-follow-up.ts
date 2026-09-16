import { TUTOR_SYSTEM_PROMPT } from "@heytutor/tutor-core";
import { lessonFollowUpMode } from "../../features/tutor-session/lib/turn/lessonFollowUp";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(lessonFollowUpMode(false) === "ask", "a fresh board must only ask");
assert(lessonFollowUpMode(true) === "follow-up", "a finished lesson must offer doubt or next question");
assert(
  /after the last result, stop/i.test(TUTOR_SYSTEM_PROMPT),
  "teaching must stop after the last result instead of writing more",
);

console.log("lesson follow-up verification passed");
