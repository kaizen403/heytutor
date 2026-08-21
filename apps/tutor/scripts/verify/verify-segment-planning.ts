import { isTeachingResponseIncomplete } from "../../features/tutor-session/lib/segmentPlanning";

const truncatedStep = "[STEP]Notice A. [FOCUS:a]";
if (!isTeachingResponseIncomplete(truncatedStep, truncatedStep)) {
  throw new Error("open STEP without [/STEP] must be incomplete");
}

const closedStep = "[STEP]Notice A. [FOCUS:a][/STEP]";
if (isTeachingResponseIncomplete(closedStep, closedStep)) {
  throw new Error("closed STEP ending in [/STEP] must be complete");
}

const inlineWrite = "Write the value. [WRITE:x,10,20]";
if (isTeachingResponseIncomplete(inlineWrite, inlineWrite)) {
  throw new Error("non-STEP response ending in a tag ] must still be complete");
}

const longClosedLesson = `${"[STEP]a complete beginner idea. [WRITE:DP,90,145][/STEP]\n".repeat(120)}`.trim();
if (longClosedLesson.length < 6000) {
  throw new Error("long closed-lesson fixture must exceed the old 6000-char truncation heuristic");
}
if (isTeachingResponseIncomplete(longClosedLesson, longClosedLesson)) {
  throw new Error("a long response of closed STEP blocks must be treated as complete");
}

console.log("verify-segment-planning: STEP completeness checks passed");
