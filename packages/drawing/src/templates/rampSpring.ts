import type { DiagramTemplate } from "./types";

/**
 * Ramp + block + spring + wall — energy conservation / spring compression.
 *
 * Layout (diagram zone, y down):
 *   block on ramp (upper-left)
 *   ramp diagonal to ground
 *   vertical height line h on the left
 *   horizontal track → spring coil → wall
 */
export const RAMP_SPRING_TEMPLATE: DiagramTemplate = {
  id: "ramp_spring",
  name: "ramp and spring",
  test:
    /spring|compress(?:ed|ion)?|potential energy|energy conserv|mgh|1\/2\s*kx|work and energy/i,
  commands: [
    // 0–1: ground + ramp
    { type: "DRAW_LINE", params: [460, 450, 920, 450] },
    { type: "DRAW_LINE", params: [460, 450, 620, 240] },
    // 2–4: height dimension line + ticks
    { type: "DRAW_LINE", params: [432, 240, 432, 450] },
    { type: "DRAW_LINE", params: [422, 240, 442, 240] },
    { type: "DRAW_LINE", params: [422, 450, 442, 450] },
    // 5: block on ramp (~60% up from bottom)
    { type: "DRAW_RECT", params: [536, 304, 40, 40] },
    // 6–13: spring coil on horizontal track
    { type: "DRAW_LINE", params: [665, 450, 683, 430] },
    { type: "DRAW_LINE", params: [683, 430, 701, 450] },
    { type: "DRAW_LINE", params: [701, 450, 719, 430] },
    { type: "DRAW_LINE", params: [719, 430, 737, 450] },
    { type: "DRAW_LINE", params: [737, 450, 755, 430] },
    { type: "DRAW_LINE", params: [755, 430, 773, 450] },
    { type: "DRAW_LINE", params: [773, 450, 791, 430] },
    { type: "DRAW_LINE", params: [791, 430, 809, 450] },
    // 14: wall
    { type: "DRAW_LINE", params: [850, 410, 850, 490] },
  ],
  introPhases: [
    {
      narration:
        "at the bottom we have a flat surface, and a frictionless ramp the block will slide down.",
      commandIndices: [0, 1],
    },
    {
      narration:
        "the block starts up here on the ramp. the vertical height h is measured from the bottom to the top of the ramp.",
      commandIndices: [2, 3, 4, 5],
    },
    {
      narration:
        "when the block reaches the bottom it hits a spring attached to a wall. the spring compresses by distance x.",
      commandIndices: [6, 7, 8, 9, 10, 11, 12, 13, 14],
    },
  ],
  anchors: [
    { id: "h", labels: ["h", "height", "5m", "5 m"], x: 392, y: 328, width: 36, height: 38 },
    { id: "m", labels: ["m", "mass", "2kg", "2 kg"], x: 528, y: 288, width: 52, height: 38 },
    { id: "k", labels: ["k", "spring", "200"], x: 778, y: 398, width: 56, height: 38 },
    { id: "x", labels: ["x", "compression", "?"], x: 728, y: 468, width: 48, height: 38 },
  ],
  promptAddon: `internal diagram note "ramp_spring": the right side has the ramp, block, height line, spring, and wall as geometry only, with no text labels yet. do not mention this note to the student.
do NOT use [DRAW_LINE] or [DRAW_RECT] in the diagram area. do NOT redraw the spring coil or wall. do NOT say "let me draw".
phase 1 — label the diagram with clean symbols only (one label per [STEP], say the symbol then [LABEL]):
  h at (392,328), m on the block at (528,288), k near the spring at (778,398), x below the spring at (728,468).
phase 2 — [CIRCLE_AROUND] each label while explaining what it means.
phase 3 — write energy equations on the left (x 90–400): m g h = (1/2) k x^2, then substitute and solve. given numbers (2 kg, 5 m, 200 N/m) go in the left column, not on the diagram. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
