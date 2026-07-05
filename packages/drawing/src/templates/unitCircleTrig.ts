import type { DiagramTemplate } from "./types";

export const UNIT_CIRCLE_TRIG_TEMPLATE: DiagramTemplate = {
  id: "unit_circle_trig",
  name: "unit circle — trigonometry",
  test:
    /unit circle|sin.*cos.*circle|trig.*identity|trigonometric.*identity|radian|quadrant|reference angle|cos.*theta.*sin.*theta/i,
  commands: [
    { type: "DRAW_CIRCLE", params: [650, 300, 120] },
    { type: "DRAW_LINE", params: [470, 300, 830, 300] },
    { type: "DRAW_LINE", params: [650, 130, 650, 470] },
  ],
  introPhases: [
    {
      narration:
        "the unit circle has radius one. the x and y axes cross at the center.",
      commandIndices: [0, 1, 2],
    },
  ],
  anchors: [
    { id: "O", labels: ["O", "center", "origin"], x: 635, y: 290, width: 36, height: 38 },
    { id: "theta", labels: ["θ", "theta", "angle"], x: 580, y: 320, width: 34, height: 34 },
    { id: "P", labels: ["P", "point"], x: 730, y: 220, width: 36, height: 38 },
    { id: "sin", labels: ["sin", "sin θ", "opposite"], x: 745, y: 300, width: 40, height: 38 },
    { id: "cos", labels: ["cos", "cos θ", "adjacent"], x: 650, y: 225, width: 40, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "unit_circle_trig": the right side has the unit circle and axes as geometry only. do not mention this note to the student.
label the angle θ, point P on the circle, and the sin/cos legs. draw the radius as [DRAW_LINE] from O to P. write the trig identity on the left and use the unit circle to explain why it holds. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
