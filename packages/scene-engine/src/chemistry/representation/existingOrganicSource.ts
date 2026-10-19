/** Complete original source components of an existing figure; no whole-ask authority. */
import type { SceneDocument } from "../../types";
import { findChemistrySourceSpan } from "./bindings";
import { checkedChemistrySourceIdentity, chemistrySpeciesIdentity, resolveChemistryStructure, sameOrganicGraph } from "./species";
import { closeComparisonSource, supportedGraph, type ComparisonSpecies } from "./neutralComparisonSource";

export type ExistingOrganicComponent = ComparisonSpecies & { readonly prefix: string; readonly renderedName: string };
export function existingOrganicComponents(document: SceneDocument, question: string): ExistingOrganicComponent[] | null {
 if(closeComparisonSource(question).schema !== null) return null; // Closed neutral producer retains its independent contract.
 const frames=document.entities.filter(entity=>entity.kind==="rectangle"&&/^m\d+_panel$/.test(entity.id));
 if(!frames.length)return null;
 if(frames.length>6)throw Error("unsupported_existing_component_count");
 const components:ExistingOrganicComponent[]=[];
 for(let index=0;index<frames.length;index++){
  const prefix=`m${index}`;
  if(!frames.some(frame=>frame.id===`${prefix}_panel`))throw Error("incomplete_existing_component_indices");
  const nameEntities=document.entities.filter(entity=>entity.id===`${prefix}_name`||new RegExp(`^${prefix}_name_\\d+$`).test(entity.id));
  if(!nameEntities.length||nameEntities.length>10)throw Error("missing_complete_existing_name");
  const lines=nameEntities.map((_,line)=>document.entities.find(entity=>entity.id===`${prefix}_name${line?`_${line}`:""}`)?.label);
  if(lines.some(line=>typeof line!=="string"||!line.length||line!==line.trim()))throw Error("partial_existing_name");
  const renderedName=lines.join(" ");
  const identity=chemistrySpeciesIdentity(renderedName), resolvedName=resolveChemistryStructure(renderedName,"organic");
  if(!identity||!resolvedName?.molecule)throw Error("unresolved_existing_component_name");
  const source=findChemistrySourceSpan(question,renderedName);
  if(!source||!checkedChemistrySourceIdentity(question,source,identity.key))throw Error("existing_name_not_in_complete_original_source");
  if(source.text.toLowerCase()!==renderedName.toLowerCase()||source.text.length!==renderedName.length)throw Error("unsupported_existing_name_projection");
  const resolved=resolveChemistryStructure(source.text,"organic");
  if(!resolved?.molecule||!sameOrganicGraph(resolved.molecule,resolvedName.molecule))throw Error("existing_source_graph_conflict");
  const species:ExistingOrganicComponent={source,sourceIdentity:identity.key,graphIdentity:resolved.identityKey,resolved,prefix,renderedName};
  if(!supportedGraph(species))throw Error("unsupported_existing_component_graph");
  components.push(species);
 }
 if(new Set(components.map(component=>component.graphIdentity)).size!==components.length)throw Error("duplicate_existing_component_identity");
 return components;
}
