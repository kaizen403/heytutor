import type { DiagramTemplate } from "./types";

/**
 * Horizontal block-spring setup for frictionless SHM / max compression questions.
 *
 * Layout (diagram zone, y down):
 *   horizontal track
 *   block on track at natural length
 *   spring coil attached to wall
 *   velocity arrow toward the spring
 */
export const HORIZONTAL_SPRING_TEMPLATE: DiagramTemplate = {
  id: "horizontal_spring",
  name: "horizontal spring",
  test:
    /^(?=[\s\S]*\bspring\b)(?=[\s\S]*(?:horizontal|frictionless|natural length|speed|velocity|maximum compression|simple harmonic|SHM))(?![\s\S]*(?:ramp|incline|inclined|hill|slope|height|mgh|slides? down))/i,
  commands: [
    // 0: horizontal track
    { type: "DRAW_LINE", params: [500, 430, 900, 430] },
    // 1: wall
    { type: "DRAW_LINE", params: [860, 350, 860, 490] },
    // 2: block at natural length
    { type: "DRAW_RECT", params: [560, 360, 90, 70] },
    // 3-10: spring coil between block and wall
    { type: "DRAW_LINE", params: [650, 395, 672, 370] },
    { type: "DRAW_LINE", params: [672, 370, 694, 420] },
    { type: "DRAW_LINE", params: [694, 420, 716, 370] },
    { type: "DRAW_LINE", params: [716, 370, 738, 420] },
    { type: "DRAW_LINE", params: [738, 420, 760, 370] },
    { type: "DRAW_LINE", params: [760, 370, 782, 420] },
    { type: "DRAW_LINE", params: [782, 420, 804, 395] },
    { type: "DRAW_LINE", params: [804, 395, 860, 395] },
    // 11: initial velocity arrow toward compression
    { type: "DRAW_LINE", params: [515, 335, 610, 335] },
  ],
  introPhases: [
    {
      narration:
        "the setup is horizontal: a block moves on a frictionless track toward a spring attached to a wall.",
      commandIndices: [0, 1, 2],
    },
    {
      narration:
        "the spring starts at natural length, so the block's kinetic energy will become spring potential energy as it compresses.",
      commandIndices: [3, 4, 5, 6, 7, 8, 9, 10],
    },
    {
      narration:
        "the initial velocity points toward the spring, so the compression x grows to the right.",
      commandIndices: [11],
    },
  ],
  anchors: [
    { id: "m", labels: ["m", "mass", "0.5kg", "0.5 kg"], x: 575, y: 365, width: 70, height: 44 },
    { id: "k", labels: ["k", "spring", "200"], x: 720, y: 350, width: 68, height: 38 },
    { id: "v", labels: ["v", "velocity", "3m/s", "3 m/s"], x: 520, y: 305, width: 94, height: 36 },
    { id: "x", labels: ["x", "compression", "maximum compression"], x: 700, y: 445, width: 88, height: 36 },
  ],
  promptAddon: `internal diagram note "horizontal_spring": the right side has a horizontal track, block, spring, wall, and initial velocity arrow. do not mention this note to the student.
do NOT draw a ramp, height line, or gravity-energy diagram for this setup. this is a horizontal spring problem: the energy transfer is kinetic energy to elastic potential energy.
phase 1 — label the visible diagram with clean symbols only, one label per step: m on the block near (575,365), k near the spring at (720,350), v near the velocity arrow at (520,305), and x below the spring near (700,445).
phase 2 — explain the energy idea by annotating those labels: kinetic energy starts in v and elastic potential energy ends in x.
phase 3 — solve on the left: (1/2)mv^2 = (1/2)kx^2, then x = v√(m/k). for time from natural length to maximum compression, use quarter period: t = π/(2ω), with ω = √(k/m). keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
