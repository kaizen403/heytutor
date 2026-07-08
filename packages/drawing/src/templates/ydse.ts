import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

/**
 * Young's double slit — barrier with two slits, screen on the right,
 * central axis, and rays from both slits meeting at a point on the screen.
 */
export const YDSE_TEMPLATE: DiagramTemplate = {
  id: "ydse",
  name: "young's double slit",
  test:
    /double[- ]slit|young'?s (?:experiment|double)|ydse|fringe (?:width|pattern)|path difference.{0,40}(?:slit|interference)|interference.{0,40}(?:slit|fringe)/i,
  commands: [
    // 0–2: barrier with two slit gaps
    { type: "DRAW_LINE", params: [560, 190, 560, 280] },
    { type: "DRAW_LINE", params: [560, 300, 560, 355] },
    { type: "DRAW_LINE", params: [560, 375, 560, 465] },
    // 3: screen
    { type: "DRAW_LINE", params: [860, 190, 860, 465] },
    // 4: dashed central axis
    { type: "DRAW_LINE", params: [560, 327, 860, 327, 1] },
    // 5–6: rays from both slits to point P on the screen
    { type: "DRAW_LINE", params: [560, 290, 860, 250] },
    { type: "DRAW_LINE", params: [560, 365, 860, 250] },
  ],
  introPhases: [
    {
      narration:
        "light hits a barrier with two narrow slits, so each slit acts as its own source of waves.",
      commandIndices: [0, 1, 2],
    },
    {
      narration:
        "a screen on the right catches the light, and the dashed central axis marks the point exactly between the slits.",
      commandIndices: [3, 4],
    },
    {
      narration:
        "waves from the two slits travel slightly different distances to the same point, and that path difference decides whether they add up bright or cancel dark.",
      commandIndices: [5, 6],
    },
  ],
  anchors: [
    { id: "S1", labels: ["S_1", "S1", "slit 1"], x: 520, y: 272, width: 40, height: 34 },
    { id: "S2", labels: ["S_2", "S2", "slit 2"], x: 520, y: 358, width: 40, height: 34 },
    { id: "d", labels: ["d", "slit separation"], x: 585, y: 320, width: 30, height: 32 },
    { id: "D", labels: ["D", "distance"], x: 700, y: 350, width: 34, height: 34 },
    { id: "P", labels: ["P", "point"], x: 872, y: 232, width: 30, height: 32 },
    { id: "y", labels: ["y", "fringe"], x: 872, y: 285, width: 30, height: 32 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "ydse": the right side has the double-slit barrier, screen, dashed central axis, and two rays meeting at a point P — geometry only, no text labels yet. do not mention this note to the student.
do NOT redraw the barrier, screen, or rays. always write subscripts with underscores: S_1, S_2.
phase 1 — label one symbol per [STEP]: S_1 (520,272) and S_2 (520,358) at the slits, d between the slits (585,320), D along the axis (700,350), P at the meeting point (872,232), y from the axis to P (872,285).
phase 2 — [CIRCLE_AROUND] labels while explaining: the path difference is d sin θ ≈ d y/D; bright fringes need path difference nλ, dark fringes need (n + 1/2)λ.
phase 3 — solve on the left (x 90): fringe width β = λD/d, then substitute the given numbers, watching the units. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
