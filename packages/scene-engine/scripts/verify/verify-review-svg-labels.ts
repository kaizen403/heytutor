import { strict as assert } from "node:assert";
import { measureTextInkBounds } from "@heytutor/drawing";
import { attemptArchetypeScene } from "../../src/archetypes";
import { renderSceneSvg } from "../lib/renderSceneSvg";

// Review renders drew each label at 13 px with its baseline at the centre
// of its reserved box, about half a line above where the board writes it
// (24 px handwriting from the box's top-left). Label positions judged from
// those renders were off. A label with reserved bounds is now drawn at the
// engine's size, centred on the ink box the engine measured.

const question = "Light of photon energy 5.0 eV falls on a metal of work function 2.0 eV. Draw the energy diagram and find the maximum kinetic energy of the photoelectrons.";
const scene = attemptArchetypeScene({ question, turnPlan: { schemaVersion: "turn-plan/v3", question } as never }).scene;
assert.ok(scene, "the photoelectric figure compiles");
const svg = renderSceneSvg(scene!.renderScene, { title: "check", subtitle: "", guides: false });
let checks = 0;
for (const label of scene!.renderScene.primitives.filter((primitive) => primitive.kind === "label" && primitive.provenance?.labelBounds && primitive.text)) {
  const provenance = label.provenance as { labelBounds: { x: number; y: number }; fontPx?: number; labelPad?: number };
  const fontPx = provenance.fontPx ?? 24;
  const pad = typeof provenance.labelPad === "number" ? (provenance.labelPad === 0 ? 2 : provenance.labelPad) : 4;
  const ink = measureTextInkBounds(label.text!, provenance.labelBounds.x + pad, provenance.labelBounds.y + pad, fontPx)!;
  const escaped = label.text!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const match = new RegExp(`<text x="([0-9.]+)" y="([0-9.]+)" font-size="([0-9.]+)"[^>]*>${escaped}</text>`).exec(svg);
  assert.ok(match, `${label.text}: drawn`);
  assert.equal(Number(match![3]), fontPx, `${label.text}: drawn at the engine's size`);
  assert.ok(Math.abs(Number(match![2]) - (ink.y + ink.height / 2)) < 1, `${label.text}: centred on the ink the engine measured`);
  checks += 1;
}
assert.ok(checks >= 3, "the figure has labels to check");
console.log(`verify-review-svg-labels: ${checks} checks passed`);
