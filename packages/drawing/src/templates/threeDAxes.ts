import type { DiagramTemplate } from "./types";

export const THREE_D_AXES_TEMPLATE: DiagramTemplate = {
  id: "3d_axes",
  name: "3D coordinate axes",
  test:
    /3d|three dimension|vector.*component|direction cosine|cartesian.*three|hat i|hat j|hat k|space.*vector|3-?d.*geometry/i,
  commands: [
    { type: "DRAW_LINE", params: [650, 300, 850, 380] },
    { type: "DRAW_LINE", params: [650, 300, 450, 380] },
    { type: "DRAW_LINE", params: [650, 300, 650, 120] },
  ],
  introPhases: [
    {
      narration:
        "three axes meet at the origin. the x-axis goes right, the y-axis goes left, and the z-axis goes up.",
      commandIndices: [0, 1, 2],
    },
  ],
  anchors: [
    { id: "O", labels: ["O", "origin"], x: 635, y: 290, width: 36, height: 38 },
    { id: "i", labels: ["x", "i", "x-axis"], x: 860, y: 390, width: 36, height: 38 },
    { id: "j", labels: ["y", "j", "y-axis"], x: 440, y: 390, width: 36, height: 38 },
    { id: "k", labels: ["z", "k", "z-axis"], x: 660, y: 110, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "3d_axes": the right side has three axes from the origin as geometry only. do not mention this note to the student.
label the origin O and the three axes x, y, z (or i, j, k). draw vectors as [ARROW] from the origin. for a plane, draw the three intercept lines. write direction cosines or vector components on the left with y rows 145,205,265,325,385,445,505,565,625 only.`,
};
