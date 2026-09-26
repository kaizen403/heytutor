/**
 * The dark bezel around the paper. CSS `--bezel` on `.wb-frame` / `.wb-stage`
 * must stay on this breakpoint and these pixel values: the scale fit, the
 * frame box, and the surface inset are the same number, or the cream paper
 * paints into the metal ring (and then into the header and composer).
 */
export const BOARD_FRAME_MOBILE_MQ = "(max-width: 640px)";
export const BOARD_BEZEL_DESKTOP_PX = 16;
export const BOARD_BEZEL_MOBILE_PX = 10;

/** Width change below this is measurement noise, not a rotation or sidebar. */
const BOARD_FRAME_WIDTH_LOCK_PX = 8;
/** Sub-pixel / URL-bar jitter. Larger drops are real layout (footer, deck). */
const BOARD_FRAME_HEIGHT_JITTER_PX = 8;
/**
 * Visual-viewport inset that means the on-screen keyboard owns a height drop.
 * Smaller insets are browser chrome; a layout footer is not this.
 */
export const BOARD_FRAME_KEYBOARD_INSET_PX = 80;

function boardBezelPx(isMobile: boolean): number {
  return isMobile ? BOARD_BEZEL_MOBILE_PX : BOARD_BEZEL_DESKTOP_PX;
}

/** Total padding the fitted board must leave for the bezel (both sides). */
export function boardFramePaddingPx(isMobile: boolean): number {
  return boardBezelPx(isMobile) * 2;
}

/**
 * Whether a container resize should keep the current Konva scale.
 *
 * Keyboard and tiny height wobble must not rescale a live lecture. A real
 * layout shrink — the composer docking under the board when a lesson starts —
 * must refit, or the paper keeps the empty-landing size and runs into the bar.
 */
export function shouldLockBoardScale(input: {
  widthDelta: number;
  heightDelta: number;
  keyboardInset: number;
}): boolean {
  if (Math.abs(input.widthDelta) >= BOARD_FRAME_WIDTH_LOCK_PX) return false;
  if (Math.abs(input.heightDelta) < BOARD_FRAME_HEIGHT_JITTER_PX) return true;
  return input.heightDelta < 0 && input.keyboardInset >= BOARD_FRAME_KEYBOARD_INSET_PX;
}
