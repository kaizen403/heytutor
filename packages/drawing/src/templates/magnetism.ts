import type { DiagramTemplate } from "./types";

export const MAGNETISM_TEMPLATE: DiagramTemplate = {
  id: "magnetism",
  name: "magnetism and EMI",
  test:
    /magnetic field|b field|solenoid|bar magnet|right hand rule|lenz|faraday|induct.*current|flux.*magnetic|biot-savart|ampere.*law|magnetic.*force/i,
  commands: [
    { type: "DRAW_LINE", params: [650, 160, 650, 440] },
    { type: "DRAW_CIRCLE", params: [650, 300, 50] },
    { type: "DRAW_CIRCLE", params: [650, 300, 90] },
  ],
  introPhases: [
    {
      narration:
        "the vertical line is a current-carrying wire. the magnetic field forms circles around it.",
      commandIndices: [0, 1, 2],
    },
  ],
  anchors: [
    { id: "I", labels: ["I", "current"], x: 635, y: 170, width: 36, height: 38 },
    { id: "B", labels: ["B", "field", "magnetic field"], x: 730, y: 300, width: 36, height: 38 },
    { id: "r", labels: ["r", "radius"], x: 690, y: 340, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "magnetism": the right side has a vertical wire with two circular field lines as geometry only. do not mention this note to the student.
label current I and field B. for a solenoid, draw a rectangle outline and internal field lines using [DRAW_LINE]. for Faraday's law, draw the changing flux and induced current direction with [ARROW]. for force on a wire, use F = BIL. write the relevant equation on the left with y rows 145,205,265,325,385,445,505,565,625 only.`,
};
