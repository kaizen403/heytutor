import type { DiagramTemplate } from "./types";

export const REACTION_ARROW_TEMPLATE: DiagramTemplate = {
  id: "reaction_arrow",
  name: "chemical reaction equations",
  test:
    /chemical reaction|balanc.*equation|stoichiometry|mole.*concept|limiting reagent|percent yield|reactant.*product|type.*reaction/i,
  commands: [],
  introPhases: [],
  anchors: [],
  allowLlmDrawInDiagramZone: false,
  promptAddon: `internal diagram note "reaction_arrow": this is a text-based topic with no diagram skeleton. do not mention this note to the student.
write the balanced equation on the left using [WRITE]. put reactants on one row, the reaction arrow on the next, products on the third. label state symbols (s), (l), (g), (aq) next to each compound. for stoichiometry, write the mole ratio below the equation and calculate using the unitary method. say each compound name aloud as you write it. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
