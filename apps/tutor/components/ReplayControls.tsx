"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  Settings2,
  X,
} from "lucide-react";
import { formatReplayTime } from "@/lib/replayTimeline";
import { cn } from "@/lib/utils";

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export interface ReplayControlsProps {
  visible: boolean;
  playing: boolean;
  progressMs: number;
  totalMs: number;
  playbackRate: number;
  onPlayPause: () => void;
  onSeek: (ms: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onStop: () => void;
}

export function ReplayControls({
  visible,
  playing,
  progressMs,
  totalMs,
  playbackRate,
  onPlayPause,
  onSeek,
  onPlaybackRateChange,
  onStop,
}: ReplayControlsProps) {
  const [hovered, setHovered] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubMs, setScrubMs] = useState(0);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const displayMs = scrubbing ? scrubMs : progressMs;
  const showPlayButton = hovered || !playing || scrubbing || settingsOpen;
  const showBottomChrome =
    hovered || !playing || scrubbing || settingsOpen || isCoarsePointer;

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const onChange = () => setIsCoarsePointer(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [settingsOpen]);

  const handleScrub = useCallback(
    (value: number) => {
      const clamped = Math.max(0, Math.min(value, totalMs));
      setScrubMs(clamped);
      onSeek(clamped);
    },
    [onSeek, totalMs],
  );

  if (!visible || totalMs <= 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        if (!scrubbing) {
          setSettingsOpen(false);
        }
      }}
      onPointerDown={() => setHovered(true)}
    >
      <div
        className={cn(
          "absolute inset-0 transition-colors duration-200",
          showBottomChrome ? "bg-black/10" : "bg-transparent",
        )}
      />

      <button
        type="button"
        aria-label={playing ? "Pause replay" : "Play replay"}
        onClick={onPlayPause}
        className={cn(
          "absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
          "bg-black/55 text-white shadow-lg backdrop-blur-sm transition-all duration-200",
          showPlayButton ? "scale-100 opacity-100" : "scale-90 opacity-0 pointer-events-none",
        )}
      >
        {playing ? (
          <Pause className="h-7 w-7 fill-current" />
        ) : (
          <Play className="ml-0.5 h-7 w-7 fill-current" />
        )}
      </button>

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 transition-all duration-200",
          showBottomChrome ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0 pointer-events-none",
        )}
      >
        <div className="bg-gradient-to-t from-black/70 via-black/45 to-transparent px-4 pb-3 pt-10">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            <input
              type="range"
              min={0}
              max={totalMs}
              step={250}
              value={displayMs}
              aria-label="Replay progress"
              onPointerDown={() => {
                setScrubbing(true);
                setScrubMs(progressMs);
              }}
              onPointerUp={() => setScrubbing(false)}
              onChange={(event) => handleScrub(Number(event.target.value))}
              className="replay-slider h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-[#0077CC]"
            />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={playing ? "Pause" : "Play"}
                  onClick={onPlayPause}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
                >
                  {playing ? (
                    <Pause className="h-4 w-4 fill-current" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                </button>
                <span className="text-xs tabular-nums text-white/90">
                  {formatReplayTime(displayMs)} / {formatReplayTime(totalMs)}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <div className="relative" ref={settingsRef}>
                  <button
                    type="button"
                    aria-label="Replay settings"
                    aria-expanded={settingsOpen}
                    onClick={() => setSettingsOpen((open) => !open)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
                  >
                    <Settings2 className="h-4 w-4" />
                  </button>

                  {settingsOpen && (
                    <div className="absolute bottom-full right-0 mb-2 min-w-[9rem] rounded-xl border border-white/10 bg-[rgba(20,20,20,0.92)] p-2 shadow-xl backdrop-blur-md">
                      <p className="px-2 pb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-white/55">
                        speed
                      </p>
                      {SPEED_OPTIONS.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          onClick={() => {
                            onPlaybackRateChange(speed);
                            setSettingsOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-white/90 transition-colors hover:bg-white/10",
                            playbackRate === speed && "bg-[rgba(0,119,204,0.35)] text-white",
                          )}
                        >
                          <span>{speed === 1 ? "Normal" : `${speed}x`}</span>
                          {playbackRate === speed && (
                            <span className="text-[0.65rem] uppercase tracking-wide text-white/70">
                              on
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  aria-label="Exit replay"
                  onClick={onStop}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
