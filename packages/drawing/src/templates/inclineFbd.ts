import type { DiagramTemplate } from "./types";

export const INCLINE_FBD_TEMPLATE: DiagramTemplate = {
  id: "incline_fbd",
  name: "inclined-plane free-body diagram",
  test:
    /(?:free[- ]body|fbd|newton(?:'?s)?\s*(?:second\s*)?law|friction|force|acceleration|slid(?:e|ing)?).{0,80}(?:incline|inclined plane|ramp)|(?:incline|inclined plane|ramp).{0,80}(?:free[- ]body|fbd|newton(?:'?s)?\s*(?:second\s*)?law|friction|force|acceleration|slid(?:e|ing)?)/i,
  commands: [
    // Inclined surface and ground reference.
    { type: "DRAW_LINE", params: [500, 430, 840, 250] },
    { type: "DRAW_LINE", params: [500, 430, 900, 430] },
    // Block sketched as a slanted quadrilateral using four line segments.
    { type: "DRAW_LINE", params: [622, 342, 698, 302] },
    { type: "DRAW_LINE", params: [698, 302, 730, 360] },
    { type: "DRAW_LINE", params: [730, 360, 654, 400] },
    { type: "DRAW_LINE", params: [654, 400, 622, 342] },
    // Force arrows from the block center: friction up ramp, normal out of plane, weight down.
    { type: "DRAW_LINE", params: [676, 350, 590, 396] },
    { type: "DRAW_LINE", params: [676, 350, 620, 245] },
    { type: "DRAW_LINE", params: [676, 350, 676, 470] },
    // Small angle marker near the base.
    { type: "DRAW_LINE", params: [795, 430, 840, 430] },
    { type: "DRAW_LINE", params: [795, 430, 830, 390] },
  ],
  introPhases: [
    {
      narration:
        "the block is on an inclined surface, so the slope sets the direction we compare forces against.",
      commandIndices: [0, 1, 2, 3, 4, 5],
    },
    {
      narration:
        "the force directions are tied to the plane: friction is along the surface, normal is perpendicular, and weight is vertical.",
      commandIndices: [6, 7, 8, 9, 10],
    },
  ],
  anchors: [
    { id: "m", labels: ["m", "mass", "block"], x: 660, y: 342, width: 36, height: 38 },
    { id: "f", labels: ["f", "friction"], x: 570, y: 382, width: 36, height: 38 },
    { id: "N", labels: ["N", "normal"], x: 600, y: 228, width: 36, height: 38 },
    { id: "mg", labels: ["mg", "weight"], x: 686, y: 458, width: 46, height: 38 },
    { id: "theta", labels: ["θ", "theta", "angle"], x: 818, y: 394, width: 34, height: 34 },
  ],
  promptAddon: `internal diagram note "incline_fbd": the right side has the inclined surface, block, friction arrow, normal arrow, weight arrow, and angle marker as geometry only, with no text labels yet. do not mention this note to the student.
do NOT redraw the ramp, block, or force arrows. do NOT say "let me draw". add clean symbol labels one per [STEP]: m, f, N, mg, and θ. keep given numbers on the left, not inside the diagram.
after labeling, explain each force by circling the label text. when solving, write equations on the left and annotate diagram labels when reusing them. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
