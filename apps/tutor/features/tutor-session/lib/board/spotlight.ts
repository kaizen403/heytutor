/**
 * Spotlight lifecycle.
 *
 * A spotlight dims the whole diagram zone except one hole. That is a fine way
 * to point at a cell and a terrible thing to leave behind: the figure sits
 * under a grey wash and the lesson looks like it froze, which is exactly what
 * the owner saw on a bubble-sort turn — array drawn, one cell lit, everything
 * else greyed, nothing further happening while the voice carried on.
 *
 * The cause was an early `return` for cancellation sitting between "set the
 * veil" and "clear the veil". Rather than fix that one path and leave the same
 * shape available to the next one, the veil is only ever set through here, so
 * clearing it is not something a caller can forget.
 */

export interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpotlightSpec {
  veil: SpotlightRect;
  hole: SpotlightRect;
  opacity: number;
}

export interface SpotlightHost {
  setSpotlight?: (spec: SpotlightSpec | null) => void;
}

/**
 * Run `body` with the spotlight up, and take it down on every exit path —
 * normal completion, an early cancel, or a throw.
 *
 * `body` returns true when it bailed out for cancellation, so the caller can
 * propagate that without a bare `return` skipping the cleanup. The value is
 * passed straight back.
 */
export async function withSpotlight(
  host: SpotlightHost,
  spec: SpotlightSpec | null,
  body: () => Promise<boolean>,
): Promise<boolean> {
  // A null spec means this focus does not dim anything (pulse, trace). The
  // teardown still runs, which is harmless and keeps every focus path shaped
  // the same way.
  if (spec) host.setSpotlight?.(spec);
  try {
    return await body();
  } finally {
    host.setSpotlight?.(null);
  }
}

/**
 * Belt and braces for turn teardown: whatever happened during the turn, the
 * board must not be left dimmed.
 */
export function clearSpotlight(host: SpotlightHost | null | undefined): void {
  host?.setSpotlight?.(null);
}
