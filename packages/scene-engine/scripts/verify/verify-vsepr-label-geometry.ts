import { buildVseprScene } from "../../src/chemistry/vsepr";
import { compileSceneDocument } from "../../src/compile/compiler";
import { boundsOverlap, type LabelBounds } from "../../src/labels/labelEngine";

for (const question of [
  "The shape of CO2 molecule is:",
  "Statement I: F2O < H2O < Cl2O is the correct trend in terms of bond angle. Statement II: SiF4, SnF4 and PbF4 are ionic in nature.",
  "The molecule/ion with square pyramidal shape is: PF5, BrF5, PCl5, [Ni(CN)4]2-",
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
