import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

export const OPTICS_RAY_TEMPLATE: DiagramTemplate = {
  id: "optics_ray",
  name: "ray optics — lens/mirror",
  test:
    /lens|mirror|concave|convex|focal length|principal axis|ray diagram|magnification|object distance|image distance|u =.*v =|f =.*lens|lens.*f =/i,
  commands: [
    { type: "DRAW_LINE", params: [460, 300, 900, 300] },
    { type: "DRAW_LINE", params: [690, 175, 610, 300, 690, 425, 2] },
  ],
  introPhases: [
    {
      narration:
        "the principal axis is the horizontal reference line through the pole of the mirror or lens.",
      commandIndices: [0],
    },
    {
      narration:
        "the concave mirror surface curves toward the incident light — rays reflect from this arc.",
      commandIndices: [1],
    },
  ],
  anchors: [
    { id: "C", labels: ["C", "center of curvature", "2F", "2f"], x: 472, y: 282, width: 36, height: 36 },
    { id: "F", labels: ["F", "focal", "focus"], x: 532, y: 282, width: 36, height: 36 },
    { id: "O", labels: ["O", "pole", "optical center", "center"], x: 592, y: 282, width: 36, height: 36 },
    { id: "F2", labels: ["F'", "F prime", "right focal"], x: 652, y: 282, width: 36, height: 36 },
    { id: "object", labels: ["object", "AB", "A", "B"], x: 508, y: 228, width: 44, height: 88 },
    { id: "image", labels: ["image", "A'B'", "A prime", "B prime"], x: 508, y: 310, width: 44, height: 88 },
    { id: "u", labels: ["u", "object distance"], x: 528, y: 332, width: 88, height: 32 },
    { id: "v", labels: ["v", "image distance"], x: 688, y: 332, width: 88, height: 32 },
    { id: "f", labels: ["f", "focal length"], x: 552, y: 312, width: 56, height: 28 },
    { id: "ho", labels: ["h", "h_o", "object height"], x: 458, y: 218, width: 36, height: 62 },
    { id: "hi", labels: ["h'", "h_i", "image height"], x: 738, y: 218, width: 36, height: 62 },
  ],
  allowLlmDrawInDiagramZone: true,
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "optics_ray": the right side has the principal axis and concave mirror arc as geometry only. the runtime intro already ticks and labels C, F, O and the object/image, and marks u/f/v as thin dotted bars below the axis. do not mention this note to the student.
do NOT redraw the axis, mirror arc, C, F, O, the object/image arrows, or any visible distance bar — they are already on the board and already labelled.
phase 1 — complete the ray diagram before any algebra:
1) never re-emit a [LABEL] or [DIMENSION] for something already visible; instead point at the existing mark with [CIRCLE_AROUND] or [UNDERLINE].
2) draw each principal ray in its own [STEP] — the pole O sits at (610,300) where the axis meets the mirror arc. parallel ray reflects through the marked F, chief ray goes straight through O, and the focal ray passes through F. ray endpoints touch the mirror arc near (610,300) or another sampled curve point; the runtime snaps them onto the axis/arc.
3) if the image is not already visible, mark where the rays cross; mark object/image heights h and h' with vertical [DIMENSION:...] when relevant (thin dotted bars, never boxes).
phase 2 — explain each existing label with [CIRCLE_AROUND] on the label text. phase 3 — lens/mirror formula on the left with y rows 145,205,265,325,385,445,505,565,625 only.`),
};
