import {OPTICS_GENERATORS} from "../archetypes/generators/optics";
import {collectPlanQuantities} from "../archetypes/slots";
import {pruneDeadSceneEntities,validateSceneDocument} from "../document/validation";
import {readOpticalConjugateSource,opticalConjugatePlanConflicts,opticalConjugateUnknownConflicts} from "../physics/opticalConjugateSource";
import {validateTurnPlanV3} from "../contracts/contractsV3";
import {validateProblemIR} from "./problemIR";
import {bindOpticalConjugateProblem} from "./opticalConjugateProblemBinding";
import type {SceneDocument,SceneIssue} from "../types";

/** Source-only, conceptual and bounded numerical whole-IR correspondence. */
export function opticalConjugateDocument(question:string,plan?:unknown,problemIR?:unknown):SceneDocument|null {
 const source=readOpticalConjugateSource(question);
 if (!source || opticalConjugatePlanConflicts(source,collectPlanQuantities(plan)).length) return null;
 if (plan != null) {
  const checked=validateTurnPlanV3(plan);
  if (!checked.valid || !checked.plan || opticalConjugateUnknownConflicts(checked.plan.unknowns).length) return null;
 }
 const id=source.device==="mirror"?"spherical_mirror":"thin_lens";
 const document=OPTICS_GENERATORS[id]!({question,slots:{kind:source.kind,u:Math.abs(source.u),f:Math.abs(source.f)},sources:{u:"stem",f:"stem"},quantities:[],schematic:true});
 if (!document) return null;
 if (problemIR!=null) {
  const checked=validateProblemIR(problemIR,question);
  if (!checked.valid || !checked.problem) return null;
  const problem=checked.problem;
  const joined=bindOpticalConjugateProblem(problem,source,plan);
  if (!joined) return null;
  if (problem.facts.some(row=>row.statement.trim().replace(/[.!?]$/,"")!==row.evidence.quote.trim().replace(/[.!?]$/,""))) return null;
  const used=new Set<string>();
  for (const entity of problem.entities) {
   const label=entity.label ?? entity.id;
   const target=label==="object"?"object":label==="image"?"image":label===source.device || label===`${source.kind} ${source.device}` ? source.device : null;
   const evidence=entity.evidenceFactIds.map(id=>problem.facts.find(row=>row.id===id)!.evidence.quote).join(" ");
   if (!target || used.has(target) || !["body","component","line"].includes(entity.kind) || !evidence.toLowerCase().includes(label.toLowerCase())) return null;
   used.add(target);
   const physical=document.entities.find(row=>row.id===target)!;
   if (!physical || label.length>16) return null;
   physical.label=label;
  }
  if((problem.expressions.length || problem.solveRequests.length) && !["object","image",source.device].every(role=>used.has(role))) return null;
  for (const quantity of joined) {
   const index=document.quantities.findIndex(row=>row.id===quantity.id);
   if (document.entities.some(row=>row.id===quantity.id)) return null;
   if (index<0) document.quantities.push(quantity);else document.quantities[index]=quantity;
   const target=quantity.provenance==="given"?(quantity.symbol==="u"?"dim_u":source.device==="mirror"?"dim_f":"F2"):"I_base";
   document.annotations.push({id:`optical_value_${quantity.id}`,kind:"label",quantityId:quantity.id,targetIds:[target]});
  }
 }
 document.source.slotSources={u:"stem",f:"stem"};
 document.source.derivedSlots={v:["u","f"]};
 return validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>)).document;
}

export function validateOpticalConjugateSource(document:SceneDocument,question:string,problemIR?:unknown):SceneIssue[] {
 const source=readOpticalConjugateSource(question);
 const paraxial=document.constructions.some(row=>row.inputs.approximation==="paraxial");
 const carriesConjugateValues=document.quantities.some(row=>typeof row.unit==="string" && ["mm","cm","m"].includes(row.unit)) ||
  [...document.entities.map(row=>row.label ?? ""),...document.annotations.map(row=>typeof row.text==="string"?row.text:"")].some(text=>/\b[ufv]\s*[=≈]\s*[+-]?\d/i.test(text));
 if (!source && !(paraxial && carriesConjugateValues)) return [];
 const issue=():SceneIssue[]=>[{code:"optical_conjugate_source",severity:"fatal",path:"sourceAuthority",message:"Numeric conjugate geometry must bind the complete source setup and caller IR."}];
 const expected=opticalConjugateDocument(question,undefined,problemIR);
 if (!expected || document.source.question!==question) return issue();
 const shape=(value:SceneDocument)=>({quantities:value.quantities,entities:value.entities.map(({provenance:_provenance,...row})=>row),constructions:value.constructions,annotations:value.annotations,assertions:value.assertions,relations:value.relations,requiredEntityIds:value.requiredEntityIds,revealGroups:value.revealGroups,teachingTimeline:value.teachingTimeline});
 const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
 return JSON.stringify(canonical(shape(document)))===JSON.stringify(canonical(shape(expected)))?[]:issue();
}
