import { sourceFrameDirectionIssues } from "./sourceFrameDirection";
import { sourceRequiredBodyDisplayIssues } from "./sourceRequiredBodyDisplay";
import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";
import type { RenderPrimitive, RenderScene, SceneDocument, SceneEntity, SceneIssue } from "../types";

type Direction = "rightward" | "leftward" | "upward" | "downward";
interface DirectedRequest { direction: Direction; noun: string; start: number; end: number; text: string }
const ACTIONS = new Set(["draw", "sketch", "show", "mark"]);
const CARDINAL: Record<Direction, readonly [number, number]> = {
  rightward: [1, 0], leftward: [-1, 0], upward: [0, -1], downward: [0, 1],
};
const canonical = (value: string): string => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

function directedRequests(question: string): DirectedRequest[] {
  const requests = readSourceDrawingRequests(question);
  // The shared parser retracts drawing actions, while MARK also serves as an
  // annotation action. Reuse its drawing-scope rules for this explicit MARK
  // arrow form. MARK/DRAW have equal UTF-16 lengths, preserving all offsets;
  // the reported evidence always remains the untouched original source.
  let drawingQuestion = question;
  for (const request of requests.filter(value => value.action === "mark").reverse()) {
    drawingQuestion = drawingQuestion.slice(0, request.start) + "draw" + drawingQuestion.slice(request.start + 4);
  }
  const drawingScopes = drawingQuestion === question ? requests : readSourceDrawingRequests(drawingQuestion);
  return requests.flatMap(request => {
    if (request.scope !== "current" || !ACTIONS.has(request.action)) return [];
    if (request.action === "mark" && !drawingScopes.some(value => value.start === request.start && value.scope === "current")) return [];
    const source = sourceUnquotedText(request.text);
    const head = /^\s*(?:draw|sketch|show|mark)\s+(?:(?:a|an|the)\s+)?(rightward|leftward|upward|downward)\s+/i.exec(source);
    if (!head) return [];
    // The adjective must directly describe the requested object. A source
    // body mentioned before later directional prose supplies no obligation.
    const object = source.slice(head[0].length).split(/\s+(?:even\s+though|despite|though|while|at|on|in|about|with|for)\b|[,;]|\s+and\s+/i, 1)[0]!.trim();
    if (!/^[\p{L}][\p{L}\p{N}_-]*(?:\s+[\p{L}][\p{L}\p{N}_-]*){0,3}$/u.test(object) ||
        /\b(?:not|no|never|without)\b/i.test(object) ||
        /\b(?:if|unless|whether|when)\b/i.test(source.slice(head[0].length))) return [];
    return [{ direction: head[1]!.toLowerCase() as Direction, noun: canonical(object),
      start: request.start, end: request.end, text: request.text }];
  });
}

function ownsNoun(entity: SceneEntity, noun: string): boolean {
  if (typeof entity.role !== "string") return false;
  // A role must name this source object itself. IDs, captions, claimed aliases
  // and semantic metadata are not additional owner identities.
  const role = canonical(entity.role);
  if (entity.kind === "ray") return (noun === "ray" || noun.endsWith(" ray")) &&
    (role === noun || noun === "ray" && role.endsWith(" ray"));
  if (entity.kind !== "vector") return false;
  return role === noun || ["force", "vector", "arrow"].some(kind => role === `${noun} ${kind}`);
}

function directedMark(primitive: RenderPrimitive, direction: Direction, ray: boolean): boolean {
  if (!(primitive.kind === "vector" || ray && primitive.kind === "ray") ||
      primitive.points.length !== 2 || primitive.provenance?.labelLeader === true) return false;
  const [start, end] = primitive.points;
  if (!start || !end || ![start.x, start.y, end.x, end.y].every(Number.isFinite)) return false;
  const dx = end.x - start.x, dy = end.y - start.y;
  if (![dx, dy].every(Number.isFinite)) return false;
  const [x, y] = CARDINAL[direction];
  const along = dx * x + dy * y, across = dx * y - dy * x;
  return along > 0 && Math.abs(across) <= along * 1e-6;
}

/** Minimum visible-part admission for literal source-directed requests.
 * This consumes the current compiler's actual scene, never model ink or a
 * stored proof stamp. Success establishes only that the required owner has a
 * displayed cardinal arrow. Source/numeric/force-owner/epoch truth guards are
 * still mandatory; this helper cannot confer physical authority or complete
 * another requested state. Opposite arrows may name the same object in two
 * independently proved states; multiple matching arrows stay ambiguous.
 */
export function sourceDirectedDisplayIssues(
  document: SceneDocument,
  renderScene: RenderScene | null,
  originalQuestion: string,
): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const frameIssues = sourceFrameDirectionIssues(document, renderScene, originalQuestion);
  const bodyIssues = sourceRequiredBodyDisplayIssues(document, renderScene, originalQuestion);
  const requests = directedRequests(originalQuestion);
  if (!requests.length) return [...frameIssues, ...bodyIssues];
  const mismatch = document.source.question !== originalQuestion;
  return [...frameIssues, ...bodyIssues, ...requests.flatMap(request => {
    const owners = document.entities.filter(entity => ownsNoun(entity, request.noun));
    const matching = owners.filter(owner => {
      const ray = owner.kind === "ray";
      const producers = document.constructions.filter(construction => construction.outputs.includes(owner.id));
      if (mismatch || !renderScene || !document.requiredEntityIds.includes(owner.id) || producers.length !== 1 ||
          producers[0]!.operator === "label" || ray && producers[0]!.operator !== "ray") return false;
      const arrows = renderScene.primitives.filter(primitive => primitive.entityId === owner.id &&
        (primitive.kind === "vector" || ray && primitive.kind === "ray") &&
        primitive.provenance?.labelLeader !== true);
      return arrows.length === 1 && directedMark(arrows[0]!, request.direction, ray) &&
        document.revealGroups.some(group => group.id === arrows[0]!.groupId && group.entityIds.includes(owner.id) &&
          renderScene.revealGroups.some(rendered => rendered.id === group.id && rendered.entityIds.includes(owner.id)));
    });
    if (matching.length === 1) return [];
    return [{ code: "required_source_directed_display_unproved", severity: "fatal" as const, failureKind: "truth" as const,
      path: "source.question", entityIds: owners.map(owner => owner.id),
      expected: { start: request.start, end: request.end, text: request.text, direction: request.direction, owner: request.noun },
      message: mismatch ? "The directed-display check requires the exact original source question."
        : `The original question requires ${request.direction} ${request.noun}; no unique required source-named vector or ray has a matching revealed directed mark.` }];
  })];
}
