/** Complete expressions, typed shape claims and graph-proved named products. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as engine from "@heytutor/scene-engine";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { sameMolecularGraph } from "../../../../packages/scene-engine/src/chemistry/organic/reactionGraph";
import { buildOrganicReactionFigure } from "../../../../packages/scene-engine/src/chemistry/organic/reactionFigure";
import type { OrganicReactionSource } from "../../../../packages/scene-engine/src/chemistry/organic/reactionSource";
import { parseSmiles } from "../../../../packages/scene-engine/src/chemistry/organic/smiles";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import fixture from "./fixtures/source-reader-composition.json";

type Row = { id: string; question: string } & (
  | { kind: "function"; draw: boolean; expression?: string; fraction?: number }
  | { kind: "vsepr"; claim: string; admit: boolean }
  | { kind: "reaction"; draw: boolean; product?: string; smiles?: string; productRole?: string; stereoCount?: number; checkUnprovedStereoBoundary?: boolean }
);
const rows = fixture as Row[];
const results: Array<{ id: string; route: string; passed: boolean; error?: string }> = [];
const close = (actual: number, expected: number): void => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-12), `${actual} != ${expected}`);
};

async function main(): Promise<void> {
  for (const row of rows) for (const [route, produce] of [
    ["ordinary", engine.synthesizeFamilyScene], ["last", engine.synthesizeLastResortScene],
  ] as const) {
    try {
      const plan: TurnPlanV3 = {
        schemaVersion: "turn-plan/v3", question: row.question, givens: [], unknowns: [], derived: [],
        assumptions: [], lawIds: [], visualRequirement: "required",
        qualitativeClaims: row.kind === "vsepr" ? [{ id: row.id, claim: row.claim, expected: true }] : [],
      };
      assert.ok(engine.validateTurnPlanV3(plan, row.question).valid);
      const actual = produce({ question: row.question, ...(row.kind === "vsepr" ? { turnPlan: plan } : {}) });
      if (row.kind !== "vsepr") assert.equal(Boolean(actual), row.draw, "the whole request must build or decline on both public routes");
      if (!actual) { assert.notEqual(row.kind, "vsepr", "a plan claim cannot replace the correct source molecule"); results.push({ id: row.id, route, passed: true }); continue; }
      assert.equal(actual.document.source.question, row.question);
      const compiled = engine.compileSceneDocument(actual.document);
      assert.ok(compiled.ok && compiled.renderScene, "normal compilation is required");
      const texts = compiled.renderScene.primitives.flatMap(mark => mark.text ? [mark.text] : []);
      if (row.kind === "function") {
        if (row.expression) {
          assert.equal(actual.document.source.archetype, "function_graph");
          assert.notEqual(actual.document.source.sourceModel, "mathematical_fraction_decay");
          const curves = actual.document.constructions.filter(step => step.operator === "function_curve");
          assert.equal(curves.length, 1, "no unrelated or default curve may replace the source function");
          const scale = actual.document.source.displayScale as { x: number; y: number };
          assert.equal(scale.x, 1);
          assert.ok(Number.isFinite(scale.y) && scale.y > 0);
          const plotted = engine.parseMathExpression(String(curves[0]!.inputs.expression));
          const source = engine.parseMathExpression(row.expression);
          for (const x of [0, 0.5, 1, 2]) close(plotted.evaluate(x), scale.y * source.evaluate(x));
          assert.ok(!texts.some(text => /radioactiv|nuclei|half.life/i.test(text)), "a mathematical function does not invent a physical decay law");
        } else {
          assert.equal(actual.document.source.sourceModel, "mathematical_fraction_decay");
          close(Number(actual.document.quantities.find(quantity => quantity.id === "requested_fraction")?.value), row.fraction!);
        }
      } else if (row.kind === "vsepr") {
        assert.equal(engine.vseprPlanConflict(row.question, plan) === null, row.admit, "typed colon roles, polarity and molecular ownership must remain distinct");
        assert.equal(sceneSaveAdmissionFailure({ document: actual.document, question: row.question, turnPlan: plan, tier: actual.tier }) === null, row.admit, "the actual live/save guard uses the same claim truth");
        const saved = await canonicalizeTurnSceneMetadata({
          question: row.question, sceneDocument: actual.document, visualStatus: "validated", segments: [],
          sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR: null, solverResult: null,
            representationTier: actual.tier, nonMetric: actual.nonMetric, candidates: [], figureSource: "chemistry_family", diagramResultStatus: "ready" },
        });
        assert.equal(saved.ok, row.admit, "canonical persistence must accept true geometry and reject false or misowned geometry");
      } else {
        const model = actual.document.source.organicReaction as OrganicReactionSource | undefined;
        assert.ok(model, "the computed reaction operator must issue the figure");
        const expected = parseSmiles(row.smiles!);
        assert.ok(expected && sameMolecularGraph(model.product, expected), "the named product must equal an independently authored connected graph");
        assert.equal(model.productRole, row.productRole ?? row.product);
        assert.ok(texts.includes(row.product!), "the proved source name is attached to visible product geometry");
        if (!row.productRole) assert.ok(model.bindings.some(binding => binding.role === "formed product name"));
        for (const binding of model.bindings) assert.equal(row.question.slice(binding.start, binding.end), binding.text, "every binding owns its original exact span");
        assert.ok(actual.document.constructions.some(step => step.id === "make_product_b0"), "the name never substitutes for the computed bonds");
        if (row.stereoCount === undefined) {
          assert.ok(!actual.document.quantities.some(quantity => quantity.symbol === "N"), "a product-only request does not invent an unrequested stereoisomer answer");
        } else {
          assert.equal(model.requestedStereoCount, true);
          assert.equal(model.stereo?.count, row.stereoCount);
          assert.equal(actual.document.quantities.find(quantity => quantity.id === "reaction_stereoisomers")?.value, row.stereoCount);
          assert.ok(texts.includes(`N=${row.stereoCount}`), "the proved count must actually be visible");
        }
        if (row.checkUnprovedStereoBoundary) {
          assert.equal(model.kind, "hofmann");
          assert.equal(model.stereo, undefined);
          assert.equal(buildOrganicReactionFigure(row.question, { ...model, requestedStereoCount: true }), null, "the figure cannot silently omit an unproved requested count");
          const forged = { centres: [], count: 99, rootedTrees: [] };
          assert.equal(buildOrganicReactionFigure(row.question, { ...model, requestedStereoCount: true, stereo: forged }), null, "a cached count cannot replace a fresh product graph proof");
          assert.equal(buildOrganicReactionFigure(row.question, { ...model, stereo: forged }), null, "a cached proof must be checked even without an explicit count request");
        }
      }
      results.push({ id: row.id, route, passed: true });
    } catch (error) {
      results.push({ id: row.id, route, passed: false, error: error instanceof Error ? error.stack : String(error) });
    }
  }
  const report = { scope: "The three actual review wordings and changed source/claim/graph controls through both public routes; VSEPR also through real live/save admission and canonical persistence.",
    passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, results };
  const out = process.argv.indexOf("--out");
  if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  for (const row of results.filter(row => !row.passed)) console.error(`FAIL ${row.id}/${row.route}: ${row.error}`);
  console.log(`verify-source-reader-composition: ${report.passed} passed, ${report.failed} failed`);
  if (report.failed) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
