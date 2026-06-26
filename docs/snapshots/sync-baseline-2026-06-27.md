# Sync Baseline Snapshot — 2026-06-27

This documents the **best tutor sync version so far** before the elastic-speed pass.
Use this as a rollback reference and comparison point for Langfuse traces.

## Reference Trace

| Field | Value |
|---|---|
| Trace ID | `6b9f2174-fb7b-442e-81b2-f5da69d18694` |
| Question | "explain me hwo to find the qn of circle" |
| Turn duration | 123.6s |
| Draw time | 37.0s |
| Segments | 13 |
| TTS chars | 661 |

## What Works (Keep)

- Cue-first `[STEP]` lesson format with heading + underline at top
- Runtime board layout guard (top-down rows, auto-erase work area before overflow)
- Character-level write scheduling with Web Audio clock gating
- Langfuse events: `tts-start`, `tts-timing-validation`, `write-schedule-ready`, `write-char-start`, `draw-complete`
- Segments 0–3: TTS schedule source, lag mostly under 100ms per character

## Known Issues (Next Fixes)

### 1. TTS validation rejects good timings too early

From segment 4 onward, `validateAudioTimingsForNarration` returns `duration-too-large`
because streaming `totalDuration` grows before the segment finishes.
Segments 4–12 fall back to `estimated` schedules (`valid_timing: false`).

**Symptom:** writing speed becomes uniform (~66ms/char estimate) instead of following speech pace.

### 2. Long narration after short WRITE cues

Example segment 10 (117 chars spoken, WRITE `find center`):

- Draw finishes ~4s before segment ends
- Voice keeps explaining with nothing new on the board

This is structurally correct for cue-first steps but feels like "not drawing during explanation".

### 3. Late lesson steps appear at bottom of board

Segments 11–12 (`find radius`, `plug into ...`) land on rows y=505/565 — bottom of canvas.
User perceives them as "random text at the end" even though sync matched.

**Mitigation already in prompt:** erase work area `[ERASE:70,126,1060,520]` before new section.
**Still needed:** LLM should erase before graph-finding steps, not stack at bottom.

### 4. Voice breaking / uneven pacing

Estimated schedules + damped catch-up in Whiteboard cause fast/slow/fast stroke budgets
when TTS timings are rejected. Not a TTS transport failure — a schedule fallback artifact.

## Key Files At This Baseline

| Area | File |
|---|---|
| Session orchestration | `apps/tutor/app/c/[sessionId]/page.tsx` |
| Schedule + validation | `packages/tutor-core/src/audioSync.ts` |
| TTS timing merge | `packages/tutor-core/src/elevenLabsClient.ts` |
| WS TTS client | `packages/tutor-core/src/elevenLabsWebSocketClient.ts` |
| Scheduled writing | `packages/whiteboard/src/Whiteboard.tsx` |
| Lesson prompt | `packages/tutor-core/src/systemPrompt.ts` |
| Sync architecture doc | `docs/tutor-sync-architecture.md` |
| Schedule verification | `packages/tutor-core/scripts/verify-sync-schedules.ts` |

## Verification Commands (baseline passes)

```bash
pnpm --filter @heytutor/tutor exec tsx "../../packages/tutor-core/scripts/verify-sync-schedules.ts"
pnpm turbo run typecheck
pnpm --filter @heytutor/tutor build
```

## Langfuse Checks For Regressions

After changes, compare against this baseline:

- `schedule_source: tts` for most WRITE segments (not only 0–3)
- `valid_timing: true` when TTS alignment is present
- `write-char-start` lag_ms mostly within ±120ms
- No `duration-too-large` on segments under 20s real audio
- Draw spans should end near `draw-complete`, not at trace flush time
