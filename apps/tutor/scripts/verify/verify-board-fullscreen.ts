/**
 * Full screen for the board, on every device.
 *
 * Three things are gated here, because each one has a way of silently going
 * wrong:
 *
 * 1. **Every device gets the option.** An iPhone has no Fullscreen API outside
 *    `<video>`, so the feature cannot be built on the API alone. The fallback
 *    is what makes the promise true, and it must not be reachable only from a
 *    branch that a capable browser takes.
 * 2. **Full screen is taken on the document.** Every drawer, sheet and dialog
 *    in the session portals to `document.body`. A full screen taken on the
 *    board box renders that subtree alone, so settings and the boards drawer
 *    would open invisibly behind it.
 * 3. **Withdrawing the chrome never resizes the board.** The header and the
 *    composer float over the paper's margins. If they took layout instead, the
 *    Konva stage would re-fit on an idle timer, which reads as a reload in the
 *    middle of a lesson.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FULLSCREEN_CHROME_IDLE_MS,
  FULLSCREEN_DOC_ATTRIBUTE,
  LANDSCAPE_LOCK_MAX_SHORT_EDGE_PX,
  fullscreenKeyAction,
  isTypingElement,
  shouldHideSessionChrome,
  shouldLockLandscape,
  shouldOfferRotateHint,
} from "../../features/tutor-session/lib/board/boardFullscreen";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tutorRoot = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(tutorRoot, relative), "utf8");

// ── When the chrome withdraws ───────────────────────────────────────────────

const running = { fullscreen: true, live: true, pinned: false, idle: true };

assert(shouldHideSessionChrome(running), "a still student watching a lesson gets the whole board");
assert(
  !shouldHideSessionChrome({ ...running, idle: false }),
  "the chrome must not vanish under a moving hand",
);
assert(
  !shouldHideSessionChrome({ ...running, fullscreen: false }),
  "a windowed board never hides its own header or composer",
);
assert(
  !shouldHideSessionChrome({ ...running, live: false }),
  "an idle board is waiting to be asked a question, so the composer stays",
);
assert(
  !shouldHideSessionChrome({ ...running, pinned: true }),
  "a paused lecture, an armed marker, an error or an open panel pins the chrome",
);
assert(
  FULLSCREEN_CHROME_IDLE_MS >= 1500 && FULLSCREEN_CHROME_IDLE_MS <= 5000,
  "the idle delay must outlast a hand moving to a control without outlasting patience",
);

// ── Turning the phone ───────────────────────────────────────────────────────

const phone = { coarsePointer: true, shortEdgePx: 390 };

assert(shouldLockLandscape(phone), "a phone is asked for landscape: upright it fits a third of the sheet");
assert(
  !shouldLockLandscape({ ...phone, coarsePointer: false }),
  "a mouse means a window, and a window is never rotated under the student",
);
assert(
  !shouldLockLandscape({ coarsePointer: true, shortEdgePx: LANDSCAPE_LOCK_MAX_SHORT_EDGE_PX + 1 }),
  "a tablet is wide enough either way and keeps the orientation it was held in",
);
assert(
  !shouldLockLandscape({ coarsePointer: true, shortEdgePx: 0 }),
  "an unmeasured screen must not trigger a rotation",
);

assert(
  shouldOfferRotateHint({ ...phone, fullscreen: true, lockedLandscape: false, portrait: true }),
  "a phone that refused the lock is asked by hand instead: that is the iOS path",
);
assert(
  !shouldOfferRotateHint({ ...phone, fullscreen: true, lockedLandscape: true, portrait: true }),
  "where the lock worked the phone is already turning, so there is nothing to ask",
);
assert(
  !shouldOfferRotateHint({ ...phone, fullscreen: true, lockedLandscape: false, portrait: false }),
  "a phone already held sideways must not be nudged",
);
assert(
  !shouldOfferRotateHint({ ...phone, fullscreen: false, lockedLandscape: false, portrait: true }),
  "the nudge belongs to full screen and nowhere else",
);

// ── Keys ────────────────────────────────────────────────────────────────────

const key = {
  withModifier: false,
  typing: false,
  fullscreen: false,
  mode: null,
  dialogOpen: false,
  lessonOwnsEscape: false,
} as const;

assert(fullscreenKeyAction({ ...key, key: "f" }) === "toggle", "f takes the board full screen");
assert(fullscreenKeyAction({ ...key, key: "F" }) === "toggle", "shift does not disarm the shortcut");
assert(
  fullscreenKeyAction({ ...key, key: "f", typing: true }) === null,
  "an f typed into the composer is a letter, not a shortcut",
);
assert(
  fullscreenKeyAction({ ...key, key: "f", withModifier: true }) === null,
  "ctrl-f and cmd-f belong to the browser",
);
assert(
  fullscreenKeyAction({ ...key, key: "Escape", fullscreen: true, mode: "fallback" }) === "exit",
  "a fallback full screen has no browser behind it, so Escape must leave it",
);
assert(
  fullscreenKeyAction({ ...key, key: "Escape", fullscreen: true, mode: "native" }) === null,
  "the browser exits a native full screen on Escape: handling it too would exit twice",
);
assert(
  fullscreenKeyAction({
    ...key,
    key: "Escape",
    fullscreen: true,
    mode: "fallback",
    lessonOwnsEscape: true,
  }) === null,
  "Escape already stops a lesson and leaves a rewind: one key must not do two things",
);
assert(
  fullscreenKeyAction({
    ...key,
    key: "Escape",
    fullscreen: true,
    mode: "fallback",
    dialogOpen: true,
  }) === null,
  "an open drawer owns Escape",
);
assert(
  fullscreenKeyAction({ ...key, key: "Escape" }) === null,
  "Escape outside full screen has nothing to close here",
);

assert(isTypingElement({ tagName: "INPUT" }), "an input swallows plain keys");
assert(isTypingElement({ tagName: "TEXTAREA" }), "the composer is a textarea");
assert(isTypingElement({ tagName: "DIV", isContentEditable: true }), "contenteditable is typing");
assert(!isTypingElement({ tagName: "BUTTON" }), "a focused button is not typing");
assert(!isTypingElement(null), "an unfocused document is not typing");

// ── The hook asks the right element ─────────────────────────────────────────

const hook = read("features/tutor-session/hooks/useBoardFullscreen.ts");
assert(
  /root\s*=\s*doc\.documentElement/.test(hook),
  "full screen must be taken on the document: a board-box full screen hides every portalled drawer",
);
assert(
  hook.includes("webkitRequestFullscreen") && hook.includes("webkitFullscreenElement"),
  "Safari's prefixed Fullscreen API must be handled, or desktop Safari falls back for no reason",
);
assert(
  /setActive\(true\);\s*\n\s*setMode\(\(current\) => current \?\? "fallback"\)/.test(hook),
  "the fallback must be claimed synchronously: it is what a device without the API gets",
);
assert(
  hook.includes('doc.addEventListener("fullscreenchange"'),
  "Escape, F11 and the Android back gesture end a full screen without asking, so the browser is the other author of this state",
);
assert(
  /modeRef\.current !== "native"/.test(hook),
  "a fullscreenchange with no element must not close a fallback full screen, which never had one",
);
assert(
  hook.includes('orientation.lock("landscape")') && hook.includes("unlock"),
  "a phone is asked for landscape on the way in and released on the way out",
);
assert(
  /return\s*\(\)\s*=>\s*\{[^}]*releaseOrientation\(\)/s.test(hook),
  "leaving the page must not strand the browser in full screen or the phone in a locked orientation",
);
assert(
  hook.includes("useSyncExternalStore"),
  "whether the browser has the API must hydrate as false, or the first paint disagrees with the server",
);
assert(
  hook.includes("enabled?: boolean") && /options\?\.enabled !== false/.test(hook),
  "a mount can refuse to take full screen, so a headless recorder cannot steal Watch's",
);
assert(
  /if\s*\(!enabled\)\s*return/.test(hook),
  "a disabled hook must not call requestFullscreen",
);
assert(
  /if\s*\(!enabled \|\| !active\)\s*return undefined/.test(hook),
  "an idle instance must not clear the document attribute another mount just set",
);

// ── The layout ──────────────────────────────────────────────────────────────

const shell = read("features/tutor-session/TutorSessionShell.tsx");
assert(
  shell.includes("useBoardFullscreen") && shell.includes("useSessionChromeHidden"),
  "the session owns the full screen state and the chrome idle timer",
);
assert(
  /sidebarCollapsed=\{boardFullscreen \|\| sidebarCollapsed\}/.test(shell),
  "full screen folds the boards rail by prop, so the board is never unmounted and remounted",
);
assert(
  /overlay=\{boardFullscreen\}/.test(shell) && /chromeHidden=\{chromeHidden\}/.test(shell),
  "the header floats over the paper in full screen rather than being swapped for another component",
);
assert(
  /onToggleFullscreen=\{fullscreen\.toggle\}/.test(shell),
  "the header carries the toggle, so every device has a way in and a way out",
);
assert(
  /\? "wb-session-chrome wb-session-chrome--bottom absolute"/.test(shell),
  "the composer must float over the board in full screen, not take layout and rescale it",
);
assert(
  /keyboardInset > 0\s*\n?\s*\?\s*keyboardInset \+ 6/.test(shell),
  "an absolute composer sits against the padding box, so the keyboard inset has to be added back by hand",
);
assert(
  /marginTop: boardFullscreen \? 0 : PAGE_GUTTER_Y/.test(shell),
  "full screen gives the page gutter back to the paper",
);
assert(
  shell.includes("fullscreen.rotateHint"),
  "the phone that could not be turned automatically must be asked",
);
assert(
  /useBoardFullscreen\(\{\s*enabled:\s*!isHeadless && !boardFullscreenApi/.test(shell),
  "headless recording must not take full screen — Watch hosts it on the overlay instead",
);
assert(
  shell.includes("boardFullscreenApi"),
  "a host can own full screen so admin Watch immerses the panel without drawing the app header",
);
assert(
  /can\.appChrome \|\| Boolean\(boardFullscreenApi\)/.test(shell),
  "a panel with a host full screen still floats the composer instead of rescaling the paper",
);

const watch = read("features/admin/components/WatchDrawer.tsx");
assert(
  watch.includes("useBoardFullscreen") && watch.includes("useSessionChromeHidden"),
  "admin Watch must reuse the tutor full screen hook rather than fork a second one",
);
assert(
  watch.includes("Full screen board") && watch.includes("Leave full screen"),
  "admin Watch must offer the same toggle the student header does",
);
assert(
  watch.includes("boardFullscreenApi={fullscreen}"),
  "admin Watch must hand the hook to the panel so the composer floats",
);
assert(
  watch.includes("fullscreenKeyAction"),
  "admin Watch must bind f the way the student session does",
);
assert(
  !watch.includes('variant="headless"'),
  "Watch must not mount the recording runtime — live still promotes the playground's headless shell",
);

const header = read("features/tutor-session/components/SessionHeader.tsx");
assert(
  header.includes("Full screen board") && header.includes("Leave full screen"),
  "the toggle must say which way it goes",
);
assert(
  /data-hidden=\{overlay && chromeHidden \? "true" : undefined\}/.test(header),
  "the floating header withdraws by attribute, so nothing inside it unmounts",
);
assert(
  /position:\s*"absolute"|absolute rounded-2xl/.test(header),
  "the overlay header must be out of flow, or hiding it would resize the board under a running lesson",
);

const css = read("app/globals.css");
assert(
  css.includes(`html[${FULLSCREEN_DOC_ATTRIBUTE}]`),
  "the immersive layout keys off one attribute on the document, set for both the native and the fallback path",
);
assert(
  /html:fullscreen[^{]*\{[^}]*background:/s.test(css),
  "the UA paints a fullscreen root black: the board's own ground must cover it so an exit does not flash",
);
const chromeRule = /\.wb-session-chrome\[data-hidden="true"\]\s*\{([^}]*)\}/.exec(css);
assert(chromeRule, "the withdrawn chrome needs a rule");
assert(
  chromeRule[1]!.includes("opacity") && chromeRule[1]!.includes("pointer-events"),
  "withdrawing is opacity plus pointer-events",
);
assert(
  !/display:\s*none/.test(chromeRule[1]!),
  "display:none would unmount the composer's typed draft and re-run its entry animation on every reveal",
);

const viewport = read("features/tutor-session/hooks/useBoardViewport.ts");
assert(
  viewport.includes("ResizeObserver"),
  "full screen is a container measurement change: the fit must come from the observer, not from a full screen branch",
);
assert(
  !viewport.includes("fullscreen"),
  "the scale fit must stay ignorant of full screen, or it grows a second way to size the board",
);

console.log(
  "verify-board-fullscreen: every device gets full screen, the document is what goes full screen, and withdrawing the chrome never resizes the board",
);
