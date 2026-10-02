import assert from "node:assert/strict";
import { boundsOverlap, placeLabels } from "../../src/labels/labelEngine";
import { measureTextInkBounds, measureTextWidth } from "@heytutor/drawing";
import { chemistryFamilyBuilder } from "../../src/chemistry";
import { KINETICS_PROBES } from "../../src/chemistry/kinetics";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { synthesizeDsaScene } from "../../src/synthesize/dsaFamilies";

const pinned = (entityId: string, x: number, text = "N") => ({
  entityId, text, anchor: { x, y: 300 }, pinToAnchor: true,
});
const collision = placeLabels([pinned("left", 600), pinned("right", 605)], []);
assert.equal(collision.ok, false, "Pinned glyphs must reject overlapping pinned glyphs");
assert.equal(collision.placements.length, 0, "No colliding pinned glyph is returned as a valid placement");
assert.equal(collision.issues.length, 2, "Both ambiguous pinned labels report the collision");

const distinctRuns = placeLabels([
  { ...pinned("atom", 600, "N"), labelId: "atom-symbol" },
  { ...pinned("atom", 605, "+"), labelId: "atom-charge" },
], []);
assert.equal(distinctRuns.ok, false, "Sharing an entity does not excuse colliding glyph runs");

const clear = placeLabels([pinned("left", 600), pinned("right", 640)], []);
assert.equal(clear.ok, true, "Separated pinned symbols retain their precise anchors");
assert.equal(clear.placements.length, 2);
assert.deepEqual(clear.placements.map(({ bounds }) => bounds.x + bounds.width / 2), [600, 640]);
assert.deepEqual(placeLabels([pinned("right", 605), pinned("left", 600)], []).placements, [], "Collision refusal does not depend on owner order");

const rendererMetrics = { measureTextPx: measureTextWidth, measureTextInkBounds };
const chargedAtom = placeLabels([
  pinned("nitrogen", 600, "N"),
  { ...pinned("charge", 612, "+"), anchor: { x: 612, y: 286 } },
], [], rendererMetrics);
assert.equal(chargedAtom.ok, true, "A charge may sit beside its atom when the genuine handwritten ink is clear");
assert.ok(boundsOverlap(chargedAtom.placements[0]!.bounds, chargedAtom.placements[1]!.bounds), "The charge regression deliberately overlaps em boxes");
const realInkCollision = placeLabels([pinned("a", 600), pinned("b", 601)], [], rendererMetrics);
assert.equal(realInkCollision.ok, false, "Measuring real glyphs must still reject actual intersecting ink");
const clippedScript = placeLabels([
  { ...pinned("script", 600, "A_p"), anchor: { x: 600, y: 334 }, viewBounds: { x: 400, y: 0, width: 760, height: 350 } },
], [], rendererMetrics);
assert.equal(clippedScript.ok, false, "A subscript descender must not escape the view even when its em box fits");

for (const [family, question] of [
  ["chem_lewis", "What is the formal charge on nitrogen in the Lewis structure of NH4+?"],
  ["chem_lewis", "Among H2O, NH3 and CH4, which molecule has the largest number of lone pairs on its central atom?"],
  ["chem_coordination", "Number of complexes showing optical isomerism among cis-[Cr(ox)2Cl2]3-, [Co(en)3]3+, trans-[Pt(en)2Cl2]2+ is"],
  ["chem_kinetics", KINETICS_PROBES.find((probe) => probe.question.startsWith("Which of the following plots"))!.question],
  ["chem_solutions", "Explain elevation of boiling point with a vapour pressure versus temperature diagram."],
]) {
  const raw = chemistryFamilyBuilder(family)!(question!, [], false);
  assert.ok(raw, `Source-grounded pinned figure must build: ${question}`);
  const validated = validateSceneDocument(pruneDeadSceneEntities(raw as unknown as Record<string, unknown>));
  assert.ok(validated.document, `Pinned figure schema: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document);
  assert.ok(compiled.ok && compiled.renderScene, `Pinned figure ink must be clear: ${JSON.stringify(compiled.report.issues)}`);
}
assert.ok(synthesizeDsaScene({
  structure: "array", values: [2, 5, 8, 12, 16, 23],
  steps: [
    { id: "input", values: [2, 5, 8, 12, 16, 23], pointers: [{ name: "lo", index: 0 }, { name: "mid", index: 2 }, { name: "hi", index: 5 }] },
    { id: "right", values: [2, 5, 8, 12, 16, 23], pointers: [{ name: "lo", index: 3 }, { name: "mid", index: 4 }, { name: "hi", index: 5 }] },
    { id: "found", values: [2, 5, 8, 12, 16, 23], pointers: [{ name: "mid", index: 3 }] },
  ],
}, { compile: { viewport: { x: 620, y: 90, width: 540, height: 460 } } }), "Stacked hint rows must reserve the true pointer-label reach in the tutor viewport");

console.log("verify-pinned-label-precision: pinned symbols keep exact anchors and reject ambiguous glyph overlap");
