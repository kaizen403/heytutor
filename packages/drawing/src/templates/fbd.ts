import type { DiagramTemplate } from "./types";

export const FBD_TEMPLATE: DiagramTemplate = {
  id: "fbd",
  name: "free-body diagram",
  test: /free[- ]body|fbd|block on (a )?(rough )?surface|incline|friction.*newton|μ\s*=|mu\s*=/i,
  commands: [
    { type: "DRAW_RECT", params: [540, 360, 240, 30] },
    { type: "DRAW_RECT", params: [600, 280, 120, 80] },
    { type: "LABEL", params: [640, 320], text: "m", anchorId: "m" },
    { type: "DRAW_LINE", params: [720, 320, 840, 320] },
    { type: "LABEL", params: [820, 295], text: "F", anchorId: "F" },
    { type: "DRAW_LINE", params: [600, 320, 520, 320] },
    { type: "LABEL", params: [540, 295], text: "f", anchorId: "f" },
    { type: "DRAW_LINE", params: [660, 280, 660, 200] },
    { type: "LABEL", params: [680, 195], text: "N", anchorId: "N" },
    { type: "DRAW_LINE", params: [660, 360, 660, 450] },
    { type: "LABEL", params: [680, 460], text: "mg", anchorId: "mg" },
  ],
  anchors: [
    { id: "m", labels: ["m", "M", "mass"], x: 640, y: 320, width: 36, height: 38 },
    { id: "F", labels: ["F", "F_app", "applied"], x: 810, y: 278, width: 36, height: 38 },
    { id: "f", labels: ["f", "F_f", "friction"], x: 530, y: 278, width: 36, height: 38 },
    { id: "N", labels: ["N", "F_N", "normal"], x: 670, y: 178, width: 36, height: 38 },
    { id: "mg", labels: ["mg", "W", "weight"], x: 670, y: 448, width: 46, height: 38 },
  ],
  promptAddon: `runtime template "fbd": free-body diagram skeleton is ALREADY on the board (block, surface, labels m, F, f, N, mg).
do NOT redraw the block, surface, or force arrows.
phase 1 is complete. teach in two phases:
1) explain each existing label — one [STEP] per force, [CIRCLE_AROUND] on the label text only.
2) solve on the left (x 90–400) — write equations and annotate diagram labels when reusing them (e.g. f = μN).`,
};
