import { unwrapMathMarkup } from "@heytutor/drawing";
import { compileSceneDocument } from "../compile/compiler";
import { validateAtomicSourceBinding } from "../physics/atomicSceneAuthority";
import { readOriginalCoulombModel, validateSourceCoulombObligation } from "../physics/sourceCoulombObligation";
import { validateTurnPlanV3, validateTurnPlanSceneProofs, type TurnPlanV3 } from "../contracts/contractsV3";
import { validateProblemIR, type ProblemIR } from "../ir/problemIR";
import { proveSourceQualitativeProfile } from "../compile/sourceQualitativeProfile";
import { readSourceDrawingRequests } from "../document/sourceRequestScope";
import { requestedViewOwnerNames, requestedViewLabelNamesOwner } from "../document/planViewOwners";
import type { RenderPrimitive, SceneDocument } from "../types";
import { ARCHETYPES, type ArchetypeId } from "./catalog";

type Claim = TurnPlanV3["qualitativeClaims"][number];
type Point = { x: number; y: number };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
const normal = (value: string) => unwrapMathMarkup(value).normalize("NFKC").toLowerCase().replace(/[−–—]/g, "-").replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
const words = (value: string): string[] => normal(value).match(/[\p{L}\p{N}]+/gu) ?? [];
const isPlural = (value: string) => value.length > 3 && value.endsWith("s") && !/(?:us|ss|is)$/.test(value);
const singular = (value: string) => isPlural(value) ? value.slice(0, -1) : value;
const contains = (haystack: string, needle: string) => {
  const text = words(haystack).map(singular), name = words(needle).map(singular);
  return name.length > 0 && text.some((_, index) => name.every((token, offset) => text[index + offset] === token));
};
const declaration = (claim: Claim) => `${claim.claim}. ${typeof claim.expected === "string" ? claim.expected : ""}`;
const positive = (value: string) => !/\b(?:no|not|never|without|cannot|don['’]t|can['’]t)\b/i.test(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const sameQuestion = (a: unknown, b: string) => typeof a === "string" && a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

function nativeLabels(document: SceneDocument, primitives: RenderPrimitive[], allowLayoutReferences = false) {
  const required = new Set(document.requiredEntityIds);
  return primitives.filter(part => part.kind === "label" && typeof part.text === "string" && required.has(part.entityId) &&
    document.entities.some(entity => entity.id === part.entityId && entity.kind !== "label" && entity.kind !== "group") &&
    (primitives.some(mark => mark.entityId === part.entityId && mark.kind !== "label" && mark.provenance?.labelLeader !== true) ||
      allowLayoutReferences && literalPoint(document, part.entityId) !== null));
}
function literalPoint(document: SceneDocument, id: string): Point | null {
  const construction = document.constructions.find(item => item.outputs.includes(id));
  if (!construction || construction.operator !== "point" || construction.outputs.length !== 1 || construction.inputs.coordinateSpace !== "layout" ||
      !number(construction.inputs.x) || !number(construction.inputs.y)) return null;
  return { x: construction.inputs.x, y: construction.inputs.y };
}
function sourceProfile(document: SceneDocument, plan: TurnPlanV3, labels: RenderPrimitive[], problem?: ProblemIR): string[] | null {
  if (problem) {
    const facts = new Map(problem.facts.map(fact => [fact.id, fact]));
    const requests = readSourceDrawingRequests(plan.question).filter(request => request.scope === "current" &&
      ["draw", "sketch", "plot", "graph", "show"].includes(request.action));
    const requested = problem.representationIntents.some(intent => intent.kind === "graph" && intent.evidenceFactIds.some(id => {
      const fact = facts.get(id);
      return fact?.kind === "requested" && requests.some(request => request.start >= fact.evidence.start &&
        request.start + request.action.length <= fact.evidence.end);
    }));
    if (!requested) return null;
  }
  const proof = proveSourceQualitativeProfile(document, plan);
  if (!proof || !proof.marks.every(mark => labels.some(label => {
    const displayed = words(label.text!);
    return label.entityId === mark.entityId && displayed.length >= Math.min(2, mark.name.length) && displayed.length <= mark.name.length &&
      displayed.every((word, index) => word === mark.name[index]);
  }))) return null;
  return proof.ownerIds;
}

function sourceViewName(claim: Claim, question: string): string | null {
  if (claim.expected === false || !positive(claim.claim)) return null;
  const head = claim.claim.replace(/^\s*(?:draw|show|sketch|separate|keep)\s+/i, "");
  const name = /\bview\s*$/i.test(head) ? head.replace(/\s+view\s*$/i, "") : /\b(?:inset|panel)\s*$/i.test(head) ? head : null;
  if (!name) return null;
  const source = readSourceDrawingRequests(question).find(request => request.scope === "current" &&
    ["draw", "show", "sketch", "separate", "keep"].includes(request.action) &&
    contains(request.action === "separate" || request.action === "keep" ? request.text.split(/\bfrom\b/i, 1)[0]! : request.text, name));
  return source ? name : null;
}
function geometryBounds(primitives: RenderPrimitive[], ids: Set<string>): Bounds | null {
  const marks = primitives.filter(part => ids.has(part.entityId) && part.kind !== "label" && part.provenance?.labelLeader !== true);
  const points = marks.flatMap(part => part.points.flatMap(point => [{ x: point.x - (part.radius ?? 0), y: point.y - (part.radius ?? 0) }, { x: point.x + (part.radius ?? 0), y: point.y + (part.radius ?? 0) }]));
  return points.length ? { minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)), minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y)) } : null;
}
function separateSourceViews(document: SceneDocument, plan: TurnPlanV3, labels: RenderPrimitive[], primitives: RenderPrimitive[]): string[] | null {
  if (!readSourceDrawingRequests(plan.question).some(request => request.scope === "current" &&
    (request.action === "separate" || request.action === "keep" && /\b(?:separate|distinct)\b/i.test(request.text)))) return null;
  const views = plan.qualitativeClaims.flatMap(claim => sourceViewName(claim, plan.question) ? [{ claim, names: requestedViewOwnerNames(claim) }] : []);
  if (views.length < 2 || views.some(view => view.names.length < 2)) return null;
  const bound: Set<string>[] = [];
  for (const view of views) {
    const ids = new Set<string>();
    for (const name of view.names) {
      const matches = labels.filter(label => !/\b(?:not|unidentified)\b/i.test(label.text!) &&
        requestedViewLabelNamesOwner(document, label.entityId, label.text!, name, view.claim));
      const owners = [...new Set(matches.map(label => label.entityId))];
      const plural = isPlural(words(name).at(-1) ?? "");
      const collectiveLabel = matches.some(label => words(label.text!).includes(words(name).at(-1)!));
      if (!owners.length || !plural && owners.length !== 1 || plural && owners.length < 2 && !collectiveLabel) return null;
      if (owners.some(id => ids.has(id))) return null;
      owners.forEach(id => ids.add(id));
    }
    if (bound.some(other => [...ids].some(id => other.has(id)))) return null;
    bound.push(ids);
  }
  const bounds = bound.map(ids => geometryBounds(primitives, ids));
  if (bounds.some(value => !value)) return null;
  if (bounds.some((value, index) => bounds.slice(index + 1).some(other => value && other &&
    !(value.maxX < other.minX || other.maxX < value.minX || value.maxY < other.minY || other.maxY < value.minY)))) return null;
  return bound.flatMap(ids => [...ids]);
}

