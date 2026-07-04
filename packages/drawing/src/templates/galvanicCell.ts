import type { DiagramTemplate } from "./types";

export const GALVANIC_CELL_TEMPLATE: DiagramTemplate = {
  id: "galvanic_cell",
  name: "electrochemistry — galvanic cell",
  test:
    /galvanic|electrolytic|electrode.*cell|salt bridge|cell potential|nernst|oxidation.*reduction|anode|cathode|emf.*cell|electrochem/i,
  commands: [
    { type: "DRAW_RECT", params: [540, 240, 60, 120] },
    { type: "DRAW_RECT", params: [760, 240, 60, 120] },
    { type: "DRAW_LINE", params: [650, 180, 650, 240] },
    { type: "DRAW_LINE", params: [570, 240, 570, 190] },
    { type: "DRAW_LINE", params: [570, 190, 790, 190] },
    { type: "DRAW_LINE", params: [790, 190, 790, 240] },
  ],
  introPhases: [
    {
      narration:
        "two electrodes sit in separate solutions, connected by a salt bridge and an external wire.",
      commandIndices: [0, 1, 2, 3, 4, 5],
    },
  ],
  anchors: [
    { id: "anode", labels: ["anode", "oxidation"], x: 545, y: 230, width: 60, height: 38 },
    { id: "cathode", labels: ["cathode", "reduction"], x: 765, y: 230, width: 60, height: 38 },
    { id: "salt", labels: ["salt bridge"], x: 655, y: 195, width: 80, height: 38 },
    { id: "electron", labels: ["e-", "electron", "electrons"], x: 680, y: 170, width: 40, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "galvanic_cell": the right side has two electrodes, a salt bridge, and an external wire as geometry only. do not mention this note to the student.
label the anode and cathode. show electron flow on the wire using [ARROW] in the correct direction. write the half-reactions on the left: oxidation at anode, reduction at cathode. write E_cell = E_cathode - E_anode and the Nernst equation. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
