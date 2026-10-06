import { opticalConjugateQuantityRole, opticalLengthInCm, type OpticalConjugateSource } from "../physics/opticalConjugateSource";
import { expressionToSafeSource, type ExpressionNodeIR as Node, type ProblemIR } from "./problemIR";
import { parseMathExpression } from "../math/expression";
import type { SceneDocument } from "../types";
import {validateTurnPlanV3} from "../contracts/contractsV3";

const number=(value:number):Node=>({kind:"number",value});
const binary=(operator:"+"|"-"|"*"|"/",left:Node,right:Node):Node=>({kind:"binary",operator,left,right});
const normal=(s:string)=>s.trim().toLowerCase().replace(/\s+/g," ").replace(/[.!?]$/,"");
const key=(node:Node):string=> {
 if (node.kind==="number") return `n:${node.value}`;
 if (node.kind==="unary" && node.operand.kind==="number") return `n:${node.operator==="-"?-node.operand.value:node.operand.value}`;
 if (node.kind==="binary") {
  const leaves=(n:Node):Node[]=>["+","*"].includes(node.operator) && n.kind==="binary" && n.operator===node.operator?[...leaves(n.left),...leaves(n.right)]:[n];
  const keys=[...leaves(node.left),...leaves(node.right)].map(key);
  return `${node.operator}(${(["+","*"].includes(node.operator)?keys.sort():keys).join(",")})`;
 }
 if (node.kind==="unary") return `${node.operator}(${key(node.operand)})`;
 if (node.kind==="call") return `${node.function}(${key(node.argument)})`;
 return node.kind==="constant"?`c:${node.name}`:`var:${node.name}`;
};

/** Canonical physical law forms in the source's signed Cartesian cm frame.
 * Product and reciprocal forms are distinct, explicitly supported AST proofs;
 * a numerical answer or unrelated equal-valued formula is never a proof. */
export function opticalConjugateFormulae(source:OpticalConjugateSource,role:"v"|"magnification",unit:string):Node[] {
 const u=number(source.u),f=number(source.f);
 const image=[binary("/",binary("*",u,f),binary(source.device==="mirror"?"-":"+",u,f)),
  binary("/",number(1),binary(source.device==="mirror"?"-":"+",binary("/",number(1),f),binary("/",number(1),u)))];
 if (role==="magnification") return unit!=="1"?[]:image.map(v=>binary("/",source.device==="mirror"?{kind:"unary",operator:"-",operand:v}:v,u));
 const scale=opticalLengthInCm(1,unit);
 return scale==null?[]:image.map(v=>scale===1?v:binary("/",v,number(scale)));
}

/** Every numeric expression, binding and fact is retained and joined to a
 * stated physical role. The caller object is not rewritten or reduced. */
