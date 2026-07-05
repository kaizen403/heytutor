import type { DiagramTemplate } from "./types";

export const WAVE_SHM_TEMPLATE: DiagramTemplate = {
  id: "wave_shm",
  name: "oscillations and waves",
  test:
    /wave|wavelength|amplitude|frequency|sinusoidal|\bshm\b|simple harmonic|oscillation|periodic|\bnode\b|antinode|pendulum/i,
  commands: [
    { type: "DRAW_LINE", params: [460, 300, 880, 300] },
  ],
  introPhases: [
    {
      narration:
        "the equilibrium line is the horizontal reference. the wave oscillates above and below it.",
      commandIndices: [0],
    },
  ],
  anchors: [
    { id: "A", labels: ["A", "amplitude"], x: 660, y: 220, width: 36, height: 38 },
    { id: "lambda", labels: ["λ", "lambda", "wavelength"], x: 560, y: 340, width: 40, height: 38 },
    { id: "T", labels: ["T", "period"], x: 880, y: 340, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "wave_shm": the right side has the equilibrium line only. do not mention this note to the student.
label amplitude A and wavelength λ. draw the sinusoidal wave using DRAW_LINE with the curve flag (last param = 2) through points at the peaks and troughs. for SHM, draw the equilibrium and the displacement curve. for a standing wave, draw nodes and antinodes. write the wave equation y = A sin(kx - ωt) or SHM equation x = A cos(ωt) on the left with y rows 145,205,265,325,385,445,505,565,625 only.`,
};
