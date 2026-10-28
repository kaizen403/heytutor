/**
 * The figure a doubt pointed at.
 *
 * A doubt continues the page the lesson left (`boardContinuation.ts`), so the
 * figure in the zone while it taught belongs to an earlier turn. The doubt is
 * saved without a scene of its own, which used to mean every FOCUS it spoke was
 * dropped on save: the server only keeps pointing that resolves against a
 * validated figure. This reference names that earlier turn, so the server can
 * load its figure, check the doubt's pointing against it, and keep what
 * resolves. A reference the server cannot resolve drops the pointing and keeps
 * the words, exactly as before.
 */

export const DOUBT_FIGURE_REF_VERSION = "doubt-figure-ref/v1" as const;
export type DoubtFigureKind = "verified_scene" | "reference_picture" | "dsa_frame";

const DOUBT_FIGURE_KINDS: readonly DoubtFigureKind[] = ["verified_scene", "reference_picture", "dsa_frame"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** sceneArtifacts.pointsAtFigure on a doubt: the figure in the zone while it taught. */
export interface DoubtFigureRef {
  schemaVersion: typeof DOUBT_FIGURE_REF_VERSION;
  /** Turn.id (checkpoint UUID) of the turn whose figure was drawn in the zone. */
  turnId: string;
  kind: DoubtFigureKind;
  /** dsa_frame only: index into resolveDsaFrames(turn.question, plan.diagramHint, plan).frames. */
  frameIndex?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The reference, validated, or null. Tolerates any other artifacts beside it. */
export function doubtFigureRefOf(sceneArtifacts: unknown): DoubtFigureRef | null {
  if (!isRecord(sceneArtifacts)) return null;
  const raw = sceneArtifacts.pointsAtFigure;
  if (!isRecord(raw) || raw.schemaVersion !== DOUBT_FIGURE_REF_VERSION) return null;
  if (typeof raw.turnId !== "string" || !UUID.test(raw.turnId)) return null;
  const kind = raw.kind;
  if (typeof kind !== "string" || !DOUBT_FIGURE_KINDS.includes(kind as DoubtFigureKind)) return null;
  if (kind === "dsa_frame") {
    const frameIndex = raw.frameIndex;
    if (typeof frameIndex !== "number" || !Number.isInteger(frameIndex) || frameIndex < 0) return null;
    return { schemaVersion: DOUBT_FIGURE_REF_VERSION, turnId: raw.turnId, kind, frameIndex };
  }
  if (raw.frameIndex !== undefined) return null;
  return { schemaVersion: DOUBT_FIGURE_REF_VERSION, turnId: raw.turnId, kind: kind as DoubtFigureKind };
}

/** Scene artifacts naming the figure a doubt pointed at. */
export function doubtFigureRefArtifacts(ref: DoubtFigureRef): { pointsAtFigure: DoubtFigureRef } {
  const pointsAtFigure: DoubtFigureRef = {
    schemaVersion: DOUBT_FIGURE_REF_VERSION,
    turnId: ref.turnId,
    kind: ref.kind,
  };
  if (ref.kind === "dsa_frame") pointsAtFigure.frameIndex = ref.frameIndex;
  return { pointsAtFigure };
}

/** Live doubt filter policy, built in uQH, applied by doubtSegment. */
export interface DoubtPointingPolicy {
  /** DIAGRAM_DOUBT_POINTING granted for this turn. */
  enabled: boolean;
  /** Lowercased anchor ids, anchor labels and group ids of the figure in the zone. Empty: no figure. */
  figureIds: ReadonlySet<string>;
  /** Code lesson board: FOCUS only, emphasis forced to spotlight, no keep, no ANNOTATE. */
  codeBoard: boolean;
}
