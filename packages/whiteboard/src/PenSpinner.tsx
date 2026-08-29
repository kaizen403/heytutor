"use client";

import { useId, type CSSProperties } from "react";
import {
  instrumentMetrics,
  instrumentPalette,
  instrumentShapes,
  instrumentSilhouette,
  type InstrumentKind,
  type InstrumentPalette,
  type InstrumentShape,
} from "./instruments";
import {
  SPIN_BEATS,
  SPIN_CADENCE_DEG,
  SPIN_PERIOD_MS,
  spinGhosts,
} from "./penChoreography";

export interface PenSpinnerProps {
  /** Box the twirl fits inside, in px. */
  size?: number;
  /** Marker colour the instrument writes in — the lead and band follow it. */
  ink?: string;
  /** Rough work is pencil work, so the default is the pencil the board thinks with. */
  instrument?: Exclude<InstrumentKind, "duster">;
  /** Milliseconds per full turn. */
  periodMs?: number;
  /** Accessible name. Omit when a label beside the spinner already says what is pending. */
  label?: string;
  /** Faint trail behind the nib, drawn in `currentColor`. */
  trail?: boolean;
  className?: string;
  style?: CSSProperties;
}

const STYLE_HREF = "wb-pen-spinner";
/** How far behind the nib the trail reaches, in degrees of the orbit. */
const TRAIL_SWEEP_DEG = 75;
const DEG = Math.PI / 180;
/**
 * Keyframe stops used to approximate the cadence curve. The browser tweens
 * linearly between them, so this is a sampling rate: 36 puts each stop 10° of
 * turn apart, far below what the eye can resolve as a corner.
 */
const CADENCE_STOPS = 36;

/**
 * The same flick-and-coast the board twirls with, baked into CSS keyframes.
 *
 * A CSS animation cannot call `spinningPose` every frame, so the steady-state
 * curve is sampled once here — same beats, same swing, same constants. The
 * animation stays `linear`; all the rhythm lives in where the stops fall, so
 * the browser can run the whole thing on the compositor.
 */
function cadenceKeyframes(): string {
  const stops: string[] = [];
  for (let index = 0; index <= CADENCE_STOPS; index++) {
    const u = index / CADENCE_STOPS;
    const angle = 360 * u + SPIN_CADENCE_DEG * Math.sin(SPIN_BEATS * 2 * Math.PI * u);
    stops.push(`${(u * 100).toFixed(3)}%{transform:rotate(${angle.toFixed(3)}deg)}`);
  }
  return `@keyframes wb-pen-spin{${stops.join("")}}`;
}

/**
 * The tutor's pencil, twirling while a response is pending.
 *
 * Same art table as the pen on the board (`instruments.ts`), rendered to SVG
 * instead of Konva, so the thing spinning in the chrome is the thing the tutor
 * writes with. The whole `<svg>` is rotated by a linear CSS animation on its
 * own compositor layer: a busy main thread — the board mid-stroke, a reply
 * streaming in — cannot make it stutter. The nib orbits the barrel mid-point,
 * exactly the twirl the board does between the fingers.
 */
function shapeElement(shape: InstrumentShape, index: number, palette: InstrumentPalette) {
  const common = {
    fill: shape.fill ? palette[shape.fill] : "none",
    stroke: shape.stroke ? palette[shape.stroke] : undefined,
    strokeWidth: shape.stroke ? (shape.strokeWidth ?? 0.4) : undefined,
    strokeLinejoin: "round" as const,
    opacity: shape.opacity,
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
    return <polyline key={index} points={points.join(" ")} strokeLinecap="round" {...common} />;
  }

  return <polygon key={index} points={points.join(" ")} {...common} />;
}