/** A law bonus owns only its catalogue figure, not every other source request.
 * This bounded proof permits a qualitative requested profile, separate named
 * views, or a source-proved native Coulomb view. It regenerates source/geometry/labels; metadata and roles
 * cannot certify the exception. All final source, report and save checks remain.
 */
export function sourceRequestedViewEligibility(input: { question: string; plan: TurnPlanV3; document: SceneDocument; lawArchetype: ArchetypeId; problemIR?: unknown }): { ownerIds: string[]; kind: "profile" | "separate_views" | "native_coulomb" } | null {
  const { question, document } = input;
  const plan = validateTurnPlanV3(input.plan, question).plan;
  if (!plan || !sameQuestion(plan.question, question) || !sameQuestion(document.source.question, question) || plan.visualRequirement !== "required" ||
      document.visualDecision.mode !== "scene") return null;
  const roleText = plan.qualitativeClaims.filter(claim => claim.expected !== false).map(declaration).join("; ");
  if (ARCHETYPES[input.lawArchetype].contract.roles.every(role => contains(roleText, role))) return null;
  if (validateAtomicSourceBinding(document, plan).some(issue => issue.severity === "fatal") || validateTurnPlanSceneProofs(document, plan, input.problemIR).some(issue => issue.severity === "fatal")) return null;
  const compiled = compileSceneDocument(document, { figureConsistency: true });
  if (!compiled.ok || !compiled.renderScene) return null;
  // The law-only catalogue lead cannot veto a different, explicitly requested
  // native physical program proved from the original question. A native tag
  // never grants this exception to unrelated geometry: every entity and
  // construction here must be part of the independently re-executed program.
  const nativeOwners = document.constructions.filter(item => item.operator === "rutherford_scattering").flatMap(item => item.outputs);
  if (readOriginalCoulombModel(question) && nativeOwners.length > 0 &&
      (input.problemIR == null || validateProblemIR(input.problemIR, question).valid) &&
      document.constructions.every(item => item.operator === "rutherford_scattering") &&
      document.entities.every(entity => nativeOwners.includes(entity.id) && entity.kind === "polyline") &&
      !validateSourceCoulombObligation(document, plan, question).some(issue => issue.severity === "fatal"))
    return { ownerIds: nativeOwners, kind: "native_coulomb" };
  if (plan.givens.length || plan.unknowns.length || plan.derived.length || document.quantities.length) return null;
  const labels = nativeLabels(document, compiled.renderScene.primitives);
  if (input.problemIR != null) {
    const problem = validateProblemIR(input.problemIR, question);
    if (!problem.valid || !problem.problem) return null;
    const owners = sourceProfile(document, plan, nativeLabels(document, compiled.renderScene.primitives, true), problem.problem);
    if (owners) return { ownerIds: owners, kind: "profile" };
  }
  if (input.problemIR == null) {
    const owners = sourceProfile(document, plan, nativeLabels(document, compiled.renderScene.primitives, true));
    if (owners) return { ownerIds: owners, kind: "profile" };
  }
  const owners = separateSourceViews(document, plan, labels, compiled.renderScene.primitives);
  return owners ? { ownerIds: owners, kind: "separate_views" } : null;
}
