/**
 * A chemistry ProblemIR that names "SF4 molecule" binds to the drawn SF4,
 * not to a concept label, and an obligation for a species the figure does
 * not draw still refuses.
 *
 *   live     the recorded b804afdf shape (kind other, label "SF4 molecule"
 *            and "XeF4 molecule") draws both molecules on a synthetic stem.
 *   missing  the same figure plus an H2O obligation is refused, and the miss
 *            is missing_named_body.
 *   ion      "SF4 ion" is not the drawn neutral SF4 and still refuses.
 *   charge   "Na ion", "Na+", "SO4" never bind a drawn Na atom or sulfate;
 *            only "molecule", "compound" and articles are wrappers.
 *   others   maths and physics names keep main's exact binding ("A B" is
 *            never point B); a hand label is not a certified species.
 *   certified  on real VSEPR figures the wrapper and a written charge bind
 *            ("NH4+ ion"), and a lone pair obligation still binds.
 *   mutations  binder off, and the wrapper strip moved into the generic
 *            formula identity, each turn a row red.
 *   mutation dropping the molecule wrapper turns the live row red.
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROBLEM_IR_VERSION, type ProblemIR } from "../../src/ir/problemIR";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations, visualObligationIssues } from "../../src/synthesize/visualObligations";
import type { SceneDocument } from "../../src/types";

const STEM = "Use VSEPR to predict the shapes of SF4 and XeF4.";

function quote(text: string): ProblemIR["facts"][number]["evidence"] {
  const start = STEM.indexOf(text);
  if (start < 0) throw new Error(`missing quote ${text}`);
  return { source: "question", start, end: start + text.length, quote: text };
}

function problem(bodies: Array<{ id: string; kind: ProblemIR["entities"][number]["kind"]; label: string }>): ProblemIR {
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: "b804",
    question: STEM,
    facts: [
      { id: "fSF4", kind: "requested", statement: "shape of SF4", evidence: quote("SF4") },
      { id: "fXeF4", kind: "given", statement: "shape of XeF4", evidence: quote("XeF4") },
    ],
    entities: bodies.map((body) => ({ ...body, evidenceFactIds: body.id.startsWith("xe") ? ["fXeF4"] : ["fSF4"] })),
    expressions: [],
    constraints: [],
    representationIntents: [{
      id: "iShapes",
      kind: "conceptual",
      entityIds: bodies.map((body) => body.id),
      evidenceFactIds: ["fSF4"],
    }],
  };
}

const LIVE = problem([
  { id: "sf4", kind: "other", label: "SF4 molecule" },
  { id: "xef4", kind: "other", label: "XeF4 molecule" },
]);
const MISSING = problem([
  { id: "sf4", kind: "other", label: "SF4 molecule" },
  { id: "xef4", kind: "other", label: "XeF4 molecule" },
  { id: "water", kind: "other", label: "H2O molecule" },
]);

function labelsOf(document: { entities: Array<{ label?: string | null }> }): string[] {
  return document.entities.flatMap((entity) => entity.label ? [entity.label] : []);
}

const failures: string[] = [];
let passed = 0;
async function check(id: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); passed++; }
  catch (error) { failures.push(id); console.log(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`); }
}

await check("live-draws-both", () => {
  const scene = synthesizeFamilyScene({ question: STEM, problemIR: LIVE });
  assert.ok(scene, "the recorded IR shape must draw");
  assert.equal(scene.family, "chem_vsepr");
  const labels = labelsOf(scene.document).join(" ");
  assert.match(labels, /SF_4/);
  assert.match(labels, /XeF_4/);
  assert.equal(deriveVisualObligations(LIVE).obligations.length, 2);
});

await check("missing-species-refuses", () => {
  assert.equal(synthesizeFamilyScene({ question: STEM, problemIR: MISSING }), null);
  const unconstrained = synthesizeFamilyScene({ question: STEM, problemIR: null });
  assert.ok(unconstrained);
  const issues = visualObligationIssues(MISSING, unconstrained.document, STEM);
  assert.ok(issues.some((issue) => issue.code === "missing_named_body"), issues.map((issue) => issue.code).join(","));
  assert.ok(issues.some((issue) => /H2O/.test(issue.message)), issues.map((issue) => issue.message).join("; "));
});

await check("ion-wrapper-keeps-charge", () => {
  // "SF4 ion" is not the neutral SF4 the figure draws; dropping "ion" would
  // bind it anyway, so a bare "Na ion" could bind a drawn Na atom.
  const ION = problem([
    { id: "sf4", kind: "other", label: "SF4 ion" },
    { id: "xef4", kind: "other", label: "XeF4 molecule" },
  ]);
  assert.equal(synthesizeFamilyScene({ question: STEM, problemIR: ION }), null);
  const unconstrained = synthesizeFamilyScene({ question: STEM, problemIR: null });
  assert.ok(unconstrained);
  const issues = visualObligationIssues(ION, unconstrained.document, STEM);
  assert.ok(issues.some((issue) => issue.code === "missing_named_body" && /SF4 ion/.test(issue.message)), issues.map((issue) => issue.message).join("; "));
});

/** A hand-made figure: only kinds and labels matter to body binding. */
function handFigure(question: string, entities: Array<{ id: string; kind: string; label: string }>): SceneDocument {
  return {
    source: { question },
    entities: entities.map((entity) => ({ ...entity })),
    requiredEntityIds: entities.map((entity) => entity.id),
    constructions: [],
    assertions: [],
    revealGroups: [{ id: "all", entityIds: entities.map((entity) => entity.id), dependsOn: [], narrationCue: "all" }],
    quantities: [],
  } as unknown as SceneDocument;
}

