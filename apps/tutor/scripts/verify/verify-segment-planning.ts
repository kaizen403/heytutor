import { isTeachingResponseIncomplete } from "../../features/tutor-session/lib/turn/segmentPlanning";
import {
  speakSegmentTimeoutMs,
  TTS_SEGMENT_TIMEOUT_CEILING_MS,
} from "../../features/tutor-session/lib/turn/ttsSegmentTimeout";

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

const longParagraph = "x".repeat(200);
const longTimeout = speakSegmentTimeoutMs(longParagraph);
if (longTimeout <= 18_000) {
  throw new Error(
    `a 200-character DSA step must outlive the old 18s TTS cap, got ${longTimeout}ms`,
  );
}
if (speakSegmentTimeoutMs("x".repeat(4000)) !== TTS_SEGMENT_TIMEOUT_CEILING_MS) {
  throw new Error("an extra-long line must still cap so a hung request cannot stall the turn");
}
if (speakSegmentTimeoutMs("Hi.") < 12_000) {
  throw new Error("a short line still needs a first-chunk budget");
}

console.log("verify-segment-planning: STEP completeness checks passed");
