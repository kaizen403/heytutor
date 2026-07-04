import type { DiagramTemplate } from "./types";

export const ORGANIC_HEXAGON_TEMPLATE: DiagramTemplate = {
  id: "organic_hexagon",
  name: "organic chemistry — benzene ring",
  test:
    /benzene|aromatic|hexagon.*ring|organic.*mechanism|electrophil|nucleophil.*aromatic|friedel|alkyl.*reaction|substitution.*aromatic/i,
  commands: [
    { type: "DRAW_LINE", params: [710, 300, 680, 248] },
    { type: "DRAW_LINE", params: [680, 248, 620, 248] },
    { type: "DRAW_LINE", params: [620, 248, 590, 300] },
    { type: "DRAW_LINE", params: [590, 300, 620, 352] },
    { type: "DRAW_LINE", params: [620, 352, 680, 352] },
    { type: "DRAW_LINE", params: [680, 352, 710, 300] },
  ],
  introPhases: [
    {
      narration:
        "the six-sided ring is the benzene structure. each vertex is a carbon atom.",
      commandIndices: [0, 1, 2, 3, 4, 5],
    },
  ],
  anchors: [
    { id: "C1", labels: ["C1", "carbon 1"], x: 710, y: 300, width: 40, height: 38 },
    { id: "C2", labels: ["C2", "carbon 2"], x: 680, y: 248, width: 40, height: 38 },
    { id: "C3", labels: ["C3", "carbon 3"], x: 620, y: 248, width: 40, height: 38 },
    { id: "C4", labels: ["C4", "carbon 4"], x: 590, y: 300, width: 40, height: 38 },
    { id: "C5", labels: ["C5", "carbon 5"], x: 620, y: 352, width: 40, height: 38 },
    { id: "C6", labels: ["C6", "carbon 6"], x: 680, y: 352, width: 40, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "organic_hexagon": the right side has a benzene hexagon as geometry only. do not mention this note to the student.
do NOT redraw the hexagon. label carbon positions as needed for the mechanism. draw substituents as [DRAW_LINE] from the relevant vertex. for mechanisms, use [ARROW:x1,y1,cx,cy,x2,y2] with 6 params (curved arrow) to show electron pushing from nucleophile to electrophile. write the reaction equation on the left. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
