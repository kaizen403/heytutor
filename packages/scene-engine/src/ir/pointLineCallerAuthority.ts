/** Complete caller audit for the source-owned Euclidean projection operator.
 * This module proves obligations; it never rewrites Plan/IR or emits ink. */
import { snapshotMathSourceData } from "../compile/mathSourceData";
import { validateProblemIR, expressionToSafeSource, type ProblemIR, type ExpressionNodeIR, type SolveResultBinding } from "./problemIR";
import { readPointLineProgram, type PointLineProgramReading } from "./pointLineProgram";
import { readPointLineSourceLiterals, pointLineCaptionAgrees } from "./pointLineSource";
import { createPlanarArithmeticProof, type PlanarProofRole } from "./planarArithmeticProof";
import { validateTurnPlanV3 } from "../contracts/contractsV3";
import { hasOnlyFiniteBinomialPlanFields } from "./finiteBinomialPlanAuthority";
import { parseMathExpression } from "../math/expression";
import type { SceneIssue } from "../types";

type Reading = Extract<PointLineProgramReading, {status:"ok"}>;
type Role = "distance" | "x" | "y";
export interface PointLineCallerBinding {
  problem: ProblemIR; reading: Reading; pointId: string; lineId: string; footId?: string;
  footIdentity: string; outputs: Array<{role:Role; binding:SolveResultBinding; expressionId:string; value:number}>;
}
const close = (a:number,b:number) => Math.abs(a-b)<=64*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b));
const unitless = (unit:unknown) => unit===undefined || unit==="1" || unit==="unit" || unit==="units";
// `length` is an abstract Cartesian result dimension, never an SI scale or
// permission for a physical given. Coordinates/coefficient inputs stay unitless.
export const pointLineResultUnit = (unit:unknown) => unitless(unit) || unit==="length";
const N=(value:number):ExpressionNodeIR=>({kind:"number",value});
const B=(operator:"+"|"-"|"*"|"/"|"^",left:ExpressionNodeIR,right:ExpressionNodeIR):ExpressionNodeIR=>({kind:"binary",operator,left,right});
const C=(fn:"sqrt"|"abs",argument:ExpressionNodeIR):ExpressionNodeIR=>({kind:"call",function:fn,argument});
function formulas(r:Reading):Record<Role,ExpressionNodeIR>{
  const {point:p,line:l}=r;
  const residual=B("-",B("+",B("*",N(l.a),N(p.x)),B("*",N(l.b),N(p.y))),N(-l.c));
  const norm=B("+",B("^",N(l.a),N(2)),B("^",N(l.b),N(2)));
  return {distance:B("/",C("abs",residual),C("sqrt",norm)),x:B("-",N(p.x),B("/",B("*",N(l.a),residual),norm)),y:B("-",N(p.y),B("/",B("*",N(l.b),residual),norm))};
}
function evaluate(node:ExpressionNodeIR):number {return parseMathExpression(expressionToSafeSource(node)).evaluate(0);}
/** Fold only a subtree of the independently constructed source formula. This
 * permits partial arithmetic without replacing an unrelated AST by its answer. */
