import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument, validateSceneDocument, type SceneDocument } from "../../src/index";
import * as source from "../../src/compile/linearRegionSource";

type SourceBuilder = (question: string) => SceneDocument | null;
const build = (source as typeof source & { buildLinearSourceDocument?: SourceBuilder }).buildLinearSourceDocument;
assert.equal(typeof build, "function", "complete source reconstruction is missing; required composite figures remain empty after raw candidate rejection");
const sourceDocument = build as SourceBuilder;
const systemSource = source.readLinearSystemSource;
let checks = 1;
const tests = [
  { question: "Graph 3x + 2y < 10. Indicate whether P=(2,1) belongs to the solution region.", operator: "linear_half_plane", memberships: [true] },
  { question: "Graph -2x+5y<=-10. Mark P=(0,-3) and Q=(0,0).", operator: "linear_half_plane", memberships: [true,false] },
  { question: "Graph x-y>3 and mark A=(4,1) and B=(5,1). Which of A and B belongs to the shaded solution set?", operator: "linear_half_plane", memberships: [false,true] },
  { question: "Let C=[-4,2) and D=(2,5]. Represent C union D on a number line and state whether 2 belongs to it.", operator: "number_line_set", memberships: [] },
  { question: "Show -2<=x<3 or x>=7 on a number line.", operator: "number_line_set", memberships: [] },
  { question: "Maximize Z=3x+4y under x>=0, y>=0, x+y<=7 and 2x+y<=10.", operator: "linear_feasible_region", memberships: [] },
  { question: "Graph 3x-y=4 and -x+2y=7. Mark R=(3,5).", operator: "linear_system", memberships: [true] },
  { question: "Solve the pair x+y=6 and x-y=2 by the graphical method. Label their point of intersection.", operator: "linear_system", memberships: [] },
  { question: "The lines 2x-y=5 and -3x+2y=-4 meet at P. Graph both lines, label P, and find its x-coordinate.", operator: "linear_system", memberships: [] },
  { question: "Show graphically why x+2y=4 and 2x+4y=12 have no common solution.", operator: "linear_system", memberships: [] },
  { question: "Help me see the graphical solution of x=-2 and y=3 using a vertical line and a horizontal line.", operator: "linear_system", memberships: [] },
  { question: "The graphs y=(3/2)x+4 and y=-(1/2)x+10 cross at P. Show the graphs and find the exact coordinates of P.", operator: "linear_system", memberships: [] },
];
for (const test of tests) {
  const document = sourceDocument(test.question);
  assert.ok(document, `source builder refused complete source: ${test.question}`);
  assert.equal(document.source.question, test.question);
  assert.deepEqual(document.quantities, [], "source reconstruction must not consume or trust planner quantities");
  assert.equal(document.constructions.length, 1, "full diagram is one owned composite");
  assert.equal(document.constructions[0]!.operator, test.operator);
  if (test.operator === "linear_system") {
    const system = systemSource(test.question);
    assert.ok(system);
    assert.deepEqual(system.variables, ["x", "y"]);
    assert.deepEqual(system.equations, document.constructions[0]!.inputs.equations);
  } else assert.equal(systemSource(test.question), null);
  checks++;
  assert.deepEqual(document.annotations, [], "no model-authored solved membership claim survives");
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  assert.deepEqual(compiled.renderScene.primitives.filter(p=>p.provenance?.linearRole==="source_reference_point").map(p=>p.provenance?.linearMembership), test.memberships);
  assert.ok(compiled.renderScene.primitives.every(p=>p.entityId === "source_linear_region"), "every geometry/label mark must share the composite owner");
  checks += 8;
  const changed = structuredClone(document);
  if (test.operator === "linear_half_plane") changed.constructions[0]!.inputs.inequality = "x+y<=99";
  else if (test.operator === "number_line_set") changed.constructions[0]!.inputs.expression = { inequality:"x<=99" };
  else if (test.operator === "linear_system") changed.constructions[0]!.inputs.equations = ["x+y=99","x-y=0"];
  else changed.constructions[0]!.inputs.constraints = ["x>=0","y>=0","x+y<=99"];
  const refusal = compileSceneDocument(changed);
  assert.ok(!refusal.ok && refusal.renderScene === null, "a different source program must never compile"); checks++;
  const extra = structuredClone(document);
  extra.entities.push({id:"extra",kind:"point"}); extra.constructions.push({id:"make_extra",operator:"point",inputs:{x:0,y:0,coordinateSpace:"world"},outputs:["extra"]}); extra.requiredEntityIds.push("extra");
  assert.ok(!compileSceneDocument(extra).ok, "complete independent recovery must not relax original ownership guard"); checks++;
  const authored = structuredClone(document);
  authored.annotations.push({id:"answer",kind:"narration",targetIds:["source_linear_region"],text:"2 is in the solution"});
  assert.ok(!compileSceneDocument(authored).ok, "authored solved claims stay refused"); checks++;
}
for (const question of [
  "Graph x+y<=8 or y>=2.",
  "Graph x+y<=8 for integer x and y.",
  "Graph x²+y<=8.",
  "Graph x+y<=8 and z>=1.",
  "Graph x+y<=8 if x>1, otherwise x+y<=3.",
  "Graph x+y<=8. Mark P=(x,2).",
  "Graph x+y<=8. Mark P=(2,3)∗2.",
  "Maximize Z=3x+4y under x>=0,y>=0,x+y<=8. Find the minimum of Z.",
  "Let C=[-4,2). Show C union W on a number line.",
  "Graph x+y<=8 or x.",
  "Graph x+y<=8:2.",
  "Graph x+y<=8 ± 1.",
  "Graph x+y<=8. Mark P=(2,3). P=(3,2).",
  "Graph u+v<=8.",
  "Graph x+y=8.",
  "Graph x+y<=8meet.",
  "Graph why*x+y<=8.",
  "Graph x+y<=pair+8.",
  "Graph x+y<=8+meet.",
  "Graph x+y<=its x-coordinate.",
  "Graph y=(1,2) and x+y=8.",
  "Graph y=(x*x)+2 and x+y=8.",
]) {
  assert.equal(sourceDocument(question), null, `unknown/ambiguous/incomplete source recovered: ${question}`); checks++;
  assert.equal(systemSource(question), null); checks++;
}
const replay = process.argv.find(arg=>arg.startsWith("--replay="));
if (replay) {
  const directory = resolve(replay.slice("--replay=".length));
  let admitted = 0, refused = 0, rawRefusals = 0;
  for (const filename of readdirSync(directory).filter(name=>name.endsWith(".json"))) {
    const row = JSON.parse(readFileSync(resolve(directory,filename),"utf8"));
    if (typeof row.question !== "string") continue;
    const document = sourceDocument(row.question);
    if (!document) { refused++; continue; }
    const compile = compileSceneDocument(document);
    assert.ok(compile.ok && compile.renderScene, `${filename}: independent whole document failed ${JSON.stringify(compile.report.issues)}`);
    admitted++;
    for (const response of row.diagram?.plannerResponses ?? []) {
      if (typeof response.rawContent !== "string") continue;
      let raw: unknown;
      try { raw=JSON.parse(response.rawContent); } catch { continue; }
      const parsed=validateSceneDocument(raw);
      if (!parsed.document) continue;
      const original=compileSceneDocument(parsed.document);
      if (!original.ok) { assert.equal(original.renderScene,null); rawRefusals++; }
    }
  }
  console.log(JSON.stringify({replay:directory,admitted,refused,originalAtomicRefusals:rawRefusals}));
}
console.log(`verify-linear-composite-contract: ${checks} independent-source/ownership/changed-program checks passed`);
