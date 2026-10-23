/**
 * Recorded documents of the frozen probe rows the PR 221 review named. Each
 * row asserts the label MAIN draws correctly and the attached policy must not
 * break: a moved label stays clearly nearer its own stroke than any other
 * stroke (rows 298, 790, 60), one entity keeps one label (row 653), and an
 * assignment value stays in the summary stack instead of reading as a
 * stroke's measure (rows 518, 590, and the 790 results).
 *
 * pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-label-placement-review-rows.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { obstaclesFromPrimitives, strokeSegmentsToBoundsDistance, LABEL_OWNERSHIP_CLEAR_MARGIN_PX, type LabelBounds } from "../../src/labels/labelEngine";
import type { RenderPoint, RenderPrimitive, SceneDocument } from "../../src/types";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/label-placement-review-rows.json", import.meta.url), "utf8")) as {
  records: Array<{ row: number; document: SceneDocument }>;
};
const failures: string[] = [];
let passed = 0;
function check(name: string, body: () => void): void {
  try { body(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function render(row: number): RenderPrimitive[] {
  const record = fixture.records.find((item) => item.row === row);
  assert.ok(record, `fixture row ${row}`);
  const result = compileSceneDocument(structuredClone(record.document));
  assert.ok(result.ok && result.renderScene, `row ${row} draws: ${result.report.issues.map((issue) => issue.code).join(", ")}`);
  return result.renderScene.primitives;
}
function label(primitives: RenderPrimitive[], text: string): RenderPrimitive {
  const found = primitives.filter((primitive) => primitive.kind === "label" && primitive.text === text);
  assert.equal(found.length, 1, `exactly one "${text}" label`);
  return found[0]!;
}

/** Unled: box clearly nearer own ink than every other stroke, centre by 1.25 (frames excepted). Led: starts on own ink. */
function assertOwned(primitives: RenderPrimitive[], text: string): void {
  const item = label(primitives, text);
  const leaders = new Set(primitives.filter((primitive) => primitive.kind === "label").map((primitive) => `${primitive.id}_leader`));
  const strokes = obstaclesFromPrimitives(primitives.filter((primitive) => primitive.kind !== "label" && !leaders.has(primitive.id)))
    .filter((obstacle) => obstacle.kind === "geometry" && obstacle.entityId && obstacle.segments?.length);
  const own = strokes.filter((stroke) => stroke.entityId === item.entityId).flatMap((stroke) => stroke.segments!);
  assert.ok(own.length > 0, `"${text}" owner ${item.entityId} has visible ink`);
  if (item.provenance?.usesLeader === true) {
    const start: RenderPoint | undefined = primitives.find((primitive) => primitive.id === `${item.id}_leader`)?.points[0];
    assert.ok(start && strokeSegmentsToBoundsDistance(own, { x: start.x, y: start.y, width: 0, height: 0 }) <= 1.5, `"${text}" leader starts on its own ink`);
    return;
  }
  const box = (item.provenance?.labelCollisionBounds ?? item.provenance?.labelBounds) as LabelBounds;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2, width: 0, height: 0 };
  const ownBox = strokeSegmentsToBoundsDistance(own, box), ownCentre = strokeSegmentsToBoundsDistance(own, centre);
  for (const stroke of strokes.filter((candidate) => candidate.entityId !== item.entityId)) {
    const otherBox = strokeSegmentsToBoundsDistance(stroke.segments!, box);
    assert.ok(otherBox - ownBox >= LABEL_OWNERSHIP_CLEAR_MARGIN_PX,
      `"${text}" at (${item.points[0]!.x}, ${item.points[0]!.y}) is ${ownBox.toFixed(1)} px from ${item.entityId} but ${otherBox.toFixed(1)} px from ${stroke.entityId}`);
    if (stroke.primitiveKind !== "axes") assert.ok(ownCentre * 1.25 <= strokeSegmentsToBoundsDistance(stroke.segments!, centre),
      `"${text}" centre is not clearly nearer ${item.entityId} than ${stroke.entityId}`);
  }
}
function assertSummary(primitives: RenderPrimitive[], id: string, text: string): void {
  const item = primitives.find((primitive) => primitive.id === id && primitive.kind === "label");
  assert.ok(item, `${id} is drawn`);
  assert.equal(item.text, text, `${id} keeps its complete text`);
  assert.equal(item.provenance?.summary, true, `${id} "${text}" stays in the summary stack, not beside a stroke`);
}

check("row 298: d stays nearest the perpendicular PH, not vector PQ", () => assertOwned(render(298), "d"));
check("row 790: 54 V and 216 V stay on their own equipotentials", () => {
  const primitives = render(790);
  for (const text of ["54 V", "216 V", "0 V", "270 V"]) assertOwned(primitives, text);
});
check("row 790: work and spacing results stay in the summary stack", () => {
  const primitives = render(790);
  assertSummary(primitives, "along_result", "W₂ = 0 μJ");
  assertSummary(primitives, "across_result", "W₁ = −388.8 μJ");
  assertSummary(primitives, "spacing_result", "s = 0.72 cm");
});
check("row 60: the obtuse bisector name stays nearest its own line, not L1", () => assertOwned(render(60), "obtuse bisector"));
check("row 653: one boundary keeps one medium label", () => {
  const labels = render(653).filter((primitive) => primitive.kind === "label" && primitive.entityId === "boundary").map((primitive) => primitive.text);
  assert.deepEqual(labels, ["air"], "no unproven second medium label on the boundary");
});
for (const row of [518, 590]) check(`row ${row}: r = 60 m and g stay in the summary stack`, () => {
  const primitives = render(row);
  assertSummary(primitives, "radiusGiven", "r = 60 m");
  assertSummary(primitives, "gravityGiven", "g = 9.8 m/s²");
  assert.ok(primitives.some((primitive) => primitive.kind === "label" && primitive.text === "mg"), "the weight keeps its own name");
});

console.log(`label placement review rows: ${passed}/${passed + failures.length} passed`);
if (failures.length) process.exitCode = 1;