function bareProblem(labels: string[]): ProblemIR {
  const entities = labels.map((label, index) => ({ id: `e${index}`, kind: "other" as const, label, evidenceFactIds: [] }));
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: "charge",
    facts: [],
    entities,
    expressions: [],
    constraints: [],
    representationIntents: [{ id: "i0", kind: "conceptual", entityIds: entities.map((entity) => entity.id), evidenceFactIds: [] }],
  } as unknown as ProblemIR;
}

// A species name binds only the drawn species with the same formula and the
// same charge. Words that carry chemistry (ion, cation, anion, radical, a
// charge) are kept and must match; only "molecule", "compound" and the
// articles are wrappers.
const CHARGE_ROWS: Array<{ id: string; drawn: string; wanted: string; binds: boolean }> = [
  { id: "na-ion-vs-na-atom", drawn: "Na", wanted: "Na ion", binds: false },
  { id: "na-plus-vs-na-atom", drawn: "Na", wanted: "Na+", binds: false },
  { id: "na-cation-vs-na-atom", drawn: "Na", wanted: "Na cation", binds: false },
  { id: "the-na-ion-vs-na-atom", drawn: "Na", wanted: "the Na ion", binds: false },
  { id: "cl-anion-vs-cl-atom", drawn: "Cl", wanted: "Cl anion", binds: false },
  { id: "oh-radical-vs-hydroxide", drawn: "OH^(-)", wanted: "OH radical", binds: false },
  { id: "so4-vs-sulfate", drawn: "SO_4^(2-)", wanted: "SO4", binds: false },
  { id: "sulfate-vs-so4", drawn: "SO_4", wanted: "SO4^2-", binds: false },
  { id: "so4-molecule-vs-sulfate", drawn: "SO_4^(2-)", wanted: "SO4 molecule", binds: false },
  // A hand-written label is not a certified figure: the wrapper is read only
  // against a species a VSEPR figure drew (rows below).
  { id: "sf4-molecule-vs-sf4-label", drawn: "SF_4", wanted: "SF4 molecule", binds: false },
  { id: "a-co2-molecule-vs-co2-label", drawn: "CO_2", wanted: "a CO2 molecule", binds: false },
  // Main's exact formula spelling still binds.
  { id: "na-plus-vs-na-plus", drawn: "Na^(+)", wanted: "Na+", binds: true },
];
for (const row of CHARGE_ROWS) {
  await check(`charge/${row.id}`, () => {
    const document = handFigure("Chemistry species binding probe.", [{ id: "species", kind: "label", label: row.drawn }]);
    const result = checkVisualObligations(deriveVisualObligations(bareProblem([row.wanted])), document);
    assert.equal(result.missing.length === 0, row.binds, `${row.wanted} against drawn ${row.drawn}: ${result.missing.map((miss) => miss.message).join("; ")}`);
  });
}

