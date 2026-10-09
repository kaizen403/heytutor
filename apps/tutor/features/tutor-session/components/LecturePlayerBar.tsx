"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Check, Maximize, Minimize, Pause, Play, RotateCcw } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useMediaQuery } from "@/lib/client/useMediaQuery";
import {
  LECTURE_PLAYER_SKIP_MS,
  chapterAt,
  formatPlayerTime,
  msFromFraction,
  timelineFraction,
  type LecturePlayerChapter,
  type LecturePlayerControls,
  type LecturePlayerStatus,
  type LecturePlayerStore,
} from "@/lib/replay/lecturePlayer";
import { cn } from "@/lib/utils";
import { REPLAY_SPEED_OPTIONS } from "./ReplaySpeedSelect";

export interface LecturePlayerBarProps {
  store: LecturePlayerStore;
  controls: LecturePlayerControls;
  speedOptions?: readonly number[];
  fullscreen?: { active: boolean; toggle: () => void } | null;
  /** The board container. Pointer movement over it wakes the chrome; the cursor is hidden there while the chrome is hidden during playback. */
  activityTargetRef?: RefObject<HTMLElement | null>;
  className?: string;
}

const CHROME_IDLE_MS = 2_500;
const ACTIVITY_THROTTLE_MS = 150;
const HOVER_RELEASE_MS = 300;
const TIMELINE_KEY_STEP_MS = 5_000;
const CHAPTER_GAP_PX = 3;
const FLASH_DEDUPE_MS = 1_000;
/**
 * A released scrub keeps showing its target until the store reports a
 * position this close to it, so the thumb does not snap back while the board
 * rebuilds. `SEEK_HOLD_MS` bounds the wait once the store is not seeking.
 */
const SEEK_SETTLE_MS = 1_000;
const SEEK_HOLD_MS = 1_200;
const MENU_GAP_PX = 8;
const MENU_EDGE_PX = 8;
const MENU_MIN_HEIGHT_PX = 120;

const PLAYER_BUTTON =
  "relative flex shrink-0 items-center justify-center rounded-full text-white outline-none transition duration-150 active:bg-white/20 focus-visible:ring-2 focus-visible:ring-sky-400";
const ICON_SHADOW = "drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.45)]";
const TEXT_SHADOW = "[text-shadow:0_1px_2px_rgba(0,0,0,0.5)]";

type FlashKind = "play" | "pause";
type SettledStatus = "playing" | "paused";
type PlayGlyph = "play" | "pause" | "replay";

interface TrackRect {
  left: number;
  width: number;
}

interface TimelineHover {
  ms: number;
  /** Pointer offset from the track's left edge, in px. */
  x: number;
  width: number;
}

/** Lecture ms under `clientX` on a track spanning `rect`, clamped to the track. */
export function scrubMsFromPointer(
  clientX: number,
  rect: { left: number; width: number },
  durationMs: number,
): number {
  if (!(rect.width > 0) || !(durationMs > 0)) return 0;
  return Math.round(msFromFraction((clientX - rect.left) / rect.width, durationMs));
}

function timelineHoverAt(clientX: number, rect: TrackRect, ms: number): TimelineHover {
  return { ms, x: Math.max(0, Math.min(clientX - rect.left, rect.width)), width: rect.width };
}

/** Hard transparent cuts at every chapter start after the first. */
function chapterGapMask(
  chapters: readonly LecturePlayerChapter[],
  durationMs: number,
): string | null {
  if (chapters.length < 2 || !(durationMs > 0)) return null;
  const half = CHAPTER_GAP_PX / 2;
  const stops: string[] = [];
  const starts = chapters
    .map((chapter) => chapter.startMs)
    .filter((ms) => ms > 0 && ms < durationMs)
    .sort((a, b) => a - b);
  for (const ms of starts) {
    const at = `${((ms / durationMs) * 100).toFixed(3)}%`;
    stops.push(
      `#000 calc(${at} - ${half}px)`,
      `transparent calc(${at} - ${half}px)`,
      `transparent calc(${at} + ${half}px)`,
      `#000 calc(${at} + ${half}px)`,
    );
  }
  return stops.length > 0 ? `linear-gradient(to right, ${stops.join(", ")})` : null;
}

