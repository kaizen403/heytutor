"use client";

import { Group, Path, Line } from "react-konva";

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

// Chalk silhouette: tip at (0,0) — the writing point.
// Tapers from a point to a 7px-wide body over 9px, then a
// 16px-tall body with a slightly rounded bottom.
const CHALK_PATH =
  "M 0 0 L -3.5 9 L -3.5 25 Q -3.5 27 -1.75 27 L 1.75 27 Q 3.5 27 3.5 25 L 3.5 9 Z";

export function VirtualCursor({
  x,
  y,
  rotation = -35,
  scale = 1,
  visible = true,
  color = "#C8893A",
  glowRadius = 8,
  opacity = 1,
  shadowBlur,
}: VirtualCursorProps) {
  const effectiveShadowBlur = shadowBlur ?? glowRadius + (scale - 1) * 20;

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
      <Path
        data={CHALK_PATH}
        fill={color}
        stroke={color}
        strokeWidth={1}
        shadowColor={color}
        shadowBlur={effectiveShadowBlur}
        shadowOpacity={0.55}
        shadowOffsetX={0}
        shadowOffsetY={0}
        listening={false}
      />
      {/* Subtle junction line where the tapered tip meets the body */}
      <Line
        points={[-3.2, 9, 3.2, 9]}
        stroke="rgba(0,0,0,0.18)"
        strokeWidth={0.5}
        listening={false}
      />
    </Group>
  );
}
