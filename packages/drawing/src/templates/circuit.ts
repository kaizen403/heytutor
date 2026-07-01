import type { DiagramTemplate } from "./types";

export const CIRCUIT_TEMPLATE: DiagramTemplate = {
  id: "circuit",
  name: "simple DC circuit",
  test: /circuit|resistor.*series|ohm|kirchhoff|wheatstone|galvanic|cells? in series|ammeter|voltmeter/i,
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
  anchors: [
    { id: "emf", labels: ["ε", "emf", "E"], x: 575, y: 225, width: 36, height: 38 },
    { id: "R", labels: ["R", "resistance"], x: 705, y: 225, width: 36, height: 38 },
    { id: "I", labels: ["I", "current"], x: 520, y: 275, width: 36, height: 38 },
  ],
  promptAddon: `runtime template "circuit": wire loop and component boxes are ALREADY on the board (geometry only — no labels yet).
label ε, R, and I in separate [STEP]s as you introduce each — say the symbol, then [LABEL]. do NOT redraw wires. apply V=IR or Kirchhoff rules on the left.`,
};
