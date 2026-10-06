/** Whole, unchanged caller audit for a source-proved finite SUVAT interval. */
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { snapshotMathSourceData } from "../compile/mathSourceData";
import { validateTurnPlanV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { constantAccelerationSourceProgram, normalized, siValue, type SuvatRole } from "../archetypes/generators/constantAcceleration";
import { expressionToSafeSource, validateProblemIR, type ExpressionNodeIR, type ProblemIR } from "./problemIR";
import { parseSuvatProofExpression } from "./suvatProofExpression";
import { parseMathExpression } from "../math/expression";
import { readSuvatSource, suvatAstKey, suvatSemantic, type SuvatSemantic, type SuvatSource } from "./suvatSource";
import type { SceneDocument, SceneIssue } from "../types";

const dimensions = {u:"speed",v:"speed",a:"accel",t:"time",s:"length"} as const;
const aliases: Record<SuvatRole,string[]> = {u:["u","v0","initialvelocity","initialspeed"],v:["v","vf","finalvelocity","finalspeed"],a:["a","acceleration","deceleration"],t:["t","time","duration"],s:["s","d","distance","displacement"]};
const key=(text:string) => normalized(text).replace(/[^a-z0-9]/g,"");
const roleOf=(row:{id:string;symbol:string}):SuvatRole|undefined => (Object.keys(aliases) as SuvatRole[]).find(role=>aliases[role].includes(key(row.symbol)) && (aliases[role].includes(key(row.id)) || row.id.length>0));
const namedSemantics: Record<string,SuvatSemantic> = {initialvelocity:"velocity",finalvelocity:"velocity",initialspeed:"speed",finalspeed:"speed",distance:"distance",displacement:"displacement"};
function auditQuantitySemantics(source:SuvatSource,row:{id:string;symbol:string},role:SuvatRole,requested:boolean):void {
  for(const name of [row.id,row.symbol]){
    const semantic=namedSemantics[key(name)];if(!semantic)continue;
    if((semantic==="speed"||semantic==="distance")&&source.state[role]<0)fail("Plan magnitude name borrows a negative signed role");
    if(requested && !source.asks.some(ask=>ask.role===role&&ask.semantic===semantic))fail("Plan semantic name disagrees with source query");
  }
}
function fail(message:string):never {throw new Error(message);}
const close=(a:number,b:number) => Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
const fields=(row:object,allowed:string[]) => {if(Reflect.ownKeys(row).some(field=>typeof field!=="string"||!allowed.includes(field)))fail("uncovered caller own field");};
const covers=(outer:{start:number;end:number},inner:{start:number;end:number}) => outer.start<=inner.start&&outer.end>=inner.end;
export const SUVAT_SOURCE_MODEL = "finite-suvat-whole-source/v1";

function nodeFields(node:ExpressionNodeIR):void {
  switch(node.kind){
    case "number":fields(node,["kind","value"]);break;
    case "constant":case "variable":fields(node,["kind","name"]);break;
    case "binary":fields(node,["kind","operator","left","right"]);nodeFields(node.left);nodeFields(node.right);break;
    case "unary":fields(node,["kind","operator","operand"]);nodeFields(node.operand);break;
    case "call":fields(node,["kind","function","argument"]);nodeFields(node.argument);break;
  }
}
const mathText=(text:string) => normalized(text).replace(/\s+/g,"").replace(/([uvats)])(?=[uvats(])/g,"$1*");
function checkedWorking(text:string,role:SuvatRole,source:SuvatSource):boolean {
  const parts=mathText(text).split("=");
  if(parts.length<2 || parts[0]!==role)return false;
  const symbolic:Record<SuvatRole,string[]>={u:["v-a*t"],v:["u+a*t"],a:["(v-u)/t"],t:["(v-u)/a"],s:["(u+v)*t/2","(u+v)/2*t","u*t+a*t^2/2","u*t+0.5*a*t^2"]};
  const roots=source.formulas[role].map(root=>mathText(expressionToSafeSource(root)));
  // Compare parsed syntax, preserving grouping and source-role substitutions.
  const evaluate=(part:string) => parseMathExpression(part.replace(/\b[uvats]\b/g,symbol=>`(${source.state[symbol as SuvatRole]})`)).evaluate(0);
  const expressionKey=(part:string)=>suvatAstKey(parseSuvatProofExpression(part));
  if(!symbolic[role].some(formula=>expressionKey(mathText(formula))===expressionKey(parts[1]!)) && !roots.some(root=>expressionKey(root)===expressionKey(parts[1]!)))return false;
  for(const part of parts.slice(1)) {
    if(/[uvats]/.test(part) && !symbolic[role].some(formula=>expressionKey(mathText(formula))===expressionKey(part)))return false;
    if(!close(evaluate(part),source.state[role]))return false;
  }
  return true;
}

function auditPlan(source:SuvatSource,raw:unknown):TurnPlanV3 {
  const checked=validateTurnPlanV3(raw,source.question);
  if(!checked.valid||!checked.plan)fail("invalid original TurnPlan");
  const plan=checked.plan;
  fields(plan,["schemaVersion","question","givens","unknowns","derived","qualitativeClaims","lawIds","assumptions","visualRequirement","teachingSequenceHints"]);
  if(plan.question!==source.question || plan.teachingSequenceHints?.length)fail("uncovered Plan question or hints");
  const rowRoles=new Map<string,SuvatRole>();
  for(const rows of [plan.givens,plan.unknowns,plan.derived]) {
    const ids=new Set<string>();
    for(const row of rows){
      fields(row,rows===plan.unknowns?["id","symbol","unit"]:["id","symbol","value","unit","sign","sourceText","provenance","dependsOn"]);
      const role=roleOf(row);if(!role||ids.has(row.id))fail("unbound or duplicate Plan role");ids.add(row.id);
      auditQuantitySemantics(source,row,role,rows!==plan.givens);
      if(rowRoles.has(row.id)&&rowRoles.get(row.id)!==role)fail("conflicting Plan role identity");rowRoles.set(row.id,role);
      if(rows===plan.unknowns){
        if(!source.asks.some(ask=>ask.role===role))fail("foreign or extra Plan query");
        if(siValue({...row,value:1},dimensions[role])!==1)fail("query unit must match proved SI role");
      }else{
        const quantity=row as TurnPlanV3["givens"][number];
        const value=siValue(quantity,dimensions[role]);
        if(value===null||!close(value,source.state[role]))fail("Plan quantity conflicts with source role/unit");
        if(quantity.sign!==undefined && quantity.sign!=="unsigned" && quantity.sign!==(quantity.value===0?"zero":quantity.value<0?"negative":"positive"))fail("Plan sign contradicts its source value");
        if(rows===plan.givens){
          const span=source.roles[role];
          if(!span||quantity.provenance!=="given"||!quantity.sourceText||!normalized(source.question).includes(normalized(quantity.sourceText))||!normalized(quantity.sourceText).includes(normalized(span.quote)))fail("given quote does not prove its role");
          if(quantity.dependsOn?.length)fail("given cannot depend on computed quantities");
        }else{
          if(quantity.provenance!=="derived"||!source.asks.some(ask=>ask.role===role)||!quantity.sourceText||!checkedWorking(quantity.sourceText,role,source))fail("derived working formula is not source-proved");
          const deps=quantity.dependsOn??[];
          if(deps.length!==Object.keys(source.roles).length||new Set(deps).size!==deps.length||deps.some(id=>!plan.givens.some(given=>given.id===id)))fail("incomplete, cyclical or foreign derived dependencies");
        }
      }
    }
  }
  if(Object.keys(source.roles).some(role=>plan.givens.filter(row=>roleOf(row)===role).length!==1)||source.asks.some(ask=>plan.unknowns.filter(row=>roleOf(row)===ask.role).length!==1||plan.derived.filter(row=>roleOf(row)===ask.role).length!==1))fail("Plan omits or duplicates source givens/queries");
  if(plan.givens.some(row=>plan.unknowns.some(unknown=>unknown.id===row.id)))fail("given/request identity overlaps");
  for(const assumption of plan.assumptions){
    if(assumption==="initial direction taken as positive" && (source.state.u<0 || source.state.u===0&&source.state.v<0))fail("positive initial convention contradicts current source frame");
    if(assumption!=="A verified illustration is required by the question's spatial or explicit visual request." && !/^(?:uniform \(constant\) acceleration|constant acceleration|uniform acceleration|straight-line motion|initial direction taken as positive)$/.test(assumption))fail("uncovered modelling assumption");
  }
  const laws=new Set(["kinematics_uniform_acceleration","v=u+at","s=(u+v)t/2","s=ut+at^2/2","constant_acceleration"]);
  if(!plan.lawIds.length||plan.lawIds.some(law=>!laws.has(law)))fail("unproved Plan law");
  for(const claim of plan.qualitativeClaims){
    fields(claim,["id","claim","expected","relatedQuantityIds"]);
    if(!claim.relatedQuantityIds?.length||claim.relatedQuantityIds.some(id=>!rowRoles.has(id)))fail("unbound claim quantity");
    const acceleration=/^Acceleration is opposite to motion \(deceleration of magnitude ([\d.]+) m\/s\^2\)\.$/.exec(claim.claim);
    const distance=/^(?:Braking distance equals average velocity times time\.|Distance equals average velocity times time under uniform acceleration\.)$/.test(claim.claim);
    const role=acceleration?"a":distance?"s":null;
    if(distance&&source.state.s<0)fail("distance claim borrows negative displacement");
    if(!role||!claim.relatedQuantityIds.some(id=>rowRoles.get(id)===role)||acceleration&&(!close(Number(acceleration[1]),Math.abs(source.state.a))||source.state.a*source.state.u>=0))fail("unproved qualitative statement");
    if(typeof claim.expected!=="string")fail("claim requires a complete proved expected expression");
    const expected=claim.expected.replace(/\s*m\/s\^2\s*$/," ").replace(/\s*m\s*$/," ").trim();
    if(!checkedWorking(expected,role,source) && mathText(expected)!==`${role}=${source.state[role]}`)fail("false expected claim formula");
  }
  return plan;
}

/** Keep original equations/claims intact; only the wire sign spelling changes. */
export function normalizeSuvatPlanWire(raw:unknown):unknown {
  const value=structuredClone(snapshotMathSourceData(raw));
  if(!value||typeof value!=="object")return value;
  for(const name of ["givens","derived"]){
    const rows=(value as Record<string,unknown>)[name];
    if(!Array.isArray(rows))continue;
    for(const row of rows) if(row&&typeof row==="object" && (row.sign==="+"||row.sign==="-")) {
      row.sign=row.sign==="+"?(row.value===0?"zero":"positive"):"negative";
    }
  }
  return value;
}

export function suvatPlanIssues(question:string,raw:unknown):SceneIssue[]{
  const reading=readSuvatSource(question);if(reading.status==="none")return [];
  try{
    if(reading.status!=="ok")fail(reading.reason);
    auditPlan(reading.source,snapshotMathSourceData(raw));return [];
  }catch(error){return [{code:"suvat_original_plan_declined",severity:"fatal",path:"sourceAuthority.turnPlan",message:error instanceof Error?error.message:"invalid Plan data"}];}
}

export function suvatGivenIsSourceOwned(question:string,row:unknown):boolean {
  try{
    const reading=readSuvatSource(question);if(reading.status!=="ok")return false;
    const captured=snapshotMathSourceData(row) as TurnPlanV3["givens"][number];
    const role=roleOf(captured);const span=role?reading.source.roles[role]:null;
    if(role)auditQuantitySemantics(reading.source,captured,role,false);
    return Boolean(role&&span&&captured.provenance==="given"&&captured.sourceText&&normalized(question).includes(normalized(captured.sourceText))&&normalized(captured.sourceText).includes(normalized(span.quote))&&close(siValue(captured,dimensions[role])??NaN,reading.source.state[role]));
  }catch{return false;}
}

type Admission={status:"none"}|{status:"declined";reason:string}|{status:"ok";source:SuvatSource;problem:ProblemIR;plan:TurnPlanV3;bindings:Array<{expressionId:string;role:SuvatRole;requestId:string}>};
export function admitSuvatCaller(question:string,rawProblem:unknown,rawPlan:unknown):Admission {
  try{
    const reading=readSuvatSource(question);if(reading.status!=="ok")return reading;
    const captured=snapshotMathSourceData({problem:rawProblem,plan:rawPlan});
    const source=reading.source,plan=auditPlan(source,captured.plan);
    const checked=validateProblemIR(captured.problem,question);
    if(!checked.valid||!checked.problem)fail("invalid original full ProblemIR");
    const problem=checked.problem;
    fields(problem,["schemaVersion","id","question","facts","entities","expressions","constraints","representationIntents","solveRequests"]);
    if(problem.question!==question)fail("foreign IR source");
    const factRoles=new Map<string,SuvatRole|"condition">();
    for(const fact of problem.facts){
      fields(fact,["id","kind","statement","evidence"]);fields(fact.evidence,["source","start","end","quote"]);
      if(question.slice(fact.evidence.start,fact.evidence.end)!==fact.evidence.quote)fail("fact evidence span/quote conflicts");
      const statement=normalized(fact.statement);
      let role:SuvatRole|"condition"|undefined;
      if(fact.kind==="requested"){
        const matched=/^(?:find |calculate |determine )?(acceleration|deceleration|distance|displacement|final velocity|final speed|time)(?: travelled while braking| travelled| covered| taken)?$/.exec(statement);
        role=matched?({acceleration:"a",deceleration:"a",distance:"s",displacement:"s","final velocity":"v","final speed":"v",time:"t"} as Record<string,SuvatRole>)[matched[1]!]:undefined;
        const ask=source.asks.find(ask=>ask.role===role);
        if(!ask||!matched||suvatSemantic(matched[1]!)!==ask.semantic||!covers(fact.evidence,ask.evidence))fail("requested fact does not bind source query");
      }else if(/^(?:uniform braking|uniform acceleration|constant acceleration|uniform deceleration)$/.test(statement)){
        role="condition";if(!covers(fact.evidence,source.condition))fail("condition evidence is not explicit source condition");
      }else{
        const match=/^(initial (?:speed|velocity)|final (?:speed|velocity)|braking time|time|duration|acceleration|deceleration|distance|displacement) ([\s\S]+)$/.exec(statement);
        if(!match||fact.kind!=="given")fail("unbound given fact statement");
        role=match[1]!.startsWith("initial")?"u":match[1]!.startsWith("final")?"v":/time|duration/.test(match[1]!)?"t":/acceleration|deceleration/.test(match[1]!)?"a":"s";
        const span=source.roles[role];
        const semantic=suvatSemantic(match[1]!);
        if((semantic==="speed"||semantic==="distance")&&source.state[role]<0)fail("fact magnitude name borrows a negative signed role");
        const rhs=match[2]!.replace(/\s*\(rest\)$/,"");
        const value=/^([-+]?\d+(?:\.\d+)?)\s*(.*)$/.exec(rhs);
        const expected=value?siValue({id:role,symbol:role,value:Number(value[1]),unit:value[2]|| (role==="u"||role==="v"?"m/s":"")},dimensions[role]):null;
        if(!span||!covers(fact.evidence,span)||expected===null||!close(expected,source.state[role]))fail("fact statement value/role/unit conflicts with source");
      }
      if(!role||[...factRoles.values()].includes(role)&&fact.kind!=="requested")fail("duplicate or unbound fact role");
      factRoles.set(fact.id,role);
    }
    if([...Object.keys(source.roles),"condition"].some(role=>![...factRoles.values()].includes(role as SuvatRole|"condition"))||source.asks.some(ask=>!problem.facts.some(fact=>fact.kind==="requested"&&factRoles.get(fact.id)===ask.role)))fail("IR omits stated role/condition/query");
    const used=new Set<string>();
    const refs=(ids:string[])=>{ids.forEach(id=>used.add(id));return ids.map(id=>factRoles.get(id)!);};
    if(problem.entities.length!==1)fail("one source actor must bind exactly one IR entity");
    const actor=problem.entities[0]!;fields(actor,["id","kind","label","evidenceFactIds"]);
    if(actor.kind!=="body"||normalized(actor.label??"")!==normalized(source.actor)||!refs(actor.evidenceFactIds).every(role=>Object.hasOwn(source.roles,role)))fail("foreign/unbound actor");
    for(const intent of problem.representationIntents){
      fields(intent,["id","kind","entityIds","evidenceFactIds"]);
      if(!["conceptual","graph"].includes(intent.kind)||intent.entityIds.length!==1||intent.entityIds[0]!==actor.id||!refs(intent.evidenceFactIds).includes("condition"))fail("unbound intent or unstated motion condition");
    }
    if(!problem.representationIntents.length)fail("complete actor/condition intent required");
    const expressionRoles=new Map<string,SuvatRole>();
    for(const expression of problem.expressions){
      fields(expression,["id","valueType","root","evidenceFactIds"]);nodeFields(expression.root);
      if(expression.valueType!=="scalar")fail("foreign expression type");
      const matches=(Object.keys(source.formulas) as SuvatRole[]).filter(role=>source.formulas[role].some(root=>suvatAstKey(root)===suvatAstKey(expression.root)) || expression.root.kind==="variable"&&expression.root.name===role);
      if(matches.length!==1)fail("expression AST is not a unique source-role formula");
      const role=matches[0]!;expressionRoles.set(expression.id,role);
      const evidenceRoles=refs(expression.evidenceFactIds);
      const required=source.roles[role]?[role]:Object.keys(source.roles);
      if(required.some(role=>!evidenceRoles.includes(role as SuvatRole))||evidenceRoles.some(role=>role!=="condition"&&!Object.hasOwn(source.roles,role)))fail("expression evidence omits or borrows source roles");
    }
    const expressionUsed=new Set<string>();
    for(const constraint of problem.constraints){
      if(constraint.kind!=="equation")fail("unsupported caller constraint");
      fields(constraint,["id","kind","leftExpressionId","rightExpressionId","evidenceFactIds"]);
      const constraintRoles=refs(constraint.evidenceFactIds);
      const left=problem.expressions.find(row=>row.id===constraint.leftExpressionId)!,right=problem.expressions.find(row=>row.id===constraint.rightExpressionId)!;
      if(expressionRoles.get(left.id)!==expressionRoles.get(right.id)||left.root.kind!=="variable"&&right.root.kind!=="variable")fail("equation does not assert a proved role/formula");
      if(!constraintRoles.includes("condition") || Object.keys(source.roles).some(role=>!constraintRoles.includes(role as SuvatRole)))fail("equation does not consume its source roles and stated condition");
      expressionUsed.add(left.id);expressionUsed.add(right.id);
    }
    const bindings:Array<{expressionId:string;role:SuvatRole;requestId:string}>=[];
    for(const request of problem.solveRequests){
      if(request.kind!=="evaluate"||!request.resultBinding)fail("unbound or foreign request");
      fields(request,["id","kind","expressionId","resultBinding"]);fields(request.resultBinding,["turnPlanQuantityId","symbol","unit","evidenceFactIds"]);
      const binding=request.resultBinding,role=expressionRoles.get(request.expressionId);
      const unknown=plan.unknowns.find(row=>row.id===binding.turnPlanQuantityId);
      const expression=problem.expressions.find(row=>row.id===request.expressionId)!;
      if(!role||!source.asks.some(ask=>ask.role===role)||!unknown||roleOf(unknown)!==role||unknown.symbol!==binding.symbol||unknown.unit!==binding.unit||expression.root.kind==="variable"||bindings.some(row=>row.role===role))fail("request does not prove original query binding");
      if(!refs(binding.evidenceFactIds).includes(role)||!binding.evidenceFactIds.every(id=>problem.facts.find(fact=>fact.id===id)!.kind==="requested"))fail("request evidence is not requested-role evidence");
      expressionUsed.add(request.expressionId);bindings.push({expressionId:request.expressionId,role,requestId:request.id});
    }
    if(bindings.length!==source.asks.length||problem.expressions.some(row=>!expressionUsed.has(row.id))||problem.facts.some(fact=>!used.has(fact.id)))fail("unconsumed original fact/expression/query");
    return {status:"ok",source,problem,plan,bindings};
  }catch(error){return {status:"declined",reason:error instanceof Error?error.message:"non-data caller declined"};}
}

export function suvatCallerIssues(question:string,problem:unknown,plan:unknown):SceneIssue[]{
  const admitted=admitSuvatCaller(question,problem,plan);
  return admitted.status==="declined"?[{code:"suvat_whole_caller_declined",severity:"fatal",path:"sourceAuthority",message:admitted.reason}]:[];
}

/** Comparison view only: retain every field and independently convert source
 * role measurements to the scene's SI units. The original caller stays intact. */
export function suvatPlanForSIComparison(question:string,problem:unknown,plan:unknown):TurnPlanV3|null {
  const admitted=admitSuvatCaller(question,problem,plan);if(admitted.status!=="ok")return null;
  const units={u:"m/s",v:"m/s",a:"m/s^2",t:"s",s:"m"};
  return {...admitted.plan,givens:admitted.plan.givens.map(row=>{
    const role=roleOf(row)!;return {...row,value:admitted.source.state[role],unit:units[role]};
  })};
}

export function suvatCallerDocument(question:string,problem:unknown,plan:unknown):SceneDocument|null {
  const admitted=admitSuvatCaller(question,problem,plan);if(admitted.status!=="ok")return null;
  const document=constantAccelerationSourceProgram(question);if(!document)return null;
  // The plotted curve is the source actor's velocity, not an arbitrary body
  // sketch. Stable original actor identity participates in required reveal.
  const actor=admitted.problem.entities[0]!;
  const graph=document.entities.find(entity=>entity.id==="graph")!;
  graph.label=`${actor.label}: ${graph.label}`;
  graph.provenance={...graph.provenance,suvatActorId:actor.id,suvatActorLabel:actor.label};
  const label=document.entities.find(entity=>entity.id==="s_label")!;
  label.provenance={...label.provenance,suvatBindings:admitted.bindings};
  document.source={...document.source,sourceModel:SUVAT_SOURCE_MODEL};
  return validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>)).document;
}

export function suvatDocumentIssues(document:SceneDocument,question:string,problem:unknown,plan:unknown):SceneIssue[]{
  const reading=readSuvatSource(question);
  if(reading.status==="none"&&document.source.sourceModel!==SUVAT_SOURCE_MODEL)return [];
  const issues=suvatCallerIssues(question,problem,plan);if(issues.length)return issues;
  const expected=suvatCallerDocument(question,problem,plan);
  // Source reconstruction proves graph, quantities, actor, labels and reveal
  // together. Cached source metadata is never itself a certificate.
  const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(",")}]`:value&&typeof value==="object"?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable((value as Record<string,unknown>)[key])}`).join(",")}}`:JSON.stringify(value)??"undefined";
  const view=(doc:SceneDocument)=>({entities:doc.entities,constructions:doc.constructions,assertions:doc.assertions,quantities:doc.quantities,requiredEntityIds:doc.requiredEntityIds,revealGroups:doc.revealGroups});
  return expected&&document.source.sourceModel===SUVAT_SOURCE_MODEL&&stable(view(expected))===stable(view(document))?[]:[{code:"suvat_source_document_mismatch",severity:"fatal",path:"sourceAuthority.document",message:"Scene does not carry the complete reconstructed source interval and original caller roles"}];
}