function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

function buttonSize(coarse: boolean): string {
  return coarse ? "h-11 w-11" : "h-9 w-9";
}

/** Whether the play button would pause: loading and seeking keep the last settled intent. */
function playbackIntended(status: LecturePlayerStatus, settled: SettledStatus | null): boolean {
  if (status === "playing") return true;
  if (status === "loading") return settled !== "paused";
  if (status === "seeking") return settled === "playing";
  return false;
}

function playButtonFace(
  active: boolean,
  status: LecturePlayerStatus,
  settled: SettledStatus | null,
): { label: string; glyph: PlayGlyph } {
  if (!active) return { label: "Play lecture", glyph: "play" };
  if (status === "ended") return { label: "Replay", glyph: "replay" };
  if (playbackIntended(status, settled)) return { label: "Pause", glyph: "pause" };
  return { label: "Play", glyph: "play" };
}

/**
 * A pointer click leaves focus on the button, and Space would then press it
 * again instead of reaching the host's play/pause shortcut.
 */
function releasePointerFocus(event: ReactMouseEvent<HTMLButtonElement>): void {
  if (event.detail > 0) event.currentTarget.blur();
}

/** Clicks on the controls are not clicks on the board beneath them. */
function stopClickPropagation(event: ReactMouseEvent<HTMLDivElement>): void {
  event.stopPropagation();
}

function SkipGlyph({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={ICON_SHADOW}
    >
      <g transform={direction === "forward" ? "matrix(-1 0 0 1 24 0)" : undefined}>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </g>
      <text
        x="12"
        y="15.3"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        letterSpacing="-0.3"
      >
        10
      </text>
    </svg>
  );
}

interface PlayButtonProps {
  glyph: PlayGlyph;
  label: string;
  busy: boolean;
  interactive: boolean;
  coarse: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

const PlayButton = memo(function PlayButton({
  glyph,
  label,
  busy,
  interactive,
  coarse,
  onClick,
}: PlayButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-busy={busy || undefined}
      onClick={onClick}
      className={cn(
        PLAYER_BUTTON,
        buttonSize(coarse),
        interactive ? "pointer-events-auto" : "pointer-events-none",
        "hover:bg-white/15",
      )}
    >
      {busy ? (
        <Spinner size={18} thickness={2} className={ICON_SHADOW} />
      ) : glyph === "pause" ? (
        <Pause className={cn("h-5 w-5 fill-current", ICON_SHADOW)} aria-hidden />
      ) : glyph === "replay" ? (
        <RotateCcw className={cn("h-5 w-5", ICON_SHADOW)} aria-hidden />
      ) : (
        <Play className={cn("ml-0.5 h-5 w-5 fill-current", ICON_SHADOW)} aria-hidden />
      )}
    </button>
  );
});

const SkipButton = memo(function SkipButton({
  direction,
  coarse,
  onSkip,
}: {
  direction: "back" | "forward";
  coarse: boolean;
  onSkip: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={direction === "back" ? "Back 10 seconds" : "Forward 10 seconds"}
      onClick={onSkip}
      className={cn(PLAYER_BUTTON, buttonSize(coarse), "hover:bg-white/15")}
    >
      <SkipGlyph direction={direction} />
    </button>
  );
});

const FullscreenButton = memo(function FullscreenButton({
  active,
  coarse,
  onToggle,
}: {
  active: boolean;
  coarse: boolean;
  onToggle: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={active ? "Exit full screen" : "Full screen"}
      onClick={onToggle}
      className={cn(PLAYER_BUTTON, buttonSize(coarse), "hover:bg-white/15")}
    >
      {active ? (
        <Minimize className={cn("h-5 w-5", ICON_SHADOW)} aria-hidden />
      ) : (
        <Maximize className={cn("h-5 w-5", ICON_SHADOW)} aria-hidden />
      )}
    </button>
  );
});

