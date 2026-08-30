import type { jsPDF } from "jspdf";

export const NOTES_PDF_FONT_FAMILY = "NotesSans";
export const NOTES_PDF_FONT_FILE = "notes-pdf.ttf";

function bytesToBinaryString(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

export function registerNotesPdfFont(doc: jsPDF, binary: string): void {
  doc.addFileToVFS(NOTES_PDF_FONT_FILE, binary);
  doc.addFont(NOTES_PDF_FONT_FILE, NOTES_PDF_FONT_FAMILY, "normal");
  doc.addFont(NOTES_PDF_FONT_FILE, NOTES_PDF_FONT_FAMILY, "bold");
  doc.addFont(NOTES_PDF_FONT_FILE, NOTES_PDF_FONT_FAMILY, "italic");
}

export async function loadNotesPdfFontBinary(): Promise<string> {
  if (typeof window === "undefined") {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const file = resolve(process.cwd(), "public/fonts/notes-pdf.ttf");
    return bytesToBinaryString(new Uint8Array(readFileSync(file)));
  }
  const res = await fetch(`/fonts/${NOTES_PDF_FONT_FILE}`);
  if (!res.ok) {
    throw new Error("notes pdf font missing");
  }
  return bytesToBinaryString(new Uint8Array(await res.arrayBuffer()));
}
