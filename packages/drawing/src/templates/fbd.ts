import type { DiagramTemplate } from "./types";

export const FBD_TEMPLATE: DiagramTemplate = {
  id: "fbd",
  name: "free-body diagram",
  test:
    /free[- ]body|fbd|block on (a )?(rough )?surface|incline|(?:newton(?:'?s)?\s*(?:second\s*)?law|second\s*law).{0,48}friction|friction.{0,48}(?:newton(?:'?s)?\s*(?:second\s*)?law|second\s*law)|μ\s*=|mu\s*=/i,
  commands: [
    { type: "DRAW_RECT", params: [540, 360, 240, 30] },
    { type: "DRAW_RECT", params: [600, 280, 120, 80] },
    { type: "DRAW_LINE", params: [720, 320, 840, 320] },
    { type: "DRAW_LINE", params: [600, 320, 520, 320] },
    { type: "DRAW_LINE", params: [660, 280, 660, 200] },
    { type: "DRAW_LINE", params: [660, 360, 660, 450] },
  ],
  anchors: [
    { id: "m", labels: ["m", "M", "mass"], x: 640, y: 320, width: 36, height: 38 },
    { id: "F", labels: ["F", "F_app", "applied"], x: 810, y: 278, width: 36, height: 38 },
    { id: "f", labels: ["f", "F_f", "friction"], x: 530, y: 278, width: 36, height: 38 },
    { id: "N", labels: ["N", "F_N", "normal"], x: 670, y: 178, width: 36, height: 38 },
    { id: "mg", labels: ["mg", "W", "weight"], x: 670, y: 448, width: 46, height: 38 },
  ],
  promptAddon: `runtime template "fbd": block, surface, and all four force arrows are ALREADY on the board (geometry only — no text labels yet).
do NOT redraw [DRAW_RECT] or [DRAW_LINE] in the diagram zone. do NOT put given numbers (5 kg, 20 N, μ) on the diagram — those belong on the left (x 90–400).
add ONE symbol label per [STEP] as you explain that force — say the force name in speech, then [LABEL] at the anchor: m on block (640,320), F (820,295), f (540,295), N (680,195), mg (680,460). never dump every label in one step.
after labels are on the board, phase 2: [CIRCLE_AROUND] each label while explaining it. phase 3: solve on the left and annotate labels when reusing them (e.g. f = μN).`,
};
