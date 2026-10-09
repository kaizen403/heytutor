import type { SceneDocument } from "../types";

/** Pack whole kit documents by geometry, not by subject or question. Only
 * translations are used, so checked topology and angles remain unchanged. */
export function arrangeChemistryKitDocuments(documents: readonly SceneDocument[]): void {
  if (documents.length < 2) return;
  if (documents.some((document) => document.constructions.some((item) => item.operator === "function_curve"))) {
    throw new Error("an energy profile must be the only chemistry kit in its document");
  }
  const boxes = documents.map((document) => {
    const points = document.constructions.filter((item) => item.operator === "point");
    const xs = points.flatMap((item) => typeof item.inputs.x === "number" ? [item.inputs.x] : []);
    const ys = points.flatMap((item) => typeof item.inputs.y === "number" ? [item.inputs.y] : []);
    for (const item of document.constructions) {
      if (item.operator !== "rectangle") continue;
      const centre = points.find((point) => point.outputs.includes(String(item.inputs.center)));
      if (typeof centre?.inputs.x === "number" && typeof item.inputs.width === "number") xs.push(centre.inputs.x - item.inputs.width / 2, centre.inputs.x + item.inputs.width / 2);
      if (typeof centre?.inputs.y === "number" && typeof item.inputs.height === "number") ys.push(centre.inputs.y - item.inputs.height / 2, centre.inputs.y + item.inputs.height / 2);
    }
    return { points, left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
  });
  const gap = 1.5;
  const widths = boxes.map((box) => box.right - box.left);
  const heights = boxes.map((box) => box.top - box.bottom);
  const rowFit = Math.min(612 / (widths.reduce((a, b) => a + b, 0) + gap * (boxes.length - 1)), 427 / Math.max(...heights));
  const columnFit = Math.min(612 / Math.max(...widths), 427 / (heights.reduce((a, b) => a + b, 0) + gap * (boxes.length - 1)));
  const horizontal = rowFit >= columnFit;
  let cursor = 0;
  for (const box of boxes) {
    const dx = horizontal ? cursor - box.left : -(box.left + box.right) / 2;
    const dy = horizontal ? -(box.top + box.bottom) / 2 : cursor - box.top;
    for (const point of box.points) {
      if (typeof point.inputs.x === "number") point.inputs.x += dx;
      if (typeof point.inputs.y === "number") point.inputs.y += dy;
    }
    cursor += horizontal ? box.right - box.left + gap : -(box.top - box.bottom + gap);
  }
}
