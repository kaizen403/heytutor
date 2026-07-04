import type { DiagramTemplate } from "./types";

export const ELECTROSTATICS_TEMPLATE: DiagramTemplate = {
  id: "electrostatics",
  name: "electrostatics — field lines and charges",
  test:
    /electric field|field line|coulomb|point charge|capacitor|plate.*charge|dipole|gauss|E = k|q.*charge|electric flux|dipole moment/i,
  commands: [
    { type: "DRAW_CIRCLE", params: [650, 300, 14] },
  ],
  introPhases: [
    {
      narration:
        "the central point is the charge. electric field lines radiate outward from a positive charge.",
      commandIndices: [0],
    },
  ],
  anchors: [
    { id: "q", labels: ["q", "Q", "charge"], x: 635, y: 270, width: 36, height: 38 },
    { id: "E", labels: ["E", "field", "electric field"], x: 740, y: 250, width: 36, height: 38 },
    { id: "F", labels: ["F", "force"], x: 740, y: 350, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "electrostatics": the right side has a single central charge as geometry only. do not mention this note to the student.
label the charge q and field E. draw field lines radiating outward using [DRAW_LINE] from the charge to surrounding points. for a dipole, draw a second negative charge and lines from + to -. for a capacitor, draw two parallel plates using [DRAW_LINE] and vertical field lines between them. write Coulomb's law F = kq1q2/r^2 on the left with y rows 145,205,265,325,385,445,505,565,625 only.`,
};
