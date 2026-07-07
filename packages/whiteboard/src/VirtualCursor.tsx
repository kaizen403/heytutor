"use client";

import { Group, Path, Rect, Line } from "react-konva";

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
 * Marker pen silhouette: writing tip at (0,0).
 *
 * The barrel/cap use a fixed high-contrast casing color so the pen
 * is always visible against the cream board (#F8F6F0), regardless of
 * which ink color is selected. Only the nib takes the ink color,
 * showing which color will be written.
 *
 * Layout (local coords, body extends upward in -Y):
 *   nib       0 → -7   cone, ink color, pointed tip
 *   ferrule  -7 → -10  metallic band
 *   barrel  -10 → -34  charcoal casing with side highlight
 *   cap     -34 → -40  darker rounded end
 */

const NIB_PATH = "M 0 0 L -3 -7 L 3 -7 Z";
const FERRULE_Y = -10;
const BARREL_Y = -34;
const CAP_Y = -40;
const BODY_HALF = 5;
const HIGHLIGHT_HALF = 1.4;

// Fixed casing colors — solid navy blue, always visible against the cream board.
const CASING_COLOR = "#1B2A4A";
const CASING_DARK = "#08101F";
const CASING_CAP = "#0A1224";
const CASING_HIGHLIGHT = "#5274B0";
const CASING_SHADE = "#0F1A33";
const FERRULE_COLOR = "#C0C0C0";
const FERRULE_DARK = "#888888";

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
  color = "#222222",
  glowRadius = 8,
  opacity = 1,
  shadowBlur,
}: VirtualCursorProps) {
  const effectiveShadowBlur = shadowBlur ?? glowRadius + (scale - 1) * 20;
  const nibEdge = darken(color, 0.3);

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
      {/* Soft contact glow at the nib tip — ink colored */}
      <Path
        data="M 0 0 m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0"
        fill={color}
        opacity={0.18}
        listening={false}
      />

      {/* Nib — pointed cone in the selected ink color */}
      <Path
        data={NIB_PATH}
        fill={color}
        stroke={nibEdge}
        strokeWidth={0.5}
        listening={false}
      />

      {/* Ferrule — metallic band between nib and barrel */}
      <Rect
        x={-BODY_HALF - 0.5}
        y={FERRULE_Y}
        width={BODY_HALF * 2 + 1}
        height={3}
        fill={FERRULE_COLOR}
        stroke={FERRULE_DARK}
        strokeWidth={0.5}
        cornerRadius={0.5}
        listening={false}
      />
      <Line
        points={[-BODY_HALF - 0.5, FERRULE_Y + 1.5, BODY_HALF + 0.5, FERRULE_Y + 1.5]}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={0.5}
        listening={false}
      />

      {/* Barrel — solid navy casing, always visible on cream board */}
      <Rect
        x={-BODY_HALF}
        y={BARREL_Y}
        width={BODY_HALF * 2}
        height={BARREL_Y - FERRULE_Y + 24}
        fill={CASING_COLOR}
        stroke={CASING_DARK}
        strokeWidth={0.9}
        cornerRadius={1.5}
        shadowColor="rgba(0,0,0,0.32)"
        shadowBlur={effectiveShadowBlur}
        shadowOpacity={0.6}
        shadowOffsetX={1}
        shadowOffsetY={1}
        listening={false}
      />

      {/* Right-side shade for cylindrical depth */}
      <Rect
        x={HIGHLIGHT_HALF + 0.5}
        y={BARREL_Y + 1}
        width={BODY_HALF - HIGHLIGHT_HALF - 1}
        height={BARREL_Y - FERRULE_Y + 22}
        fill={CASING_SHADE}
        opacity={0.55}
        cornerRadius={1}
        listening={false}
      />

      {/* Vertical highlight stripe for cylindrical depth */}
      <Rect
        x={-HIGHLIGHT_HALF - 1.5}
        y={BARREL_Y + 1}
        width={HIGHLIGHT_HALF * 2}
        height={BARREL_Y - FERRULE_Y + 22}
        fill={CASING_HIGHLIGHT}
        opacity={0.7}
        cornerRadius={1}
        listening={false}
      />

      {/* Cap — darker rounded end */}
      <Rect
        x={-BODY_HALF - 0.5}
        y={CAP_Y}
        width={BODY_HALF * 2 + 1}
        height={6}
        fill={CASING_CAP}
        stroke={CASING_DARK}
        strokeWidth={0.9}
        cornerRadius={3}
        listening={false}
      />
    </Group>
  );
}
