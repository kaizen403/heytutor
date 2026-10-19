/** Complete formula tokens may alias subscript notation; source numbers never do. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import "../../src/chemistry/families";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";
import fixtures from "./fixtures/chemistry-titration-formula-notation.json";

type Case = { id: string; question: string; expectedDraw: boolean; equivalenceMl?: number; pK?: number; qualitative?: boolean; normalized?: boolean; diagnostic?: boolean; pairedWith?: string };
type Route = "direct" | "schematic" | "ordinary" | "lastResort";
const routes: Route[] = ["direct", "schematic", "ordinary", "lastResort"];
const results: Array<{ id: string; passed: boolean; error?: string; document?: SceneDocument | null; renderScene?: unknown }> = [];
const actualOutcomes: Array<{id:string;document:SceneDocument|null}> = [];
const complete = new Map<string, {document: SceneDocument; renderScene: unknown}>();
function check(id: string, run: () => {document: SceneDocument | null; renderScene?: unknown} | void): void {
  try { const value = run(); results.push({id,passed:true,...value}); }
  catch (error) { results.push({id,passed:false,error:error instanceof Error ? error.message : String(error)}); }
}
for (const row of fixtures.rows as Case[]) for (const route of routes) {
  const id = `${row.id}/${route}`;
  check(id, () => {
    const result = route === "direct" || route === "schematic"
      ? buildSolutionsGraphScene(row.question, [], route === "schematic")
      : route === "ordinary" ? synthesizeFamilyScene({question:row.question}) : synthesizeLastResortScene({question:row.question});
    const document = result ? "document" in result ? result.document : result : null;
    actualOutcomes.push({id,document});
    assert.equal(!!document,row.expectedDraw,"frozen scientific draw/refuse oracle");
    if (!document) return {document:null};
    assert.equal(document.source.chemistryFamily,"chem_solutions");
    const valid = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
    assert.ok(valid.document,JSON.stringify(valid.report.issues));
    const compiled = compileSceneDocument(valid.document);
    assert.ok(compiled.ok && compiled.renderScene,JSON.stringify(compiled.report.issues));
    const labels = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []);
    assert.ok(!/NaN|Infinity|undefined/.test(labels.join(" ")));
    if (row.equivalenceMl !== undefined) {
      const foot = document.constructions.find(construction => construction.outputs.includes("eq_foot"));
      assert.equal(foot?.inputs.x,row.equivalenceMl,"actual drawn equivalence coordinate must use the original quantities/stoichiometry");
      const assertion = document.assertions.find(item => item.id === "eq_on_curve");
      assert.equal((assertion?.expected as {x?:number} | undefined)?.x,row.equivalenceMl,"the numeric curve must certify the same equivalence volume");
      assert.ok(labels.includes(`V_eq = ${row.equivalenceMl} mL`),"visible volume is required; a qualitative replacement is not the requested numeric curve");
      assert.ok(labels.includes("V (mL)"));
    }
    if (row.pK !== undefined) {
      const caption = document.annotations.find(annotation => annotation.id === "figure_caption")?.text ?? "";
      assert.ok(caption.includes(`pKa = ${row.pK}`) || caption.includes(`pKb = ${row.pK}`),"named supplied constant must replace its table value");
      assert.ok(labels.some(label => label.includes(`pK_a = ${row.pK}`) || label.includes(`pK_b = ${row.pK}`))
        || (caption.includes(`pKb = ${row.pK}`) && labels.includes(`pH = ${14 - row.pK}`)),"weak-base half-equivalence ink displays pH=14-pKb rather than a pKb label");
    }
    if (row.normalized) {
      assert.ok(labels.includes("V / V_eq"),"genuine concentration-only inputs keep their existing normalized curve");
      assert.ok(labels.includes("V_eq"));
    }
    if (row.qualitative) {
      assert.ok(labels.includes("V_eq"));
      assert.ok(!labels.some(label => /^V_eq = .*mL$/.test(label)));
    }
    complete.set(id,{document,renderScene:compiled.renderScene});
    return {document,renderScene:compiled.renderScene};
  });
}
for (const row of fixtures.rows as Case[]) if (row.pairedWith) for (const route of routes) {
  check(`${row.id}/whole-alias-parity/${route}`, () => {
    const ascii = complete.get(`${row.id}/${route}`), unicode = complete.get(`${row.pairedWith}/${route}`);
    assert.ok(ascii && unicode,"both complete numeric outcomes must exist");
    const normalized = JSON.parse(JSON.stringify(unicode.document)) as SceneDocument;
    normalized.source.question = ascii.document.source.question;
    assert.deepEqual(normalized,JSON.parse(JSON.stringify(ascii.document)),"only original source-question formula spelling may differ");
    assert.deepEqual(JSON.parse(JSON.stringify(unicode.renderScene)),JSON.parse(JSON.stringify(ascii.renderScene)),"all actual graph geometry, labels, assertions and layout must match");
  });
}
const diagnosticIds = new Set((fixtures.rows as Case[]).filter(row=>row.diagnostic).map(row=>row.id));
const required = results.filter(row=>!diagnosticIds.has(row.id.split("/")[0]!));
const report = {scope:"Source-only actual direct/schematic/ordinary/last-resort programs with normal prune/validate/compile and complete numeric graph/ink assertions. No paid capture, native proof or coverage claim.",passed:required.filter(row=>row.passed).length,failed:required.filter(row=>!row.passed).length,diagnosticFailures:results.filter(row=>diagnosticIds.has(row.id.split("/")[0]!)&&!row.passed).length,results,actualOutcomes};
const out=process.argv.indexOf("--out");if(out>=0){assert.ok(process.argv[out+1]);writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n");}
for(const row of required.filter(row=>!row.passed))console.error(`FAIL ${row.id}: ${row.error}`);
console.log(`verify-chemistry-titration-formula-notation: ${report.passed} passed, ${report.failed} failed`);
if(report.failed)process.exitCode=1;
