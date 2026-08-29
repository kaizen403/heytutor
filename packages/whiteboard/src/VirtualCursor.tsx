"use client";

import Konva from "konva";
import { forwardRef } from "react";
import { Circle, Ellipse, Group, Line, Rect } from "react-konva";
import {
  instrumentMetrics,
  instrumentPalette,
  instrumentShapes,
  instrumentSilhouette,
  type InstrumentKind,
  type InstrumentPalette,
  type InstrumentShape,
} from "./instruments";
import { SPIN_GHOST_COUNT } from "./penChoreography";

export interface VirtualCursorProps {
  x: number;
  y: number;
  /** Barrel tilt about the nib — the writing angle. */
  rotation?: number;
  /** Twirl about the barrel mid-point — the flourish between the fingers. */
  spin?: number;
  /** Pulled back along the barrel axis, in px. 0 is touching the board. */
  lift?: number;
  scale?: number;
  visible?: boolean;
  color?: string;
  instrument?: InstrumentKind;
  glowRadius?: number;
  opacity?: number;
  shadowBlur?: number;
  /**
   * Trailing barrel silhouettes behind the instrument — the vector renderer's
   * motion blur. A fixed number of nodes is mounted once and then driven
   * imperatively by the board, so a smear that thickens and thins with the
   * twirl never costs a React render.
   */
  ghostCount?: number;
}

/**
 * The instrument in the tutor's hand.
 *
 * The art itself lives in `instruments.ts` as flat shape data — this component
 * only maps it onto Konva nodes, so the same table can be rendered to SVG for
 * review. Nib at (0,0) with the barrel up the local -Y axis, so the board puts
 * the contact point exactly on the ink and rotates the barrel about it.
 */

function shapeNode(
  shape: InstrumentShape,
  index: number,
  palette: InstrumentPalette,
  shadowBlur: number,
) {
  const common = {
    fill: shape.fill ? palette[shape.fill] : undefined,
    stroke: shape.stroke ? palette[shape.stroke] : undefined,
    strokeWidth: shape.strokeWidth,
    opacity: shape.opacity,
    perfectDrawEnabled: false,
    ...(shape.shadow
      ? {
          shadowColor: "rgba(0,0,0,0.42)",
          shadowBlur,
          shadowOpacity: 0.5,
          shadowOffsetX: 0.9,
          shadowOffsetY: 1.1,
        }
      : {}),
  };

  if (shape.kind === "rect") {
    return (
      <Rect
        key={index}
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        cornerRadius={shape.radius}
        {...common}
      />
    );
  }

  if (shape.kind === "circle") {
    return <Circle key={index} x={shape.x} y={shape.y} radius={shape.radius} {...common} />;
  }

  if (shape.kind === "stroke") {
    return <Line key={index} points={shape.points} {...common} />;
  }

  return <Line key={index} points={shape.points} closed {...common} />;
}

export const VirtualCursor = forwardRef<Konva.Group, VirtualCursorProps>(function VirtualCursor(
  {
    x,
    y,
    rotation = -33,
    spin = 0,
    lift = 0,
    scale = 1,
    visible = true,
    color = "#1B2A4A",
    instrument = "pen",
    glowRadius = 5,
    opacity = 1,
    shadowBlur,
    ghostCount = SPIN_GHOST_COUNT,
  },
  ref,
) {
  const palette = instrumentPalette(instrument, color);
  const { pivotY } = instrumentMetrics(instrument);
  const silhouette = instrumentSilhouette(instrument);
  const contactSpread = Math.max(0, lift);
  const effectiveShadowBlur = Math.min(shadowBlur ?? glowRadius, 10) + contactSpread * 0.35;

  return (
    <Group
      ref={ref}
      x={x}
      y={y}
      visible={visible}
      rotation={rotation}
      scaleX={scale}
      scaleY={scale}
      opacity={opacity}
      listening={false}
    >
      {/* Board-aligned contact shadow: it spreads and pales as the pen lifts. */}
      <Group rotation={-rotation}>
        <Ellipse
          x={0.8}
          y={1.4}
          radiusX={3.6 + contactSpread * 0.22}
          radiusY={1.4 + contactSpread * 0.07}
          fill="#000000"
          opacity={Math.max(0.04, 0.17 - contactSpread * 0.007)}
          perfectDrawEnabled={false}
        />
      </Group>

      <Circle x={0} y={0} radius={3.6} fill={color} opacity={0.1} perfectDrawEnabled={false} />

      {/*
        `pen-lift` pulls the instrument back along its own axis and `pen-spin`
        twirls it about the barrel mid-point. Both are driven imperatively by
        the board through Konva node lookups, so a flourish never costs a React
        render per frame.
      */}
      <Group name="pen-lift" y={-lift}>
        {/*
          Motion blur. The ghosts sit behind the instrument and share its twirl
          pivot, each parked a few degrees back along the arc just swept. They
          start invisible; only a spin gives them opacity.
        */}
        {Array.from({ length: ghostCount }, (_, index) => (
          <Group
            key={index}
            name={`pen-ghost-${index}`}
            y={pivotY}
            offsetY={pivotY}
            rotation={spin}
            opacity={0}
            listening={false}
          >
            <Line points={[...silhouette]} closed fill={palette.barrel} perfectDrawEnabled={false} />
          </Group>
        ))}

        <Group name="pen-spin" y={pivotY} offsetY={pivotY} rotation={spin}>
          {instrumentShapes(instrument).map((shape, index) =>
            shapeNode(shape, index, palette, effectiveShadowBlur),
          )}
        </Group>
      </Group>
    </Group>
  );
});
