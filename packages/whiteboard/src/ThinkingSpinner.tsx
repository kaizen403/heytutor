"use client";

import { useEffect, useRef, useState } from "react";
import { Arc, Group } from "react-konva";

export interface ThinkingSpinnerProps {
  x: number;
  y: number;
  visible?: boolean;
  color?: string;
  size?: number;
}

const FULL_ROTATION_DEGREES = 360;
const ROTATION_DURATION_MS = 800;

export function ThinkingSpinner({
  x,
  y,
  visible = true,
  color = "#659287",
  size = 14,
}: ThinkingSpinnerProps) {
  const [rotation, setRotation] = useState(0);
  const frameIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    let cancelled = false;
    const startTime = performance.now();

    const tick = (time: number) => {
      if (cancelled) {
        return;
      }

      const progress = ((time - startTime) % ROTATION_DURATION_MS) / ROTATION_DURATION_MS;
      setRotation(progress * FULL_ROTATION_DEGREES);
      frameIdRef.current = requestAnimationFrame(tick);
    };

    frameIdRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
      }
    };
  }, [visible]);

  return (
    <Group x={x} y={y} visible={visible} rotation={rotation}>
      <Arc
        innerRadius={size / 2}
        outerRadius={size / 2}
        angle={252}
        rotation={54}
        stroke={color}
        strokeWidth={2.5}
        lineCap="round"
        shadowColor={color}
        shadowBlur={6}
        shadowOpacity={0.6}
        shadowOffsetX={0}
        shadowOffsetY={0}
      />
    </Group>
  );
}
