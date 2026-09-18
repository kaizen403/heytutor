/** @jsxRuntime automatic */
/** @jsxImportSource react */
"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import {
  instrumentMetrics,
  instrumentPalette,
  instrumentShapes,
  type InstrumentKind,
  type InstrumentPalette,
  type InstrumentShape,
} from "./instruments";
import { RESTING_TILT, bell } from "./penChoreography";
import { idleBreath } from "./penIdle";
import { STUNT_MS, stuntFrame, type StuntKind } from "./penStunts";

/**
 * A stunt, played on a loop, so the student can see what they are picking.
 *
 * Deliberately not a Konva board. The settings screens are ordinary React, the
 * thing being shown is one instrument on a patch of paper, and mounting a
 * whole canvas stage inside a settings sheet to draw it would be absurd. This
 * is SVG driven by the same `stuntFrame` the board calls, on the same
 * instrument art `VirtualCursor` draws, so what is showcased is what happens.
 *
 * Between repeats the hand does not freeze: `idleBreath` runs through the rest
 * exactly as it does on the board, which is also what keeps the loop from
 * reading as a looping GIF.
 *
 * The JSX pragmas at the top are not decoration. This file is consumed three
 * ways — bundled by tsup, compiled by Next, and loaded straight from source by
 * the tutor's verify scripts through a tsconfig path — and the last of those
 * reads the *app's* JSX setting, which is `preserve`. Without the pragma it
 * compiles to `React.createElement` against a global that does not exist, and
 * server-rendering the showcase throws.
 */

export interface MarkerStuntPreviewProps {
  /** Which trick to play, or null for a hand holding the marker still. */
  kind: StuntKind | null;
  /** Rendered edge length in px. The art scales with it. */
  size?: number;
  /** Ink colour, so the showcase matches the marker the student chose. */
  ink?: string;
  paper?: string;
  instrument?: InstrumentKind;
  /** Hold the loop: honoured for `prefers-reduced-motion` and off-screen use. */
  paused?: boolean;
  /** Rest between repeats. Long enough to read as a repeat, not a stutter. */
  restMs?: number;
  className?: string;
  /** Describes the trick for assistive tech; the visual is decorative. */
  label?: string;
}

const VIEW = 120;
/** Where the nib sits at rest inside the view box. */
const NIB_X = 60;
const NIB_Y = 78;
const DEFAULT_REST_MS = 900;
/** The stunts are authored around a 1200x700 board; this reads them at tile size. */
const ART_SCALE = 1.35;

/**
 * The rest pose, as markup.
 *
 * The animation is imperative, which means the very first paint has whatever
 * the JSX says on it: with no transform the instrument is drawn at the SVG
 * origin, off the corner of the tile, and the showcase renders as an empty
 * patch of paper until the first frame lands. That is also exactly what the
 * server sends. So the resting pose is declared here, and the loop takes over
 * from it — `idleBreath(0)` is all zeroes, so this *is* frame zero.
 */
const REST_TRANSFORM = `translate(${NIB_X} ${NIB_Y}) rotate(${RESTING_TILT.idle}) scale(${ART_SCALE})`;
function restSpinTransform(pivotY: number): string {
  return `translate(0 ${pivotY}) rotate(0) translate(0 ${-pivotY})`;
}

function shapePath(shape: InstrumentShape, palette: InstrumentPalette, index: number) {
  const fill = shape.fill ? palette[shape.fill] : "none";
  const stroke = shape.stroke ? palette[shape.stroke] : undefined;
  const common = {
    fill,
    stroke,
    strokeWidth: stroke ? (shape.strokeWidth ?? 0.4) : undefined,
    opacity: shape.opacity,
    strokeLinejoin: "round" as const,
  };

  if (shape.kind === "rect") {
    return (
      <rect
        key={index}
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        rx={shape.radius ?? 0}
        {...common}
      />
    );
  }
  if (shape.kind === "circle") {
    return <circle key={index} cx={shape.x} cy={shape.y} r={shape.radius} {...common} />;
  }

  const points: string[] = [];
  for (let at = 0; at < shape.points.length; at += 2) {
    points.push(`${shape.points[at]},${shape.points[at + 1]}`);
  }
  if (shape.kind === "stroke") {
    return <polyline key={index} points={points.join(" ")} {...common} fill="none" />;
  }
  return <polygon key={index} points={points.join(" ")} {...common} />;
}