export function bindOpticalConjugateProblem(problem:ProblemIR,source:OpticalConjugateSource,rawPlan?:unknown):SceneDocument["quantities"]|null {
 if (problem.constraints.length) return null;
 const facts=new Map(problem.facts.map(row=>[row.id,row]));
 if (problem.facts.some(row=>normal(row.statement)!==normal(row.evidence.quote))) return null;
 const requested=new Set(problem.facts.filter(row=>row.kind==="requested" && normal(row.evidence.quote)===normal(source.request)).map(row=>row.id));
 const usedFacts=new Set<string>(problem.entities.flatMap(row=>row.evidenceFactIds));
 for (const intent of problem.representationIntents) {
  if (!["apparatus","conceptual"].includes(intent.kind)) return null;
  intent.evidenceFactIds.forEach(id=>usedFacts.add(id));
 }
 if (!problem.expressions.length && !problem.solveRequests.length) return [];
 if (!requested.size) return null;
 const quantities:SceneDocument["quantities"]=[],givenRoles=new Set<string>(),resultRoles=new Set<string>(),usedExpressions=new Set<string>();
 const expressionMap=new Map(problem.expressions.map(row=>[row.id,row]));
 for (const expression of problem.expressions) {
  if (problem.solveRequests.some(row=>row.kind==="evaluate" && row.expressionId===expression.id)) continue;
  const role=opticalConjugateQuantityRole({id:expression.id.replace(/^e(?=[UF_])/,"")});
  const input=source.inputs.find(row=>row.role===role);
  if (!input || givenRoles.has(role!) || expression.valueType!=="scalar" || expression.root.kind!=="number" || expression.root.value!==input.value
    || !expression.evidenceFactIds.length || !expression.evidenceFactIds.every(id=>facts.get(id)?.kind==="given")
    || !expression.evidenceFactIds.some(id=>facts.get(id)!.evidence.quote.includes(input.quote))) return null;
  givenRoles.add(role!);usedExpressions.add(expression.id);expression.evidenceFactIds.forEach(id=>usedFacts.add(id));
  quantities.push({id:expression.id,symbol:role!,value:input.value,unit:input.unit,provenance:"given",evidenceFactIds:[...expression.evidenceFactIds],sourceText:input.quote});
 }
 if (givenRoles.size!==2) return null;
 for (const request of problem.solveRequests) {
  if (request.kind!=="evaluate" || !request.resultBinding) return null;
  const binding=request.resultBinding,expression=expressionMap.get(request.expressionId);
  const role=opticalConjugateQuantityRole({id:binding.turnPlanQuantityId,symbol:binding.symbol});
  if ((role!=="v" && role!=="magnification") || resultRoles.has(role) || !expression || expression.valueType!=="scalar"
    || !binding.unit || !binding.evidenceFactIds.length || !binding.evidenceFactIds.every(id=>requested.has(id))
    || !expression.evidenceFactIds.some(id=>requested.has(id)) || !source.inputs.every(input=>expression.evidenceFactIds.some(id=>facts.get(id)?.kind==="given" && facts.get(id)!.evidence.quote.includes(input.quote)))) return null;
  if (rawPlan!=null) {
   const checked=validateTurnPlanV3(rawPlan,problem.question);
   if (!checked.valid || !checked.plan) return null;
   const rows=[...checked.plan.unknowns,...checked.plan.derived].filter(row=>row.id===binding.turnPlanQuantityId);
   if (!rows.length || rows.some(row=>opticalConjugateQuantityRole(row)!==role || row.unit!==binding.unit)) return null;
  }
  if (role==="magnification" && !/magnification/i.test(source.request) || role==="v" && !/(?:image distance|position|locate the image)/i.test(source.request)) return null;
  const allowed=opticalConjugateFormulae(source,role,binding.unit);
  if (!allowed.some(root=>key(root)===key(expression.root))) return null;
  let value:number;try {value=parseMathExpression(expressionToSafeSource(expression.root)).evaluate(0);} catch {return null;}
  const expected=role==="magnification"?source.magnification:source.v/opticalLengthInCm(1,binding.unit)!;
  if (!Number.isFinite(value) || Math.abs(value-expected)>64*Number.EPSILON*Math.max(Math.abs(value),Math.abs(expected))) return null;
  if (quantities.some(row=>row.id===binding.turnPlanQuantityId)) return null;
  quantities.push({id:binding.turnPlanQuantityId,symbol:binding.symbol,value:expected,unit:binding.unit,provenance:"derived",evidenceFactIds:[...binding.evidenceFactIds],sourceText:source.request});
  resultRoles.add(role);usedExpressions.add(expression.id);[...expression.evidenceFactIds,...binding.evidenceFactIds].forEach(id=>usedFacts.add(id));
 }
 if ((/magnification/i.test(source.request) && !resultRoles.has("magnification")) || (/(?:image distance|position|locate the image)/i.test(source.request) && !resultRoles.has("v"))) return null;
 if (problem.facts.some(row=>!usedFacts.has(row.id)) || problem.expressions.some(row=>!usedExpressions.has(row.id))) return null;
 return quantities;
}
