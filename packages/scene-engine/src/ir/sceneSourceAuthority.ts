import {finiteBinomialPlanIssues} from "./finiteBinomialPlanAuthority";
import { finiteProgressionDocumentIssues } from "../contracts/finiteProgressionContract";
import { finiteBinomialDocumentIssues } from "../contracts/finiteBinomialContract";
import { validateStaticContactTriangleSource } from "./staticContactTriangle";
import { validateOpticalConjugateSource } from "./opticalConjugateProgram";
import { validatePointLineProgramSource } from "./pointLineProgram";
import {readCircleSourceProgram,checkCircleSourceProblemBinding} from "./circleSourceProgram";
import {validateSectionFormulaProblemSource,readSectionFormulaSource} from "./sectionFormulaSource";
import { validateProblemIR } from "./problemIR";
import { checkStatedCircuitProblemBinding } from "./statedCircuitProblemBinding";
import { readStatedCircuitProblemSource } from "./statedCircuitAuthority";
import { visualObligationIssues } from "../synthesize/visualObligations";
import { uniformCircularProblemSourceIssues } from "../physics/uniformCircularIdentity";
import { relativeMotionSource, relativeMotionSourceEntityBindings } from "../physics/relativeMotionSource";
import type { SceneDocument, SceneIssue } from "../types";

/** Re-establish the actual caller's whole-IR authority at each scene boundary. */
export function validateSceneSourceAuthority(document: SceneDocument, question: string, rawProblem?: unknown, rawPlan?: unknown): SceneIssue[] {
  const progressionIssues = finiteProgressionDocumentIssues(document, {question, problemIR: rawProblem, turnPlan: rawPlan});
  if (progressionIssues.length) return progressionIssues;
  const sectionReading=readSectionFormulaSource(question);
  if(sectionReading.status==="declined")return [{code:"section_source_declined",severity:"fatal",message:`Whole section source is unsupported: ${sectionReading.reason}`,path:"sourceAuthority.question"}];
  const circleReading = readCircleSourceProgram(question);
  if (circleReading.status === "declined") return [{
    code: "circle_source_declined", severity: "fatal",
    message: `Whole Cartesian circle source is unsupported: ${circleReading.reason}`,
    path: "sourceAuthority.question",
  }];
  const issues = [
    ...finiteBinomialDocumentIssues(document, {question, problemIR: rawProblem}),
    ...(rawPlan==null?[]:finiteBinomialPlanIssues(question,rawProblem,rawPlan)),
    ...validateOpticalConjugateSource(document, question, rawProblem),
    ...validatePointLineProgramSource(document, question, rawProblem),
    ...validateSectionFormulaProblemSource(document,question,rawProblem),
    ...(circleReading.status==="ok" ? checkCircleSourceProblemBinding(question,rawProblem,document):[]),
    ...validateStaticContactTriangleSource(document, question, rawProblem),
    ...(readStatedCircuitProblemSource(question) ? checkStatedCircuitProblemBinding(question, rawProblem, document) : []),
  ];
  if (rawProblem == null) return issues;
  const checked = validateProblemIR(rawProblem, question);
  if (!checked.valid || !checked.problem) return [...issues, { code: "source_problem_ir", severity: "fatal",
    message: "Caller ProblemIR is invalid for the actual source", path: "sourceAuthority.problemIR" }];
  if (relativeMotionSource(question)?.status === "admitted" && !relativeMotionSourceEntityBindings(question, checked.problem)) {
    issues.push({code:"relative_source_identity",severity:"fatal",message:"Every caller entity must bind one distinct source motion actor",path:"sourceAuthority.problemIR.entities"});
  }
  return [...issues, ...uniformCircularProblemSourceIssues(document, checked.problem), ...visualObligationIssues(checked.problem, document, rawPlan)];
}
