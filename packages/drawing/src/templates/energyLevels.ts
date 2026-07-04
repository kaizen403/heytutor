import type { DiagramTemplate } from "./types";

export const ENERGY_LEVELS_TEMPLATE: DiagramTemplate = {
  id: "energy_levels",
  name: "energy levels — atomic structure",
  test:
    /energy level|bohr|atomic spectrum|transition.*photon|photon.*emission|absorption.*photon|rydberg|ground state|excited state|n = [1-5]|spectral line/i,
  commands: [
    { type: "DRAW_LINE", params: [520, 460, 780, 460] },
    { type: "DRAW_LINE", params: [520, 380, 780, 380] },
    { type: "DRAW_LINE", params: [520, 300, 780, 300] },
    { type: "DRAW_LINE", params: [520, 240, 780, 240] },
    { type: "DRAW_LINE", params: [520, 200, 780, 200] },
  ],
  introPhases: [
    {
      narration:
        "these horizontal lines are the energy levels of the atom. the lowest one is the ground state, and higher ones are excited states.",
      commandIndices: [0, 1, 2, 3, 4],
    },
  ],
  anchors: [
    { id: "n1", labels: ["n=1", "n1", "ground"], x: 560, y: 470, width: 50, height: 38 },
    { id: "n2", labels: ["n=2", "n2"], x: 560, y: 390, width: 50, height: 38 },
    { id: "n3", labels: ["n=3", "n3"], x: 560, y: 310, width: 50, height: 38 },
    { id: "n4", labels: ["n=4", "n4"], x: 560, y: 250, width: 50, height: 38 },
    { id: "n5", labels: ["n=5", "n5"], x: 560, y: 210, width: 50, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "energy_levels": the right side has five horizontal energy levels as geometry only, with no text labels yet. do not mention this note to the student.
label each level n=1,2,3,4,5 one per [STEP] from bottom to top — say the level number, then [LABEL]. draw transitions as [ARROW] commands between levels: downward for emission, upward for absorption. write E_n = -13.6/n^2 eV on the left, then calculate the photon energy as the difference between two levels. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
