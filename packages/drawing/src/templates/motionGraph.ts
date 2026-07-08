import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

/**
 * Kinematics graphs — velocity-time / position-time axes.
 * Axes only; the LLM draws the specific curve for the question on top.
 */
export const MOTION_GRAPH_TEMPLATE: DiagramTemplate = {
  id: "motion_graph",
  name: "motion graph",
  test:
    /(?:v-t|x-t|a-t|s-t)\s*graph|(?:velocity|position|displacement|acceleration)[-\s]time graph|graph.{0,50}(?:velocity|displacement|acceleration).{0,20}time|time.{0,20}(?:velocity|displacement) graph/i,
  commands: [
    // 0: y axis
    { type: "DRAW_LINE", params: [530, 190, 530, 440] },
    // 1: x axis (time)
    { type: "DRAW_LINE", params: [530, 440, 880, 440] },
  ],
  introPhases: [
    {
      narration:
        "the vertical axis is the quantity we track, and the horizontal axis is time.",
      commandIndices: [0, 1],
    },
  ],
  anchors: [
    { id: "y", labels: ["v", "x", "s", "a"], x: 500, y: 178, width: 34, height: 34 },
    { id: "t", labels: ["t", "time"], x: 886, y: 452, width: 34, height: 34 },
    { id: "O", labels: ["O", "origin", "0"], x: 505, y: 448, width: 30, height: 30 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "motion_graph": the right side has empty axes only — vertical quantity axis and horizontal time axis. do not mention this note to the student.
label the axes first, one label per [STEP]: the tracked quantity (v, x, or a) near (500,178), t near (886,452), and O at the origin (505,448).
then draw the motion curve for THIS question with [DRAW_LINE] segments on the axes — straight segments for uniform acceleration, horizontal segments for constant values. keep every point inside x 540-870, y 200-435. one segment per [STEP], spoken as you draw it ("for the first four seconds the velocity climbs steadily").
mark slope as acceleration and area under the curve as distance with [DIMENSION:...] or [LABEL] while explaining. solve on the left (x 90) with rows y 145,205,265,325,385,445,505,565,625 only.`),
};
