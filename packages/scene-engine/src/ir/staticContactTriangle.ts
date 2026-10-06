import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { ladderSourceProgram } from "./ladderSourceProgram";
import { resolveLadderSource } from "./rightTriangleSource";
import { collectPlanQuantities } from "../archetypes/slots";
import { validateProblemIR, type ProblemIR } from "./problemIR";
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
  for (const evidence of source.evidence) {
    const given = document.quantities.find(row=>row.id===evidence.role);
    if (!given || given.value !== evidence.value) return null;
  }
  const labels = new Map([["ladder","ladder"],["wall","wall"],["floor","floor"]]);
  if (rawProblem != null) {
    const checked = validateProblemIR(rawProblem, question);
    if (!checked.valid || !checked.problem) return null;
    const joined = staticContactTriangleProblemAgreement(checked.problem);
    if (!joined) return null;
    for (const [part, label] of joined) labels.set(part, label);
  }
  for (const [id,label] of labels) {
    document.entities.find(row=>row.id===id)!.label=label;
    const caption = `${id}_source_name`;
    document.entities.push({id:caption,kind:"label",role:"source contact identity",label});
    document.constructions.push({id:`make_${caption}`,operator:"label",inputs:{target:id,text:label},outputs:[caption]});
    document.requiredEntityIds.push(caption);
    document.revealGroups[0]!.entityIds.push(caption);
  }
  document.source.slotSources = Object.fromEntries(document.quantities.map(row=>[row.id,"stem"]));
  return validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>)).document;
}

function staticContactTriangleProblemAgreement(problem: ProblemIR): Map<string,string> | null {
  const source = readStaticContactTriangle(problem.question);
  if (!source) return null;
  // This initial contact correspondence proves source bodies and prose only.
  // Numeric expressions, requests and structural constraints need their own
  // typed source joins; no matching scalar may stand in for that contract.
  if (problem.expressions.length || problem.solveRequests.length || problem.constraints.length) return null;
  const result = new Map<string,string>();
  const facts = new Map(problem.facts.map(fact=>[fact.id,fact]));
  const parts: Record<string,string> = {ladder:"ladder",wall:"wall",floor:"floor",foot:"A",top:"B",corner:"corner",A:"A",B:"B",O:"corner"};
  for (const entity of problem.entities) {
    const label = entity.label ?? entity.id;
    const part = parts[label];
    const quotes = entity.evidenceFactIds.map(id=>facts.get(id)!.evidence.quote).join(" ");
    const concept = part === "A" ? "foot" : part === "B" ? "top" : part === "corner" ? "wall" : part;
    if (!part || result.has(part) || !new RegExp(`\\b${concept}\\b`,"i").test(quotes)) return null;
    if (["A","B","corner"].includes(part) ? entity.kind!=="point" : !["body","line"].includes(entity.kind)) return null;
    result.set(part,label);
  }
  const requestRole = (text:string):string|null => {
    const match=/^(?:find|calculate|determine) (?:the |its )?(height(?: reached)?|foot distance|length|angle (?:with|to) the (?:floor|horizontal)|cos(?:ine)? (?:of )?(?:the )?angle (?:with|to) the (?:floor|horizontal))[.!?]?$/.exec(normalize(text));
    return match ? match[1]!.startsWith("height")?"height":match[1]!.startsWith("foot")?"distance":match[1]!.startsWith("length")?"length":match[1]!.startsWith("cos")?"cosTheta":"theta" : null;
  };
  for (const fact of problem.facts) {
    const statement = normalize(fact.statement).replace(/[.!?]+$/, "");
    const quote = normalize(fact.evidence.quote).replace(/[.!?]+$/, "");
    if (statement === quote) continue;
    if (fact.kind === "requested") {
      const claimed=requestRole(fact.statement), actual=requestRole(fact.evidence.quote);
      if (!claimed || claimed!==actual) return null;
      continue;
    }
    if (fact.kind !== "given") return null;
    let residue=statement;
    const grounded=source.evidence.filter(evidence=>fact.evidence.quote.includes(evidence.quote));
    for (const evidence of grounded) residue=residue.split(normalize(evidence.quote)).join(`@${evidence.role}`);
    if (!/^(?:the )?ladder (?:has (?:a )?length(?: of)?|length is|is) @length(?: long)?$/.test(residue)
      && !/^(?:the )?(?:ladder )?foot is @distance (?:away )?from the wall$/.test(residue)
      && !/^(?:the )?(?:ladder )?top is @height above the (?:horizontal )?floor$/.test(residue)) return null;
  }
  return result;
}

export function validateStaticContactTriangleSource(document: SceneDocument, question: string, problem?: unknown): SceneIssue[] {
  if (!readStaticContactTriangle(question)) return [];
  const expected = staticContactTriangleDocument(question, undefined, problem);
  const issue = (): SceneIssue[] => [{code:"contact_triangle_source",severity:"fatal",path:"sourceAuthority",message:"The whole source contact triangle, dimensions and IR must bind independently."}];
  if (!expected || document.source.question !== question) return issue();
  const shape = (scene:SceneDocument) => ({entities:scene.entities.map(({provenance:_provenance,...row})=>row),
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