export function PenSpinner({
  size = 40,
  ink = "#1B2A4A",
  instrument = "pencil",
  periodMs = SPIN_PERIOD_MS,
  label,
  trail = true,
  className,
  style,
}: PenSpinnerProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const trailId = `wb-pen-trail-${uid}`;
  const blurId = `wb-pen-blur-${uid}`;
  const palette = instrumentPalette(instrument, ink);
  const { height, pivotY } = instrumentMetrics(instrument);
  const silhouette = instrumentSilhouette(instrument).join(" ");
  // CSS cannot re-cut the smear each frame the way the board does, so the
  // ghosts are placed for the average rate and blurred; the flick reads as a
  // slight thickening rather than a trail that grows and shrinks.
  const ghosts = spinGhosts(1);

  // Local space has the nib at (0,0) and the barrel up -Y. Shift it so the
  // twirl pivot sits on the origin; the viewBox is then square about it and
  // CSS `transform-origin: 50% 50%` rotates about exactly that point.
  const orbit = -pivotY;
  const reach = Math.max(orbit, height - orbit) + 3;
  const trailStart = (90 - TRAIL_SWEEP_DEG) * DEG;
  const trailFromX = (orbit * Math.cos(trailStart)).toFixed(2);
  const trailFromY = (orbit * Math.sin(trailStart)).toFixed(2);
  const trailPath = `M ${trailFromX} ${trailFromY} A ${orbit} ${orbit} 0 0 1 0 ${orbit}`;

  return (
    <>
      <style href={STYLE_HREF} precedence="default">
        {STYLES}
      </style>
      <span
        className={className ? `wb-pen-spinner ${className}` : "wb-pen-spinner"}
        style={{ width: size, height: size, ...style }}
        role={label ? "status" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        <span className="wb-pen-spinner__float">
          <svg
            className="wb-pen-spinner__rotor"
            viewBox={`${-reach} ${-reach} ${reach * 2} ${reach * 2}`}
            width={size}
            height={size}
            style={{ animationDuration: `${periodMs}ms` }}
            focusable="false"
            aria-hidden="true"
          >
            {trail ? (
              <>
                <defs>
                  <linearGradient
                    id={trailId}
                    gradientUnits="userSpaceOnUse"
                    x1={trailFromX}
                    y1={trailFromY}
                    x2="0"
                    y2={orbit}
                  >
                    <stop offset="0" stopColor="currentColor" stopOpacity="0" />
                    <stop offset="1" stopColor="currentColor" stopOpacity="0.5" />
                  </linearGradient>
                </defs>
                <path
                  d={trailPath}
                  fill="none"
                  stroke={`url(#${trailId})`}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </>
            ) : null}
            <defs>
              <filter id={blurId} x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="0.9" />
              </filter>
            </defs>

            {/* Motion blur: barrel silhouettes trailing the arc just swept. */}
            <g filter={`url(#${blurId})`}>
              {ghosts.map((ghost) => (
                <polygon
                  key={ghost.offset}
                  points={silhouette}
                  fill={palette.barrel}
                  opacity={ghost.opacity}
                  transform={`rotate(${-ghost.offset}) translate(0 ${orbit})`}
                />
              ))}
            </g>

            <g transform={`translate(0 ${orbit})`}>
              {instrumentShapes(instrument).map((shape, index) =>
                shapeElement(shape, index, palette),
              )}
            </g>
          </svg>
        </span>
      </span>
    </>
  );
}

const STYLES = `${cadenceKeyframes()}

.wb-pen-spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 0;
  vertical-align: middle;
  animation: wb-pen-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
.wb-pen-spinner__float {
  display: inline-flex;
  animation: wb-pen-float 2800ms ease-in-out infinite;
  will-change: transform;
}
.wb-pen-spinner__rotor {
  display: block;
  overflow: visible;
  transform-origin: 50% 50%;
  animation: wb-pen-spin 1200ms linear infinite;
  will-change: transform;
}
@keyframes wb-pen-float {
  0%, 100% { transform: translateY(-3%); }
  50% { transform: translateY(3%); }
}
@keyframes wb-pen-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes wb-pen-rest {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .wb-pen-spinner,
  .wb-pen-spinner__float {
    animation: none;
  }
  .wb-pen-spinner__rotor {
    animation: wb-pen-rest 2400ms ease-in-out infinite;
  }
}
`;
