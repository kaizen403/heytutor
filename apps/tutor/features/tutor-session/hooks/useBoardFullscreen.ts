"use client";

/**
 * The board taking the whole screen, and the chrome getting out of its way.
 *
 * Everything that decides anything lives in `lib/board/boardFullscreen`; this
 * is the DOM half: the Fullscreen API with its Safari prefix, the fallback for
 * devices that have no Fullscreen API at all, the landscape request on a
 * phone, and the idle timer behind the auto hiding chrome.
 *
 * Full screen is asked of `document.documentElement`, never of the board box.
 * Every drawer, sheet and dialog in the session portals to `document.body`; a
 * full screen taken on an inner element renders only that element's subtree,
 * so settings, the boards drawer and the credits dialog would all open
 * invisibly. Taking the whole document keeps them on screen and costs nothing,
 * because the session already fills the viewport.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  FULLSCREEN_ACTIVITY_THROTTLE_MS,
  FULLSCREEN_CHROME_IDLE_MS,
  FULLSCREEN_DOC_ATTRIBUTE,
  FULLSCREEN_ROTATE_HINT_MS,
  shouldHideSessionChrome,
  shouldLockLandscape,
  shouldOfferRotateHint,
  type FullscreenMode,
} from "../lib/board/boardFullscreen";

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
  unlock?: () => void;
};

export interface BoardFullscreenApi {
  /** The board owns the screen. */
  active: boolean;
  /** How it was obtained, or null when the board is windowed. */
  mode: FullscreenMode | null;
  /** The browser can hide its own chrome. False on an iPhone. */
  nativeAvailable: boolean;
  /** A phone is upright and the device refused to turn itself. */
  rotateHint: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

export interface UseBoardFullscreenOptions {
  /**
   * When false this mount never takes full screen and never writes the
   * document attribute. Headless lecture recorders share the page with admin
   * Watch; they must not steal Watch's full screen or exit it on unmount.
   */
  enabled?: boolean;
}

/** The Fullscreen API is a fixed browser fact, so there is nothing to watch. */
const subscribeToNothing = () => () => {};

function fullscreenDocument(): FullscreenCapableDocument | null {
  return typeof document === "undefined" ? null : (document as FullscreenCapableDocument);
}

