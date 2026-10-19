/** Source computations and public physics producers retain the original
 * quantities, requested result, real units, and terminal refusal semantics. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { detectArchetype } from "../../src/archetypes/detect";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { isChemistryStem } from "../../src/chemistry/classify";
import { compileSceneDocument } from "../../src/compile/compiler";
import { readNeutralDecaySource } from "../../src/physics/neutralDecaySource";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";
import fixture from "./fixtures/chemistry-f4-neutral-source.json";
interface Gold {
  id: string; group: string; question: string; kind?: string; draw?: boolean; expectedDraw?: boolean; chemistry?: boolean;
  expectedSourceOutcome?: string; halfLife?: number; unit?: string; elapsed?: number; fraction?: number;
  physical?: { workFunctionEV?: number; photonEnergyEV?: number; kineticEV?: number | null; wavelengthM?: number; productJS?: number; above?: boolean };
  scientificGold?: { photonEnergyEV?: number; maximumKineticEV?: number; wavelengthNm?: number };
}
const close = (actual: number, expected: number): void => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-12), `${actual} != ${expected}`);
};
function paint(document: SceneDocument, question: string): string[] {
  assert.equal(document.source.question, question);
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, "normal compiler must accept the entire document");
  return compiled.renderScene.primitives.flatMap(mark => mark.text ? [mark.text] : []);
}
const rows = (fixture as Gold[]).map(gold => {
  try {
    if (gold.group === "subject") {
      assert.equal(isChemistryStem(gold.question), gold.chemistry);
    } else {
      const source = readRadiationSource(gold.question);
      const ordinary = synthesizeFamilyScene({ question: gold.question });
      const lastResort = synthesizeLastResortScene({ question: gold.question });
      if (gold.group === "decay") {
        assert.equal(readNeutralDecaySource(gold.question).status, gold.expectedDraw ? "source" : "declined");
        for (const result of [ordinary, lastResort]) {
          assert.equal(!!result, gold.expectedDraw);
          if (!result) continue;
          assert.equal(result.family, "analytic_curve");
          assert.equal(result.document.source.sourceModel, "mathematical_fraction_decay");
          assert.equal(result.document.source.chemistryFamily, undefined);
          assert.equal(result.document.source.archetype, undefined);
          const text = paint(result.document, gold.question);
          assert.ok(text.some(label => label.includes(`${gold.elapsed} ${gold.unit}`)), "requested time is actual paint");
          assert.ok(text.some(label => label.includes(String(gold.fraction))), "requested fraction is actual paint");
          close(Number(result.document.quantities.find(quantity => quantity.id === "half_life")?.value), gold.halfLife!);
          close(Number(result.document.quantities.find(quantity => quantity.id === "requested_time")?.value), gold.elapsed!);
          close(Number(result.document.quantities.find(quantity => quantity.id === "requested_fraction")?.value), gold.fraction!);
          assert.equal(result.document.quantities.find(quantity => quantity.id === "half_life")?.unit, gold.unit);
          assert.equal(result.document.assertions.filter(check => check.predicate === "function_value" && check.severity === "fatal").length, 4);
        }
      } else if (gold.group === "polarity") {
        if (gold.expectedSourceOutcome) assert.equal(source.status, gold.expectedSourceOutcome);
        for (const result of [ordinary, lastResort]) {
          assert.equal(!!result, gold.expectedDraw);
          if (result) { assert.equal(result.document.source.archetype, "double_slit"); paint(result.document, gold.question); }
        }
      } else if (gold.group === "radiation") {
        const direct = buildAtomicRadiationScene(gold.question, [], false);
        for (const document of [direct, ordinary?.document, lastResort?.document]) {
          assert.equal(!!document, gold.draw);
          if (document) paint(document, gold.question);
        }
        if (gold.draw) {
          assert.equal(source.status, "source");
          if (source.status !== "source") throw new Error("missing source");
          const model = source.model, physical = gold.physical!;
          for (const binding of model.bindings) {
            const { span, text } = binding.reading.source;
            assert.equal(gold.question.slice(span.start, span.end), text, "exact original source span");
          }
          if (model.kind === "photoelectric") {
            close(model.workFunctionEV, physical.workFunctionEV!); close(model.photonEnergyEV, physical.photonEnergyEV!);
            if (physical.kineticEV === null) assert.equal(model.kineticEV, null);
            else close(model.kineticEV!, physical.kineticEV!);
          } else if (model.kind === "matter_wave") {
            close(model.wavelengthM, physical.wavelengthM!);
            for (const result of [ordinary, lastResort]) {
              const document = result!.document;
              if (document.source.sourceModel === "particle_radiation") {
                close(Number(document.quantities.find(quantity => quantity.id === "lambda")?.value), physical.wavelengthM!);
                close(Number(document.quantities.find(quantity => quantity.id === "p")?.value), model.momentumKgMS);
              }
              if (model.statedMomentum && model.statedSpeedMS !== null) {
                const text = paint(document, gold.question);
                assert.ok(text.includes("using stated p") && text.some(label => label.startsWith("nominal p!=")));
                assert.ok(text.some(label => label.startsWith("p=")) && text.some(label => label.startsWith("v=")));
              }
            }
          } else { close(model.productJS, physical.productJS!); assert.equal(model.holds, physical.above); }
        } else assert.equal(source.status, "declined");
      } else {
        if (gold.id.startsWith("young-only")) {
          assert.equal(detectArchetype(gold.question)?.id, "double_slit");
          for (const result of [ordinary, lastResort]) {
            assert.ok(result, "background/excluded photoelectric state cannot veto requested Young diagram");
            assert.equal(result.document.source.archetype, "double_slit"); paint(result.document, gold.question);
          }
        } else if (gold.expectedSourceOutcome === "declined") {
          assert.equal(source.status, "declined"); assert.equal(ordinary, null); assert.equal(lastResort, null);
        } else {
          assert.equal(source.status, "source");
          if (source.status !== "source") throw new Error("missing source");
          for (const result of [ordinary, lastResort]) {
            assert.ok(result, "complete source remains available");
            const text = paint(result.document, gold.question);
            if (source.model.kind === "photoelectric") {
              close(source.model.photonEnergyEV, gold.scientificGold!.photonEnergyEV!);
              close(source.model.kineticEV!, gold.scientificGold!.maximumKineticEV!);
              assert.equal(result.document.source.archetype, "photoelectric");
            } else if (source.model.kind === "matter_wave") {
              assert.ok(!text.some(label => label.includes("m_e*v")), "generic particle cannot claim electron mass");
              assert.ok(text.some(label => label.startsWith("m=")) && text.includes("using stated p"));
              close(Number(result.document.quantities.find(quantity => quantity.id === "m")?.value), source.model.statedMassKg!);
            }
          }
          if (gold.id.startsWith("combined")) assert.ok(detectArchetype(gold.question)?.evidence.includes("complete source photoelectric state"));
        }
      }
    }
    return { id: gold.id, passed: true };
  } catch (error) { return { id: gold.id, passed: false, error: String(error) }; }
});
const report = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
if (process.argv.includes("--out")) writeFileSync(process.argv[process.argv.indexOf("--out") + 1]!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report)); process.exitCode = report.failed ? 1 : 0;
