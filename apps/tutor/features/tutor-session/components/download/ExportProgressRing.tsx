import { cn } from "@/lib/utils";

const RADIUS = 6.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface ExportProgressRingProps {
  /** 0 to 99 for a known amount; null draws the indeterminate arc. */
  percent: number | null;
  /** Outer size in px: 16 on the header pill, 18 compact. */
  size?: number;
  className?: string;
}

/**
 * The download's progress ring. Determinate and indeterminate share one box,
 * so the swap from "Preparing" to "7%" moves no pixels. Under reduced motion
 * the indeterminate arc stands still and the determinate arc steps without
 * easing.
 */
export function ExportProgressRing({ percent, size = 16, className }: ExportProgressRingProps) {
  const determinate = percent !== null;
  const fraction = determinate ? Math.min(99, Math.max(0, percent)) / 100 : 0.25;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="progressbar"
      aria-label="Download progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(fraction * 100) : undefined}
      data-ring={determinate ? "determinate" : "indeterminate"}
      className={cn("export-ring shrink-0", !determinate && "motion-safe:animate-spin", className)}
    >
      <g transform="rotate(-90 8 8)">
        <circle
          cx={8}
          cy={8}
          r={RADIUS}
          fill="none"
          stroke="var(--stroke-strong)"
          strokeWidth={2}
        />
        <circle
          className="export-ring__arc motion-safe:transition-[stroke-dashoffset] motion-safe:duration-200 motion-safe:ease-linear"
          cx={8}
          cy={8}
          r={RADIUS}
          fill="none"
          stroke="var(--sky-500)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </g>
    </svg>
  );
}
