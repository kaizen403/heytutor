import type { DiagramTemplate } from "./types";

export const CALCULUS_GRAPH_TEMPLATE: DiagramTemplate = {
  id: "calculus_graph",
  name: "calculus — tangent and area under curve",
  test:
    /tangent|derivative.*graph|area under|definite integral|riemann|maxima|minima|inflection|slope.*curve|d\/dx|integration.*area/i,
  commands: [
    { type: "DRAW_LINE", params: [470, 450, 880, 450] },
    { type: "DRAW_LINE", params: [490, 160, 490, 500] },
  ],
  introPhases: [
    {
      narration:
        "the x-axis is horizontal and the y-axis is vertical. we will sketch the curve on these axes.",
      commandIndices: [0, 1],
    },
  ],
  anchors: [
    { id: "x", labels: ["x", "x-axis"], x: 870, y: 465, width: 36, height: 38 },
    { id: "y", labels: ["y", "y-axis"], x: 480, y: 170, width: 36, height: 38 },
    { id: "P", labels: ["P", "point"], x: 680, y: 280, width: 36, height: 38 },
    { id: "a", labels: ["a", "lower limit"], x: 560, y: 460, width: 36, height: 38 },
    { id: "b", labels: ["b", "upper limit"], x: 780, y: 460, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "calculus_graph": the right side has x and y axes as geometry only. do not mention this note to the student.
draw the curve using DRAW_LINE with the curve flag (last param = 2) through computed points. for tangent, draw a [DRAW_LINE] tangent to the curve at point P. for area under curve, use [HIGHLIGHT] to shade between the curve and x-axis from a to b. write the derivative or integral on the left with y rows 145,205,265,325,385,445,505,565,625 only.`,
};