// Names in other subjects keep main's exact binding: a point "A" is not an
// article and "molecules" or "compound" never wraps a point or a component.
const OTHER_SUBJECT_ROWS: Array<{ id: string; kind: string; drawn: string; problemKind: ProblemIR["entities"][number]["kind"]; wanted: string; binds: boolean }> = [
  { id: "body-A-B-vs-point-B", kind: "point", drawn: "B", problemKind: "body", wanted: "A B", binds: false },
  { id: "other-A-B-vs-point-B", kind: "point", drawn: "B", problemKind: "other", wanted: "A B", binds: false },
  { id: "line-A-B-vs-segment-B", kind: "segment", drawn: "B", problemKind: "line", wanted: "A B", binds: false },
  { id: "component-A-R2-vs-R2", kind: "resistor", drawn: "R2", problemKind: "component", wanted: "A R2", binds: false },
  { id: "body-P-molecules-vs-point-P", kind: "point", drawn: "P", problemKind: "body", wanted: "P molecules", binds: false },
  { id: "body-F-compound-vs-F", kind: "point", drawn: "F", problemKind: "body", wanted: "F compound", binds: false },
  { id: "line-A-B-vs-segment-AB", kind: "segment", drawn: "A B", problemKind: "line", wanted: "A B", binds: true },
];
for (const row of OTHER_SUBJECT_ROWS) {
  await check(`other-subject/${row.id}`, () => {
    const document = handFigure("Geometry binding probe.", [{ id: "body", kind: row.kind, label: row.drawn }]);
    const ir = bareProblem([row.wanted]);
    ir.entities[0]!.kind = row.problemKind;
    const result = checkVisualObligations(deriveVisualObligations(ir), document);
    assert.equal(result.missing.length === 0, row.binds, `${row.wanted} against drawn ${row.drawn}: ${result.missing.map((miss) => miss.message).join("; ")}`);
  });
}

// Certified VSEPR figures: the wrapper and a written charge bind the drawn
// species; the lone pairs stay free for their own obligation.
const CERTIFIED_ROWS: Array<{ id: string; stem: string; wanted: string[]; binds: boolean; bodies?: number[] }> = [
  { id: "nh4-plus-ion", stem: "What is the shape of NH4+?", wanted: ["NH4+ ion"], binds: true },
  { id: "a-co2-molecule", stem: "What is the shape of CO2?", wanted: ["a CO2 molecule"], binds: true },
  { id: "the-sf4-compound", stem: "What is the shape of SF4?", wanted: ["The SF4 compound"], binds: true },
  { id: "water-molecule-and-lone-pair", stem: "What is the shape of H2O?", wanted: ["water molecule", "lone pair"], binds: true, bodies: [1] },
  { id: "lone-pair-then-water-molecule", stem: "What is the shape of H2O?", wanted: ["lone pair", "water molecule"], binds: true, bodies: [0] },
  { id: "sf4-molecule-and-lone-pair", stem: "What is the shape of SF4?", wanted: ["SF4 molecule", "lone pair"], binds: true, bodies: [1] },
  { id: "lone-pair-then-sf4-molecule", stem: "What is the shape of SF4?", wanted: ["lone pair", "SF4 molecule"], binds: true, bodies: [0] },
  { id: "nh4-ion-without-charge", stem: "What is the shape of NH4+?", wanted: ["NH4 ion"], binds: false },
  { id: "nh3-molecule-vs-nh4-plus", stem: "What is the shape of NH4+?", wanted: ["NH3 molecule"], binds: false },
  { id: "A-SF4-capital-a", stem: "What is the shape of SF4?", wanted: ["A SF4"], binds: false },
];
for (const row of CERTIFIED_ROWS) {
  await check(`certified/${row.id}`, () => {
    const scene = synthesizeFamilyScene({ question: row.stem, problemIR: null });
    assert.ok(scene && scene.family === "chem_vsepr", `guard: ${row.stem} draws chem_vsepr`);
    const ir = bareProblem(row.wanted);
    // A lone pair obligation is a body, as main binds it.
    for (const index of row.bodies ?? []) ir.entities[index]!.kind = "body";
    const result = checkVisualObligations(deriveVisualObligations(ir), scene.document, row.stem);
    assert.equal(result.missing.length === 0, row.binds, `${row.wanted.join(" + ")} on ${row.stem}: ${result.missing.map((miss) => miss.message).join("; ")}`);
  });
}

