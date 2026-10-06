import {snapshotMathSourceData} from "../compile/mathSourceData";
import {hasOnlyEvaluateProblemFields} from "../ir/evaluateProblemFields";
import {hasOnlyFiniteBinomialPlanFields} from "../ir/finiteBinomialPlanAuthority";
import { validateTurnPlanV3 } from "../contracts/contractsV3";
import { validateProblemIR } from "../ir/problemIR";
import { readUniformCircularRuntimeContract, uniformCircularRuntimePlanConflicts, uniformCircularRuntimeProblemIssues } from "./uniformCircularAuthority";
import { stalePlanQuantities } from "./uniformCircularSource";
import type { SceneIssue } from "../types";

/** Full caller evidence is mandatory for the bounded live circular-state program.
 * Standalone geometry compilation and broader historical states keep their own
 * contracts. No regenerated document can replace the caller's IR or plan here.
 */
export function uniformCircularCallerIssues(question: string, rawProblem: unknown, rawPlan: unknown): SceneIssue[] {
  const reading = readUniformCircularRuntimeContract(question);
  if (!reading) return [];
  const fail = (path: string, message: string): SceneIssue => ({ code: "ucm_caller_authority", severity: "fatal", path: `sourceAuthority.${path}`, message });
  if (reading.status === "declined") return [fail("question", "The whole circular source is outside the supported runtime contract")];
  if (rawProblem == null || rawPlan == null) return [fail("problemIR", "Circular runtime authority requires the complete original caller IR and actual plan")];
  let captured:{problem:unknown;plan:unknown};
  try{captured=snapshotMathSourceData({problem:rawProblem,plan:rawPlan});}catch{return [fail("problemIR","Complete circular caller must be bounded own data")];}
  if(!hasOnlyFiniteBinomialPlanFields(captured.plan))return [fail("turnPlan","Every original circular Plan field must be recognized")];
  const problem = validateProblemIR(captured.problem, question);
  const plan = validateTurnPlanV3(captured.plan, question);
  if (!problem.valid || !problem.problem || !plan.valid || !plan.plan) return [fail("problemIR", "Circular runtime authority requires valid complete caller IR and plan")];
  if(!hasOnlyEvaluateProblemFields(problem.problem))return [fail("problemIR","Every original circular IR field must be recognized")];
  const issues = uniformCircularRuntimeProblemIssues(reading.contract, problem.problem);
  if (uniformCircularRuntimePlanConflicts(question, plan.plan).length || stalePlanQuantities(reading.contract.source, plan.plan).length) {
    issues.push(fail("turnPlan", "All circular inputs, outputs, claims and assumptions must bind the fresh source state"));
  }
  const unit = (value: string | undefined) => value?.normalize("NFKC").replace(/\s/g, "").replace(/m\/s2$/, "m/s^2");
  for (const request of problem.problem.solveRequests) {
    const binding = request.resultBinding;
    const unknown = binding && plan.plan.unknowns.find(row => row.id === binding.turnPlanQuantityId);
    const derived = binding && plan.plan.derived.find(row => row.id === binding.turnPlanQuantityId);
    if (!binding || !unknown || unknown.symbol !== binding.symbol || unit(unknown.unit) !== unit(binding.unit)
      || derived && (derived.symbol !== binding.symbol || unit(derived.unit) !== unit(binding.unit))) {
      issues.push(fail(`problemIR.solveRequests.${request.id}.resultBinding`, "Every original result binding must join the actual requested plan ID, symbol and unit"));
    }
  }
  return issues;
}
