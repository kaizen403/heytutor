/**
 * Source-complete VSEPR molecules, independently checked structural membership,
 * and the narrow atom/body/connection obligation bridge.
 *
 * These are new source-wording oracles, not recovered original ProblemIRs.
 * Native presentation/save/reopen checks live in the tutor gate.
 */
import { strict as assert } from "node:assert";
import { SceneBuilder } from "../../src/archetypes/document";
import { buildVseprFigure, buildVseprScene } from "../../src/chemistry/vsepr";
import { verifiedVseprStructure } from "../../src/chemistry/vseprStructure";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import type { SceneDocument } from "../../src/types";

let passed = 0;
const failures: string[] = [];
function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const question = "What is the shape of SF4, and where does its lone pair go? Keep the explanation brief, please.";
const figure = buildVseprFigure(question, [], false);
assert.ok(figure, "The exact source question must resolve before mutation controls run");
const canonical = figure.document;

function labels(document: SceneDocument): string[] {
  return document.entities.flatMap((entity) => entity.label ? [entity.label] : []);
}

test("exact SF4 source has five atoms, four bonds and one electron pair", () => {
  const witness = verifiedVseprStructure(canonical, question);
  assert.ok(witness);
  assert.equal(witness.structures.length, 1);
  const structure = witness.structures[0]!;
  assert.equal(structure.atomIds.length, 5);
  assert.equal(structure.bonds.length, 4);
  assert.equal(structure.electronIds.length, 2);
  assert.equal(labels(canonical).filter((label) => label === "F").length, 4);
  assert.ok(labels(canonical).includes("S"));
  assert.ok(labels(canonical).includes("SF_4"));
  assert.ok(!labels(canonical).some((label) => /°|\b(?:ideal|quoted|inequality)\b/.test(label)));
  assert.ok(compileSceneDocument(canonical).ok);
});

test("two supported requested species retain both complete molecules", () => {
  const source = "Show the molecular shapes of SF4 and CH4.";
  const result = buildVseprFigure(source, [], false);
  assert.ok(result);
  assert.equal(result.structures.length, 2);
  assert.deepEqual(result.structures.map((structure) => structure.atomIds.length), [5, 5]);
  assert.ok(labels(result.document).includes("SF_4"));
  assert.ok(labels(result.document).includes("CH_4"));
  assert.ok(verifiedVseprStructure(result.document, source));
  assert.ok(compileSceneDocument(result.document).ok);
});

for (const source of [
  "Show the molecular shapes of SF4 and SiO2.",
  "Show the shapes of SF4 and KrF6.",
  "Show the molecular shapes of SF4 and XeF5-.",
  "Draw the molecular shapes of SF4 and [Ni(CN)4]2-.",
  "Compare the shapes of SF4 and water.",
  "Show the shape of SF4. Also draw SiO2.",
  "Show the shape of SF4. Also draw the coordination complex [Ni(CN)4]2-.",
  "Show the shapes of water and SF4.",
  "Show the shape of water. Also show SF4.",
  "Show the shapes of SF4 together with water.",
  "Show the shapes of sulfur dioxide and NH3.",
  "Show the shapes of SF4 together with phosphine.",
  "Draw the shape of ozone; also show BF3.",
  "Compare carbon dioxide with XeF4.",
  "Sketch BF3 and nitrogen trifluoride.",
]) {
  test(`closed requested set never draws only its supported member: ${source}`, () => {
    assert.equal(buildVseprScene(source, [], false), null,
      "An unresolved member must decline the complete request rather than disappear");
  });
}

for (const source of [
  question,
  "What shape is SF4? Show where the lone pair sits.",
  "Draw the molecular structure of SF4 and mark its lone pair.",
  "What is the shape of NH3? Show its bonds and lone pair.",
  "Draw the shape of H2O, including its lone pairs.",
  "What is the molecular shape of CO2? Show the atoms and bonds.",
  "Draw the molecular structure and shape of CH4.",
  "What is the shape of XeF4? Include its lone pairs.",
]) {
  test(`natural structural request remains available: ${source}`, () => {
    const result = buildVseprFigure(source, [], false);
    assert.ok(result);
    assert.equal(result.structures.length, 1);
  });
}

