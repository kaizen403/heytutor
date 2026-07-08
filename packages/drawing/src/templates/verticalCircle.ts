import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

/**
 * Motion in a vertical circle — circular path, string from center,
 * bob at the top with tension and weight both pointing down.
 */
export const VERTICAL_CIRCLE_TEMPLATE: DiagramTemplate = {
  id: "vertical_circle",
  name: "vertical circle",
  test:
    /vertical circle|loop[- ]the[- ]loop|(?:whirl|swing|rotat)\w*.{0,50}vertical|vertical.{0,30}(?:whirl|loop)|(?:string|rope).{0,50}(?:top|lowest|highest) (?:point|of the circle)/i,
  commands: [
    // 0: circular path
    { type: "DRAW_CIRCLE", params: [690, 330, 115] },
    // 1: string from center to the top point
    { type: "DRAW_LINE", params: [690, 330, 690, 215] },
    // 2: bob at the top
    { type: "DRAW_CIRCLE", params: [690, 208, 14] },
    // 3: tension arrow at the top, toward the center (down)
    { type: "DRAW_LINE", params: [678, 228, 678, 285] },
    // 4: weight arrow at the top, straight down
    { type: "DRAW_LINE", params: [704, 228, 704, 285] },
    // 5: dashed vertical diameter to the lowest point
    { type: "DRAW_LINE", params: [690, 330, 690, 445, 1] },
  ],
  introPhases: [
    {
      narration:
        "the object moves along a vertical circle, so gravity matters differently at every point of the path.",
      commandIndices: [0],
    },
    {
      narration:
        "at the top of the circle, the string points from the object straight toward the center.",
      commandIndices: [1, 2],
    },
    {
      narration:
        "at that top point both tension and weight pull toward the center, and together they provide the centripetal force. the lowest point sits directly below the center.",
      commandIndices: [3, 4, 5],
    },
  ],
  anchors: [
    { id: "T", labels: ["T", "tension"], x: 632, y: 250, width: 36, height: 36 },
    { id: "mg", labels: ["mg", "weight"], x: 722, y: 250, width: 44, height: 36 },
    { id: "r", labels: ["r", "R", "radius"], x: 706, y: 270, width: 34, height: 34 },
    { id: "v", labels: ["v", "v_top", "speed"], x: 758, y: 195, width: 40, height: 36 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "vertical_circle": the right side has the circular path, the string to the top point, the bob, tension and weight arrows at the top, and a dashed line to the lowest point — geometry only, no text labels yet. do not mention this note to the student.
do NOT redraw the circle, string, or arrows.
phase 1 — label one symbol per [STEP]: T on the tension arrow (632,250), mg on the weight arrow (722,250), r along the string (706,270), v at the top (758,195).
phase 2 — [CIRCLE_AROUND] each label while explaining: at the top, T + mg = mv^2/r; the minimum speed at the top is when T = 0, giving v_min = √(gr).
phase 3 — solve on the left (x 90): use energy conservation between the top and bottom when the question links the two points: (1/2)mv_bottom^2 = (1/2)mv_top^2 + mg(2r). keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
