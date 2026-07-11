"use client";

import { Group, Path, Rect, Line, Circle } from "react-konva";

export interface VirtualCursorProps {
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
  visible?: boolean;
  color?: string;
  glowRadius?: number;
  opacity?: number;
  shadowBlur?: number;
}

/**
 * Compact black/red whiteboard marker. Tip at (0,0), body in -Y.
 * Sized small so handwriting motion stays smooth on the cream board.
 */

const NIB_PATH = "M 0 0 L -2.8 -5 L 2.8 -5 Z";

const FERRULE_Y = -7;
const BAND_Y = -11;
const BARREL_Y = -28;
const CAP_Y = -33;

const BODY_HALF = 3.6;
const BARREL_HEIGHT = FERRULE_Y - BARREL_Y; // 21
const BAND_HEIGHT = FERRULE_Y - BAND_Y; // 4
const CAP_HEIGHT = BARREL_Y - CAP_Y; // 5

const CASING_BLACK = "#1A1A1A";
const CASING_BLACK_DARK = "#0A0A0A";
const CASING_SHADE = "#000000";
const CASING_HIGHLIGHT = "#555555";
const RED_BAND = "#C62828";
const RED_BAND_DARK = "#8E0000";
const RED_BAND_HIGHLIGHT = "#EF5350";
const FERRULE = "#B8B8B8";
const FERRULE_DARK = "#787878";
const CAP = "#111111";

function darken(hex: string, amount: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const r = Math.max(0, Math.round(parseInt(m.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(m.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(m.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function VirtualCursor({
  x,
  y,
  rotation = -35,
  scale = 1,
  visible = true,
  color = "#1B2A4A",
  glowRadius = 5,
  opacity = 1,
  shadowBlur,
}: VirtualCursorProps) {
  const effectiveShadowBlur = Math.min(shadowBlur ?? glowRadius, 8);
  const nibEdge = darken(color, 0.35);

  return (
    <Group
      x={x}
      y={y}
      visible={visible}
      rotation={rotation}
      scaleX={scale}
      scaleY={scale}
      opacity={opacity}
      listening={false}
    >
      <Circle x={0} y={0} radius={4} fill={color} opacity={0.12} listening={false} />

      <Path
        data={NIB_PATH}
        fill={color}
        stroke={nibEdge}
        strokeWidth={0.4}
        listening={false}
      />

      <Rect
        x={-BODY_HALF - 0.3}
        y={FERRULE_Y}
        width={BODY_HALF * 2 + 0.6}
        height={2.2}
        fill={FERRULE}
        stroke={FERRULE_DARK}
        strokeWidth={0.4}
        cornerRadius={0.5}
        listening={false}
      />

      <Rect
        x={-BODY_HALF}
        y={BAND_Y}
        width={BODY_HALF * 2}
        height={BAND_HEIGHT}
        fill={RED_BAND}
        stroke={RED_BAND_DARK}
        strokeWidth={0.45}
        cornerRadius={0.6}
        listening={false}
      />
      <Rect
        x={-BODY_HALF + 0.8}
        y={BAND_Y + 0.6}
        width={1.4}
        height={BAND_HEIGHT - 1.2}
        fill={RED_BAND_HIGHLIGHT}
        opacity={0.5}
        cornerRadius={0.4}
        listening={false}
      />

      <Rect
        x={-BODY_HALF}
        y={BARREL_Y}
        width={BODY_HALF * 2}
        height={BARREL_HEIGHT - BAND_HEIGHT}
        fill={CASING_BLACK}
        stroke={CASING_BLACK_DARK}
        strokeWidth={0.7}
        cornerRadius={1.2}
        shadowColor="rgba(0,0,0,0.35)"
        shadowBlur={effectiveShadowBlur}
        shadowOpacity={0.55}
        shadowOffsetX={0.8}
        shadowOffsetY={0.8}
        listening={false}
      />

      <Rect
        x={1}
        y={BARREL_Y + 1}
        width={BODY_HALF - 1.6}
        height={BARREL_HEIGHT - BAND_HEIGHT - 2}
        fill={CASING_SHADE}
        opacity={0.3}
        cornerRadius={0.8}
        listening={false}
      />
      <Rect
        x={-BODY_HALF + 0.9}
        y={BARREL_Y + 1}
        width={1.5}
        height={BARREL_HEIGHT - BAND_HEIGHT - 2}
        fill={CASING_HIGHLIGHT}
        opacity={0.5}
        cornerRadius={0.6}
        listening={false}
      />

      <Rect
        x={-BODY_HALF + 1.2}
        y={BARREL_Y + 6}
        width={BODY_HALF * 2 - 2.4}
        height={1.4}
        fill={RED_BAND}
        opacity={0.8}
        cornerRadius={0.3}
        listening={false}
      />

      <Rect
        x={-BODY_HALF - 0.3}
        y={CAP_Y}
        width={BODY_HALF * 2 + 0.6}
        height={CAP_HEIGHT}
        fill={CAP}
        stroke={CASING_BLACK_DARK}
        strokeWidth={0.7}
        cornerRadius={2}
        listening={false}
      />

      <Rect
        x={BODY_HALF - 0.4}
        y={CAP_Y + 1}
        width={1.4}
        height={11}
        fill={CASING_HIGHLIGHT}
        stroke={CASING_BLACK_DARK}
        strokeWidth={0.35}
        cornerRadius={0.6}
        listening={false}
      />
    </Group>
  );
}
