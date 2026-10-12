import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateLinearSourcePlan } from "../../src/compile/linearSourceAgreement";
import { buildLinearSourceDocument } from "../../src/compile/linearRegionSource";
import { compileSceneDocument, validateSceneDocument } from "../../src/index";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { parseScenePlannerResponseJson } from "../../../tutor-core/src/planners/scenePlannerV2";

interface RecordedRoleCase {
  probeId: string;
  question: string;
  turnPlan: TurnPlanV3;
  recordedCommitted: boolean;
  solverStatus: string | null;
  plannerResponses?: Array<{ rawContent: string }>;
}
const rows: RecordedRoleCase[] = JSON.parse(readFileSync(new URL("./fixtures/linear-region-role-recordings.json", import.meta.url), "utf8"));
const refusedIds = ["lpp07-unbounded-objective", "sys01-unique-integer", "sys07-negative-coefficients"];
let accepted = 0, refused = 0, sourceCompiled = 0, candidateAccepted = 0, candidateRefused = 0, mutations = 0;
for (const row of rows) {
  if (process.argv.includes("--minimal") && !row.probeId.includes("lpp01")) continue;
  const originalPlan = JSON.stringify(row.turnPlan);
  const plan = process.argv.includes("--minimal") ? {
    ...row.turnPlan,
    givens: [],
    unknowns: row.turnPlan.unknowns.filter(q => q.symbol === "Zmax"),
    derived: row.turnPlan.derived.filter(q => q.symbol === "Zmax").map(q => ({ ...q, dependsOn: [] })),
    qualitativeClaims: [], lawIds: [], assumptions: [],
  } : row.turnPlan;
  const document = buildLinearSourceDocument(row.question);
  const compiled = document ? compileSceneDocument(document) : null;
  if (process.argv.includes("--minimal")) assert(compiled?.ok && compiled.renderScene);
  const issues = validateLinearSourcePlan(row.question, plan);
  assert.equal(JSON.stringify(row.turnPlan), originalPlan, "Original captured plan stays unchanged");
  const shouldRefuse = !process.argv.includes("--minimal") && refusedIds.some(id => row.probeId.includes(id));
  if (process.argv.includes("--report")) console.log(JSON.stringify({ probeId: row.probeId, sourceCompiled: Boolean(compiled?.ok && compiled.renderScene), issues }));
  if (!process.argv.includes("--report")) {
    if (shouldRefuse) assert(issues.some(issue => issue.severity === "fatal"), "Planner-only names and wrong numeric values stay refused");
    else assert.deepEqual(issues, [], "Mathematically correct recorded finite source roles must not empty the source-derived region");
  }
  if (issues.length) refused++; else accepted++;
  if (compiled?.ok && compiled.renderScene) sourceCompiled++;
  for (const response of row.plannerResponses ?? []) {
    const raw = parseScenePlannerResponseJson(response.rawContent);
    const validation = validateSceneDocument(raw);
    const candidate = validation.document && validation.document.source.question === row.question ? compileSceneDocument(validation.document) : null;
    if (candidate?.ok && candidate.renderScene) candidateAccepted++; else candidateRefused++;
  }
  if (!shouldRefuse && document && !issues.length && row.plannerResponses) {
    for (const quantity of row.turnPlan.derived) {
      if (!row.turnPlan.unknowns.some(unknown => unknown.id === quantity.id) || quantity.value === undefined) continue;
      const changed = structuredClone(row.turnPlan);
      changed.derived.find(derived => derived.id === quantity.id)!.value = quantity.value + 100;
      assert(validateLinearSourcePlan(row.question, changed).some(issue => issue.severity === "fatal"), `Wrong ${quantity.symbol} remains refused`); mutations++;
    }
    const changed = structuredClone(document);
    if (changed.constructions[0]!.operator === "linear_system") changed.constructions[0]!.inputs.equations = ["x=999", "y=999"];
    else changed.constructions[0]!.inputs.constraints = ["x>=999", "y>=999"];
    const bad = compileSceneDocument(changed);
    assert(!bad.ok && bad.renderScene === null, "Role aliases never authorize invented/different source geometry"); mutations++;
  }
}
function expectRole(question: string, symbol: string, value: number, permitted: boolean, mutate?: (plan: TurnPlanV3) => void) {
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [{ id: "answer", symbol }], derived: [{ id: "answer", symbol, value, provenance: "derived" }], qualitativeClaims: [], lawIds: [], assumptions: [] };
  mutate?.(plan);
  assert(buildLinearSourceDocument(question), "Negative role fixture requires a supported complete source");
  const before = JSON.stringify(plan), issues = validateLinearSourcePlan(question, plan);
  assert.equal(issues.length === 0, permitted, `${symbol}: ${JSON.stringify(issues)}`);
  assert.equal(JSON.stringify(plan), before, "Role proof never rewrites planner values"); mutations++;
}
const unique = rows.find(row => row.probeId.includes("lpp01"))!.question;
expectRole(unique, "Zmax", 14, true);
expectRole(unique, "Zmaximum", 14, true);
expectRole(unique.replace("Z =", "Zmin ="), "Zmin", 14, true);
expectRole(unique, "Zmin", 0, false);
expectRole(unique, "maximizing x", 2, true);
expectRole(unique, "minimizing x", 2, false);
expectRole(unique, "Zmax", 14, false, plan => { plan.derived[0]!.unit = "cm"; });
expectRole(unique, "Zmax", 14, false, plan => { plan.derived[0]!.symbol = "maximum Q"; });
expectRole("Maximize Z=x+y subject to x>=0,y>=0,x+y<=5. Show all corners.", "maximizing x", 5, false);
expectRole("Maximize Z=x subject to x>=0,y>=0,x<1,y<=1. Show all corners.", "Zmax", 1, false);
const evaluated = rows.find(row => row.probeId.includes("multiple-optimum-edge"))!.question;
expectRole(evaluated, "C(B)", 16, true);
expectRole(evaluated, "C(2,1)", 16, true);
expectRole(evaluated, "C(Q)", 16, false);
expectRole(evaluated, "C(2,2)", 20, false);
expectRole(evaluated, "C(B)", 16, false, plan => { plan.unknowns[0]!.symbol = "C(D)"; });
const vertical = rows.find(row => row.probeId.includes("vertical-line-system"))!.question;
expectRole(vertical, "x-intercept of L2", -7, true);
expectRole(vertical, "x-intercept of L3", -7, false);
expectRole(vertical, "y-intercept of L1", 0, false);
const intersection = rows.find(row => row.probeId.includes("sys05-vertical-horizontal"))!.question;
expectRole(intersection, "x_intersection", -2, true);
expectRole(intersection, "x_intersection", 3, false);
expectRole(intersection, "x_invented", -2, false);
expectRole(`${intersection} Mark intersection=(1,1).`, "x_intersection", -2, false);
console.log(JSON.stringify({ accepted, refused, sourceCompiled, exactCandidateAccepted: candidateAccepted, exactCandidateRefused: candidateRefused, mutations }));
if (!process.argv.includes("--minimal") && !process.argv.includes("--report")) {
  assert.equal(rows.length, 60);
  assert.deepEqual([accepted, refused, sourceCompiled, candidateAccepted, candidateRefused], [57, 3, 57, 17, 5]);
}
