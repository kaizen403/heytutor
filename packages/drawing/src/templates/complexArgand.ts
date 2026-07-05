import type { DiagramTemplate } from "./types";

export const COMPLEX_ARGAND_TEMPLATE: DiagramTemplate = {
  id: "complex_argand",
  name: "Argand plane — complex numbers",
  test:
    /argand|complex.*plane|modulus.*argument|real.*imaginary|z = a.*bi|polar form|euler.*formula|complex number.*graph/i,
  commands: [
    { type: "DRAW_LINE", params: [470, 300, 830, 300] },
    { type: "DRAW_LINE", params: [650, 130, 650, 470] },
  ],
  introPhases: [
    {
      narration:
        "the horizontal axis is the real axis, and the vertical axis is the imaginary axis. together they form the Argand plane.",
      commandIndices: [0, 1],
    },
  ],
  anchors: [
    { id: "Re", labels: ["Re", "real", "real axis"], x: 820, y: 315, width: 36, height: 38 },
    { id: "Im", labels: ["Im", "imaginary", "imaginary axis"], x: 660, y: 140, width: 40, height: 38 },
    { id: "z", labels: ["z", "complex number"], x: 730, y: 220, width: 36, height: 38 },
    { id: "O", labels: ["O", "origin"], x: 635, y: 290, width: 36, height: 38 },
    { id: "theta", labels: ["θ", "theta", "argument"], x: 590, y: 320, width: 34, height: 34 },
    { id: "r", labels: ["r", "modulus", "|z|"], x: 690, y: 260, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "complex_argand": the right side has the real and imaginary axes as geometry only. do not mention this note to the student.
label the axes Re and Im. plot the complex number z as a [LABEL] at its position. draw the modulus vector from O to z using [DRAW_LINE]. label the argument θ and modulus r. write z = r(cos θ + i sin θ) = re^(iθ) on the left with y rows 145,205,265,325,385,445,505,565,625 only.`,
};
