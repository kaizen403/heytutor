import type { DiagramVerdict } from "./judging";

export type AnchorVerdict = Extract<DiagramVerdict, "right" | "partial" | "wrong">;
export type DiagramAnchorMarker = "owner" | "codex-reference";

export interface DiagramAnchor {
  id: string;
  rowId: string;
  arm: "current" | "planner_examples_strict";
  subject: string;
  question: string;
  figureNeed: string;
  figureKind: string;
  mustShow: string[];
  mustLabel: string[];
  mustNotShow: string[];
  figurePath: string;
  figureSha256: string;
  verdict: AnchorVerdict;
  note: string;
  markedBy: DiagramAnchorMarker;
}

export interface AnchorAgreement {
  total: number;
  compared: number;
  agreed: number;
  missing: string[];
  agreement: number | null;
  confusion: Record<string, number>;
  markedBy: DiagramAnchorMarker[];
}

const ANCHOR_VERDICTS = new Set<AnchorVerdict>(["right", "partial", "wrong"]);
const ANCHOR_MARKERS = new Set<DiagramAnchorMarker>(["owner", "codex-reference"]);

function stringArray(value: unknown, field: string, line: number): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`anchor line ${line}: ${field} must be a string array`);
  }
  return value;
}

/** Parse a local reference set without trusting model-authored JSONL shapes. */
export function parseDiagramAnchors(input: string): DiagramAnchor[] {
  return input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line, index) => {
      const lineNumber = index + 1;
      const value = JSON.parse(line) as Record<string, unknown>;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`anchor line ${lineNumber}: expected an object`);
      }
      if (typeof value.id !== "string" || value.id.length === 0) {
        throw new Error(`anchor line ${lineNumber}: id must be a non-empty string`);
      }
      if (!ANCHOR_VERDICTS.has(value.verdict as AnchorVerdict)) {
        throw new Error(`anchor line ${lineNumber}: verdict must be right, partial or wrong`);
      }
      if (!ANCHOR_MARKERS.has(value.markedBy as DiagramAnchorMarker)) {
        throw new Error(`anchor line ${lineNumber}: markedBy must be owner or codex-reference`);
      }
      if (value.arm !== "current" && value.arm !== "planner_examples_strict") {
        throw new Error(`anchor line ${lineNumber}: arm is invalid`);
      }
      for (const field of [
        "rowId", "subject", "question", "figureNeed", "figureKind", "figurePath", "note",
      ] as const) {
        if (typeof value[field] !== "string") {
          throw new Error(`anchor line ${lineNumber}: ${field} must be a string`);
        }
      }
      if (typeof value.figureSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.figureSha256)) {
        throw new Error(`anchor line ${lineNumber}: figureSha256 must be a SHA-256 hex digest`);
      }
      return {
        ...value,
        mustShow: stringArray(value.mustShow, "mustShow", lineNumber),
        mustLabel: stringArray(value.mustLabel, "mustLabel", lineNumber),
        mustNotShow: stringArray(value.mustNotShow, "mustNotShow", lineNumber),
      } as unknown as DiagramAnchor;
    });
}

export function anchorReferenceDescription(markedBy: readonly DiagramAnchorMarker[]): string {
  return markedBy.length === 1 && markedBy[0] === "codex-reference"
    ? "agreement with Codex reference anchors (judge consistency between sessions, not human accuracy)"
    : "anchor agreement";
}

export function anchorAgreement(
  anchors: readonly Pick<DiagramAnchor, "id" | "verdict" | "markedBy">[],
  judgments: readonly { id: string; verdict: DiagramVerdict }[],
): AnchorAgreement {
  const byId = new Map(judgments.map((judgment) => [judgment.id, judgment.verdict]));
  let agreed = 0;
  const missing: string[] = [];
  const confusion: Record<string, number> = {};
  for (const anchor of anchors) {
    const observed = byId.get(anchor.id);
    if (!observed) {
      missing.push(anchor.id);
      continue;
    }
    if (observed === anchor.verdict) agreed += 1;
    const key = `${anchor.verdict}->${observed}`;
    confusion[key] = (confusion[key] ?? 0) + 1;
  }
  const compared = anchors.length - missing.length;
  return {
    total: anchors.length,
    compared,
    agreed,
    missing,
    agreement: compared > 0 ? agreed / compared : null,
    confusion,
    markedBy: [...new Set(anchors.map((anchor) => anchor.markedBy))].sort(),
  };
}
