import type { DiagramTemplate } from "./types";

export const PV_DIAGRAM_TEMPLATE: DiagramTemplate = {
  id: "pv_diagram",
  name: "PV diagram — thermodynamics",
  test:
    /pv diagram|isothermal|adiabatic|carnot|cyclic process|pressure.*volume|p-v|work done.*gas|first law.*thermo|thermodynamic.*cycle/i,
  commands: [
    { type: "DRAW_LINE", params: [470, 160, 470, 500] },
    { type: "DRAW_LINE", params: [470, 500, 900, 500] },
  ],
  introPhases: [
    {
      narration:
        "the vertical axis is pressure P, and the horizontal axis is volume V. this is the PV plane where thermodynamic processes live.",
      commandIndices: [0, 1],
    },
  ],
  anchors: [
    { id: "P", labels: ["P", "pressure"], x: 455, y: 175, width: 36, height: 38 },
    { id: "V", labels: ["V", "volume"], x: 890, y: 515, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "pv_diagram": the right side has the P and V axes as geometry only. do not mention this note to the student.
label P on the vertical axis and V on the horizontal axis. draw process curves using DRAW_LINE with the curve flag (last param = 2) through computed points: isothermal is a hyperbola, adiabatic is steeper. for a cycle, draw 2-4 curves forming a closed loop. shade the enclosed area with [HIGHLIGHT] to show work done. write first law dU = dQ - dW and process equations on the left with y rows 145,205,265,325,385,445,505,565,625 only.`,
};
