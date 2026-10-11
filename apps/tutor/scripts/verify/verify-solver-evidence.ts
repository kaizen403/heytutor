import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { retainSolverEvidence } from "../lecture-lab/solverEvidence";
import { LocalDeterministicSolverProvider } from "../../../../packages/scene-engine/src/ir/solver";
import { verifyTurnPlanAgainstSolver, buildSolverAuthorityProjection } from "../../../../packages/scene-engine/src/ir/solverAuthority";
import type { ProblemIR, ExpressionNodeIR } from "../../../../packages/scene-engine/src/ir/problemIR";
import type { TurnPlanV3 } from "../../../../packages/scene-engine/src/contracts/contractsV3";

async function main() {
const question = "The lines 2x-y=5 and -3x+2y=-4 meet at P. Graph both lines, label P, and find its x-coordinate.";
const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const x: ExpressionNodeIR = { kind: "variable", name: "x" };
const bin = (operator: "+" | "-" | "*" | "/", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
const evidence = { source: "question" as const, start: 0, end: question.length, quote: question };
const problemIR: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "solverEvidence", question,
  facts: [{ id: "given", kind: "given", statement: question, evidence }, { id: "requested", kind: "requested", statement: question, evidence }],
  entities: [], constraints: [], representationIntents: [],
  expressions: [
    { id: "first", valueType: "function", root: bin("-", bin("*", n(2), x), n(5)), evidenceFactIds: ["given"] },
    { id: "second", valueType: "function", root: bin("-", bin("/", bin("*", n(3), x), n(2)), n(2)), evidenceFactIds: ["given"] },
  ],
  solveRequests: [{ id: "findX", kind: "intersections", leftExpressionId: "first", rightExpressionId: "second", variable: "x", domain: { min: -100, max: 100 }, resultBinding: { turnPlanQuantityId: "xP", symbol: "x_P", evidenceFactIds: ["requested"] } }],
};
const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [{ id: "xP", symbol: "x_P" }], derived: [{ id: "xP", symbol: "x_P", value: 6, provenance: "derived" }], qualitativeClaims: [], lawIds: [], assumptions: [] };
const solverResult = await new LocalDeterministicSolverProvider().solve(problemIR);
const missingSourceAudit = verifyTurnPlanAgainstSolver(problemIR, solverResult, turnPlan);
assert.equal(missingSourceAudit.issues[0]?.code, "value_type_mismatch");
const blocked = { audit: missingSourceAudit, problemIR, solverResult, projection: null };
const blockedSnapshot = JSON.stringify(blocked);
const record = retainSolverEvidence(blocked, question, turnPlan);
const stored = JSON.parse(JSON.stringify(record));
assert.equal(record.status, "contradiction");
assert.equal(record.hasProjection, false);
assert.deepEqual(record.issueCodes, ["value_type_mismatch"]);
assert.deepEqual(stored.evidence.audit.issues, missingSourceAudit.issues, "Preserve full message and request/quantity ids");
assert.deepEqual(stored.evidence.solverResult.values, solverResult.values, "Preserve original exact set, not an inferred scalar");
assert.deepEqual(stored.evidence.problemIR, problemIR, "Retain exact source facts, expression AST and solve request");
assert.deepEqual(stored.evidence.turnPlan, turnPlan, "Retain complete authoritative plan with provenance");
assert.equal(stored.evidence.originalQuestionSha256, createHash("sha256").update(question).digest("hex"));
assert.equal(stored.evidence.problemQuestionMatchesOriginal, true);
assert.equal(JSON.stringify(blocked), blockedSnapshot, "Evidence serialization must not change solver behavior");
assert.equal(record.evidence.truncation.omittedArrayItems, 0);
assert.equal(record.evidence.truncation.shortenedStringFields, 0);
assert.equal(record.evidence.truncation.details.length, 0);

const audit = verifyTurnPlanAgainstSolver(problemIR, solverResult, turnPlan, question);
assert.equal(audit.status, "verified");
const projection = buildSolverAuthorityProjection(problemIR, solverResult, audit);
const verified = retainSolverEvidence({ audit, problemIR, solverResult, projection }, question, turnPlan);
const verifiedStored = JSON.parse(JSON.stringify(verified));
assert.deepEqual(verifiedStored.evidence.audit, audit);
assert.deepEqual(verifiedStored.projection, projection);
assert.equal(verifiedStored.evidence.audit.bindings[0].approximate, 6);
assert.equal(verifiedStored.evidence.audit.bindings[0].selection.kind, "unique_source_linear_coordinate");
assert.deepEqual(verifiedStored.evidence.solverResult.values[0].approximate, [6]);

