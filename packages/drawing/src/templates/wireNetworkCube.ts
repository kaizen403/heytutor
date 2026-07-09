import type { DiagramTemplate, TemplateCommand } from "./types";
import { withDiagramMarkingGuidance } from "./annotationGuidance";

// Cube in oblique projection (front square + back square offset up-right).
// Canvas is 1200×700; diagram zone x 400–900. The cube is centered there.
const FRONT_BL: [number, number] = [520, 470];
const FRONT_BR: [number, number] = [680, 470];
const FRONT_TR: [number, number] = [680, 310];
const FRONT_TL: [number, number] = [520, 310];

const DX = 72;
const DY = -72;

const BACK_BL: [number, number] = [FRONT_BL[0] + DX, FRONT_BL[1] + DY];
const BACK_BR: [number, number] = [FRONT_BR[0] + DX, FRONT_BR[1] + DY];
const BACK_TR: [number, number] = [FRONT_TR[0] + DX, FRONT_TR[1] + DY];
const BACK_TL: [number, number] = [FRONT_TL[0] + DX, FRONT_TL[1] + DY];

// Body-diagonal terminals: A (front-bottom-left) to G (back-top-right).
const TERM_A: [number, number] = [FRONT_BL[0] - 34, FRONT_BL[1] + 22];
const TERM_G: [number, number] = [BACK_TR[0] + 6, BACK_TR[1] - 22];

/**
 * Build a zigzag resistor symbol along an arbitrary edge from (x1,y1) to
 * (x2,y2). The zigzag occupies the middle 60% of the edge; plain wire fills
 * the remaining 20% on each end so the symbol connects cleanly to the vertices.
 *
 * The result is a DRAW_LINE params array (polyline) that the whiteboard
 * renders as a single animated stroke — the same convention used by the
 * circuit template's resistorZigzag.
 */
function resistorZigzagAlong(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  amplitude = 5,
  peaks = 4,
): number[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 40) {
    // Edge too short for a meaningful zigzag — just draw a plain line.
    return [x1, y1, x2, y2];
  }

  const ux = dx / len; // unit direction along edge
  const uy = dy / len;
  const px = -uy; // perpendicular
  const py = ux;

  // Reserve 20% on each end for plain wire; zigzag spans the middle 60%.
  const wireFrac = 0.2;
  const zigStartFrac = wireFrac;
  const zigEndFrac = 1 - wireFrac;

  const sx = x1 + ux * len * zigStartFrac;
  const sy = y1 + uy * len * zigStartFrac;
  const ex = x1 + ux * len * zigEndFrac;
  const ey = y1 + uy * len * zigEndFrac;
  const zigLen = len * (zigEndFrac - zigStartFrac);

  const pts: number[] = [x1, y1, Math.round(sx), Math.round(sy)];
  for (let i = 1; i <= peaks; i++) {
    const t = i / (peaks + 1);
    const cx = sx + ux * zigLen * t;
    const cy = sy + uy * zigLen * t;
    const sign = i % 2 === 1 ? 1 : -1;
    pts.push(Math.round(cx + px * amplitude * sign), Math.round(cy + py * amplitude * sign));
  }
  pts.push(Math.round(ex), Math.round(ey), x2, y2);
  return pts;
}

/** Convenience: edge endpoints → TemplateCommand with zigzag resistor. */
function resistorEdge(
  a: [number, number],
  b: [number, number],
): TemplateCommand {
  return { type: "DRAW_LINE", params: resistorZigzagAlong(a[0], a[1], b[0], b[1]) };
}

