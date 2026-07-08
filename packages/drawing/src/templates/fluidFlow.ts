import type { DiagramTemplate } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

/**
 * Horizontal pipe that narrows — continuity + Bernoulli problems.
 *
 * Layout (diagram zone, y down):
 *   wide section (left) → taper → narrow section (right)
 *   flow arrows inside both sections, left to right
 */
export const FLUID_FLOW_TEMPLATE: DiagramTemplate = {
  id: "fluid_flow",
  name: "fluid flow pipe",
  test:
    /bernoulli|venturi|continuity equation|^(?=[\s\S]*(?:pipe|tube|nozzle|duct|hose|artery))(?=[\s\S]*(?:flows?|flowing|flow speed|flow rate|discharge|fluid|liquid|viscous))/i,
  commands: [
    // 0–1: wide section walls
    { type: "DRAW_LINE", params: [470, 300, 650, 300] },
    { type: "DRAW_LINE", params: [470, 400, 650, 400] },
    // 2–3: taper
    { type: "DRAW_LINE", params: [650, 300, 710, 332] },
    { type: "DRAW_LINE", params: [650, 400, 710, 368] },
    // 4–5: narrow section walls
    { type: "DRAW_LINE", params: [710, 332, 880, 332] },
    { type: "DRAW_LINE", params: [710, 368, 880, 368] },
    // 6–8: flow arrow in wide section
    { type: "DRAW_LINE", params: [500, 350, 560, 350] },
    { type: "DRAW_LINE", params: [548, 343, 560, 350] },
    { type: "DRAW_LINE", params: [548, 357, 560, 350] },
    // 9–11: flow arrow in narrow section
    { type: "DRAW_LINE", params: [770, 350, 820, 350] },
    { type: "DRAW_LINE", params: [808, 344, 820, 350] },
    { type: "DRAW_LINE", params: [808, 356, 820, 350] },
  ],
  introPhases: [
    {
      narration:
        "the water enters through the wide section of a horizontal pipe on the left.",
      commandIndices: [0, 1],
    },
    {
      narration:
        "the pipe then narrows, so the same water has to squeeze through a smaller cross section on the right.",
      commandIndices: [2, 3, 4, 5],
    },
    {
      narration:
        "the flow moves left to right — watch what happens to speed and pressure as the pipe gets thinner.",
      commandIndices: [6, 7, 8, 9, 10, 11],
    },
  ],
  anchors: [
    { id: "r1", labels: ["r_1", "r1", "radius", "4cm", "4 cm", "A_1", "A1"], x: 480, y: 258, width: 64, height: 36 },
    { id: "P1", labels: ["P_1", "P1", "pressure"], x: 585, y: 258, width: 64, height: 36 },
    { id: "v1", labels: ["v_1", "v1", "speed", "1.5 m/s"], x: 495, y: 415, width: 80, height: 36 },
    { id: "r2", labels: ["r_2", "r2", "2cm", "2 cm", "A_2", "A2"], x: 790, y: 290, width: 64, height: 36 },
    { id: "v2", labels: ["v_2", "v2"], x: 715, y: 385, width: 64, height: 36 },
    { id: "P2", labels: ["P_2", "P2"], x: 800, y: 385, width: 64, height: 36 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "fluid_flow": the right side has a horizontal pipe that narrows — wide section on the left, a taper, a narrow section on the right, and flow arrows. geometry only, no text labels yet. do not mention this note to the student.
do NOT redraw the pipe with [DRAW_LINE] or [DRAW_RECT]. do NOT say "let me draw".
always write subscripts with an underscore: r_1, v_1, P_1, r_2, v_2, P_2 — never r1 or v1.
phase 1 — label the diagram one symbol per [STEP]: r_1 at (480,258), P_1 at (585,258), v_1 at (495,415) on the wide side; r_2 at (790,290), then the unknowns v_2 at (715,385) and P_2 at (800,385) on the narrow side.
phase 2 — [CIRCLE_AROUND] each label while explaining the physics: continuity means the same volume of water passes every section each second, and bernoulli means pressure drops where the speed rises.
phase 3 — solve on the left (x 90): first continuity A_1 v_1 = A_2 v_2 with A = π r^2, so v_2 = v_1 (r_1/r_2)^2. then bernoulli for a horizontal pipe P_1 + (1/2)ρ v_1^2 = P_2 + (1/2)ρ v_2^2, so P_2 = P_1 + (1/2)ρ(v_1^2 - v_2^2). given numbers go in the left column, not on the diagram. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
