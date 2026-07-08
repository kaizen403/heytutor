import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

/**
 * 1D collision — before/after momentum diagram.
 *
 * Top row: two blocks approaching each other (before).
 * Dashed divider, then bottom row: blocks after the collision moving right.
 */
export const COLLISION_TEMPLATE: DiagramTemplate = {
  id: "collision",
  name: "collision before/after",
  test:
    /collision|collides?|elastic.{0,30}inelastic|perfectly (?:elastic|inelastic)|stick together|coalesce|recoil|(?:momentum|impulse).{0,50}conserv|conserv\w*.{0,40}(?:momentum|impulse)/i,
  commands: [
    // 0–3: before — left block moving right, right block moving left
    { type: "DRAW_RECT", params: [500, 235, 70, 55] },
    { type: "DRAW_LINE", params: [580, 262, 635, 262] },
    { type: "DRAW_RECT", params: [720, 235, 70, 55] },
    { type: "DRAW_LINE", params: [710, 262, 655, 262] },
    // 4: dashed divider between before and after
    { type: "DRAW_LINE", params: [470, 330, 890, 330, 1] },
    // 5–8: after — both blocks moving right
    { type: "DRAW_RECT", params: [560, 370, 70, 55] },
    { type: "DRAW_LINE", params: [640, 397, 690, 397] },
    { type: "DRAW_RECT", params: [720, 370, 70, 55] },
    { type: "DRAW_LINE", params: [800, 397, 850, 397] },
  ],
  introPhases: [
    {
      narration:
        "before the collision, the two bodies move toward each other along one line.",
      commandIndices: [0, 1, 2, 3],
    },
    {
      narration:
        "the dashed line separates before from after, because momentum comparison happens across it.",
      commandIndices: [4],
    },
    {
      narration:
        "after the collision the bodies move with new velocities, and the total momentum stays exactly the same.",
      commandIndices: [5, 6, 7, 8],
    },
  ],
  anchors: [
    { id: "m1", labels: ["m_1", "m1"], x: 512, y: 200, width: 44, height: 36 },
    { id: "u1", labels: ["u_1", "u1", "v_1", "v1"], x: 592, y: 228, width: 44, height: 36 },
    { id: "m2", labels: ["m_2", "m2"], x: 732, y: 200, width: 44, height: 36 },
    { id: "u2", labels: ["u_2", "u2"], x: 662, y: 228, width: 44, height: 36 },
    { id: "v1p", labels: ["v_1'", "v1'"], x: 645, y: 435, width: 44, height: 36 },
    { id: "v2p", labels: ["v_2'", "v2'"], x: 805, y: 435, width: 44, height: 36 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "collision": the right side has a before row (two blocks with approach arrows), a dashed divider, and an after row (two blocks with arrows) as geometry only, no text labels yet. do not mention this note to the student.
do NOT redraw the blocks, arrows, or divider. always write subscripts with underscores: m_1, u_1, v_1'.
phase 1 — label one symbol per [STEP]: m_1 (512,200) and u_1 (592,228) on the top-left block, m_2 (732,200) and u_2 (662,228) on the top-right block, then the unknown final velocities v_1' (645,435) and v_2' (805,435) on the bottom row.
phase 2 — [CIRCLE_AROUND] labels while explaining: total momentum before equals total momentum after; kinetic energy is conserved only if the collision is elastic.
phase 3 — solve on the left (x 90): m_1 u_1 + m_2 u_2 = m_1 v_1' + m_2 v_2', add the elastic-collision or common-velocity condition as the question requires, then substitute numbers. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