const R_AB = resistorEdge(FRONT_BL, FRONT_BR);
const R_BC = resistorEdge(FRONT_BR, FRONT_TR);
const R_CD = resistorEdge(FRONT_TR, FRONT_TL);
const R_DA = resistorEdge(FRONT_TL, FRONT_BL);
const R_EF = resistorEdge(BACK_BL, BACK_BR);
const R_FG = resistorEdge(BACK_BR, BACK_TR);
const R_GH = resistorEdge(BACK_TR, BACK_TL);
const R_HE = resistorEdge(BACK_TL, BACK_BL);
const R_AE = resistorEdge(FRONT_BL, BACK_BL);
const R_BF = resistorEdge(FRONT_BR, BACK_BR);
const R_CG = resistorEdge(FRONT_TR, BACK_TR);
const R_DH = resistorEdge(FRONT_TL, BACK_TL);

function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
}

const MID_AB = midpoint(FRONT_BL, FRONT_BR);

/**
 * Twelve identical wires (each a 1 Ω resistor) forming the edges of a cube —
 * the classic "equivalent resistance of a cube network" problem. Draws a
 * proper 3D oblique-projection cube with a zigzag resistor symbol on every
 * edge and all 8 vertices labeled, so the student sees the actual geometry
 * and circuit elements, never a misleading flat circuit box.
 */
