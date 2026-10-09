import type { DiagramVerdict } from "./judging";

export type AnchorVerdict = Extract<DiagramVerdict, "right" | "partial" | "wrong">;

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
  markedBy: "owner";
}

export interface AnchorAgreement {
  total: number;
  compared: number;
  agreed: number;
  missing: string[];
  agreement: number | null;
  confusion: Record<string, number>;
}

export function anchorAgreement(
  anchors: readonly Pick<DiagramAnchor, "id" | "verdict">[],
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
  };
}
