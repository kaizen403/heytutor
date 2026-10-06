import type { RenderScene } from "@heytutor/scene-engine";

// Dense figures must not flood the teacher's context with all pairwise facts.
// An omitted relation remains unsupported for narration.
const MAX_LAYOUT_FACTS = 32;

/**
 * Describe the engine's compiled screen bounds, never a customary arrangement
 * for the subject. Strictly separated whole bounds prove a relation; centres
 * alone do not. Labels, annotations and invisible extents are not parts.
 */
export function verifiedLayoutNarration(
  scene: RenderScene,
  namedEntityIds: readonly string[],
): string {
  const parts = [...new Set(namedEntityIds)].flatMap((id) => {
    const bounds = scene.entityBounds[id];
    const hasMark = scene.primitives.some((primitive) => primitive.entityId === id
      && primitive.kind !== "label" && primitive.kind !== "dimension"
      && !primitive.provenance?.annotation && primitive.provenance?.dsaExtent !== true);
    if (!hasMark || !bounds || bounds.width < 0 || bounds.height < 0
      || ![bounds.x, bounds.y, bounds.width, bounds.height,
        bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite)) return [];
    return [{ id, bounds }];
  });
  const facts: string[] = [];
  parts.forEach((part, index) => {
    if (facts.length >= MAX_LAYOUT_FACTS) return;
    for (const other of parts.slice(index + 1)) {
      const a = part.bounds;
      const b = other.bounds;
      if (a.x + a.width < b.x) facts.push(`[FOCUS:${part.id}] is left of [FOCUS:${other.id}]`);
      else if (b.x + b.width < a.x) facts.push(`[FOCUS:${other.id}] is left of [FOCUS:${part.id}]`);
      if (facts.length >= MAX_LAYOUT_FACTS) break;
      // Screen y grows downwards. This says nothing about world coordinates.
      if (a.y + a.height < b.y) facts.push(`[FOCUS:${part.id}] is above [FOCUS:${other.id}]`);
      else if (b.y + b.height < a.y) facts.push(`[FOCUS:${other.id}] is above [FOCUS:${part.id}]`);
      if (facts.length >= MAX_LAYOUT_FACTS) break;
    }
  });
  return `Verified screen layout facts for named parts: ${facts.length ? `${facts.join("; ")}.` : "none"}
These facts compare whole compiled part bounds on the displayed board. For narration, replace each target with its listed spoken label and keep its FOCUS tag. Left of also means the other part is right of; above also means the other part is below.
Describe screen placement only using these facts. Do not guess left/right, top/bottom, above/below, or alignment from a customary diagram, the question, or a planner's prose. If no fact establishes a placement, omit that placement and explain the part's listed meaning instead.
Screen placement is presentation only, even for a non-metric representation: it establishes no physical direction, polarity, connection, scale, distance, or solved value.
These evidence limits override any instruction elsewhere asking you to say where a part is or which way it points: omit unsupported claims.`;
}
