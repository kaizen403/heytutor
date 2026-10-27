import type { PictureSubject, PictureTurnRow } from "@/lib/admin/pictures";
import { formatDurationMs, formatPercent } from "../shared/lib/format";

export type PictureStatus = NonNullable<PictureTurnRow["picture"]>["status"];

const SUBJECT_LABELS: Record<PictureSubject, string> = {
  maths: "Maths",
  physics: "Physics",
  chemistry: "Chemistry",
  other: "Other (biology and more, no engine)",
  unknown: "Unrecorded subject",
};

export function subjectLabel(subject: PictureSubject): string {
  return SUBJECT_LABELS[subject];
}

export function rateLabel(rate: number | null): string {
  return rate == null ? "n/a" : formatPercent(rate);
}

export function msLabel(ms: number | null): string {
  return ms == null ? "n/a" : formatDurationMs(ms);
}

/** Pipeline codes read as words; they are validated codes, never free text. */
export function codeLabel(code: string): string {
  return code.replaceAll("_", " ");
}

export const PICTURE_STATUS_STYLE: Record<PictureStatus, { label: string; className: string }> = {
  shown: { label: "Shown", className: "border-sky-500/30 bg-sky-500/15 text-sky-200" },
  declined: { label: "Declined", className: "border-danger/30 bg-danger/15 text-danger" },
  unavailable: { label: "Unavailable", className: "border-danger/20 bg-danger/10 text-danger/80" },
  skipped: { label: "Skipped", className: "border-white/15 bg-white/5 text-soft" },
};
