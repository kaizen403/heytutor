/**
 * A tab left open across a deploy keeps running the old bundle, and the old
 * bundle builds its own figures in the browser. On 25 Oct 2026 a tab opened
 * before #270 drew the removed concept schematic (three boxes "A, B, C" for a
 * marketing question) a day after production had dropped it, and the server
 * admitted it because the boxes were valid geometry. Every figure fix missed
 * that student.
 *
 * The bundle knows the commit it was built from; the server says which commit
 * it runs. When they differ, the next new lesson reloads into the current
 * bundle first and asks the same question there. Anything uncertain (no
 * identity, no answer from the server, a question too long for the address
 * bar, a reload already tried for this build) teaches on the current page.
 */

export const CLIENT_BUILD_ID = (process.env.NEXT_PUBLIC_HEYTUTOR_BUILD_ID ?? "").trim();
export const STALE_BUILD_CHECK_INTERVAL_MS = 5 * 60_000;
/** Longest encoded question carried through the reload in `?q=`. */
export const MAX_RELOAD_QUESTION_CHARS = 1800;
const RELOAD_MARK_KEY = "heytutor:stale-build-reload";
const COMMIT = /^[0-9a-f]{7,64}$/i;

let serverBuildId: string | null = null;

/** Record the build the server reports. Anything malformed is ignored. */
export function noteServerBuild(value: unknown): void {
  if (typeof value === "string" && COMMIT.test(value.trim())) serverBuildId = value.trim().toLowerCase();
}

export function resetStaleBuildStateForTests(): void {
  serverBuildId = null;
}

/** True only when both builds are known and differ. */
export function isClientBuildStale(clientBuildId: string = CLIENT_BUILD_ID): boolean {
  return Boolean(clientBuildId && serverBuildId && serverBuildId !== clientBuildId.toLowerCase());
}

export async function checkServerBuild(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const response = await fetchImpl("/api/version", { cache: "no-store", signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return;
    const body = await response.json() as { build?: unknown };
    noteServerBuild(body.build);
  } catch {
    // Offline or slow: keep what we knew. An unknown server build never reloads.
  }
}

/** Check now, whenever the tab comes back into view, and every few minutes. */
export function watchServerBuild(clientBuildId: string = CLIENT_BUILD_ID): () => void {
  if (!clientBuildId || typeof window === "undefined") return () => {};
  const check = () => { void checkServerBuild(); };
  const onVisible = () => { if (document.visibilityState === "visible") check(); };
  check();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", check);
  const interval = window.setInterval(check, STALE_BUILD_CHECK_INTERVAL_MS);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", check);
    window.clearInterval(interval);
  };
}

/** Where to reload with the question, or null when it cannot be carried. */
export function staleBuildReloadUrl(location: { pathname: string; search: string }, question: string): string | null {
  const trimmed = question.trim();
  if (!trimmed) return null;
  // Embedded lessons and the admin playground manage their own page.
  if (new URLSearchParams(location.search).get("embed") === "1") return null;
  if (!(location.pathname === "/" || location.pathname.startsWith("/c/"))) return null;
  const encoded = encodeURIComponent(trimmed);
  if (encoded.length > MAX_RELOAD_QUESTION_CHARS) return null;
  return `${location.pathname}?q=${encoded}`;
}

/**
 * Before a new lesson: when this tab runs an older build than the server,
 * reload into the current one with the question and return true. A reload is
 * tried once per server build, so a build that still differs after it teaches
 * here instead of looping.
 */
export function reloadStaleTabForQuestion(question: string, deps: {
  clientBuildId?: string;
  location?: { pathname: string; search: string; assign(url: string): void };
  storage?: Pick<Storage, "getItem" | "setItem">;
} = {}): boolean {
  const clientBuildId = deps.clientBuildId ?? CLIENT_BUILD_ID;
  if (!isClientBuildStale(clientBuildId) || !serverBuildId) return false;
  const location = deps.location ?? (typeof window === "undefined" ? undefined : window.location);
  if (!location) return false;
  const url = staleBuildReloadUrl(location, question);
  if (!url) return false;
  let storage = deps.storage;
  try { storage ??= window.sessionStorage; } catch { return false; }
  try {
    if (storage.getItem(RELOAD_MARK_KEY) === serverBuildId) return false;
    storage.setItem(RELOAD_MARK_KEY, serverBuildId);
  } catch {
    // Without a place to remember the attempt, a reload could repeat: teach here.
    return false;
  }
  location.assign(url);
  return true;
}
