import type { RenderPrimitive, RenderScene } from "@heytutor/scene-engine";

// Dense figures must not flood the teacher's context with all pairwise facts.
// An omitted relation remains unsupported for narration.
const MAX_LAYOUT_FACTS = 32;

type Extents = { left: number; top: number; right: number; bottom: number };

function primitiveExtents(primitive: RenderPrimitive): Extents | null {
  const points = primitive.points;
  if (
    !points.length ||
    !points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    )
  )
    return null;
  if (primitive.kind === "circle" || primitive.kind === "arc") {
    const radius = primitive.radius;
    if (
      points.length !== 1 ||
      radius === undefined ||
      !Number.isFinite(radius) ||
      radius < 0
    )
      return null;
    if (
      primitive.kind === "arc" &&
      ![primitive.startAngle, primitive.endAngle].every(
        (angle) => typeof angle === "number" && Number.isFinite(angle),
      )
    )
      return null;
    const center = points[0]!;
    // The complete circle envelope is conservative for any arc sweep.
    const bounds = {
      left: center.x - radius,
      top: center.y - radius,
      right: center.x + radius,
      bottom: center.y + radius,
    };
    return Object.values(bounds).every(Number.isFinite) ? bounds : null;
  }
  switch (primitive.kind) {
    case "point":
    case "label":
      if (points.length !== 1) return null;
      break;
    case "line":
    case "ray":
    case "vector":
    case "polyline":
      if (points.length < 2) return null;
      break;
    case "rectangle":
    case "polygon":
      if (points.length < 3) return null;
      break;
    case "axes":
      if (points.length !== 4) return null;
      break;
    default:
      return null;
  }
  return points.reduce(
    (bounds, point) => ({
      left: Math.min(bounds.left, point.x),
      top: Math.min(bounds.top, point.y),
      right: Math.max(bounds.right, point.x),
      bottom: Math.max(bounds.bottom, point.y),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

function wholePartExtents(scene: RenderScene, id: string): Extents | null {
  const cached = scene.entityBounds[id];
  if (
    !cached ||
    cached.width < 0 ||
    cached.height < 0 ||
    ![
      cached.x,
      cached.y,
      cached.width,
      cached.height,
      cached.x + cached.width,
      cached.y + cached.height,
    ].every(Number.isFinite)
  )
    return null;
  const bounds = {
    left: cached.x,
    top: cached.y,
    right: cached.x + cached.width,
    bottom: cached.y + cached.height,
  };
  let hasBody = false;
  for (const primitive of scene.primitives) {
    if (
      primitive.entityId !== id ||
      primitive.kind === "dimension" ||
      primitive.provenance?.annotation ||
      primitive.provenance?.dsaExtent === true
    )
      continue;
    // Summary labels can live in a separate givens block. Summary *geometry*
    // still belongs to the body, even though the engine's cache excludes it.
    if (primitive.kind === "label" && primitive.provenance?.summary === true)
      continue;
    const complete = primitiveExtents(primitive);
    if (!complete) return null;
    if (primitive.kind !== "label") hasBody = true;
    // Cache/label consistency is required, but the cache alone is never proof.
    // Allow only floating-point roundoff from the compiler's bounds unions.
    const tolerance =
      Number.EPSILON *
      8 *
      Math.max(
        1,
        ...Object.values(bounds).map(Math.abs),
        ...Object.values(complete).map(Math.abs),
      );
    if (
      complete.left < bounds.left - tolerance ||
      complete.top < bounds.top - tolerance ||
      complete.right > bounds.right + tolerance ||
      complete.bottom > bounds.bottom + tolerance
    )
      return null;
    bounds.left = Math.min(bounds.left, complete.left);
    bounds.top = Math.min(bounds.top, complete.top);
    bounds.right = Math.max(bounds.right, complete.right);
    bounds.bottom = Math.max(bounds.bottom, complete.bottom);
  }
  return hasBody ? bounds : null;
}

/**
 * Describe complete compiled screen bounds, never a customary arrangement.
 * Every body primitive must be finite and enclosed by the cached bounds;
 * ordinary label anchors must agree too. Unknown or partial extents omit facts.
 */
export function verifiedLayoutNarration(
  scene: RenderScene,
  namedEntityIds: readonly string[],
): string {
  const parts = [...new Set(namedEntityIds)].flatMap((id) => {
    const bounds = wholePartExtents(scene, id);
    return bounds ? [{ id, bounds }] : [];
  });
  const facts: string[] = [];
  parts.forEach((part, index) => {
    if (facts.length >= MAX_LAYOUT_FACTS) return;
    for (const other of parts.slice(index + 1)) {
      const a = part.bounds;
      const b = other.bounds;
      if (a.right < b.left)
        facts.push(`[FOCUS:${part.id}] is left of [FOCUS:${other.id}]`);
      else if (b.right < a.left)
        facts.push(`[FOCUS:${other.id}] is left of [FOCUS:${part.id}]`);
      if (facts.length >= MAX_LAYOUT_FACTS) break;
      // Screen y grows downwards. This says nothing about world coordinates.
      if (a.bottom < b.top)
        facts.push(`[FOCUS:${part.id}] is above [FOCUS:${other.id}]`);
      else if (b.bottom < a.top)
        facts.push(`[FOCUS:${other.id}] is above [FOCUS:${part.id}]`);
      if (facts.length >= MAX_LAYOUT_FACTS) break;
    }
  });
  return `Verified screen layout facts for named parts: ${facts.length ? `${facts.join("; ")}.` : "none"}
These facts compare whole compiled part bounds on the displayed board. For narration, replace each target with its listed spoken label and keep its FOCUS tag. Left of also means the other part is right of; above also means the other part is below.
Describe screen placement only using these facts. Do not guess left/right, top/bottom, above/below, or alignment from a customary diagram, the question, or a planner's prose. If no fact establishes a placement, omit that placement and explain the part's listed meaning instead.
Screen placement is presentation only, even for a non-metric representation: it establishes no physical direction, polarity, connection, scale, distance, or solved value.
These evidence limits override any instruction elsewhere asking you to say where a part is or which way it points: omit unsupported claims.`;
}
