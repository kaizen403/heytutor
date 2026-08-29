import {
  buildNotesPdfSections,
  pdfSafeText,
} from "../../features/tutor-session/lib/notesPdf";
import type { LessonTurnNotes } from "../../features/tutor-session/lib/lessonNotes";
import type { NotesEpoch } from "../../lib/client/exportNotesPdf";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function turn(question: string, workLines: string[] = [], narration = ""): LessonTurnNotes {
  return { question, workLines, narration, planFacts: [] };
}

function page(question: string, image: string, narrationText = ""): NotesEpoch {
  return { index: 0, question, snapshotDataUrl: image, narrationText, timestampMs: 0 };
}

const mirror = turn("find v", ["1/f = 1/u + 1/v", "v = 60 cm"], "so v equals sixty centimeters.");
const incline = turn("find a", ["a = g sin θ"], "the block slides down.");

const live = buildNotesPdfSections(
  [mirror, incline],
  [page("find v", "img-v"), page("find a", "img-a-final")],
);
assert(live.length === 2, "one section per taught question");
assert(live[0]!.images[0] === "img-v" && live[0]!.workLines[1] === "v = 60 cm", "the page joins its turn's work lines");
assert(live[0]!.narration === mirror.narration, "a saved turn supplies the complete narration");
assert(live[1]!.images[0] === "img-a-final" && !live[1]!.interrupted, "the final board page belongs to the last turn");

const reloaded = buildNotesPdfSections([mirror, incline, turn("find t")], [page("find t", "img-t")]);
assert(reloaded.length === 3, "a reloaded board keeps every saved turn");
assert(reloaded[0]!.images.length === 0 && reloaded[0]!.workLines.length === 2, "turns without a page still print their work");
assert(reloaded[2]!.images[0] === "img-t", "the restored board page belongs to the last turn");
assert(reloaded.map((section) => section.question).join("|") === "find v|find a|find t", "teaching order is kept");

const interrupted = buildNotesPdfSections(
  [mirror, turn("i have a doubt about the question \"find a\". my doubt: why sin")],
  [
    page("find v", "img-v"),
    page("find a", "img-a-partial", "we started with newton's second law."),
    page("i have a doubt about the question \"find a\". my doubt: why sin", "img-doubt"),
  ],
);
assert(interrupted.length === 3, "an interrupted lesson still gets its own section");
assert(interrupted[1]!.interrupted && interrupted[1]!.images[0] === "img-a-partial", "the interrupted page is marked");
assert(interrupted[1]!.narration.includes("newton"), "an interrupted lesson keeps what the student heard");
assert(!interrupted[2]!.interrupted, "the doubt turn that was saved is a normal section");

const grouped = buildNotesPdfSections([mirror], [page("find v", "img-1"), page("find v", "img-2")]);
assert(grouped.length === 1 && grouped[0]!.images.length === 2, "a mid-lesson erase gives one turn two pages");

assert(buildNotesPdfSections([], []).length === 0, "nothing to export on a fresh board");
assert(
  buildNotesPdfSections([], [page("", "img-blank")])[0]!.interrupted,
  "a page with no owner is never attributed to a turn",
);

assert(pdfSafeText("∫_(-2)^(2) x² dx = θ") === "int _(-2)^(2) x² dx = theta", "board maths must spell out glyphs the PDF font lacks");
assert(pdfSafeText("v = 60 cm") === "v = 60 cm", "plain text is untouched");
assert(pdfSafeText("नमस्ते x") === "? x", "unsupported scripts are marked once, not as a wall of marks");
assert(pdfSafeText("a − b → c") === "a - b -> c", "minus and arrows map to ascii");

console.log("notes pdf verification passed");
