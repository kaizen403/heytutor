import {
  buildLessonNotes,
  formatLessonNotesForPrompt,
  formatPlanFact,
  lessonNotesAreEmpty,
  notesFromLiveInput,
  notesFromStoredTurn,
  planFactsFromSceneArtifacts,
  workLinesFromCommands,
} from "../../features/tutor-session/lib/lessonNotes";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import type { DrawCommand, TutorSegment } from "@heytutor/drawing";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const write = (text: string): DrawCommand => ({
  type: "WRITE",
  params: [90, 145],
  text,
  charPosition: 0,
  narrationBefore: "",
});

const lines = workLinesFromCommands([
  write("v^2 = u^2 - 2gH"),
  { type: "FOCUS", params: [], charPosition: 0, narrationBefore: "", text: "image" },
  write("v^2 = u^2 - 2gH"),
  write("v = 10 m/s"),
]);
assert(lines.length === 2, "work lines must skip focus and consecutive duplicates");
assert(lines[0] === "v^2 = u^2 - 2gH", "first write must be kept");
assert(lines[1] === "v = 10 m/s", "later write must be kept");

const artifacts = {
  turnPlan: {
    givens: [{ id: "u", symbol: "u", value: 20, unit: "cm" }],
    derived: [{ id: "v", symbol: "v", value: 60, unit: "cm" }],
  },
};
const facts = planFactsFromSceneArtifacts(artifacts);
assert(facts.length === 2, "givens and derived must become plan facts");
assert(formatPlanFact(facts[0]!) === "u = 20 cm", "plan facts must keep symbol value unit");

const stored: StoredTurn = {
  id: "t1",
  orderIndex: 0,
  question: "find v",
  rawResponse: "[STEP]so v equals sixty centimeters. [WRITE:v = 60 cm,90,205][/STEP]",
  speedMultiplier: 1,
  traceId: null,
  sceneDocument: null,
  sceneEngineVersion: null,
  validationReport: null,
  visualStatus: "validated",
  sceneArtifacts: artifacts,
  segments: [
    {
      id: "s1",
      orderIndex: 0,
      narration: "so v equals sixty centimeters.",
      spokenText: "so v equals sixty centimeters.",
      command: write("v = 60 cm"),
      audioUrl: null,
      durationMs: 800,
      timings: null,
    },
  ],
};

const fromStored = notesFromStoredTurn(stored);
assert(fromStored.question === "find v", "stored question must be kept");
assert(fromStored.workLines.includes("v = 60 cm"), "stored WRITE text is the note line");
assert(fromStored.narration.includes("sixty"), "stored narration must be kept");
assert(fromStored.planFacts.some((fact) => fact.id === "v"), "stored plan facts must be kept");

const liveSegments: TutorSegment[] = [
  { narration: "the mirror equation.", command: write("1/f = 1/u + 1/v") },
];
const live = notesFromLiveInput({
  question: "find v",
  collectedSegments: liveSegments,
  recordedSegments: [],
  currentSegmentText: "substitute the given distances.",
});
assert(live.workLines[0] === "1/f = 1/u + 1/v", "live WRITE text must appear as notes");
assert(live.narration.includes("substitute"), "current spoken segment must join live notes");

const empty = buildLessonNotes({ persistedTurns: [], lectureInProgress: false });
assert(lessonNotesAreEmpty(empty), "a fresh board has empty notes");

const during = buildLessonNotes({
  persistedTurns: [],
  lectureInProgress: true,
  live: {
    question: "find v",
    collectedSegments: liveSegments,
    recordedSegments: [],
  },
});
assert(during.turns.length === 1, "live notes must appear before persist");
assert(during.lectureInProgress, "live snapshot must mark the lecture in progress");

const afterSave = buildLessonNotes({
  persistedTurns: [stored],
  lectureInProgress: false,
  live: {
    question: "find v",
    collectedSegments: [{ narration: stored.segments[0]!.narration, command: write("v = 60 cm") }],
    recordedSegments: [],
  },
});
assert(afterSave.turns.length === 1, "saved notes must not duplicate once the lecture is idle");

const prompt = formatLessonNotesForPrompt(during);
assert(prompt.includes("board work:"), "prompt must list board work lines");
assert(prompt.includes("1/f = 1/u + 1/v"), "prompt must include the WRITE string");
assert(/still in progress/i.test(prompt), "in-progress notes must say the lecture is ongoing");

console.log("lesson notes verification passed");
