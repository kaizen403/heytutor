import assert from "node:assert/strict";
import { detectArchetype } from "../../src/archetypes/detect";
import { generatorFor } from "../../src/archetypes/generators";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { measureTextInkBounds, measureTextWidth } from "@heytutor/drawing";

for (const question of [
  "Draw a labelled diagram for Using vernier callipers to measure internal diameter, external diameter, and depth. Mark the named measured length.",
  "Draw a labelled diagram for Zero error of a vernier calliper. Mark the named measured length.",
  "Draw a labelled diagram of a screw gauge with pitch 1 mm and 50 circular scale divisions.",
]) {
  const match = detectArchetype(question);
  assert.ok(match, "the supported instrument must be recognized");
  const raw = generatorFor(match.id)!({ question, slots: match.slots, sources: match.sources, quantities: [], schematic: false });
  assert.ok(raw, "the instrument has a computed figure");
  const captions = raw.entities.filter((entity) => Boolean(entity.label) && /caption|reading|least count|scale number|vernier zero|vernier ten|coinciding vernier division|circular scale zero|zero error/.test(entity.role));
  assert.ok(captions.length > 0);
  assert.ok(captions.every((entity) => entity.kind === "label"), "computed instrument text anchors are labels rather than physical point dots");
  if (match.id === "vernier_calliper") {
    assert.equal(raw.entities.find((entity) => entity.id === "vs_caption")?.label, "10 div = 9 mm", "the compact source caption preserves the full verified vernier ratio");
  }
  const validated = validateSceneDocument(pruneDeadSceneEntities(raw as unknown as Record<string, unknown>));
  assert.ok(validated.document, "the instrument remains a valid operator program");
  const compiled = compileSceneDocument(validated.document);
  assert.ok(compiled.ok && compiled.renderScene, `readable instrument labels must compile: ${JSON.stringify(compiled.report.issues)}`);
  for (const caption of captions) {
    assert.ok(compiled.renderScene.primitives.some((primitive) => primitive.entityId === caption.id && primitive.kind === "label"), `instrument text ${caption.id} is retained`);
    assert.ok(!compiled.renderScene.primitives.some((primitive) => primitive.entityId === caption.id && primitive.kind === "point"), `instrument text ${caption.id} emits no spurious dot`);
  }
  const primitives = compiled.renderScene.primitives;
  const printedValues = captions.filter((entity) => /^ms_label_\d+$|^(?:vs_zero_label|vs_ten_label|cs_zero_label)$/.test(entity.id));
  assert.ok(printedValues.length > 0, "the instrument retains its printed scale values");
  for (const printed of printedValues) {
    assert.equal(printed.provenance?.pinLabel, true, "printed scale values cannot drift into compass slots");
    const label = primitives.find((primitive) => primitive.entityId === printed.id && primitive.kind === "label")!;
    const mainDivision = /^ms_label_(\d+)$/.exec(printed.id);
    const tickId = mainDivision ? `ms${mainDivision[1]}` : printed.id === "vs_zero_label" ? "vs0" : printed.id === "vs_ten_label" ? "vs10" : "cs0";
    const tick = primitives.find((primitive) => primitive.entityId === tickId)!;
    const axis = printed.id === "cs_zero_label" ? "y" : "x";
    assert.ok(Math.abs(label.points[0]![axis] - tick.points[0]![axis]) <= 0.011, `printed scale value ${printed.id} stays aligned with its exact tick`);
    const width = measureTextWidth(label.text!, 24) + 8;
    const ink = measureTextInkBounds(label.text!, label.points[0]!.x - width / 2 + 4, label.points[0]!.y - 12, 24);
    assert.ok(ink, "printed scale ink is measurable");
    const clearance = { x: ink.x - 6, y: ink.y - 6, width: ink.width + 12, height: ink.height + 12 };
    for (const primitive of primitives.filter((item) => item.kind !== "label" && item.provenance?.labelLeader !== true)) {
      const paths = primitive.kind === "polygon" || primitive.kind === "rectangle"
        ? [...primitive.points, primitive.points[0]!]
        : primitive.points;
      for (let index = 1; index < paths.length; index += 1) {
        assert.ok(!segmentHitsBox(paths[index - 1]!, paths[index]!, clearance), `printed scale value ${printed.id} clears ${primitive.id}`);
      }
    }
  }
  if (match.id === "vernier_calliper") {
    assert.equal(primitives.find((primitive) => primitive.entityId === "vs_caption" && primitive.kind === "label")?.text, "10 div = 9 mm", "the rendered caption retains the full source value");
    const label = primitives.find((primitive) => primitive.entityId === "coincide_mark" && primitive.kind === "label")!;
    const leader = primitives.find((primitive) => primitive.entityId === "coincide_mark" && primitive.provenance?.labelLeader === true);
    assert.ok(leader, "moved coincidence text retains an explicit precise connector");
    const division = Number.parseInt(label.text!, 10);
    const tick = primitives.find((primitive) => primitive.entityId === `vs${division}`)!;
    const plate = primitives.find((primitive) => primitive.entityId === "vernier_plate")!;
    assert.ok(Math.abs(leader.points[0]!.x - tick.points[0]!.x) <= 0.011, "coincidence connector marks the computed division exactly");
    assert.ok(Math.abs(leader.points[0]!.y - Math.max(...plate.points.map((point) => point.y))) <= 0.011, "coincidence connector starts on the physical plate edge");
  }
}
console.log("verify-instrument-labels: computed instrument text keeps its anchors without physical point dots");

function segmentHitsBox(a: { x: number; y: number }, b: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }): boolean {
  let enter = 0;
  let leave = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, box.x, box.x + box.width],
    [a.y, b.y - a.y, box.y, box.y + box.height],
  ]) {
    if (Math.abs(delta!) < 1e-9) {
      if (start! < min! || start! > max!) return false;
    } else {
      const near = (min! - start!) / delta!;
      const far = (max! - start!) / delta!;
      enter = Math.max(enter, Math.min(near, far));
      leave = Math.min(leave, Math.max(near, far));
    }
  }
  return enter <= leave;
}