const source = fileURLToPath(new URL("../../src/synthesize/visualObligations.ts", import.meta.url));
const original = readFileSync(source, "utf8");
const ANCHOR = `.replace(/\\s+(?:molecules?|compounds?|species)$/i, "")`;
await check("mutation/wrapper", async () => {
  assert.ok(original.includes(ANCHOR), "mutation anchor is missing");
  const path = source.replace(/visualObligations\.ts$/, `visualObligations.mutant-${process.pid}.ts`);
  writeFileSync(path, original.replace(ANCHOR, ""));
  try {
    const mutant = await import(path) as { checkVisualObligations: typeof import("../../src/synthesize/visualObligations").checkVisualObligations; deriveVisualObligations: typeof deriveVisualObligations };
    const unconstrained = synthesizeFamilyScene({ question: STEM, problemIR: null });
    assert.ok(unconstrained);
    const result = mutant.checkVisualObligations(mutant.deriveVisualObligations(LIVE), unconstrained.document, STEM);
    assert.ok(result.missing.length > 0, "main's wrapper-less labels must miss");
  } finally {
    rmSync(path, { force: true });
  }
});

await check("mutation/binder-off", async () => {
  const CALL = "    const species = bindCertifiedSpecies(molecule, document, obligation, consumed);\n";
  assert.ok(original.split(CALL).length === 2, "binder call anchor must occur once");
  const path = source.replace(/visualObligations\.ts$/, `visualObligations.mutant-binder-${process.pid}.ts`);
  writeFileSync(path, original.replace(CALL, "    const species = null as string | null;\n"));
  try {
    const mutant = await import(path) as { checkVisualObligations: typeof checkVisualObligations; deriveVisualObligations: typeof deriveVisualObligations };
    const unconstrained = synthesizeFamilyScene({ question: STEM, problemIR: null });
    assert.ok(unconstrained);
    assert.ok(mutant.checkVisualObligations(mutant.deriveVisualObligations(LIVE), unconstrained.document, STEM).missing.length > 0, "the live row must need the binder");
  } finally {
    rmSync(path, { force: true });
  }
});

await check("mutation/generic-wrapper", async () => {
  // Main's mistake in review: the wrapper strip inside the generic formula
  // identity, which every subject uses. It binds "A B" to a point B.
  const FROM = "  const key = value\n    .trim()\n    .replace(/\\s+/g, \"\")";
  assert.ok(original.split(FROM).length === 2, "formulaIdentity anchor must occur once");
  const path = source.replace(/visualObligations\.ts$/, `visualObligations.mutant-generic-${process.pid}.ts`);
  writeFileSync(path, original.replace(FROM, "  const key = value\n    .trim()\n    .replace(/^(?:the|a|an)\\s+/i, \"\")\n    .replace(/\\s+/g, \"\")"));
  try {
    const mutant = await import(path) as { checkVisualObligations: typeof checkVisualObligations; deriveVisualObligations: typeof deriveVisualObligations };
    const ir = bareProblem(["A B"]);
    ir.entities[0]!.kind = "body";
    const document = handFigure("Geometry binding probe.", [{ id: "body", kind: "point", label: "B" }]);
    assert.equal(mutant.checkVisualObligations(mutant.deriveVisualObligations(ir), document).missing.length, 0, "the mutant must bind A B to point B");
  } finally {
    rmSync(path, { force: true });
  }
});

console.log(`verify-chemistry-species-obligations: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
