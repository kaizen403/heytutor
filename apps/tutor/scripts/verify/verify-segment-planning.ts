import { foldGluedSegment, isTeachingResponseIncomplete, orderCommandsBySpokenAnchor } from "../../features/tutor-session/lib/turn/segmentPlanning";
import type { DrawCommand, TutorSegment } from "@heytutor/drawing";
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

// A tag glued after another tag folds into the sentence before it on the live
// stream, the way the offline planner already does, so [EMPHASIZE:last] and a
// trailing [FOCUS] run inside the row's sentence instead of in silence after it.
{
  const command = (type: DrawCommand["type"], text: string): DrawCommand => ({
    type,
    text,
    params: [90, 142],
    charPosition: 0,
    narrationBefore: "",
  });
  const row = command("WRITE", "v = 60 cm");
  const buffered: TutorSegment = { narration: "so v equals sixty centimeters.", command: row, commands: [row] };
  const glued: TutorSegment = { narration: "", command: command("EMPHASIZE", "last"), commands: [command("EMPHASIZE", "last")] };
  if (!foldGluedSegment(buffered, glued, { codeLesson: false })) {
    throw new Error("a glued EMPHASIZE must fold into the buffered row segment");
  }
  if ((buffered.commands?.length ?? 0) !== 2 || buffered.commands?.[1]?.type !== "EMPHASIZE") {
    throw new Error("the folded segment must carry the row then the glued tag");
  }
  const spoken: TutorSegment = { narration: "notice the image I.", command: command("FOCUS", "I_base"), commands: [command("FOCUS", "I_base")] };
  if (foldGluedSegment(buffered, spoken, { codeLesson: false })) {
    throw new Error("a tag with its own words is a segment of its own");
  }
  const gluedFrame: TutorSegment = { narration: "", command: command("FOCUS", "frame_2|spotlight"), commands: [command("FOCUS", "frame_2|spotlight")] };
  const typed: TutorSegment = { narration: "this block sets up the search.", command: command("TYPE", "b1"), commands: [command("TYPE", "b1")] };
  if (foldGluedSegment(typed, gluedFrame, { codeLesson: true })) {
    throw new Error("a code lesson keeps one tag per segment for the conductor");
  }
  const intro: TutorSegment = { narration: "the mirror and its axis.", command: command("DRAW_LINE", ""), commands: [command("DRAW_LINE", "")], verifiedDiagramIntro: true };
  if (foldGluedSegment(intro, glued, { codeLesson: false })) {
    throw new Error("nothing folds into a figure intro");
  }
  if (foldGluedSegment(null, glued, { codeLesson: false })) {
    throw new Error("nothing to fold into means no fold");
  }
}

// Commands run in the order their words are spoken. A row anchored at 7.5 s
// runs after the two gestures whose names come at 0.7 s and 4.1 s, and an
// EMPHASIZE with no word of its own stays right after the row it boxes.
{
  const order = orderCommandsBySpokenAnchor([7500, null, 685, 4122]);
  if (order.join(",") !== "2,3,0,1") {
    throw new Error(`commands must run in spoken order with wordless tags trailing their row, got ${order.join(",")}`);
  }
  if (orderCommandsBySpokenAnchor([null, null]).join(",") !== "0,1") {
    throw new Error("commands with no words keep tag order");
  }
  if (orderCommandsBySpokenAnchor([3000, 3000, 100]).join(",") !== "2,0,1") {
    throw new Error("ties keep tag order");
  }
}

console.log("verify-segment-planning: STEP completeness, glued-tag fold and spoken-order checks passed");
