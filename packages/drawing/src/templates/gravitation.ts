import type { DiagramTemplate } from "./types";

export const GRAVITATION_TEMPLATE: DiagramTemplate = {
  id: "gravitation",
  name: "gravitation — orbits and Kepler",
  test:
    /gravitation|orbit|kepler|satellite|escape velocity|geostationary|gravitational field|planet.*mass|GMm|orbital.*velocity|gravitational.*potential/i,
  commands: [
    { type: "DRAW_CIRCLE", params: [650, 300, 30] },
    { type: "DRAW_CIRCLE", params: [650, 300, 150, 110] },
  ],
  introPhases: [
    {
      narration:
        "the central body is the massive object, like a sun or planet. the ellipse shows the orbit path.",
      commandIndices: [0, 1],
    },
  ],
  anchors: [
    { id: "M", labels: ["M", "central mass", "sun"], x: 635, y: 270, width: 36, height: 38 },
    { id: "m", labels: ["m", "orbiting mass", "planet", "satellite"], x: 790, y: 280, width: 36, height: 38 },
    { id: "r", labels: ["r", "radius", "orbital radius"], x: 720, y: 330, width: 36, height: 38 },
    { id: "F", labels: ["F", "force", "gravitational force"], x: 720, y: 370, width: 36, height: 38 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: `internal diagram note "gravitation": the right side has the central body and the orbital ellipse as geometry only. do not mention this note to the student.
label the central mass M, orbiting mass m, radius r, and force F. for Kepler's 2nd law, shade the swept area with [HIGHLIGHT]. write F = GMm/r^2, orbital velocity v = sqrt(GM/r), and escape velocity v_e = sqrt(2GM/r) on the left with y rows 145,205,265,325,385,445,505,565,625 only.`,
};