test("shape-word answer options do not become extra molecule requests", () => {
  const source = "What is the shape of SF4? (A) tetrahedral (B) seesaw (C) square planar (D) linear";
  const result = buildVseprFigure(source, [], false);
  assert.ok(result);
  assert.equal(result.structures.length, 1);
  assert.ok(labels(result.document).includes("SF_4"));
  assert.ok(labels(result.document).includes("see-saw"));
});

test("an explicit angle request retains its numeric claim", () => {
  const source = "Show the shape and bond angle of H2O.";
  const result = buildVseprFigure(source, [], false);
  assert.ok(result);
  assert.ok(labels(result.document).includes("104.5°"));
});

test("bare central-atom mentions are not unsupported molecule members", () => {
  const source = "Show the shape of SF4, with S at the center and its lone pair.";
  const result = buildVseprFigure(source, [], false);
  assert.ok(result);
  assert.equal(result.structures.length, 1);
  assert.ok(labels(result.document).includes("SF_4"));
});

const structure = figure.structures[0]!;
function mutate(name: string, change: (document: SceneDocument) => void): void {
  test(`witness refuses ${name}`, () => {
    const changed = structuredClone(canonical);
    change(changed);
    assert.equal(verifiedVseprStructure(changed, question), null);
  });
}

mutate("missing atom", (document) => {
  document.entities = document.entities.filter((entity) => entity.id !== structure.atomIds[1]);
});
mutate("changed atom identity", (document) => {
  document.entities.find((entity) => entity.id === structure.atomIds[1])!.label = "Cl";
});
mutate("changed formula charge", (document) => {
  document.entities.find((entity) => entity.id === structure.formulaId)!.label = "SF_4^(+)";
});
mutate("missing bond", (document) => {
  document.constructions = document.constructions.filter((construction) => !construction.outputs.includes(structure.bondIds[0]!));
});
mutate("displaced lone-pair electron", (document) => {
  const point = document.constructions.find((construction) => construction.outputs.includes(structure.electronIds[0]!));
  assert.ok(point);
  assert.equal(typeof point.inputs.x, "number");
  point.inputs.x = Number(point.inputs.x) + 0.5;
});
mutate("extra numeric annotation", (document) => {
  document.annotations.push({ id: "forgedPressure", kind: "callout", targetIds: [], text: "pressure = 5 N" });
});
mutate("extra numeric quantity", (document) => {
  document.quantities.push({ id: "forgedForce", symbol: "F", value: 5, unit: "N" });
});
mutate("removed required atom", (document) => {
  document.requiredEntityIds = document.requiredEntityIds.filter((id) => id !== structure.atomIds[1]);
});
mutate("removed reveal atom", (document) => {
  for (const group of document.revealGroups) group.entityIds = group.entityIds.filter((id) => id !== structure.atomIds[1]);
});
mutate("edited teaching schedule", (document) => {
  document.teachingTimeline[0]!.narrationIntent = "Draw an unrelated square planar molecule.";
});
mutate("wrong source question", (document) => {
  document.source.question = "What is the shape of XeF4?";
});

test("missing external source grants no structural witness", () => {
  assert.equal(verifiedVseprStructure(canonical), null);
});
test("a forged membership flag grants no foreign figure authority", () => {
  const builder = new SceneBuilder(question, "A force arrow is not an SF4 molecule", "force");
  const origin = builder.point("origin", { x: 0, y: 0 }, "force origin");
  builder.vector("force", origin, { direction: { x: 1, y: 0 }, length: 2 }, "force", "F");
  const foreign = builder.build();
  foreign.source = { ...foreign.source, chemistryFamily: "chem_vsepr", structuralAtomIds: ["force"] };
  assert.equal(verifiedVseprStructure(foreign, question), null);
});
test("physics force wording is not a molecular witness", () => {
  const source = "A charge is acted on by a force F = 4 N. Show the force vector.";
  const foreign = structuredClone(canonical);
  foreign.source.question = source;
  assert.equal(verifiedVseprStructure(foreign, source), null);
});