function nativeFullscreenElement(): Element | null {
  const doc = fullscreenDocument();
  if (!doc) return null;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Whether this browser will give up its own chrome.
 *
 * `fullscreenEnabled` is false inside an iframe without `allowfullscreen` as
 * well as on iOS, which is exactly right: both cases fall back to the app
 * chrome coming off, and neither should promise more than it can do.
 */
export function nativeFullscreenAvailable(): boolean {
  const doc = fullscreenDocument();
  if (!doc) return false;
  const root = doc.documentElement as FullscreenCapableElement;
  const hasRequest = Boolean(root.requestFullscreen ?? root.webkitRequestFullscreen);
  const enabled = doc.fullscreenEnabled || doc.webkitFullscreenEnabled || false;
  return hasRequest && enabled;
}

function screenShortEdgePx(): number {
  if (typeof window === "undefined") return 0;
  const screen = window.screen;
  if (!screen) return Math.min(window.innerWidth, window.innerHeight);
  return Math.min(screen.width, screen.height);
}

function hasCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

function orientationApi(): LockableOrientation | null {
  if (typeof window === "undefined") return null;
  return (window.screen?.orientation as LockableOrientation | undefined) ?? null;
}

/**
 * Ask the device to turn sideways.
 *
 * Android grants this only while a native full screen is held, which is why it
 * is attempted again the moment the browser confirms one. iOS has no lock at
 * all and rejects immediately, and that rejection is the signal to nudge the
 * student by hand instead.
 */
async function requestLandscape(): Promise<boolean> {
  if (!shouldLockLandscape({ coarsePointer: hasCoarsePointer(), shortEdgePx: screenShortEdgePx() })) {
    return false;
  }
  const orientation = orientationApi();
  if (!orientation?.lock) return false;
  try {
    await orientation.lock("landscape");
    return true;
  } catch {
    return false;
  }
}

function releaseOrientation(): void {
  try {
    orientationApi()?.unlock?.();
  } catch {
    /* never locked, or the device has no lock to give back */
  }
}

export function useBoardFullscreen(
  options?: UseBoardFullscreenOptions,
): BoardFullscreenApi {
  const enabled = options?.enabled !== false;
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<FullscreenMode | null>(null);
  const [rotateHint, setRotateHint] = useState(false);
  const modeRef = useRef<FullscreenMode | null>(null);
  const hintTimerRef = useRef(0);

  // A browser fact, read on the client and never changing after. Through the
  // store rather than an effect so the server and the first paint agree on
  // `false` instead of hydrating into a mismatch.
  const nativeAvailable = useSyncExternalStore(
    subscribeToNothing,
    nativeFullscreenAvailable,
    () => false,
  );

  // Read by the `fullscreenchange` listener, which must not close a fallback
  // full screen just because there is no native element to lose.
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const clearHint = useCallback(() => {
    window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = 0;
    setRotateHint(false);
  }, []);

  const offerRotateHint = useCallback(
    (lockedLandscape: boolean) => {
      window.clearTimeout(hintTimerRef.current);
      const offer = shouldOfferRotateHint({
        fullscreen: true,
        lockedLandscape,
        portrait: window.innerHeight > window.innerWidth,
        shortEdgePx: screenShortEdgePx(),
        coarsePointer: hasCoarsePointer(),
      });
      setRotateHint(offer);
      if (!offer) return;
      hintTimerRef.current = window.setTimeout(() => {
        setRotateHint(false);
      }, FULLSCREEN_ROTATE_HINT_MS);
    },
    [],
  );

  const enter = useCallback(() => {
    if (!enabled) return;
    const doc = fullscreenDocument();
    if (!doc) return;
    // The fallback is claimed first and synchronously: it is what makes the
    // board bigger, it cannot fail, and a browser that grants a native full
    // screen upgrades the mode a tick later through `fullscreenchange`.
    setActive(true);
    setMode((current) => current ?? "fallback");

    const root = doc.documentElement as FullscreenCapableElement;
    const request: ((options?: FullscreenOptions) => Promise<void> | void) | undefined =
      root.requestFullscreen ?? root.webkitRequestFullscreen;
    if (request && nativeFullscreenAvailable()) {
      try {
        // Called straight from the click: moving this behind a promise or a
        // timeout loses the user gesture and the request is refused.
        const result = request.call(root, { navigationUI: "hide" });
        if (result && typeof result.catch === "function") {
          result.catch(() => {
            /* refused; the app chrome has already come off */
          });
        }
      } catch {
        /* refused; the app chrome has already come off */
      }
    }

    void requestLandscape().then(offerRotateHint);
  }, [enabled, offerRotateHint]);

  const exit = useCallback(() => {
    if (!enabled) return;
    const doc = fullscreenDocument();
    clearHint();
    releaseOrientation();
    setActive(false);
    setMode(null);
    if (!doc) return;
    if (doc.fullscreenElement && doc.exitFullscreen) {
      void doc.exitFullscreen().catch(() => {
        /* already out */
      });
      return;
    }
    if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
      try {
        void doc.webkitExitFullscreen();
      } catch {
        /* already out */
      }
    }
  }, [clearHint, enabled]);

  const toggle = useCallback(() => {
    if (active) {
      exit();
      return;
    }
    enter();
  }, [active, enter, exit]);

  // The browser is the other author of this state: Escape, F11, the Android
  // back gesture and a tab switch all end a native full screen without asking.
  useEffect(() => {
    if (!enabled) return undefined;
    const doc = fullscreenDocument();
    if (!doc) return undefined;

    const onChange = () => {
      if (nativeFullscreenElement()) {
        setActive(true);
        setMode("native");
        // Android only grants the orientation lock once full screen is held.
        void requestLandscape().then(offerRotateHint);
        return;
      }
      // A fallback full screen has no native element to lose, so an event that
      // only reports "no element" must not close it.
      if (modeRef.current !== "native") return;
      clearHint();
      releaseOrientation();
      setActive(false);
      setMode(null);
    };

    doc.addEventListener("fullscreenchange", onChange);
    doc.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      doc.removeEventListener("fullscreenchange", onChange);
      doc.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [clearHint, enabled, offerRotateHint]);

  // The nudge is answered by turning the phone, so stop nudging once it turns.
  useEffect(() => {
    if (!rotateHint) return undefined;
    const onResize = () => {
      if (window.innerWidth > window.innerHeight) clearHint();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [clearHint, rotateHint]);

  // One attribute on the document is what the immersive CSS keys off, so the
  // page can stop scrolling and the full screen backdrop can take the board's
  // own background instead of the UA's black. Only the instance that is
  // actually full screen writes it: an idle headless recorder on the same
  // page must not clear Watch's attribute on mount.
  useEffect(() => {
    if (!enabled || !active) return undefined;
    const root = document.documentElement;
    root.setAttribute(FULLSCREEN_DOC_ATTRIBUTE, mode ?? "fallback");
    return () => root.removeAttribute(FULLSCREEN_DOC_ATTRIBUTE);
  }, [active, enabled, mode]);

  // Leaving the page mid lesson must not strand the browser in full screen or
  // the phone in a locked orientation.
  useEffect(() => {
    if (!enabled) return undefined;
    return () => {
      window.clearTimeout(hintTimerRef.current);
      releaseOrientation();
      const doc = fullscreenDocument();
      if (doc?.fullscreenElement && doc.exitFullscreen) {
        void doc.exitFullscreen().catch(() => {
          /* the document is going away anyway */
        });
      }
    };
  }, [enabled]);

  // Stable while nothing changes: the session hangs a window keydown listener
  // off this object, and a fresh identity every render would re-bind it.
  return useMemo(
    () => ({ active, mode, nativeAvailable, rotateHint, enter, exit, toggle }),
    [active, enter, exit, mode, nativeAvailable, rotateHint, toggle],
  );
}

export interface SessionChromeIdleInput {
  fullscreen: boolean;
  /** A lesson, a replay or a rewind is running on the paper. */
  live: boolean;
  /** Something is open or armed that the student is about to act on. */
  pinned: boolean;
}

/**
 * Whether the floating header and composer are currently withdrawn.
 *
 * Stillness is watched for the whole time the board owns the screen, and
 * nothing else: a windowed board installs no listeners and runs no timer.
 * Whether stillness actually hides anything is the policy in
 * `shouldHideSessionChrome`, kept apart from the measuring so that unpinning a
 * drawer or ending a lesson does not have to reach in and reset a timer.
 */
export function useSessionChromeHidden(input: SessionChromeIdleInput): boolean {
  const { fullscreen, live, pinned } = input;
  const [idle, setIdle] = useState(false);
  const lastActivityRef = useRef(0);

  useEffect(() => {
    if (!fullscreen) return undefined;

    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), FULLSCREEN_CHROME_IDLE_MS);
    };
    const onActivity = () => {
      const now = Date.now();
      // One hand movement is hundreds of pointermove events. Re-arming on each
      // of them would rebuild the timeout every frame for no change in meaning.
      if (now - lastActivityRef.current < FULLSCREEN_ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      setIdle(false);
      arm();
    };

    arm();
    const events = ["pointermove", "pointerdown", "touchstart", "keydown", "wheel"] as const;
    for (const event of events) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const event of events) {
        window.removeEventListener(event, onActivity);
      }
    };
  }, [fullscreen]);

  return shouldHideSessionChrome({ fullscreen, live, pinned, idle });
}
