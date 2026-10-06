import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { ladderSourceProgram } from "./ladderSourceProgram";
import { resolveLadderSource } from "./rightTriangleSource";
import { collectPlanQuantities } from "../archetypes/slots";
import { validateProblemIR } from "./problemIR";
import { bindStaticContactTriangleProblem } from "./staticContactTriangleProblemBinding";
import type { SceneDocument, SceneIssue } from "../types";

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
/** Consume all source clauses for a static perpendicular contact triangle. */
export function readStaticContactTriangle(question: string) {
  const source = resolveLadderSource(question);
  if (!source.ok) return null;
  let residue = question;
  for (const evidence of [...source.evidence].sort((a,b)=>b.start-a.start))
    residue = residue.slice(0,evidence.start)+`@${evidence.role}`+residue.slice(evidence.end);
  const clauses = normalize(residue).replace(/[.!?]+$/, "").split(/\.\s*/);
  const setup = /^(?:a ladder of length @length|a @length long ladder|a ladder) leans against a vertical wall(?: with its foot @distance to the (?:left|right) of the wall on a horizontal floor)?$/;
  if (!setup.test(clauses.shift() ?? "")) return null;
  const request = clauses.pop();
  if (!request || !/^(?:find|calculate|determine) (?:the |its )?(?:height(?: reached)?|foot distance|length|angle (?:with|to) the (?:floor|horizontal)|cos(?:ine)? (?:of )?(?:the )?angle (?:with|to) the (?:floor|horizontal))$/.test(request)) return null;
  if (!clauses.length && source.evidence.length < 2) return null;
  for (const clause of clauses) {
    if (!/^its foot is @distance (?:from|away from) the wall on a horizontal floor$/.test(clause)
      && !/^its top is @height above (?:the horizontal floor|the floor)$/.test(clause)) return null;
  }
  return source;
}

/** Genuine labels attach to the existing contact geometry, never fake bodies. */
export function staticContactTriangleDocument(question: string, plan?: unknown, rawProblem?: unknown): SceneDocument | null {
  const source = readStaticContactTriangle(question);
  if (!source || !resolveLadderSource(question, collectPlanQuantities(plan)).ok) return null;
  const document = ladderSourceProgram(question);
  if (!document) return null;
  // Source state owns the full precision; the reusable builder rounds display ink.
  for (const row of document.quantities) {
    const role = row.id as keyof typeof source.state;
    if (role in source.state) row.value = source.state[role];
  }
  for (const evidence of source.evidence) {
    const given = document.quantities.find(row=>row.id===evidence.role);
    if (!given || given.value !== evidence.value) return null;
  }
  const labels = new Map([["ladder","ladder"],["wall","wall"],["floor","floor"]]);
  if (rawProblem != null) {
    const checked = validateProblemIR(rawProblem, question);
    if (!checked.valid || !checked.problem) return null;
    const joined = bindStaticContactTriangleProblem(checked.problem, source, plan);
    if (!joined) return null;
    for (const [part, label] of joined.labels) labels.set(part, label);
    for (const quantity of joined.quantities) {
      if (document.entities.some(row => row.id === quantity.id)) return null;
      const index = document.quantities.findIndex(row => row.id === quantity.id);
      if (index < 0) document.quantities.push(quantity);
      else document.quantities[index] = quantity;
    }
    document.annotations.push(...joined.annotations);
    for (const { id, targetId, text } of joined.dimensionLabels) {
      if (document.entities.some(row => row.id === id)) return null;
      document.entities.push({ id, kind: "label", role: "source-bound contact dimension", label: text });
      document.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target: targetId, text }, outputs: [id] });
      document.requiredEntityIds.push(id);
      document.revealGroups.find(group => group.id === "dimensions")!.entityIds.push(id);
    }
    for (const id of joined.entityBindings.values()) {
      if (!document.requiredEntityIds.includes(id)) document.requiredEntityIds.push(id);
    }
  }
  for (const [id,label] of labels) {
    document.entities.find(row=>row.id===id)!.label=label;
    if (["A", "B", "corner"].includes(id)) continue;
    const caption = `${id}_source_name`;
    document.entities.push({id:caption,kind:"label",role:"source contact identity",label});
    document.constructions.push({id:`make_${caption}`,operator:"label",inputs:{target:id,text:label},outputs:[caption]});
    document.requiredEntityIds.push(caption);
    document.revealGroups[0]!.entityIds.push(caption);
  }
  if (document.quantities.some(quantity => document.entities.some(entity => entity.id === quantity.id))) return null;
  document.source.slotSources = Object.fromEntries(document.quantities.map(row=>[row.id,"stem"]));
  return validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>)).document;
}

export function validateStaticContactTriangleSource(document: SceneDocument, question: string, problem?: unknown): SceneIssue[] {
  if (!readStaticContactTriangle(question)) return [];
  const expected = staticContactTriangleDocument(question, undefined, problem);
  const issue = (): SceneIssue[] => [{code:"contact_triangle_source",severity:"fatal",path:"sourceAuthority",message:"The whole source contact triangle, dimensions and IR must bind independently."}];
  if (!expected || document.source.question !== question) return issue();
  const shape = (scene:SceneDocument) => ({schemaVersion:scene.schemaVersion,mode:scene.visualDecision.mode,entities:scene.entities.map(({provenance:_provenance,...row})=>row),
    quantities:scene.quantities,constructions:scene.constructions,assertions:scene.assertions,relations:scene.relations,
    annotations:scene.annotations,requiredEntityIds:scene.requiredEntityIds,revealGroups:scene.revealGroups,teachingTimeline:scene.teachingTimeline});
  const canonical = (value:unknown):unknown => Array.isArray(value)?value.map(canonical):value!==null&&typeof value==="object"
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
  const actual = JSON.stringify(canonical(shape(document)));
  const canonicalExpected = JSON.stringify(canonical(shape(expected)));
  if (actual === canonicalExpected) return [];
  // The raw generator's independently recomputed geometry remains a public
  // compiler control. Whole caller IR admission uses the named representation.
  if (problem == null) {
    const raw = ladderSourceProgram(question);
    if (raw && actual === JSON.stringify(canonical(shape(raw)))) return [];
  }
  return issue();
}
