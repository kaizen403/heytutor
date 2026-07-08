import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

/**
 * Atwood machine / connected blocks over a pulley.
 *
 * Layout (diagram zone, y down):
 *   ceiling at top, pulley disc below it,
 *   string down both sides, heavier block lower-left, lighter block upper-right
 */
export const PULLEY_ATWOOD_TEMPLATE: DiagramTemplate = {
  id: "pulley_atwood",
  name: "pulley and connected masses",
  test:
    /pulley|atwood|connected by (?:a |an )?(?:light |massless |inextensible |ideal )*(?:string|rope|cord)|(?:masses|blocks).{0,50}(?:string|rope|cord).{0,40}(?:hang|suspend)/i,
  commands: [
    // 0: ceiling
    { type: "DRAW_LINE", params: [600, 180, 770, 180] },
    // 1: pulley mount
    { type: "DRAW_LINE", params: [685, 180, 685, 205] },
    // 2: pulley disc
    { type: "DRAW_CIRCLE", params: [685, 240, 36] },
    // 3: left string
    { type: "DRAW_LINE", params: [649, 240, 649, 350] },
    // 4: right string
    { type: "DRAW_LINE", params: [721, 240, 721, 305] },
    // 5: left block (heavier, hangs lower)
    { type: "DRAW_RECT", params: [615, 350, 68, 60] },
    // 6: right block
    { type: "DRAW_RECT", params: [687, 305, 68, 60] },
  ],
  introPhases: [
    {
      narration:
        "a light pulley hangs from a fixed support at the top.",
      commandIndices: [0, 1, 2],
    },
    {
      narration:
        "one string runs over the pulley, so both sides carry the same tension.",
      commandIndices: [3, 4],
    },
    {
      narration:
        "the two masses hang on either side — the heavier one will accelerate down while the lighter one goes up.",
      commandIndices: [5, 6],
    },
  ],
  anchors: [
    { id: "m1", labels: ["m_1", "m1", "M"], x: 636, y: 368, width: 44, height: 38 },
    { id: "m2", labels: ["m_2", "m2"], x: 708, y: 322, width: 44, height: 38 },
    { id: "T", labels: ["T", "tension"], x: 595, y: 280, width: 36, height: 36 },
    { id: "a", labels: ["a", "acceleration"], x: 775, y: 270, width: 36, height: 36 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "pulley_atwood": the right side has the support, pulley, string on both sides, and the two hanging blocks as geometry only, no text labels yet. do not mention this note to the student.
do NOT redraw the pulley, strings, or blocks. always write subscripts with underscores: m_1, m_2, T.
phase 1 — label one symbol per [STEP]: m_1 on the left block (636,368), m_2 on the right block (708,322), T beside the left string (595,280), a beside the right string (775,270).
phase 2 — [CIRCLE_AROUND] each label while explaining: same string means same tension on both sides, and both blocks share one acceleration magnitude.
phase 3 — solve on the left (x 90): write newton's second law for each block separately, m_1 g - T = m_1 a and T - m_2 g = m_2 a, then add them to get a = (m_1 - m_2)g/(m_1 + m_2), then back-substitute for T. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
