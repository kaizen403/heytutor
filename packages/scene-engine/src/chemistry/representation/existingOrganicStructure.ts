/** Fresh bounded structural membership; no question/family/cache flag grants authority. */
import type { SceneDocument, RenderScene } from "../../types";
import { copyNeutralComparisonData } from "./neutralComparisonInput";
import { auditExistingOrganicGeometry } from "./neutralComparisonGeometry";
import { bindOrganicRepresentation } from "./bindings";
import { auditChemistryRepresentation, chemistryStructureSymbolProvenance, isChemistryStructureSymbolPrimitive } from "./audit";
import { prepareNeutralComparison, type NeutralPanelCheck, type NeutralPanelLabelBinding, type NeutralComparisonProof } from "./neutralComparisonFactory";

export type ExistingOrganicStructureProof = Omit<NeutralComparisonProof,"version"> & {
 readonly version:"existing-organic-structure-proof/v1";
 readonly scope:"source-backed-components-only";
};
export type ExistingOrganicStructureCheck = Exclude<NeutralPanelCheck,{status:"verified"}> | {
 readonly status:"verified"; readonly originalQuestion:string; readonly document:SceneDocument;
 readonly renderScene:RenderScene; readonly proof:ExistingOrganicStructureProof; readonly labels:readonly NeutralPanelLabelBinding[];
};
export type SourceBoundChemistryStructureCheck = NeutralPanelCheck | ExistingOrganicStructureCheck;

const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const declined=(reason:string):ExistingOrganicStructureCheck=>({status:"declined",issues:[{code:"existing_organic_structure_declined",severity:"fatal",path:"rawDocument",message:reason}]});

/** Recompute an existing complete C/O graph and its owning names from external source.
 * Unrelated scene kinds retain their previous path. Whole-neutral requests retain their own proof. */
