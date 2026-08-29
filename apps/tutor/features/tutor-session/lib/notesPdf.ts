import type { NotesEpoch } from "@/lib/client/exportNotesPdf";
import { formatPlanFact, type LessonTurnNotes } from "./lessonNotes";

export interface NotesPdfSection {
  question: string;
  /** Board pages captured while this question was on the board, in order. */
  images: string[];
  workLines: string[];
  narration: string;
  /** Formatted `symbol = value unit` facts from the turn plan. */
  planFacts: string[];
  /** The lesson was stopped (a doubt or Stop) before it was saved. */
  interrupted: boolean;
}

function sectionFromTurn(turn: LessonTurnNotes, images: string[]): NotesPdfSection {
  return {
    question: turn.question,
    images,
    workLines: [...turn.workLines],
    narration: turn.narration,
    planFacts: turn.planFacts.map(formatPlanFact),
    interrupted: false,
  };
}

function joinNarration(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pair board pages with the lesson that drew them, in teaching order.
 *
 * A page tags the question whose ink it shows. A saved turn supplies the full
 * work lines and narration for its pages; pages from a lesson that was stopped
 * before it was saved keep only what the student actually heard. A saved turn
 * with no page at all (a board restored after a reload) still gets its text.
 */
export function buildNotesPdfSections(
  turns: readonly LessonTurnNotes[],
  epochs: readonly NotesEpoch[],
): NotesPdfSection[] {
  const sections: NotesPdfSection[] = [];
  let nextTurn = 0;
  let index = 0;
  while (index < epochs.length) {
    const question = epochs[index]!.question.trim();
    const pages: NotesEpoch[] = [];
    while (index < epochs.length && epochs[index]!.question.trim() === question) {
      pages.push(epochs[index]!);
      index += 1;
    }
    const images = pages.map((page) => page.snapshotDataUrl);
    const match = question
      ? turns.findIndex((turn, turnIndex) => turnIndex >= nextTurn && turn.question === question)
      : -1;
    if (match === -1) {
      sections.push({
        question,
        images,
        workLines: [],
        narration: joinNarration(pages.map((page) => page.narrationText)),
        planFacts: [],
        interrupted: true,
      });
      continue;
    }
    for (let skipped = nextTurn; skipped < match; skipped += 1) {
      sections.push(sectionFromTurn(turns[skipped]!, []));
    }
    sections.push(sectionFromTurn(turns[match]!, images));
    nextTurn = match + 1;
  }
  for (let rest = nextTurn; rest < turns.length; rest += 1) {
    sections.push(sectionFromTurn(turns[rest]!, []));
  }
  return sections;
}

/**
 * jsPDF's built-in fonts only cover Latin-1, so board maths written with
 * unicode operators (∫, θ, √, →) would print as blanks. Spell the common
 * glyphs out and mark anything else so the loss is visible, not silent.
 */
const PDF_GLYPHS: Readonly<Record<string, string>> = {
  "∫": "int ",
  "∑": "sum ",
  "√": "sqrt",
  "∂": "d",
  "∞": "inf",
  "θ": "theta",
  "π": "pi",
  "Δ": "delta",
  "∆": "delta",
  "δ": "delta",
  "α": "alpha",
  "β": "beta",
  "γ": "gamma",
  "ε": "epsilon",
  "η": "eta",
  "κ": "kappa",
  "λ": "lambda",
  "μ": "µ",
  "ν": "nu",
  "ξ": "xi",
  "ρ": "rho",
  "σ": "sigma",
  "τ": "tau",
  "φ": "phi",
  "ϕ": "phi",
  "χ": "chi",
  "ψ": "psi",
  "ω": "omega",
  "Ω": "omega",
  "−": "-",
  "–": "-",
  "—": "-",
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "≈": "~",
  "∙": "·",
  "•": "·",
  "…": "...",
  "′": "'",
  "″": '"',
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "⁰": "^0",
  "⁴": "^4",
  "⁵": "^5",
  "⁶": "^6",
  "⁷": "^7",
  "⁸": "^8",
  "⁹": "^9",
  "₀": "_0",
  "₁": "_1",
  "₂": "_2",
  "₃": "_3",
  "₄": "_4",
  "₅": "_5",
  "₆": "_6",
  "₇": "_7",
  "₈": "_8",
  "₉": "_9",
};

export function pdfSafeText(text: string): string {
  let out = "";
  for (const char of text) {
    const mapped = PDF_GLYPHS[char];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    out += char.charCodeAt(0) <= 0xff ? char : "?";
  }
  return out.replace(/\?{2,}/g, "?");
}