function sameFormula(actual:ExpressionNodeIR,expected:ExpressionNodeIR):boolean{
  if(actual.kind==="number")return expected.kind==="number" ? actual.value===expected.value : close(actual.value,evaluate(expected));
  if(actual.kind==="unary" && actual.operator==="-" && actual.operand.kind==="number" && expected.kind==="number")return -actual.operand.value===expected.value;
  if(actual.kind==="binary" && expected.kind==="binary"){
    if(actual.operator==="^" || expected.operator==="^")return actual.operator===expected.operator
      && actual.right.kind==="number" && expected.right.kind==="number"
      && Number.isInteger(actual.right.value) && actual.right.value>=0 && actual.right.value<=4
      && actual.right.value===expected.right.value && sameFormula(actual.left,expected.left);
    if(actual.operator===expected.operator && sameFormula(actual.left,expected.left) && sameFormula(actual.right,expected.right))return true;
    // Signed source constants may be written as addition or subtraction.
    if(actual.operator==="+" && expected.operator==="-" && sameFormula(actual.left,expected.left))return actual.right.kind==="number" && (expected.right.kind==="number" ? actual.right.value===-expected.right.value : close(actual.right.value,-evaluate(expected.right)));
    return false;
  }
  return actual.kind==="call" && expected.kind==="call" && actual.function===expected.function && sameFormula(actual.argument,expected.argument);
}
/** Inspect the original IR tree before any structural or folded admission. */
function originalExpressionDefined(root:ExpressionNodeIR):boolean {
  let budget=512;
  function value(node:ExpressionNodeIR):number {
    if(--budget<0)throw new Error("expression domain budget");
    let result:number;
    if(node.kind==="number")result=node.value;
    else if(node.kind==="unary"){
      const operand=value(node.operand);result=node.operator==="-"?-operand:operand;
    }else if(node.kind==="binary"){
      const left=value(node.left),right=value(node.right);
      if(node.operator==="/"&&right===0)throw new Error("original zero divisor");
      if(node.operator==="^"&&(node.right.kind!=="number"||!Number.isInteger(right)||right<0||right>4))throw new Error("original unsupported power parameter");
      result=node.operator==="+"?left+right:node.operator==="-"?left-right:node.operator==="*"?left*right:node.operator==="/"?left/right:left**right;
    }else if(node.kind==="call"){
      const operand=value(node.argument);
      if(node.function!=="abs"&&node.function!=="sqrt"||node.function==="sqrt"&&operand<0)throw new Error("original function domain");
      result=node.function==="abs"?Math.abs(operand):Math.sqrt(operand);
    }else throw new Error("original nonliteral role");
    if(!Number.isFinite(result))throw new Error("original nonfinite expression");
    return result;
  }
  try{value(root);return true;}catch{return false;}
}
function record(raw:unknown,keys:readonly string[]):raw is Record<string,unknown>{
  if(!raw || typeof raw!=="object" || Array.isArray(raw))return false;
  const proto=Object.getPrototypeOf(raw);if(proto!==Object.prototype && proto!==null)return false;
  return Reflect.ownKeys(raw).every(key=>typeof key==="string" && keys.includes(key) && "value" in Object.getOwnPropertyDescriptor(raw,key)!);
}
function closedIR(raw:unknown):raw is ProblemIR {
  if(!record(raw,["schemaVersion","id","question","facts","entities","expressions","constraints","representationIntents","solveRequests"]))return false;
  const array=(key:string,keys:string[])=>Array.isArray(raw[key]) && (raw[key] as unknown[]).every(row=>record(row,keys));
  if(!array("facts",["id","kind","statement","evidence"]) || !array("entities",["id","kind","label","evidenceFactIds"]) || !array("expressions",["id","valueType","root","evidenceFactIds"]) || !array("representationIntents",["id","kind","entityIds","evidenceFactIds"]) || !array("constraints",["id","kind","entityIds","evidenceFactIds"]) || !array("solveRequests",["id","kind","expressionId","resultBinding"]))return false;
  const ast=(node:unknown):boolean=>{
    if(!record(node,["kind","value","operator","left","right","operand","function","argument"]))return false;
    switch(node.kind){
      case "number":return record(node,["kind","value"]);
      case "unary":return record(node,["kind","operator","operand"]) && ast(node.operand);
      case "binary":return record(node,["kind","operator","left","right"]) && ast(node.left) && ast(node.right);
      case "call":return record(node,["kind","function","argument"]) && ast(node.argument);
      default:return false;
    }
  };
  return (raw.facts as ProblemIR["facts"]).every(f=>record(f.evidence,["source","start","end","quote"]))
    && (raw.expressions as ProblemIR["expressions"]).every(e=>ast(e.root))
    && (raw.solveRequests as ProblemIR["solveRequests"]).every(s=>record(s.resultBinding,["turnPlanQuantityId","symbol","unit","evidenceFactIds"]));
}
function footRole(symbol:string,identity:string):Role|null {
  // Actor identifiers compare exactly, including case. Generic foot names
  // refer to the one typed requested entity, never to an arbitrary alias.
  if([`x_${identity}`,`x${identity}`,`${identity}_x`,`${identity}x`,"x_foot","xfoot","footx"].includes(symbol))return "x";
  if([`y_${identity}`,`y${identity}`,`${identity}_y`,`${identity}y`,"y_foot","yfoot","footy"].includes(symbol))return "y";
  return null;
}
const footAsk=(quote:string)=>/\b(?:perpendicular\s+foot|foot\s+of\s+(?:the\s+)?perpendicular)\b/i.test(quote);
/** Original full IR must account for every fact, entity, expression, relation,
 * intent and request, not merely contain one correct answer. */
