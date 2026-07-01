import type { DiagramTemplate } from "./types";

export const PROJECTILE_TEMPLATE: DiagramTemplate = {
  id: "projectile",
  name: "projectile motion",
  test: /projectile|trajectory|maximum range|angle of projection|launched at|thrown at an angle/i,
  commands: [
    { type: "DRAW_LINE", params: [480, 420, 880, 420] },
    { type: "DRAW_LINE", params: [520, 420, 520, 480] },
    { type: "DRAW_LINE", params: [520, 420, 720, 300] },
    { type: "DRAW_LINE", params: [520, 420, 780, 340] },
    { type: "LABEL", params: [505, 400], text: "u", anchorId: "u" },
    { type: "LABEL", params: [600, 365], text: "θ", anchorId: "theta" },
    { type: "LABEL", params: [800, 400], text: "R", anchorId: "R" },
    { type: "LABEL", params: [720, 280], text: "H", anchorId: "H" },
  ],
  anchors: [
    { id: "u", labels: ["u", "initial velocity"], x: 495, y: 382, width: 36, height: 38 },
    { id: "theta", labels: ["θ", "theta"], x: 588, y: 348, width: 34, height: 34 },
    { id: "R", labels: ["R", "range"], x: 790, y: 382, width: 36, height: 38 },
    { id: "H", labels: ["H", "height"], x: 710, y: 262, width: 36, height: 38 },
  ],
  promptAddon: `runtime template "projectile": ground, launch point, and trajectory sketch are ALREADY on the board (geometry only — no labels yet).
label u, θ, R, and H in separate [STEP]s as you explain each quantity — say the symbol, then [LABEL]. do NOT redraw the path. [CIRCLE_AROUND] on labels when revisiting. write kinematic equations on the left.`,
};
