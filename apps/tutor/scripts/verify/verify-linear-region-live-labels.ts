import assert from "node:assert/strict";
import { measureTextInkBounds, snapToBoardTypeScale } from "@heytutor/drawing";
import { buildLinearSourceDocument, compileSceneDocument, type LabelBounds } from "@heytutor/scene-engine";
import { renderSceneSvg } from "../../../../packages/scene-engine/scripts/lib/renderSceneSvg";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

let labels = 0;
for (const question of [
  "Show -2<=x<3 or x>=7 on a number line.",
  "Graph -2x+5y<=-10. Mark P=(0,-3) and Q=(0,0).",
  "Solve -4x+y=-9 and 8x-2y=18 graphically.",
  "Maximize Z=3x+4y under x>=0, y>=0, x+y<=7 and 2x+y<=10.",
  "Maximize Z=x+y under x>=0,y>=0,x+y<4.",
  "A continuous production model uses real quantities x and y. Its constraints are x >= 1/2, y >= 0, x + 2y <= 7, and 3x + y <= 8. Draw and shade the common feasible region, label every exact corner, and maximise profit F = 4x + 5y. Put F at each corner and mark every maximiser. Mark A = (1,1), B = (0,1), C = (9/5,13/5), and state feasibility. Fractional production is permitted.",
  "In R^2, graph the simultaneous system L1: -2(2x - y) = -6 and L2: 6x - 3y = 12. Label both lines with their names and simplified equations, and label their intercepts. Use the graph to classify the system and state its full solution set.",
]) {
  const document = buildLinearSourceDocument(question);
  assert.ok(document);
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  const { diagram } = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  for (const label of compiled.renderScene.primitives.filter(p => p.kind === "label" && p.provenance?.linearSolution)) {
    const command = diagram.commands.find(c => c.type === "LABEL" && c.semanticRef?.primitiveId === label.id);
    assert.ok(command, `Missing live label ${label.id}`);
    const bounds = label.provenance!.labelBounds as LabelBounds;
    const collision = label.provenance!.labelCollisionBounds as LabelBounds;
    const [x, y, requestedFont] = command.params;
    const liveFont = snapToBoardTypeScale(requestedFont!);
    assert.equal(liveFont, label.provenance!.fontPx, "Compiler must prove the font size the live pen actually draws");
    assert.equal(x, bounds.x + 2, "Live ink must start at the compiler-checked horizontal inset");
    assert.equal(y, bounds.y + 2, "Live ink must start at the compiler-checked vertical inset");
    const ink = measureTextInkBounds(command.text!, x!, y!, liveFont);
    assert.ok(ink);
    assert.ok(ink.x >= collision.x - 1e-6 && ink.y >= collision.y - 1e-6 &&
      ink.x + ink.width <= collision.x + collision.width + 1e-6 &&
      ink.y + ink.height <= collision.y + collision.height + 1e-6,
    "Actual live glyph ink must fit the compiler's collision reservation");
    const svg = renderSceneSvg({ ...compiled.renderScene, primitives: [label] });
    assert.ok(svg.includes(`x="${x}" y="${y}" font-size="${liveFont}"`),
      "Reference SVG and live transport must share the checked font and origin");
    labels++;
  }
}
assert.ok(labels > 40, "Exercise interval, reference-point, dense legend, system and objective labels");
console.log(`verify-linear-region-live-labels: ${labels} actual live glyph reservations match reference font and origin`);
