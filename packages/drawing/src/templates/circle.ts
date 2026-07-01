import type { DiagramTemplate } from "./types";

export const CIRCLE_TEMPLATE: DiagramTemplate = {
  id: "circle",
  name: "circle geometry",
  test: /equation of (a )?circle|circle derivation|radius.*center|circumference|chord.*circle/i,
  commands: [
    { type: "DRAW_CIRCLE", params: [620, 280, 140] },
    { type: "LABEL", params: [600, 250], text: "(h,k)", anchorId: "center" },
    { type: "DRAW_LINE", params: [620, 280, 760, 280] },
    { type: "LABEL", params: [685, 268], text: "r", anchorId: "r" },
    { type: "LABEL", params: [760, 250], text: "(x,y)", anchorId: "point" },
  ],
  anchors: [
    { id: "center", labels: ["(h,k)", "h,k", "center"], x: 590, y: 242, width: 56, height: 38 },
    { id: "r", labels: ["r", "radius"], x: 675, y: 260, width: 36, height: 38 },
    { id: "point", labels: ["(x,y)", "x,y"], x: 750, y: 242, width: 56, height: 38 },
  ],
  promptAddon: `runtime template "circle": circle and radius line are ALREADY on the board (geometry only — no labels yet).
label center (h,k), radius r, and point (x,y) in separate [STEP]s as you explain each — say the name, then [LABEL]. do NOT redraw the circle. derive (x-h)^2+(y-k)^2=r^2 on the left.`,
};
