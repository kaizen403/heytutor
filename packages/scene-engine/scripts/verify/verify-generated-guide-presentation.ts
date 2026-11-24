import assert from "node:assert/strict";
import "../../src/index";
import { compileGeneratedSceneGuide } from "../../src/compile/generatedSceneGuide";
import { compileGeneratedSceneStyle, SCIENTIFIC_STYLE_SCHEMA, verifyGeneratedSceneStyle } from "../../src/compile/generatedSceneStyle";
import { nativeGivenLabelTimingProved } from "../../src/compile/nativeGuideSourceBindings";
import { boundsInside, boundsOverlap } from "../../src/labels/labelEngine";

const question = "Draw Hydrogen spectrum and spectral series and mark any named directions, levels, or components on the figure. Show the n = 1 and n = 2 energy levels.";
const sourceInput = { question };
const guide = compileGeneratedSceneGuide(sourceInput);
assert(guide.ok, !guide.ok ? guide.decline.message : "");
for (const text of ["n=1", "n=2"]) {
  const slot = guide.guide.labelSlots.find(label => label.text === text);
  assert(slot);
  assert.equal(slot.revealAfter, "setup", `${text} is a source-given owner-bound level identity`);
  assert.equal(slot.timingBasis, "source_given");
}
const higher = guide.guide.labelSlots.find(label => label.text === "n=3");
assert(higher && higher.revealAfter === "teaching_complete", "an unrequested numeric initial level must retain conservative staging");
const compiled = compileGeneratedSceneStyle({ sourceInput, style: { schema: SCIENTIFIC_STYLE_SCHEMA, paletteId: "teal" } });
assert(compiled.ok, !compiled.ok ? compiled.decline.message : "");
const setup = compiled.render.frame.setupSvg, complete = compiled.render.frame.completeDiagnosticSvg;
for (const text of ["n=1", "n=2"]) {
  const slot = guide.guide.labelSlots.find(label => label.text === text)!;
  assert(setup.includes(`data-label-slot="${slot.id}"`), `${text} must be visibly rendered during setup`);
}
assert(!setup.includes(`data-label-slot="${higher.id}"`) && complete.includes(`data-label-slot="${higher.id}"`));
assert(setup.includes('data-scene-caption="setup"'), "ordinal disclosure must be drawn in the actual setup frame");
assert(complete.includes('data-scene-caption="setup"'), "ordinal disclosure must remain visible in the completed frame");
assert(verifyGeneratedSceneStyle({ sourceInput, style: compiled.render.style, render: compiled.render }).ok);
assert(guide.guide.caption?.text === "Ordinal levels; not to scale");
for (const row of guide.guide.caption.board.lines) {
  assert(boundsInside(row.inkBounds, guide.guide.caption.board.region));
  assert(!boundsOverlap(row.reservedBounds, guide.guide.transform.pictureBounds), "caption cannot overwrite scientific marks");
}
for (const mutation of ["value", "unit", "owner", "provenance", "quote"] as const) {
  const document = structuredClone(guide.guide.sourceScene.document);
  const quantity = document.quantities.find(row => row.id === "principal_1")!;
  if (mutation === "value") Reflect.set(quantity, "value", 2);
  if (mutation === "unit") Reflect.set(quantity, "unit", "m");
  if (mutation === "owner") Reflect.set(quantity, "nativeOwnerId", "level_2");
  if (mutation === "provenance") Reflect.set(quantity, "provenance", "derived");
  if (mutation === "quote") Reflect.set(quantity, "sourceText", "n = 2");
  assert(!nativeGivenLabelTimingProved({ question, document, label: { entityId: "level_1", text: "n=1" } }),
    `${mutation}: source given timing requires the exact original owner, value, unit and declaration`);
}
assert(!nativeGivenLabelTimingProved({ question: question.replace("Show the", "Ignore the"),
  document: structuredClone(guide.guide.sourceScene.document), label: { entityId: "level_1", text: "n=1" } }));
const forgedCaption = structuredClone(compiled.render);
Reflect.set(forgedCaption.guide.caption!, "text", "Equal physical energy spacing");
assert(!verifyGeneratedSceneStyle({ sourceInput, style: compiled.render.style, render: forgedCaption }).ok,
  "a forged caption fails complete native replay even when geometry is otherwise unchanged");
console.log("generated guide presentation: source-given levels visible, source ordinal caption drawn, unbound numeric level deferred, full replay binding passes");
