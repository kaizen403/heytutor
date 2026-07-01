import type { DiagramTemplate } from "./types";

export const COORDINATE_AXES_TEMPLATE: DiagramTemplate = {
  id: "coordinate_axes",
  name: "coordinate axes",
  test: /parabola|ellipse|hyperbola|straight line.*slope|coordinate geometry|graph of|plot the curve|vertex.*parabola/i,
  commands: [
    { type: "DRAW_LINE", params: [480, 400, 880, 400] },
    { type: "DRAW_LINE", params: [520, 440, 520, 180] },
    { type: "LABEL", params: [870, 405], text: "x", anchorId: "x" },
    { type: "LABEL", params: [525, 185], text: "y", anchorId: "y" },
    { type: "LABEL", params: [505, 415], text: "O", anchorId: "O" },
  ],
  anchors: [
    { id: "O", labels: ["O", "origin"], x: 495, y: 397, width: 36, height: 38 },
    { id: "x", labels: ["x"], x: 860, y: 387, width: 36, height: 38 },
    { id: "y", labels: ["y"], x: 515, y: 175, width: 36, height: 38 },
  ],
  promptAddon: `runtime template "coordinate_axes": x and y axis lines are ALREADY on the board (geometry only — no axis labels yet).
label O, x, and y in separate [STEP]s as you introduce the axes — say the symbol, then [LABEL]. draw the curve on top with [DRAW_LINE] or [DRAW_CIRCLE] — do NOT redraw axes. label key points as you introduce them, then write equations on the left.`,
};
