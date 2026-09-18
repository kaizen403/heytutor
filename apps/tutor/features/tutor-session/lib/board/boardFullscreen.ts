/**
 * Full screen for the board.
 *
 * Two things live here, and only the decisions, never the DOM:
 *
 * 1. **Which full screen the device can give.** Desktop Chrome, Firefox, Edge
 *    and Safari all have the Fullscreen API. An iPhone does not: Safari on iOS
 *    exposes it for `<video>` only, so `requestFullscreen` is missing from
 *    every element. That device still gets full screen, as a fallback: the
 *    session drops its sidebar, header and composer out of the layout and the
 *    paper takes the whole viewport. The only thing the fallback cannot do is
 *    hide the browser's own toolbar.
 *
 * 2. **When the chrome gets out of the way.** Once the board owns the screen
 *    the header and composer float over the paper's own top and bottom
 *    margins instead of taking layout from it, so nothing rescales when they
 *    come and go. They hide while a lesson is actually running and the student
 *    has been still, the way a video player's controls do, and they come
 *    straight back on any movement. They never hide while the student has
 *    something to act on: a paused lecture, an armed marker, an error, an open
 *    panel, or simply an idle board waiting for the next question.
 *
 * The board is CSS scaled from a fixed 1200x700 stage, so full screen is a
 * container measurement change and nothing else. `useBoardViewport` refits
 * from its ResizeObserver, and every pointer path on the board reads
 * `getBoundingClientRect`, so no coordinate maths changes with the scale.
 */

/** Marks the document while the board owns the screen. Value is the mode. */
export const FULLSCREEN_DOC_ATTRIBUTE = "data-board-fullscreen";

/**
 * How still the student must be before the chrome withdraws.
 *
 * Long enough that it does not flinch away while the hand is still moving to a
 * control, short enough that a lesson watched hands off clears within a breath.
 */
export const FULLSCREEN_CHROME_IDLE_MS = 2600;

/** Pointer noise below this is one continuous movement, not new activity. */
export const FULLSCREEN_ACTIVITY_THROTTLE_MS = 180;

/** How long the "turn your phone" nudge stays up before it fades itself. */
export const FULLSCREEN_ROTATE_HINT_MS = 4200;

/**
 * Shortest screen edge that still counts as a phone.
 *
 * The board is a 12:7 landscape sheet. Held upright a phone fits it at about a
 * third of the screen, which is smaller than the windowed board it replaced,
 * so entering full screen there asks for landscape. A tablet or a laptop is
 * wide enough either way and is never rotated under the student.
 */
export const LANDSCAPE_LOCK_MAX_SHORT_EDGE_PX = 820;

/**
 * How full screen was actually obtained.
 *
 * `native` means the browser gave up its own chrome. `fallback` means only the
 * app's chrome went, because the device has no Fullscreen API. The difference
 * matters for Escape: the browser already owns that key in a native full
 * screen and exits on its own, so the app must not also handle it.
 */
export type FullscreenMode = "native" | "fallback";

export interface SessionChromeInput {
  /** The board owns the screen. */
  fullscreen: boolean;
  /** A lesson, a replay or a rewind is running on the paper right now. */
  live: boolean;
  /** The student has something open or armed that the chrome must not take away. */
  pinned: boolean;
  /** No pointer, touch or key for `FULLSCREEN_CHROME_IDLE_MS`. */
  idle: boolean;
}

/**
 * Whether the header and composer withdraw.
 *
 * Only ever inside full screen, and only while something is playing. An idle
 * board is a board waiting to be asked a question, and the composer is the
 * answer to that, so it stays.
 */
export function shouldHideSessionChrome(input: SessionChromeInput): boolean {
  if (!input.fullscreen) return false;
  if (!input.live) return false;
  if (input.pinned) return false;
  return input.idle;
}

export interface LandscapeLockInput {
  /** A finger rather than a mouse. */
  coarsePointer: boolean;
  /** The shortest edge of the screen itself, not of the current orientation. */
  shortEdgePx: number;
}

/** Whether entering full screen should ask the device for landscape. */
export function shouldLockLandscape(input: LandscapeLockInput): boolean {
  if (!input.coarsePointer) return false;
  if (!Number.isFinite(input.shortEdgePx) || input.shortEdgePx <= 0) return false;
  return input.shortEdgePx <= LANDSCAPE_LOCK_MAX_SHORT_EDGE_PX;
}

export interface RotateHintInput {
  fullscreen: boolean;
  /** The orientation lock was accepted, so the device has already turned. */
  lockedLandscape: boolean;
  /** The viewport is taller than it is wide. */
  portrait: boolean;
  shortEdgePx: number;
  coarsePointer: boolean;
}

/**
 * Whether to nudge the student to turn the phone.
 *
 * This is the iOS path and nothing else. Where the lock worked the device is
 * already sideways, and where the screen is wide the board is fine upright.
 */
export function shouldOfferRotateHint(input: RotateHintInput): boolean {
  if (!input.fullscreen) return false;
  if (input.lockedLandscape) return false;
  if (!input.portrait) return false;
  return shouldLockLandscape(input);
}

export interface FullscreenKeyInput {
  key: string;
  /** Ctrl, Meta or Alt is down, so the key belongs to the browser or the OS. */
  withModifier: boolean;
  /** Focus is in a text field, so every key is text. */
  typing: boolean;
  fullscreen: boolean;
  mode: FullscreenMode | null;
  /** A drawer or dialog is open and owns Escape. */
  dialogOpen: boolean;
  /** A running lesson or a rewind already binds Escape to stop and to go live. */
  lessonOwnsEscape: boolean;
}

/**
 * What a keystroke does to full screen.
 *
 * `f` toggles, the way every video player binds it.
 *
 * Escape is deliberately narrow. A native full screen is the browser's to
 * leave: the UA exits on Escape and does not forward the key, so handling it
 * would exit twice. What is left is the fallback, where Escape is already
 * spoken for by the session itself (stop the lesson, leave a rewind, close a
 * drawer). One key must not do two things, so it only leaves full screen when
 * nothing else is listening for it.
 */
export function fullscreenKeyAction(
  input: FullscreenKeyInput,
): "toggle" | "exit" | null {
  if (input.withModifier) return null;
  if (input.typing) return null;
  if (input.key === "Escape") {
    if (!input.fullscreen) return null;
    if (input.mode === "native") return null;
    if (input.dialogOpen) return null;
    if (input.lessonOwnsEscape) return null;
    return "exit";
  }
  if (input.key === "f" || input.key === "F") return "toggle";
  return null;
}

/** Whether the focused element swallows plain keys as text. */
export function isTypingElement(
  element: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = (element.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
