/** Authored reaction-source/graph controls. Recorded lesson inputs stay ignored. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import "../../src/chemistry/families";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { molecularFormula, valenceOk, type Molecule } from "../../src/chemistry/organic/smiles";
import { checkVisualObligations, type VisualObligationSet } from "../../src/synthesize/visualObligations";
import { findMentions } from "../../src/chemistry/organic/namedMentions";
import { readOrganicReactionSource } from "../../src/chemistry/organic/reactionSource";
import { buildOrganicReactionFigure } from "../../src/chemistry/organic/reactionFigure";
import { addRadicalHBr, asymmetricTreeStereo, sameMolecularGraph, sourceGraphProductHolds } from "../../src/chemistry/organic/reactionGraph";
import { parseSmiles } from "../../src/chemistry/organic/smiles";
import { validateSceneQuantityAgreement, validateTurnPlanV3, type TurnPlanV3 } from "../../src/contracts/contractsV3";

interface Row { id: string; question: string; draw: boolean; kind?: string; formula?: string; centres?: number; count?: number; carbons?: number[]; name?: string; productRole?: string; countUnrequested?: boolean }
const rows = JSON.parse(fs.readFileSync(new URL("./fixtures/chemistry-source-reaction-products.json", import.meta.url), "utf8")) as Row[];
const results: unknown[] = [];
let failed = 0;
for (const row of rows) for (const [route, produce] of [["ordinary", synthesizeFamilyScene], ["last", synthesizeLastResortScene]] as const) {
  const productOnlyPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: row.question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  const roleStart = row.productRole ? row.question.indexOf(row.productRole) : -1;
  const productIR = row.countUnrequested && row.productRole ? {
    schemaVersion: "problem-ir/v1" as const, id: "source-product", question: row.question,
    facts: [{ id: "formed", kind: "given" as const, statement: row.productRole, evidence: { source: "question" as const, start: roleStart, end: roleStart + row.productRole.length, quote: row.productRole } }],
    entities: [{ id: "source_product", kind: "other" as const, label: row.productRole, evidenceFactIds: ["formed"] }],
    expressions: [], constraints: [], representationIntents: [{ id: "draw_product", kind: "conceptual" as const, entityIds: ["source_product"], evidenceFactIds: ["formed"] }], solveRequests: [],
  } : undefined;
  const actual = produce({ question: row.question, families: ["chem_organic"], ...(row.countUnrequested ? { turnPlan: productOnlyPlan } : {}), ...(productIR ? { problemIR: productIR } : {}) });
  let error: string | null = null;
  try {
    assert.equal(Boolean(actual), row.draw, `${row.id}/${route}: supported complete source`);
    if (actual) {
      const model = actual.document.source.organicReaction as { question: string; kind: string; reactant: Molecule; product: Molecule; stereo?: { centres: number[]; count: number }; carbonCounts: number[] } | undefined;
      assert.ok(model, "actual issuer must carry recomputed source model");
      assert.equal(model.question, row.question);
      assert.equal(model.kind, row.kind);
      assert.ok(valenceOk(model.product));
      assert.equal(molecularFormula(model.product, false), row.formula);
      assert.equal(model.product.smiles, undefined, "stale reactant SMILES cleared");
      assert.equal(model.product.formulaOverride, undefined, "stale formula cleared");
      assert.equal(model.product.stereo, undefined, "consumed alkene E/Z cleared");
      assert.notEqual(model.product.name, model.reactant.name, "reactant name cannot certify product");
      const texts = actual.renderScene.primitives.flatMap(mark => mark.text ? [mark.text] : []);
      for (const bond of model.product.bonds) assert.ok(actual.renderScene.primitives.some(mark => mark.entityId === `product_b${bond.index}` || mark.entityId?.startsWith(`product_b${bond.index}_`)), `actual compiled product bond ${bond.index}`);
      if (row.count !== undefined) {
        assert.equal(model.stereo?.centres.length, row.centres);
        assert.equal(model.stereo?.count, row.count);
        assert.ok(texts.includes(`N=${row.count}`), "source-derived count visible");
        assert.equal(actual.renderScene.primitives.filter(mark => mark.text === "C*").length, row.centres, "each proved centre has one visible marker");
        for (const centre of model.stereo!.centres) assert.ok(actual.renderScene.primitives.some(mark => mark.entityId === `stereocentre_${centre}` && mark.text === "C*"), "marker retains atom correspondence without invented locant");
        assert.ok(texts.some(text => text === "Br"), "actual added Br ink");
      }
      if (row.countUnrequested) {
        assert.equal(model.stereo?.centres.length, row.centres, "graph proof is independent of requested answer");
        assert.ok(actual.renderScene.primitives.some(mark => mark.text === "C*"), "verified centre remains marked");
        assert.ok(!actual.document.quantities.some(quantity => quantity.symbol === "N"), "unrequested count has no scalar authority");
        assert.ok(!texts.some(text => /^N=|stereocentres|No centre swap/.test(text)), "unrequested count has no answer ink");
        assert.ok(!actual.document.revealGroups.some(group => group.id === "reaction_answer"), "no empty count-answer group");
        assert.deepEqual(validateTurnPlanV3(productOnlyPlan, row.question).issues, [], "authored complete product-only plan is valid");
        assert.deepEqual(validateSceneQuantityAgreement(actual.document.quantities, productOnlyPlan, texts), [], "product-only complete empty numeric plan admits");
      }
      if (row.kind === "radical_hbr") {
        if (row.name && !row.carbons) {
          assert.equal(model.product.name, row.name);
          assert.ok(texts.includes(row.name), "requested radical product name is visible");
        } else assert.equal(model.product.name, undefined, "unrequested radical product name stays unset");
      }
      if (row.carbons) {
        assert.deepEqual(model.carbonCounts, row.carbons);
        assert.equal(model.product.name, row.name);
        assert.ok(texts.includes(row.name!));
        assert.ok(texts.includes(`C atoms: ${row.carbons[0]}->${row.carbons[1]}`));
        assert.ok(texts.includes("Br2/NaOH reagent"));
        const qualitativePlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: row.question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: ["hofmann_degradation"], assumptions: [], visualRequirement: "required" };
        assert.deepEqual(validateSceneQuantityAgreement(actual.document.quantities, qualitativePlan, texts), [], "graph-derived carbon counts must not assert Coulomb measurements");
        assert.ok(validateSceneQuantityAgreement([], qualitativePlan, [`${row.carbons[0]} C -> ${row.carbons[1]} C`]).length > 0, "an actual unproved Coulomb measurement must still reject");
      }
      if (row.productRole) {
        const set: VisualObligationSet = { version: "visual-obligations/v1", problemId: "source-product", obligations: [{ id: "body:product", kind: "named_body", problemEntityId: "product", problemEntityIds: ["product"], factIds: [], label: row.productRole, problemLabel: row.productRole, problemKind: "other", supported: true }] };
        assert.ok(checkVisualObligations(set, actual.document, row.question).satisfied, "external source + actual product fragment binds role");
        assert.ok(!checkVisualObligations(set, actual.document).satisfied, "no external source means exact identity only");
        const duplicate = { ...set, obligations: [...set.obligations, { ...set.obligations[0]!, id: "body:second", problemEntityId: "second", problemEntityIds: ["second"] }] };
        assert.ok(!checkVisualObligations(duplicate, actual.document, row.question).satisfied, "one product cannot fulfill two bodies");
        for (const mutation of ["bond", "free-label", "count", "reveal", "required", "anchor", "paint", ...(row.countUnrequested ? ["unexpected-answer"] : ["missing-answer"])]) {
          const forged = structuredClone(actual.document);
          if (mutation === "bond") forged.constructions.find(item => item.id === "make_product_b0")!.inputs = { start: "product_name", end: "product_name" };
          if (mutation === "free-label") { forged.entities = forged.entities.filter(entity => entity.kind === "label"); forged.constructions = forged.constructions.filter(item => item.operator === "label"); }
          if (mutation === "count") {
            const count = forged.quantities.find(quantity => quantity.symbol === "N");
            if (count) count.value = 3;
            else forged.quantities.push({ id: "reaction_stereoisomers", symbol: "N", value: 3, unit: "count" });
          }
          if (mutation === "unexpected-answer") forged.revealGroups.push({ id: "reaction_answer", entityIds: ["product_name"], dependsOn: ["computed_product"], narrationCue: "unasked answer" });
          if (mutation === "missing-answer") forged.revealGroups = forged.revealGroups.filter(group => group.id !== "reaction_answer");
          if (mutation === "reveal") forged.revealGroups = forged.revealGroups.filter(group => group.id !== "computed_product");
          if (mutation === "required") forged.requiredEntityIds = forged.requiredEntityIds.filter(id => id !== "product_name");
          if (mutation === "anchor") forged.constructions.find(item => item.id === "make_product_name_p")!.inputs.x = 100;
          if (mutation === "paint") forged.entities.find(entity => entity.id === "product_b0")!.provenance = { strokeWidth: 0 };
          forged.source.aliasProof = { verified: true, variable: row.productRole.slice(-1) };
          assert.ok(!checkVisualObligations(set, forged, row.question).satisfied, `fresh actual fragment refuses ${mutation}`);
        }
      }
    }
  } catch (caught) { failed++; error = String(caught); }
  results.push({ id: row.id, route, question: row.question, error, actual });
}
const graphChecks: Array<{ id: string; error: string | null }> = [];
for (const row of rows.filter(row => row.draw)) {
  const read = readOrganicReactionSource(row.question, findMentions(row.question));
  let error: string | null = null;
  try {
    assert.equal(read.status, "source");
    if (read.status !== "source") throw new Error("source unavailable");
    assert.ok(sourceGraphProductHolds(read.model.kind, read.model.reactant, read.model));
    for (const field of ["name", "smiles", "formulaOverride", "stereo"] as const) {
      const stale = structuredClone(read.model);
      if (field === "stereo") stale.product.stereo = { bond: 0, kind: "cis" };
      else stale.product[field] = "stale reactant";
      assert.equal(buildOrganicReactionFigure(row.question, stale), null, `stale ${field} cannot be issued`);
    }
    const wrongMap = structuredClone(read.model); wrongMap.atomMap[0] = 99;
    assert.equal(buildOrganicReactionFigure(row.question, wrongMap), null, "wrong atom correspondence cannot be issued");
    const wrongCount = structuredClone(read.model); wrongCount.carbonCounts[1] = wrongCount.carbonCounts[1]! - 1;
    assert.equal(buildOrganicReactionFigure(row.question, wrongCount), null, "stale carbon count cannot be issued");
  } catch (caught) { failed++; error = String(caught); }
  graphChecks.push({ id: row.id, error });
}
for (const [id, smiles] of [["meso-centre-exchange", "CC(Br)C(Br)C"], ["outside-complete-tree-bound", "CCCCCCCCCCC(C)CCCCCCCCCCC"]]) {
  let error: string | null = null;
  try { const molecule = parseSmiles(smiles!); assert.ok(molecule); assert.equal(asymmetricTreeStereo(molecule), null); }
  catch (caught) { failed++; error = String(caught); }
  graphChecks.push({ id: id!, error });
}
{
  let error: string | null = null;
  try {
    const first = parseSmiles("CC=C(C)CC"), reordered = parseSmiles("CCC(C)=CC");
    assert.ok(first && reordered);
    const a = addRadicalHBr(first), b = addRadicalHBr(reordered);
    assert.ok(a && b); assert.ok(sameMolecularGraph(a.product, b.product));
    assert.equal(asymmetricTreeStereo(a.product)?.count, 4); assert.equal(asymmetricTreeStereo(b.product)?.count, 4);
    assert.notDeepEqual(asymmetricTreeStereo(a.product)?.centres, asymmetricTreeStereo(b.product)?.centres, "graph indices are not chemical locants");
  } catch (caught) { failed++; error = String(caught); }
  graphChecks.push({ id: "reordered-alkene-graph-no-invented-locants", error });
}
const at = process.argv.indexOf("--out");
if (at >= 0) fs.writeFileSync(path.resolve(process.argv[at + 1]!), JSON.stringify({ rows: rows.length, checks: results.length + graphChecks.length, failed, results, graphChecks }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ checks: results.length + graphChecks.length, passed: results.length + graphChecks.length - failed, failed }));
if (failed) process.exitCode = 1;
