import { parseFocusSpec, resolveVerifiedDiagramFocusTargets, type DrawCommand, type VerifiedDiagram, type VerifiedDiagramAnchor } from "@heytutor/drawing";
import type { ExecuteCommandOptions } from "../../hooks/turn/types";
import type { SegmentInkClock } from "./segmentInk";

/** Leave the pen's approach to WRITE's existing character schedule. */
const WRITE_APPROACH_WALL_MS = 800;
const MIN_EXPLANATION_GAP_WALL_MS = 2_400;

export type CompletedExplanationTarget = { command: DrawCommand; diagram: VerifiedDiagram; anchors: readonly VerifiedDiagramAnchor[] };

/** A continuation may use only its completed target, without releasing marks. */
export function resolveCompletedExplanationTargets(command: DrawCommand, diagram: VerifiedDiagram | null, canonicalIdsOnly = false) {
  const requested = parseFocusSpec(command.semanticRef?.entityId ?? command.text).targetIds;
  const targets = canonicalIdsOnly
    ? requested.flatMap(id => diagram?.anchors.filter(anchor => anchor.id === id) ?? [])
    : resolveVerifiedDiagramFocusTargets({ ...command, type: "FOCUS" }, diagram);
  const ids = new Set([...requested,
    ...targets.map(target => target.id)].map(id => id.toLowerCase()));
  if (diagram?.deferredAnnotations?.some(entry => entry.entityId.split(",").some(id => ids.has(id.trim().toLowerCase())))) return [];
  return targets.filter(target => target.width > 0 && target.height > 0);
}

/** Observe completed commands only; resets retire the previous figure target. */
export function advanceExplanationTarget(
  previous: CompletedExplanationTarget | null,
  command: DrawCommand,
  diagram: VerifiedDiagram | null,
): CompletedExplanationTarget | null {
  if (!diagram || ["FRAME", "CLEAR", "ERASE", "SUPERSEDE"].includes(command.type)) return null;
  if (command.type !== "FOCUS" && command.type !== "POINT") return previous?.diagram === diagram ? previous : null;
  const targets = resolveCompletedExplanationTargets(command, diagram);
  if (targets.length === 0) return null;
  const ids = targets.map(target => target.id).join(",");
  return { diagram, anchors: targets, command: { type: "POINT", text: ids, semanticRef: { entityId: ids }, params: [], charPosition: 0, narrationBefore: "" } };
}

/**
 * Point at already-written work, or continue a completed verified target,
 * while the voice explains. This is transient runtime motion, never an
 * authored/persisted command or a diagram reveal.
 * A leading gap owns the already-computed WRITE cue: recomputing its estimated
 * schedule after touring would change its initial-wait clamp and move the ink.
 */
export async function pointThroughExplanation(input: {
  clock: SegmentInkClock;
  execute: (command: DrawCommand, options: ExecuteCommandOptions) => Promise<void>;
  isCancelled: () => boolean;
  /** Omit for the explanation after the sentence's last command. */
  beforeWriteMs?: number;
  /** Tail-only continuation of a completed, currently visible verified target. */
  completedTarget?: CompletedExplanationTarget;
  getDiagram?: () => VerifiedDiagram | null;
}): Promise<void> {
  const { clock, completedTarget } = input;
  const isCancelled = () => input.isCancelled() || Boolean(completedTarget && (
    clock.isSpeechComplete?.() ||
    input.getDiagram?.() !== completedTarget.diagram ||
    completedTarget.anchors.some(anchor => !completedTarget.diagram.anchors.includes(anchor))
  ));
  if (!clock.narration.trim() || isCancelled() || clock.isSpeechComplete?.()) return;
  const rate = () => {
    const value = clock.getPlaybackRate();
    return Number.isFinite(value) && value > 0 ? value : 1;
  };
  const deadline = () => {
    if (input.beforeWriteMs !== undefined) {
      return input.beforeWriteMs - WRITE_APPROACH_WALL_MS * rate();
    }
    const alignedMs = (clock.getTimings()?.totalDuration ?? 0) * 1000;
    const endMs = alignedMs > 0 && Number.isFinite(alignedMs) ? alignedMs : clock.totalSpeechMs;
    // A completed target can follow its still-active provider beyond an early
    // estimate. This touches no authored schedule; completion, cancellation
    // and the existing stalled-clock bound still end the transient tour.
    return completedTarget && clock.isSpeechActive?.()
      ? Math.max(endMs, clock.getAudioPositionMs() + MIN_EXPLANATION_GAP_WALL_MS * rate())
      : endMs;
  };
  const remainingMs = deadline() - clock.getAudioPositionMs();
  if (remainingMs / rate() < MIN_EXPLANATION_GAP_WALL_MS) return;
  await input.execute(completedTarget?.command ?? { type: "POINT", text: "last", params: [], charPosition: 0, narrationBefore: "" }, {
    applyLayout: false,
    explanationPointing: !completedTarget,
    verifiedPointingOnly: Boolean(completedTarget),
    isCancelled,
    segmentNarration: clock.narration,
    speechDurationMs: remainingMs / rate(),
    speechShareMs: remainingMs / rate(),
    getPointDeadlineMs: deadline,
    isPaused: clock.isPaused,
    spokenClock: {
      narration: clock.narration,
      // The authored word schedule has completed. Only this transient tail
      // follows the owned voice end, including a longer replacement voice.
      getTimings: completedTarget ? () => null : clock.getTimings,
      get estimatedTotalMs() { return completedTarget ? deadline() : clock.totalSpeechMs; },
      getAudioPositionMs: clock.getAudioPositionMs,
      getPlaybackRate: clock.getPlaybackRate,
      isSpeechComplete: clock.isSpeechComplete,
      canAdvanceAfterSpeech: clock.canAdvanceAfterSpeech,
      msPerChar: clock.msPerChar,
    },
  });
}
