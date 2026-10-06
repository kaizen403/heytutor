import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as sourceAuthority from "../../src/ir/matrixProductSourceAuthority";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { ProblemIR } from "../../src/ir/problemIR";

const artifact = process.argv.slice(2).find(argument => !argument.startsWith("--"));
const authority: typeof sourceAuthority = artifact
  ? await import(pathToFileURL(artifact).href)
  : sourceAuthority;
const actual = JSON.parse(readFileSync(new URL("../../fixtures/matrix-products-live-20261006/actual-runtime.json", import.meta.url), "utf8")) as {
  question: string;
  plan: TurnPlanV3;
  problemIR: ProblemIR;
};
const mutations = JSON.parse(readFileSync(new URL("./fixtures/matrix-product-strict-completeness.json", import.meta.url), "utf8")) as {
  givenMutations: string[];
  dependencyMutations: string[];
};
let checks = 0;
function check(value: unknown, message: string): asserts value {
  checks++;
  assert.ok(value, message);
}
function equal(actualValue: unknown, expected: unknown, message: string): void {
  checks++;
  assert.deepEqual(actualValue, expected, message);
}

const correction = authority.correctMatrixProductSourcePlan(actual.question, actual.plan);
check(correction, "the captured actual plan still passes the audited zero-placeholder correction");
const complete = structuredClone(correction.plan);
equal(authority.matrixProductSourcePlanIssues(actual.question, complete), [], "the corrected actual plan is a strict positive control");
check(complete.givens.length > 0 && complete.derived.length > 0, "positive control retains source cells and product results");

for (const mutation of mutations.givenMutations) {
  const plan = structuredClone(complete);
  if (mutation === "empty") plan.givens = [];
  if (mutation === "missing-first") plan.givens.shift();
  if (mutation === "duplicate-first") plan.givens.push(structuredClone(plan.givens[0]!));
  if (mutation === "wrong-value") plan.givens[0]!.value += 1;
  check(authority.matrixProductSourcePlanIssues(actual.question, plan).length > 0, `strict plan rejects source-cell givens mutation: ${mutation}`);
  check(authority.prepareMatrixProductSourceAuthority(actual.question, plan, actual.problemIR) === null, `all-seams preparation rejects givens mutation: ${mutation}`);
}

for (const mutation of mutations.dependencyMutations) {
  const plan = structuredClone(complete);
  const row = plan.derived[0]!;
  if (mutation === "missing") delete row.dependsOn;
  if (mutation === "empty") row.dependsOn = [];
  if (mutation === "subset") row.dependsOn = [row.dependsOn![0]!];
  if (mutation === "duplicate") row.dependsOn = [...row.dependsOn!, row.dependsOn![0]!];
  if (mutation === "substitute") row.dependsOn = ["A11", "B12", "A12", "B21"];
  check(authority.matrixProductSourcePlanIssues(actual.question, plan).length > 0, `strict plan rejects dot-product dependency mutation: ${mutation}`);
  check(authority.prepareMatrixProductSourceAuthority(actual.question, plan, actual.problemIR) === null, `all-seams preparation rejects dependency mutation: ${mutation}`);
}

// A repeated source operand uses one unique dependency per input cell even
// though the cell participates twice in the scalar dot product.
const repeatedQuestion = "Let A=[[3]]. Find AA.";
const repeatedPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: repeatedQuestion,
  givens: [
    { id: "A11", symbol: "A11", value: 3, sourceText: "A=[[3]]", provenance: "given" },
  ],
  unknowns: [{ id: "AA", symbol: "AA" }],
  derived: [{ id: "AA11", symbol: "(AA)11", value: 9, sourceText: "3*3=9", provenance: "derived", dependsOn: ["A11"] }],
  qualitativeClaims: [], lawIds: ["matrix-multiplication-definition"],
  assumptions: ["Standard row-by-column matrix multiplication over the real numbers"],
  visualRequirement: "optional",
};
equal(authority.matrixProductSourcePlanIssues(repeatedQuestion, repeatedPlan), [], "independent repeated-operand plan has one deduplicated source-cell dependency");
const duplicateRepeated = structuredClone(repeatedPlan);
duplicateRepeated.derived[0]!.dependsOn = ["A11", "A11"];
check(authority.matrixProductSourcePlanIssues(repeatedQuestion, duplicateRepeated).length > 0, "repeated operand dependency duplicates reject");

// The all-seams correction continues to preserve the exact original full IR.
const fullIRBefore = JSON.stringify(actual.problemIR);
const prepared = authority.prepareMatrixProductSourceAuthority(actual.question, actual.plan, actual.problemIR);
check(prepared, "actual source/plan/IR all-seams positive control remains accepted");
check(prepared.problemIR === actual.problemIR, "actual full caller IR reference is unchanged");
equal(JSON.stringify(actual.problemIR), fullIRBefore, "actual full caller IR data is unchanged");

console.log(`matrix-product-strict-completeness: ${checks} checks passed`);
