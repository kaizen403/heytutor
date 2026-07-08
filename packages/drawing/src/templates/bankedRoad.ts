import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

/**
 * Banked road cross-section — inclined road surface, vehicle block,
 * normal arrow perpendicular to the surface, weight straight down.
 */
export const BANKED_ROAD_TEMPLATE: DiagramTemplate = {
  id: "banked_road",
  name: "banked road",
  test: /banked (?:road|curve|track|turn)|banking (?:angle|of)|angle of banking/i,
  commands: [
    // 0: ground reference
    { type: "DRAW_LINE", params: [490, 430, 890, 430] },
    // 1: banked surface
    { type: "DRAW_LINE", params: [530, 430, 860, 290] },
    // 2–5: vehicle as slanted block on the surface
    { type: "DRAW_LINE", params: [650, 372, 726, 340] },
    { type: "DRAW_LINE", params: [726, 340, 748, 384] },
    { type: "DRAW_LINE", params: [748, 384, 672, 416] },
    { type: "DRAW_LINE", params: [672, 416, 650, 372] },
    // 6: normal arrow perpendicular to the surface
    { type: "DRAW_LINE", params: [700, 378, 646, 262] },
    // 7: weight arrow straight down
    { type: "DRAW_LINE", params: [700, 378, 700, 490] },
    // 8: angle marker at the base
    { type: "DRAW_LINE", params: [530, 430, 620, 430] },
  ],
  introPhases: [
    {
      narration:
        "this is the cross section of the road: the surface is tilted at the banking angle above the horizontal.",
      commandIndices: [0, 1, 8],
    },
    {
      narration:
        "the vehicle sits on the banked surface as it goes around the curve.",
      commandIndices: [2, 3, 4, 5],
    },
    {
      narration:
        "the normal force is perpendicular to the road and the weight is straight down — the horizontal part of the normal force supplies the centripetal force.",
      commandIndices: [6, 7],
    },
  ],
  anchors: [
    { id: "N", labels: ["N", "normal"], x: 625, y: 245, width: 36, height: 36 },
    { id: "mg", labels: ["mg", "weight"], x: 712, y: 478, width: 44, height: 36 },
    { id: "theta", labels: ["θ", "theta", "angle"], x: 592, y: 398, width: 34, height: 34 },
    { id: "v", labels: ["v", "speed"], x: 782, y: 322, width: 36, height: 36 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "banked_road": the right side has the ground line, banked surface, vehicle, normal arrow, weight arrow, and angle marker as geometry only, no text labels yet. do not mention this note to the student.
do NOT redraw the road, vehicle, or arrows.
phase 1 — label one symbol per [STEP]: N on the normal arrow (625,245), mg below the weight arrow (712,478), θ at the base angle (592,398), v on the vehicle (782,322).
phase 2 — [CIRCLE_AROUND] each label while explaining: N cos θ balances mg vertically, and N sin θ points toward the center of the curve, providing the centripetal force.
phase 3 — solve on the left (x 90): N cos θ = mg and N sin θ = mv^2/r, divide them to get tan θ = v^2/(rg), then solve for the asked quantity. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
