import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

/**
 * Photoelectric effect — stopping potential vs frequency graph:
 * axes, threshold intercept on the frequency axis, rising straight line.
 */
export const PHOTOELECTRIC_TEMPLATE: DiagramTemplate = {
  id: "photoelectric",
  name: "photoelectric effect",
  test:
    /photoelectric|photo[- ]?electron|work function|stopping potential|threshold (?:frequency|wavelength)|einstein'?s photo/i,
  commands: [
    // 0: y axis (stopping potential)
    { type: "DRAW_LINE", params: [540, 190, 540, 440] },
    // 1: x axis (frequency)
    { type: "DRAW_LINE", params: [540, 440, 880, 440] },
    // 2: rising line starting at the threshold frequency
    { type: "DRAW_LINE", params: [650, 440, 850, 240] },
    // 3: dashed drop marking the threshold frequency intercept
    { type: "DRAW_LINE", params: [650, 440, 650, 470, 1] },
  ],
  introPhases: [
    {
      narration:
        "we plot stopping potential on the vertical axis against the frequency of the incoming light on the horizontal axis.",
      commandIndices: [0, 1],
    },
    {
      narration:
        "below a threshold frequency no electrons come out at all — the line only starts there.",
      commandIndices: [3],
    },
    {
      narration:
        "above the threshold, the stopping potential rises in a straight line, and its slope is planck's constant divided by the electron charge.",
      commandIndices: [2],
    },
  ],
  anchors: [
    { id: "V0", labels: ["V_0", "V0", "stopping potential"], x: 495, y: 180, width: 44, height: 34 },
    { id: "nu", labels: ["ν", "f", "frequency"], x: 886, y: 452, width: 34, height: 34 },
    { id: "nu0", labels: ["ν_0", "f_0", "threshold"], x: 638, y: 478, width: 44, height: 34 },
    { id: "phi", labels: ["φ", "W", "work function"], x: 700, y: 300, width: 40, height: 34 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "photoelectric": the right side has the stopping-potential vs frequency axes, the threshold intercept, and the rising line — geometry only, no text labels yet. do not mention this note to the student.
do NOT redraw the axes or the line. always write subscripts with underscores: V_0, ν_0.
phase 1 — label one symbol per [STEP]: V_0 on the vertical axis (495,180), ν on the horizontal axis (886,452), ν_0 at the threshold intercept (638,478), φ near the line (700,300).
phase 2 — [CIRCLE_AROUND] labels while explaining: each photon carries energy hν; the work function φ is the minimum energy to free an electron; whatever is left becomes kinetic energy.
phase 3 — solve on the left (x 90): einstein's equation hν = φ + eV_0, so V_0 = (h/e)ν - φ/e — the slope is h/e and the intercept gives the work function. substitute given numbers, watching electron-volt versus joule units. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
