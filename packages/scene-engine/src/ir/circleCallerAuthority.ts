import {snapshotMathSourceData} from "../compile/mathSourceData";
import {validateTurnPlanV3,type TurnPlanV3} from "../contracts/contractsV3";
import {validateProblemIR} from "./problemIR";
import {hasOnlyEvaluateProblemFields} from "./evaluateProblemFields";
import {hasOnlyFiniteBinomialPlanFields} from "./finiteBinomialPlanAuthority";
import {readCircleSourceProgram,bindCircleSourceProblem,circleCoefficientRole,circleCoefficientValues,circleResultRole,circleRoleUnit,circleRoleValue,type CircleValueRole} from "./circleSourceProgram";
import {numeric} from "./circleSourceMath";
import type {SceneIssue} from "../types";
const issue=(path:string,message:string):SceneIssue=>({code:"circle_caller_authority",severity:"fatal",path:`sourceAuthority.${path}`,message});
const coefficientText=(text:string)=>/^(?:(?:the )?constant (?:term|coefficient)|coefficient of (?:x\^2(?: and y\^2)?|xy|x\*y|y\^2|x|y))$/.test(text.trim().replace(/²/g,"^2").replace(/\s+/g," ").toLowerCase());
const same=(a:number,b:number)=>Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b));
/** Own-data original Plan admission. Unsupported textual/graph obligations
 * decline as a whole before legacy reconciliation can remove them. */
export function circlePlanSourceIssues(question:string,rawPlan:unknown):SceneIssue[]{
 try{return circlePlanSourceIssuesFromData(question,rawPlan);}catch{return [issue("turnPlan","Unsupported original Plan data cannot grant circle authority")];}
}
function circlePlanSourceIssuesFromData(question:string,rawPlan:unknown):SceneIssue[]{
 const read=readCircleSourceProgram(question);if(read.status==="none")return [];
 if(read.status!=="ok")return [issue("question","Complete circle source is unsupported")];
 let raw:unknown;try{raw=snapshotMathSourceData(rawPlan);}catch{return [issue("turnPlan","Whole original Plan must remain bounded own data")];}
 if(!hasOnlyFiniteBinomialPlanFields(raw))return [issue("turnPlan","Every original Plan field must have known source semantics")];
 const checked=validateTurnPlanV3(raw,question);if(!checked.valid||!checked.plan||checked.plan.question!==question)return [issue("turnPlan","Complete valid original Plan is required")];
 const plan=raw as TurnPlanV3,source=read.source;
 if(plan.qualitativeClaims.length||plan.lawIds.length||plan.assumptions.length||plan.teachingSequenceHints?.length)return [issue("turnPlan","No circle claim, law, assumption or teaching hint has an independent whole-proposition proof in this profile")];
 const roles=new Map<string,CircleValueRole>();
 const rows=[...plan.givens,...plan.derived];
 if(new Set(rows.map(v=>v.id)).size!==rows.length||new Set(plan.unknowns.map(v=>v.id)).size!==plan.unknowns.length)return [issue("turnPlan","Original numeric identities must be unique")];
 for(const row of plan.givens){
  if(typeof row.sourceText!=="string")return [issue("turnPlan.givens","Every coefficient needs its complete typed source role")];
  const role=circleCoefficientRole(row.sourceText);
  if(!role||!coefficientText(row.sourceText??"")||row.symbol!==role||row.provenance!=="given"||!circleRoleUnit(role,row.unit)||row.dependsOn?.length||row.uncertainty!==undefined&&row.uncertainty!==0||!circleCoefficientValues(source,role).some(value=>same(row.value,numeric(value))))return [issue(`turnPlan.givens.${row.id}`,"Every original given must bind a complete literal source coefficient role")];
  if(rolesHas(roles,role))return [issue("turnPlan.givens","Each source coefficient role must be unambiguous")];
  roles.set(row.id,role);
 }
 for(const row of plan.derived){const role=circleResultRole(row.symbol);
  if(!role||!source.asks.includes(role)||row.provenance!=="derived"||!circleRoleUnit(role,row.unit)||row.uncertainty!==undefined&&row.uncertainty!==0||!same(row.value,circleRoleValue(source,role))||rolesHas(roles,role))return [issue(`turnPlan.derived.${row.id}`,"Every original output must bind one requested source role/value/unit")];
  if(row.sourceText!==undefined&&!source.equations.some(e=>row.sourceText===e.evidence.quote)&&row.sourceText!==`${row.symbol}=${row.value}`&&row.sourceText!==`${row.symbol} = ${row.value}`&&row.sourceText!==`Source-verified ${row.symbol}=${row.value}`&&row.sourceText!==`Source-verified ${row.symbol} = ${row.value}`)return [issue(`turnPlan.derived.${row.id}.sourceText`,"Output evidence must not carry unproved additional prose")];
  roles.set(row.id,role);
 }
 for(const row of rows){const value=row.value;if(row.sign!==undefined&&row.sign!=="unsigned"&&row.sign!==(value===0?"zero":value>0?"positive":"negative"))return [issue(`turnPlan.${row.id}.sign`,"Every original sign must agree with its source value")];}
 for(const unknown of plan.unknowns){const role=circleResultRole(unknown.symbol),output=plan.derived.find(v=>v.id===unknown.id);if(!role||!source.asks.includes(role)||!circleRoleUnit(role,unknown.unit)||!output||output.symbol!==unknown.symbol||output.unit!==unknown.unit)return [issue("turnPlan.unknowns","Every original unknown must retain its exact requested scalar output identity")];}
 if(source.asks.some(role=>plan.derived.filter(v=>roles.get(v.id)===role).length!==1||plan.unknowns.filter(v=>roles.get(v.id)===role).length!==1))return [issue("turnPlan","Every whole-source numeric request must remain represented")];
 const graph=new Map(rows.map(v=>[v.id,v.dependsOn??[]]));const active=new Set<string>(),done=new Set<string>();
 const acyclic=(id:string):boolean=>{if(active.has(id))return false;if(done.has(id))return true;active.add(id);for(const dep of graph.get(id)??[])if(!graph.has(dep)||!acyclic(dep))return false;active.delete(id);done.add(id);return true;};
 if(rows.some(v=>!acyclic(v.id)))return [issue("turnPlan.dependsOn","Every original dependency must be present and acyclic")];
 const support=(id:string):Set<CircleValueRole>=>{const out=new Set<CircleValueRole>();for(const dep of graph.get(id)??[]){const role=roles.get(dep)!;if(["A","B","C","D","E","F"].includes(role))out.add(role);else for(const r of support(dep))out.add(r);}return out;};
 for(const row of plan.derived){const role=roles.get(row.id)!;const required:CircleValueRole[]=role==="center_x"?["A","D"]:role==="center_y"?["A","E"]:["A","D","E","F"];
  const got=support(row.id);if(required.some(v=>!got.has(v))||[...got].some(v=>!required.includes(v)&&!(v==="C"&&required.includes("A")))||(row.dependsOn??[]).some(id=>{const r=roles.get(id)!;return r===role||r==="radius"||r==="radius_squared"&&role!=="radius"||r==="center_y"&&role==="center_x"||r==="center_x"&&role==="center_y";}))return [issue(`turnPlan.derived.${row.id}.dependsOn`,"The complete original operand DAG must prove exactly the source result formula")];
 }
 // Multiple equivalent source equations may have different scaling. All used
 // coefficients must come from one coherent original polynomial, not a mix.
 if(plan.givens.length&&!source.equations.some(e=>plan.givens.every(v=>{const role=roles.get(v.id)!;const values=circleCoefficientValues({...source,equations:[e]},role);return values.length===1&&same(v.value,numeric(values[0]!));})))return [issue("turnPlan.givens","Original coefficient scalars must share one whole source equation")];
 return [];
}
const rolesHas=(roles:Map<string,CircleValueRole>,role:CircleValueRole)=>[...roles.values()].includes(role);
/** Every original IR obligation and request identity is independently bound;
 * generated scene data never substitutes for the original graph. */