interface SpeedControlProps {
  rate: number;
  options: readonly number[];
  open: boolean;
  coarse: boolean;
  /** The strip; the menu is kept inside its parent, which clips. */
  boundsRef: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSelect: (rate: number) => void;
}

const SpeedControl = memo(function SpeedControl({
  rate,
  options,
  open,
  coarse,
  boundsRef,
  onOpenChange,
  onSelect,
}: SpeedControlProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    // Captured on window: the host binds Escape too, and must not see this one.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      buttonRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onOpenChange, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menu || !button) return;
    const bounds = boundsRef.current?.parentElement ?? null;
    if (bounds) {
      const room =
        button.getBoundingClientRect().top -
        bounds.getBoundingClientRect().top -
        MENU_GAP_PX -
        MENU_EDGE_PX;
      menu.style.maxHeight = `${Math.max(MENU_MIN_HEIGHT_PX, Math.floor(room))}px`;
    }
    const current =
      menu.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu.querySelector<HTMLElement>('[role="menuitemradio"]');
    if (!current) return;
    // `focus()` may scroll the clipping board surface; the menu scrolls itself instead.
    current.focus({ preventScroll: true });
    menu.scrollTop = current.offsetTop - (menu.clientHeight - current.offsetHeight) / 2;
  }, [boundsRef, open]);

  const onButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (open) releasePointerFocus(event);
    onOpenChange(!open);
  };

  const choose = (event: ReactMouseEvent<HTMLButtonElement>, option: number) => {
    onSelect(option);
    onOpenChange(false);
    if (event.detail === 0) buttonRef.current?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = index < 0 ? 0 : (index + 1) % items.length;
        break;
      case "ArrowUp":
        next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  };

  const onWrapperBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!open || !next || event.currentTarget.contains(next)) return;
    onOpenChange(false);
  };

  const label = formatRate(rate);

  return (
    <div ref={wrapperRef} className="relative" onBlur={onWrapperBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Playback speed, ${rate === 1 ? "normal" : label}`}
        onClick={onButtonClick}
        className={cn(
          PLAYER_BUTTON,
          buttonSize(coarse),
          "w-auto px-2.5 text-[13px] font-semibold tabular-nums hover:bg-white/15",
          coarse && "min-w-11",
          open && "bg-white/15",
          TEXT_SHADOW,
        )}
      >
        {label}
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Playback speed"
          onKeyDown={onMenuKeyDown}
          className="glass-deep animate-wb-bubble-fade absolute bottom-full right-0 mb-2 min-w-[9.5rem] overflow-y-auto overscroll-contain rounded-xl p-1 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.7)]"
        >
          <p aria-hidden className="type-accent-xs px-2.5 pb-1.5 pt-1 text-faint">
            Playback speed
          </p>
          {options.map((option) => {
            const selected = Math.abs(option - rate) < 0.001;
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={(event) => choose(event, option)}
                className={cn(
                  "type-accent-xs flex w-full items-center gap-2 rounded-lg px-2.5 text-left outline-none transition-colors",
                  "hover:bg-white/5 hover:text-frost focus-visible:bg-white/5 focus-visible:text-frost",
                  coarse ? "py-2.5" : "py-1.5",
                  selected ? "text-frost" : "text-soft",
                )}
              >
                <Check
                  className={cn("h-3.5 w-3.5 shrink-0 text-sky-400", !selected && "invisible")}
                  aria-hidden
                />
                <span className="tabular-nums">{option === 1 ? "Normal" : formatRate(option)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

/**
 * Transport for a finished lecture, drawn over the bottom of the board.
 *
 * Full YouTube-style bar on the finished board, auto-hidden only while the
 * lecture is playing and the pointer is idle. A 3px rail after the lesson
 * ended was easy to miss against the board edge. Scrubbing previews locally
 * and seeks once on release, because each seek rebuilds the whole board.
 */
export function LecturePlayerBar({
  store,
  controls,
  speedOptions = REPLAY_SPEED_OPTIONS,
  fullscreen = null,
  activityTargetRef,
  className,
}: LecturePlayerBarProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { status, active, positionMs, durationMs, loadedMs, rate, chapters, error } = snapshot;
  const coarse = useMediaQuery("(pointer: coarse)");

  const stripRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<{ pointerId: number; rect: TrackRect } | null>(null);
  const hoverTimerRef = useRef(0);
  const settledRef = useRef<SettledStatus | null>(null);
  const flashRef = useRef<{ kind: FlashKind | null; at: number; id: number }>({
    kind: null,
    at: 0,
    id: 0,
  });

  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [hover, setHover] = useState<TimelineHover | null>(null);
  const [pendingSeekMs, setPendingSeekMs] = useState<number | null>(null);
  const [settled, setSettled] = useState<SettledStatus | null>(null);
  const [flash, setFlash] = useState<{ kind: FlashKind; id: number } | null>(null);

  const playing = status === "playing";
  const scrubbing = scrubMs !== null;
  const engaged = hovered || keyboardFocus || menuOpen || scrubbing;
  const chromeHidden = playing && idle && !engaged;
  const fullShown = !chromeHidden;

  const holdMs =
    pendingSeekMs !== null && Math.abs(positionMs - pendingSeekMs) > SEEK_SETTLE_MS
      ? pendingSeekMs
      : null;
  const seekBusy = status === "seeking";
  const displayMs = Math.max(0, Math.min(scrubMs ?? holdMs ?? positionMs, durationMs));
  // Dropped as soon as the store catches up, so a later skip far from the
  // target can never bring the stale hold back.
  if (pendingSeekMs !== null && holdMs === null) setPendingSeekMs(null);

  const showFlash = useCallback((kind: FlashKind) => {
    const now = performance.now();
    const last = flashRef.current;
    if (last.kind === kind && now - last.at < FLASH_DEDUPE_MS) return;
    const id = last.id + 1;
    flashRef.current = { kind, at: now, id };
    setFlash({ kind, id });
  }, []);

  const clearFlash = useCallback(() => setFlash(null), []);

  const seekTo = useCallback(
    (ms: number) => {
      setPendingSeekMs(ms);
      controls.seek(ms);
    },
    [controls],
  );

  // The last playing/paused state, for the play button's intent while loading
  // or seeking, and for the center flash when the host toggles playback.
  useEffect(() => {
    let next = settledRef.current;
    if (!active || status === "ready" || status === "ended" || status === "unavailable") {
      next = null;
    } else if (status === "playing" || status === "paused") {
      next = status;
    }
    const previous = settledRef.current;
    if (next === previous) return;
    settledRef.current = next;
    setSettled(next);
    if (previous !== null && next !== null) showFlash(next === "playing" ? "play" : "pause");
  }, [active, showFlash, status]);

  useEffect(() => {
    if (pendingSeekMs === null || seekBusy) return undefined;
    const timer = window.setTimeout(() => setPendingSeekMs(null), SEEK_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [pendingSeekMs, seekBusy]);

  useEffect(() => {
    if (!playing) return undefined;
    const strip = stripRef.current;
    const target = activityTargetRef?.current ?? strip?.parentElement ?? null;
    const pointerTargets = new Set([target, strip].filter((el): el is HTMLElement => el !== null));
    let timer = window.setTimeout(() => setIdle(true), CHROME_IDLE_MS);
    let lastWake = performance.now();
    const wake = () => {
      const now = performance.now();
      if (now - lastWake < ACTIVITY_THROTTLE_MS) return;
      lastWake = now;
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), CHROME_IDLE_MS);
    };
    for (const element of pointerTargets) {
      element.addEventListener("pointermove", wake, { passive: true });
      element.addEventListener("pointerdown", wake, { passive: true });
    }
    // Captured: the bar stops propagation of the keys it handles itself.
    window.addEventListener("keydown", wake, true);
    return () => {
      window.clearTimeout(timer);
      for (const element of pointerTargets) {
        element.removeEventListener("pointermove", wake);
        element.removeEventListener("pointerdown", wake);
      }
      window.removeEventListener("keydown", wake, true);
      setIdle(false);
    };
  }, [activityTargetRef, playing]);

  useEffect(() => {
    if (!chromeHidden) return undefined;
    const target = activityTargetRef?.current;
    if (!target) return undefined;
    const { style } = target;
    const previous = style.getPropertyValue("cursor");
    const previousPriority = style.getPropertyPriority("cursor");
    style.setProperty("cursor", "none");
    return () => {
      if (previous) style.setProperty("cursor", previous, previousPriority);
      else style.removeProperty("cursor");
    };
  }, [activityTargetRef, chromeHidden]);

  useEffect(() => {
    const hoverTimer = hoverTimerRef;
    return () => window.clearTimeout(hoverTimer.current);
  }, []);

  const trackMaskStyle = useMemo<CSSProperties | undefined>(() => {
    const mask = chapterGapMask(chapters, durationMs);
    return mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined;
  }, [chapters, durationMs]);

  const showTooltip = hover !== null && fullShown;
  const tipX = hover?.x ?? 0;
  const tipWidth = hover?.width ?? 0;
  const tipTime = hover ? formatPlayerTime(hover.ms) : "";
  const tipTitle =
    hover && chapters.length > 1 ? (chapterAt(chapters, hover.ms)?.title ?? null) : null;

  useLayoutEffect(() => {
    const tip = tooltipRef.current;
    if (!showTooltip || !tip) return;
    const width = tip.offsetWidth;
    const left = Math.max(0, Math.min(tipX - width / 2, tipWidth - width));
    tip.style.transform = `translateX(${left}px)`;
  }, [showTooltip, tipTime, tipTitle, tipWidth, tipX]);

  const handlePlay = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      releasePointerFocus(event);
      const current = store.getSnapshot();
      if (!current.active || current.status === "ended") {
        showFlash("play");
        controls.play();
        return;
      }
      showFlash(playbackIntended(current.status, settledRef.current) ? "pause" : "play");
      controls.toggle();
    },
    [controls, showFlash, store],
  );

  const skipBack = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      releasePointerFocus(event);
      controls.skip(-LECTURE_PLAYER_SKIP_MS);
    },
    [controls],
  );

  const skipForward = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      releasePointerFocus(event);
      controls.skip(LECTURE_PLAYER_SKIP_MS);
    },
    [controls],
  );

  const selectRate = useCallback((next: number) => controls.setRate(next), [controls]);

  const fullscreenToggle = fullscreen?.toggle;
  const toggleFullscreen = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      releasePointerFocus(event);
      fullscreenToggle?.();
    },
    [fullscreenToggle],
  );

  const onStripPointerEnter = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    window.clearTimeout(hoverTimerRef.current);
    setHovered(true);
  }, []);

  const onStripPointerLeave = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => setHovered(false), HOVER_RELEASE_MS);
  }, []);

  // Only keyboard focus pins the chrome: a clicked control keeps focus too.
  const onStripFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    setKeyboardFocus(event.target.matches(":focus-visible"));
  }, []);

  const onStripBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setKeyboardFocus(false);
  }, []);

  // A focused button answers Space and Enter itself; the host's window
  // shortcut must not toggle playback on top of it.
  const onStripKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.key === " " || event.key === "Enter") && event.target instanceof HTMLButtonElement) {
      event.stopPropagation();
    }
  }, []);

  const onTimelinePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const total = store.getSnapshot().durationMs;
      if (!(total > 0)) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const rect = { left: bounds.left, width: bounds.width };
      event.currentTarget.setPointerCapture(event.pointerId);
      scrubRef.current = { pointerId: event.pointerId, rect };
      const ms = scrubMsFromPointer(event.clientX, rect, total);
      setScrubMs(ms);
      setHover(timelineHoverAt(event.clientX, rect, ms));
    },
    [store],
  );

  const onTimelinePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const total = store.getSnapshot().durationMs;
      const scrub = scrubRef.current;
      if (scrub) {
        if (scrub.pointerId !== event.pointerId) return;
        const ms = scrubMsFromPointer(event.clientX, scrub.rect, total);
        setScrubMs(ms);
        setHover(timelineHoverAt(event.clientX, scrub.rect, ms));
        return;
      }
      if (event.pointerType === "touch") return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const rect = { left: bounds.left, width: bounds.width };
      setHover(timelineHoverAt(event.clientX, rect, scrubMsFromPointer(event.clientX, rect, total)));
    },
    [store],
  );

  const onTimelinePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const scrub = scrubRef.current;
      if (!scrub || scrub.pointerId !== event.pointerId) return;
      scrubRef.current = null;
      setScrubMs(null);
      if (event.pointerType === "touch") setHover(null);
      seekTo(scrubMsFromPointer(event.clientX, scrub.rect, store.getSnapshot().durationMs));
    },
    [seekTo, store],
  );

  const abortScrub = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.pointerId !== event.pointerId) return;
    scrubRef.current = null;
    setScrubMs(null);
    setHover(null);
  }, []);

  const onTimelinePointerLeave = useCallback(() => {
    if (!scrubRef.current) setHover(null);
  }, []);

  // Stopped here so the host's window shortcuts (arrows skip 10 s, Home/End)
  // do not handle the same key again.
  const onTimelineKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "ArrowLeft":
          controls.skip(-TIMELINE_KEY_STEP_MS);
          break;
        case "ArrowRight":
          controls.skip(TIMELINE_KEY_STEP_MS);
          break;
        case "Home":
          seekTo(0);
          break;
        case "End":
          seekTo(store.getSnapshot().durationMs);
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [controls, seekTo, store],
  );

  if (status === "unavailable" || !(durationMs > 0)) return null;

  const playedFraction = timelineFraction(displayMs, durationMs);
  const loadedFraction = timelineFraction(loadedMs, durationMs);
  const hoverFraction = hover && !scrubbing ? timelineFraction(hover.ms, durationMs) : 0;
  const trackEngaged = hover !== null || scrubbing;
  const chapter = chapterAt(chapters, displayMs);
  const face = playButtonFace(active, status, settled);
  const busy = status === "loading" || seekBusy;

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
      >
        {flash ? (
          <div
            key={flash.id}
            onAnimationEnd={clearFlash}
            className="wb-player-flash flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"
          >
            {flash.kind === "play" ? (
              <Play className="ml-1 h-7 w-7 fill-current" aria-hidden />
            ) : (
              <Pause className="h-7 w-7 fill-current" aria-hidden />
            )}
          </div>
        ) : null}
      </div>

      <div
        ref={stripRef}
        role="group"
        aria-label="Lecture player"
        onPointerEnter={onStripPointerEnter}
        onPointerLeave={onStripPointerLeave}
        onFocus={onStripFocus}
        onBlur={onStripBlur}
        onKeyDown={onStripKeyDown}
        onClick={stopClickPropagation}
        className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-30 select-none", className)}
      >
        <div
          aria-hidden
          className={cn(
            "absolute inset-x-0 bottom-0 h-[108px] bg-gradient-to-t from-black/70 via-black/35 to-transparent transition-opacity duration-200",
            fullShown ? "opacity-100" : "opacity-0",
          )}
        />

        <div
          className={cn(
            "relative px-3 transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none sm:px-4",
            fullscreen?.active ? "pb-[max(8px,env(safe-area-inset-bottom))]" : "pb-2",
            fullShown ? "pointer-events-auto" : "pointer-events-none",
            chromeHidden && "translate-y-1 opacity-0",
          )}
        >
          <div className="relative">
            {showTooltip ? (
              <div
                ref={tooltipRef}
                className="glass-deep pointer-events-none absolute bottom-full left-0 mb-1.5 w-max max-w-[276px] rounded-lg px-2.5 py-1.5 text-center shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]"
              >
                {tipTitle ? <div className="type-accent-xs truncate text-soft">{tipTitle}</div> : null}
                <div className="text-[12px] font-semibold leading-4 tabular-nums text-frost">
                  {tipTime}
                </div>
              </div>
            ) : null}
            <div
              role="slider"
              tabIndex={0}
              aria-label="Lecture timeline"
              aria-valuemin={0}
              aria-valuemax={Math.round(durationMs)}
              aria-valuenow={Math.floor(displayMs / 1000) * 1000}
              aria-valuetext={`${formatPlayerTime(displayMs)} of ${formatPlayerTime(durationMs)}`}
              onPointerDown={onTimelinePointerDown}
              onPointerMove={onTimelinePointerMove}
              onPointerUp={onTimelinePointerUp}
              onPointerCancel={abortScrub}
              onLostPointerCapture={abortScrub}
              onPointerLeave={onTimelinePointerLeave}
              onKeyDown={onTimelineKeyDown}
              className={cn(
                "group/timeline relative flex cursor-pointer touch-none items-center outline-none",
                coarse ? "h-7" : "h-5",
              )}
            >
              <div
                className={cn(
                  "relative w-full overflow-hidden rounded-full transition-[height] duration-150 motion-reduce:transition-none",
                  trackEngaged ? "h-1.5" : "h-1 group-focus-visible/timeline:h-1.5",
                )}
                style={trackMaskStyle}
              >
                <div className="absolute inset-0 bg-white/22" />
                <div
                  className="absolute inset-0 origin-left bg-white/38"
                  style={{ transform: `scaleX(${loadedFraction})` }}
                />
                {hoverFraction > playedFraction ? (
                  <div
                    className="absolute inset-0 origin-left bg-white/50"
                    style={{ transform: `scaleX(${hoverFraction})` }}
                  />
                ) : null}
                <div
                  className="absolute inset-0 origin-left bg-sky-500"
                  style={{ transform: `scaleX(${playedFraction})` }}
                />
              </div>
              <div
                className="pointer-events-none absolute inset-0"
                style={{ transform: `translateX(${playedFraction * 100}%)` }}
              >
                <div
                  className={cn(
                    "absolute left-0 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500 shadow-[0_1px_4px_rgba(0,0,0,0.45)]",
                    "transition-[scale] duration-150 motion-reduce:transition-none group-focus-visible/timeline:ring-2 group-focus-visible/timeline:ring-white",
                    trackEngaged ? "scale-100" : "scale-0 group-focus-visible/timeline:scale-100",
                  )}
                />
              </div>
            </div>
          </div>

          <div className="mt-0.5 flex items-center gap-0.5 sm:gap-1">
            <PlayButton
              glyph={face.glyph}
              label={face.label}
              busy={busy}
              interactive={!chromeHidden}
              coarse={coarse}
              onClick={handlePlay}
            />
            <div
              className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1"
            >
              <SkipButton direction="back" coarse={coarse} onSkip={skipBack} />
              <SkipButton direction="forward" coarse={coarse} onSkip={skipForward} />
              <span
                className={cn(
                  "ml-1.5 shrink-0 whitespace-nowrap text-[13px] font-medium tabular-nums text-white",
                  TEXT_SHADOW,
                )}
              >
                {formatPlayerTime(displayMs)}
                <span className="text-white/60"> / {formatPlayerTime(durationMs)}</span>
              </span>
              <div className="ml-2 hidden min-w-0 flex-1 items-center gap-2 sm:flex">
                {error ? (
                  <span className={cn("truncate text-[13px] text-danger", TEXT_SHADOW)}>{error}</span>
                ) : chapter ? (
                  <>
                    <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-white/45" />
                    <span className={cn("truncate text-[13px] text-white/75", TEXT_SHADOW)}>
                      {chapter.title}
                    </span>
                  </>
                ) : null}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
                <SpeedControl
                  rate={rate}
                  options={speedOptions}
                  open={menuOpen}
                  coarse={coarse}
                  boundsRef={stripRef}
                  onOpenChange={setMenuOpen}
                  onSelect={selectRate}
                />
                {fullscreen ? (
                  <FullscreenButton
                    active={fullscreen.active}
                    coarse={coarse}
                    onToggle={toggleFullscreen}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
