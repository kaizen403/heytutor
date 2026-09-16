/**
 * Phone chrome: the pending clicker stays small on frosted paper, the
 * composer lifts above the keyboard instead of rescaling the board, and
 * pull-to-refresh cannot reload a live lecture.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tutorRoot = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(tutorRoot, relative), "utf8");

const overlay = read("features/tutor-session/components/ThinkingOverlay.tsx");
assert(overlay.includes("PenSpinner"), "the pending overlay must be the clicker pen");
assert(
  /size=\{48\}/.test(overlay),
  "the centered pending clicker must be 48px, not a board-filling 88px",
);
assert(
  /size=\{32\}/.test(overlay),
  "the doubt clicker must stay a small mark beside the rings",
);
assert(overlay.includes("trail={false}"), "the pending clicker must not trail ink");
assert(overlay.includes("smear={false}"), "the pending clicker must not smear a second shadow");
assert(overlay.includes("wb-pending"), "the centered overlay keeps the frosted pending class");

const css = read("app/globals.css");
assert(
  /overscroll-behavior:\s*none/.test(css),
  "html/body must disable pull-to-refresh so a swipe cannot reload the lecture",
);
assert(
  css.includes("backdrop-filter: blur(14px)") || css.includes("-webkit-backdrop-filter: blur(14px)"),
  "the pending overlay must frost the board, not paint a second opaque sheet",
);
assert(
  !/\.wb-pending\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*var\(--wb-paper\)/.test(css),
  "the pending overlay must not cover the board in solid paper",
);

const shell = read("features/tutor-session/TutorSessionShell.tsx");
assert(
  shell.includes("useVisualViewportInset"),
  "the session must lift the composer by the visual-viewport inset (the keyboard)",
);
assert(
  shell.includes("compact={isMobile}"),
  "the in-session composer must use compact controls on a phone",
);
assert(
  /paddingBottom:\s*keyboardInset/.test(shell),
  "keyboard inset must pad the session, not rescale the board",
);

const inset = read("lib/client/useVisualViewportInset.ts");
assert(
  inset.includes("visualViewport"),
  "keyboard inset is the layout viewport minus the visual viewport",
);
assert(
  /useSyncExternalStore/.test(inset),
  "keyboard inset must hydrate as 0 so SSR markup stays stable",
);

const scrollLock = read("lib/client/useLockWindowScrollOnFocus.ts");
assert(
  scrollLock.includes("scrollTo(0, 0)"),
  "focusing the composer must not let iOS pan the lecture off-screen",
);
assert(
  shell.includes("useLockWindowScrollOnFocus"),
  "the session must snap iOS focus-scroll so a doubt does not look like a reload",
);

const viewportHook = read("features/tutor-session/hooks/useBoardViewport.ts");
assert(
  /prev\.measured/.test(viewportHook),
  "once the board has a scale, chrome/keyboard height wobble must not rescale it",
);

const boardSession = read("features/tutor-session/hooks/useBoardSession.ts");
assert(
  /history\.replaceState\(window\.history\.state/.test(boardSession),
  "claiming /c/{id} must keep Next's history state — null state desyncs the router and remounts the lecture",
);
assert(
  !/history\.replaceState\(null/.test(boardSession),
  "replaceState must not pass a null history state",
);

const layout = read("app/layout.tsx");
assert(
  /interactiveWidget:\s*"resizes-visual"/.test(layout),
  "the keyboard must resize the visual viewport only, so the board layout stays put",
);

const whiteboard = read(
  resolve(tutorRoot, "../../packages/whiteboard/src/Whiteboard.tsx"),
);
assert(
  /pixelRatio/.test(whiteboard) && /Math\.min/.test(whiteboard),
  "Konva must cap devicePixelRatio so a 3x phone cannot allocate a tab-killing backing store",
);

const sheet = read("components/ui/sheet.tsx");
assert(
  sheet.includes("safe-area-inset-top") || sheet.includes("safe-area-inset-bottom"),
  "drawers must clear the notch and home indicator",
);

const appShell = read("features/app-shell/AppShell.tsx");
assert(
  /variant === "account"/.test(appShell) || appShell.includes("Open navigation"),
  "account pages must expose the boards drawer on a phone",
);

console.log("verify-mobile-session: phone overlay, keyboard inset, and lecture-stability gates passed");
