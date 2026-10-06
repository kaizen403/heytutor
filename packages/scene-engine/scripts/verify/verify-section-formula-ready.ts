/**
 * Section formula topic readiness gate (maths/10, plain-English stems).
 *
 * Runs the synthesis the tutor uses and checks every figure against values
 * computed here by hand from the stem: the endpoints at their stated
 * coordinates, the section point where n(P-A) = ±m(B-P) puts it, the
 * extension for an external point, and the turn-plan authority that holds
 * narration to those numbers. Singular, inconsistent and planner-mutated
 * sections must not draw.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-section-formula-ready.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { validateTurnPlanSceneProofs } from "../../src/contracts/contractsV3";
import { applySectionFormulaAuthority, readSectionFormulaSource, sectionFormulaScene } from "../../src/ir/sectionFormulaSource";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

let checks = 0;
const check = (name: string, run: () => void): void => {
  run();
  checks += 1;
  console.log(`ok ${name}`);
};

interface Case {
  name: string;
  question: string;
  a: [number, number];
  b: [number, number];
  /** Hand-computed section point. */
  p: [number, number];
  external?: boolean;
  /** For a ratio question, the hand-computed AP:PB. */
  ratio?: [number, number];
  label: string;
}

const CASES: Case[] = [
  // (2*2 + 1*5)/3 = 3, (2*-3 + 1*6)/3 = 0
  { name: "internal 1:2", question: "Find the coordinates of the point which divides the line segment joining A(2, -3) and B(5, 6) internally in the ratio 1:2.",
    a: [2, -3], b: [5, 6], p: [3, 0], label: "P=(3,0)" },
  // (3*-1 + 2*4)/5 = 1, (3*7 + 2*-3)/5 = 3
  { name: "internal 2:3 without the word internally", question: "Find the coordinates of the point which divides the join of A(-1, 7) and B(4, -3) in the ratio 2:3.",
    a: [-1, 7], b: [4, -3], p: [1, 3], label: "P=(1,3)" },
  // (2*4 - 1*1)/(2-1) = 7, (2*5 - 1*2)/1 = 8; endpoints are named P and Q, so the point is R
  { name: "external 2:1", question: "Find the point dividing the line segment joining P(1, 2) and Q(4, 5) externally in the ratio 2:1.",
    a: [1, 2], b: [4, 5], p: [7, 8], external: true, label: "R=(7,8)" },
  // ((2+6)/2, (3+7)/2)
  { name: "midpoint", question: "Find the midpoint of the segment joining A(2, 3) and B(6, 7).",
    a: [2, 3], b: [6, 7], p: [4, 5], label: "M=(4,5)" },
  // t = (-4 - -6)/(3 - -6) = 2/9, also (6 - 10)/(-8 - 10) = 2/9; AP:PB = 2:7
  { name: "ratio asked", question: "In what ratio does the point P(-4, 6) divide the line segment joining A(-6, 10) and B(3, -8)?",
    a: [-6, 10], b: [3, -8], p: [-4, 6], ratio: [2, 7], label: "P=(-4,6)" },
  // 7/3 repeats, so the point keeps its name alone
  { name: "repeating coordinate", question: "Find the point which divides the join of A(1, 1) and B(4, 5) internally in the ratio 1:2.",
    a: [1, 1], b: [4, 5], p: [2, 7 / 3], label: "P" },
];

const close = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));

