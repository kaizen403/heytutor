import { isTeachingResponseIncomplete } from "../features/tutor-session/lib/segmentPlanning";

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

console.log("verify-segment-planning: STEP completeness checks passed");
