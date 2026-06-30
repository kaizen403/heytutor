# Langfuse Trace Analysis — Sync/Timing Issues (2026-06-30)

Analysis of the last 5 `tutor-turn` traces. Focus: the 2 most recent full physics lessons (charged beads on hoop, ellipse tangents). Session `5343e6f6-4818-4f57-9068-0d42d213a1c9`.

## Trace IDs (most recent first)

| # | Trace ID | Topic | LLM segments | TTS gens | Trace latency | Client telemetry |
|---|----------|-------|-------------|----------|---------------|------------------|
| 1 | `d9459f35-b568-49e0-b355-9e4873b772e3` | Charged beads / θ on circular hoop | 30 | 11 | 91.1s | **Missing** |
| 2 | `7cfaf8b9-176a-4a13-b7d9-600733177f51` | Ellipse tangents | 24 | 9 | 81.0s | **Missing** |
| 3 | `45166786-…` | Box friction (retry) | 23 | 0 | 11.0s | Missing — LLM-only abort |
| 4 | `75541eca-9392-417d-8ad9-3993a609068b` | Box friction | 24 | 4 | 216.3s | Missing — severe early stop |
| 5 | `f9af49f9-2237-40f7-9bb2-174ab5ab2b87` | Box friction | 22 | 0 | 9.5s | Missing — LLM-only abort |

**Comparison baseline** (healthy client telemetry, Jun 27): `6b9f2174-fb7b-442e-81b2-f5da69d18694` — 152 client spans, `segment_count`/`total_draw_ms` in metadata, but no server `tts-segment` gens (older instrumentation).

---

## Critical cross-cutting finding: client telemetry never landed

Both target traces contain **only** `fireworks-llm` + `tts-segment` observations. Zero client spans:

- No `thinking`, `websocket-connect`, `segment-N`, `draw-N`
- No `tts-start`, `tts-timing-validation`, `write-char-start`, `write-schedule-ready`, `draw-complete`

Trace metadata also lacks client fields (`segment_count`, `total_duration_ms`, `total_tts_chars`, `cancelled`). Baseline trace has all of these.

**Implication:** `/api/trace/event` beacon flush (`turnTelemetry.flush()` in `page.tsx` finally block) did not persist for session `5343e6f6…`. Cannot diagnose per-segment sync lag, timing validation, or draw-without-tts-start from these traces. Fix telemetry delivery before relying on Langfuse for sync debugging.

---

## Turn 1 — `d9459f35-b568-49e0-b355-9e4873b772e3`

**Question:** JEE charged-bead small-oscillation on circular hoop (θ, Coulomb, ω²).

### Counts

| Metric | Value |
|--------|-------|
| LLM segments (`[STEP]`) | 30 |
| Server `tts-segment` gens | 11 (10 ws, 1 http) |
| TTS reached through segment | ~10 (0-indexed) |
| Segments with no TTS | 11–29 (**19 segments**, ~63%) |

### Timeline (server-side)

```
17:55:26  fireworks-llm start
17:55:49  LLM end (22.0s) → TTS begins
17:55:49  tts[0]  ws   25ch
17:55:52  tts[1]  ws  175ch   (+2.9s)
17:55:56  tts[2]  ws   76ch   (+3.2s)
17:55:59  tts[3]  ws  172ch   (+3.7s)
17:56:03  tts[4]  ws   64ch   (+3.3s)
17:56:07  tts[5]  ws  113ch   (+4.7s)
17:56:13  tts[6]  ws  122ch   (+5.5s)
17:56:19  tts[7]  ws  317ch   (+6.5s)   ← long narration
17:56:40  tts[8]  ws  216ch   (+21.1s)  ← STALL #1
17:56:43  tts[9]  http 216ch  (+2.1s, latency_ms=738) ← ws→http fallback, duplicate chars
17:56:58  tts[10] ws  180ch   (+15.5s)  ← STALL #2, then TTS stops
17:57:04  trace updated (~5s after last TTS)
```

Normal inter-segment gaps early: 2.9–6.5s. Late gaps explode to **21s** and **15.5s**.

### Failure points

| Symptom | Likely segment | Evidence |
|---------|----------------|----------|
| **Mid-lesson stall** | ~7→8 (317ch narration) | 21.1s gap before next `tts-segment`; segment 7 is the long geometry derivation |
| **Voice transport glitch** | ~8→9 | Identical 216ch on ws then http; http latency 738ms suggests ws failure + retry |
| **Voice skip (silent finish)** | 11–29 | No further `tts-segment` after index 10; turn ends 5s later with 19 segments never spoken |
| **Draw/sync unknown** | all | Client telemetry absent — cannot confirm draw-without-tts-start or timing validation |

