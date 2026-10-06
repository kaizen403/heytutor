import {validateTurnPlanV3,type TurnPlanV3} from "../contracts/contractsV3";
import {admitFiniteBinomialProblem,readFiniteBinomialProgram} from "./finiteBinomialProgram";
import {finitePolynomialCoefficient,exactPolynomialNumber} from "../math/finitePolynomialExpansion";
import type {SceneIssue} from "../types";

function coefficientSymbol(question:string,symbol:string):boolean {
 if(/^(?:c|C|coef|coefficient)$/u.test(symbol))return true;
 const matched=/^(?:[cC]_?|a_|c_x)(\d+)$/u.exec(symbol),reading=readFiniteBinomialProgram(question);
 return !!matched && reading.status==="ok" && reading.source.request.kind==="coefficient" && Number(matched[1])===reading.source.request.exponent;
}
const dimensionless=(unit:unknown)=>unit===undefined || unit==="1";
const issue=(message:string,path="turnPlan"):SceneIssue=>({code:"finite_binomial_plan",severity:"fatal",message,path});
function exponentGiven(question:string,row:TurnPlanV3["givens"][number]):boolean{
 const reading=readFiniteBinomialProgram(question);if(reading.status!=="ok")return false;
 const root=reading.source.root;
 return root.kind==="binary" && root.operator==="^" && root.right.kind==="number" && row.symbol==="n" && row.value===root.right.value && dimensionless(row.unit) && row.provenance==="given";
}
/** Actual caller plan joins source roles and original whole-IR request identities. */
export function finiteBinomialPlanIssues(question:string,rawProblem:unknown,rawPlan:unknown):SceneIssue[]{
 if(readFiniteBinomialProgram(question).status!=="ok")return [];
 const admitted=admitFiniteBinomialProblem(question,rawProblem),checked=validateTurnPlanV3(rawPlan,question);
 if(admitted.status!=="ok")return [issue("The complete original polynomial IR must independently bind its source before plan admission")];
 if(!checked.valid || !checked.plan)return [issue("A structurally valid actual caller plan is required")];
 const plan=checked.plan;
 if(plan.givens.some(row=>!exponentGiven(question,row)))return [issue("Each numeric given must bind an independently recognized polynomial parameter")];
 const ids=new Set(admitted.outputs.map(row=>row.binding.turnPlanQuantityId));
 if(plan.derived.some(row=>!ids.has(row.id)) || plan.unknowns.some(row=>!ids.has(row.id)))return [issue("No unrelated numeric rows or unknowns may join the polynomial result")];
 for(const output of admitted.outputs){
  const derived=plan.derived.filter(row=>row.id===output.binding.turnPlanQuantityId),unknowns=plan.unknowns.filter(row=>row.id===output.binding.turnPlanQuantityId);
  if(!coefficientSymbol(question,output.binding.symbol) || derived.length!==1 || unknowns.length!==1 || derived[0]!.symbol!==output.binding.symbol || unknowns[0]!.symbol!==output.binding.symbol || derived[0]!.unit!=="1" || unknowns[0]!.unit!=="1" || derived[0]!.value!==output.value || derived[0]!.provenance!=="derived")return [issue("Every requested coefficient must retain its actual quantity identity, coefficient role, dimensionless unit and freshly recomputed value",output.binding.turnPlanQuantityId)];
 }
 return [];
}

/** The question alone can correct a recognized coefficient before IR planning.
 * It never manufactures IR or promotes that correction into whole-IR proof. */
export function applyFiniteBinomialAuthority(question:string,plan:TurnPlanV3,rawProblem?:unknown):{
 plan:TurnPlanV3;declineFigure:boolean;issueCodes:string[];corrections:Array<{quantityId:string;symbol:string;previous:number;corrected:number;unit?:string}>;
}|null{
 const reading=readFiniteBinomialProgram(question);if(reading.status!=="ok")return null;
 const givens=plan.givens.filter(row=>exponentGiven(question,row));
 const expected=reading.source.request.kind==="coefficient"?exactPolynomialNumber(finitePolynomialCoefficient(reading.source.expansion,reading.source.request.exponent)):null;
 const issueCodes:string[]=givens.length===plan.givens.length?[]:["finite_binomial_given_withdrawn"];
 const corrections:Array<{quantityId:string;symbol:string;previous:number;corrected:number;unit?:string}>=[];
 const derived:TurnPlanV3["derived"]=[],unknowns:TurnPlanV3["unknowns"]=[];
 const admitted=rawProblem==null?null:admitFiniteBinomialProblem(question,rawProblem);
 for(const row of plan.derived){
  const unknown=plan.unknowns.find(candidate=>candidate.id===row.id && candidate.symbol===row.symbol);
  const binding=admitted?.status==="ok"?admitted.outputs.find(output=>output.binding.turnPlanQuantityId===row.id)?.binding:null;
  const bound=expected!==null && coefficientSymbol(question,row.symbol) && unknown && dimensionless(row.unit) && dimensionless(unknown.unit) && (admitted===null || admitted.status==="ok" && binding?.symbol===row.symbol && binding.unit==="1");
  if(!bound){issueCodes.push("finite_binomial_row_withdrawn");continue;}
  if(row.value!==expected){corrections.push({quantityId:row.id,symbol:row.symbol,previous:row.value,corrected:expected,unit:"1"});issueCodes.push("finite_binomial_value_corrected");}
  derived.push({...row,value:expected,unit:"1",provenance:"derived",sourceText:`Source-verified ${row.symbol} = ${expected}`,...(row.sign===undefined?{}:{sign:expected>0?"positive":expected<0?"negative":"zero"}),...(row.dependsOn?{dependsOn:row.dependsOn.filter(id=>givens.some(given=>given.id===id))}:{})});
  unknowns.push({...unknown,unit:"1"});
 }
 if(plan.unknowns.length!==unknowns.length)issueCodes.push("finite_binomial_unknown_withdrawn");
 const corrected:TurnPlanV3={...plan,givens,derived,unknowns,qualitativeClaims:[]};
 if(plan.qualitativeClaims.length)issueCodes.push("finite_binomial_claims_withdrawn");
 const declineFigure=rawProblem!=null && finiteBinomialPlanIssues(question,rawProblem,corrected).length>0;
 return {plan:corrected,declineFigure,issueCodes,corrections};
}
