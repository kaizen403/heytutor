import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

/**
 * Simple pendulum — string from a ceiling, bob displaced by angle θ
 * from the dashed vertical reference.
 */
export const PENDULUM_TEMPLATE: DiagramTemplate = {
  id: "pendulum",
  name: "simple pendulum",
  test: /pendulum|bob.{0,50}(?:string|thread|wire)|(?:string|thread).{0,50}bob/i,
  commands: [
    // 0: ceiling
    { type: "DRAW_LINE", params: [600, 190, 780, 190] },
    // 1: dashed vertical reference through the pivot
    { type: "DRAW_LINE", params: [690, 190, 690, 420, 1] },
    // 2: string at an angle
    { type: "DRAW_LINE", params: [690, 190, 596, 382] },
    // 3: bob
    { type: "DRAW_CIRCLE", params: [588, 398, 20] },
    // 4: weight arrow from the bob straight down
    { type: "DRAW_LINE", params: [588, 418, 588, 470] },
  ],
  introPhases: [
    {
      narration:
        "the pendulum hangs from a fixed support, and the dashed line is the vertical rest position.",
      commandIndices: [0, 1],
    },
    {
      narration:
        "the string is pulled to one side, so the bob is displaced by a small angle from the vertical.",
      commandIndices: [2, 3],
    },
    {
      narration:
        "gravity pulls the bob straight down, and its component along the swing brings the bob back — that restoring pull is what makes it oscillate.",
      commandIndices: [4],
    },
  ],
  anchors: [
    { id: "L", labels: ["L", "l", "length"], x: 615, y: 262, width: 36, height: 36 },
    { id: "theta", labels: ["θ", "theta", "angle"], x: 702, y: 240, width: 34, height: 34 },
    { id: "m", labels: ["m", "mass", "bob"], x: 540, y: 388, width: 36, height: 36 },
    { id: "mg", labels: ["mg", "weight"], x: 600, y: 462, width: 44, height: 36 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "pendulum": the right side has the support, dashed vertical reference, angled string, bob, and weight arrow as geometry only, no text labels yet. do not mention this note to the student.
do NOT redraw the string, bob, or reference line. do NOT draw a sine wave for a pendulum question — the pendulum picture is the string and bob.
phase 1 — label one symbol per [STEP]: L along the string (615,262), θ between the string and the dashed vertical (702,240), m at the bob (540,388), mg below the bob (600,462).
phase 2 — [CIRCLE_AROUND] each label while explaining: the restoring force is mg sin θ, and for small angles sin θ ≈ θ, which gives simple harmonic motion.
phase 3 — solve on the left (x 90): T = 2π√(L/g) for the period, then substitute the given numbers. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
