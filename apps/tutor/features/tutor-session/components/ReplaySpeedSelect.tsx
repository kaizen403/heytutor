"use client";

import { DEFAULT_REPLAY_SPEED } from "@/lib/replay/replayAudio";
import { cn } from "@/lib/utils";

/**
 * Playback speed, as a plain select.
 *
 * This is all that survives of the student transport bar: the owner had it
 * removed from the tutor, but the admin Watch drawer drives replays of its own
 * and still needs a speed control. Kept here rather than inside the drawer so
 * the option list stays one list.
 */
export const REPLAY_SPEED_OPTIONS = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3,
] as const;

export type ReplaySpeedOption = (typeof REPLAY_SPEED_OPTIONS)[number];

export function ReplaySpeedSelect({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (rate: number) => void;
  className?: string;
}) {
  const matched = REPLAY_SPEED_OPTIONS.find((speed) => Math.abs(speed - value) < 0.001);
  return (
    <label
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium text-soft",
        className,
      )}
    >
      <span>Speed</span>
      <select
        aria-label="Playback speed"
        value={matched ?? DEFAULT_REPLAY_SPEED}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 rounded-[9px] border border-stroke bg-ink-700 px-2 text-[11px] font-medium text-frost outline-none hover:border-sky-500/35"
      >
        {REPLAY_SPEED_OPTIONS.map((speed) => (
          <option key={speed} value={speed}>
            {speed === 1 ? "1×" : `${speed}×`}
          </option>
        ))}
      </select>
    </label>
  );
}
