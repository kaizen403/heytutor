import { validateProblemIR } from "./problemIR";
import { checkStatedCircuitProblemBinding } from "./statedCircuitProblemBinding";
import { readStatedCircuitProblemSource } from "./statedCircuitAuthority";
import { visualObligationIssues } from "../synthesize/visualObligations";
import { uniformCircularProblemSourceIssues } from "../physics/uniformCircularIdentity";
import type { SceneDocument, SceneIssue } from "../types";

/** Re-establish the actual caller's whole-IR authority at each scene boundary. */
export function validateSceneSourceAuthority(document: SceneDocument, question: string, rawProblem?: unknown): SceneIssue[] {
  const issues = readStatedCircuitProblemSource(question)
    ? checkStatedCircuitProblemBinding(question, rawProblem, document) : [];
  if (rawProblem == null) return issues;
  const checked = validateProblemIR(rawProblem, question);
  if (!checked.valid || !checked.problem) return [...issues, { code: "source_problem_ir", severity: "fatal",
    message: "Caller ProblemIR is invalid for the actual source", path: "sourceAuthority.problemIR" }];
  return [...issues, ...uniformCircularProblemSourceIssues(document, checked.problem), ...visualObligationIssues(checked.problem, document)];
}
