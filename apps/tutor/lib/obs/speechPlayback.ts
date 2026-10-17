import type { FirstAudibleSignal } from "./turnTelemetry";

export const SPEECH_PLAYBACK_SCHEMA = "speech-playback/v1" as const;
export const SPEECH_PLAYBACK_EVENT_NAMES = ["speech-playback-start", "speech-playback-end"] as const;
export type SpeechPlaybackOutcome = "complete" | "failed" | "cancelled";
export type SpeechPlaybackEndSignal = "on-end" | "speech-promise" | "abandoned";
interface SpeechPlaybackStart {
  transport: "provider" | "browser";
  signal: FirstAudibleSignal;
  leadMs: number;
  muted: boolean;
}
interface PlaybackTelemetry {
  durationMs(): number;
  mark(name: string, metadata?: Record<string, unknown>): void;
}

/** Closed wire schema for these two event names only. No free-form strings. */
export function sanitizeSpeechPlaybackMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (input.speech_trace_schema === SPEECH_PLAYBACK_SCHEMA) safe.speech_trace_schema = SPEECH_PLAYBACK_SCHEMA;
  for (const [key, allowed] of [
    ["transport", ["provider", "browser"]],
    ["signal", ["html-audio-playing", "audio-context-scheduled", "speech-synthesis-start", "unknown"]],
    ["outcome", ["complete", "failed", "cancelled"]],
    ["end_signal", ["on-end", "speech-promise", "abandoned"]],
  ] as const) {
    if (allowed.some((item) => item === input[key])) safe[key] = input[key];
  }
  for (const [key, max] of [
    ["segment_index", 100_000], ["playback_index", 100_000], ["scheduled_lead_ms", 60_000], ["since_ask_ms", 3_600_000],
  ] as const) {
    const item = input[key];
    if (typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= max) safe[key] = item;
  }
  if (typeof input.muted === "boolean") safe.muted = input.muted;
  return safe;
}

/** A missing interval invalidates exact silence claims, even if pairs look whole. */
export function sanitizeSpeechPlaybackTraceMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ["speech_playback_total_events", "speech_playback_dropped_events", "speech_playback_pending_events"] as const) {
    const count = input[key];
    if (typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 10_000_000) safe[key] = count;
  }
  return safe;
}

/** One accepted voice interval, never the surrounding speech-plus-ink span. */
export function createSpeechPlaybackTracker(input: {
  telemetry: PlaybackTelemetry | null | undefined;
  segmentIndex: number;
  isCurrent(): boolean;
}) {
  let sequence = 0;
  let active: Record<string, unknown> | null = null;
  const elapsed = (): number | null => {
    try {
      if (!input.isCurrent() || !input.telemetry) return null;
      const value = Math.round(input.telemetry.durationMs());
      return Number.isFinite(value) && value >= 0 && value <= 3_600_000 ? value : null;
    } catch { return null; }
  };
  const publish = (name: (typeof SPEECH_PLAYBACK_EVENT_NAMES)[number], metadata: Record<string, unknown>) => {
    try { if (input.isCurrent()) input.telemetry?.mark(name, sanitizeSpeechPlaybackMetadata(metadata)); } catch { /* Diagnostics never interrupt teaching. */ }
  };
  const end = (outcome: SpeechPlaybackOutcome, endSignal: SpeechPlaybackEndSignal) => {
    if (!active) return;
    const metadata = active;
    active = null;
    const at = elapsed();
    if (at !== null) publish("speech-playback-end", { ...metadata, since_ask_ms: at, outcome, end_signal: endSignal });
  };
  return {
    start(info: SpeechPlaybackStart) {
      if (active) return;
      const at = elapsed();
      if (at === null) return;
      const leadMs = Number.isFinite(info.leadMs) ? Math.max(0, Math.round(info.leadMs)) : 0;
      active = {
        speech_trace_schema: SPEECH_PLAYBACK_SCHEMA, segment_index: input.segmentIndex,
        playback_index: ++sequence, transport: info.transport, signal: info.signal,
        scheduled_lead_ms: leadMs, muted: info.muted,
      };
      publish("speech-playback-start", { ...active, since_ask_ms: at + leadMs });
    },
    end,
    // Pause is an observed interruption, not a completed sentence. Resume
    // cannot reopen this interval; only another accepted onStart may do so.
    pause() { end("cancelled", "abandoned"); },
  };
}
