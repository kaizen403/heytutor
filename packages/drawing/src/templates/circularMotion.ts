import type { DiagramTemplate } from "./types";

export const CIRCULAR_MOTION_TEMPLATE: DiagramTemplate = {
  id: "circular_motion",
  name: "bead on hoop / circular motion",
  test: /bead|hoop|rotating (hoop|wire)|circular (hoop|path)|angular velocity|small oscillation|charged particle on (a )?ring/i,
  commands: [
    { type: "DRAW_CIRCLE", params: [650, 300, 120] },
    { type: "LABEL", params: [640, 270], text: "O", anchorId: "O" },
    { type: "DRAW_LINE", params: [650, 300, 650, 420] },
    { type: "DRAW_LINE", params: [650, 300, 770, 300] },
    { type: "LABEL", params: [700, 345], text: "θ", anchorId: "theta" },
    { type: "LABEL", params: [780, 288], text: "m", anchorId: "m" },
    { type: "LABEL", params: [560, 250], text: "ω", anchorId: "omega" },
  ],
  anchors: [
    { id: "O", labels: ["O", "center"], x: 630, y: 260, width: 36, height: 38 },
    { id: "theta", labels: ["θ", "theta"], x: 688, y: 332, width: 34, height: 34 },
    { id: "m", labels: ["m"], x: 770, y: 278, width: 36, height: 38 },
    { id: "omega", labels: ["ω", "omega"], x: 550, y: 240, width: 36, height: 38 },
  ],
  promptAddon: `runtime template "circular_motion": hoop and reference lines are ALREADY on the board (geometry only — no labels yet).
draw each label in its own [STEP] as you explain it: center O, angle θ, mass m, angular velocity ω. say the symbol in speech, then [LABEL] at the anchor position. one label per step.
do NOT redraw the circle or reference lines. [CIRCLE_AROUND] on θ when discussing the angle. write equations on the left (x 90–400). use unicode θ and ω on the board.`,
};
