import {
  collectSelectableNotes,
  defaultTaggedQuestion,
  formatNotesChatTagPrompt,
  formatTaggedUserMessage,
  parseNotesChatTag,
} from "../../features/tutor-session/lib/notesChatTag";
import type { LessonNotesSnapshot } from "../../features/tutor-session/lib/lessonNotes";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const notes: LessonNotesSnapshot = {
  lectureInProgress: false,
  turns: [
    {
      question: "find v",
      workLines: ["1/f = 1/u + 1/v", "v = 60 cm", "v = 60 cm"],
      narration: "so v equals sixty centimeters.",
      planFacts: [],
    },
  ],
};

const parsed = parseNotesChatTag({ kind: "work", text: "  v = 60 cm  ", turnIndex: 0 });
assert(parsed?.kind === "work" && parsed.text === "v = 60 cm", "a work tag must keep the board line");
assert(parseNotesChatTag({ kind: "draw", text: "v = 60 cm" }) === null, "unknown kinds are rejected");
assert(parseNotesChatTag({ kind: "work", text: "" }) === null, "an empty tag is not a tag");

const selectable = collectSelectableNotes(notes);
assert(selectable.some((tag) => tag.kind === "question" && tag.text === "find v"), "the question is selectable");
assert(
  selectable.filter((tag) => tag.text === "v = 60 cm").length === 1,
  "duplicate work lines become one tag",
);
assert(!selectable.some((tag) => tag.kind === "narration"), "spoken prose is not a selectable line");

const tagged = formatTaggedUserMessage("why is v positive?", parsed);
assert(tagged.includes("v = 60 cm"), "the tagged line must reach the model");
assert(tagged.includes("why is v positive?"), "the student's question must still be sent");
assert(
  formatNotesChatTagPrompt(parsed!).includes("board work line"),
  "the prompt must say which kind of line was tagged",
);
assert(defaultTaggedQuestion(parsed!) === "explain this line", "a tagged send without text still asks about the line");

console.log("notes chat tag verification passed");
