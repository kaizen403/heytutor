import { buildVseprScene } from "../../src/chemistry/vsepr";
import { compileSceneDocument } from "../../src/compile/compiler";
import { boundsOverlap, type LabelBounds } from "../../src/labels/labelEngine";

for (const question of [
  "The shape and bond angle of CO2 molecule are:",
  "Compare the bond angles of F2O and H2O and Cl2O.",
  "Compare the molecular shapes and bond angles of PF5 and BrF5 and PCl5.",
]) {
  const document = buildVseprScene(question, [], false);
  if (!document) throw new Error(`VSEPR figure declined: ${question}`);
  const compiled = compileSceneDocument(document);
  if (!compiled.ok || !compiled.renderScene) throw new Error(`VSEPR labels refused: ${JSON.stringify(compiled.report.issues)}`);
  const labels = compiled.renderScene.primitives.filter((primitive) => primitive.kind === "label");
  for (let index = 0; index < labels.length; index += 1) {
    for (const other of labels.slice(index + 1)) {
      const label = labels[index]!;
      const bounds = label.provenance?.labelBounds as LabelBounds | undefined;
      const otherBounds = other.provenance?.labelBounds as LabelBounds | undefined;
      if (!bounds || !otherBounds) throw new Error("Every VSEPR glyph needs verified bounds");
      if (boundsOverlap(bounds, otherBounds, 6)) throw new Error(`VSEPR glyph bounds collide: ${label.entityId} / ${other.entityId}`);
    }
  }
}
console.log("verify-vsepr-label-geometry: molecule angle, formula and caption glyphs have separate verified bounds");
