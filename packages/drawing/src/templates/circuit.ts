import type { DiagramTemplate } from "./types";

export const CIRCUIT_TEMPLATE: DiagramTemplate = {
  id: "circuit",
  name: "simple DC circuit",
  test: /circuit|resistors?|kirchhoff|wheatstone|meter bridge|cells? in series|ammeter|voltmeter|equivalent resistance|\d+\s*(?:\u03a9|ohms?)/i,
  commands: [
    { type: "DRAW_RECT", params: [560, 220, 80, 50] },
    { type: "LABEL", params: [585, 235], text: "ε", anchorId: "emf" },
    { type: "DRAW_RECT", params: [700, 220, 60, 50] },
    { type: "LABEL", params: [715, 235], text: "R", anchorId: "R" },
    { type: "DRAW_LINE", params: [520, 245, 560, 245] },
    { type: "DRAW_LINE", params: [640, 245, 700, 245] },
    { type: "DRAW_LINE", params: [760, 245, 820, 245] },
    { type: "DRAW_LINE", params: [820, 245, 820, 340] },
    { type: "DRAW_LINE", params: [820, 340, 520, 340] },
    { type: "DRAW_LINE", params: [520, 340, 520, 245] },
    { type: "LABEL", params: [530, 285], text: "I", anchorId: "I" },
  ],
  introPhases: [
    {
      narration:
        "the circuit loop is a closed path, so charge can keep moving around the wires.",
      commandIndices: [4, 5, 6, 7, 8, 9],
    },
    {
      narration:
        "the source supplies energy to the charges, and the resistor is where that energy is used.",
      commandIndices: [0, 2],
    },
  ],
  anchors: [
    { id: "emf", labels: ["ε", "emf", "E"], x: 745, y: 225, width: 36, height: 38 },
    { id: "R", labels: ["R", "resistance"], x: 875, y: 225, width: 36, height: 38 },
    { id: "I", labels: ["I", "current"], x: 690, y: 275, width: 36, height: 38 },
  ],
  promptAddon: `internal diagram note "circuit": the right side has the actual circuit topology already drawn with accurate wire connections, resistor zigzags, the battery, the current arrow, and every value label (with a proper Ω sign). do not mention this note to the student.
do NOT redraw or add ANY diagram geometry — no wires, batteries, cells, resistor symbols, capacitors, branches, boxes, current-source or ammeter circles, and no extra current-flow arrows. the current direction arrow is already on the board. the circuit diagram is authoritative and complete.
your only diagram actions are to point at things that already exist: [CIRCLE_AROUND] or [UNDERLINE] on a visible label (e.g. the R1=2Ω text or the I arrow). everything else — R_total, currents, voltage drops, and all algebra — goes on the LEFT with [WRITE].
for series circuits: explain one path, same current through every resistor, R_total = R1 + R2 + ...; then voltage drops V_i = I R_i and check that drops add to the source voltage.
for parallel circuits: explain shared top/bottom junctions, same voltage across each branch, currents split and add; use 1/R_eq = 1/R1 + 1/R2 + ...
for combination (series + parallel) circuits: first reduce the parallel block (1/R_p = 1/R2 + 1/R3), then add the series resistor (R_eq = R1 + R_p); find the main current from the source, then the branch currents from the shared branch voltage.
for RC circuits: explain the battery, resistor, capacitor plates, current direction, and time constant τ = RC before equations.
for bridge/kirchhoff circuits: mark junctions and loops with annotations, then write KCL/KVL on the left. keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`,
};
