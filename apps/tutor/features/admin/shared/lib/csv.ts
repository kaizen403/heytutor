"use client";

interface CsvValue {
  value: string | number | null | undefined;
}

/** A cell that starts with one of these is a formula in Excel, Sheets, and LibreOffice. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCsvValue(value: string | number | null | undefined): string {
  if (value == null) return "";
  // Numbers stay numbers. A negative cost must not become text. A note or a
  // question is text, and a leading apostrophe makes a spreadsheet show it
  // instead of evaluating it.
  let text = String(value);
  if (typeof value !== "number" && FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** The CSV text `downloadCsv` saves. Exposed so a test can read a hostile note. */
export function toCsv(
  headers: ReadonlyArray<CsvValue["value"]>,
  rows: ReadonlyArray<ReadonlyArray<CsvValue["value"]>>,
): string {
  return [headers, ...rows].map((row) => row.map(escapeCsvValue).join(",")).join("\n");
}

/** Download a small result set as CSV — the admin tables, not the whole table. */
export function downloadCsv(
  filename: string,
  headers: ReadonlyArray<CsvValue["value"]>,
  rows: ReadonlyArray<ReadonlyArray<CsvValue["value"]>>,
): void {
  const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking in the same tick can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
