import assert from 'node:assert/strict';
import * as engine from '../../src/index';
import type {ExpressionNodeIR,ProblemIR,TurnPlanV3} from '../../src/index';
const num=(value:number):ExpressionNodeIR=>({kind:'number',value});
const op=(operator:'+'|'-'|'*'|'/',left:ExpressionNodeIR,right:ExpressionNodeIR):ExpressionNodeIR=>({kind:'binary',operator,left,right});
type Input={problem:ProblemIR;plan:TurnPlanV3};
function input(d = 2.675, error = 0.02, main = 2.5, expected = 39, unit = "mm", factor = 1): Input {
  const scales = `Least count corresponding to the main scale and circular scale of a screw gauge are ${0.5 / factor} ${unit} and ${0.005 / factor} ${unit}, respectively.`;
  const wire = `A wire of diameter ${d / factor} ${unit}`;
  const zero = `zero error of the screw gauge is ${error < 0 ? "-" : "+"}${Math.abs(error) / factor} ${unit}`;
  const ask = `What would be the reading of divisions on circular scale of the screw gauge, if the ${zero}?`;
  const question = `${scales} ${wire} is measured with the screw gauge. ${ask}`;
  const quote = (text: string) => ({ source: "question" as const, start: question.indexOf(text), end: question.indexOf(text) + text.length, quote: text });
  const facts: ProblemIR["facts"] = [
    { id: "P", kind: "given", statement: "main scale pitch", evidence: quote(scales) },
    { id: "L", kind: "given", statement: "least count", evidence: quote(scales) },
    { id: "D", kind: "given", statement: "wire diameter", evidence: quote(wire) },
    { id: "E", kind: "given", statement: "zero error", evidence: quote(zero) },
    { id: "Q", kind: "requested", statement: "circular scale divisions", evidence: quote(ask) },
  ];
  const all = ["P", "L", "D", "E", "Q"];
  const observed = op("+", num(d), num(error));
  const mainRoot = op("*", num(0.5), num(main / 0.5));
  const problem: ProblemIR = { schemaVersion: "problem-ir/v1", id: "independentMeasurement", question, facts,
    entities: [{ id: "object", kind: "body", label: "wire", evidenceFactIds: ["D"] }, { id: "instrument", kind: "component", label: "screw gauge", evidenceFactIds: ["P", "L", "E"] }],
    expressions: [
      { id: "answer", valueType: "scalar", root: op("/", op("-", observed, mainRoot), num(0.005)), evidenceFactIds: all },
      { id: "obs", valueType: "scalar", root: observed, evidenceFactIds: ["D", "E"] },
      { id: "obsProof", valueType: "scalar", root: structuredClone(observed), evidenceFactIds: ["D", "E"] },
      { id: "main", valueType: "scalar", root: mainRoot, evidenceFactIds: ["P", "D", "E"] },
      { id: "least", valueType: "scalar", root: num(0.005), evidenceFactIds: ["L"] },
    ], constraints: [{ id: "correction", kind: "equation", leftExpressionId: "obs", rightExpressionId: "obsProof", evidenceFactIds: ["D", "E"] }],
    representationIntents: [{ id: "concept", kind: "conceptual", entityIds: ["object"], evidenceFactIds: ["D"] }],
    solveRequests: [{ id: "readout", kind: "evaluate", expressionId: "answer", resultBinding: { turnPlanQuantityId: "caller_count", symbol: "N_c", unit: "division", evidenceFactIds: all } }],
  };
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question,
    givens: [
      { id: "caller_p", symbol: "p", value: 0.5 / factor, unit, provenance: "given", sourceText: `pitch ${scales}` },
      { id: "caller_l", symbol: "LC", value: 0.005 / factor, unit, provenance: "given", sourceText: `least count ${scales}` },
      { id: "caller_d", symbol: "d", value: d / factor, unit, provenance: "given", sourceText: `diameter ${wire}` },
      { id: "caller_e", symbol: "e_0", value: error / factor, unit, provenance: "given", sourceText: `zero error ${zero}` },
    ], unknowns: [{ id: "caller_count", symbol: "N_c", unit: "division" }],
    derived: [{ id: "caller_count", symbol: "N_c", value: expected, unit: "division", provenance: "derived", dependsOn: ["caller_p", "caller_l", "caller_d", "caller_e"], sourceText: facts.map(f => f.evidence.quote).join(" | ") }],
    qualitativeClaims: [{ id: "countclaim", claim: "circular_divisions", expected, relatedQuantityIds: ["caller_count"] }], lawIds: ["micrometer_reading"], assumptions: [], visualRequirement: "none" };
  return { problem, plan };
}
let checks=0;
function check(v:unknown,m:string){assert(v,m);checks++;}
for(const [d,error,main,expected] of [[2.675,.02,2.5,39],[2.675,-.02,2.5,31],[2.49,.02,2.5,2],[2.51,-.02,2,98],[2.5,0,2.5,0]]){
 const original=input(d,error,main,expected),snapshot=JSON.stringify(original),stale=structuredClone(original.plan);stale.derived[0]!.value=777;
 const early=engine.applySourceQuantityAuthority(stale,null,original.problem.question);
 check(early.plan.derived[0]?.value===expected,'question-only early correction has independent known count');
 check(early.plan.unknowns[0]?.id===original.plan.unknowns[0]!.id,'actual request identity retained');
 const full=engine.applySourceQuantityAuthority(early.plan,original.problem,original.problem.question);
 check(full.plan.derived[0]?.value===expected,'whole actual graph admits independently checked count');
 check(engine.verifyMeasurementSourceAuthority(original.problem,full.plan).status==='verified','original full IR is still required');
 const contradictory=structuredClone(original.problem);contradictory.facts[3]!.statement='zero error is 99 mm';
 const withdrawn=engine.applySourceQuantityAuthority(early.plan,contradictory,original.problem.question);
 check(withdrawn.plan.derived.length===0 && withdrawn.plan.unknowns.length===0 && withdrawn.plan.qualitativeClaims.length===0,'malformed fact roles never bypass registry eligibility');
 for(const defect of ['role','unit','quote','duplicate','apparatus'] as const){
  const bad=structuredClone(stale);
  if(defect==='role'){bad.derived[0]!.symbol='speed';bad.unknowns[0]!.symbol='speed';}
  if(defect==='unit')bad.unknowns[0]!.unit='m';
  if(defect==='quote')bad.givens[0]!.sourceText='pitch 99 mm';
  if(defect==='duplicate')bad.givens.push({...bad.givens[0]!,id:'duplicate'});
  if(defect==='apparatus')bad.visualRequirement='required';
  const result=engine.applyMeasurementQuestionAuthority(original.problem.question,bad);assert(result);
  check(defect==='apparatus'?result.declineFigure:result.plan.derived.length===0 && result.plan.unknowns.length===0,`${defect} early roles decline`);
 }
 check(JSON.stringify(original)===snapshot,'no IR/Plan manufacture or mutation');
}
check(engine.applyMeasurementQuestionAuthority('A car moves at 10 m/s.',input().plan)===null,'unrelated source remains untouched');
console.log(`PASS ${checks} micrometer early-role and complete actual graph registry controls; no whole-IR certification from question-only evidence`);
