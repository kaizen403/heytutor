import type { SceneDocument } from "../../types";

/** Source-resolved ink policy, separate from a physical bond measurement. */
export interface VseprBondInkPlan {
  ligandLabel: string;
  style: "plain" | "dash" | "wedge";
  strokeCount: 1 | 2 | 3;
}
/** Actual outputs returned by the engine's bond operator. */
export interface RenderedChemistryBond {
  ligandEntityId: string;
  entityIds: string[];
}
type Position = { x: number; y: number };
function anchor(document: SceneDocument, id: string | undefined, seen = new Set<string>()): Position | null {
  if (!id || seen.has(id)) return null;
  seen.add(id);
  const construction = document.constructions.find((c) => c.outputs.includes(id));
  if (!construction) return null;
  const input = construction.inputs;
  if (construction.operator === "point" && typeof input.x === "number" && typeof input.y === "number" && Number.isFinite(input.x) && Number.isFinite(input.y)) return { x: input.x, y: input.y };
  if (construction.operator === "label") return anchor(document, typeof input.target === "string" ? input.target : undefined, seen);
  return null;
}

/** Check every actual stroke/wedge against the independently recomputed source
 * operator. Distinct parallel strokes must be attached, centered and evenly
 * spaced; a repeated/detached/wrong-kind output cannot certify a multiple bond. */
export function checkedVseprBondInk(document: SceneDocument, ids: string[], first: string | undefined, second: string | undefined, expected: VseprBondInkPlan): boolean {
  if (ids.length !== expected.strokeCount || new Set(ids).size !== ids.length) return false;
  const a = anchor(document, first), b = anchor(document, second);
  if (!a || !b) return false;
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  if (squared <= 1e-16) return false;
  const fraction = (p: Position): number => ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared;
  const offset = (p: Position): number => ((p.x - a.x) * dy - (p.y - a.y) * dx) / squared;
  const tolerance = 6e-4 / Math.sqrt(squared);
  const strokes: Array<{ low: number; high: number; offset: number }> = [];
  for (const id of ids) {
    const entity = document.entities.find((e) => e.id === id);
    const constructions = document.constructions.filter((c) => c.outputs.includes(id));
    if (!entity || constructions.length !== 1) return false;
    const construction = constructions[0]!;
    let start: Position | null = null, end: Position | null = null;
    if (expected.style === "wedge") {
      if (entity.kind !== "polygon" || construction.operator !== "polygon" || !Array.isArray(construction.inputs.points) || construction.inputs.points.length !== 3 || entity.provenance?.dashed) return false;
      const points = construction.inputs.points.map((p) => anchor(document, typeof p === "string" ? p : undefined));
      if (points.some((p) => p === null)) return false;
      const [tip, left, right] = points as [Position, Position, Position];
      if (Math.abs(offset(left) - offset(right)) <= tolerance || Math.abs(fraction(left) - fraction(right)) > tolerance) return false;
      start = tip; end = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
      // The source operator orders central first, ligand second. A wedge is
      // directed: its tip is central-side and its transverse base ligand-side.
      if (fraction(start) >= 0.45 || fraction(end) <= 0.55) return false;
    } else {
      if (entity.kind !== "segment" || construction.operator !== "segment" || Boolean(entity.provenance?.dashed) !== (expected.style === "dash")) return false;
      start = anchor(document, typeof construction.inputs.start === "string" ? construction.inputs.start : undefined);
      end = anchor(document, typeof construction.inputs.end === "string" ? construction.inputs.end : undefined);
    }
    if (!start || !end) return false;
    const low = Math.min(fraction(start), fraction(end)), high = Math.max(fraction(start), fraction(end));
    const firstOffset = offset(start), lastOffset = offset(end);
    if (low < -1e-6 || low >= 0.45 || high <= 0.55 || high > 1 + 1e-6 || Math.abs(firstOffset) >= 0.15 || Math.abs(lastOffset) >= 0.15 || Math.abs(firstOffset - lastOffset) > tolerance) return false;
    strokes.push({ low, high, offset: (firstOffset + lastOffset) / 2 });
  }
  if (strokes.some((stroke) => Math.abs(stroke.low - strokes[0]!.low) > tolerance || Math.abs(stroke.high - strokes[0]!.high) > tolerance)) return false;
  const offsets = strokes.map((stroke) => stroke.offset).sort((x, y) => x - y);
  if (Math.abs(offsets.reduce((sum, value) => sum + value, 0)) > tolerance * offsets.length) return false;
  for (let i = 1; i < offsets.length; i += 1) if (offsets[i]! - offsets[i - 1]! <= tolerance) return false;
  return offsets.length !== 3 || Math.abs((offsets[2]! - offsets[1]!) - (offsets[1]! - offsets[0]!)) <= tolerance;
}
