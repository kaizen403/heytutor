"use client";

interface CsvValue {
  value: string | number | null | undefined;
}

function escapeCsvValue(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/** Download a small result set as CSV — the admin tables, not the whole table. */
export function downloadCsv(
  filename: string,
  headers: ReadonlyArray<CsvValue["value"]>,
  rows: ReadonlyArray<ReadonlyArray<CsvValue["value"]>>,
): void {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvValue).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking in the same tick can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
