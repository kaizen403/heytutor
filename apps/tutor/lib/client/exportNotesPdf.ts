"use client";

import { jsPDF } from "jspdf";
import { notesPdfSlideImages, type NotesPdfSection } from "@/features/tutor-session/lib/notes/notesPdf";

export interface NotesEpoch {
  index: number;
  /** Question whose ink was on the board when the page was captured. */
  question: string;
  snapshotDataUrl: string;
  /** Narration spoken while this page was on the board. */
  narrationText: string;
  timestampMs: number;
}

export interface ExportNotesParams {
  title: string;
  sections: NotesPdfSection[];
}

/** Board canvas in PDF points — one notes page is one slide. */
const SLIDE_WIDTH_PT = 1200;
const DEFAULT_SLIDE_HEIGHT_PT = 700;

function sanitizeFilename(title: string): string {
  const base = title.trim() || "lecture-notes";
  return base.replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "-").toLowerCase();
}

function slidePageSize(
  doc: jsPDF,
  image: string,
): { width: number; height: number } {
  try {
    const props = doc.getImageProperties(image);
    if (props.width > 0 && props.height > 0) {
      return {
        width: SLIDE_WIDTH_PT,
        height: SLIDE_WIDTH_PT * (props.height / props.width),
      };
    }
  } catch {
    // Unreadable snapshots fall back to the board frame.
  }
  return { width: SLIDE_WIDTH_PT, height: DEFAULT_SLIDE_HEIGHT_PT };
}

function pageOrientation(width: number, height: number): "landscape" | "portrait" {
  return width >= height ? "landscape" : "portrait";
}

/**
 * One PDF page per board (or code-panel) snapshot, edge to edge. No titles,
 * subtitles, work transcripts, or spoken explanation.
 */
export function renderNotesPdf(images: readonly string[]): jsPDF | null {
  const slides = images.filter((image) => image.length > 0);
  if (slides.length === 0) {
    return null;
  }

  const probe = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: [SLIDE_WIDTH_PT, DEFAULT_SLIDE_HEIGHT_PT],
  });
  const first = slidePageSize(probe, slides[0]!);
  const doc = new jsPDF({
    orientation: pageOrientation(first.width, first.height),
    unit: "pt",
    format: [first.width, first.height],
    compress: true,
  });

  for (let index = 0; index < slides.length; index += 1) {
    const image = slides[index]!;
    const size = index === 0 ? first : slidePageSize(doc, image);
    if (index > 0) {
      doc.addPage(
        [size.width, size.height],
        pageOrientation(size.width, size.height) === "landscape" ? "l" : "p",
      );
    }
    try {
      doc.addImage(image, "PNG", 0, 0, size.width, size.height, undefined, "FAST");
    } catch {
      // Leave the page blank rather than injecting error copy.
    }
  }

  return doc;
}

export async function exportNotesPdf({ title, sections }: ExportNotesParams): Promise<void> {
  const doc = renderNotesPdf(notesPdfSlideImages(sections));
  if (!doc) {
    return;
  }
  doc.save(`${sanitizeFilename(title)}.pdf`);
}
