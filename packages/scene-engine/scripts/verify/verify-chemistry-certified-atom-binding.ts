/**
 * A chemistry ProblemIR names atoms in its own words: "central P atom", "Cl atoms". They
 * bind to an atom of that element only on a certified VSEPR figure, recomputed whole from
 * the question, so no figure draws a species it did not already certify. Each stem here
 * also has a body the figure truly lacks, in the refusal rows.
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-certified-atom-binding.ts
 */
import assert from "node:assert/strict";
import { PROBLEM_IR_VERSION, type ProblemIR } from "../../src/ir/problemIR";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";

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

type Kind = ProblemIR["entities"][number]["kind"];
function problem(question: string, bodies: Array<[Kind, string]>): ProblemIR {
  const fact = { id: "f0", kind: "requested", statement: question, evidence: { source: "question", start: 0, end: question.length, quote: question } };
  const entities = bodies.map(([kind, label], index) => ({ id: `e${index}`, kind, label, evidenceFactIds: ["f0"] }));
  return {
    schemaVersion: PROBLEM_IR_VERSION, id: "atoms", question, facts: [fact], entities, expressions: [], constraints: [],
    representationIntents: [{ id: "i0", kind: "conceptual", entityIds: entities.map((entity) => entity.id), evidenceFactIds: ["f0"], confidence: 1 }],
  } as unknown as ProblemIR;
}

function missing(question: string, bodies: Array<[Kind, string]>): string[] {
  const scene = synthesizeFamilyScene({ question });
  assert.ok(scene, "no figure");
  return checkVisualObligations(deriveVisualObligations(problem(question, bodies)), scene.document, question).missing.map((miss) => miss.message);
}

const PCL5 = "geometry of PCl5";
const SHAPES = "Use VSEPR to predict the shapes of ClF3 and BrF5.";

for (const [question, label, kind] of [
  [PCL5, "central P atom", "point"],
  [PCL5, "central phosphorus atom", "point"],
  [PCL5, "The central P atom", "other"],
  [PCL5, "P atom", "other"],
  [PCL5, "phosphorus atom", "body"],
  [PCL5, "Cl atoms", "point"],
  [PCL5, "chlorine atoms", "other"],
  [PCL5, "Cl atom", "point"],
  [SHAPES, "central Cl atom", "point"],
  [SHAPES, "central Br atom", "other"],
  [SHAPES, "F atoms", "point"],
] as Array<[string, string, Kind]>) {
  check(`binds: ${label} on ${question}`, () => assert.deepEqual(missing(question, [[kind, label]]), []));
}

check("the live shape binds whole", () => assert.deepEqual(missing(PCL5, [["other", "PCl5 molecule"], ["point", "central P atom"], ["point", "Cl atoms"]]), []));

for (const [question, label] of [
  [PCL5, "central Cl atom"],
  [PCL5, "central chlorine atom"],
  [PCL5, "S atom"],
  [PCL5, "central S atom"],
  [PCL5, "P atoms"],
  [PCL5, "four Cl atoms"],
  [PCL5, "Cl atom 1"],
  [PCL5, "P+ atom"],
  [PCL5, "Cl- atom"],
  [PCL5, "the P atom of PCl3"],
  [PCL5, "central atom"],
  [PCL5, "chlorine"],
  [SHAPES, "central F atom"],
  [SHAPES, "central S atom"],
  [SHAPES, "Cl atoms"],
] as Array<[string, string]>) {
  check(`refuses: ${label} on ${question}`, () => assert.equal(missing(question, [["point", label]]).length, 1));
}

check("each atom binds once: five Cl bind, a sixth stays missing", () => {
  const five: Array<[Kind, string]> = Array.from({ length: 5 }, () => ["point", "Cl atom"]);
  assert.deepEqual(missing(PCL5, five), []);
  assert.equal(missing(PCL5, [...five, ["point", "Cl atom"]]).length, 1);
});
check("a body the figure lacks still refuses beside bound atoms", () => {
  assert.equal(missing(PCL5, [["point", "central P atom"], ["other", "H2O molecule"]]).length, 1);
});

// Only a certified VSEPR figure binds these. Other figures keep exact binding.
for (const [question, label, family] of [
  ["lewis structure of CO2", "central carbon atom", "chem_lewis"],
  ["lewis structure of CO2", "oxygen atom", "chem_lewis"],
  ["electron configuration of iron", "iron atom", "chem_orbital"],
  ["Draw the structure of ethanol.", "central carbon atom", "chem_organic"],
] as Array<[string, string, string]>) {
  check(`not certified, stays refused: ${label} on ${question}`, () => {
    assert.equal(synthesizeFamilyScene({ question })?.family, family);
    assert.equal(missing(question, [["point", label]]).length, 1);
  });
}
check("a tampered VSEPR figure is not certified", () => {
  const scene = synthesizeFamilyScene({ question: PCL5 });
  assert.ok(scene);
  const atom = scene.document.entities.find((entity) => entity.label === "P");
  assert.ok(atom);
  atom.label = "As";
  const result = checkVisualObligations(deriveVisualObligations(problem(PCL5, [["point", "central As atom"]])), scene.document, PCL5);
  assert.equal(result.missing.length, 1);
});

console.log(`verify-chemistry-certified-atom-binding: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
