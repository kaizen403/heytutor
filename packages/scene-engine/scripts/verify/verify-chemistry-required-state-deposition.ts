/** Authored source/operator controls; real recorded lesson payloads remain ignored. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../../src/chemistry/families";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { inferChemistryFamilies } from "../../src/chemistry/router";
import { validateSceneQuantityAgreement, validateTurnPlanV3, type TurnPlanV3 } from "../../src/contracts/contractsV3";

const rows = JSON.parse(fs.readFileSync(new URL("./fixtures/chemistry-required-state-deposition.json", import.meta.url), "utf8")) as Array<{
  id: string; kind: string; question: string; draw: boolean; ampere?: number; seconds?: number; molarMass?: number; faraday?: number; grams?: number;
}>;
const results: unknown[] = [];
let failed = 0;
for (const row of rows) {
  for (const [route, producer] of [["ordinary", synthesizeFamilyScene], ["last", synthesizeLastResortScene]] as const) {
    const actual = producer({ question: row.question, families: inferChemistryFamilies(row.question) });
    let error: string | null = null;
    let quantityAgreement: ReturnType<typeof validateSceneQuantityAgreement> | null = null;
    let staleMassAgreement: ReturnType<typeof validateSceneQuantityAgreement> | null = null;
    try {
      assert.equal(Boolean(actual), row.draw, `${row.id}/${route}: source completeness`);
      if (actual) {
        const text = actual.renderScene.primitives.flatMap(mark => mark.text ? [mark.text] : []);
        assert.ok(!text.some(label => /NaN|Infinity/.test(label)));
        if (row.kind === "hess") {
          assert.equal(actual.family, "chem_thermo");
          for (const word of ["A", "B", "C", "Symbolic example"]) assert.ok(text.includes(word), word);
          assert.ok(text.includes("ΔH_AB =") && text.includes("ΔH_AC + ΔH_CB"), "complete path equality");
          assert.equal(actual.document.quantities.length, 0);
          assert.equal(actual.document.entities.filter(entity => entity.kind === "vector").length, 3);
        }
        if (row.kind === "deposition") {
          assert.equal(actual.family, "chem_electrochem");
          const plan: TurnPlanV3 = {
            schemaVersion: "turn-plan/v3", question: row.question,
            givens: [
              { id: "I", symbol: "I", value: row.ampere!, unit: "A", provenance: "given" },
              { id: "t", symbol: "t", value: row.seconds!, unit: "s", provenance: "given" },
              { id: "M", symbol: "M", value: row.molarMass!, unit: "g/mol", provenance: "given" },
              { id: "F", symbol: "F", value: row.faraday!, unit: "C/mol", provenance: "given" },
            ],
            unknowns: [{ id: "m", symbol: "m(Cu)", unit: "g" }],
            derived: [
              { id: "Q", symbol: "Q", value: row.ampere! * row.seconds!, unit: "C", provenance: "derived", dependsOn: ["I", "t"] },
              { id: "m", symbol: "m(Cu)", value: row.grams!, unit: "g", provenance: "derived", dependsOn: ["M", "I", "t", "F"] },
            ],
            qualitativeClaims: [], lawIds: ["faraday_electrolysis"],
            assumptions: ["Complete copper deposition at 100% current efficiency; two electrons per copper atom."],
            visualRequirement: "required",
          };
          assert.deepEqual(validateTurnPlanV3(plan, row.question).issues, [], "authored complete plan is valid");
          quantityAgreement = validateSceneQuantityAgreement(actual.document.quantities, plan, text);
          const stalePlan = { ...plan, derived: plan.derived.map(quantity => quantity.id === "m" ? { ...quantity, value: quantity.value + 0.1 } : quantity) };
          staleMassAgreement = validateSceneQuantityAgreement(actual.document.quantities, stalePlan, text);
          assert.ok(staleMassAgreement.some(issue => issue.message.includes("deposition_m")), "stale planned mass must not admit");
          assert.deepEqual(quantityAgreement, [], "full-precision source quantities must pass canonical plan agreement");
          // Preserve the original decimal oracle in the plan above; test serialization
          // against the independently recomputed IEEE-754 source-law value, not a rounded literal.
          const sourceGrams = row.molarMass! * (row.ampere! * row.seconds!) / (2 * row.faraday!);
          for (const [id, value] of [["deposition_I", row.ampere], ["deposition_t", row.seconds], ["deposition_M", row.molarMass], ["deposition_F", row.faraday], ["deposition_Q", row.ampere! * row.seconds!], ["deposition_m", sourceGrams]] as const) {
            const q = actual.document.quantities.find(item => item.id === id);
            assert.ok(q, id); assert.equal(q.value, value, `${id}: exact finite source value`);
            assert.ok(typeof q.value === "number" && Number.isFinite(q.value), `${id}: finite`);
          }
          assert.ok(text.some(label => label.includes(`${Number(row.grams!.toPrecision(3))} g`)), "visible source-derived mass");
          assert.ok(text.includes("Cu")); assert.ok(text.includes("cathode (-)"));
        }
        if (row.kind === "catalyst") {
          for (const id of ["ea_dim", "ea_cat_dim", "dh_dim"]) assert.ok(actual.document.entities.some(entity => entity.id === id), id);
          assert.equal(actual.document.quantities.length, 0);
        }
      }
    } catch (caught) { failed++; error = String(caught); }
    results.push({ id: row.id, route, error, quantityAgreement, staleMassAgreement, actual });
  }
}
const outputAt = process.argv.indexOf("--out");
if (outputAt >= 0) fs.writeFileSync(path.resolve(process.argv[outputAt + 1]!), JSON.stringify({ rows: rows.length, checks: results.length, failed, results }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ gate: fileURLToPath(import.meta.url), checks: results.length, passed: results.length - failed, failed }));
if (failed) process.exitCode = 1;
