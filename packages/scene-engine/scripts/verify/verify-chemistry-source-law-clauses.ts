/** A valid supplied law never authorizes unowned source facts or drawing asks. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { normalizeTutorQuestion } from "../../../tutor-core/src/text/questionText";
import { readSourceLawGraph, type SourceLawGraph, type SourceLawFamily } from "../../src/chemistry/sourceLawGraph";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { buildElectrochemScene } from "../../src/chemistry/electrochemistry";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileForLab } from "../chemistry-lab/lab";
import fixture from "./fixtures/chemistry-source-law-clauses.json";

const rows: Array<{ id: string; passed: boolean; actual: unknown; error: string | null }> = [];
function check(id: string, actual: unknown, test: () => void): void {
  try { test(); rows.push({ id, passed: true, actual, error: null }); }
  catch (error) { rows.push({ id, passed: false, actual, error: error instanceof Error ? error.message : String(error) }); }
}
function semantics(model: SourceLawGraph, gold: typeof fixture.rows[number], question: string): void {
  assert.equal(model.question, question);
  assert.equal(model.family, gold.family);
  const relation = model.curves[0]!.relation;
  assert.equal(relation.operator, gold.operator);
  for (const [x, expected] of gold.points) {
    const actual = relation.operator === "positive_quadratic" ? 2 * relation.product / (Math.sqrt(x! * x! + 4 * relation.product) + x!)
      : relation.operator === "ratio_complements" ? (relation.complement ? 1 : 10 ** (x! - relation.pK)) / (1 + 10 ** (x! - relation.pK))
        : relation.slope * x! + relation.intercept;
    const scale = Math.max(Math.abs(model.y.domain[0]), Math.abs(model.y.domain[1]), Math.abs(expected!));
    assert.ok(Math.abs(actual - expected!) <= Math.max(64 * Number.EPSILON * scale, Math.abs(expected!) * 1e-8), `source law ${actual} != ${expected}`);
  }
  for (const text of gold.forbidNotes ?? []) assert.ok(model.notes.every(note => !note.includes(text)), `unbound source variable: ${text}`);
  for (const binding of model.bindings) for (const proof of [binding.scalarSource, ...(binding.unitSource ? [binding.unitSource] : [])]) {
    assert.equal(question.slice(proof.span.start, proof.span.end), proof.text);
  }
}
for (const gold of fixture.rows) {
  const family = gold.family as SourceLawFamily;
  const result = readSourceLawGraph(gold.question, family);
  check(gold.id + "/reader", result, () => {
    assert.equal(result.state === "valid", gold.draw);
    if (result.state === "valid") semantics(result.model, gold, gold.question);
  });
  for (const route of ["direct", "ordinary", "lastResort"] as const) {
    const question = route === "direct" ? gold.question : normalizeTutorQuestion(gold.question);
    const build = family === "chem_solutions" ? buildSolutionsGraphScene : family === "chem_electrochem" ? buildElectrochemScene : buildAtomicRadiationScene;
    const document = route === "direct" ? build(question, [], false)
      : (route === "ordinary" ? synthesizeFamilyScene : synthesizeLastResortScene)({ question })?.document ?? null;
    const compiled = compileForLab(document);
    check(gold.id + "/" + route, { question, document, compiled }, () => {
      assert.equal(document !== null, gold.draw);
      if (!gold.draw) return;
      assert.ok(document && compiled.ok && compiled.renderScene);
      assert.equal(document.source.question, question);
      const model = document.source.sourceLawGraph as SourceLawGraph;
      assert.ok(model);
      semantics(model, gold, question);
    });
  }
}
const result = { passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, rows };
const at = process.argv.indexOf("--out"); if (at >= 0) writeFileSync(process.argv[at + 1]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
for (const row of rows) console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id}${row.error ? `: ${row.error}` : ""}`);
console.log(JSON.stringify({ passed: result.passed, failed: result.failed })); if (result.failed) process.exitCode = 1;
