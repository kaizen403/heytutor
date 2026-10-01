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
  /** Production boards return an identity-scoped release; legacy hosts may return void. */
  setSpotlight?: (spec: SpotlightSpec | null) => (() => void) | void;
}

/**
 * Run `body` with the spotlight up, and release this focus's latest installation
 * on every exit path. Re-aim through the supplied scoped host, never the shared
 * host, so cleanup owns the final target as well as the initial union.
 * A late finally cannot remove a successor or a keep-visible committed veil.
 *
 * `body` returns true when it bailed out for cancellation, so the caller can
 * propagate that without a bare `return` skipping the cleanup. The value is
 * passed straight back.
 */
export async function withSpotlight(
  host: SpotlightHost,
  spec: SpotlightSpec | null,
  body: (scope: SpotlightHost) => Promise<boolean>,
): Promise<boolean> {
  let release: (() => void) | undefined;
  const scope: SpotlightHost = {
    setSpotlight: (next) => {
      if (!next) {
        release?.();
        release = undefined;
        return;
      }
      const lease = host.setSpotlight?.(next);
      // Only hosts with the old void contract need a global lower. Never use
      // that fallback for a production lease, even if its root was committed.
      release = typeof lease === "function" ? lease
        : host.setSpotlight ? () => { host.setSpotlight?.(null); } : undefined;
    },
  };
  try {
    if (spec) scope.setSpotlight?.(spec);
    return await body(scope);
  } finally {
    // A null-spec trace owns nothing and must not clear another focus's veil.
    release?.();
  }
}

/**
 * Belt and braces for turn teardown: whatever happened during the turn, the
 * board must not be left dimmed.
 */
export function clearSpotlight(host: SpotlightHost | null | undefined): void {
  host?.setSpotlight?.(null);
}