const sentinel = "DO_NOT_PERSIST_TRANSPORT_SENTINEL";
const withUnknownFields = {
  audit: { ...audit, headers: sentinel },
  problemIR: { ...problemIR, authorization: sentinel, expressions: problemIR.expressions.map((expression) => ({ ...expression, root: { ...expression.root, headers: sentinel } })) },
  solverResult: { ...solverResult, env: sentinel, proofs: solverResult.proofs.map((proof) => ({ ...proof, token: sentinel })) },
  projection: { ...projection, auth: sentinel },
  rawContent: sentinel,
};
assert.equal(JSON.stringify(retainSolverEvidence(withUnknownFields, question, turnPlan)).includes(sentinel), false, "Whitelist math fields; no unknown model/transport/env/auth properties");

const large = {
  ...blocked,
  audit: { ...missingSourceAudit, issues: Array.from({ length: 70 }, () => ({ code: "value_type_mismatch", message: "≤".repeat(1500), requestId: "s".repeat(200), quantityId: "q".repeat(200) })) },
  solverResult: { ...solverResult, values: Array.from({ length: 70 }, () => solverResult.values[0]!) },
};
const capped = retainSolverEvidence(large, question, turnPlan);
const cappedStored = JSON.parse(JSON.stringify(capped));
assert.equal(capped.status, "contradiction", "Truncation cannot change the blocking authority verdict");
assert.equal(cappedStored.evidence.audit.issues.length, 64);
assert.equal(cappedStored.evidence.solverResult.values.length, 64);
assert.ok(Buffer.byteLength(cappedStored.evidence.audit.issues[0].message) <= 2048);
assert.equal(cappedStored.evidence.audit.issues[0].message.includes("�"), false, "UTF-8 truncation never breaks a glyph");
assert.equal(cappedStored.evidence.audit.issues[0].requestId.length, 128);
assert.equal(capped.evidence.truncation.omittedArrayItems, 18, "Count issue-code, issue and value omissions separately");
assert.ok(capped.evidence.truncation.shortenedStringFields > 0);
assert.equal(capped.evidence.truncation.details.length, 64);
assert.ok(capped.evidence.truncation.omittedDetailRecords > 0);
assert.deepEqual(retainSolverEvidence(large, question, turnPlan), capped, "Bounds and truncation accounting are deterministic");

const tree = structuredClone(problemIR);
let node: ExpressionNodeIR = n(1);
for (let depth = 0; depth < 60; depth++) node = { kind: "unary", operator: "+", operand: node };
tree.expressions[0]!.root = node;
const deep = retainSolverEvidence({ ...blocked, problemIR: tree }, question, turnPlan);
assert.ok(deep.evidence.truncation.depthLimitedFields > 0);
let wideRoot: ExpressionNodeIR = n(1);
for (let depth = 0; depth < 5; depth++) wideRoot = bin("+", wideRoot, wideRoot);
const wide = { ...tree, expressions: Array.from({ length: 64 }, () => ({ ...tree.expressions[0]!, root: wideRoot })) };
wide.solveRequests = Array.from({ length: 64 }, () => problemIR.solveRequests[0]!);
const wideResult = { ...solverResult, proofs: Array.from({ length: 64 }, () => solverResult.proofs[0]!), values: Array.from({ length: 64 }, () => solverResult.values[0]!) };
const exhausted = retainSolverEvidence({ ...blocked, problemIR: wide, solverResult: wideResult }, question, turnPlan);
assert.ok(exhausted.evidence.truncation.nodeLimitedFields > 0, "A whole-tree cap bounds compound artifacts");

const source = readFileSync(resolve(__dirname, "../lecture-lab/lecturePipeline.ts"), "utf8");
assert.match(source, /retainSolverEvidence\(problemAuthority, question, turnPlan\)/, "Actual lab assignment must use the bounded evidence serializer");
assert.match(source, /const solverAuthorityBlocked = problemAuthority\?\.audit\.status === "contradiction"/, "Blocking decision continues to read actual audit");
console.log("solver evidence gate: full mismatch/source/set/selection evidence, immutable verdict, whitelist and deterministic bounds passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
