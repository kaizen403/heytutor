import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { validateLinearSourcePlan } from "../../src/compile/linearSourceAgreement";
import { buildLinearSourceDocument } from "../../src/compile/linearRegionSource";
import { compileSceneDocument, validateSceneDocument } from "../../src/index";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";
import { parseScenePlannerResponseJson } from "../../../tutor-core/src/planners/scenePlannerV2";

// An offline diagnostic over immutable recordings. MAIN summaries are explicit
// reconstructions; neither a raw candidate nor this replay is a committed turn.
const args = process.argv.slice(2);
const dirs = args.filter(arg => arg.startsWith("--capture-dir=")).map(arg => resolve(arg.slice("--capture-dir=".length)));
if (!dirs.length) throw new Error("Provide one or more --capture-dir= paths");
const baseline = args.find(arg => arg.startsWith("--baseline-source="))?.slice("--baseline-source=".length);
const checkPlan: typeof validateLinearSourcePlan = baseline ? (await import(pathToFileURL(resolve(baseline, "compile/linearSourceAgreement.ts")).href)).validateLinearSourcePlan : validateLinearSourcePlan;
const checkAudit: typeof verifyTurnPlanAgainstSolver = baseline ? (await import(pathToFileURL(resolve(baseline, "ir/solverAuthority.ts")).href)).verifyTurnPlanAgainstSolver : verifyTurnPlanAgainstSolver;
const provider = new LocalDeterministicSolverProvider();
const rows = [];
for (const dir of dirs) for (const file of readdirSync(dir).filter(name => name.endsWith(".json")).sort()) {
  const bytes = readFileSync(resolve(dir, file));
  const capture = JSON.parse(bytes.toString());
  const evidence = capture.solver?.evidence;
  const originalPlan = Boolean(evidence?.turnPlan);
  const plan = evidence?.turnPlan ?? {
    schemaVersion: "turn-plan/v3", question: capture.question,
    visualRequirement: capture.plan.visualRequirement,
    givens: capture.plan.givens, unknowns: capture.plan.unknowns,
    derived: capture.plan.derived.map((quantity: object) => ({ ...quantity, provenance: "derived" })),
    qualitativeClaims: [], lawIds: [], assumptions: [],
  };
  const planIssues = checkPlan(capture.question, plan);
  const document = buildLinearSourceDocument(capture.question);
  const source = document ? compileSceneDocument(document) : null;
  const result = evidence?.problemIR ? await provider.solve(evidence.problemIR) : null;
  const audit = result ? checkAudit(evidence.problemIR, result, plan, capture.question) : null;
  const candidates = (args.includes("--skip-candidates") ? [] : capture.diagram.plannerResponses ?? []).map((response: { rawContent: string }) => {
    const raw = parseScenePlannerResponseJson(response.rawContent);
    const validation = validateSceneDocument(raw);
    const trusted = validation.document?.source.question === capture.question;
    const compiled = trusted && validation.document ? compileSceneDocument(validation.document) : null;
    return { rawContentSha256: createHash("sha256").update(response.rawContent).digest("hex"), accepted: Boolean(compiled?.ok && compiled.renderScene), issues: compiled?.report.issues ?? validation.report.issues };
  });
  rows.push({ arm: dir.split("/").at(-2), probeId: capture.probeId, captureSha256: createHash("sha256").update(bytes).digest("hex"), originalPlan, originalIR: Boolean(evidence?.problemIR), recordedCommitted: capture.diagram.committed,
    planAccepted: planIssues.length === 0, planIssues, sourceCompiled: Boolean(source?.ok && source.renderScene), solverStatus: audit?.status, solverIssues: audit?.issues, selections: audit?.bindings.map(binding => binding.selection), candidates });
}
const summary = [...new Set(rows.map(row => row.arm))].map(arm => {
  const group = rows.filter(row => row.arm === arm);
  return { arm, rows: group.length, originalPlans: group.filter(row => row.originalPlan).length, reconstructedPlans: group.filter(row => !row.originalPlan).length,
    planAccepted: group.filter(row => row.planAccepted).length, planRefused: group.filter(row => !row.planAccepted).length,
    sourceCompiled: group.filter(row => row.sourceCompiled).length, sourcePlanAccepted: group.filter(row => row.sourceCompiled && row.planAccepted).length,
    solverVerified: group.filter(row => row.solverStatus === "verified").length, solverContradictions: group.filter(row => row.solverStatus === "contradiction").length,
    solverIncomplete: group.filter(row => row.solverStatus === "incomplete").length,
    rawCandidates: group.reduce((sum, row) => sum + row.candidates.length, 0), rawCandidateAccepted: group.reduce((sum, row) => sum + row.candidates.filter(candidate => candidate.accepted).length, 0) };
});
const output = args.find(arg => arg.startsWith("--output="))?.slice("--output=".length);
if (output) writeFileSync(output, JSON.stringify({ baseline: baseline ?? null, summary, rows }, null, 2) + "\n");
console.log(JSON.stringify(summary));
