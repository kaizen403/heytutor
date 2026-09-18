/**
 * The paper must sit inside the metal frame, not in its ring or in the
 * session chrome. Scale, box, and `--bezel` are one geometry.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOARD_BEZEL_DESKTOP_PX,
  BOARD_BEZEL_MOBILE_PX,
  BOARD_FRAME_KEYBOARD_INSET_PX,
  BOARD_FRAME_MOBILE_MQ,
  boardFramePaddingPx,
  shouldLockBoardScale,
} from "../../features/tutor-session/lib/board/boardFrame";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tutorRoot = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(tutorRoot, relative), "utf8");

assert(boardFramePaddingPx(false) === BOARD_BEZEL_DESKTOP_PX * 2);
assert(boardFramePaddingPx(true) === BOARD_BEZEL_MOBILE_PX * 2);
assert(BOARD_FRAME_MOBILE_MQ === "(max-width: 640px)");

assert(
  shouldLockBoardScale({ widthDelta: 0, heightDelta: 2, keyboardInset: 0 }),
  "sub-pixel height jitter must not rescale the board",
);
assert(
  !shouldLockBoardScale({ widthDelta: 24, heightDelta: 0, keyboardInset: 0 }),
  "a sidebar or rotation must be allowed to refit",
);
assert(
  !shouldLockBoardScale({ widthDelta: 0, heightDelta: -72, keyboardInset: 0 }),
  "the composer docking under the board must refit, not keep the landing scale",
);
assert(
  shouldLockBoardScale({
    widthDelta: 0,
    heightDelta: -280,
    keyboardInset: BOARD_FRAME_KEYBOARD_INSET_PX,
  }),
  "the on-screen keyboard must not rescale a live lecture",
);

const css = read("app/globals.css");
assert(
  css.includes(`--bezel: ${BOARD_BEZEL_DESKTOP_PX}px`),
  "desktop --bezel must match BOARD_BEZEL_DESKTOP_PX",
);
assert(
  css.includes(`--bezel: ${BOARD_BEZEL_MOBILE_PX}px`),
  "mobile --bezel must match BOARD_BEZEL_MOBILE_PX",
);
assert(
  css.includes("@media (max-width: 640px)"),
  "the bezel breakpoint must be 640px, the same query the scale fit uses",
);
assert(
  /width:\s*calc\(\s*var\(--board-w\)\s*\+\s*2\s*\*\s*var\(--bezel\)\s*\)/.test(css),
  "the frame box must be the scaled board plus the CSS bezel, not a JS pad on another breakpoint",
);
assert(
  /\.wb-surface\s*\{[^}]*overflow:\s*hidden/s.test(css) &&
    /\.wb-surface\s*\{[^}]*isolation:\s*isolate/s.test(css),
  "the paper must clip the scaled Konva canvas to its own radius",
);

const shell = read("features/tutor-session/TutorSessionShell.tsx");
assert(
  !/framePad\s*=\s*isCompactNav/.test(shell),
  "compact-nav (1023px) must not size the board frame — that pad is 12px short of the 16px bezel",
);
assert(
  shell.includes("--board-w") && shell.includes("--board-h"),
  "the shell must publish the scaled board size as CSS variables the frame consumes",
);

const viewport = read("features/tutor-session/hooks/useBoardViewport.ts");
assert(
  viewport.includes("boardFramePaddingPx") && viewport.includes("BOARD_FRAME_MOBILE_MQ"),
  "the scale fit must use the same bezel padding and breakpoint as the frame paint",
);
assert(
  viewport.includes("shouldLockBoardScale"),
  "height lock must distinguish the keyboard from the composer taking layout space",
);

const canvas = read("features/tutor-session/components/SessionBoardCanvas.tsx");
assert(
  /overflow:\s*"hidden"/.test(canvas) || canvas.includes('overflow-hidden'),
  "the scaled board box must clip so paper cannot paint through the bezel",
);

const whiteboard = read(resolve(tutorRoot, "../../packages/whiteboard/src/Whiteboard.tsx"));
assert(
  /display:\s*"block"/.test(whiteboard),
  "the Konva stage must be block-level so the inline canvas gap cannot spill into the bezel",
);

console.log("verify-board-frame: bezel, scale fit, and paper clip stay one geometry");