export function prepareExistingOrganicStructure(input:{originalQuestion:string;rawDocument:unknown;compiledWitness?:unknown}):ExistingOrganicStructureCheck {
 try{
  const call=copyNeutralComparisonData(input);
  if(!record(call)||Object.keys(call).some(key=>!["originalQuestion","rawDocument","compiledWitness"].includes(key)))return declined("unsupported_structural_arguments");
  const raw=call.rawDocument;
  if(!record(raw)||!Array.isArray(raw.entities))return {status:"not_applicable"};
  const frame=raw.entities.some(e=>record(e)&&e.kind==="rectangle"&&typeof e.id==="string"&&/^m\d+_panel$/.test(e.id));
  const component=raw.entities.some(e=>record(e)&&typeof e.id==="string"&&/^m\d+_(?:name(?:_\d+)?|a\d+|b\d+(?:_\d+)?|h\d+|hb\d+)$/.test(e.id));
  if(!frame&&!component)return {status:"not_applicable"};
  // Remaining producer evidence may only require a check/refusal. Erasing the
  // frames or family metadata never exempts source-backed structural ink.
  if(!frame)return declined("missing_existing_structure_frame");
  if(!record(raw.source)||raw.source.chemistryFamily!=="chem_organic")return declined("invalid_existing_structure_source_metadata");
  if(typeof call.originalQuestion!=="string"||call.originalQuestion!==call.originalQuestion.trim())return declined("missing_or_changed_external_original_question");
  const question=call.originalQuestion,document=raw as unknown as SceneDocument;
  const checked=auditExistingOrganicGeometry(document,question,call.compiledWitness as RenderScene|undefined);
  if(!checked)return {status:"not_applicable"};
  if(!checked.ok||!checked.proof||!checked.renderScene)return {status:"declined",issues:checked.issues.map(message=>({code:"existing_organic_structure_declined",severity:"fatal",path:"rawDocument",message}))};
  const proof=checked.proof,scene=checked.renderScene;
  // Carbon vertices are implicit in the actual skeletal strokes. Their locations
  // have just been independently recovered from every checked source bond; add
  // inert helper nodes only for the generic graph binder, never as rendered marks.
  const bindingDocument=structuredClone(document);
  for(const carbon of proof.virtualCarbonAnchors){
   const id=`${carbon.prefix}_a${carbon.sourceAtom}`;
   if(bindingDocument.entities.some(e=>e.id===id))return declined("unexpected_virtual_carbon_entity");
   // The producer rounds raw endpoints to four decimals. Reuse an actual
   // source-proved carbon vertex for the inert binder, so its exact projection
   // check does not compare rounded ink to a different unrounded vertex.
   const endpoints=proof.bondStrokes.filter(stroke=>stroke.prefix===carbon.prefix).flatMap(stroke=>{
    const construction=document.constructions.find(c=>c.outputs.includes(stroke.entityId));
    return [construction?.inputs.start,construction?.inputs.end].flatMap(reference=>{
     const point=document.constructions.find(c=>c.operator==="point"&&c.outputs.includes(String(reference)));
     const {x,y}=point?.inputs??{};
     return typeof x==="number"&&typeof y==="number"&&Math.hypot(x-carbon.worldAnchor.x,y-carbon.worldAnchor.y)<=0.00018?[{x,y}]:[];
    });
   });
   const bindingAnchor=endpoints[0]??carbon.worldAnchor;
   bindingDocument.entities.push({id,kind:"point",role:"construction helper"});
   bindingDocument.constructions.push({id:`existing_virtual_${id}`,operator:"point",inputs:{...bindingAnchor,coordinateSpace:"world"},outputs:[id]});
   bindingDocument.requiredEntityIds.push(id);
   const name=proof.nameLines.find(line=>line.entityId===`${carbon.prefix}_name`);
   const owner=name&&bindingDocument.revealGroups.find(group=>group.entityIds.includes(name.entityId));
   if(!owner)return declined("missing_virtual_carbon_owner");
   owner.entityIds.push(id);
  }
  const bound=bindOrganicRepresentation(bindingDocument,proof.sourceBindings.map((source,index)=>({sourceText:source.source.text,prefix:`m${index}`})));
  if(!bound)return declined("complete_existing_graph_binding_declined");
  const audit=auditChemistryRepresentation(bound,question);
  if(audit.issues.length)return {status:"declined",issues:audit.issues};
  const primitives=new Map(scene.primitives.map(p=>[p.id,p]));
  const labels:NeutralPanelLabelBinding[]=[];
  function membership(entityId:string,primitiveId:string,text:string){
   const p=primitives.get(primitiveId);
   if(!p||p.kind!=="label"||p.entityId!==entityId||p.text!==text||!p.groupId)throw Error("unbound_existing_compiled_label");
   return {entityId,primitiveId,groupId:p.groupId,compiledAnchor:{...p.points[0]!}};
  }
  for(const symbol of proof.symbols){
   const primitive=primitives.get(symbol.primitiveId)!;
   const auditedPrimitive={...primitive,provenance:{...primitive.provenance,chemistryRepresentation:chemistryStructureSymbolProvenance(audit,bound.entities.find(entity=>entity.id===symbol.entityId))}};
   if(symbol.text!=="H"&&!isChemistryStructureSymbolPrimitive(auditedPrimitive,audit))throw Error("unbound_existing_structure_symbol");
   labels.push({...membership(symbol.entityId,symbol.primitiveId,symbol.text),kind:"structure_symbol",sourceArgument:symbol.sourceArgument,graphIdentity:symbol.graphIdentity,sourceAtom:symbol.sourceAtom,hydrogenSlot:symbol.hydrogenSlot,text:symbol.text});
  }
  for(const line of proof.nameLines){
   const source=proof.sourceBindings.find(s=>s.source.start===line.sourceArgument.start&&s.source.end===line.sourceArgument.end&&s.source.text===line.sourceArgument.text);
   if(!source)throw Error("unbound_existing_name_source");
   labels.push({...membership(line.entityId,line.primitiveId,line.text),kind:"complete_source_name_line",sourceArgument:line.sourceArgument,graphIdentity:source.graphIdentity,lineIndex:line.lineIndex,originalStart:line.originalStart,originalEnd:line.originalEnd,text:line.text,...(line.projection?{projection:line.projection}:{})});
  }
  if(scene.primitives.filter(p=>p.kind==="label").length!==labels.length)return declined("unproved_existing_extra_label");
  return {status:"verified",originalQuestion:question,document,renderScene:scene,proof:{...proof,version:"existing-organic-structure-proof/v1",scope:"source-backed-components-only",limitations:[...proof.limitations,"existing complete structural membership only; no whole-request, process or physical-value authority"]},labels};
 }catch(error){return declined(error instanceof Error?error.message:"unsupported_existing_structure_input");}
}

/** Checked dispatch shared by raw-before-normalization presentation/save/reopen/cache.
 * A verified structural subset never changes the whole request's obligation result. */
export function prepareSourceBoundChemistryStructure(input:{originalQuestion:string;rawDocument:unknown;compiledWitness?:unknown}):SourceBoundChemistryStructureCheck {
 const existing=prepareExistingOrganicStructure(input);
 if(existing.status!=="not_applicable")return existing;
 const neutral=prepareNeutralComparison(input);
 if(neutral.status!=="not_applicable")return neutral;
 // Delegation is not an exemption. A closed request with zero resolved
 // species can leave the neutral checker inapplicable to a single frame;
 // remaining canonical structural evidence still requires a proof/refusal.
 try{
  const call=copyNeutralComparisonData(input),raw=record(call)?call.rawDocument:null;
  if(record(raw)&&Array.isArray(raw.entities)&&raw.entities.some(e=>record(e)&&typeof e.id==="string"&&(
   e.kind==="rectangle"&&/^m\d+_panel$/.test(e.id)||/^m\d+_(?:name(?:_\d+)?|a\d+|b\d+(?:_\d+)?|h\d+|hb\d+)$/.test(e.id)
  )))return declined("unchecked_existing_structure_footprint");
  return neutral;
 }catch(error){return declined(error instanceof Error?error.message:"unsupported_existing_structure_input");}
}
