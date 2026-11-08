/**
 * Newman projections: one molecule bound by the organic parser, the bond computed from
 * its graph, every conformer drawn and named from the dihedral measured on the figure.
 * Declines leave no runner up; asks about anything else keep their old figure.
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-newman.ts
 */
import assert from "node:assert/strict";
import "../../src/chemistry/families";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { newmanBinding } from "../../src/chemistry/organic/newman";
import type { SceneDocument } from "../../src/types";

let failed = 0;
let passed = 0;
function check(id: string, run: () => void): void {
  try {
    run();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type Point = { x: number; y: number };
const scene = (question: string) => synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question });
const conformerGroups = (document: SceneDocument | undefined) => (document?.revealGroups ?? []).filter((group) => group.id.startsWith("conformer_"));
const label = (document: SceneDocument, id: string) => document.entities.find((entity) => entity.id === id)?.label;

function pointOf(document: SceneDocument, id: string): Point {
  const construction = document.constructions.find((value) => value.outputs.includes(id));
  assert.ok(construction, `no construction for ${id}`);
  if (construction.operator === "label") return pointOf(document, String(construction.inputs.target));
  assert.equal(construction.operator, "point", `${id} is not a point`);
  return { x: Number(construction.inputs.x), y: Number(construction.inputs.y) };
}

/** Angle in degrees, 0 to 180, between the directions from the panel centre to two group labels. */
function between(document: SceneDocument, tag: string, a: string, b: string): number {
  const centre = pointOf(document, `${tag}_c`);
  const p = pointOf(document, a);
  const q = pointOf(document, b);
  const raw = Math.abs(Math.atan2(p.y - centre.y, p.x - centre.x) - Math.atan2(q.y - centre.y, q.x - centre.x)) * 180 / Math.PI;
  return raw > 180 ? 360 - raw : raw;
}

// What each conformer must measure between the lead groups, as drawn: eclipsed back bonds are
// turned 18 degrees to show. With a heavy group on both carbons the lead groups are those; with
// H only on one side, "eclipsed" is the 0 degree conformer.
const BOTH_HEAVY = [180, 60, 138, 18];
const ONE_OR_NONE = [60, 18];

for (const [question, names, measures, front, back] of [
  ["Draw the Newman projection of butane.", ["anti", "gauche", "eclipsed", "fully eclipsed"], BOTH_HEAVY, ["CH_3", "H", "H"], ["CH_3", "H", "H"]],
  ["Looking along the C2–C3 bond of butane, draw the anti and gauche conformations. Which is more stable?", ["anti", "gauche", "eclipsed", "fully eclipsed"], BOTH_HEAVY, ["CH_3", "H", "H"], ["CH_3", "H", "H"]],
  ["Draw the eclipsed conformation of ethane.", ["staggered", "eclipsed"], ONE_OR_NONE, ["H", "H", "H"], ["H", "H", "H"]],
  ["newman projection of ethane staggered", ["staggered", "eclipsed"], ONE_OR_NONE, ["H", "H", "H"], ["H", "H", "H"]],
  ["Draw the Newman projection of propane.", ["staggered", "eclipsed"], ONE_OR_NONE, null, null],
  ["Draw the Newman projection of ethanol.", ["staggered", "eclipsed"], ONE_OR_NONE, null, null],
] as const) {
  check(`draws every conformer, named from its dihedral: ${question}`, () => {
    const result = scene(question);
    assert.equal(result?.family, "chem_organic");
    const document = result!.document;
    const groups = conformerGroups(document);
    assert.deepEqual(groups.map((_, i) => label(document, `p${i + 1}_name`)), names);
    groups.forEach((_, i) => {
      const tag = `p${i + 1}`;
      const measured = between(document, tag, `${tag}_fl0`, `${tag}_bl0`);
      assert.ok(Math.abs(measured - measures[i]!) < 0.5, `${label(document, `${tag}_name`)} measures ${measured.toFixed(1)} degrees, not ${measures[i]}`);
      // The two other groups on each carbon sit 120 degrees from the lead and each other.
      assert.ok(Math.abs(between(document, tag, `${tag}_fl0`, `${tag}_fl1`) - 120) < 0.5, "front groups not 120 apart");
      assert.ok(Math.abs(between(document, tag, `${tag}_bl0`, `${tag}_bl2`) - 120) < 0.5, "back groups not 120 apart");
    });
    if (front && back) {
      assert.deepEqual([0, 1, 2].map((k) => label(document, `p1_fl${k}`)), front);
      assert.deepEqual([0, 1, 2].map((k) => label(document, `p1_bl${k}`)), back);
    }
    assert.equal(document.quantities.length, 0, "a Newman figure carries no quantity");
    const name = label(document, "title")!;
    assert.ok(question.toLowerCase().includes(name.toLowerCase()), `title ${name} is not the molecule named`);
  });
}

check("ethanol carries its OH on one carbon and three H on the other", () => {
  const document = scene("Draw the Newman projection of ethanol.")!.document;
  const front = [0, 1, 2].map((k) => label(document, `p1_fl${k}`)).sort();
  const back = [0, 1, 2].map((k) => label(document, `p1_bl${k}`)).sort();
  assert.deepEqual([front, back].sort(), [["H", "H", "H"], ["H", "H", "OH"]]);
});

// Declines, and nothing else takes the turn.
for (const question of [
  "Draw the Newman projection of ethene.", "Draw the Newman projection of benzene.", "Draw the Newman projection of cyclohexane.",
  "Draw the Newman projection of hexane.", "Draw the Newman projections of ethane and propane.",
  "Draw the Newman projection along the C1–C2 bond of butane.", "Draw the Newman projection of 1,2-dichloroethane.",
  "Draw the Newman projection of 2-methylpropane.",
]) {
  check(`declines, no runner up: ${question}`, () => {
    const result = scene(question);
    assert.equal(result, null, `${result?.family ?? ""} took the turn`);
  });
}

// Each decline happens at the binding, for its own reason, so the organic cue does not fire.
for (const [question, reason] of [
  ["Draw the Newman projection of 1,2-dichloroethane.", "the name does not fit one board label"],
  ["Draw the Newman projection along the C1–C2 bond of butane.", "the stem names another bond"],
  ["Draw the Newman projection of hexane.", "the bond to look along is not determined"],
  ["Draw the Newman projections of ethane and propane.", "more than one molecule is named"],
  ["Draw the Newman projection of cyclohexane.", "the molecule has a ring"],
  ["Draw the Newman projection of 2-methylpropane.", "a group the figure cannot label, or two heavy groups on one carbon"],
] as const) {
  check(`binding declines for its reason: ${question}`, () => {
    const binding = newmanBinding(question);
    assert.equal(binding.status === "declined" ? binding.reason : "bound", reason);
  });
}

// Asks about something else, or a chair or boat, never get a Newman figure.
for (const question of [
  "What is the boiling point of butane?", "Draw the structure of butane.", "Draw butane, not as a Newman projection.",
  "Draw the chair conformation of cyclohexane.", "Draw the boat conformation of cyclohexane.",
]) {
  check(`never a Newman figure: ${question}`, () => {
    assert.equal(conformerGroups(scene(question)?.document).length, 0);
  });
}

console.log(`verify-chemistry-newman: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