/*
 * Reduced motion, read the way the rest of the app reads a media query:
 * `useSyncExternalStore` with a server snapshot of `false`, so the markup the
 * server sends and the markup hydration produces are the same. Reading it into
 * state from inside an effect gives a synchronous setState on mount and a
 * hydration mismatch on a machine that has the preference set.
 */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function reducedMotionNow(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION).matches;
}

function reducedMotionOnServer(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, reducedMotionOnServer);
}

export function MarkerStuntPreview({
  kind,
  size = 132,
  ink = "#1B2A4A",
  paper = "#F6E4C4",
  instrument = "pen",
  paused = false,
  restMs = DEFAULT_REST_MS,
  className,
  label,
}: MarkerStuntPreviewProps) {
  const groupRef = useRef<SVGGElement | null>(null);
  const spinRef = useRef<SVGGElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const holding = paused || reducedMotion;

  const palette = useMemo(() => instrumentPalette(instrument, ink), [instrument, ink]);
  const shapes = useMemo(() => instrumentShapes(instrument), [instrument]);
  const { pivotY } = useMemo(() => instrumentMetrics(instrument), [instrument]);

  useEffect(() => {
    const group = groupRef.current;
    const spin = spinRef.current;
    if (!group || !spin) return undefined;

    const runMs = kind ? STUNT_MS[kind] : 0;
    const cycleMs = runMs + Math.max(restMs, 0);

    const place = (elapsedMs: number): void => {
      // The resting hand, running underneath, exactly as the board does it.
      const breath = idleBreath(elapsedMs);
      let dx = breath.dx * 0.5;
      let dy = breath.dy * 0.5;
      let tilt = breath.tiltOffset * 0.5;
      let turn = 0;
      let lift = breath.hover;
      let grow = 1;

      if (kind && runMs > 0) {
        const withinMs = elapsedMs % cycleMs;
        if (withinMs < runMs) {
          const frame = stuntFrame(kind, withinMs / runMs, 1, breath.hover, 0.5, 0.5);
          dx += frame.dx;
          dy += frame.dy;
          tilt += frame.tiltOffset;
          turn = frame.spin;
          lift += frame.lift;
          grow = 1 + frame.scaleUp;
        } else {
          // A beat of stillness before the repeat, eased in so the trick does
          // not end on a hard cut into a held pose.
          const settle = bell(((withinMs - runMs) / Math.max(restMs, 1)) * 0.5);
          dy -= settle * 0.6;
        }
      }

      group.setAttribute(
        "transform",
        `translate(${NIB_X + dx * ART_SCALE} ${NIB_Y + dy * ART_SCALE}) rotate(${
          RESTING_TILT.idle + tilt
        }) scale(${ART_SCALE * grow}) translate(0 ${-lift})`,
      );
      spin.setAttribute(
        "transform",
        `translate(0 ${pivotY}) rotate(${turn}) translate(0 ${-pivotY})`,
      );
    };

    if (holding) {
      place(0);
      return undefined;
    }

    let frameId = 0;
    let startedAt: number | null = null;
    const step = (now: number): void => {
      if (startedAt === null) startedAt = now;
      place(now - startedAt);
      frameId = window.requestAnimationFrame(step);
    };
    frameId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frameId);
  }, [holding, kind, pivotY, restMs]);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="img"
      aria-label={label ?? (kind ? `${kind} preview` : "marker at rest")}
      style={{ background: paper, borderRadius: 10, display: "block" }}
    >
      {/* The board the trick is performed over, so the lift reads as a lift. */}
      <line
        x1={14}
        y1={NIB_Y + 2}
        x2={VIEW - 14}
        y2={NIB_Y + 2}
        stroke="#C9B48C"
        strokeWidth={1}
      />
      <g ref={groupRef} transform={REST_TRANSFORM}>
        <g ref={spinRef} transform={restSpinTransform(pivotY)}>
          {shapes.map((shape, index) => shapePath(shape, palette, index))}
        </g>
      </g>
    </svg>
  );
}
