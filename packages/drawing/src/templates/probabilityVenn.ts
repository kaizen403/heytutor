import type { DiagramTemplate } from "./types";

export const PROBABILITY_VENN_TEMPLATE: DiagramTemplate = {
  id: "probability_venn",
  name: "probability — Venn diagrams",
  test:
    /venn|probability.*diagram|sample space|mutually exclusive|independent.*event|bayes|conditional probability|tree diagram|set.*intersection|set.*union/i,
  commands: [
    { type: "DRAW_RECT", params: [490, 180, 330, 230] },
    { type: "DRAW_CIRCLE", params: [600, 295, 80] },
    { type: "DRAW_CIRCLE", params: [710, 295, 80] },
  ],
  introPhases: [
    {
      narration:
        "the rectangle is the universal set, containing all possible outcomes. the two circles are sets A and B.",
      commandIndices: [0, 1, 2],
    },
  ],
  anchors: [
    { id: "A", labels: ["A", "set A"], x: 565, y: 245, width: 36, height: 38 },
    { id: "B", labels: ["B", "set B"], x: 745, y: 245, width: 36, height: 38 },
    { id: "AnB", labels: ["A∩B", "intersection", "A and B"], x: 645, y: 285, width: 50, height: 38 },
    { id: "U", labels: ["U", "universal", "S", "sample space"], x: 500, y: 195, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "probability_venn": the right side has the universal set rectangle and two overlapping circles as geometry only. do not mention this note to the student.
label sets A, B, the intersection A∩B, and the universal set U. shade regions with [HIGHLIGHT] to show the probability being computed. write P(A or B) = P(A) + P(B) - P(A∩B) or Bayes' theorem on the left with y rows 145,205,265,325,385,445,505,565,625 only.`,
};
