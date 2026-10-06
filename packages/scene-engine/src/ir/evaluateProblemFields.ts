import type {ProblemIR,ExpressionNodeIR} from "./problemIR";
/** Closed shape for bounded evaluation profiles; semantic obligations are still
 * proved below. Unknown fields are never erased to obtain a positive proof. */
export function hasOnlyEvaluateProblemFields(problem: ProblemIR): boolean {
  const fields = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
  const node = (root: ExpressionNodeIR): boolean => {
    switch(root.kind) {
      case "number": return fields(root,["kind","value"]);
      case "constant": case "variable": return fields(root,["kind","name"]);
      case "unary": return fields(root,["kind","operator","operand"]) && node(root.operand);
      case "binary": return fields(root,["kind","operator","left","right"]) && node(root.left) && node(root.right);
      case "call": return fields(root,["kind","function","argument"]) && node(root.argument);
    }
  };
  return fields(problem,["schemaVersion","id","question","facts","entities","expressions","constraints","representationIntents","solveRequests"])
    && problem.facts.every(row=>fields(row,["id","kind","statement","evidence"]) && fields(row.evidence,["source","start","end","quote"]))
    && problem.entities.every(row=>fields(row,["id","kind","label","evidenceFactIds"]))
    && problem.expressions.every(row=>fields(row,["id","valueType","root","evidenceFactIds"]) && node(row.root))
    && problem.constraints.every(row=>fields(row,row.kind === "equation" || row.kind === "inequality" ? ["id","kind","leftExpressionId","rightExpressionId","evidenceFactIds",...(row.kind === "inequality" ? ["relation"] : [])] : ["id","kind","entityIds","evidenceFactIds"]))
    && problem.representationIntents.every(row=>fields(row,["id","kind","entityIds","evidenceFactIds"]))
    && problem.solveRequests.every(row=>row.kind==="evaluate" && fields(row,["id","kind","expressionId","resultBinding"]) && !!row.resultBinding && fields(row.resultBinding,["turnPlanQuantityId","symbol","unit","evidenceFactIds"]));
}

