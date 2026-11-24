import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";
import { validateProblemIR } from "../ir/problemIR";
import { mechanicsSourceOwnerForPath, replayMechanicsProgram } from "../ir/mechanicsProgram";
import { compileSceneDocument } from "./compiler";
import { mechanicsSourceGeometry } from "./mechanicsGeometry";
import { validateMechanicsSceneSourceBinding } from "../physics/mechanicsSceneAuthority";
import type { RenderScene, SceneDocument, SceneIssue } from "../types";

const ACTIONS = new Set(["draw", "sketch", "show"]);
const canonical = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** A bounded minimum required-body check, not a complete requested-view proof.
 * Only a current imperative naming a validated native body as its direct
 * object applies. The angular/scalar carrier point is never a body boundary.
 * Existing source, numeric, pose, owner, axis and boundary guards still run.
 * This intentionally abstains from pronouns, generic body nouns, multiple
 * state interpretation and any body shape absent from the original program.
 */
export function sourceRequiredBodyDisplayIssues(document: SceneDocument, renderScene: RenderScene | null, originalQuestion: string): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const raw = document.source.mechanicsProblemIR;
  if (!record(raw) || !Array.isArray(raw.entities)) return [];
  const current = readSourceDrawingRequests(originalQuestion).filter(request => request.scope === "current" && ACTIONS.has(request.action));
  const validated = validateProblemIR(raw, originalQuestion).problem;
  const bodies = validated?.entities.filter(entity => entity.kind === "body" && typeof entity.label === "string" && entity.label.length <= 128) ?? [];
  const requests = current.flatMap(request => bodies.flatMap(body => {
    const head = new RegExp(`^\\s*(?:draw|sketch|show)\\s+(?:(?:a|an|the)\\s+)?${escape(canonical(String(body.label)))}(?=$|[^\\p{L}\\p{N}_])`, "u");
    return head.test(canonical(sourceUnquotedText(request.text))) ? [{ request, ownerId: String(body.id), label: String(body.label) }] : [];
  }));
  if (!requests.length) return [];
  const issue = (ownerId: string, label: string, request: typeof current[number], message: string): SceneIssue => ({ code: "required_source_body_display_unproved", severity: "fatal", failureKind: "truth", path: "source.question", entityIds: document.entities.filter(entity => canonical(entity.label ?? "") === canonical(label)).map(entity => entity.id), expected: { ownerId, label, start: request.start, end: request.end, text: request.text }, message });
  if (!validated || validated.question !== originalQuestion || document.source.question !== originalQuestion || originalQuestion.length > 16384 || requests.length > 64)
    return requests.map(({ ownerId, label, request }) => issue(ownerId, label, request, "A required body needs its exact original question and validated native owner."));
  if (validateMechanicsSceneSourceBinding(document, validated, originalQuestion).some(value => value.severity === "fatal"))
    return requests.map(({ ownerId, label, request }) => issue(ownerId, label, request, "The required body has no valid source/numeric/physical-boundary admission."));
  const bindings = Array.isArray(document.source.mechanicsBoundaryBindings) ? document.source.mechanicsBoundaryBindings.filter(record) : [];
  const snapshots = new Map<string, ReturnType<typeof replayMechanicsProgram>>();
  try {
    for (const request of validated.solveRequests) if (request.kind === "mechanics") snapshots.set(request.id, replayMechanicsProgram(validated, request.program, request.resultBinding));
  } catch {
    return requests.map(({ ownerId, label, request }) => issue(ownerId, label, request, "The required body's native physical program cannot be replayed."));
  }
  const fresh = renderScene ? compileSceneDocument(document) : null;
  return requests.flatMap(({ ownerId, label, request }) => {
    const matching = bindings.filter(binding => {
      const snapshot = snapshots.get(String(binding.requestId))?.get(String(binding.stepId));
      if (!snapshot || binding.ownerId !== snapshot.step.ownerId || binding.axisId !== undefined && binding.axisId !== snapshot.step.axisId) return false;
      let source;
      try { source = mechanicsSourceGeometry(snapshot.geometry); } catch { return false; }
      const component = source.bodies.filter(body => (body.componentIndex === undefined ? snapshot.step.ownerId : mechanicsSourceOwnerForPath(snapshot.step, `components.${body.componentIndex}.mass`)) === ownerId);
      const particle = snapshot.geometry.kind === "point" && snapshot.geometry.mechanicsModel?.kind === "particle_motion" && snapshot.step.ownerId === ownerId;
      if (component.length !== 1 && !particle) return false;
      const shape = particle ? "point" : component[0]!.shape;
      const projection = shape === "point" ? "point" : shape === "rod" ? "rod" : ["circular", "disc", "ring", "sphere", "spherical_shell"].includes(shape) ? "circle" : null;
      if (!projection || binding.projection !== projection || (binding.componentOwnerId ?? binding.ownerId) !== ownerId) return false;
      const id = String(binding.outputId), entity = document.entities.filter(value => value.id === id), producers = document.constructions.filter(value => value.outputs.includes(id));
      if (!renderScene || entity.length !== 1 || !document.requiredEntityIds.includes(id) || producers.length !== 1 || producers[0]!.outputs.length !== 1) return false;
      const kind = projection === "rod" ? "line" : projection;
      const marks = renderScene.primitives.filter(value => value.entityId === id && (value.kind === kind || projection === "rod" && value.kind === "polyline") && value.provenance?.labelLeader !== true);
      if (marks.length !== 1 || !marks[0]!.points.length || !marks[0]!.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
      const freshMarks = fresh?.ok ? fresh.renderScene?.primitives.filter(value => value.entityId === id && (value.kind === kind || projection === "rod" && value.kind === "polyline") && value.provenance?.labelLeader !== true) : [];
      if (freshMarks?.length !== 1 || JSON.stringify({kind:marks[0]!.kind,points:marks[0]!.points,radius:marks[0]!.radius}) !== JSON.stringify({kind:freshMarks[0]!.kind,points:freshMarks[0]!.points,radius:freshMarks[0]!.radius})) return false;
      if (projection === "circle" && !(Number(marks[0]!.radius) > 0)) return false;
      if (projection === "rod" && (marks[0]!.points.length !== 2 || marks[0]!.points[0]!.x === marks[0]!.points[1]!.x && marks[0]!.points[0]!.y === marks[0]!.points[1]!.y)) return false;
      return document.revealGroups.some(group => group.id === marks[0]!.groupId && group.entityIds.includes(id) && renderScene.revealGroups.some(value => value.id === group.id && value.entityIds.includes(id)));
    });
    if (matching.length === 1) return [];
    return [issue(ownerId, label, request, `The original question asks to draw ${label}; no unique revealed source-owned body boundary proves that body. A native scalar/angular-state point, axis or spin glyph cannot supply its missing outline.`)];
  });
}
