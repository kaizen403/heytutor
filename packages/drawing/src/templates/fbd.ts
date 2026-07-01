import type { DiagramTemplate } from "./types";

export const FBD_TEMPLATE: DiagramTemplate = {
  id: "fbd",
  name: "free-body diagram",
  test: /free[- ]body|fbd|block on (a )?(rough )?surface|incline|friction.*newton|μ\s*=|mu\s*=/i,
  commands: [
    { type: "DRAW_RECT", params: [540, 360, 240, 30] },
    { type: "DRAW_RECT", params: [600, 280, 120, 80] },
  ],
  anchors: [
    { id: "m", labels: ["m", "M", "mass"], x: 640, y: 320, width: 36, height: 38 },
    { id: "F", labels: ["F", "F_app", "applied"], x: 810, y: 278, width: 36, height: 38 },
    { id: "f", labels: ["f", "F_f", "friction"], x: 530, y: 278, width: 36, height: 38 },
    { id: "N", labels: ["N", "F_N", "normal"], x: 670, y: 178, width: 36, height: 38 },
    { id: "mg", labels: ["mg", "W", "weight"], x: 670, y: 448, width: 46, height: 38 },
  ],
  promptAddon: `runtime template "fbd": block and surface are ALREADY on the board (geometry only — no force arrows or labels yet).
teach each force in its own [STEP] as you explain it — say the force name in speech, draw the arrow [DRAW_LINE], then label it [LABEL] at the anchor position. one force per step, synced with your voice.
force arrows: F from (720,320) to (840,320); f from (600,320) to (520,320); N from (660,280) to (660,200); mg from (660,360) to (660,450).
order: mass m on block → applied F (right) → friction f (left) → normal N (up) → weight mg (down). do NOT draw all forces at once.
after all forces are on the board, solve on the left (x 90–400) and [CIRCLE_AROUND] labels when reusing them (e.g. f = μN).`,
};
