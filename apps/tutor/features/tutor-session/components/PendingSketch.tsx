"use client";

import type { CSSProperties } from "react";

/**
 * A margin sketch that draws itself while the lecture is prepared.
 *
 * Decorative only: it is not the lesson's diagram and never touches the
 * board. One sketch per pending beat, drawn stroke by stroke in the same
 * weight as the landing doodles, held, then lifted before the next beat.
 */

interface Stroke {
  d: string;
  /** Relative drawing time; 1 is a plain edge. */
  weight?: number;
  width?: number;
}

interface Note {
  text: string;
  x: number;
  y: number;
  size?: number;
  centered?: boolean;
}

interface Sketch {
  strokes: Stroke[];
  notes?: Note[];
  dots?: { x: number; y: number }[];
}

const SKETCHES: Sketch[] = [
  {
    strokes: [
      { d: "M48 60 L112 60" },
      { d: "M112 60 L112 14", weight: 0.8 },
      { d: "M112 14 Q79 36.5 48 60", weight: 1.1 },
      { d: "M104 60 V52 H112", weight: 0.4, width: 1.2 },
      { d: "M62 60 A14 14 0 0 0 59.4 51.8", weight: 0.4, width: 1.1 },
    ],
    notes: [{ text: "θ", x: 65, y: 57.5, size: 12 }],
  },
  {
    strokes: [
      { d: "M20 40 H142" },
      { d: "M137 36.5 L142 40 L137 43.5", weight: 0.3, width: 1.3 },
      { d: "M28 64 V10", weight: 0.7 },
      { d: "M24.5 15 L28 10 L31.5 15", weight: 0.3, width: 1.3 },
      {
        d: "M28 40 C37 20 46 20 55 40 S73 60 82 40 S100 20 109 40 S127 60 136 40",
        weight: 2.2,
      },
    ],
    notes: [{ text: "sin x", x: 36, y: 15 }],
  },
  {
    strokes: [
      { d: "M22 62 H138" },
      { d: "M138 62 V20", weight: 0.6 },
      { d: "M138 20 L22 62", weight: 1.1 },
      { d: "M72 43.9 L88 38.1 L82.2 22.1 L66.2 27.9 Z", weight: 0.9 },
      { d: "M77.1 33 V56", weight: 0.6, width: 1.3 },
      { d: "M73.8 51.8 L77.1 56 L80.4 51.8", weight: 0.3, width: 1.3 },
      { d: "M38 62 A16 16 0 0 0 37 56.6", weight: 0.3, width: 1.1 },
    ],
    notes: [{ text: "mg", x: 81, y: 58 }],
  },
  {
    strokes: [
      { d: "M30 26 H130 V46 H30 Z", weight: 1.6 },
      { d: "M50 26 V46", weight: 0.2 },
      { d: "M70 26 V46", weight: 0.2 },
      { d: "M90 26 V46", weight: 0.2 },
      { d: "M110 26 V46", weight: 0.2 },
      { d: "M60 21 Q70 9 80 21", weight: 0.5, width: 1.2 },
      { d: "M75.6 19.6 L80 21 L80.3 16.4", weight: 0.25, width: 1.2 },
      { d: "M60 64 V51", weight: 0.4, width: 1.3 },
      { d: "M56.5 54.5 L60 50.5 L63.5 54.5", weight: 0.3, width: 1.3 },
    ],
    notes: [
      { text: "3", x: 40, y: 41, centered: true },
      { text: "8", x: 60, y: 41, centered: true },
      { text: "2", x: 80, y: 41, centered: true },
      { text: "6", x: 100, y: 41, centered: true },
      { text: "5", x: 120, y: 41, centered: true },
      { text: "i", x: 64, y: 63 },
    ],
  },
  {
    strokes: [
      { d: "M104 36 A24 24 0 1 1 56 36 A24 24 0 1 1 104 36", weight: 2 },
      { d: "M52 60 H108", weight: 0.6 },
      { d: "M80 36 L97 19", weight: 0.5, width: 1.3 },
    ],
    notes: [{ text: "r", x: 83, y: 23 }],
    dots: [{ x: 80, y: 36 }],
  },
];

const LEAD_MS = 140;
const STROKE_MS = 380;
/** Each stroke starts before the last finishes, the way a hand keeps moving. */
const OVERLAP = 0.72;

function timeline(strokes: Stroke[]) {
  let at = LEAD_MS;
  let end = LEAD_MS;
  const steps = strokes.map((stroke) => {
    const duration = Math.round(STROKE_MS * (stroke.weight ?? 1));
    const step = { at, duration };
    end = at + duration;
    at += Math.round(duration * OVERLAP);
    return step;
  });
  return { steps, end };
}

interface PendingSketchProps {
  index: number;
  ink: string;
  /** How long this sketch stays up, so it lifts just before the next beat. */
  beatMs: number;
}

export function PendingSketch({ index, ink, beatMs }: PendingSketchProps) {
  const sketch = SKETCHES[index % SKETCHES.length]!;
  const { steps, end } = timeline(sketch.strokes);

  return (
    <svg
      className="wb-sketch"
      viewBox="0 0 160 72"
      fill="none"
      aria-hidden
      focusable="false"
      style={{ color: ink, "--beat": `${beatMs}ms` } as CSSProperties}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {sketch.strokes.map((stroke, at) => (
          <path
            key={stroke.d}
            className="wb-sketch__stroke"
            d={stroke.d}
            pathLength={1}
            strokeWidth={stroke.width ?? 1.6}
            style={
              {
                "--at": `${steps[at]!.at}ms`,
                "--dur": `${steps[at]!.duration}ms`,
              } as CSSProperties
            }
          />
        ))}
      </g>
      {sketch.dots?.map((dot) => (
        <circle
          key={`${dot.x},${dot.y}`}
          className="wb-sketch__note"
          cx={dot.x}
          cy={dot.y}
          r={1.8}
          fill="currentColor"
          style={{ "--at": `${end - 120}ms` } as CSSProperties}
        />
      ))}
      {sketch.notes?.map((note, at) => (
        <text
          key={`${note.text}${note.x}`}
          className="wb-sketch__note"
          x={note.x}
          y={note.y}
          fontSize={note.size ?? 14}
          textAnchor={note.centered ? "middle" : "start"}
          fill="currentColor"
          style={{ "--at": `${end - 120 + at * 60}ms` } as CSSProperties}
        >
          {note.text}
        </text>
      ))}
    </svg>
  );
}
