import type { ChemistrySourceSpan } from "./types";

/** Original display clause that explicitly names the owner of a structural
 * count. This supplies ownership only; numeric facts are still recomputed. */
export function chemistryCountSourceClause(text: string, position: number): ChemistrySourceSpan | null {
  if (!Number.isSafeInteger(position) || position < 0 || position > text.length) return null;
  const from = text.lastIndexOf(";", position - 1) + 1;
  const colon = text.indexOf(":", from);
  if (colon < from || colon >= position) return null;
  const raw = text.slice(from, colon);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const start = from + raw.indexOf(trimmed);
  return { start, end: start + trimmed.length, text: trimmed };
}
