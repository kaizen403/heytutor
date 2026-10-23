/**
 * The equivalence pH label names the equivalence pH, not the pH 7 line.
 *
 * A blind judge read "pH < 7" on a weak base titration as naming the full
 * width pH 7 reference: the placement solver had settled the equivalence
 * label at the pH 7 height, left of the axis. The figure now reads each value
 * off the axis on the side of its own line away from the other line.
 *
 *   geometry   in every titration figure that draws the pH 7 line, the
 *              equivalence pH label box is nearer its own axis mark than the
 *              pH 7 line, and the pH 7 label nearer its line than the
 *              equivalence guide
 *   probes     every titration probe and short ask still draws, with the
 *              equivalence label present
 *   mutation   the same documents without the placement annotations (the
 *              old placement) and a label box moved onto the pH 7 height
 *              must both turn the geometry check red
 */
import assert from "node:assert/strict";
import "../../src/chemistry/families";
import { SOLUTIONS_PROBES } from "../../src/chemistry/solutionsGraphs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { RenderPrimitive, RenderScene, SceneDocument } from "../../src/types";

interface Box { x: number; y: number; width: number; height: number }
interface P { x: number; y: number }

function boxToPoint(box: Box, point: P): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

function boxToSegment(box: Box, a: P, b: P): number {
  let best = Infinity;
  for (let i = 0; i <= 200; i += 1) {
    const t = i / 200;
    best = Math.min(best, boxToPoint(box, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
  }
  return best;
}

function labelBox(label: RenderPrimitive): Box {
  const bounds = label.provenance?.labelBounds as Box | undefined;
  assert.ok(bounds, `label ${label.id} has solved bounds`);
  return bounds;
}

/** Null when the figure draws no separate pH 7 line; otherwise the measured distances. */
export function equivalenceLabelGeometry(scene: RenderScene): { eqOwn: number; eqNeutral: number; neutralOwn: number; neutralGuide: number } | null {
  const neutral = scene.primitives.find((p) => p.entityId === "neutral" && p.kind !== "label");
  if (!neutral) return null;
  const eqMark = scene.primitives.find((p) => p.entityId === "eq_ph" && p.kind === "point");
  const guide = scene.primitives.find((p) => p.entityId === "eq_guide" && p.kind !== "label");
  const eqLabels = scene.primitives.filter((p) => p.kind === "label" && p.entityId === "eq_ph");
  const neutralLabels = scene.primitives.filter((p) => p.kind === "label" && (p.entityId === "neutral" || p.entityId === "neutral_a"));
  assert.ok(eqMark && guide, "equivalence mark and guide drawn");
  assert.equal(eqLabels.length, 1, "exactly one equivalence pH label");
  const [n0, n1] = [neutral.points[0]!, neutral.points.at(-1)!];
  const [g0, g1] = [guide.points[0]!, guide.points.at(-1)!];
  // Strong against strong: the equivalence pH is 7, the guide lies on the
  // pH 7 line and one "pH 7" label truthfully names both.
  if (Math.abs(g0.y - n0.y) < 1 && Math.abs(g1.y - n1.y) < 1) return null;
  const eqBox = labelBox(eqLabels[0]!);
  const neutralBox = neutralLabels[0] ? labelBox(neutralLabels[0]) : null;
  return {
    eqOwn: boxToPoint(eqBox, eqMark.points[0]!),
    eqNeutral: boxToSegment(eqBox, n0, n1),
    neutralOwn: neutralBox ? boxToSegment(neutralBox, n0, n1) : 0,
    neutralGuide: neutralBox ? boxToSegment(neutralBox, g0, g1) : Infinity,
  };
}

function geometryHolds(scene: RenderScene): void {
  const measured = equivalenceLabelGeometry(scene);
  if (!measured) return;
  assert.ok(measured.eqOwn < measured.eqNeutral,
    `equivalence pH label is ${measured.eqOwn.toFixed(1)} px from its mark but ${measured.eqNeutral.toFixed(1)} px from the pH 7 line`);
  assert.ok(measured.neutralOwn < measured.neutralGuide,
    `pH 7 label is ${measured.neutralOwn.toFixed(1)} px from its line but ${measured.neutralGuide.toFixed(1)} px from the equivalence guide`);
}

const QUALITATIVE = [
  "titration curve of weak base with strong acid",
  "weak acid strong base titration curve",
  "titration curve strong acid strong base",
  "A weak base is titrated with a strong acid. Sketch the titration curve and mark the equivalence point.",
  "Draw the titration curve of a weak acid with a strong base and mark the half equivalence point.",
  "Sketch the pH curve for the titration of ammonia with hydrochloric acid.",
];
const STEMS = [...new Set([...QUALITATIVE, ...SOLUTIONS_PROBES.filter((probe) => /titrat/i.test(probe.question) && probe.expect === "draw").map((probe) => probe.question)])];

const rows: Array<{ id: string; passed: boolean; error: string | null }> = [];
function check(id: string, test: () => void): void {
  try { test(); rows.push({ id, passed: true, error: null }); }
  catch (error) { rows.push({ id, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}

let withNeutral = 0;
const documents: Array<{ question: string; document: SceneDocument }> = [];
for (const question of STEMS) {
  check(`draws/${question}`, () => {
    const scene = synthesizeFamilyScene({ question });
    assert.equal(scene?.family, "chem_solutions");
    assert.ok(scene!.renderScene.primitives.some((p) => p.kind === "label" && p.entityId === "eq_ph"), "equivalence pH label drawn");
    if (equivalenceLabelGeometry(scene!.renderScene)) { withNeutral += 1; documents.push({ question, document: scene!.document }); }
    geometryHolds(scene!.renderScene);
  });
}
check("coverage/neutral-line-figures", () => assert.ok(withNeutral >= 3, `only ${withNeutral} figures drew the pH 7 line`));

// Mutation 1: the same documents placed by the solver alone, as before.
let reverted = 0;
for (const { question, document } of documents) {
  const mutated: SceneDocument = { ...document, annotations: document.annotations.filter((a) => a.id !== "eq_ph_value" && a.id !== "neutral_value") };
  if (mutated.annotations.length === document.annotations.length) continue;
  const compiled = compileSceneDocument(mutated);
  if (!compiled.ok || !compiled.renderScene) continue;
  try { geometryHolds(compiled.renderScene); } catch { reverted += 1; continue; }
  void question;
}
check("mutation/solver-placement-goes-red", () => assert.ok(reverted >= 1, "dropping the placement annotations must fail the check on at least one figure"));
check("mutation/weak-base-solver-placement-red", () => {
  const entry = documents.find((item) => item.question === "titration curve of weak base with strong acid");
  assert.ok(entry);
  const compiled = compileSceneDocument({ ...entry.document, annotations: entry.document.annotations.filter((a) => a.id !== "eq_ph_value" && a.id !== "neutral_value") });
  assert.ok(compiled.ok && compiled.renderScene);
  assert.throws(() => geometryHolds(compiled.renderScene!), /pH 7/);
});

// Mutation 2: an equivalence label box moved onto the pH 7 height.
check("mutation/label-on-neutral-height-red", () => {
  const scene = synthesizeFamilyScene({ question: "titration curve of weak base with strong acid" })!;
  const neutral = scene.renderScene.primitives.find((p) => p.entityId === "neutral" && p.kind !== "label")!;
  let moved = 0;
  const primitives = scene.renderScene.primitives.map((p) => {
    if (p.kind !== "label" || p.entityId !== "eq_ph") return p;
    const box = labelBox(p);
    moved += 1;
    return { ...p, provenance: { ...p.provenance, labelBounds: { ...box, y: neutral.points[0]!.y - box.height / 2 } } };
  });
  assert.equal(moved, 1, "the mutation moved the equivalence label");
  assert.throws(() => geometryHolds({ ...scene.renderScene, primitives }), /pH 7 line/);
});

for (const row of rows) if (!row.passed) console.log(`FAIL ${row.id}: ${row.error}`);
const failed = rows.filter((row) => !row.passed).length;
console.log(`verify-chemistry-titration-equivalence-label: ${rows.length - failed} passed, ${failed} failed (${STEMS.length} titration stems, ${withNeutral} with the pH 7 line, ${reverted} red without the placement)`);
if (failed) process.exitCode = 1;