for (const item of CASES) {
  check(item.name, () => {
    const result = synthesizeFamilyScene({ question: item.question });
    assert.ok(result, "drawn");
    assert.equal(result.family, "coordinate_figure");
    assert.equal(result.tier, item.ratio === undefined || item.ratio[0] > 0 ? "exact_verified" : result.tier);
    const document = result.document;
    const points = document.constructions.filter((construction) => construction.operator === "point");
    assert.deepEqual(points.map((construction) => [construction.inputs.x, construction.inputs.y]), [item.a, item.b], "the stated endpoints at their coordinates");
    const section = document.constructions.find((construction) => construction.operator === "section_point");
    assert.ok(section, "section point from the operator");
    const sectionId = section.outputs[0]!;
    assert.equal(document.entities.find((entity) => entity.id === sectionId)?.label, item.label);
    // The rendered point lies where the hand value puts it, in the scene's own frame.
    const rendered = (id: string) => result.renderScene.primitives.find((primitive) => primitive.entityId === id && primitive.kind === "point")?.points[0];
    const [ra, rb, rp] = [points[0]!.outputs[0]!, points[1]!.outputs[0]!, sectionId].map(rendered);
    assert.ok(ra && rb && rp, "endpoints and section point render");
    const t = (item.p[0] - item.a[0]) / (item.b[0] - item.a[0] || Infinity) || (item.p[1] - item.a[1]) / (item.b[1] - item.a[1]);
    assert.ok(Math.abs(rp.x - (ra.x + t * (rb.x - ra.x))) < 0.02 && Math.abs(rp.y - (ra.y + t * (rb.y - ra.y))) < 0.02, "rendered point at the hand-computed parameter");
    const extension = document.constructions.find((construction) => construction.id === "extend");
    assert.equal(Boolean(extension), Boolean(item.external || t < 0 || t > 1), "extension only for a point outside the segment");
    for (const primitive of result.renderScene.primitives) {
      for (const point of primitive.points) assert.ok(point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700, "inside the diagram zone");
    }
    const reading = readSectionFormulaSource(item.question);
    assert.equal(reading.status, "ok");
    if (reading.status === "ok") {
      assert.ok(close(reading.source.point.x, item.p[0]) && close(reading.source.point.y, item.p[1]), "exact solve agrees with the hand value");
      if (item.ratio) assert.deepEqual([reading.source.m, reading.source.n], item.ratio);
    }
  });
}

const CONTROLS: Array<[string, string, string]> = [
  ["external m = n has no finite point", "Find the point which divides the line joining A(1, 1) and B(3, 3) externally in the ratio 1:1.", "singular"],
  ["internal 0:0 defines no point", "Find the point which divides the join of A(1, 1) and B(3, 3) in the ratio 0:0.", "singular"],
  ["stated point disagrees with the stated ratio", "The point P(1, 2) divides the join of A(0, 0) and B(3, 3) in the ratio 1:2. Find the coordinates of P.", "inconsistent"],
  ["stated point off the line", "In what ratio does the point P(2, 5) divide the join of A(1, 1) and B(4, 5)?", "inconsistent"],
  ["point outside cannot divide internally", "In what ratio does the point P(7, 9) divide internally the join of A(1, 1) and B(4, 5)?", "inconsistent"],
  ["two ratios", "Find the points which divide the join of A(1, 1) and B(4, 5) in the ratios 1:2 and 2:1.", "declined"],
  ["fractional coordinate is not read", "Show that the point P(2, 7/3) divides the join of A(1, 1) and B(4, 5) in the ratio 1:2.", "declined"],
  ["coincident endpoints", "Find the point which divides the join of A(2, 2) and B(2, 2) in the ratio 1:3.", "declined"],
];
for (const [name, question, status] of CONTROLS) {
  check(`control: ${name}`, () => {
    assert.equal(readSectionFormulaSource(question).status, status);
    assert.equal(sectionFormulaScene(question), null, "no section figure");
    const drawn = synthesizeFamilyScene({ question });
    assert.ok(!drawn?.document.constructions.some((construction) => construction.operator === "section_point"), "no section point drawn by any family");
  });
}

// A planner-made section scene is held to the stem by the live proof check.
check("planner section scene: mutated endpoint, weights and mode are fatal", () => {
  const question = CASES[0]!.question;
  const document = sectionFormulaScene(question)!;
  const plan = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: ["section_formula"], assumptions: [], visualRequirement: "required" } as TurnPlanV3;
  assert.equal(validateTurnPlanSceneProofs(document, plan).filter((issue) => issue.code.startsWith("section_")).length, 0, "the engine's own scene passes");
  for (const mutate of [
    (doc: typeof document) => { doc.constructions.find((construction) => construction.id === "place_a")!.inputs.x = 99; },
    (doc: typeof document) => { Object.assign(doc.constructions.find((construction) => construction.id === "divide")!.inputs, { m: 2, n: 1 }); },
    (doc: typeof document) => { Object.assign(doc.constructions.find((construction) => construction.id === "divide")!.inputs, { mode: "external" }); },
    (doc: typeof document) => { Object.assign(doc.constructions.find((construction) => construction.id === "divide")!.inputs, { m: -1 }); },
  ]) {
    const copy = structuredClone(document);
    mutate(copy);
    assert.ok(validateTurnPlanSceneProofs(copy, plan).some((issue) => issue.severity === "fatal" && issue.code.startsWith("section_")), "mutation rejected");
  }
  const reversed = structuredClone(document);
  const divide = reversed.constructions.find((construction) => construction.id === "divide")!;
  Object.assign(divide.inputs, { a: divide.inputs.b, b: divide.inputs.a, m: 2, n: 1 });
  assert.equal(validateTurnPlanSceneProofs(reversed, plan).filter((issue) => issue.code.startsWith("section_")).length, 0, "B to A in 2:1 is the same division");
});

