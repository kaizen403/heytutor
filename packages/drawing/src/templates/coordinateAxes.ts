import type { DiagramTemplate } from "./types";

export const COORDINATE_AXES_TEMPLATE: DiagramTemplate = {
  id: "coordinate_axes",
  name: "coordinate axes",
  test: /parabola|ellipse|hyperbola|straight line.*slope|coordinate geometry|plot the curve|vertex.*parabola|focus.*directrix|eccentricity/i,
  commands: [
    { type: "DRAW_LINE", params: [480, 400, 880, 400] },
    { type: "DRAW_LINE", params: [520, 440, 520, 180] },
    { type: "LABEL", params: [870, 405], text: "x", anchorId: "x" },
    { type: "LABEL", params: [525, 185], text: "y", anchorId: "y" },
    { type: "LABEL", params: [505, 415], text: "O", anchorId: "O" },
  ],
  introPhases: [
    {
      narration:
        "the horizontal and vertical axes set the coordinate frame before we plot or derive anything.",
      commandIndices: [0, 1],
    },
  ],
  anchors: [
    { id: "O", labels: ["O", "origin"], x: 495, y: 397, width: 36, height: 38 },
    { id: "x", labels: ["x"], x: 860, y: 387, width: 36, height: 38 },
    { id: "y", labels: ["y"], x: 515, y: 175, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "coordinate_axes": the right side has the x and y axis lines as geometry only, with no axis labels yet. do not mention this note to the student.
label O, x, and y in separate [STEP]s as you introduce the axes — say the symbol, then [LABEL]. draw the curve on top with [DRAW_LINE] or [DRAW_CIRCLE] — do NOT redraw axes. label key points as you introduce them, then write equations on the left.`,
};
