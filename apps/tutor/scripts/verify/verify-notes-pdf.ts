import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";
import {
  buildNotesPdfSections,
  notesPdfSectionsFromStoredTurns,
  pdfSafeText,
} from "../../features/tutor-session/lib/notesPdf";
import type { LessonTurnNotes } from "../../features/tutor-session/lib/lessonNotes";
import type { NotesEpoch } from "../../lib/client/exportNotesPdf";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { NOTES_PDF_FONT_FAMILY, registerNotesPdfFont } from "../../lib/client/notesPdfFont";

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

assert(
  pdfSafeText("∫_(-2)^(2) x² dx = θ").includes("∫") && pdfSafeText("∫_(-2)^(2) x² dx = θ").includes("θ"),
  "embedded notes font keeps integral and theta",
);
assert(pdfSafeText("√2") === "√2", "sqrt stays a real glyph");
assert(pdfSafeText("v = 60 cm") === "v = 60 cm", "plain text is untouched");
assert(pdfSafeText("नमस्ते x") === "? x", "unsupported scripts are marked once, not as a wall of marks");
assert(pdfSafeText("a − b → c") === "a − b → c", "minus and arrows stay as glyphs");
assert(pdfSafeText("R_1") === "R₁", "board markup becomes a real subscript in the PDF");

const stored: StoredTurn[] = [
  {
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
    sceneArtifacts: null,
    segments: [
      {
        id: "s1",
        orderIndex: 0,
        narration: "so v equals sixty centimeters.",
        spokenText: "so v equals sixty centimeters.",
        command: { type: "WRITE", params: [90, 205], text: "v = 60 cm", charPosition: 0, narrationBefore: "" },
        audioUrl: null,
        durationMs: 800,
        timings: null,
      },
    ],
  },
  {
    id: "t2",
    orderIndex: 1,
    question: "find a",
    rawResponse: "[STEP]the block slides. [WRITE:a = g sin θ,90,205][/STEP]",
    speedMultiplier: 1,
    traceId: null,
    sceneDocument: null,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: "validated",
    sceneArtifacts: null,
    segments: [
      {
        id: "s2",
        orderIndex: 0,
        narration: "the block slides.",
        spokenText: "the block slides.",
        command: { type: "WRITE", params: [90, 205], text: "a = g sin θ", charPosition: 0, narrationBefore: "" },
        audioUrl: null,
        durationMs: 400,
        timings: null,
      },
    ],
  },
];
const fromDb = notesPdfSectionsFromStoredTurns(stored, [page("find a", "img-last")]);
assert(fromDb.length === 2, "a reloaded board builds one section per stored turn");
assert(fromDb[0]!.workLines.includes("v = 60 cm") && fromDb[0]!.narration.includes("sixty"), "earlier turns still print work and narration");
assert(fromDb[1]!.images[0] === "img-last" && fromDb[1]!.workLines[0] === "a = g sin θ", "the last snapshot joins its stored turn");

const fontPath = resolve(import.meta.dirname, "../../public/fonts/notes-pdf.ttf");
const fontBytes = readFileSync(fontPath);
assert(fontBytes.length > 1000, "the notes PDF font must be on disk");
const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
const chunk = 0x8000;
let binary = "";
for (let i = 0; i < fontBytes.length; i += chunk) {
  binary += String.fromCharCode(...fontBytes.subarray(i, i + chunk));
}
registerNotesPdfFont(doc, binary);
doc.setFont(NOTES_PDF_FONT_FAMILY, "normal");
doc.setFontSize(14);
doc.text("∫ θ √ π", 40, 60);
const pdf = doc.output();
assert(pdf.includes(NOTES_PDF_FONT_FAMILY) || pdf.includes("HeyTutorNotes"), "the notes font must be embedded");
assert(!pdf.includes("int  theta sqrt"), "maths must not be ASCII-folded in the exported PDF");

console.log("notes pdf verification passed");