type Quantity = TurnPlanV3["derived"][number];
const plan = (question: string, givens: Quantity[], derived: Quantity[]): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, givens, derived,
  unknowns: derived.map((quantity) => ({ id: quantity.id, symbol: quantity.symbol })),
  qualitativeClaims: [], lawIds: ["section_formula"], assumptions: [], visualRequirement: "required",
} as TurnPlanV3);
const q = (id: string, symbol: string, value: number, provenance: Quantity["provenance"] = "derived"): Quantity => ({ id, symbol, value, provenance } as Quantity);
const valueOf = (result: ReturnType<typeof applySectionFormulaAuthority>, id: string) => result?.plan.derived.find((quantity) => quantity.id === id)?.value;

check("authority: wrong coordinates corrected, stray number withdrawn", () => {
  const question = CASES[0]!.question;
  const result = applySectionFormulaAuthority(question, plan(question, [q("x1", "x_1", 2, "given"), q("bad", "x_2", 7, "given")], [q("x", "x", 4, "derived"), q("y", "y_P", 0), q("s", "s", 42)]));
  assert.ok(result);
  assert.equal(valueOf(result, "x"), 3, "x = (2*2 + 5)/3");
  assert.equal(valueOf(result, "y"), 0);
  assert.equal(valueOf(result, "s"), undefined, "42 is neither stated nor solved");
  assert.deepEqual(result.plan.givens.map((given) => given.id), ["x1"], "7 is not a stated number");
});

check("authority: repeating coordinate written rounded stands", () => {
  const question = CASES[5]!.question;
  const result = applySectionFormulaAuthority(question, plan(question, [], [q("x", "x_P", 2), q("y", "y_P", 2.33)]));
  assert.equal(valueOf(result, "y"), 2.33, "7/3 written 2.33");
});

check("authority: asked ratio corrected and added", () => {
  const question = CASES[4]!.question;
  const corrected = applySectionFormulaAuthority(question, plan(question, [], [q("k", "k", 0.5)]));
  assert.ok(corrected && Math.abs(valueOf(corrected, "k")! - 2 / 7) < 1e-9, "k = 2/7");
  const added = applySectionFormulaAuthority(question, plan(question, [], []));
  assert.ok(added && Math.abs(valueOf(added, "section_ratio")! - 2 / 7) < 1e-9, "missing ratio added");
});

check("authority: missing coordinates are added", () => {
  const question = CASES[2]!.question;
  const result = applySectionFormulaAuthority(question, plan(question, [], []));
  assert.equal(valueOf(result, "section_x"), 7);
  assert.equal(valueOf(result, "section_y"), 8);
});

check("authority: singular and inconsistent stems withdraw every derived number", () => {
  for (const [, question] of CONTROLS.slice(0, 3)) {
    const result = applySectionFormulaAuthority(question, plan(question, [], [q("x", "x", 2), q("y", "y", 2)]));
    assert.ok(result);
    assert.equal(result.plan.derived.length, 0);
  }
});

check("authority: other stems untouched", () => {
  const question = "Find the distance between A(1, 2) and B(4, 6).";
  assert.equal(applySectionFormulaAuthority(question, plan(question, [], [q("d", "d", 5)])), null);
});

check("authority is wired into the live turn", () => {
  const source = readFileSync(new URL("../../../../apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts", import.meta.url), "utf8");
  const start = source.indexOf("turnPlan = reconcileTurnPlanWithSolver(");
  const call = source.indexOf("applySectionFormulaAuthority(question, turnPlan)");
  const assign = source.indexOf("turnPlan = sectionAuthority.plan;");
  const end = source.indexOf("const authoritativeTurnPlan = turnPlan;");
  const teaching = source.indexOf("buildTurnTeachingPrompt({");
  assert.ok(start > 0 && call > start && assign > call && end > assign && teaching > end, "order: solver reconcile < section authority < authoritative plan < teaching prompt");
});

console.log(`\nverify-section-formula-ready: ${checks} checks passed`);
