import { useEffect, useRef } from "react";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { TTSClient } from "@heytutor/tutor-core";
import { tutorDebug } from "@heytutor/tutor-core";

export interface UseAdaptiveDrawSpeedParams {
  whiteboardRef: React.RefObject<WhiteboardHandle | null>;
  ttsClientRef: React.RefObject<TTSClient | null>;
  turnActiveRef: React.RefObject<boolean>;
  speedRef: React.RefObject<number>;
  /** Live count of segments enqueued but not yet finished. */
  pendingSegmentCountRef: React.RefObject<number>;
  /** Narration density signal: chars of narration in the current segment / speech ms. */
  narrationDensityRef: React.RefObject<number>;
}

export interface UseAdaptiveDrawSpeedResult {
  /** The current adaptive factor (0.5 – 2.0). Multiplied with user speed for ink. */
  adaptiveFactorRef: React.RefObject<number>;
}

const MIN_FACTOR = 0.5;
const MAX_FACTOR = 2.0;
const POLL_INTERVAL_MS = 250;
const DAMPING_PREV = 0.7;
const DAMPING_TARGET = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Computes a dynamic drawing-speed factor from three signals and pushes it to
 * the whiteboard via `setAnimationSpeed`. The factor is damped so the pen
 * accelerates and decelerates smoothly rather than snapping.
 *
 * Signal 1 — audio lag (reactive): if the voice is ahead of the ink, speed up;
 * if the ink is ahead, slow down.
 * Signal 2 — queue depth (proactive): many pending segments → draw faster to
 * avoid falling behind on complex diagrams / long solutions.
 * Signal 3 — narration density: dense narration → faster ink; sparse → slower,
 * more deliberate strokes.
 */
export function useAdaptiveDrawSpeed({
  whiteboardRef,
  ttsClientRef,
  turnActiveRef,
  speedRef,
  pendingSegmentCountRef,
  narrationDensityRef,
}: UseAdaptiveDrawSpeedParams): UseAdaptiveDrawSpeedResult {
  const adaptiveFactorRef = useRef(1);
  const drawPositionMsRef = useRef(0);
  const lastPollAtRef = useRef<number | null>(null);
  const maxAudioPositionMsRef = useRef(0);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (!turnActiveRef.current) {
        // Reset state when the turn ends so the next turn starts fresh.
        if (lastPollAtRef.current !== null) {
          adaptiveFactorRef.current = 1;
          drawPositionMsRef.current = 0;
          maxAudioPositionMsRef.current = 0;
          lastPollAtRef.current = null;
          whiteboardRef.current?.setAnimationSpeed(speedRef.current);
        }
        return;
      }

      const now = performance.now();
      if (lastPollAtRef.current === null) {
        lastPollAtRef.current = now;
        return;
      }

      const dtMs = now - lastPollAtRef.current;
      lastPollAtRef.current = now;

      // Advance the estimated draw position by wall-clock time scaled by the
      // current factor — this is our proxy for "where the pen should be".
      drawPositionMsRef.current += dtMs * adaptiveFactorRef.current;

      // --- Signal 1: audio lag ---
      const tts = ttsClientRef.current;
      let audioPosMs = 0;
      if (tts) {
        const pos = tts.getPlaybackPositionMs();
        if (pos !== null && pos > maxAudioPositionMsRef.current) {
          maxAudioPositionMsRef.current = pos;
        }
        audioPosMs = maxAudioPositionMsRef.current;
      }
      const lagMs = audioPosMs - drawPositionMsRef.current;
      // Positive lag (audio ahead) → speed up; negative (ink ahead) → slow down.
      // Map ±1000ms lag to roughly 0.6–1.4 multiplier.
      const lagFactor = clamp(1 + lagMs / 1500, 0.6, 1.5);

      // --- Signal 2: queue depth ---
      const pending = pendingSegmentCountRef.current;
      // 0 pending → 1.0; 6+ pending → 1.3 (draw faster to catch up).
      const queueFactor = clamp(1 + pending * 0.05, 1.0, 1.3);

      // --- Signal 3: narration density ---
      // density = chars/ms; typical speech ~0.004 chars/ms (4 chars per ms? no,
      // ~15 chars/sec = 0.015 chars/ms). Normalize around 0.012.
      const density = narrationDensityRef.current;
      const densityFactor = clamp(0.85 + density * 12, 0.85, 1.25);

      const targetFactor = clamp(lagFactor * queueFactor * densityFactor, MIN_FACTOR, MAX_FACTOR);

      // Dampen so the pen accelerates/decelerates like a hand, not a metronome.
      const damped = clamp(
        adaptiveFactorRef.current * DAMPING_PREV + targetFactor * DAMPING_TARGET,
        adaptiveFactorRef.current * 0.85,
        adaptiveFactorRef.current * 1.15,
      );
      adaptiveFactorRef.current = clamp(damped, MIN_FACTOR, MAX_FACTOR);

      // The whiteboard animation speed is the user's base speed multiplied by
      // the adaptive factor. Audio stays at its natural pace (capped at 1.2x
      // in useCommandExecution); ink can exceed that via animation speed.
      const userSpeed = speedRef.current;
      const effectiveSpeed = clamp(userSpeed * adaptiveFactorRef.current, 0.4, 4.0);
      whiteboardRef.current?.setAnimationSpeed(effectiveSpeed);

      tutorDebug("speed", "adaptive tick", {
        audio_pos_ms: Math.round(audioPosMs),
        draw_pos_ms: Math.round(drawPositionMsRef.current),
        lag_ms: Math.round(lagMs),
        pending,
        density,
        lag_factor: Number(lagFactor.toFixed(2)),
        queue_factor: Number(queueFactor.toFixed(2)),
        density_factor: Number(densityFactor.toFixed(2)),
        target: Number(targetFactor.toFixed(2)),
        adaptive: Number(adaptiveFactorRef.current.toFixed(2)),
        effective: Number(effectiveSpeed.toFixed(2)),
      });
    };

    intervalId = setInterval(tick, POLL_INTERVAL_MS);

    const wb = whiteboardRef.current;
    const userSpeed = speedRef.current;

    return () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      // Reset to the user base speed when unmounting.
      wb?.setAnimationSpeed(userSpeed);
    };
  }, [whiteboardRef, ttsClientRef, turnActiveRef, speedRef, pendingSegmentCountRef, narrationDensityRef]);

  return { adaptiveFactorRef };
}
