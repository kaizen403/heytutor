import type { DiagramTemplate } from "./types";
import {
  angleMarkerAtBase,
  buildInclineTriangle,
  inclineOutwardNormal,
  inclineUnit,
  placeBlockOnIncline,
} from "./inclineGeometry";

const TRI = buildInclineTriangle(500, 480, 360, 30);
const BLOCK = placeBlockOnIncline(TRI, 0.52, 72, 44);
const [TICK_BASE, TICK_SLOPE] = angleMarkerAtBase(TRI);
const SLOPE_UNIT = inclineUnit(TRI.angleDeg);
const OUTWARD_NORMAL = inclineOutwardNormal(TRI.angleDeg);

const FRICTION_LEN = 58;
const NORMAL_LEN = 72;
const frictionEnd: [number, number] = [
  Math.round(BLOCK.center[0] + SLOPE_UNIT[0] * FRICTION_LEN),
  Math.round(BLOCK.center[1] + SLOPE_UNIT[1] * FRICTION_LEN),
];
const normalEnd: [number, number] = [
  Math.round(BLOCK.center[0] - OUTWARD_NORMAL[0] * NORMAL_LEN),
  Math.round(BLOCK.center[1] - OUTWARD_NORMAL[1] * NORMAL_LEN),
];

export const INCLINE_FBD_TEMPLATE: DiagramTemplate = {
  id: "incline_fbd",
  name: "inclined-plane free-body diagram",
  test:
    /(?:free[- ]body|fbd|newton(?:'?s)?\s*(?:second\s*)?law|friction|force|acceleration|slid(?:e|ing)?|box|block|rest(?:s|ing)?|placed).{0,80}(?:incline|inclined plane|ramp|slope|hill(?:side)?)|(?:incline|inclined plane|ramp|slope|hill(?:side)?).{0,80}(?:free[- ]body|fbd|newton(?:'?s)?\s*(?:second\s*)?law|friction|force|acceleration|slid(?:e|ing)?|box|block)/i,
  commands: [
    // Right triangle: θ at bottom-left, right angle at bottom-right, ground along the bottom.
    { type: "DRAW_LINE", params: [...TRI.baseLeft, ...TRI.baseRight] },
    { type: "DRAW_LINE", params: [...TRI.baseLeft, ...TRI.topRight] },
    { type: "DRAW_LINE", params: [...TRI.baseRight, ...TRI.topRight] },
    // Block aligned with the slope (bottom edge on the incline).
    { type: "DRAW_LINE", params: [...BLOCK.corners[0], ...BLOCK.corners[1]] },
    { type: "DRAW_LINE", params: [...BLOCK.corners[1], ...BLOCK.corners[2]] },
    { type: "DRAW_LINE", params: [...BLOCK.corners[2], ...BLOCK.corners[3]] },
    { type: "DRAW_LINE", params: [...BLOCK.corners[3], ...BLOCK.corners[0]] },
    // Force arrows from the block center.
    { type: "DRAW_LINE", params: [...BLOCK.center, ...frictionEnd] },
    { type: "DRAW_LINE", params: [...BLOCK.center, ...normalEnd] },
    { type: "DRAW_LINE", params: [...BLOCK.center, BLOCK.center[0], TRI.baseRight[1]] },
    // Angle θ marker at the base-left vertex.
    { type: "DRAW_LINE", params: TICK_BASE },
    { type: "DRAW_LINE", params: TICK_SLOPE },
  ],
  introPhases: [
    {
      narration:
        "the ground is the horizontal base along the bottom, and the incline rises from the left corner where the angle θ sits.",
      commandIndices: [0, 1, 2, 11, 12],
    },
    {
      narration:
        "the block sits on the sloped surface with its bottom edge flush against the incline.",
      commandIndices: [3, 4, 5, 6],
    },
    {
      narration:
        "the force directions are tied to the plane: friction is along the surface, the normal is perpendicular to it, and the weight is straight down.",
      commandIndices: [7, 8, 9],
    },
  ],
  anchors: [
    { id: "m", labels: ["m", "mass", "block"], x: BLOCK.center[0] - 20, y: BLOCK.center[1] - 24, width: 36, height: 38 },
    { id: "f", labels: ["f", "friction"], x: frictionEnd[0] + 4, y: frictionEnd[1] - 18, width: 36, height: 38 },
    { id: "N", labels: ["N", "normal"], x: normalEnd[0] - 8, y: normalEnd[1] - 18, width: 36, height: 38 },
    { id: "mg", labels: ["mg", "weight"], x: BLOCK.center[0] + 8, y: TRI.baseRight[1] - 6, width: 46, height: 38 },
    { id: "theta", labels: ["θ", "theta", "angle"], x: TRI.baseLeft[0] + 44, y: TRI.baseLeft[1] - 30, width: 34, height: 34 },
  ],
  promptAddon: `internal diagram note "incline_fbd": the right side already shows a right triangle with the ground along the BOTTOM, a block on the incline, and friction / normal / weight arrows — geometry only, no text labels yet. do not mention this note to the student.
do NOT use [DRAW_LINE], [DRAW_CIRCLE], [DRAW_RECT], or any other structural draw command in the diagram zone. do NOT redraw the ramp, block, or force arrows. do NOT say "let me draw". add clean symbol labels one per [STEP]: m, f, N, mg, and θ. keep given numbers on the left, not inside the diagram.
after labeling, explain each force by circling the label text. resolve weight into components: mg sin θ down the slope, mg cos θ into the plane. write equations on the left and annotate diagram labels when reusing them. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
