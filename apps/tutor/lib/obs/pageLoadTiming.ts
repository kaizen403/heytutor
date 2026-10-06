/**
 * Page load timing, on its own clock.
 *
 * Every value here counts from the document's navigation start
 * (`performance.timeOrigin`), never from an Ask click, so page load cost and
 * Ask to first voice are never added together. They ride on the first turn of
 * the page as `page_*` trace metadata, plus `ask_since_nav_ms`: how long the
 * student had the page before asking.
 */

/** The slice of `Performance` this module reads; the verify script fakes it. */
export interface PageLoadPerformance {
  now(): number;
  getEntriesByType?(type: string): ReadonlyArray<unknown>;
}

export interface PageLoadTimingMeta extends Record<string, unknown> {
  page_nav_type: string | null;
  page_response_start_ms: number | null;
  page_dom_content_loaded_ms: number | null;
  page_load_ms: number | null;
  page_board_ready_ms: number | null;
  ask_since_nav_ms: number;
}

export interface PageLoadTiming {
  /** The session shell's board finished loading. Only the first call counts. */
  markBoardReady(): void;
  /** Page fields for the page's first turn; null for every later turn. */
  claimFirstTurnMeta(askStartedAt: number): PageLoadTimingMeta | null;
}

function finiteMs(value: unknown): number | null {
  // Navigation Timing reports 0 for a phase that has not happened yet.
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

export function createPageLoadTiming(perf: PageLoadPerformance | null): PageLoadTiming {
  let boardReadyMs: number | null = null;
  let claimed = false;

  return {
    markBoardReady() {
      if (boardReadyMs !== null || !perf) return;
      try {
        boardReadyMs = Math.round(perf.now());
      } catch {
        // Telemetry never throws into the page.
      }
    },

    claimFirstTurnMeta(askStartedAt) {
      if (claimed || !perf) return null;
      claimed = true;
      try {
        const entry = perf.getEntriesByType?.("navigation")?.[0] as
          | {
              type?: unknown;
              responseStart?: unknown;
              domContentLoadedEventEnd?: unknown;
              loadEventEnd?: unknown;
            }
          | undefined;
        return {
          page_nav_type: typeof entry?.type === "string" ? entry.type : null,
          page_response_start_ms: finiteMs(entry?.responseStart),
          page_dom_content_loaded_ms: finiteMs(entry?.domContentLoadedEventEnd),
          page_load_ms: finiteMs(entry?.loadEventEnd),
          page_board_ready_ms: boardReadyMs,
          ask_since_nav_ms: Math.max(0, Math.round(askStartedAt)),
        };
      } catch {
        return null;
      }
    },
  };
}

/** One per document: a client side board switch keeps the same page clock. */
export const pageLoadTiming = createPageLoadTiming(
  typeof performance !== "undefined" ? performance : null,
);
