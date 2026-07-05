import type { DiagramTemplate } from "./types";

export const COORDINATION_GEO_TEMPLATE: DiagramTemplate = {
  id: "coordination_geo",
  name: "coordination compounds — geometry",
  test:
    /coordination.*compound|complex.*ion|ligand|octahedral|tetrahedral|square planar|crystal field|d-d transition|color.*complex|coordination number/i,
  commands: [
    { type: "DRAW_CIRCLE", params: [650, 300, 15] },
    { type: "DRAW_LINE", params: [650, 300, 650, 200] },
    { type: "DRAW_LINE", params: [650, 300, 650, 400] },
    { type: "DRAW_LINE", params: [650, 300, 550, 300] },
    { type: "DRAW_LINE", params: [650, 300, 750, 300] },
    { type: "DRAW_LINE", params: [650, 300, 580, 230] },
    { type: "DRAW_LINE", params: [650, 300, 720, 370] },
  ],
  introPhases: [
    {
      narration:
        "the central metal ion is at the center, with six ligand bonds extending outward in an octahedral arrangement.",
      commandIndices: [0, 1, 2, 3, 4, 5, 6],
    },
  ],
  anchors: [
    { id: "M", labels: ["M", "metal", "central metal"], x: 635, y: 270, width: 36, height: 38 },
    { id: "L1", labels: ["L1", "ligand 1"], x: 635, y: 190, width: 40, height: 38 },
    { id: "L2", labels: ["L2", "ligand 2"], x: 635, y: 400, width: 40, height: 38 },
    { id: "L3", labels: ["L3", "ligand 3"], x: 535, y: 290, width: 40, height: 38 },
    { id: "L4", labels: ["L4", "ligand 4"], x: 755, y: 290, width: 40, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "coordination_geo": the right side has the central metal and six ligand bonds in octahedral geometry. do not mention this note to the student.
label the central metal M and key ligands. for tetrahedral geometry, describe the 3D arrangement in narration. for crystal field theory, draw the d-orbital splitting as horizontal [DRAW_LINE] segments and label them. write the IUPAC name and coordination number on the left. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