export function bindPointLineCaller(question:string,raw:unknown):PointLineCallerBinding|null{
  try { raw=snapshotMathSourceData(raw); } catch { return null; }
  const reading=readPointLineProgram(question);if(reading.status!=="ok" || !closedIR(raw))return null;
  const checked=validateProblemIR(raw,question);if(!checked.valid || !checked.problem || raw.question!==question)return null;
  const problem=checked.problem,facts=new Map(problem.facts.map(f=>[f.id,f]));
  const kinds=new Map<string,"point"|"line"|"distance"|"foot"|"both">();
  for(const f of problem.facts){
    const evidence=f.evidence;
    if(evidence.end!==evidence.start+evidence.quote.length || question.slice(evidence.start,evidence.end)!==evidence.quote)return null;
    if(f.kind==="given" && f.statement!==evidence.quote)return null;
    if(f.kind==="requested" && f.statement!==evidence.quote && !["perpendicular foot",`perpendicular distance from ${reading.point.name??"point"} to line`].includes(f.statement))return null;
    const source=readPointLineSourceLiterals(f.evidence.quote);
    if(f.kind==="given" && source?.points.length===1 && source.lines.length===0 && !source.unreadPoint && source.points[0]!.x===reading.point.x && source.points[0]!.y===reading.point.y && (reading.point.origin || source.points[0]!.name===reading.point.name))kinds.set(f.id,"point");
    else if(f.kind==="given" && source?.lines.length===1 && source.points.length===0 && !source.unreadEquation && ["a","b","c"].every(k=>source.lines[0]![k as "a"]===reading.line[k as "a"]))kinds.set(f.id,"line");
    else if(f.kind==="requested"){
      const distance=/\bdistance\b/i.test(f.evidence.quote),foot=footAsk(f.evidence.quote);
      if(distance && !reading.requests.distance || foot && !reading.requests.foot || !distance && !foot)return null;
      kinds.set(f.id,distance && foot?"both":distance?"distance":"foot");
    }else return null;
  }
  if([...kinds.values()].filter(kind=>kind==="point").length!==1 || [...kinds.values()].filter(kind=>kind==="line").length!==1 || [...kinds.values()].filter(kind=>kind==="distance" || kind==="both").length>1 || [...kinds.values()].filter(kind=>kind==="foot" || kind==="both").length>1)return null;
  const has=(ids:string[],kind:string)=>ids.some(id=>kinds.get(id)===kind || kinds.get(id)==="both" && ["distance","foot"].includes(kind));
  const only=(ids:string[],kind:string)=>ids.length>0 && ids.every(id=>kinds.get(id)===kind);
  const points=problem.entities.filter(e=>e.kind==="point" && only(e.evidenceFactIds,"point"));
  const lines=problem.entities.filter(e=>e.kind==="line" && only(e.evidenceFactIds,"line"));
  if(points.length!==1 || lines.length!==1)return null;
  const point=points[0]!,line=lines[0]!;
  if(!pointLineCaptionAgrees(line.label,reading.line))return null;
  if(reading.point.name && !reading.point.origin && (point.label??point.id)!==reading.point.name)return null;
  const additional=problem.entities.filter(e=>e!==point && e!==line);
  if(additional.length>1)return null;
  const foot=additional[0];
  if(foot && (foot.kind!=="point" || !reading.requests.foot || !foot.evidenceFactIds.every(id=>kinds.get(id)==="foot" || kinds.get(id)==="both")))return null;
  if(reading.requests.foot && !foot)return null;
  const footIdentity=reading.footName ?? (foot?.label==="foot" ? foot.id : foot?.label ?? (reading.point.name==="H"?"F":"H"));
  if(foot && (reading.footName && foot.label!==reading.footName || !/^[A-Za-z][A-Za-z]?\d?'?$/.test(footIdentity) || footIdentity===(point.label??point.id)))return null;
  const outputs:PointLineCallerBinding["outputs"]=[],expected=formulas(reading),usedExpressions=new Set<string>();
  for(const request of problem.solveRequests){
    if(request.kind!=="evaluate" || !request.resultBinding)return null;
    const b=request.resultBinding,expr=problem.expressions.find(e=>e.id===request.expressionId);
    const role=["d","distance"].includes(b.symbol)?"distance":footRole(b.symbol,footIdentity);
    if(!role || !expr || expr.valueType!=="scalar" || !pointLineResultUnit(b.unit) || !b.evidenceFactIds.length || !b.evidenceFactIds.every(id=>facts.get(id)?.kind==="requested") || !has(b.evidenceFactIds,role==="distance"?"distance":"foot") || !has(expr.evidenceFactIds,role==="distance"?"distance":"foot"))return null;
    if(role==="distance" && !reading.requests.distance || role!=="distance" && !reading.requests.foot)return null;
    try{if(!originalExpressionDefined(expr.root)||!sameFormula(expr.root,expected[role]))return null;}catch{return null;}
    if(expr.root.kind!=="number" && (!has(expr.evidenceFactIds,"point") || !has(expr.evidenceFactIds,"line")))return null;
    if(outputs.some(o=>o.role===role || o.binding.turnPlanQuantityId===b.turnPlanQuantityId) || usedExpressions.has(expr.id))return null;
    usedExpressions.add(expr.id);outputs.push({role,binding:b,expressionId:expr.id,value:role==="distance"?reading.distance:reading.foot[role]});
  }
  if(reading.requests.distance && !outputs.some(o=>o.role==="distance"))return null;
  // A foot can be a geometric request without scalar coordinate bindings.
  // A caller Plan carrying numeric coordinates must bind both numeric answers.
  for(const expr of problem.expressions){
    if(usedExpressions.has(expr.id))continue;
    if(expr.valueType!=="scalar" || expr.root.kind!=="number" || expr.evidenceFactIds.some(id=>facts.get(id)?.kind!=="given"))return null;
    const name=expr.id.replace(/^e(?=[A-Z_])/u,"").replace(/_/g,"");
    const p=point.label??point.id;
    const value=[`x${p}`,`${p}x`,"x0"].includes(name)?reading.point.x:[`y${p}`,`${p}y`,"y0"].includes(name)?reading.point.y:["a","b","c"].includes(name)?reading.line[name as "a"]:null;
    if(value===null || value!==expr.root.value || !only(expr.evidenceFactIds,["a","b","c"].includes(name)?"line":"point"))return null;
  }
  for(const constraint of problem.constraints){
    if(constraint.kind==="equation" || constraint.kind==="inequality")return null;
    if(!constraint.evidenceFactIds.length || !constraint.evidenceFactIds.every(id=>facts.get(id)?.kind==="requested"))return null;
    if(constraint.kind==="incident" && foot && constraint.entityIds.length===2 && constraint.entityIds.includes(foot.id) && constraint.entityIds.includes(line.id) && has(constraint.evidenceFactIds,"foot"))continue;
    if(constraint.kind==="perpendicular" && foot && constraint.entityIds.length===3 && constraint.entityIds[0]===point.id && constraint.entityIds[1]===foot.id && constraint.entityIds[2]===line.id && (has(constraint.evidenceFactIds,"foot") || has(constraint.evidenceFactIds,"distance")))continue;
    return null;
  }
  if(!problem.entities.every(e=>problem.representationIntents.some(i=>i.entityIds.includes(e.id))))return null;
  if(problem.representationIntents.some(i=>!["conceptual","graph"].includes(i.kind) || new Set(i.entityIds).size!==i.entityIds.length || i.entityIds.some(id=>!problem.entities.some(e=>e.id===id))))return null;
  return {problem,reading,pointId:point.id,lineId:line.id,...(foot?{footId:foot.id}:{}),footIdentity,outputs};
}

/** Original model claims are accepted only as complete, proved propositions.
 * Unsupported prose, actor hints and equations decline rather than vanish. */
function planAgreement(binding:PointLineCallerBinding,raw:unknown):boolean{
  const {reading:r,problem}=binding;
  if(!hasOnlyFiniteBinomialPlanFields(raw))return false;
  const checked=validateTurnPlanV3(raw,problem.question);if(!checked.valid || !checked.plan)return false;
  const plan=checked.plan;if(plan.question!==problem.question || plan.teachingSequenceHints?.length)return false;
  const values=new Map<string,number>([["a",r.line.a],["b",r.line.b],["c",r.line.c],["s",r.line.a*r.point.x+r.line.b*r.point.y+r.line.c],["n2",r.line.a**2+r.line.b**2]]);
  const p=r.point.name??binding.pointId;
  const proof=createPlanarArithmeticProof({pointName:p,footName:binding.footIdentity,point:r.point,line:r.line,resultSymbols:binding.outputs.map(o=>({symbol:o.binding.symbol,role:o.role}))});
  values.set(`x_${p}`,r.point.x);values.set(`y_${p}`,r.point.y);
  values.set(`x_${binding.footIdentity}`,r.foot.x);values.set(`y_${binding.footIdentity}`,r.foot.y);values.set("d",r.distance);values.set("distance",r.distance);
  const ids=new Map<string,number>();
  for(const row of plan.givens){
    const expected=values.get(row.symbol);
    if(expected===undefined || !["a","b","c",`x_${p}`,`y_${p}`].includes(row.symbol) || row.value!==expected || !unitless(row.unit) || row.provenance!=="given" || row.uncertainty && row.uncertainty!==0 || row.dependsOn?.length || !row.sourceText || !problem.question.includes(row.sourceText))return false;
    const source=readPointLineSourceLiterals(row.sourceText);
    if(["a","b","c"].includes(row.symbol)?!source?.lines.some(l=>l.a===r.line.a && l.b===r.line.b && l.c===r.line.c):!source?.points.some(point=>point.x===r.point.x && point.y===r.point.y && point.name===r.point.name))return false;
    if(row.sign!==undefined && row.sign!=="unsigned" && row.sign!==(row.value>0?"positive":row.value<0?"negative":"zero"))return false;
    if(ids.has(row.id))return false;ids.set(row.id,row.value);
  }
  if(binding.outputs.length!==(r.requests.distance?1:0)+(r.requests.foot?2:0))return false;
  for(const row of plan.derived){
    const output=binding.outputs.find(o=>o.binding.turnPlanQuantityId===row.id);
    const value=output?.value ?? (row.symbol==="s"?values.get("s"):row.symbol==="a^2+b^2"?values.get("n2"):undefined);
    if(value===undefined || !close(row.value,value) || row.provenance!=="derived" || row.uncertainty!==undefined && row.uncertainty!==0 || !pointLineResultUnit(row.unit) || !output && !unitless(row.unit) || ids.has(row.id))return false;
    if(output && (row.symbol!==output.binding.symbol || !unitAgreement(row.unit,output.binding.unit)))return false;
    if(row.sign!==undefined && row.sign!=="unsigned" && row.sign!==(value>0?"positive":value<0?"negative":"zero"))return false;
    ids.set(row.id,value);values.set(row.symbol,value);
  }
  for(const row of plan.derived){
    const output=binding.outputs.find(o=>o.binding.turnPlanQuantityId===row.id);
    const role:PlanarProofRole=output?.role ?? (row.symbol==="s"?"residual":"norm");
    if(!row.sourceText || !proof.proves(row.sourceText,role))return false;
  }
  const state=new Map<string,number>();
  function visit(id:string):boolean{
    if(state.get(id)===1)return false;if(state.get(id)===2)return true;state.set(id,1);
    const row=plan.derived.find(q=>q.id===id);if(row?.dependsOn?.some(dep=>!ids.has(dep) || !visit(dep)))return false;state.set(id,2);return true;
  }
  if([...ids.keys()].some(id=>!visit(id)))return false;
  if(plan.unknowns.length!==binding.outputs.length)return false;
  for(const o of binding.outputs){
    const unknown=plan.unknowns.filter(u=>u.id===o.binding.turnPlanQuantityId),derived=plan.derived.filter(d=>d.id===o.binding.turnPlanQuantityId);
    if(unknown.length!==1 || derived.length!==1 || unknown[0]!.symbol!==o.binding.symbol || !unitAgreement(unknown[0]!.unit,o.binding.unit))return false;
  }
  const laws=["point_line_distance","perpendicular_foot_projection","point_line_distance_formula","orthogonal_projection_onto_line","dot_product_perpendicularity"];
  if(plan.lawIds.some(law=>!laws.includes(law)))return false;
  // A line actor/assumption must cite the audited line entity's own given
  // evidence. A source point quote cannot authorize a line by prefix alone.
  const lineEntity=problem.entities.find(entity=>entity.id===binding.lineId)!;
  const lineQuote=(quote:string)=>lineEntity.evidenceFactIds.some(id=>{
    const fact=problem.facts.find(f=>f.id===id);
    return fact?.kind==="given" && fact.evidence.quote===quote;
  });
  for(const assumption of plan.assumptions){
    if(["Euclidean plane","Coordinates in consistent units","Standard Cartesian plane with Euclidean distance","The perpendicular foot is the orthogonal projection of P onto the line".replace("P",p)].includes(assumption))continue;
    if(assumption.startsWith("The line is exactly ") && lineQuote(assumption.slice(20)))continue;
    return false;
  }
  for(const claim of plan.qualitativeClaims){
    if(!claim.relatedQuantityIds?.length || claim.relatedQuantityIds.some(id=>!ids.has(id)) || claim.relatedEntityHints?.some(h=>h!==p && !(h.startsWith("line ") && lineQuote(h.slice(5)))) || typeof claim.expected!=="string")return false;
    const propositions=["Perpendicular distance from point to line ax+by+c=0","Foot of perpendicular from P to the line".replace("P",p),"Check: foot lies on the line","Foot lies on the given line","Perpendicular foot is P shifted along the line normal (a,b) by the signed residual over norm squared".replace("P",p),`Segment ${p}${binding.footIdentity} is parallel to the normal vector (${r.line.a},${r.line.b}), hence perpendicular to the line`];
    if(!propositions.includes(claim.claim))return false;
    if(claim.claim===propositions[5] && r.distance===0)return false;
    const roles:Role[]=claim.claim===propositions[0]?["distance"]:["x","y"];
    if(roles.some(role=>!binding.outputs.some(output=>output.role===role && claim.relatedQuantityIds!.includes(output.binding.turnPlanQuantityId))))return false;
    // The proposition's answer must be the proved role, not just any tautology.
    const role:PlanarProofRole=claim.claim===propositions[0]?"distance":[propositions[1],propositions[4]].includes(claim.claim)?"foot":claim.claim===propositions[5]?"displacement":"incidence";
    if(!proof.proves(claim.expected,role))return false;
  }
  return true;
}
function unitAgreement(a:unknown,b:unknown):boolean{return pointLineResultUnit(a) && pointLineResultUnit(b) && (a===b || unitless(a) && unitless(b));}
export function pointLineCallerIssues(question:string,problem:unknown,plan?:unknown):SceneIssue[]{
  const r=readPointLineProgram(question);if(r.status==="none")return [];
  try { const captured=snapshotMathSourceData({problem,plan});problem=captured.problem;plan=captured.plan; } catch { return [{code:"point_line_complete_caller",severity:"fatal",path:"sourceAuthority",message:"Complete caller must be bounded own data"}]; }
  const fail=(message:string):SceneIssue[]=>[{code:"point_line_complete_caller",severity:"fatal",path:"sourceAuthority",message}];
  if(r.status!=="ok")return fail(r.reason);
  if(problem==null)return plan==null?[]:fail("An actual Plan requires its complete source-grounded IR");
  const binding=bindPointLineCaller(question,problem);if(!binding)return fail("Every original IR record and requested projection role must bind its source");
  if(plan!=null && !planAgreement(binding,plan))return fail("Every original Plan field, unit, equation, claim, hint and dependency must independently agree");
  return [];
}