function moleculeProblem(extraFluorine = false): ProblemIR {
  const start = question.indexOf("SF4");
  const evidence = { source: "question" as const, start, end: start + 3, quote: "SF4" };
  const fluorineIds = ["fluorine1", "fluorine2", "fluorine3", "fluorine4", ...(extraFluorine ? ["fluorine5"] : [])];
  return {
    schemaVersion: "problem-ir/v1", id: "sf4Structure", question,
    facts: [{ id: "species", kind: "given", statement: "The specified species is SF4.", evidence }],
    entities: [
      { id: "molecule", kind: "body", label: "SF4", evidenceFactIds: ["species"] },
      { id: "sulfur", kind: "body", label: "S", evidenceFactIds: ["species"] },
      ...fluorineIds.map((id) => ({ id, kind: "component" as const, label: "F", evidenceFactIds: ["species"] })),
    ],
    expressions: [],
    constraints: fluorineIds.map((id) => ({ id: `bond_${id}`, kind: "connected" as const, entityIds: ["sulfur", id], evidenceFactIds: ["species"] })),
    representationIntents: [{ id: "picture", kind: "conceptual", entityIds: ["molecule", "sulfur", ...fluorineIds], evidenceFactIds: ["species"] }],
    solveRequests: [],
  };
}

test("schema-valid source IR maps full formula, all atoms and actual S-F bonds", () => {
  const problem = moleculeProblem();
  const validated = validateProblemIR(problem, question);
  assert.ok(validated.valid && validated.problem, JSON.stringify(validated.issues));
  const result = checkVisualObligations(deriveVisualObligations(validated.problem), canonical, question);
  assert.ok(result.satisfied, JSON.stringify(result.missing));
});
test("atom multiplicity cannot reuse one of four F symbols a fifth time", () => {
  const problem = moleculeProblem(true);
  const result = checkVisualObligations(deriveVisualObligations(problem), canonical, question);
  assert.equal(result.satisfied, false);
  assert.ok(result.missing.some((miss) => miss.code === "missing_named_body"));
});
test("two fluorine ligands do not acquire an F-F chemical bond", () => {
  const problem = moleculeProblem();
  problem.constraints.push({ id: "forgedFtoF", kind: "connected", entityIds: ["fluorine1", "fluorine2"], evidenceFactIds: ["species"] });
  const result = checkVisualObligations(deriveVisualObligations(problem), canonical, question);
  assert.equal(result.satisfied, false);
  assert.ok(result.missing.some((miss) => miss.code === "missing_connection"));
});
test("a shape caption cannot stand in for another named physical body", () => {
  const problem = moleculeProblem();
  problem.entities.push({ id: "captionBody", kind: "body", label: "see-saw", evidenceFactIds: ["species"] });
  problem.representationIntents[0]!.entityIds.push("captionBody");
  const result = checkVisualObligations(deriveVisualObligations(problem), canonical, question);
  assert.equal(result.satisfied, false);
  assert.ok(result.missing.some((miss) => miss.code === "missing_named_body"));
});
test("formula labels do not become a solid or region witness", () => {
  for (const kind of ["solid", "region", "field"] as const) {
    const problem = moleculeProblem();
    problem.entities[0]!.kind = kind;
    assert.equal(checkVisualObligations(deriveVisualObligations(problem), canonical, question).satisfied, false);
  }
});
test("a stated physical dimension still must be carried by the scene", () => {
  const problem = moleculeProblem();
  const source = "Show the shape of SF4. Also retain the stated 150 degree reference angle.";
  problem.question = source;
  problem.facts[0]!.evidence = { source: "question", start: source.indexOf("SF4"), end: source.indexOf("SF4") + 3, quote: "SF4" };
  const start = source.indexOf("150 degree");
  problem.facts.push({
    id: "angleFact", kind: "given", statement: "The stated reference angle is 150 degrees.",
    evidence: { source: "question", start, end: start + "150 degree".length, quote: "150 degree" },
  });
  problem.expressions.push({ id: "physicalAngle", valueType: "scalar", root: { kind: "number", value: 150 }, evidenceFactIds: ["angleFact"] });
  const validated = validateProblemIR(problem, source);
  assert.ok(validated.valid && validated.problem, JSON.stringify(validated.issues));
  const resultFigure = buildVseprFigure(source, [], false);
  assert.ok(resultFigure);
  const result = checkVisualObligations(deriveVisualObligations(validated.problem), resultFigure.document, source);
  assert.equal(result.satisfied, false);
  assert.ok(result.missing.some((miss) => miss.code === "missing_given_dimension"));
});

console.log(`verify-vsepr-source-structure: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
