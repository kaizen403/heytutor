"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  Radio,
  Settings2,
  X,
} from "lucide-react";
import { formatReplayTime } from "@/lib/replay/replayTimeline";
import {
  LIVE_BAR_HIT_PX,
  lectureScrubberModel,
  type LecturePlaybackMode,
} from "@/lib/replay/liveTimeline";
import { DEFAULT_REPLAY_SPEED } from "@/lib/replay/replayAudio";
import { cn } from "@/lib/utils";

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
        "inline-flex items-center gap-1.5 text-[11px] font-medium text-[#A6A6AE]",
        className,
      )}
    >
      <span>Speed</span>
      <select
        aria-label="Playback speed"
        value={matched ?? DEFAULT_REPLAY_SPEED}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 rounded-full border border-[#2E2E33] bg-[#1E1E21] px-2 text-[11px] font-medium text-[#F2F2F4] outline-none hover:border-[rgba(201,201,210,0.35)]"
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

export interface ReplayControlsProps {
  visible: boolean;
  /**
   * `replay` scrubs a finished lecture end to end. `live` and `rewind` scrub a
   * lecture still being taught, whose track stops at the live edge.
   */
  mode: LecturePlaybackMode;
  playing: boolean;
  progressMs: number;
  /** Whole lecture — only meaningful once it is over. */
  totalMs: number;
  /** End of what has been taught so far. */
  liveEdgeMs: number;
  playbackRate: number;
  onPlayPause: () => void;
  onSeek: (ms: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onGoLive: () => void;
  onStop: () => void;
}

/** Live ink is blue; the past is a calmer slate so the two never read alike. */
const LIVE_FILL = "#F26D6D";
const PAST_FILL = "#5FA4F9";

export function ReplayControls({
  visible,
  mode,
  playing,
  progressMs,
  totalMs,
  liveEdgeMs,
  playbackRate,
  onPlayPause,
  onSeek,
  onPlaybackRateChange,
  onGoLive,
  onStop,
}: ReplayControlsProps) {
  const [hovered, setHovered] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubMs, setScrubMs] = useState(0);
  const scrubStateRef = useRef({ active: false, ms: 0 });
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const track = lectureScrubberModel({ mode, progressMs, totalMs, liveEdgeMs });
  const isLive = mode === "live";
  const isRewind = mode === "rewind";

  const displayMs = scrubbing ? scrubMs : track.valueMs;
  // A live lecture is driven from the lesson chrome, not from a play button
  // floating over the board — only a rewind or a replay owns transport here.
  const showTransport = !isLive;
  const showPlayButton = showTransport && (hovered || !playing || scrubbing || settingsOpen);
  const showBottomChrome =
    hovered || scrubbing || settingsOpen || isCoarsePointer || (showTransport && !playing);

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

  const beginScrub = useCallback(() => {
    scrubStateRef.current = { active: true, ms: track.valueMs };
    setScrubbing(true);
    setScrubMs(track.valueMs);
  }, [track.valueMs]);

  // Seek once on release. Seeking on every intermediate slider value restarted
  // the replay from zero and re-rendered the whole board per pixel of drag.
  const endScrub = useCallback(() => {
    if (!scrubStateRef.current.active) return;
    scrubStateRef.current.active = false;
    setScrubbing(false);
    onSeek(scrubStateRef.current.ms);
  }, [onSeek]);

  const handleScrub = useCallback(
    (value: number) => {
      const clamped = Math.max(0, Math.min(value, track.maxMs));
      scrubStateRef.current.ms = clamped;
      setScrubMs(clamped);
      // Keyboard nudges arrive without a pointer drag; seek them at once.
      if (!scrubStateRef.current.active) onSeek(clamped);
    },
    [onSeek, track.maxMs],
  );

  if (!visible || track.maxMs <= 0) {
    return null;
  }

  const fill = isLive && !scrubbing ? LIVE_FILL : PAST_FILL;
  const filledPercent = track.maxMs > 0 ? (displayMs / track.maxMs) * 100 : 0;

  const leaveChrome = () => {
    setHovered(false);
    if (!scrubbing) {
      setSettingsOpen(false);
    }
  };

  return (
    <div
      className={cn(
        "absolute inset-0 z-30",
        // A live board still takes clicks (diagram labels, retrace) — only the
        // strip along the bottom is ours until the student steps into the past.
        isLive ? "pointer-events-none" : "pointer-events-auto",
      )}
      onMouseEnter={isLive ? undefined : () => setHovered(true)}
      onMouseLeave={isLive ? undefined : leaveChrome}
      onPointerDown={isLive ? undefined : () => setHovered(true)}
    >
      {showTransport && (
        <div
          className={cn(
            "absolute inset-0 transition-colors duration-200",
            showBottomChrome ? "bg-black/10" : "bg-transparent",
          )}
        />
      )}

      {showTransport && (
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
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
      )}

      {/* Live hover slab: a dedicated hit target that does not fade with the
          chrome. Opacity-0 + translate descendants are not reliable once a
          transform puts them on their own layer, and overflow-hidden on the
          board would clip a translated strip. */}
      <div
        data-live-bar-hit={isLive ? "" : undefined}
        className="pointer-events-auto absolute inset-x-0 bottom-0 bg-transparent"
        style={isLive ? { minHeight: LIVE_BAR_HIT_PX } : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={leaveChrome}
        onPointerDown={() => setHovered(true)}
      >
      {isLive && !showBottomChrome ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-4 bottom-3 h-1 rounded-full"
          style={{
            background: `linear-gradient(to right, ${LIVE_FILL} ${filledPercent}%, rgba(255,255,255,0.28) ${filledPercent}%)`,
          }}
        />
      ) : null}
      <div
        className={cn(
          "transition-opacity duration-200",
          isLive && "absolute inset-x-0 bottom-0",
          showBottomChrome ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <div className="bg-gradient-to-t from-black/70 via-black/45 to-transparent px-4 pb-3 pt-10">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            <input
              type="range"
              min={0}
              max={track.maxMs}
              step={250}
              value={displayMs}
              aria-label={
                isLive || isRewind ? "Scrub back through the lecture" : "Replay progress"
              }
              aria-valuetext={`${formatReplayTime(displayMs)} of ${formatReplayTime(track.maxMs)}`}
              onPointerDown={beginScrub}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onLostPointerCapture={endScrub}
              onChange={(event) => handleScrub(Number(event.target.value))}
              className="replay-slider h-4 w-full cursor-pointer appearance-none rounded-full"
              style={{
                ["--replay-progress" as string]: `${filledPercent}%`,
                ["--replay-fill" as string]: fill,
              }}
            />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {showTransport && (
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
                )}
                <span className="text-xs tabular-nums text-white/90">
                  {formatReplayTime(displayMs)} / {formatReplayTime(track.maxMs)}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {(isLive || isRewind) && (
                  <button
                    type="button"
                    onClick={onGoLive}
                    disabled={isLive}
                    aria-label={isLive ? "Watching live" : "Jump back to live"}
                    title={isLive ? "You are at the live edge" : "Jump back to live"}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                      isLive
                        ? "cursor-default text-white/90"
                        : "bg-white/15 text-white hover:bg-white/25",
                    )}
                  >
                    <Radio
                      className="h-3 w-3"
                      style={{ color: isLive ? LIVE_FILL : undefined }}
                    />
                    {isLive ? "Live" : "Go live"}
                  </button>
                )}

                <div className="relative" ref={settingsRef}>
                  <button
                    type="button"
                    aria-label="Playback settings"
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
                      {REPLAY_SPEED_OPTIONS.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          onClick={() => {
                            onPlaybackRateChange(speed);
                            setSettingsOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm text-white/90 transition-colors hover:bg-white/10",
                            playbackRate === speed && "bg-[rgba(136,189,164,0.35)] text-white",
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

                {mode === "replay" && (
                  <button
                    type="button"
                    aria-label="Exit replay"
                    onClick={onStop}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
