/**
 * A chemistry ProblemIR names atoms in its own words: "central P atom", "Cl atoms". They
 * bind only on a certified VSEPR figure, recomputed whole from the question, and only
 * when the whole stem is a plain shape or geometry ask of its one formula. The figure is
 * the free molecule, so a stem saying anything else about it stays refused, as on dev.
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-certified-atom-binding.ts
 */
import assert from "node:assert/strict";
import { PROBLEM_IR_VERSION, type ProblemIR } from "../../src/ir/problemIR";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
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

for (const [question, label, kind] of [
  [PCL5, "central P atom", "point"],
  [PCL5, "central phosphorus atom", "point"],
  [PCL5, "The central P atom", "other"],
  [PCL5, "P atom", "other"],
  [PCL5, "phosphorus atom", "body"],
  [PCL5, "Cl atoms", "point"],
  [PCL5, "chlorine atoms", "other"],
  [PCL5, "Cl atom", "component"],
  ["shape of ClF3", "central Cl atom", "point"],
  ["What is the shape of ClF3?", "F atoms", "point"],
  ["Find the molecular geometry of BrF5.", "central Br atom", "other"],
  ["Describe the shape of the BrF5 molecule.", "Br atom", "point"],
] as Array<[string, string, Kind]>) {
  check(`binds: ${label} as ${kind} on ${question}`, () => assert.deepEqual(missing(question, [[kind, label]]), []));
}

check("the live shape binds whole", () => assert.deepEqual(missing(PCL5, [["other", "PCl5 molecule"], ["point", "central P atom"], ["point", "Cl atoms"]]), []));

// A stem with anything left over stays as on dev. The figure is the free molecule, and
// it may not be what these stems ask about. Molecule names alone behave as on dev.
for (const [question, bodies] of [
  ["What is the shape of BeF2 in the solid?", [["point", "Be atom"], ["point", "F atoms"]]],
  ["What is the geometry of GaCl3 in its dimer?", [["point", "Ga atom"], ["point", "Cl atoms"]]],
  ["What is the hybridisation of P in PCl5?", [["point", "P atom"]]],
  ["hybridisation of P in PCl5", [["point", "central P atom"]]],
  ["Find the shape and hybridisation of PCl5.", [["point", "P atom"]]],
  ["What is the geometry around nitrogen after PH3 is protonated?", [["point", "central P atom"]]],
  ["What is the shape of ClF3 after it loses one F atom?", [["point", "Cl atom"]]],
  ["What is the geometry around boron in the adduct of BF3 with PH3?", [["point", "B atom"]]],
  ["Use VSEPR to predict the shapes of ClF3 and BrF5.", [["point", "central Cl atom"]]],
  ["Compare the shapes of NH3 and NF3.", [["point", "N atoms"]]],
  ["Compare the shapes of NH3 and NF3.", [["point", "N atom"]]],
  ["geometry of PCl5 at high pressure", [["point", "P atom"]]],
  ["geometry of PCl5 in the solid", [["point", "P atom"]]],
  ["Why is the geometry of PCl5 not square pyramidal?", [["point", "P atom"]]],
] as Array<[string, Array<[Kind, string]>]>) {
  check(`left over words, stays refused: ${question}`, () => assert.equal(missing(question, bodies).length, bodies.length));
}

for (const [question, label, kind] of [
  [PCL5, "central Cl atom", "point"],
  [PCL5, "central chlorine atom", "point"],
  [PCL5, "The central Cl atom", "point"],
  [PCL5, "S atom", "point"],
  [PCL5, "central S atom", "point"],
  [PCL5, "P atoms", "point"],
  [PCL5, "central Cl atoms", "point"],
  [PCL5, "four Cl atoms", "point"],
  [PCL5, "bridging Cl atoms", "point"],
  [PCL5, "axial Cl atoms", "point"],
  [PCL5, "terminal Cl atoms", "point"],
  [PCL5, "Cl atom 1", "point"],
  [PCL5, "P+ atom", "point"],
  [PCL5, "Cl- atom", "point"],
  [PCL5, "the P atom of PCl3", "point"],
  [PCL5, "central atom", "point"],
  [PCL5, "chlorine", "point"],
  [PCL5, "cl atoms", "point"],
  [PCL5, "C atom", "point"],
  [PCL5, "Cl atoms", "solid"],
  [PCL5, "Cl atoms", "region"],
  [PCL5, "Cl atoms", "line"],
  ["shape of NO2", "NO atom", "point"],
  ["shape of ClF3", "central F atom", "point"],
] as Array<[string, string, Kind]>) {
  check(`refuses: ${label} as ${kind} on ${question}`, () => assert.equal(missing(question, [[kind, label]]).length, 1));
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

// A figure that is not exactly the fresh build is not certified, whatever changed.
const tampers: Array<[string, (document: SceneDocument) => void]> = [
  ["a label", (document) => { document.entities.find((entity) => entity.label === "P")!.label = "As"; }],
  ["a construction removed", (document) => { document.constructions.pop(); }],
  ["a reveal group trimmed", (document) => { document.revealGroups[0]!.entityIds = document.revealGroups[0]!.entityIds.slice(1); }],
  ["an annotation added", (document) => { document.annotations.push({ id: "extra", kind: "callout", targetIds: [], text: "added" }); }],
  ["the source question", (document) => { document.source.question = "geometry of PCl3"; }],
];
for (const [name, tamper] of tampers) {
  check(`a tampered figure is not certified: ${name}`, () => {
    const scene = synthesizeFamilyScene({ question: PCL5 });
    assert.ok(scene);
    tamper(scene.document);
    const label = name === "a label" ? "central As atom" : "central P atom";
    const result = checkVisualObligations(deriveVisualObligations(problem(PCL5, [["point", label]])), scene.document, PCL5);
    assert.equal(result.missing.length, 1);
  });
}

console.log(`verify-chemistry-certified-atom-binding: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
