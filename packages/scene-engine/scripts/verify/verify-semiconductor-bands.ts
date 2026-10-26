import { strict as assert } from "node:assert";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { RenderPrimitive } from "../../src/types";

// "Explain what an intrinsic semiconductor is" drew a conductor with a band
// gap beside the semiconductor, each band named twice. "conductor" matched
// inside "semiconductor", and a conductor's bands overlap, so two lines with
// a gap drew it falsely. Each column now draws Ec above Ev, the impurity
// level the stem names, one label per level, and only the types it asks for.
// A comparison with a conductor or an insulator declines.

let checks = 0;
const scene = (question: string) => synthesizeFamilyScene({ question, families: ["energy_level"] });
const labels = (primitives: RenderPrimitive[]) =>
  primitives.filter((primitive) => primitive.kind === "label").map((primitive) => String(primitive.text ?? "").trim());
const count = (texts: string[], text: string) => texts.filter((entry) => entry === text).length;
const levelY = (primitives: RenderPrimitive[], suffix: string) =>
  primitives.filter((primitive) => primitive.kind !== "label" && String(primitive.entityId ?? "").endsWith(suffix) && primitive.points.length >= 2)
    .map((primitive) => primitive.points[0]!.y);

for (const [question, columns, impurities, captions] of [
  ["Explain what an intrinsic semiconductor is.", 1, [], ["intrinsic"]],
  ["Draw the energy band diagram of an n-type semiconductor.", 1, ["Ed"], ["n-type"]],
  ["Draw the energy band diagram of a p-type semiconductor.", 1, ["Ea"], ["p-type"]],
  ["Compare the energy band diagrams of n-type and p-type semiconductors.", 2, ["Ed", "Ea"], ["n-type", "p-type"]],
] as const) {
  const built = scene(question);
  assert.equal(built?.family, "energy_level", `${question}: draws the band diagram`);
  const primitives = built!.renderScene.primitives;
  const texts = labels(primitives);
  assert.equal(count(texts, "Ec"), columns, `${question}: each conduction band is named once`);
  assert.equal(count(texts, "Ev"), columns, `${question}: each valence band is named once`);
  for (const impurity of impurities) assert.equal(count(texts, impurity), 1, `${question}: ${impurity} is drawn and named once`);
  for (const absent of ["Ed", "Ea"].filter((text) => !(impurities as readonly string[]).includes(text))) {
    assert.equal(count(texts, absent), 0, `${question}: no ${absent} level the stem does not name`);
  }
  assert.deepEqual(texts.filter((text) => /type|intrinsic|conductor|insulator/.test(text)).sort(), [...captions].sort(), `${question}: captions name only the asked types`);
  const ec = levelY(primitives, "_ec"), ev = levelY(primitives, "_ev");
  assert.equal(ec.length, columns, `${question}: one Ec line per column`);
  ec.forEach((y, index) => assert.ok(y < ev[index]!, `${question}: Ec sits above Ev`));
  checks += 1;
}

for (const question of [
  "Distinguish between a conductor, a semiconductor and an insulator using energy bands.",
  "Compare the energy bands of a metal and a semiconductor.",
  "Draw the energy band diagram of a semiconductor and an insulator.",
]) {
  assert.notEqual(scene(question)?.family, "energy_level", `${question}: no two-line band diagram stands in for a conductor or an insulator`);
  checks += 1;
}

console.log(`verify-semiconductor-bands: ${checks} checks passed`);