---

## Turn 2 — `7cfaf8b9-176a-4a13-b7d9-600733177f51`

**Question:** Ellipse x²/9 + y²/4 = 1, tangents from exterior point S, locus of midpoint.

### Counts

| Metric | Value |
|--------|-------|
| LLM segments | 24 |
| Server `tts-segment` gens | 9 (all ws) |
| TTS reached through segment | ~8 |
| Segments with no TTS | 9–23 (**15 segments**, ~63%) |

### Timeline (server-side)

```
17:52:56  fireworks-llm start
17:53:33  LLM end (37.5s) → TTS begins
17:53:34  tts[0]  ws   24ch
17:53:36  tts[1]  ws  190ch   (+2.8s)
17:53:39  tts[2]  ws  166ch   (+2.8s)
17:53:42  tts[3]  ws  157ch   (+3.3s)
17:53:46  tts[4]  ws   72ch   (+3.5s)
17:53:50  tts[5]  ws  157ch   (+3.7s)
17:54:01  tts[6]  ws  129ch   (+11.3s)  ← STALL #1
17:54:12  tts[7]  ws  136ch   (+10.9s)  ← STALL #2
17:54:17  tts[8]  ws  219ch   (+4.7s)   ← last TTS, then silence
```

### Failure points

| Symptom | Likely segment | Evidence |
|---------|----------------|----------|
| **Mid-lesson stall** | ~5→6 and ~6→7 | Back-to-back 11.3s + 10.9s gaps (segments entering coordinate/geometry math) |
| **Voice skip** | 9–23 | TTS stops after segment 8; 15 segments never spoken |
| **No http fallback** | — | All ws; no transport switch (unlike turn 1) |

---

## Patterns across both turns

1. **TTS pipeline stops ~35–40% into lesson** — consistent ~63% of segments never get a server `tts-segment` record. User hears voice through ~segment 8–10, then silence while board may continue drawing.
2. **Stalls precede the cutoff** — each turn shows 2+ gaps >8s immediately before TTS stops. Suggests client-side segment chain blocking (draw wait, ws hang, or unhandled error) rather than LLM truncation (LLM output is complete with 24–30 steps).
3. **Client telemetry blackout** — unlike baseline `6b9f2174`, no `tts-timing-validation` data available. Baseline (when telemetry worked) showed `duration-too-large` rejections from segment 4+ causing estimated write schedules — that pattern cannot be confirmed or ruled out for these turns.
4. **Server TTS transport healthy early** — ws latency_ms 0–1 for most gens; only turn 1 late fallback to http.
5. **Same session, repeated failures** — all 5 recent traces share missing client telemetry; session `5343e6f6…` may have a regression vs Jun 27 session `3a54e637…`.

---

## Recommended next steps for fix agents

1. **Unblock client telemetry** — verify `navigator.sendBeacon` / `fetch(..., {keepalive:true})` to `/api/trace/event` succeeds; check server logs and Langfuse flush errors. Without this, sync debugging is blind.
2. **Investigate segment-chain stall after ~8–10 segments** — correlate with long narration segments (317ch, 216ch) and ws connection lifetime in `server.ts` / `elevenLabsWebSocketClient.ts`.
3. **Handle ws→http fallback without duplicate playback** — turn 1 shows back-to-back 216ch ws+http; may cause audio glitch or stall.
4. **Re-run a lesson after telemetry fix** — compare `tts-start` vs `draw-N` ordering and `tts-timing-validation` valid rates against baseline `6b9f2174`.

---

## Quick reference: what each observation type means

| Observation | Source | Use |
|-------------|--------|-----|
| `fireworks-llm` | server `/api/chat` | LLM TTFT + total gen time |
| `tts-segment` | server ws/http TTS relay | Per-segment TTS request; `metadata.transport`, `latency_ms` |
| `segment-N` | client beacon | Segment wall-clock span |
| `tts-start` | client | Audio actually audible; gates text sync |
| `tts-timing-validation` | client | `valid`/`reason` (e.g. `duration-too-large`) |
| `write-char-start` | client | Per-char `lag_ms` vs audio clock |
| `draw-N` | client | Draw duration per segment |
