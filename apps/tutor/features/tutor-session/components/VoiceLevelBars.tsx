"use client";

import { useEffect, useRef, type RefObject } from "react";

interface VoiceLevelBarsProps {
  /** The open mic's analyser, from `useVoiceInput`. */
  analyserRef: RefObject<AnalyserNode | null>;
  /** How many bars to draw. Odd counts read better: there is a centre. */
  bars?: number;
  /** Bar width in px. */
  barWidth?: number;
  /** Tallest a bar goes, in px. */
  height?: number;
  className?: string;
}

/** Idle height as a fraction of `height`, so silence still shows a live control. */
const FLOOR = 0.18;

/**
 * What the student's voice looks like while the mic is open.
 *
 * Bars are driven straight from the analyser in their own rAF loop and written
 * to the DOM as `scaleY`, never through React state: a level meter wants sixty
 * updates a second, and re-rendering the ask bar that often to move five
 * rectangles would be absurd. `scaleY` on a fixed-height element also keeps the
 * whole thing on the compositor, so a busy main thread cannot stutter it.
 *
 * The low end of the spectrum is where a voice lives, so the bands are taken
 * from the bottom third of the FFT and mirrored about the centre bar: the
 * result rises in the middle and tapers out, which reads as a voice rather
 * than as an equaliser.
 */
export function VoiceLevelBars({
  analyserRef,
  bars = 5,
  barWidth = 2,
  height = 16,
  className,
}: VoiceLevelBarsProps) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    // Explicitly backed by an ArrayBuffer, not a SharedArrayBuffer: since TS
    // 5.7 the typed-array generic is invariant, and getByteFrequencyData only
    // accepts the former.
    let spectrum: Uint8Array<ArrayBuffer> | null = null;

    const paint = () => {
      frame = requestAnimationFrame(paint);
      const analyser = analyserRef.current;
      const nodes = barsRef.current;

      if (!analyser) {
        for (const node of nodes) {
          if (node) node.style.transform = `scaleY(${FLOOR})`;
        }
        return;
      }
      if (!spectrum || spectrum.length !== analyser.frequencyBinCount) {
        spectrum = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }
      analyser.getByteFrequencyData(spectrum);

      // Speech energy sits low; the top of the FFT is mostly room hiss.
      const usable = Math.max(1, Math.floor(spectrum.length / 3));
      const half = Math.floor(bars / 2);
      const perBand = Math.max(1, Math.floor(usable / (half + 1)));

      for (let index = 0; index <= half; index++) {
        let sum = 0;
        const from = index * perBand;
        const to = Math.min(from + perBand, usable);
        for (let bin = from; bin < to; bin++) sum += spectrum[bin]!;
        const mean = sum / Math.max(1, to - from) / 255;
        // Square-root the level: loudness is perceptual, and a linear meter
        // spends most of its range looking flat.
        const scale = Math.min(1, FLOOR + Math.sqrt(mean) * 1.15);

        // Mirror outward from the centre bar.
        const centre = half;
        const left = nodes[centre - index];
        const right = nodes[centre + index];
        if (left) left.style.transform = `scaleY(${scale})`;
        if (right && right !== left) right.style.transform = `scaleY(${scale})`;
      }
    };

    if (reduced) {
      for (const node of barsRef.current) {
        if (node) node.style.transform = `scaleY(${FLOOR * 2})`;
      }
      return;
    }

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [analyserRef, bars]);

  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: Math.max(1, Math.round(barWidth * 0.75)),
        height,
      }}
    >
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          ref={(node) => {
            barsRef.current[index] = node;
          }}
          style={{
            width: barWidth,
            height,
            borderRadius: barWidth,
            background: "currentColor",
            transform: `scaleY(${FLOOR})`,
            // Scaling about the middle keeps the bar centred as it grows.
            transformOrigin: "50% 50%",
            willChange: "transform",
          }}
        />
      ))}
    </span>
  );
}
