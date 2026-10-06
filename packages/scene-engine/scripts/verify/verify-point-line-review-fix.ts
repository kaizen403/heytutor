import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import * as source from "../../src/index";
const engine: typeof source = process.argv.includes("--built") ? await import("../../dist/index.js") : source;
// Pin the complete review originals; mutations operate only on own clones.
for (const [file, expected] of [
  ["point-line-fresh-review-20261006.json", "d0e2349920c1ef7b3502c1b975cd2eefe517683d25d23ab656db27d88073daf1"],
  ["point-line-full-caller-20261006.json", "17b3a62cf0eceebfc20815ef42eaa60e6c032cff5c8a63c2954b9b3d622e18ac"],
]) assert.equal(createHash("sha256").update(readFileSync(new URL("./fixtures/" + file, import.meta.url))).digest("hex"), expected, `${file}: frozen whole originals`);
const frozen = JSON.parse(readFileSync(new URL("./fixtures/point-line-fresh-review-20261006.json", import.meta.url), "utf8")) as {cases: Array<{name: string; input: {problem: source.ProblemIR; plan: source.TurnPlanV3}}>};
const capture = JSON.parse(readFileSync(new URL("./fixtures/point-line-full-caller-20261006.json", import.meta.url), "utf8")) as {problem: source.ProblemIR; plans: source.TurnPlanV3[]};
const horizontal = frozen.cases.find(c => c.name === "horizontal-control")!.input.problem;
let checks = 0;
const receipts: unknown[] = [];
function check(condition: unknown, message: string): asserts condition {checks++; assert.ok(condition, message);}
for (const row of [...frozen.cases, ...capture.plans.map((plan,index) => ({name: `original-${index + 1}`, input: {problem: capture.problem, plan}}))]) {
  const {problem,plan} = row.input, before = JSON.stringify(row.input), positive = row.name === "horizontal-control" || row.name.startsWith("original-");
  const reference = row.name.startsWith("horizontal") ? horizontal : capture.problem;
  const document = engine.pointLineSourceDocument(reference.question,reference); check(document, "complete reference");
  const issues = engine.pointLineCallerIssues(plan.question,problem,plan);
  check(positive ? issues.length === 0 : issues.some(i => i.severity === "fatal"), `${row.name}: complete audit`);
  const compiled = engine.compileSceneDocument(document,{sourceAuthority: {question: plan.question, problemIR: problem, turnPlan: plan}});
  check(positive ? compiled.ok && !!compiled.renderScene : !compiled.ok && compiled.renderScene === null, `${row.name}: atomic compile`);
  for (const families of [undefined,["line_figure"]]) {
    const family = engine.synthesizeFamilyScene({question: plan.question, problemIR: problem, turnPlan: plan, families});
    check(positive ? family?.tier === "exact_verified" : family === null, `${row.name}: source operator selection`);
  }
  if (positive) check(engine.visualObligationIssues(problem,document,plan).length === 0, `${row.name}: every original visual obligation`);
  check(JSON.stringify(row.input) === before, `${row.name}: complete originals unchanged`);
  receipts.push({name: row.name, positive, issues, compileOk: compiled.ok, ink: compiled.renderScene?.primitives.length ?? 0});
}
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
if (output) writeFileSync(output,JSON.stringify({checks,receipts},null,2));
console.log(`point-line fresh review engine: ${checks} checks passed (${process.argv.includes("--built") ? "own public ESM" : "source"})`);
