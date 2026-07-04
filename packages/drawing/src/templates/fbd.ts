import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

export const FBD_TEMPLATE: DiagramTemplate = {
  id: "fbd",
  name: "free-body diagram",
  test:
    /free[- ]body|fbd|block on (a )?(rough )?surface|incline|(?:newton(?:'?s)?\s*(?:second\s*)?law|second\s*law).{0,48}friction|friction.{0,48}(?:newton(?:'?s)?\s*(?:second\s*)?law|second\s*law)|(?:μ|mu)\s*=.*(?:force|friction|surface|block|kg|newton|push|accel)|(?:force|friction|surface|block|kg|newton|push|accel).{0,48}(?:μ|mu)\s*=/i,
  commands: [
    { type: "DRAW_RECT", params: [540, 360, 240, 30] },
    { type: "DRAW_RECT", params: [600, 280, 120, 80] },
    { type: "DRAW_LINE", params: [720, 320, 840, 320] },
    { type: "DRAW_LINE", params: [600, 320, 520, 320] },
    { type: "DRAW_LINE", params: [660, 280, 660, 200] },
    { type: "DRAW_LINE", params: [660, 360, 660, 450] },
  ],
  introPhases: [
    {
      narration:
        "the object is on a flat surface, so the surface and block are the physical setup we care about first.",
      commandIndices: [0, 1],
    },
    {
      narration:
        "horizontally, the push acts to the right and friction acts back to the left.",
      commandIndices: [2, 3],
    },
    {
      narration:
        "vertically, the surface pushes up while gravity pulls the block down.",
      commandIndices: [4, 5],
    },
  ],
  anchors: [
    { id: "m", labels: ["m", "M", "mass", "kg"], x: 640, y: 320, width: 36, height: 38 },
    { id: "F", labels: ["F", "F_app", "applied"], x: 810, y: 278, width: 36, height: 38 },
    { id: "f", labels: ["f", "F_f", "friction"], x: 530, y: 278, width: 36, height: 38 },
    { id: "N", labels: ["N", "F_N", "normal"], x: 670, y: 178, width: 36, height: 38 },
    { id: "mg", labels: ["mg", "W", "weight"], x: 670, y: 448, width: 46, height: 38 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "fbd": the right side has the block, surface, and four force arrows as geometry only, with no text labels yet. do not mention this note to the student.
do NOT redraw [DRAW_RECT] or [DRAW_LINE] in the diagram area. do NOT say "let me draw". do NOT put given numbers (5 kg, 20 N, μ) on the diagram — those belong on the left (x 90–400).
phase 1: add ONE clean symbol label per [STEP] as you explain that force — say the force name in speech, then [LABEL] only the symbol at the anchor: m on block (640,320), F (820,295), f (540,295), N (680,195), mg (680,460). never write "F = 20 N" or "m = 5 kg" on the diagram.
phase 2: [CIRCLE_AROUND] each label while explaining it. phase 3: solve on the left and annotate labels when reusing them (e.g. f = μN). keep left-side [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
