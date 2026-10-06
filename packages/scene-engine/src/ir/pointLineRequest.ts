/** Whole-request identity grammar shared by source construction and admission. */
export interface PointLineRequestLiterals {
  points: Array<{ x: number; y: number; name?: string; origin?: true }>;
  lines: Array<{ a: number; b: number; c: number }>;
  unreadPoint: boolean;
  unreadEquation: boolean;
  spans: Array<{ start: number; end: number; kind: "point" | "line" }>;
}

export type PointLineRequestReading =
  | { status: "none" }
  | { status: "declined"; reason: string }
  | { status: "ok"; point: PointLineRequestLiterals["points"][number]; line: PointLineRequestLiterals["lines"][number]; footName?: string; requests: {distance: boolean; foot: boolean} };

/** Stateless: literals come from the existing exact source reader. */
export function readPointLineRequest(question: unknown, source: PointLineRequestLiterals | null): PointLineRequestReading {
  if (typeof question !== "string" || question.length > 4096) return { status: "none" };
  // Consume the complete bounded mathematical request once. Keyword case
  // never changes the captured source identifiers.
  if (!/\b(?:distance|perpendicular\s+foot|foot\s+of\s+(?:the\s+)?perpendicular)\b/i.test(question)) return { status: "none" };
  if (source?.unreadPoint) return { status: "declined", reason: "a stated point is outside supported literal precision" };
  if (!source || source.lines.length === 0 || source.points.length === 0) return { status: "none" };
  if (source.unreadEquation || source.lines.length !== 1 || source.points.length !== 1
    || /\b(?:space|three.dimensions|3D|planes?)\b/i.test(question)) return { status: "declined", reason: "one complete two-dimensional point and linear equation are required" };
  let residue = question.replace(/[−–—]/g, "-").replace(/[·×]/g, "*").replace(/\s+/g, " ");
  for (const span of [...source.spans].sort((a, b) => b.start - a.start)) residue = residue.slice(0, span.start) + (span.kind === "point" ? "@P" : "@L") + residue.slice(span.end);
  const footRequest = String.raw`(?:perpendicular\s+foot|foot\s+of\s+(?:the\s+)?perpendicular)(?:\s+([A-Za-z][A-Za-z]?\d?'?))?`;
  const request = new RegExp(String.raw`^(?:In Cartesian coordinate units,\s*)?(?:Find|Calculate|Determine)\s+(?:the\s+)?(?:(?:perpendicular\s+)?distance(?:\s+and\s+(?:the\s+)?${footRequest})?|${footRequest}(?:\s+and\s+(?:the\s+)?distance)?)\s+(?:of|from)\s+(?:the\s+)?(?:point\s+)?@P\s+(?:from|to)\s+(?:the\s+)?(?:line\s+)?@L[.?!]?$`, "i");
  // A trailing second ask is the same complete projection request. Keep its
  // captured identifier, and consume the whole sentence before construction.
  const trailing = new RegExp(String.raw`^(.*@L),?\s+and\s+(?:the\s+)?(${footRequest})[.?!]?$`, "i").exec(residue.trim());
  if (trailing) residue = trailing[1]!.replace(/^(Find|Calculate|Determine)\s+(?:the\s+)?((?:perpendicular\s+)?distance)/i,
    (_all, verb: string, distance: string) => `${verb} ${distance} and ${trailing[2]}`);
  const matched = request.exec(residue.trim());
  if (!matched) return { status: "declined", reason: "the complete requested projection is not consumed by the source grammar" };
  const point = source.points[0]!;
  const line = source.lines[0]!;
  const footName = matched[1] ?? matched[2];
  return { status: "ok", point, line, ...(footName ? { footName } : {}),
    requests: {distance: /\bdistance\b/i.test(matched[0]), foot: /\b(?:perpendicular\s+foot|foot\s+of\s+(?:the\s+)?perpendicular)\b/i.test(matched[0])} };
}
