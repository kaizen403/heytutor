/** Display formatting for the admin panel. Counts compact, times relative, money from millicents. */

export function formatCount(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value / 1000)}k`;
}

export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const elapsed = Math.max(0, nowMs - then);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatUtcDate(iso.slice(0, 10));
}

/** "2026-09-12" → "Sep 12" (UTC, matching the chart buckets). */
export function formatUtcDate(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return day;
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Billing keeps USD as millicents (1/1000 of a cent). */
export function formatMillicentsUsd(millicents: number): string {
  const usd = millicents / 100_000;
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