export const WIRE_NETWORK_CUBE_TEMPLATE: DiagramTemplate = {
  id: "wire_network_cube",
  name: "wire network forming a cube",
  // Must mention "cube" AND a wire/resistance/network keyword so ordinary
  // circuit problems (which also say "resistance" and "Ω") never match here.
  test:
    /(?=[\s\S]*\bcube\b)(?=[\s\S]*\b(?:wire|edge|resist|skeleton|network|junction)\b)/i,
  commands: [
    // Front face (4 resistor edges)
    R_AB, // 0: A-B
    R_BC, // 1: B-C
    R_CD, // 2: C-D
    R_DA, // 3: D-A
    // Back face (4 resistor edges)
    R_EF, // 4: E-F
    R_FG, // 5: F-G
    R_GH, // 6: G-H
    R_HE, // 7: H-E
    // Connecting edges (4 resistor edges)
    R_AE, // 8: A-E
    R_BF, // 9: B-F
    R_CG, // 10: C-G
    R_DH, // 11: D-H
    // Body-diagonal terminal marks (plain lines, not resistors)
    { type: "DRAW_LINE", params: [...TERM_A, ...FRONT_BL] }, // 12
    { type: "DRAW_LINE", params: [...BACK_TR, ...TERM_G] }, // 13
    // Vertex labels (A-H)
    { type: "LABEL", params: [FRONT_BL[0] - 28, FRONT_BL[1] + 16], text: "A" }, // 14
    { type: "LABEL", params: [FRONT_BR[0] + 8, FRONT_BR[1] + 16], text: "B" }, // 15
    { type: "LABEL", params: [FRONT_TR[0] + 8, FRONT_TR[1] - 4], text: "C" }, // 16
    { type: "LABEL", params: [FRONT_TL[0] - 28, FRONT_TL[1] - 4], text: "D" }, // 17
    { type: "LABEL", params: [BACK_BL[0] - 12, BACK_BL[1] + 16], text: "E" }, // 18
    { type: "LABEL", params: [BACK_BR[0] + 8, BACK_BR[1] + 16], text: "F" }, // 19
    { type: "LABEL", params: [BACK_TR[0] + 8, BACK_TR[1] - 4], text: "G" }, // 20
    { type: "LABEL", params: [BACK_TL[0] - 12, BACK_TL[1] - 4], text: "H" }, // 21
    // "R = 1Ω" label on one representative edge
    { type: "LABEL", params: [MID_AB[0] - 12, MID_AB[1] + 16], text: "R" }, // 22
  ],
  introPhases: [
    {
      narration:
        "here is the front face of the cube — four edges forming a square, with vertices A B C D.",
      commandIndices: [0, 1, 2, 3],
    },
    {
      narration:
        "and here is the back face — E F G H, offset up and to the right in oblique projection.",
      commandIndices: [4, 5, 6, 7],
    },
    {
      narration:
        "now the four connecting edges join the front and back faces — A to E, B to F, C to G, D to H.",
      commandIndices: [8, 9, 10, 11],
    },
    {
      narration:
        "every edge is a one ohm resistor — you can see the zigzag symbol on each of the twelve edges.",
      commandIndices: [22],
    },
    {
      narration:
        "the terminals are at A on the front-bottom-left and G on the back-top-right — that body diagonal, A to G, is the first case.",
      commandIndices: [12, 13],
    },
    {
      narration:
        "let me label all eight vertices: A B C D on the front face, E F G H on the back face, so we can trace current paths by symmetry.",
      commandIndices: [14, 15, 16, 17, 18, 19, 20, 21],
    },
  ],
  anchors: [
    { id: "A", labels: ["A"], x: FRONT_BL[0] - 28, y: FRONT_BL[1] + 16, width: 24, height: 24 },
    { id: "B", labels: ["B"], x: FRONT_BR[0] + 8, y: FRONT_BR[1] + 16, width: 24, height: 24 },
    { id: "C", labels: ["C"], x: FRONT_TR[0] + 8, y: FRONT_TR[1] - 4, width: 24, height: 24 },
    { id: "D", labels: ["D"], x: FRONT_TL[0] - 28, y: FRONT_TL[1] - 4, width: 24, height: 24 },
    { id: "E", labels: ["E"], x: BACK_BL[0] - 12, y: BACK_BL[1] + 16, width: 24, height: 24 },
    { id: "F", labels: ["F"], x: BACK_BR[0] + 8, y: BACK_BR[1] + 16, width: 24, height: 24 },
    { id: "G", labels: ["G"], x: BACK_TR[0] + 8, y: BACK_TR[1] - 4, width: 24, height: 24 },
    { id: "H", labels: ["H"], x: BACK_TL[0] - 12, y: BACK_TL[1] - 4, width: 24, height: 24 },
  ],
  promptAddon: withDiagramMarkingGuidance(`internal diagram note "wire_network_cube": the board already shows a 3D cube skeleton in oblique projection. every one of the 12 edges has a zigzag resistor symbol on it (each is R = 1 Ω). all 8 vertices are already labeled: A B C D on the front face (A bottom-left, B bottom-right, C top-right, D top-left) and E F G H on the back face (E behind A, F behind B, G behind C, H behind D). terminals are at A and G for the body-diagonal case.
do NOT use [DRAW_LINE], [DRAW_CIRCLE], [DRAW_RECT], or any structural draw command in the diagram zone. do NOT redraw the cube, add edges, or draw more resistors. do NOT say "let me draw" — the cube with resistors and labels is already there.
CRITICAL: always use the vertex labels A B C D E F G H that are on the board. NEVER use binary coordinates like 000, 001, 011 or any other coordinate system — the student sees letters on the board, not numbers. say "vertex A", "vertex G", "the edge from A to B", not "000 to 001".
the student asked for equivalent resistance across (a) body diagonal A-G, (b) face diagonal (e.g. A to C), (c) one edge (e.g. A to B). solve by symmetry and equipotential reduction, not by brute-force Kirchhoff on all 12 edges.
body diagonal A-G: the three vertices adjacent to A (B, D, E) are equipotential, and the three adjacent to G (C, F, H) are equipotential. current splits equally at A into 3 branches (each R), recombines through 6 edges (each R/2 effectively), then converges into 3 at G (each R). R_eq = R/3 + R/6 + R/3 = 5R/6.
face diagonal A-C: by symmetry B and D are equipotential... F and H are equipotential. R_eq = 3R/4.
edge A-B: R_eq = 7R/12.
with R = 1 Ω: body diagonal = 5/6 Ω, face diagonal = 3/4 Ω, edge = 7/12 Ω.
keep [WRITE] rows at y 145,205,265,325,385,445,505,565,625 only.`),
};
