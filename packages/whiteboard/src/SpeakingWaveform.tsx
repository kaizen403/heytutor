"use client";

import { useEffect, useRef, useState } from "react";
import { Group, Rect } from "react-konva";

export interface SpeakingWaveformProps {
  x: number;
  y: number;
  visible?: boolean;
  color?: string;
  audioLevel?: number;
}

const BAR_WIDTH = 2;
const BAR_SPACING = 2;
const BAR_COUNT = 5;
const PROFILE = [0.4, 0.7, 1.0, 0.7, 0.4] as const;
const PHASE_SPEED_RADIANS_PER_SECOND = 3.6;
const BAR_PHASE_OFFSET = 0.35;
const TOTAL_WIDTH = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_SPACING;

function easedAudioPower(audioLevel: number): number {
  const normalizedAudioPowerLevel = Math.max(audioLevel - 0.008, 0);
  return Math.pow(Math.min(normalizedAudioPowerLevel * 2.85, 1), 0.76);
}

export function SpeakingWaveform({
  x,
  y,
  visible = true,
  color = "#3380FF",
  audioLevel = 0,
}: SpeakingWaveformProps) {
  const [barHeights, setBarHeights] = useState<number[]>(() => PROFILE.map(() => 3));
  const frameIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    let cancelled = false;

    const tick = (time: number) => {
      if (cancelled) {
        return;
      }

      const timelineSeconds = time / 1_000;
      const easedAudioPowerLevel = easedAudioPower(audioLevel);
      const nextHeights = PROFILE.map((profile, barIndex) => {
        const animationPhase = timelineSeconds * PHASE_SPEED_RADIANS_PER_SECOND + barIndex * BAR_PHASE_OFFSET;
        const reactiveHeight = easedAudioPowerLevel * 10 * profile;
        const idlePulse = ((Math.sin(animationPhase) + 1) / 2) * 1.5;

        return 3 + reactiveHeight + idlePulse;
      });

      setBarHeights(nextHeights);
      frameIdRef.current = requestAnimationFrame(tick);
    };

    frameIdRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
      }
    };
  }, [audioLevel, visible]);

  return (
    <Group x={x - TOTAL_WIDTH / 2} y={y} visible={visible}>
      {barHeights.map((height, barIndex) => (
        <Rect
          key={barIndex}
          x={barIndex * (BAR_WIDTH + BAR_SPACING)}
          y={-height / 2}
          width={BAR_WIDTH}
          height={height}
          cornerRadius={1.5}
          fill={color}
          shadowColor={color}
          shadowBlur={6}
          shadowOpacity={0.6}
          shadowOffsetX={0}
          shadowOffsetY={0}
        />
      ))}
    </Group>
  );
}
