import type { DiagramTemplate } from "./types";

export const LEWIS_STRUCTURE_TEMPLATE: DiagramTemplate = {
  id: "lewis_structure",
  name: "chemical bonding — Lewis structures",
  test:
    /lewis|electron dot|bond pair|lone pair|valence electron|octet|vsepr|hybridization|molecular geometry|lewis.*structure/i,
  commands: [],
  introPhases: [],
  anchors: [],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "lewis_structure": no skeleton geometry is pre-drawn for this topic. do not mention this note to the student.
draw the central atom as a [LABEL], then surrounding atoms as [LABEL] commands at appropriate positions. draw bond pairs as [DRAW_LINE] between atoms. draw lone pairs as small [DRAW_CIRCLE] dots near atoms. count valence electrons and write the count on the left. for VSEPR, describe the geometry in narration. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