export function circleCallerIssues(question:string,rawProblem:unknown,rawPlan:unknown):SceneIssue[]{
 try{return circleCallerIssuesFromData(question,rawProblem,rawPlan);}catch{return [issue("problemIR","Unsupported original caller data cannot grant circle authority")];}
}
function circleCallerIssuesFromData(question:string,rawProblem:unknown,rawPlan:unknown):SceneIssue[]{
 const read=readCircleSourceProgram(question);if(read.status==="none")return [];
 const planIssues=circlePlanSourceIssues(question,rawPlan);if(planIssues.length)return planIssues;
 let data:{problem:unknown;plan:TurnPlanV3};try{data=snapshotMathSourceData({problem:rawProblem,plan:rawPlan as TurnPlanV3});}catch{return [issue("problemIR","Whole original caller must remain bounded own data")];}
 const checked=validateProblemIR(data.problem,question);if(!checked.valid||!checked.problem||!hasOnlyEvaluateProblemFields(checked.problem))return [issue("problemIR","Every original circle IR field must have supported whole-source semantics")];
 const binding=bindCircleSourceProblem(question,data.problem);if(!binding)return [issue("problemIR","Every original circle graph obligation must bind the complete source")];
 if(read.status!=="ok"||read.source.asks.some(role=>binding.requestBindings.filter(v=>v.role===role).length!==1))return [issue("problemIR.solveRequests","Every whole-source numeric ask needs its original complete typed request")];
 if(binding.requestBindings.length!==data.plan.unknowns.length||binding.requestBindings.length!==data.plan.derived.length)return [issue("problemIR.solveRequests","No original requested output may disappear or borrow an unrelated result")];
 for(const request of binding.requestBindings){const row=data.plan.derived.find(v=>v.id===request.quantityId),unknown=data.plan.unknowns.find(v=>v.id===request.quantityId);
  if(!row||!unknown||row.symbol!==request.symbol||unknown.symbol!==request.symbol||row.unit!==request.unit||unknown.unit!==request.unit||circleResultRole(row.symbol)!==request.role||!same(row.value,request.value))return [issue(`problemIR.solveRequests.${request.requestId}`,"Every complete original result binding must join its actual Plan identity, role, unit and source value")];
 }
 return [];
}
